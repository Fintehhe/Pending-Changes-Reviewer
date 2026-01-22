import * as vscode from 'vscode';
import { SnapshotManager } from './snapshotManager';

export class ChangeStatsDecorationProvider implements vscode.FileDecorationProvider {
    private _onDidChangeFileDecorations = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
    readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;

    private statsCache: Map<string, { additions: number; deletions: number; changeType: string }> = new Map();

    constructor(private snapshotManager: SnapshotManager) {
        // Update decorations when snapshots change
        snapshotManager.onSnapshotsChanged(async () => {
            await this.updateCache();
            this._onDidChangeFileDecorations.fire(undefined);
        });

        // Initial cache update
        this.updateCache();
    }

    private async updateCache(): Promise<void> {
        this.statsCache.clear();
        const changes = await this.snapshotManager.getChangedFiles();
        
        for (const change of changes) {
            this.statsCache.set(change.uri.fsPath, {
                additions: change.additions,
                deletions: change.deletions,
                changeType: change.changeType
            });
        }
    }

    provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
        const stats = this.statsCache.get(uri.fsPath);
        if (!stats) {
            return undefined;
        }

        // Format like Copilot: +23 -8
        const badge = stats.changeType === 'created' ? '+' : 
                      stats.changeType === 'deleted' ? '-' : '~';
        
        // Color based on change type
        let color: vscode.ThemeColor;
        switch (stats.changeType) {
            case 'created':
                color = new vscode.ThemeColor('gitDecoration.addedResourceForeground');
                break;
            case 'deleted':
                color = new vscode.ThemeColor('gitDecoration.deletedResourceForeground');
                break;
            default:
                color = new vscode.ThemeColor('gitDecoration.modifiedResourceForeground');
        }

        return {
            badge,
            color,
            tooltip: `+${stats.additions} -${stats.deletions}`
        };
    }

    refresh(): void {
        this.updateCache().then(() => {
            this._onDidChangeFileDecorations.fire(undefined);
        });
    }
}
