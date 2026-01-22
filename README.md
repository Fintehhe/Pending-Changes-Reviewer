# Pending Changes Reviewer

A VS Code extension that automatically tracks file changes and lets you review, accept, or revert them — perfect for reviewing AI-generated code changes from tools like Claude Code, GitHub Copilot, or Cursor.

![VS Code](https://img.shields.io/badge/VS%20Code-Extension-blue?logo=visualstudiocode)
![Version](https://img.shields.io/badge/version-1.0.9-green)
![License](https://img.shields.io/badge/license-MIT-blue)

## Features

### 🔄 Automatic Change Tracking
- **Auto-tracks file modifications** — No manual setup required
- **Tracks new files** — Files created by AI are marked as `[NEW]`
- **Tracks deleted files** — Deleted files can be restored
- **Smart baseline updates** — After accepting changes, only new modifications are shown

### 👀 Copilot-Style UI
- **Colored diff stats** — Green for additions, red for deletions
- **Collapsible file list** — Click header to expand/collapse
- **Hover actions** — Accept (✓) and Undo (↺) buttons appear on hover
- **Side-by-side diff view** — Click any file to see the full diff

### ⚡ Quick Actions
- **Keep** — Accept changes (updates baseline for future tracking)
- **Undo** — Revert file to its original state
- **Keep All / Undo All** — Bulk actions for all pending changes

## Screenshot

```
▼ 3 files changed                    +45 -12    [✓ Keep] [↺ Undo]
  █ AuthService.swift    Services           +23 -8      ✓ ↺
  █ UserModel.swift      Models             +15 -4      ✓ ↺  
  █ Config.json          Resources           +7 -0      ✓ ↺
```

## Installation

### From VSIX File
1. Download the latest `.vsix` file from [Releases](../../releases)
2. In VS Code, press `Ctrl+Shift+P` → "Extensions: Install from VSIX..."
3. Select the downloaded file
4. Reload VS Code

### From Source
```bash
git clone https://github.com/YOUR_USERNAME/pending-changes-reviewer.git
cd pending-changes-reviewer
npm install
npm run compile
npx @vscode/vsce package
code --install-extension pending-changes-reviewer-1.0.9.vsix
```

## Usage

### Basic Workflow

1. **Open your project** in VS Code
2. **Let AI make changes** (Claude Code, Copilot, etc.)
3. **Open the Pending Changes panel** (click the icon in the Activity Bar)
4. **Review changes** — Click any file to see the diff
5. **Accept or Revert** — Use Keep/Undo buttons

### Actions Explained

| File State | Keep | Undo |
|------------|------|------|
| Modified | Accept changes, update baseline | Revert to original content |
| New (created) | Keep the new file | Delete the file |
| Deleted | Confirm deletion | Restore the file |

### Keyboard Shortcuts

The extension doesn't define default shortcuts, but you can add your own in VS Code's keyboard settings:

- `pendingChanges.acceptAll` — Accept all changes
- `pendingChanges.discardAll` — Revert all changes
- `pendingChanges.showDiff` — Show diff for selected file

## Configuration

Open Settings (`Ctrl+,`) and search for "Pending Changes":

| Setting | Default | Description |
|---------|---------|-------------|
| `pendingChanges.watchPatterns` | `["**/*.{js,ts,py,...}"]` | File patterns to watch |
| `pendingChanges.excludePatterns` | `["**/node_modules/**", ...]` | Patterns to exclude |
| `pendingChanges.fontSize` | `13` | Font size in the panel (8-24) |
| `pendingChanges.fontFamily` | `""` | Font family (empty = VS Code default) |
| `pendingChanges.lineHeight` | `22` | Line height in pixels (16-40) |

### Default Watch Patterns
```
js, ts, jsx, tsx, py, java, cpp, c, h, hpp, cs, go, rs, rb, 
php, swift, kt, scala, vue, svelte, html, css, scss, sass, 
less, json, yaml, yml, xml, md, txt
```

### Default Exclude Patterns
```
**/node_modules/**
**/.git/**
**/dist/**
**/build/**
**/.next/**
**/out/**
**/__pycache__/**
**/.venv/**
**/venv/**
```

## How It Works

1. **On VS Code startup**, the extension begins watching your workspace
2. **When a file is modified**, the original content is cached as a snapshot
3. **Changes are tracked** by comparing current content against the snapshot
4. **Accepting changes** updates the snapshot to the current content
5. **Reverting changes** restores the file to the snapshot content

### Technical Details

- Uses VS Code's `FileSystemWatcher` API for file monitoring
- Snapshots are stored in memory (not persisted across VS Code restarts)
- Uses a WebView for the custom UI (enables colored stats and hover buttons)
- Zero external runtime dependencies

## Requirements

- VS Code 1.85.0 or higher

## Known Limitations

- Snapshots are stored in memory only — lost when VS Code restarts
- Binary files are not supported
- Very large files may impact performance

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Development

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Watch for changes
npm run watch

# Package extension
npx @vscode/vsce package --allow-missing-repository --allow-star-activation
```

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Changelog

### 1.0.9
- Clean panel title ("Pending Changes Reviewer")
- Removed toolbar buttons (Keep/Undo in content area only)
- Added icons to Keep/Undo buttons

### 1.0.8
- Switched to WebView-based UI for Copilot-style appearance
- Colored stats (green/red)
- Proper right-aligned layout
- Hover action buttons

### 1.0.7
- UI improvements
- Better file list layout

### 1.0.6
- Fixed accept button on inline items
- Fixed baseline update after accept

### 1.0.5
- Added font customization settings
- Multiple view locations

### 1.0.4
- Automatic tracking (no start/stop buttons)
- Accept resets baseline for future tracking

### 1.0.3
- Auto-snapshot on file modification
- Track new and deleted files

### 1.0.0
- Initial release
- Basic snapshot and diff functionality

## Credits

Created as a companion tool for AI coding assistants like [Claude Code](https://www.anthropic.com/claude).

---

**Enjoy reviewing your AI-generated code changes!** 🚀
