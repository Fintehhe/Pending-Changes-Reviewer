import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface FileSnapshot {
    uri: vscode.Uri;
    originalContent: string;
    snapshotTime: Date;
    relativePath: string;
    isNewFile: boolean;  // true if file was created (didn't exist before)
}

export interface FileChange {
    uri: vscode.Uri;
    relativePath: string;
    originalContent: string;
    currentContent: string;
    snapshotTime: Date;
    changeType: 'modified' | 'created' | 'deleted';
    additions: number;
    deletions: number;
}

export class SnapshotManager {
    private snapshots: Map<string, FileSnapshot> = new Map();
    private deletedFiles: Map<string, FileSnapshot> = new Map(); // Track deleted files
    private workspaceRoot: string | undefined;
    private _onSnapshotsChanged = new vscode.EventEmitter<void>();
    readonly onSnapshotsChanged = this._onSnapshotsChanged.event;

    constructor() {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        this.workspaceRoot = workspaceFolders?.[0]?.uri.fsPath;
    }

    /**
     * Snapshot a file - captures current content as the "original" state
     */
    async snapshotFile(uri: vscode.Uri): Promise<void> {
        try {
            const content = await this.readFileContent(uri);
            if (content === null) return;

            const key = uri.fsPath;
            const relativePath = this.getRelativePath(uri);

            // Don't re-snapshot if we already have one
            if (this.snapshots.has(key)) {
                return;
            }

            this.snapshots.set(key, {
                uri,
                originalContent: content,
                snapshotTime: new Date(),
                relativePath,
                isNewFile: false
            });

            this._onSnapshotsChanged.fire();
        } catch (error) {
            console.error(`Failed to snapshot file: ${uri.fsPath}`, error);
        }
    }

    /**
     * Auto-snapshot: Called when a file is about to be modified
     * Captures the CURRENT content before any changes
     */
    async autoSnapshotBeforeChange(uri: vscode.Uri): Promise<void> {
        const key = uri.fsPath;
        
        // Already have a snapshot - don't overwrite
        if (this.snapshots.has(key)) {
            return;
        }

        try {
            const content = await this.readFileContent(uri);
            if (content === null) return;

            const relativePath = this.getRelativePath(uri);

            this.snapshots.set(key, {
                uri,
                originalContent: content,
                snapshotTime: new Date(),
                relativePath,
                isNewFile: false
            });

            this._onSnapshotsChanged.fire();
        } catch (error) {
            console.error(`Failed to auto-snapshot file: ${uri.fsPath}`, error);
        }
    }

    /**
     * Track a newly created file - original is empty
     */
    trackNewFile(uri: vscode.Uri): void {
        const key = uri.fsPath;
        
        // Already tracking
        if (this.snapshots.has(key)) {
            return;
        }

        const relativePath = this.getRelativePath(uri);

        this.snapshots.set(key, {
            uri,
            originalContent: '', // New file - original was empty/non-existent
            snapshotTime: new Date(),
            relativePath,
            isNewFile: true
        });

        this._onSnapshotsChanged.fire();
    }

    /**
     * Track a deleted file - save its content so it can be restored
     */
    async trackDeletedFile(uri: vscode.Uri, lastKnownContent?: string): Promise<void> {
        const key = uri.fsPath;
        const relativePath = this.getRelativePath(uri);

        // If we had a snapshot, use that original content
        const existingSnapshot = this.snapshots.get(key);
        const content = existingSnapshot?.originalContent ?? lastKnownContent ?? '';

        this.deletedFiles.set(key, {
            uri,
            originalContent: content,
            snapshotTime: new Date(),
            relativePath,
            isNewFile: false
        });

        // Remove from active snapshots
        this.snapshots.delete(key);
        this._onSnapshotsChanged.fire();
    }

    async snapshotFiles(uris: vscode.Uri[]): Promise<void> {
        for (const uri of uris) {
            await this.snapshotFile(uri);
        }
    }

    async snapshotAllOpenFiles(): Promise<number> {
        const openDocuments = vscode.workspace.textDocuments.filter(
            doc => doc.uri.scheme === 'file' && !doc.isUntitled
        );
        
        let count = 0;
        for (const doc of openDocuments) {
            if (!this.snapshots.has(doc.uri.fsPath)) {
                await this.snapshotFile(doc.uri);
                count++;
            }
        }
        
        return count;
    }

    hasSnapshot(uri: vscode.Uri): boolean {
        return this.snapshots.has(uri.fsPath);
    }

    getSnapshot(uri: vscode.Uri): FileSnapshot | undefined {
        return this.snapshots.get(uri.fsPath);
    }

    removeSnapshot(uri: vscode.Uri): void {
        this.snapshots.delete(uri.fsPath);
        this.deletedFiles.delete(uri.fsPath);
        this._onSnapshotsChanged.fire();
    }

    clearAllSnapshots(): void {
        this.snapshots.clear();
        this.deletedFiles.clear();
        this._onSnapshotsChanged.fire();
    }

