# PRD — Android Tablet Code Workspace

## 1. Product Overview

### Product Name
Working name: **Code Workspace**

### Product Type
A lightweight, tablet-first Android code editor and project workspace inspired by the useful parts of VS Code.

### Product Vision
Provide a focused coding environment for Android tablets that lets users browse, read, edit, search, format, and manage code projects without attempting to reproduce the full VS Code ecosystem.

The application is a **workspace/editor**, not a complete execution environment.

Code execution and development tooling such as Node.js, npm, Python, Vite, Vitest, and other command-line tools can remain in external environments such as Termux.

### Core Principle

> Build the useful parts of VS Code for a tablet, not VS Code itself.

---

# 2. Goals

## Primary Goals

1. Provide a professional code editing experience on Android tablets.
2. Provide a VS Code-like project/file explorer.
3. Provide multi-tab code editing.
4. Provide syntax highlighting.
5. Provide project-wide search.
6. Provide find and replace.
7. Provide file formatting.
8. Provide Git integration and visual Git changes.
9. Provide Git diff, staging, commits, branches, pull and push workflows.
10. Provide basic code navigation without implementing full language intelligence.
11. Provide a tablet-first interface optimized for landscape use.
12. Support keyboard and touch interaction.
13. Keep the application lightweight and focused.
14. Allow optional integration with Termux for command execution.

## Secondary Goals

1. Markdown preview.
2. Recent projects.
3. Command palette.
4. Split editor.
5. Multiple cursors.
6. File rename, duplicate, move and delete.
7. ZIP import/export.
8. Android share/open-with integration.

---

# 3. Non-Goals

The following are explicitly outside the initial product scope.

## Not Building

- VS Code extension compatibility
- Extension marketplace
- Plugin ecosystem
- Debugger
- Full IDE debugging
- Language Server Protocol
- IntelliSense/autocomplete
- Inline diagnostics
- Problems panel based on language servers
- Full compiler toolchains
- Built-in Node.js runtime
- Built-in Python runtime
- Built-in terminal emulator
- Docker environment
- Remote SSH development
- Remote development containers
- Desktop VS Code compatibility
- VS Code settings compatibility

The application should not become a general-purpose desktop IDE clone.

---

# 4. Target Users

## Primary Users

- Developers who use Android tablets for coding.
- Developers who need to inspect or make quick changes to projects.
- Developers using a tablet with an external keyboard.
- Students learning programming.
- Developers who want a lightweight mobile code workspace.
- Users who already have a separate execution environment such as Termux.

## Secondary Users

- Users reviewing Git repositories.
- Users inspecting source code.
- Users editing configuration files.
- Users working with HTML/CSS/JavaScript projects.
- Users working with Markdown, JSON and other text-based project files.

---

# 5. Target Device

## Primary Device

Android tablets.

Recommended target range:

- 10–13 inch displays
- Landscape orientation
- Hardware keyboard support
- Touch support
- High-resolution displays

## Secondary Support

Portrait mode should remain usable, but landscape is the primary design target.

The application must not simply scale a phone UI onto a tablet.

---

# 6. Product UX

## Primary Layout

Landscape tablet layout:

```text
┌──────────────────────────────────────────────────────────────┐
│ Code Workspace    project-name        Search     ⋮           │
├────────────┬─────────────────────┬───────────────────────────┤
│            │ App.vue  api.js  +   │                           │
│ EXPLORER   ├─────────────────────┤                           │
│            │                     │        CODE EDITOR         │
│ ▼ project │    OPEN FILES       │                           │
│   ▼ src   │                     │  1 │ import ...            │
│     ...   │    App.vue          │  2 │                       │
│           │    api.js           │  3 │ const ...              │
│ package   │    widget.js        │  4 │                       │
│ README    │                     │                           │
├───────────┴─────────────────────┴───────────────────────────┤
│ Explorer     Search     Source Control     Terminal     More │
└──────────────────────────────────────────────────────────────┘
```

The layout should support adjustable panel widths.

---

# 7. Core Features

## 7.1 Project Workspace

### Requirements

Users must be able to:

- Open a folder/project.
- Browse directories.
- Open files.
- Create files.
- Create folders.
- Rename files.
- Rename folders.
- Move files.
- Delete files.
- Duplicate files.
- Copy file path.
- View recent projects.
- Reopen the last project.

