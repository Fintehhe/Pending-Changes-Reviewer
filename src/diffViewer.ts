import * as vscode from 'vscode';
import { FileChange } from './snapshotManager';

/**
 * Virtual document provider for showing original file content in diff view
 */
export class OriginalContentProvider implements vscode.TextDocumentContentProvider {
    static readonly scheme = 'pending-changes-original';
    
    private contentMap: Map<string, string> = new Map();
    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    readonly onDidChange = this._onDidChange.event;

    setContent(uri: vscode.Uri, content: string): void {
        const key = uri.toString();
        this.contentMap.set(key, content);
        this._onDidChange.fire(uri);
    }

    removeContent(uri: vscode.Uri): void {
        this.contentMap.delete(uri.toString());
    }

    provideTextDocumentContent(uri: vscode.Uri): string {
        return this.contentMap.get(uri.toString()) || '';
    }

    dispose(): void {
        this._onDidChange.dispose();
        this.contentMap.clear();
    }
}

export class DiffViewer implements vscode.Disposable {
    private originalContentProvider: OriginalContentProvider;
    private disposables: vscode.Disposable[] = [];

    constructor() {
        this.originalContentProvider = new OriginalContentProvider();
        
        const registration = vscode.workspace.registerTextDocumentContentProvider(
            OriginalContentProvider.scheme,
            this.originalContentProvider
        );
        
        this.disposables.push(registration);
    }

    async showDiff(change: FileChange): Promise<void> {
        // Create URI for original content
        const originalUri = vscode.Uri.parse(
            `${OriginalContentProvider.scheme}:${change.uri.fsPath}?original`
        );
        
        // Set the original content
        this.originalContentProvider.setContent(originalUri, change.originalContent);

        // Get the title for the diff editor
        const fileName = change.relativePath;
        const title = `${fileName} (Original ↔ Current)`;

        // Open the diff editor
        await vscode.commands.executeCommand(
            'vscode.diff',
            originalUri,
            change.uri,
            title,
            {
                preview: true,
                preserveFocus: false
            }
        );
    }

    dispose(): void {
        for (const d of this.disposables) {
            d.dispose();
        }
        this.originalContentProvider.dispose();
    }
}