    async getChangedFiles(): Promise<FileChange[]> {
        const changes: FileChange[] = [];

        // Check modified/created files
        for (const [key, snapshot] of this.snapshots) {
            try {
                const currentContent = await this.readFileContent(snapshot.uri);
                
                if (currentContent === null) {
                    // File was deleted after we snapshotted it
                    if (!snapshot.isNewFile) {
                        changes.push({
                            uri: snapshot.uri,
                            relativePath: snapshot.relativePath,
                            originalContent: snapshot.originalContent,
                            currentContent: '',
                            snapshotTime: snapshot.snapshotTime,
                            changeType: 'deleted',
                            additions: 0,
                            deletions: snapshot.originalContent.split('\n').length
                        });
                    }
                    // If it was a new file that got deleted, just remove from tracking
                } else if (snapshot.isNewFile) {
                    // Newly created file
                    const { additions, deletions } = this.countChanges('', currentContent);
                    changes.push({
                        uri: snapshot.uri,
                        relativePath: snapshot.relativePath,
                        originalContent: '',
                        currentContent,
                        snapshotTime: snapshot.snapshotTime,
                        changeType: 'created',
                        additions,
                        deletions
                    });
                } else if (currentContent !== snapshot.originalContent) {
                    // File was modified
                    const { additions, deletions } = this.countChanges(
                        snapshot.originalContent,
                        currentContent
                    );
                    
                    changes.push({
                        uri: snapshot.uri,
                        relativePath: snapshot.relativePath,
                        originalContent: snapshot.originalContent,
                        currentContent,
                        snapshotTime: snapshot.snapshotTime,
                        changeType: 'modified',
                        additions,
                        deletions
                    });
                }
            } catch (error) {
                console.error(`Error checking changes for ${key}:`, error);
            }
        }

        // Add deleted files
        for (const [key, snapshot] of this.deletedFiles) {
            changes.push({
                uri: snapshot.uri,
                relativePath: snapshot.relativePath,
                originalContent: snapshot.originalContent,
                currentContent: '',
                snapshotTime: snapshot.snapshotTime,
                changeType: 'deleted',
                additions: 0,
                deletions: snapshot.originalContent.split('\n').length
            });
        }

        return changes;
    }

    async revertFile(uri: vscode.Uri): Promise<boolean> {
        const key = uri.fsPath;
        
        // Check if it's a deleted file we need to restore
        const deletedSnapshot = this.deletedFiles.get(key);
        if (deletedSnapshot) {
            try {
                // Recreate the file
                await fs.promises.writeFile(uri.fsPath, deletedSnapshot.originalContent, 'utf-8');
                this.deletedFiles.delete(key);
                this._onSnapshotsChanged.fire();
                return true;
            } catch (error) {
                console.error(`Failed to restore deleted file: ${uri.fsPath}`, error);
                return false;
            }
        }

        const snapshot = this.snapshots.get(key);
        if (!snapshot) {
            return false;
        }

        try {
            if (snapshot.isNewFile) {
                // Delete the newly created file
                try {
                    await fs.promises.unlink(uri.fsPath);
                } catch (e) {
                    // File might already be deleted
                }
                this.removeSnapshot(uri);
                return true;
            }

            // Revert to original content
            const edit = new vscode.WorkspaceEdit();
            const document = await vscode.workspace.openTextDocument(uri);
            const fullRange = new vscode.Range(
                document.positionAt(0),
                document.positionAt(document.getText().length)
            );
            
            edit.replace(uri, fullRange, snapshot.originalContent);
            const success = await vscode.workspace.applyEdit(edit);
            
            if (success) {
                await document.save();
                this.removeSnapshot(uri);
            }
            
            return success;
        } catch (error) {
            console.error(`Failed to revert file: ${uri.fsPath}`, error);
            return false;
        }
    }

    acceptFile(uri: vscode.Uri): void {
        this.removeSnapshot(uri);
    }

    /**
     * Accept changes and update the baseline to current content
     * This way, future changes will be compared against the new accepted state
     */
    async acceptAndUpdateBaseline(uri: vscode.Uri, updateCacheCallback?: (uri: vscode.Uri, content: string) => void): Promise<void> {
        const key = uri.fsPath;
        
        // Handle deleted files - just remove from tracking
        if (this.deletedFiles.has(key)) {
            this.deletedFiles.delete(key);
            this._onSnapshotsChanged.fire();
            return;
        }

        const snapshot = this.snapshots.get(key);
        if (!snapshot) return;

        try {
            // Read current content
            const currentContent = await this.readFileContent(uri);
            
            if (currentContent !== null) {
                // Update the file watcher cache so future changes use this as baseline
                if (updateCacheCallback) {
                    updateCacheCallback(uri, currentContent);
                }
            }
            
            // Remove from snapshots since there's no diff now
            this.snapshots.delete(key);
            this._onSnapshotsChanged.fire();
        } catch (error) {
            console.error(`Failed to accept and update baseline: ${uri.fsPath}`, error);
        }
    }

    private async readFileContent(uri: vscode.Uri): Promise<string | null> {
        try {
            // First try to get from open document
            const openDoc = vscode.workspace.textDocuments.find(
                doc => doc.uri.fsPath === uri.fsPath
            );
            
            if (openDoc) {
                return openDoc.getText();
            }

            // Read from filesystem
            const content = await fs.promises.readFile(uri.fsPath, 'utf-8');
            return content;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                return null;
            }
            throw error;
        }
    }

    private getRelativePath(uri: vscode.Uri): string {
        if (this.workspaceRoot) {
            return path.relative(this.workspaceRoot, uri.fsPath);
        }
        return path.basename(uri.fsPath);
    }

    private countChanges(original: string, current: string): { additions: number; deletions: number } {
        const originalLines = original.split('\n');
        const currentLines = current.split('\n');
        
        // Simple line-based diff counting
        const originalSet = new Set(originalLines);
        const currentSet = new Set(currentLines);
        
        let additions = 0;
        let deletions = 0;
        
        for (const line of currentLines) {
            if (!originalSet.has(line)) {
                additions++;
            }
        }
        
        for (const line of originalLines) {
            if (!currentSet.has(line)) {
                deletions++;
            }
        }
        
        return { additions, deletions };
    }

    getSnapshotCount(): number {
        return this.snapshots.size + this.deletedFiles.size;
    }

    getAllSnapshots(): FileSnapshot[] {
        return Array.from(this.snapshots.values());
    }
}