### Project Tree

The explorer should support:

- Expand/collapse folders.
- File type icons.
- Modified-file indicators.
- Git status indicators.
- Context menus.
- Long-press actions.
- Drag and drop where Android supports it.

---

# 8. Code Editor

## Required

- Multi-line editing.
- Cursor movement.
- Text selection.
- Copy/paste.
- Undo/redo.
- Line numbers.
- Horizontal scrolling.
- Vertical scrolling.
- Syntax highlighting.
- Auto indentation.
- Bracket matching.
- Current-line highlighting.
- Tab support.
- Dirty-file indicator.
- Save.
- Save all.
- Close tab.
- Reopen closed tab.
- Multiple open files.

## Languages

Initial syntax support should prioritize:

- JavaScript
- TypeScript
- HTML
- CSS
- JSON
- Markdown
- XML
- YAML
- Bash
- Python
- Java
- C/C++
- SQL

Language support can expand independently.

## Explicitly Not Required

- Autocomplete
- IntelliSense
- LSP
- Inline diagnostics
- Error squiggles
- Semantic code analysis

---

# 9. Tabs

The editor must support multiple tabs.

Example:

```text
┌────────────────────────────────────────────┐
│ App.vue │ Dashboard.vue │ api.js │ +       │
└────────────────────────────────────────────┘
```

Requirements:

- Open file in tab.
- Switch tabs.
- Close tab.
- Close other tabs.
- Close tabs to the right.
- Reorder tabs.
- Dirty state indicator.
- Restore tabs after reopening project.

---

# 10. Search

## File Search

Provide quick-open style search:

```text
> Dashboard.vue
```

Results should appear immediately.

## Project Search

Search text across the entire project.

Example:

```text
Search: DashboardGrid
```

Results:

```text
src/components/DashboardGrid.vue
42: DashboardGrid

src/views/ProjectDashboard.vue
18: DashboardGrid
```

Selecting a result must open the file and navigate to the matching line.

## Find and Replace

Support:

- Find in current file.
- Replace current match.
- Replace all.
- Find in project.
- Replace in project.

Future options:

- Case sensitive.
- Whole word.
- Regular expression.

---

# 11. Code Navigation

Keep navigation intentionally lightweight.

## Required

- Go to line.
- Go to file.
- Go to symbol.
- Breadcrumbs.
- File outline where practical.
- Back/forward navigation.

## Not Required

- Go to definition through LSP.
- Find references through language servers.
- Rename symbols semantically.

File-level and lightweight syntax-based navigation is sufficient for the initial product.

---

# 12. Formatting

The application must support code formatting.

## Required

- Format document.
- Format selection where supported.
- Format on save.
- Configurable formatter settings.

Initial priority:

- JavaScript
- TypeScript
- JSON
- HTML
- CSS
- Markdown

The architecture should allow additional formatters later.

Formatting must not require autocomplete or LSP.

---

# 13. Git Integration

Git is a first-class product feature.

## Repository Detection

When a project contains a Git repository, the app should detect it automatically.

## Source Control View

Example:

```text
SOURCE CONTROL

CHANGES · 4

 M src/App.vue
 M src/components/Grid.vue
 M src/services/api.js
 ? src/test/foo.test.js

STAGED · 2

 ✓ package.json
 ✓ README.md

Commit message

[ Commit ]
```

## Required Git Features

- Repository status.
- Changed files.
- Untracked files.
- Staged files.
- Unstaged files.
- File diff.
- Stage file.
- Unstage file.
- Stage all.
- Unstage all.
- Commit.
- Commit and push.
- Pull.
- Push.
- Branch list.
- Checkout branch.
- Create branch.
- Delete branch.
- Remote information.
- Commit history.

## Diff Viewer

The diff viewer must clearly distinguish:

- Added lines.
- Removed lines.
- Modified sections.

The user must be able to open the affected file from the diff.

## Future Git Features

- Merge.
- Rebase.
- Stash.
- Conflict resolution UI.
- Commit comparison.

---

# 14. Markdown

Provide a Markdown preview.

Supported behavior:

```text
README.md
      ↓
[Edit] [Preview]
```

