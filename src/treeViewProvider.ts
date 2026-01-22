import * as vscode from 'vscode';
import { SnapshotManager, FileChange } from './snapshotManager';
import * as path from 'path';

export class PendingChangesWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'pendingChangesView';
    private _view?: vscode.WebviewView;
    private snapshotManager: SnapshotManager;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        snapshotManager: SnapshotManager
    ) {
        this.snapshotManager = snapshotManager;

        snapshotManager.onSnapshotsChanged(() => {
            this.refresh();
        });

        vscode.workspace.onDidChangeTextDocument(() => {
            this.refresh();
        });

        vscode.workspace.onDidSaveTextDocument(() => {
            this.refresh();
        });
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

        this.updateContent();

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
    }

    public async refresh() {
        if (this._view) {
            await this.updateContent();
        }
    }

    private async updateContent() {
        if (!this._view) return;
        
        const changes = await this.snapshotManager.getChangedFiles();
        this._view.webview.html = this.getHtml(changes);
    }

    private getHtml(changes: FileChange[]): string {
        const totalAdditions = changes.reduce((sum, c) => sum + c.additions, 0);
        const totalDeletions = changes.reduce((sum, c) => sum + c.deletions, 0);

        const fileItems = changes.map((change, index) => {
            const fileName = path.basename(change.relativePath);
            const dirPath = path.dirname(change.relativePath);
            const dirDisplay = dirPath !== '.' ? dirPath : '';
            
            let iconClass = 'modified';
            if (change.changeType === 'created') iconClass = 'added';
            if (change.changeType === 'deleted') iconClass = 'deleted';

            return `
                <div class="file-row" data-index="${index}">
                    <div class="file-icon ${iconClass}"></div>
                    <div class="file-info" onclick="showDiff(${index})">
                        <span class="file-name">${this.escapeHtml(fileName)}</span>
                        <span class="file-path">${this.escapeHtml(dirDisplay)}</span>
                    </div>
                    <div class="file-stats">
                        <span class="stat-add">+${change.additions}</span>
                        <span class="stat-del">-${change.deletions}</span>
                    </div>
                    <div class="file-actions">
                        <button class="btn-icon" onclick="acceptFile(${index})" title="Keep">✓</button>
                        <button class="btn-icon" onclick="discardFile(${index})" title="Undo">↺</button>
                    </div>
                </div>
            `;
        }).join('');

        const headerContent = changes.length > 0 ? `
            <div class="header" onclick="toggleCollapse()">
                <span class="collapse-icon" id="collapseIcon">▼</span>
                <span class="header-text">${changes.length} files changed</span>
                <span class="header-stats">
                    <span class="stat-add">+${totalAdditions}</span>
                    <span class="stat-del">-${totalDeletions}</span>
                </span>
                <div class="header-actions">
                    <button class="btn keep-btn" onclick="event.stopPropagation(); acceptAll()"><span class="btn-icon-inline">✓</span> Keep</button>
                    <button class="btn undo-btn" onclick="event.stopPropagation(); discardAll()"><span class="btn-icon-inline">↺</span> Undo</button>
                </div>
            </div>
            <div class="file-list" id="fileList">
                ${fileItems}
            </div>
        ` : `
            <div class="empty-state">No pending changes</div>
        `;

        return `<!DOCTYPE html>
<html>
<head>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background: transparent;
        }
        .header {
            display: flex;
            align-items: center;
            padding: 6px 8px;
            cursor: pointer;
            user-select: none;
        }
        .header:hover {
            background: var(--vscode-list-hoverBackground);
        }
        .collapse-icon {
            width: 16px;
            font-size: 10px;
            color: var(--vscode-foreground);
            transition: transform 0.15s;
        }
        .collapse-icon.collapsed {
            transform: rotate(-90deg);
        }
        .header-text {
            flex: 1;
            font-weight: 500;
            margin-left: 4px;
        }
        .header-stats {
            margin-right: 8px;
        }
        .header-actions {
            display: flex;
            gap: 4px;
        }
        .btn {
            padding: 3px 10px;
            border: none;
            border-radius: 3px;
            font-size: 11px;
            cursor: pointer;
            font-weight: 500;
            display: flex;
            align-items: center;
            gap: 4px;
        }
        .btn-icon-inline {
            font-size: 12px;
        }
        .keep-btn {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        .keep-btn:hover {
            background: var(--vscode-button-hoverBackground);
        }
        .undo-btn {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        .undo-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        .file-list {
            overflow: hidden;
        }
        .file-list.collapsed {
            display: none;
        }
        .file-row {
            display: flex;
            align-items: center;
            padding: 4px 8px 4px 24px;
            cursor: pointer;
        }
        .file-row:hover {
            background: var(--vscode-list-hoverBackground);
        }
        .file-row:hover .file-actions {
            opacity: 1;
        }
        .file-icon {
            width: 16px;
            height: 16px;
            margin-right: 6px;
            border-radius: 3px;
            flex-shrink: 0;
        }
        .file-icon.modified {
            background: var(--vscode-gitDecoration-modifiedResourceForeground, #E2C08D);
        }
        .file-icon.added {
            background: var(--vscode-gitDecoration-addedResourceForeground, #81B88B);
        }
        .file-icon.deleted {
            background: var(--vscode-gitDecoration-deletedResourceForeground, #C74E39);
        }
        .file-info {
            flex: 1;
            display: flex;
            align-items: center;
            min-width: 0;
            overflow: hidden;
        }
        .file-name {
            font-weight: 500;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .file-path {
            color: var(--vscode-descriptionForeground);
            margin-left: 6px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            font-size: 0.9em;
        }
        .file-stats {
            display: flex;
            gap: 4px;
            margin-left: 8px;
            font-size: 12px;
            font-family: var(--vscode-editor-font-family), monospace;
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
            margin-left: 8px;
            opacity: 0;
            transition: opacity 0.1s;
        }
        .btn-icon {
            width: 20px;
            height: 20px;
            border: none;
            background: transparent;
            color: var(--vscode-foreground);
            cursor: pointer;
            border-radius: 3px;
            font-size: 12px;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .btn-icon:hover {
            background: var(--vscode-toolbar-hoverBackground);
        }
        .empty-state {
            padding: 20px;
            text-align: center;
            color: var(--vscode-descriptionForeground);
            font-style: italic;
        }
    </style>
</head>
<body>
    ${headerContent}
    <script>
        const vscode = acquireVsCodeApi();
        const changes = ${JSON.stringify(changes.map(c => ({
            uri: c.uri.fsPath,
            relativePath: c.relativePath,
            changeType: c.changeType
        })))};

        function toggleCollapse() {
            const icon = document.getElementById('collapseIcon');
            const list = document.getElementById('fileList');
            if (icon && list) {
                icon.classList.toggle('collapsed');
                list.classList.toggle('collapsed');
            }
        }

        function showDiff(index) {
            vscode.postMessage({ type: 'showDiff', change: changes[index] });
        }

        function acceptFile(index) {
            vscode.postMessage({ type: 'accept', change: changes[index] });
        }

        function discardFile(index) {
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

    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }
}

// Keep the old tree provider for other views (explorer, scm)
export class ChangedFileItem extends vscode.TreeItem {
    constructor(public readonly change: FileChange) {
        const fileName = path.basename(change.relativePath);
        super(fileName, vscode.TreeItemCollapsibleState.None);
        
        this.resourceUri = change.uri;
        this.contextValue = 'changedFile';
        this.description = path.dirname(change.relativePath);
        
        if (change.changeType !== 'deleted') {
            this.command = {
                command: 'pendingChanges.showDiff',
                title: 'Show Diff',
                arguments: [this]
            };
        }
    }
}

export class SummaryItem extends vscode.TreeItem {
    constructor(fileCount: number, additions: number, deletions: number) {
        super(`${fileCount} files changed`, vscode.TreeItemCollapsibleState.Expanded);
        this.contextValue = 'summary';
        this.description = `+${additions} -${deletions}`;
    }
}

export class PendingChangesTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    private cachedChanges: FileChange[] = [];
    private refreshTimer: NodeJS.Timeout | undefined;

    constructor(private snapshotManager: SnapshotManager) {
        snapshotManager.onSnapshotsChanged(() => this.scheduleRefresh());
        vscode.workspace.onDidChangeTextDocument(() => this.scheduleRefresh());
        vscode.workspace.onDidSaveTextDocument(() => this.scheduleRefresh());
    }

    private scheduleRefresh(): void {
        if (this.refreshTimer) clearTimeout(this.refreshTimer);
        this.refreshTimer = setTimeout(() => this.refresh(), 300);
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
        if (element instanceof SummaryItem) {
            return this.cachedChanges.map(c => new ChangedFileItem(c));
        }
        if (element) return [];

        const changes = await this.snapshotManager.getChangedFiles();
        this.cachedChanges = changes;
        if (changes.length === 0) return [];

        const totalAdd = changes.reduce((s, c) => s + c.additions, 0);
        const totalDel = changes.reduce((s, c) => s + c.deletions, 0);
        return [new SummaryItem(changes.length, totalAdd, totalDel)];
    }

    getParent(): vscode.ProviderResult<vscode.TreeItem> {
        return null;
    }
}
