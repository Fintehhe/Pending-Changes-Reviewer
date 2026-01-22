import * as vscode from 'vscode';
import { SnapshotManager } from './snapshotManager';
import { FileWatcher } from './fileWatcher';
import { PendingChangesWebviewProvider, PendingChangesTreeProvider, ChangedFileItem, SummaryItem } from './treeViewProvider';
import { DiffViewer } from './diffViewer';

let snapshotManager: SnapshotManager;
let fileWatcher: FileWatcher;
let treeProvider: PendingChangesTreeProvider;
let diffViewer: DiffViewer;
let statusBarItem: vscode.StatusBarItem;
let sidebarProvider: PendingChangesWebviewProvider;

export function activate(context: vscode.ExtensionContext) {
    console.log('Pending Changes Reviewer: Activating...');

    try {
        // Initialize managers
        snapshotManager = new SnapshotManager();
        fileWatcher = new FileWatcher(snapshotManager);
        treeProvider = new PendingChangesTreeProvider(snapshotManager);
        diffViewer = new DiffViewer();
        
        // Create webview provider for sidebar (Copilot-style UI)
        sidebarProvider = new PendingChangesWebviewProvider(context.extensionUri, snapshotManager);

        // Register webview for Activity Bar sidebar
        context.subscriptions.push(
            vscode.window.registerWebviewViewProvider(
                PendingChangesWebviewProvider.viewType,
                sidebarProvider
            )
        );

        // Create status bar item (just shows count)
        statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            100
        );
        updateStatusBar(0);
        statusBarItem.show();

        // Update status bar and sidebar when snapshots change
        snapshotManager.onSnapshotsChanged(async () => {
            const changes = await snapshotManager.getChangedFiles();
            updateStatusBar(changes.length);
        });

        // Register commands
        context.subscriptions.push(
            vscode.commands.registerCommand('pendingChanges.snapshotFile', snapshotCurrentFile)
        );
        context.subscriptions.push(
            vscode.commands.registerCommand('pendingChanges.snapshotAll', snapshotAllOpenFiles)
        );
        context.subscriptions.push(
            vscode.commands.registerCommand('pendingChanges.acceptFile', acceptFile)
        );
        context.subscriptions.push(
            vscode.commands.registerCommand('pendingChanges.discardFile', discardFile)
        );
        context.subscriptions.push(
            vscode.commands.registerCommand('pendingChanges.acceptAll', acceptAllFiles)
        );
        context.subscriptions.push(
            vscode.commands.registerCommand('pendingChanges.discardAll', discardAllFiles)
        );
        context.subscriptions.push(
            vscode.commands.registerCommand('pendingChanges.showDiff', showDiff)
        );
        context.subscriptions.push(
            vscode.commands.registerCommand('pendingChanges.refresh', refresh)
        );
        context.subscriptions.push(
            vscode.commands.registerCommand('pendingChanges.openInPanel', openInPanel)
        );

        // Add disposables
        context.subscriptions.push(
            statusBarItem,
            fileWatcher,
            diffViewer
        );

        // AUTO-START tracking immediately
        fileWatcher.startTracking();
        
        console.log('Pending Changes Reviewer: Activated successfully!');
    } catch (error) {
        console.error('Pending Changes Reviewer: Activation failed!', error);
        vscode.window.showErrorMessage(`Pending Changes Reviewer failed to activate: ${error}`);
    }
}

function updateStatusBar(changeCount: number): void {
    if (changeCount > 0) {
        statusBarItem.text = `$(git-compare) ${changeCount} pending`;
        statusBarItem.tooltip = `${changeCount} file(s) with pending changes\nClick to open panel`;
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        statusBarItem.command = 'pendingChanges.openInPanel';
    } else {
        statusBarItem.text = '$(git-compare) No changes';
        statusBarItem.tooltip = 'No pending changes';
        statusBarItem.backgroundColor = undefined;
        statusBarItem.command = undefined;
    }
}

function openInPanel(): void {
    vscode.commands.executeCommand('workbench.view.extension.pending-changes-panel');
}

async function snapshotCurrentFile(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No active file to snapshot');
        return;
    }

    await snapshotManager.snapshotFile(editor.document.uri);
    treeProvider.refresh();
    vscode.window.showInformationMessage(`Snapshot saved: ${editor.document.fileName}`);
}

async function snapshotAllOpenFiles(): Promise<void> {
    const count = await snapshotManager.snapshotAllOpenFiles();
    treeProvider.refresh();
    vscode.window.showInformationMessage(`Snapshots saved: ${count} files`);
}

