// Command registry, keyboard shortcuts, command palette, quick open, go to line/symbol, settings.
import { app } from './app.js';
import { call } from './native.js';
import { h, quickPick, fuzzy, hasOverlay, dialog, toast } from './ui.js';
import { icon, fileBadge } from './icons.js';
import { basename, dirname, join, relative } from './path.js';
import { settings, updateSettings, recentProjects, DEFAULTS } from './settings.js';
import { KIND_ICON } from './symbols.js';

const commands = new Map();
const keymap = new Map(); // "Ctrl+Shift+P" -> command id

function def(id, title, run, keys = []) {
  commands.set(id, { id, title, run, keys });
  for (const k of keys) keymap.set(k, id);
}

const needsFolder = (fn) => () => (app.workspace.root ? fn() : toast('Open a folder first', { type: 'warn' }));
const ed = () => app.editor;

export function registerCommands() {
  // Workspace
  def('openFolder', 'File: Open Folder…', async () => {
    const dir = await app.folderPicker.pick();
    if (dir) await app.workspace.open(dir);
  }, ['Ctrl+O']);
  def('openRecent', 'File: Open Recent…', openRecent, ['Ctrl+R']);
  def('closeFolder', 'File: Close Folder', () => app.workspace.close());
  def('newFile', 'File: New File…', needsFolder(() => app.explorer.newFile()), ['Ctrl+N']);
  def('newFolder', 'File: New Folder…', needsFolder(() => app.explorer.newFolder()));
  def('save', 'File: Save', () => ed().save(), ['Ctrl+S']);
  def('saveAs', 'File: Save As…', () => ed().saveAs(), ['Ctrl+Shift+S']);
  def('saveAll', 'File: Save All', () => ed().saveAll(), ['Ctrl+Alt+S']);
  def('toggleAutoSave', 'File: Toggle Auto Save', () => {
    updateSettings({ autoSave: !settings.autoSave });
    if (settings.autoSave) ed().saveAll({ auto: true });
    toast(`Auto Save ${settings.autoSave ? 'on — files save 1s after you stop typing' : 'off'}`);
  });
  def('closeTab', 'View: Close Editor', () => ed().closeTab(ed().activeTab()), ['Ctrl+W']);
  def('closeAllTabs', 'View: Close All Editors', () => ed().closeTabs(ed().getTabs()));
  def('reopenClosedTab', 'View: Reopen Closed Editor', () => ed().reopenClosed(), ['Ctrl+Shift+T']);
  def('nextTab', 'View: Next Editor', () => ed().cycleTab(1), ['Ctrl+Tab', 'Ctrl+PageDown']);
  def('prevTab', 'View: Previous Editor', () => ed().cycleTab(-1), ['Ctrl+Shift+Tab', 'Ctrl+PageUp']);
  def('copyPath', 'File: Copy Path of Active File', () => ed().activeTab()?.path && app.copy(ed().activeTab().path));

  // Navigation
  def('quickOpen', 'Go to File…', needsFolder(() => quickOpen('')), ['Ctrl+P', 'Ctrl+E']);
  def('commandPalette', 'Show All Commands', () => quickOpen('>'), ['Ctrl+Shift+P', 'F1']);
  def('goToLine', 'Go to Line…', () => quickOpen(':'), ['Ctrl+G']);
  def('goToSymbol', 'Go to Symbol in Editor…', () => quickOpen('@'), ['Ctrl+Shift+O']);
  def('goBack', 'Go Back', () => ed().navigate(-1), ['Alt+ArrowLeft']);
  def('goForward', 'Go Forward', () => ed().navigate(1), ['Alt+ArrowRight']);

  // Editing
  def('find', 'Find', () => ed().openFind(false), ['Ctrl+F']);
  def('replace', 'Replace', () => ed().openFind(true), ['Ctrl+H']);
  def('findInFiles', 'Search: Find in Files', needsFolder(() => app.search.show({ query: selectedText() })), ['Ctrl+Shift+F']);
  def('replaceInFiles', 'Search: Replace in Files', needsFolder(() => app.search.show({ query: selectedText() })), ['Ctrl+Shift+H']);
  def('formatDocument', 'Format Document', () => ed().formatDocument(), ['Shift+Alt+F', 'Ctrl+Shift+I']);
  def('formatSelection', 'Format Selection', () => ed().formatDocument(undefined, { selection: true }));
  def('toggleWordWrap', 'View: Toggle Word Wrap', () => updateSettings({ wordWrap: !settings.wordWrap }), ['Alt+Z']);
  def('toggleFormatOnSave', 'Preferences: Toggle Format on Save', () => {
    updateSettings({ formatOnSave: !settings.formatOnSave });
    toast(`Format on save ${settings.formatOnSave ? 'enabled' : 'disabled'}`);
  });
  def('markdownPreview', 'Markdown: Toggle Preview', () => ed().togglePreview(), ['Ctrl+Shift+V']);

  // Views
  def('toggleSidebar', 'View: Toggle Sidebar', () => app.layout.toggleSidebar(), ['Ctrl+B']);
  def('showExplorer', 'View: Show Explorer', () => app.layout.showView('explorer', true), ['Ctrl+Shift+E']);
  def('showSearch', 'View: Show Search', () => app.search.show(), []);
  def('showScm', 'View: Show Source Control', () => app.layout.showView('scm', true), ['Ctrl+Shift+G']);
  def('zoomIn', 'View: Zoom In (Editor Font)', () => ed().zoom(1), ['Ctrl+=', 'Ctrl+Shift+=']);
  def('zoomOut', 'View: Zoom Out (Editor Font)', () => ed().zoom(-1), ['Ctrl+-']);
  def('zoomReset', 'View: Reset Zoom', () => updateSettings({ fontSize: DEFAULTS.fontSize }), ['Ctrl+0']);

  // Editor commands (keys are handled by CodeMirror; listed here for menus and the palette)
  for (const [name, title] of [
    ['undo', 'Undo'], ['redo', 'Redo'], ['selectAll', 'Select All'], ['toggleComment', 'Toggle Line Comment'],
    ['toggleBlockComment', 'Toggle Block Comment'], ['moveLineUp', 'Move Line Up'], ['moveLineDown', 'Move Line Down'],
    ['copyLineUp', 'Copy Line Up'], ['copyLineDown', 'Copy Line Down'], ['selectLine', 'Select Line'],
    ['selectParentSyntax', 'Expand Selection'], ['deleteLine', 'Delete Line'], ['indentMore', 'Indent Line'],
    ['indentLess', 'Outdent Line'], ['selectNextOccurrence', 'Add Selection to Next Find Match'],
    ['selectSelectionMatches', 'Select All Occurrences of Find Match'],
  ]) def('editor.' + name, title, () => ed().exec(name));

  // Git
  def('gitCommit', 'Git: Commit', needsFolder(() => app.scm.commit()));
  def('gitCommitPush', 'Git: Commit & Push', needsFolder(() => app.scm.commit({ push: true })));
  def('gitStageAll', 'Git: Stage All Changes', needsFolder(() => app.scm.stageAll()));
  def('gitPull', 'Git: Pull', needsFolder(() => app.scm.pull()));
  def('gitPush', 'Git: Push', needsFolder(() => app.scm.push()));
  def('gitCheckout', 'Git: Checkout to…', needsFolder(() => app.scm.branchPicker()));
  def('gitHistory', 'Git: View History', needsFolder(() => app.scm.showHistory()));
  def('gitInit', 'Git: Initialize Repository', needsFolder(() => app.scm.init()));
  def('gitClone', 'Git: Clone…', () => app.scm.clone());
  def('gitRefresh', 'Git: Refresh', needsFolder(() => app.workspace.refreshGit()));
  def('gitOpenChanges', 'Git: Open Changes', () => ed().activeTab()?.path && app.scm.openDiffForPath(ed().activeTab().path));

  // Termux
  def('toggleTerminal', 'Terminal: Toggle Terminal', () => app.terminal.toggle(), ['Ctrl+`']);
  def('newTerminal', 'Terminal: Create New Terminal', () => app.terminal.create(), ['Ctrl+Shift+`']);
  def('runTask', 'Terminal: Run Task…', () => app.terminal.runTask());
  def('termux', 'Termux: Open Project in Termux App', needsFolder(() => app.termux.open()));
  def('termuxRun', 'Termux: Run Command in Termux App…', needsFolder(() => app.termux.runCommand()));
  def('termuxMenu', 'Termux: Run Project Script in Termux App…', needsFolder(() => app.termux.menu()));

  // App
  def('settings', 'Preferences: Open Settings', openSettings, ['Ctrl+,']);
  def('shortcuts', 'Help: Keyboard Shortcuts', showShortcuts, ['Ctrl+K']);
  def('about', 'Help: About', showAbout);
  def('exit', 'File: Exit', exitApp);
  def('reloadWindow', 'Developer: Reload Window', reloadWindow);
  def('syncWorkspace', 'Developer: Sync Workspace with Disk', needsFolder(async () => {
    await app.workspace.sync();
    toast('Workspace synced with disk');
  }));

  window.addEventListener('keydown', onKeyDown, true);
}

