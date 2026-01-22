# Changelog

All notable changes to the "Pending Changes Reviewer" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.9] - 2025-01-22

### Changed
- Clean panel title ("Pending Changes Reviewer" without duplicate text)
- Removed toolbar buttons from VS Code panel header
- Added icons (✓ ↺) to Keep/Undo buttons in the content area

## [1.0.8] - 2025-01-22

### Changed
- Completely redesigned UI using WebView for Copilot-style appearance
- Colored diff stats (green for additions, red for deletions)
- Right-aligned stats layout
- Hover action buttons on file rows

## [1.0.7] - 2025-01-22

### Changed
- Improved file list UI layout
- Better visual hierarchy

## [1.0.6] - 2025-01-22

### Fixed
- Accept button on inline items now works correctly
- Baseline properly updates after accepting changes

## [1.0.5] - 2025-01-22

### Added
- Font customization settings (fontSize, fontFamily, lineHeight)
- Multiple view locations (Activity Bar, Explorer, SCM, Bottom Panel)

## [1.0.4] - 2025-01-22

### Changed
- Automatic tracking on startup (removed start/stop buttons)
- Accepting changes now resets the baseline for future tracking

## [1.0.3] - 2025-01-22

### Added
- Auto-snapshot when files are modified
- Track newly created files
- Track deleted files with restore capability

## [1.0.2] - 2025-01-22

### Fixed
- "Command not found" errors on activation
- Removed external dependencies for better reliability

## [1.0.1] - 2025-01-22

### Fixed
- Extension activation issues
- Activity bar icon display

## [1.0.0] - 2025-01-22

### Added
- Initial release
- File snapshot functionality
- Change tracking and diff view
- Accept/Revert actions
- Status bar indicator
