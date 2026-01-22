import * as vscode from 'vscode';
import * as fs from 'fs';
import { SnapshotManager } from './snapshotManager';

export class FileWatcher implements vscode.Disposable {
    private watchers: vscode.FileSystemWatcher[] = [];
    private isTracking = false;
    private snapshotManager: SnapshotManager;
    private config: vscode.WorkspaceConfiguration;
    private disposables: vscode.Disposable[] = [];
    
    // Cache file contents to capture "before" state
    private fileContentCache: Map<string, string> = new Map();
    
    private _onTrackingChanged = new vscode.EventEmitter<boolean>();
    readonly onTrackingChanged = this._onTrackingChanged.event;
    
    private _onFileChanged = new vscode.EventEmitter<vscode.Uri>();
    readonly onFileChanged = this._onFileChanged.event;

    constructor(snapshotManager: SnapshotManager) {
        this.snapshotManager = snapshotManager;
        this.config = vscode.workspace.getConfiguration('pendingChanges');
        
        // Listen for configuration changes
        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('pendingChanges')) {
                    this.config = vscode.workspace.getConfiguration('pendingChanges');
                    if (this.isTracking) {
                        this.restartWatchers();
                    }
                }
            })
        );
    }

    startTracking(): void {
        if (this.isTracking) return;
        
        this.isTracking = true;
        this.setupWatchers();
        this.setupDocumentListeners();
        this._onTrackingChanged.fire(true);
        
        vscode.commands.executeCommand('setContext', 'pendingChanges.isTracking', true);
    }

    stopTracking(): void {
        if (!this.isTracking) return;
        
        this.isTracking = false;
        this.disposeWatchers();
        this.fileContentCache.clear();
        this._onTrackingChanged.fire(false);
        
        vscode.commands.executeCommand('setContext', 'pendingChanges.isTracking', false);
    }

    getIsTracking(): boolean {
        return this.isTracking;
    }

    /**
     * Update the cached content for a file (called after accepting changes)
     */
    updateFileCache(uri: vscode.Uri, content: string): void {
        this.fileContentCache.set(uri.fsPath, content);
    }

    /**
     * Get cached content for a file
     */
    getCachedContent(uri: vscode.Uri): string | undefined {
        return this.fileContentCache.get(uri.fsPath);
    }

    private setupWatchers(): void {
        const watchPatterns = this.config.get<string[]>('watchPatterns', ['**/*']);
        
        for (const pattern of watchPatterns) {
            const watcher = vscode.workspace.createFileSystemWatcher(pattern);
            
            // File modified on disk
            watcher.onDidChange(uri => this.handleFileModified(uri));
            
            // New file created
            watcher.onDidCreate(uri => this.handleFileCreated(uri));
            
            // File deleted
            watcher.onDidDelete(uri => this.handleFileDeleted(uri));
            
            this.watchers.push(watcher);
        }
    }

    private setupDocumentListeners(): void {
        // Capture content BEFORE it's modified (when document is about to change)
        this.disposables.push(
            vscode.workspace.onDidChangeTextDocument(async (e) => {
                if (!this.isTracking) return;
                if (e.document.uri.scheme !== 'file') return;
                if (this.shouldExclude(e.document.uri)) return;
                
                const key = e.document.uri.fsPath;
                
                // If we don't have this file cached and don't have a snapshot,
                // we need to auto-snapshot it
                if (!this.snapshotManager.hasSnapshot(e.document.uri) && 
                    !this.fileContentCache.has(key)) {
                    // This is the first change - but the document already has the new content
                    // We can't get the "before" state from here
                    // The cache should have been populated by onWillSaveTextDocument or file read
                }
            })
        );

        // Cache content when document is opened
        this.disposables.push(
            vscode.workspace.onDidOpenTextDocument(async (doc) => {
                if (!this.isTracking) return;
                if (doc.uri.scheme !== 'file') return;
                if (this.shouldExclude(doc.uri)) return;
                
                // Cache current content when file is opened
                this.fileContentCache.set(doc.uri.fsPath, doc.getText());
            })
        );

        // Auto-snapshot before save if content changed
        this.disposables.push(
            vscode.workspace.onWillSaveTextDocument(async (e) => {
                if (!this.isTracking) return;
                if (e.document.uri.scheme !== 'file') return;
                if (this.shouldExclude(e.document.uri)) return;
                
                const key = e.document.uri.fsPath;
                const cachedContent = this.fileContentCache.get(key);
                const currentContent = e.document.getText();
                
                // If content changed and we don't have a snapshot, create one from cache
                if (cachedContent !== undefined && 
                    cachedContent !== currentContent && 
                    !this.snapshotManager.hasSnapshot(e.document.uri)) {
                    
                    // Create snapshot with the CACHED (original) content
                    await this.snapshotManager.autoSnapshotBeforeChange(e.document.uri);
                    
                    // Update the snapshot's original content to the cached version
                    // (since autoSnapshotBeforeChange reads current content)
                    const snapshot = this.snapshotManager.getSnapshot(e.document.uri);
                    if (snapshot) {
                        (snapshot as any).originalContent = cachedContent;
                    }
                }
            })
        );

        // Update cache after save
        this.disposables.push(
            vscode.workspace.onDidSaveTextDocument((doc) => {
                if (!this.isTracking) return;
                if (doc.uri.scheme !== 'file') return;
                
                // Don't update cache if we have a snapshot - we want to keep tracking against original
                if (!this.snapshotManager.hasSnapshot(doc.uri)) {
                    this.fileContentCache.set(doc.uri.fsPath, doc.getText());
                }
            })
        );

        // Cache all currently open documents
        for (const doc of vscode.workspace.textDocuments) {
            if (doc.uri.scheme === 'file' && !this.shouldExclude(doc.uri)) {
                this.fileContentCache.set(doc.uri.fsPath, doc.getText());
            }
        }
    }

    private async handleFileModified(uri: vscode.Uri): Promise<void> {
        if (this.shouldExclude(uri)) return;
        
        // Auto-snapshot if we don't have one yet
        if (!this.snapshotManager.hasSnapshot(uri)) {
            const cachedContent = this.fileContentCache.get(uri.fsPath);
            if (cachedContent !== undefined) {
                // We have cached content - use it as the original
                await this.snapshotManager.autoSnapshotBeforeChange(uri);
                const snapshot = this.snapshotManager.getSnapshot(uri);
                if (snapshot) {
                    (snapshot as any).originalContent = cachedContent;
                }
            }
        }
        
        this._onFileChanged.fire(uri);
    }

    private async handleFileCreated(uri: vscode.Uri): Promise<void> {
        if (this.shouldExclude(uri)) return;
        
        // Track new file - can be reverted by deleting
        this.snapshotManager.trackNewFile(uri);
        this._onFileChanged.fire(uri);
    }

    private async handleFileDeleted(uri: vscode.Uri): Promise<void> {
        if (this.shouldExclude(uri)) return;
        
        // Get last known content from cache
        const cachedContent = this.fileContentCache.get(uri.fsPath);
        
        // Track deleted file - can be restored
        await this.snapshotManager.trackDeletedFile(uri, cachedContent);
        
        // Remove from cache
        this.fileContentCache.delete(uri.fsPath);
        
        this._onFileChanged.fire(uri);
    }

    private shouldExclude(uri: vscode.Uri): boolean {
        const excludePatterns = this.config.get<string[]>('excludePatterns', []);
        const filePath = uri.fsPath.replace(/\\/g, '/');
        
        for (const pattern of excludePatterns) {
            // Simple pattern matching - check if path contains the pattern
            const cleanPattern = pattern.replace(/\*\*/g, '').replace(/\*/g, '').replace(/\//g, '');
            if (cleanPattern && filePath.includes(cleanPattern)) {
                return true;
            }
        }
        
        return false;
    }

    private restartWatchers(): void {
        this.disposeWatchers();
        this.setupWatchers();
    }

    private disposeWatchers(): void {
        for (const watcher of this.watchers) {
            watcher.dispose();
        }
        this.watchers = [];
        
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        this.disposables = [];
    }

    dispose(): void {
        this.stopTracking();
        this._onTrackingChanged.dispose();
        this._onFileChanged.dispose();
    }
}