export function run(id, ...args) {
  const c = commands.get(id);
  if (!c) return console.warn('unknown command', id);
  return Promise.resolve(c.run(...args)).catch((e) => toast(`${c.title} failed: ${e.message}`, { type: 'error' }));
}

export function shortcutFor(id) {
  return commands.get(id)?.keys[0] ?? '';
}

// ---------------------------------------------------------------- keyboard

const CODE_KEYS = {
  Equal: '=', Minus: '-', Backquote: '`', Comma: ',', Period: '.', Slash: '/', Backslash: '\\',
  BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'",
};

function keyString(e) {
  let key;
  if (e.code?.startsWith('Key')) key = e.code.slice(3);
  else if (e.code?.startsWith('Digit')) key = e.code.slice(5);
  else if (CODE_KEYS[e.code]) key = CODE_KEYS[e.code];
  else key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  const mods = [];
  if (e.ctrlKey || e.metaKey) mods.push('Ctrl');
  if (e.shiftKey) mods.push('Shift');
  if (e.altKey) mods.push('Alt');
  return [...mods, key].join('+');
}

// While the terminal has focus, only these app shortcuts are intercepted; everything else
// (Ctrl+C, Ctrl+R, Ctrl+W, …) goes to the shell, like VS Code's "commandsToSkipShell".
const TERMINAL_SKIP = new Set([
  'toggleTerminal', 'newTerminal', 'quickOpen', 'commandPalette', 'toggleSidebar', 'nextTab', 'prevTab',
  'showExplorer', 'findInFiles', 'showScm', 'save', 'saveAll', 'settings', 'zoomIn', 'zoomOut', 'zoomReset',
]);