async function acceptFile(item?: ChangedFileItem | { change: any }): Promise<void> {
    // Handle both TreeItem and webview message formats
    let uri: vscode.Uri | undefined;
    
    if (item && 'change' in item) {
        if (item instanceof ChangedFileItem) {
            // TreeItem from tree view
            uri = item.change.uri;
        } else if (item.change && item.change.uri) {
            // From webview - uri is a string path
            uri = vscode.Uri.file(item.change.uri);
        }
    }
    
    if (!uri) {
        // Show quick pick - get changes directly from snapshot manager
        const changes = await snapshotManager.getChangedFiles();
        if (changes.length === 0) {
            vscode.window.showInformationMessage('No pending changes');
            return;
        }
        const selected = await vscode.window.showQuickPick(
            changes.map(c => ({
                label: c.relativePath,
                description: `${c.changeType} +${c.additions} -${c.deletions}`,
                uri: c.uri
            })),
            { placeHolder: 'Select file to accept changes' }
        );
        if (!selected) return;
        uri = selected.uri;
    }

    if (uri) {
        // Pass callback to update file watcher cache
        await snapshotManager.acceptAndUpdateBaseline(uri, (u, content) => {
            fileWatcher.updateFileCache(u, content);
        });
        treeProvider.refresh();
        sidebarProvider.refresh();
    }
}

async function discardFile(item?: ChangedFileItem | { change: any }): Promise<void> {
    let uri: vscode.Uri | undefined;
    let relativePath: string = '';
    let changeType: string = 'modified';
    
    if (item && 'change' in item) {
        if (item instanceof ChangedFileItem) {
            // TreeItem from tree view
            uri = item.change.uri;
            relativePath = item.change.relativePath;
            changeType = item.change.changeType;
        } else if (item.change && item.change.uri) {
            // From webview - uri is a string path
            uri = vscode.Uri.file(item.change.uri);
            relativePath = item.change.relativePath || '';
            changeType = item.change.changeType || 'modified';
        }
    }
    
    if (!uri) {
        const changes = await snapshotManager.getChangedFiles();
        if (changes.length === 0) {
            vscode.window.showInformationMessage('No pending changes');
            return;
        }
        const selected = await vscode.window.showQuickPick(
            changes.map(c => ({
                label: c.relativePath,
                description: `${c.changeType} +${c.additions} -${c.deletions}`,
                uri: c.uri,
                relativePath: c.relativePath,
                changeType: c.changeType
            })),
            { placeHolder: 'Select file to discard changes' }
        );
        if (!selected) return;
        uri = selected.uri;
        relativePath = selected.relativePath;
        changeType = selected.changeType;
    }

    if (!uri) return;

    let confirmMessage = `Revert ${relativePath}?`;
    if (changeType === 'created') {
        confirmMessage = `Delete new file ${relativePath}?`;
    } else if (changeType === 'deleted') {
        confirmMessage = `Restore deleted file ${relativePath}?`;
    }

    const confirm = await vscode.window.showWarningMessage(
        confirmMessage,
        { modal: true },
        'Yes'
    );

    if (confirm === 'Yes') {
        const success = await snapshotManager.revertFile(uri);
        treeProvider.refresh();
        sidebarProvider.refresh();
        
        if (!success) {
            vscode.window.showErrorMessage(`Failed to revert: ${relativePath}`);
        }
    }
}

async function acceptAllFiles(): Promise<void> {
    const changes = await snapshotManager.getChangedFiles();
    if (changes.length === 0) {
        vscode.window.showInformationMessage('No pending changes');
        return;
    }

    const confirm = await vscode.window.showWarningMessage(
        `Accept all changes in ${changes.length} files?`,
        { modal: true },
        'Accept All'
    );

    if (confirm === 'Accept All') {
        for (const change of changes) {
            await snapshotManager.acceptAndUpdateBaseline(change.uri, (u, content) => {
                fileWatcher.updateFileCache(u, content);
            });
        }
        treeProvider.refresh();
        sidebarProvider.refresh();
    }
}

async function discardAllFiles(): Promise<void> {
    const changes = await snapshotManager.getChangedFiles();
    if (changes.length === 0) {
        vscode.window.showInformationMessage('No pending changes');
        return;
    }

    const confirm = await vscode.window.showWarningMessage(
        `Revert all ${changes.length} files? This cannot be undone.`,
        { modal: true },
        'Revert All'
    );

    if (confirm === 'Revert All') {
        for (const change of changes) {
            await snapshotManager.revertFile(change.uri);
        }
        treeProvider.refresh();
        sidebarProvider.refresh();
    }
}

async function showDiff(item?: ChangedFileItem | { change: any }): Promise<void> {
    let change: any;
    
    if (item && 'change' in item && !(item instanceof ChangedFileItem)) {
        // From webview - need to get full change object
        const changes = await snapshotManager.getChangedFiles();
        change = changes.find(c => c.uri.fsPath === item.change.uri);
    } else if (item && item instanceof ChangedFileItem) {
        change = item.change;
    } else {
        const changes = await snapshotManager.getChangedFiles();
        if (changes.length === 0) {
            vscode.window.showInformationMessage('No pending changes');
            return;
        }
        const selected = await vscode.window.showQuickPick(
            changes.map(c => ({
                label: c.relativePath,
                description: `${c.changeType} +${c.additions} -${c.deletions}`,
                change: c
            })),
            { placeHolder: 'Select file to view diff' }
        );
        if (!selected) return;
        change = selected.change;
    }

    if (change) {
        await diffViewer.showDiff(change);
    }
}

function refresh(): void {
    treeProvider.refresh();
    sidebarProvider.refresh();
}

export function deactivate() {
    // Cleanup is handled by disposables
}