Preview should support:

- Headings.
- Lists.
- Links.
- Code blocks.
- Tables.
- Images where accessible.
- Basic formatting.

---

# 15. Command Palette

Provide a command palette for keyboard users.

Example:

```text
> Type a command...

Format Document
Find in Files
Go to File
Go to Symbol
Toggle Explorer
Toggle Source Control
Git: Commit
Git: Pull
Git: Push
Open in Termux
```

The command palette should provide access to actions without requiring toolbar buttons for everything.

---

# 16. Keyboard Support

External keyboards are a major tablet use case.

Initial shortcuts:

```text
Ctrl + S              Save
Ctrl + Shift + S      Save As
Ctrl + P              Quick Open
Ctrl + F              Find
Ctrl + H              Replace
Ctrl + Shift + F      Search in Files
Ctrl + W              Close Tab
Ctrl + Tab            Next Tab
Ctrl + Shift + Tab    Previous Tab
Ctrl + Z              Undo
Ctrl + Shift + Z      Redo
Ctrl + A              Select All
Ctrl + C              Copy
Ctrl + X              Cut
Ctrl + V              Paste
Ctrl + Shift + P      Command Palette
```

Shortcut mappings must be configurable later.

---

# 17. Touch Interaction

The application must remain fully usable without a keyboard.

Support:

- Tap to open.
- Long press for context actions.
- Text selection handles.
- Touch scrolling.
- Pinch/zoom where appropriate.
- Context menus.
- Drag and drop for supported operations.
- Touch-friendly toolbar controls.

Touch controls must not interfere with normal text selection and cursor movement.

---

# 18. Split Editor

Future v1 feature.

Example:

```text
┌───────────────────────┬──────────────────────────┐
│ App.vue               │ api.js                   │
│                       │                          │
│ template              │ API methods              │
│                       │                          │
└───────────────────────┴──────────────────────────┘
```

Requirements:

- Horizontal split.
- Vertical split.
- Move tab between groups.
- Close editor group.

---

# 19. Termux Integration

Termux is an optional execution environment.

The app must not require Termux for basic operation.

## Responsibility Split

### Our application

- Project UI
- File browsing
- Editing
- Search
- Formatting
- Git UI
- Diff UI
- Workspace management

### Termux

- Node.js
- npm
- Vite
- Vitest
- Python
- Shell commands
- Other CLI tools
- Application execution

## Integration

The app should eventually provide:

```text
Open in Termux
Run Command
Run Project Script
```

The integration should open Termux in the current project directory or invoke supported commands through a safe, well-defined interface.

The app must remain functional when Termux is not installed.

---

# 20. Android File System

The application should use Android-supported storage mechanisms.

Requirements:

- Storage Access Framework support.
- User-selected folders.
- Persistent access where Android permits it.
- Recent locations.
- Project-level permissions.
- Safe file operations.
- Graceful handling of inaccessible files.
- External storage support.

The app must not assume unrestricted access to the Android filesystem.

---

# 21. Project Types

The application should remain project-agnostic.

Examples:

```text
JavaScript project
TypeScript project
Vue project
React project
Angular project
HTML project
Python project
Java project
C/C++ project
Markdown project
Plain text project
```

The application should not require a specific framework.

---

# 22. Architecture

A candidate architecture:

```text
Android Application
│
├── Workspace Layer
│   ├── Projects
│   ├── Recent projects
│   └── Workspace state
│
├── File System Layer
│   ├── File tree
│   ├── File operations
│   └── Android Storage Access Framework
│
├── Editor Layer
│   ├── Text model
│   ├── Syntax highlighting
│   ├── Tabs
│   ├── Search
│   └── Formatting
│
├── Git Layer
│   ├── Status
│   ├── Diff
│   ├── Staging
│   ├── Commit
│   └── Branches
│
├── Preview Layer
│   └── Markdown
│
└── Integration Layer
    └── Optional Termux integration
```

The exact editor technology should be evaluated before implementation.

Candidate approaches:

1. Native Android editor.
2. CodeMirror embedded through WebView.
3. Another lightweight embedded code-editor engine.

The final choice must prioritize:

- Editing quality.
- Tablet performance.
- Memory usage.
- APK size.
- Touch support.
- Keyboard support.
- Syntax highlighting.
- Maintainability.