function onKeyDown(e) {
  if (hasOverlay()) return;
  if (!e.ctrlKey && !e.metaKey && !e.altKey && !/^F\d+$/.test(e.key)) return;
  // keyString always orders modifiers Ctrl, Shift, Alt — keybindings are declared the same way.
  const id = keymap.get(keyString(e));
  if (!id) return;
  if (app.terminal?.focused() && !TERMINAL_SKIP.has(id)) return;
  e.preventDefault();
  e.stopPropagation();
  run(id);
}

function selectedText() {
  const view = ed().getView();
  const tab = ed().activeTab();
  if (!tab || tab.kind !== 'file') return undefined;
  const sel = view.state.selection.main;
  if (sel.empty || sel.to - sel.from > 200) return undefined;
  const text = view.state.sliceDoc(sel.from, sel.to);
  return text.includes('\n') ? undefined : text;
}

// -------------------------------------------------------------- quick open

function commandItems(q) {
  return [...commands.values()]
    .map((c) => ({ c, m: fuzzy(q.trim(), c.title) }))
    .filter((x) => x.m)
    .sort((a, b) => (q.trim() ? b.m.score - a.m.score : a.c.title.localeCompare(b.c.title)))
    .map(({ c, m }) => ({ label: c.title, highlights: m.indices, shortcut: c.keys[0], command: c.id }));
}

function lineItems(q) {
  const tab = ed().activeTab();
  if (!tab || tab.kind !== 'file') return [{ label: 'Open a file to go to a line', disabled: true }];
  const total = ed().lineCount();
  const [l, c] = q.split(/[:,]/).map((x) => parseInt(x, 10));
  if (!l) return [{ label: `Type a line number between 1 and ${total}`, info: true }];
  return [{ label: `Go to line ${Math.min(l, total)}${c ? `, column ${c}` : ''}`, line: Math.min(l, total), col: c || 1 }];
}

