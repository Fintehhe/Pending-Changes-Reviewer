import * as vscode from 'vscode';
import { SnapshotManager, FileChange } from './snapshotManager';
import * as path from 'path';

export class PendingChangesPanelProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'pendingChangesPanelView';
    private _view?: vscode.WebviewView;
    private snapshotManager: SnapshotManager;
    private refreshDebounce: NodeJS.Timeout | undefined;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        snapshotManager: SnapshotManager
    ) {
        this.snapshotManager = snapshotManager;

        // Listen for changes
        snapshotManager.onSnapshotsChanged(() => {
            this.scheduleRefresh();
        });

        // Listen for document changes
        vscode.workspace.onDidChangeTextDocument(() => {
            this.scheduleRefresh();
        });

        vscode.workspace.onDidSaveTextDocument(() => {
            this.scheduleRefresh();
        });

        // Listen for config changes
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('pendingChanges')) {
                this.refresh();
            }
        });
    }

    private scheduleRefresh(): void {
        if (this.refreshDebounce) {
            clearTimeout(this.refreshDebounce);
        }
        this.refreshDebounce = setTimeout(() => {
            this.refresh();
        }, 300);
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'accept':
                    await vscode.commands.executeCommand('pendingChanges.acceptFile', { change: data.change });
                    break;
                case 'discard':
                    await vscode.commands.executeCommand('pendingChanges.discardFile', { change: data.change });
                    break;
                case 'acceptAll':
                    await vscode.commands.executeCommand('pendingChanges.acceptAll');
                    break;
                case 'discardAll':
                    await vscode.commands.executeCommand('pendingChanges.discardAll');
                    break;
                case 'showDiff':
                    await vscode.commands.executeCommand('pendingChanges.showDiff', { change: data.change });
                    break;
                case 'refresh':
                    this.refresh();
                    break;
            }
        });

        this.refresh();
    }

    public async refresh() {
        if (this._view) {
            const changes = await this.snapshotManager.getChangedFiles();
            this._view.webview.html = this._getHtmlForWebview(this._view.webview, changes);
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview, changes: FileChange[]) {
        const config = vscode.workspace.getConfiguration('pendingChanges');
        const fontSize = config.get<number>('fontSize', 13);
        const fontFamily = config.get<string>('fontFamily', '') || 'var(--vscode-font-family)';
        const lineHeight = config.get<number>('lineHeight', 22);

        // Calculate totals
        const totalAdditions = changes.reduce((sum, c) => sum + c.additions, 0);
        const totalDeletions = changes.reduce((sum, c) => sum + c.deletions, 0);

        // Sort changes
        changes.sort((a, b) => {
            const order: Record<string, number> = { modified: 0, created: 1, deleted: 2 };
            return order[a.changeType] - order[b.changeType];
        });

        const changeItems = changes.map((change, index) => {
            const fileName = path.basename(change.relativePath);
            const dirPath = path.dirname(change.relativePath);
            const dirDisplay = dirPath !== '.' ? dirPath : '';
            
            let iconClass = 'modified';
            if (change.changeType === 'created') iconClass = 'created';
            if (change.changeType === 'deleted') iconClass = 'deleted';
            
            return `
                <div class="file-row" data-index="${index}">
                    <div class="file-icon ${iconClass}">
                        ${change.changeType === 'created' ? '+' : change.changeType === 'deleted' ? '−' : '✎'}
                    </div>
                    <div class="file-info" onclick="showDiff(${index})">
                        <span class="filename">${this._escapeHtml(fileName)}</span>
                        <span class="filepath">${this._escapeHtml(dirDisplay)}</span>
                    </div>
                    <div class="file-stats">
                        <span class="stat-add">+${change.additions}</span>
                        <span class="stat-del">-${change.deletions}</span>
                    </div>
                    <div class="file-actions">
                        <button class="action-btn keep" onclick="acceptFile(${index})" title="Keep">✓</button>
                        <button class="action-btn undo" onclick="discardFile(${index})" title="Undo">↺</button>
                    </div>
                </div>
            `;
        }).join('');

        const emptyMessage = changes.length === 0 ? 
            '<div class="empty-message">No pending changes</div>' : '';

        const headerSection = changes.length > 0 ? `
            <div class="header-row">
                <div class="header-icon">▼</div>
                <div class="header-info">
                    <span class="header-count">${changes.length} files changed</span>
                    <span class="header-stats">
                        <span class="stat-add">+${totalAdditions}</span>
                        <span class="stat-del">-${totalDeletions}</span>
                    </span>
                </div>
                <div class="header-actions">
                    <button class="header-btn keep" onclick="acceptAll()" title="Keep All">Keep</button>
                    <button class="header-btn undo" onclick="discardAll()" title="Undo All">Undo</button>
                </div>
            </div>
        ` : '';

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: ${fontFamily};
            font-size: ${fontSize}px;
            color: var(--vscode-foreground);
            background: transparent;
            padding: 0;
            line-height: 1.4;
        }
        
        /* Header Row */
        .header-row {
            display: flex;
            align-items: center;
            padding: 6px 8px;
            background: var(--vscode-sideBar-background);
            border-bottom: 1px solid var(--vscode-panel-border);
            gap: 8px;
        }
        .header-icon {
            font-size: 10px;
            opacity: 0.7;
            width: 16px;
        }
        .header-info {
            flex: 1;
            display: flex;
            align-items: center;
            gap: 12px;
        }
        .header-count {
            font-weight: 500;
        }
        .header-stats {
            display: flex;
            gap: 6px;
            font-size: ${fontSize - 1}px;
        }
        .header-actions {
            display: flex;
            gap: 4px;
        }
        .header-btn {
            padding: 2px 8px;
            border: none;
            border-radius: 3px;
            cursor: pointer;
            font-size: ${fontSize - 1}px;
            font-weight: 500;
        }
        .header-btn.keep {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        .header-btn.keep:hover {
            background: var(--vscode-button-hoverBackground);
        }
        .header-btn.undo {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        .header-btn.undo:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        
        /* File Rows */
        .file-row {
            display: flex;
            align-items: center;
            padding: 4px 8px 4px 24px;
            height: ${lineHeight}px;
            gap: 8px;
            cursor: pointer;
        }
        .file-row:hover {
            background: var(--vscode-list-hoverBackground);
        }
        .file-icon {
            width: 18px;
            height: 18px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
            flex-shrink: 0;
        }
        .file-icon.modified {
            color: var(--vscode-gitDecoration-modifiedResourceForeground, #E2C08D);
        }
        .file-icon.created {
            color: var(--vscode-gitDecoration-addedResourceForeground, #81B88B);
        }
        .file-icon.deleted {
            color: var(--vscode-gitDecoration-deletedResourceForeground, #C74E39);
        }
        .file-info {
            flex: 1;
            display: flex;
            align-items: center;
            gap: 8px;
            overflow: hidden;
            min-width: 0;
        }
        .filename {
            color: var(--vscode-foreground);
            white-space: nowrap;
            flex-shrink: 0;
        }
        .filepath {
            color: var(--vscode-descriptionForeground);
            font-size: ${fontSize - 1}px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .file-stats {
            display: flex;
            gap: 6px;
            font-size: ${fontSize - 1}px;
            font-family: monospace;
            flex-shrink: 0;
        }
        .stat-add {
            color: var(--vscode-gitDecoration-addedResourceForeground, #81B88B);
        }
        .stat-del {
            color: var(--vscode-gitDecoration-deletedResourceForeground, #C74E39);
        }
        .file-actions {
            display: flex;
            gap: 2px;
            opacity: 0;
            transition: opacity 0.1s;
            flex-shrink: 0;
        }
        .file-row:hover .file-actions {
            opacity: 1;
        }
        .action-btn {
            width: 22px;
            height: 22px;
            border: none;
            border-radius: 3px;
            cursor: pointer;
            font-size: 12px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: transparent;
            color: var(--vscode-foreground);
        }
        .action-btn:hover {
            background: var(--vscode-toolbar-hoverBackground);
        }
        .action-btn.keep:hover {
            color: var(--vscode-gitDecoration-addedResourceForeground, #81B88B);
        }
        .action-btn.undo:hover {
            color: var(--vscode-gitDecoration-deletedResourceForeground, #C74E39);
        }
        
        .empty-message {
            text-align: center;
            padding: 20px;
            color: var(--vscode-descriptionForeground);
            font-style: italic;
        }
    </style>
</head>
<body>
    ${headerSection}
    <div class="file-list">
        ${changeItems}
        ${emptyMessage}
    </div>
    <script>
        const vscode = acquireVsCodeApi();
        const changes = ${JSON.stringify(changes.map(c => ({
            uri: c.uri.fsPath,
            relativePath: c.relativePath,
            changeType: c.changeType
        })))};

        function showDiff(index) {
            vscode.postMessage({ type: 'showDiff', change: changes[index] });
        }
        function acceptFile(index) {
            event.stopPropagation();
            vscode.postMessage({ type: 'accept', change: changes[index] });
        }
        function discardFile(index) {
            event.stopPropagation();
            vscode.postMessage({ type: 'discard', change: changes[index] });
        }
        function acceptAll() {
            vscode.postMessage({ type: 'acceptAll' });
        }
        function discardAll() {
            vscode.postMessage({ type: 'discardAll' });
        }
    </script>
</body>
</html>`;
    }

    private _escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
}
