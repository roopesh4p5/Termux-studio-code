// VS Code-style menu bar definitions. Items reference command ids from commands.js;
// `key` overrides the displayed shortcut for keys CodeMirror handles itself.
import { app } from './app.js';
import { menuAt } from './ui.js';
import { shortcutFor } from './commands.js';
import { settings } from './settings.js';

const MENUS = {
  File: () => [
    { cmd: 'newFile', label: 'New File…' },
    { cmd: 'newFolder', label: 'New Folder…' },
    '-',
    { cmd: 'openFolder', label: 'Open Folder…' },
    { cmd: 'openRecent', label: 'Open Recent…' },
    { cmd: 'gitClone', label: 'Clone Repository…' },
    '-',
    { cmd: 'save', label: 'Save' },
    { cmd: 'saveAs', label: 'Save As…' },
    { cmd: 'saveAll', label: 'Save All' },
    { cmd: 'toggleAutoSave', label: `${settings.autoSave ? '✓ ' : ''}Auto Save` },
    '-',
    { cmd: 'formatDocument', label: 'Format Document' },
    { cmd: 'toggleFormatOnSave', label: `${settings.formatOnSave ? '✓ ' : ''}Format on Save` },
    '-',
    { cmd: 'settings', label: 'Settings' },
    '-',
    { cmd: 'reopenClosedTab', label: 'Reopen Closed Editor' },
    { cmd: 'closeTab', label: 'Close Editor' },
    { cmd: 'closeFolder', label: 'Close Folder' },
    '-',
    { cmd: 'exit', label: 'Exit' },
  ],
  Edit: () => [
    { cmd: 'editor.undo', label: 'Undo', key: 'Ctrl+Z' },
    { cmd: 'editor.redo', label: 'Redo', key: 'Ctrl+Shift+Z' },
    '-',
    { cmd: 'find', label: 'Find' },
    { cmd: 'replace', label: 'Replace' },
    '-',
    { cmd: 'findInFiles', label: 'Find in Files' },
    { cmd: 'replaceInFiles', label: 'Replace in Files' },
    '-',
    { cmd: 'editor.toggleComment', label: 'Toggle Line Comment', key: 'Ctrl+/' },
    { cmd: 'editor.toggleBlockComment', label: 'Toggle Block Comment', key: 'Shift+Alt+A' },
  ],
  Selection: () => [
    { cmd: 'editor.selectAll', label: 'Select All', key: 'Ctrl+A' },
    { cmd: 'editor.selectParentSyntax', label: 'Expand Selection', key: 'Ctrl+I' },
    { cmd: 'editor.selectLine', label: 'Select Line', key: 'Ctrl+L' },
    '-',
    { cmd: 'editor.copyLineUp', label: 'Copy Line Up', key: 'Shift+Alt+↑' },
    { cmd: 'editor.copyLineDown', label: 'Copy Line Down', key: 'Shift+Alt+↓' },
    { cmd: 'editor.moveLineUp', label: 'Move Line Up', key: 'Alt+↑' },
    { cmd: 'editor.moveLineDown', label: 'Move Line Down', key: 'Alt+↓' },
    { cmd: 'editor.deleteLine', label: 'Delete Line', key: 'Ctrl+Shift+K' },
    '-',
    { cmd: 'editor.selectNextOccurrence', label: 'Add Next Occurrence', key: 'Ctrl+D' },
    { cmd: 'editor.selectSelectionMatches', label: 'Select All Occurrences', key: 'Ctrl+Shift+L' },
  ],
  View: () => [
    { cmd: 'commandPalette', label: 'Command Palette…' },
    '-',
    { cmd: 'showExplorer', label: 'Explorer' },
    { cmd: 'findInFiles', label: 'Search' },
    { cmd: 'showScm', label: 'Source Control' },
    { cmd: 'toggleSidebar', label: 'Toggle Primary Side Bar' },
    { cmd: 'toggleTerminal', label: 'Terminal' },
    '-',
    { cmd: 'toggleWordWrap', label: `${settings.wordWrap ? '✓ ' : ''}Word Wrap` },
    { cmd: 'markdownPreview', label: 'Markdown Preview' },
    '-',
    { cmd: 'zoomIn', label: 'Zoom In' },
    { cmd: 'zoomOut', label: 'Zoom Out' },
    { cmd: 'zoomReset', label: 'Reset Zoom' },
  ],
  Go: () => [
    { cmd: 'goBack', label: 'Back' },
    { cmd: 'goForward', label: 'Forward' },
    '-',
    { cmd: 'quickOpen', label: 'Go to File…' },
    { cmd: 'goToSymbol', label: 'Go to Symbol in Editor…' },
    { cmd: 'goToLine', label: 'Go to Line/Column…' },
    '-',
    { cmd: 'nextTab', label: 'Next Editor' },
    { cmd: 'prevTab', label: 'Previous Editor' },
  ],
  Git: () => [
    { cmd: 'gitCommit', label: 'Commit' },
    { cmd: 'gitCommitPush', label: 'Commit & Push' },
    { cmd: 'gitStageAll', label: 'Stage All Changes' },
    '-',
    { cmd: 'gitPull', label: 'Pull' },
    { cmd: 'gitPush', label: 'Push' },
    '-',
    { cmd: 'gitCheckout', label: 'Checkout to…' },
    { cmd: 'gitHistory', label: 'View History' },
    { cmd: 'gitOpenChanges', label: 'Open Changes of Active File' },
    '-',
    { cmd: 'gitInit', label: 'Initialize Repository' },
    { cmd: 'gitClone', label: 'Clone…' },
  ],
  Terminal: () => [
    { cmd: 'newTerminal', label: 'New Terminal' },
    { cmd: 'toggleTerminal', label: 'Toggle Terminal' },
    { cmd: 'runTask', label: 'Run Task…' },
    '-',
    { cmd: 'termux', label: 'Open Project in Termux App' },
  ],
  Help: () => [
    { cmd: 'commandPalette', label: 'Show All Commands' },
    { cmd: 'shortcuts', label: 'Keyboard Shortcuts' },
    '-',
    { cmd: 'about', label: 'About' },
  ],
};

export const MENU_NAMES = Object.keys(MENUS);

function items(name) {
  return MENUS[name]().map((it) =>
    it === '-' ? '-' : { label: it.label, shortcut: it.key ?? shortcutFor(it.cmd), run: () => app.commands.run(it.cmd) },
  );
}

export function openMenu(name, anchor) {
  return menuAt(anchor, items(name));
}

/** All menus flattened into one (used by the compact "≡" button on narrow screens). */
export function openAllMenus(anchor) {
  const all = [];
  for (const name of ['File', 'Edit', 'View', 'Go', 'Git', 'Terminal', 'Help']) {
    all.push({ label: name, disabled: true }, ...items(name).filter((x) => x !== '-'), '-');
  }
  all.pop();
  return menuAt(anchor, all);
}