function symbolItems(q) {
  const syms = ed().symbols();
  if (!syms.length) return [{ label: 'No symbols found in this file', info: true }];
  return syms
    .map((s) => ({ s, m: fuzzy(q.trim(), s.name) }))
    .filter((x) => x.m)
    .sort((a, b) => (q.trim() ? b.m.score - a.m.score : a.s.line - b.s.line))
    .slice(0, 300)
    .map(({ s, m }) => ({
      label: s.name,
      highlights: m.indices,
      icon: `<span class="sym-kind sym-${s.kind}">${KIND_ICON[s.kind] ?? '•'}</span>`,
      description: s.kind,
      shortcut: String(s.line + 1),
      line: s.line + 1,
    }));
}

async function fileItems(q) {
  const ws = app.workspace;
  if (!ws.root) return [];
  let files;
  try {
    files = await ws.files();
  } catch (e) {
    return [{ label: `Error: ${e.message}`, info: true }];
  }
  const query = q.trim().replace(/\s+/g, '');
  if (!query) {
    // Open editors first, then the first files of the project.
    const open = ed().getTabs().filter((t) => t.kind === 'file').map((t) => relative(ws.root, t.path));
    const seen = new Set(open);
    const rest = files.filter((f) => !seen.has(f)).slice(0, 60);
    return [
      ...(open.length ? [{ separator: 'open editors' }] : []),
      ...open.map((f) => fileItem(f, [])),
      ...(rest.length ? [{ separator: 'files' }] : []),
      ...rest.map((f) => fileItem(f, [])),
    ];
  }
  const scored = [];
  for (const f of files) {
    const name = basename(f);
    const nm = fuzzy(query, name);
    if (nm) {
      const off = f.length - name.length;
      scored.push({ f, score: nm.score + 20, idx: nm.indices.map((i) => i + off) });
      continue;
    }
    const pm = fuzzy(query, f);
    if (pm) scored.push({ f, score: pm.score, idx: pm.indices });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 100).map((s) => fileItem(s.f, s.idx));
}

function fileItem(rel, idx) {
  const name = basename(rel);
  const off = rel.length - name.length;
  return {
    label: name,
    highlights: idx.filter((i) => i >= off).map((i) => i - off),
    description: dirname('/' + rel).slice(1),
    icon: fileBadge(rel),
    file: rel,
  };
}

export function quickOpen(prefix = '') {
  quickPick({
    value: prefix,
    placeholder: 'Search files by name  ( > commands   : line   @ symbol )',
    provider: (q) => {
      if (q.startsWith('>')) return commandItems(q.slice(1));
      if (q.startsWith(':')) return lineItems(q.slice(1));
      if (q.startsWith('@')) return symbolItems(q.slice(1));
      return fileItems(q);
    },
    onAccept: async (it) => {
      if (it.info || it.disabled) return false;
      if (it.command) {
        setTimeout(() => run(it.command), 0);
      } else if (it.line) {
        ed().pushNav();
        ed().revealLine(it.line, it.col ?? 1);
      } else if (it.file) {
        await ed().openFile(join(app.workspace.root, it.file));
        app.layout.autoHideSidebar();
      }
    },
  });
}

/** Asks what to do with unsaved files before the page goes away; false means cancel. */
async function settleUnsaved(title, action) {
  const dirty = ed().dirtyTabs();
  if (dirty.length) {
    const r = await dialog({
      title,
      body: h('div', { class: 'dialog-message' }, `${dirty.length} file${dirty.length > 1 ? 's have' : ' has'} unsaved changes.`),
      buttons: [
        { label: 'Cancel', value: false },
        { label: "Don't Save", value: 'discard' },
        { label: `Save All & ${action}`, value: 'save', primary: true },
      ],
    });
    if (!r) return false;
    if (r === 'save') await ed().saveAll();
  }
  app.workspace.persist();
  return true;
}

/** Closes the app completely, ending its terminal sessions and the server in Termux. */
async function exitApp() {
  if (!(await settleUnsaved('Exit', 'Exit'))) return;
  app.terminal.forgetAll();
  await call('app.exit');
}

/** Reloads the whole UI from scratch; the project, editors and terminals (via tmux) come back. */
async function reloadWindow() {
  if (!(await settleUnsaved('Reload Window', 'Reload'))) return;
  try {
    sessionStorage.setItem('reloading', '1');
  } catch {
    /* the project then reopens only if "reopen last project" is on */
  }
  location.reload();
}