---

# 23. Performance Requirements

The application should feel responsive on modern Android tablets.

Targets:

- App startup should feel immediate.
- File tree should remain responsive for large projects.
- Opening normal source files should be near-instant.
- Search should not freeze the UI.
- Git status should run asynchronously.
- Large files should not crash the application.
- UI operations must not block the main thread.

Large repositories should be handled through lazy loading where possible.

---

# 24. Security

The application must:

- Respect Android storage permissions.
- Avoid unnecessary permissions.
- Never upload project source code without explicit user action.
- Keep Git credentials secure.
- Avoid logging source-code contents.
- Avoid sending repository contents to external services by default.
- Clearly communicate any external integrations.

No cloud backend is required for the initial product.

---

# 25. Offline First

The core application must work offline.

Offline functionality:

- Browse projects.
- Open files.
- Edit files.
- Save files.
- Search.
- Format where local formatter is available.
- View Git changes.
- Create local commits.
- View history.

Network is only required for operations such as:

- Git push.
- Git pull.
- Remote repository operations.
- Optional external integrations.

---

# 26. UX Principles

## Minimal

Avoid desktop IDE clutter.

## Fast

Opening a project and a file should require minimal interaction.

## Tablet First

Landscape is the primary experience.

## Keyboard Friendly

The application should be comfortable with a hardware keyboard.

## Touch Friendly

The application must remain usable with touch alone.

## Predictable

Common actions should behave similarly to established code editors.

## No Feature Bloat

Do not add features simply because VS Code has them.

---

# 27. MVP

## Version 0.1

The first release should contain only:

### Workspace
- Open folder.
- Recent projects.
- Project explorer.

### Files
- Open.
- Create.
- Rename.
- Delete.
- Move.
- Save.

### Editor
- Tabs.
- Syntax highlighting.
- Line numbers.
- Selection.
- Undo/redo.
- Search.
- Find/replace.

### Formatting
- Format document.
- Format on save for supported formats.

### Git
- Detect repository.
- Show changes.
- Diff.
- Stage.
- Unstage.
- Commit.
- Branch list.

### Tablet UX
- Landscape layout.
- Keyboard shortcuts.
- Touch support.
- Resizable explorer.

### Integration
- Open current project in Termux.

---

# 28. Version 0.2

Add:

- Command palette.
- Go to file.
- Go to line.
- Go to symbol.
- Markdown preview.
- Commit history.
- Pull/push.
- Branch creation.
- Branch checkout.
- Split editor.
- Multiple cursors.
- Better Git diff.

---

# 29. Version 0.3

Add:

- Merge conflict viewer.
- Stash.
- Rebase UI where practical.
- Improved project indexing.
- Advanced search.
- More formatters.
- Workspace persistence.
- Improved Termux command integration.
- Performance optimizations for very large repositories.

---

# 30. Explicitly Deferred

These should not enter the roadmap unless the product direction changes:

- Autocomplete.
- IntelliSense.
- LSP.
- Diagnostics.
- Debugger.
- Extensions.
- Plugins.
- Marketplace.
- Docker.
- SSH development.
- Remote containers.
- Cloud IDE backend.

---

# 31. Success Criteria

The MVP is successful if a developer can:

1. Open an existing project on an Android tablet.
2. Navigate its complete file structure.
3. Open multiple files.
4. Edit code comfortably with touch or keyboard.
5. Search across the project.
6. Format source files.
7. See exactly what changed in Git.
8. Review a diff.
9. Stage files.
10. Commit changes.
11. Switch branches.
12. Open the same project in Termux.
13. Run Node/npm/Vite/Vitest or another CLI tool through Termux.
14. Return to the Android editor and continue working.

The experience should feel like a focused development workspace rather than a compromised desktop IDE.

---

# 32. Product Definition

The final product can be summarized as:

> **A lightweight, tablet-first Android code workspace for browsing, editing, searching, formatting, and managing Git repositories, with optional Termux integration for running development tools.**

It intentionally excludes the complexity of a full IDE—debuggers, extensions, LSP, autocomplete, diagnostics, and plugin ecosystems—in order to provide a fast, focused and maintainable coding experience on Android tablets.