function openRecent() {
  quickPick({
    placeholder: 'Open recent folder',
    provider: (q) =>
      recentProjects()
        .map((r) => ({ r, m: fuzzy(q, r.path) }))
        .filter((x) => x.m)
        .map(({ r }) => ({ label: basename(r.path) || r.path, description: dirname(r.path), icon: icon('folder'), path: r.path })),
    emptyText: 'No recent folders',
    onAccept: (it) => {
      app.workspace.open(it.path);
    },
  });
}

// ---------------------------------------------------------------- settings

function field(label, input, hint) {
  return h('label', { class: 'setting' }, h('span', { class: 'setting-label' }, label, hint ? h('span', { class: 'muted small' }, hint) : null), input);
}

function openSettings() {
  const inputs = {};
  const num = (k, min, max) => (inputs[k] = h('input', { class: 'input small-input', type: 'number', min, max, value: settings[k] }));
  const bool = (k) => (inputs[k] = h('input', { type: 'checkbox', checked: !!settings[k] }));
  const text = (k, ph = '') => (inputs[k] = h('input', { class: 'input', value: settings[k], placeholder: ph, autocapitalize: 'off' }));
  const select = (k, options) =>
    (inputs[k] = h('select', { class: 'input small-input' }, ...options.map((o) => h('option', { value: o, selected: String(settings[k]) === String(o) }, o))));

  const body = h(
    'div',
    { class: 'settings-form' },
    h('h4', {}, 'Editor'),
    field('Font size', num('fontSize', 9, 32)),
    field('Tab size', select('tabSize', [2, 4, 8])),
    field('Insert spaces', bool('insertSpaces'), 'Use spaces instead of tabs'),
    field('Word wrap', bool('wordWrap')),
    field('Line numbers', bool('lineNumbers')),
    h('h4', {}, 'Formatting (Prettier)'),
    field('Format on save', bool('formatOnSave')),
    field('Semicolons', bool('prettierSemi')),
    field('Single quotes', bool('prettierSingleQuote')),
    field('Print width', num('prettierPrintWidth', 40, 200)),
    field('Trailing commas', select('prettierTrailingComma', ['all', 'es5', 'none'])),
    h('div', { class: 'muted small' }, 'A .prettierrc (JSON) in the project root overrides these.'),
    h('h4', {}, 'Workspace'),
    field('Reopen last folder', bool('reopenLastProject')),
    field('Show hidden files', bool('showHidden')),
    field('Excluded folders', text('searchExclude', '.git, node_modules'), 'Skipped by search and quick open'),
    h('h4', {}, 'Git'),
    field('Author name', text('gitAuthorName', 'Your Name')),
    field('Author email', text('gitAuthorEmail', 'you@example.com')),
  );

  dialog({
    title: 'Settings',
    cls: 'settings-dialog',
    body,
    buttons: [
      { label: 'Cancel', value: null },
      {
        label: 'Save',
        primary: true,
        value: () => {
          const patch = {};
          for (const [k, el] of Object.entries(inputs)) {
            if (el.type === 'checkbox') patch[k] = el.checked;
            else if (el.type === 'number' || k === 'tabSize') patch[k] = Number(el.value) || DEFAULTS[k];
            else patch[k] = el.value;
          }
          return patch;
        },
      },
    ],
  }).then((patch) => {
    if (!patch) return;
    const hiddenChanged = patch.showHidden !== settings.showHidden;
    updateSettings(patch);
    if (hiddenChanged) app.explorer.refresh();
    toast('Settings saved');
  });
}

function showShortcuts() {
  const rows = [...commands.values()]
    .filter((c) => c.keys.length)
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((c) => h('div', { class: 'key-row' }, h('span', {}, c.title), h('span', {}, ...c.keys.map((k) => h('kbd', {}, k)))));
  dialog({ title: 'Keyboard Shortcuts', cls: 'wide', body: h('div', { class: 'shortcut-list' }, ...rows) });
}

function showAbout() {
  dialog({
    title: 'About',
    body: h(
      'div',
      { class: 'about' },
      h('div', { class: 'welcome-logo' }, '</>'),
      h('h2', {}, 'Termux Studio Code'),
      h('div', { class: 'muted' }, 'Version 0.3.2'),
      h('p', {}, 'A lightweight, tablet-first code workspace for browsing, editing, searching, formatting and managing Git repositories — with optional Termux integration.'),
      h('p', { class: 'about-dev' }, 'Developed by Roopesh'),
      h('div', { class: 'muted small' }, 'Built with CodeMirror, isomorphic-git, Prettier and marked.'),
    ),
  });
}
