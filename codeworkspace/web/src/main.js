// Entry point: builds the layout, wires modules together and boots the workspace.
import '@xterm/xterm/css/xterm.css';
import './style.css';
import { app, bus } from './app.js';
import { hasNative, sync, call, fs } from './native.js';
import { dirname, isInside } from './path.js';
import { h, toast, closeTopOverlay, contextMenu, iconButton } from './ui.js';
import { icon } from './icons.js';
import { settings, updateSettings, lastProject } from './settings.js';
import * as editor from './editor.js';
import { workspace } from './workspace.js';
import { explorer } from './explorer.js';
import { searchView } from './searchview.js';
import { scm } from './scm.js';
import { diffView } from './diffview.js';
import { markdown } from './markdown.js';
import { folderPicker } from './folderpicker.js';
import { termux } from './termux.js';
import { welcome } from './welcome.js';
import { terminal } from './terminal.js';
import { registerCommands, run, shortcutFor } from './commands.js';
import { MENU_NAMES, openMenu, openAllMenus } from './menus.js';

Object.assign(app, {
  editor, workspace, explorer, search: searchView, scm, diffView, markdown, folderPicker, termux, welcome, terminal,
  commands: { run },
  openPath: (path) => openPath(path),
  copy(text) {
    call('clipboard.set', { text }).then(() => toast('Copied to clipboard'));
  },
});

// Debug handle (handy with chrome://inspect).
window.__app = app;

// ------------------------------------------------------------------ layout

const NARROW = 900;
let els = {};
let currentView = 'explorer';
let sidebarVisible = true;

function isNarrow() {
  return window.innerWidth < NARROW;
}

const layout = {
  showView(name, toggle = false) {
    if (toggle && sidebarVisible && currentView === name) return layout.setSidebar(false);
    currentView = name;
    for (const [k, el] of Object.entries(els.panels)) el.hidden = k !== name;
    layout.setSidebar(true);
  },
  toggleSidebar() {
    layout.setSidebar(!sidebarVisible);
  },
  setSidebar(visible) {
    sidebarVisible = visible;
    els.main.classList.toggle('sidebar-hidden', !visible);
    for (const b of els.activity.querySelectorAll('[data-view]')) b.classList.toggle('active', visible && b.dataset.view === currentView);
    if (visible) bus.emit('view-shown', currentView);
  },
  /** Whether a side panel is on screen (panels skip work while hidden). */
  isVisible(name) {
    return sidebarVisible && currentView === name;
  },
  /** On narrow screens the sidebar overlays the editor; hide it after picking a file. */
  autoHideSidebar() {
    if (isNarrow()) layout.setSidebar(false);
  },
};
app.layout = layout;

function activityButton(view, iconName, label, onClick) {
  return h(
    'button',
    {
      class: 'activity-btn',
      dataset: view ? { view } : {},
      title: label,
      'aria-label': label,
      onClick: onClick ?? (() => layout.showView(view, true)),
    },
    h('span', { html: icon(iconName) }),
    view === 'scm' ? h('span', { class: 'activity-badge', hidden: true }) : null,
  );
}

function buildLayout() {
  const root = document.getElementById('app');

  // Title bar: logo, menu bar, navigation + command center, layout controls.
  const menubar = h('div', { class: 'menubar' });
  for (const name of MENU_NAMES) {
    const b = h('button', { class: 'menubar-item', onClick: () => openMenu(name, b) }, name);
    menubar.append(b);
  }
  els.back = iconButton('back', 'Go Back (Alt+←)', () => run('goBack'), 'nav dim');
  els.forward = iconButton('forward', 'Go Forward (Alt+→)', () => run('goForward'), 'nav dim');
  els.commandCenter = h(
    'button',
    { class: 'command-center', onClick: () => run(workspace.root ? 'quickOpen' : 'commandPalette') },
    h('span', { html: icon('search') }),
    h('span', { class: 'cc-text' }, 'Termux Studio Code'),
  );
  const title = h(
    'header',
    { class: 'titlebar' },
    h('span', { class: 'title-logo' }, '</>'),
    iconButton('menu', 'Application Menu', (e) => openAllMenus(e.currentTarget), 'compact-menu'),
    menubar,
    h('div', { class: 'title-center' }, els.back, els.forward, els.commandCenter),
    h('div', { class: 'title-right' },
      iconButton('sidebar', 'Toggle Primary Side Bar (Ctrl+B)', () => layout.toggleSidebar()),
      iconButton('command', 'Command Palette (Ctrl+Shift+P)', () => run('commandPalette')),
    ),
  );

  // Activity bar (left), like VS Code.
  els.activity = h(
    'nav',
    { class: 'activitybar' },
    activityButton('explorer', 'files', 'Explorer (Ctrl+Shift+E)'),
    activityButton('search', 'search', 'Search (Ctrl+Shift+F)', () =>
      sidebarVisible && currentView === 'search' ? layout.setSidebar(false) : searchView.show()),
    activityButton('scm', 'git', 'Source Control (Ctrl+Shift+G)'),
    activityButton(null, 'terminal', 'Terminal (Ctrl+`)', () => run('toggleTerminal')),
    h('span', { class: 'spacer' }),
    activityButton(null, 'gear', 'Manage', (e) => manageMenu(e.currentTarget)),
  );

  els.panels = {
    explorer: explorer.build(),
    search: searchView.build(),
    scm: scm.build(),
  };
  els.sidebar = h('aside', { class: 'sidebar' }, ...Object.values(els.panels));
  els.resizer = h('div', { class: 'resizer', title: 'Drag to resize' });
  els.editorGroup = h('div', { class: 'editor-group' });
  els.editorArea = h('section', { class: 'editor-area' }, els.editorGroup, ...terminal.build());
  els.scrim = h('div', { class: 'scrim', onClick: () => layout.setSidebar(false) });
  els.main = h('div', { class: 'main' }, els.activity, els.sidebar, els.resizer, els.editorArea, els.scrim);

  els.status = h('footer', { class: 'statusbar' });

  root.append(title, els.main, els.status);
  setSidebarWidth(settings.sidebarWidth);
  setupResizer();
  editor.initEditor(els.editorGroup);
  layout.showView('explorer');
  if (isNarrow()) layout.setSidebar(false);
}

function setSidebarWidth(w) {
  const max = Math.max(220, window.innerWidth * 0.6);
  const width = Math.round(Math.max(170, Math.min(w, max)));
  document.documentElement.style.setProperty('--sidebar-w', width + 'px');
  return width;
}

function setupResizer() {
  let startX = 0;
  let startW = 0;
  const move = (e) => setSidebarWidth(startW + e.clientX - startX);
  const up = (e) => {
    els.resizer.releasePointerCapture(e.pointerId);
    els.resizer.removeEventListener('pointermove', move);
    els.resizer.removeEventListener('pointerup', up);
    els.main.classList.remove('resizing');
    updateSettings({ sidebarWidth: els.sidebar.getBoundingClientRect().width });
  };
  els.resizer.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    startX = e.clientX;
    startW = els.sidebar.getBoundingClientRect().width;
    els.resizer.setPointerCapture(e.pointerId);
    els.resizer.addEventListener('pointermove', move);
    els.resizer.addEventListener('pointerup', up);
    els.main.classList.add('resizing');
  });
}

function manageMenu(anchor) {
  const r = anchor.getBoundingClientRect();
  contextMenu(r.right + 4, r.bottom, [
    { label: 'Command Palette…', shortcut: shortcutFor('commandPalette'), run: () => run('commandPalette') },
    '-',
    { label: 'Settings', icon: 'settings', shortcut: shortcutFor('settings'), run: () => run('settings') },
    { label: 'Keyboard Shortcuts', icon: 'keyboard', run: () => run('shortcuts') },
    '-',
    { label: 'About', icon: 'info', run: () => run('about') },
  ]);
}

// ------------------------------------------------------------------ status

let cursorInfo = null;
let gitBusy = false;
let statusFrame = 0;

function statusItem(content, opts = {}) {
  return h(opts.onClick ? 'button' : 'span', { class: 'status-item', title: opts.title, onClick: opts.onClick }, ...[].concat(content));
}

function cursorText(c) {
  return `Ln ${c.line}, Col ${c.col}${c.selected ? ` (${c.selected} selected)` : ''}${c.cursors > 1 ? ` · ${c.cursors} selections` : ''}`;
}

/** Rebuilds the status bar at most once per frame. */
function scheduleStatus() {
  if (!statusFrame) {
    statusFrame = requestAnimationFrame(() => {
      statusFrame = 0;
      renderStatus();
    });
  }
}

function renderStatus() {
  const s = els.status;
  els.cursorItem = null;
  s.innerHTML = '';
  s.classList.toggle('no-folder', !workspace.root);
  if (workspace.repoRoot) {
    s.append(
      statusItem([h('span', { html: icon('branch') }), workspace.branch ?? '…'], { title: 'Checkout Branch…', onClick: () => scm.branchPicker() }),
      statusItem(h('span', { class: gitBusy ? 'spin' : '', html: icon('sync') }), { title: 'Refresh Git Status', onClick: () => run('gitRefresh') }),
    );
    const n = workspace.changes.length;
    if (n) s.append(statusItem(`${n} change${n === 1 ? '' : 's'}`, { onClick: () => layout.showView('scm') }));
  } else if (!workspace.root) {
    s.append(statusItem('No Folder Open', { onClick: () => run('openFolder') }));
  }
  s.append(h('span', { class: 'spacer' }));
  if (cursorInfo) {
    const c = cursorInfo;
    els.cursorItem = statusItem(cursorText(c), { title: 'Go to Line/Column', onClick: () => run('goToLine') });
    s.append(
      els.cursorItem,
      statusItem(settings.insertSpaces ? `Spaces: ${settings.tabSize}` : `Tab Size: ${settings.tabSize}`, { title: 'Indentation', onClick: () => run('settings') }),
      statusItem('UTF-8'),
      statusItem(c.eol ?? 'LF'),
      statusItem(c.lang, { title: 'Language Mode' }),
    );
  }
  s.append(statusItem(h('span', { html: icon('format') }), { title: settings.formatOnSave ? 'Format on save: on' : 'Format on save: off', onClick: () => run('toggleFormatOnSave') }));
}

function renderProject() {
  els.commandCenter.querySelector('.cc-text').textContent = workspace.root ? workspace.name : 'Termux Studio Code';
  els.commandCenter.title = workspace.root ? `Search files in ${workspace.name} (Ctrl+P)` : 'Show All Commands (Ctrl+Shift+P)';
}

function renderScmBadge() {
  const badge = els.activity.querySelector('.activity-badge');
  const n = workspace.changes.length;
  badge.hidden = !n;
  badge.textContent = n > 99 ? '99+' : String(n);
}

// ------------------------------------------------------- storage permission

function storageGranted() {
  try {
    return sync('platform').storageGranted;
  } catch {
    return false;
  }
}

let gate = null;
function showStorageGate() {
  if (gate) return;
  gate = h(
    'div',
    { class: 'gate' },
    h(
      'div',
      { class: 'gate-card' },
      h('div', { class: 'welcome-logo' }, '</>'),
      h('h2', {}, 'Storage access needed'),
      h('p', {}, 'Termux Studio Code edits project folders on your device storage. Please allow "All files access" on the next screen.'),
      h('button', { class: 'btn primary', onClick: () => call('storage.request') }, 'Grant Access'),
      h('div', { class: 'muted small' }, 'Developed by Roopesh'),
    ),
  );
  document.body.append(gate);
}

async function startWorkspace() {
  const last = lastProject();
  let reloading = false;
  try {
    reloading = sessionStorage.getItem('reloading') === '1';
    sessionStorage.removeItem('reloading');
  } catch {
    /* ignore */
  }
  call('termux.bootstrap').catch(() => {});
  const requested = await call('app.takePendingOpen').catch(() => null);
  if (requested) {
    await openPath(requested);
  } else if ((settings.reopenLastProject || reloading) && last) {
    try {
      await workspace.open(last);
    } catch (e) {
      console.error(e);
      toast(`Could not reopen ${last}`, { type: 'warn' });
    }
  }
  if (settings.terminalOpen) terminal.show();
}

/** Opens a folder as the workspace, or a file (with its folder, unless it is in the open one). */
async function openPath(path) {
  try {
    const st = await fs.stat(path);
    if (st.isDir) {
      await workspace.open(path);
    } else {
      if (!workspace.root || !isInside(workspace.root, path)) await workspace.open(dirname(path));
      await editor.openFile(path);
    }
  } catch (e) {
    toast(`Could not open ${path}: ${e.message}`, { type: 'error', timeout: 8000 });
  }
}

// "code <path>" from Termux while the app is already running.
window.__openPath = async () => {
  const path = await call('app.takePendingOpen').catch(() => null);
  if (path) await openPath(path);
};

// --------------------------------------------------------- lifecycle hooks

window.__onBack = () => {
  if (closeTopOverlay()) return true;
  if (document.querySelector('.cm-search')) {
    const view = editor.getView();
    view.dom.querySelector('.cm-search button[name=close]')?.click();
    return true;
  }
  if (isNarrow() && sidebarVisible) {
    layout.setSidebar(false);
    return true;
  }
  return false;
};

window.__onResume = async () => {
  if (gate) {
    if (storageGranted()) {
      gate.remove();
      gate = null;
      await startWorkspace();
    }
    return;
  }
  terminal.resume();
  await workspace.sync();
};

const POLL_MS = 10000;
let persistTimer = null;
function schedulePersist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => workspace.persist(), 800);
}

// --------------------------------------------------------------------- boot

function boot() {
  buildLayout();
  registerCommands();

  bus.on('cursor', (c) => {
    const prev = cursorInfo;
    cursorInfo = c;
    // While typing only the position changes: update its text instead of rebuilding the bar.
    if (c && prev && els.cursorItem && !statusFrame && c.lang === prev.lang && c.eol === prev.eol) {
      els.cursorItem.textContent = cursorText(c);
    } else {
      scheduleStatus();
    }
  });
  bus.on('git-status', () => {
    scheduleStatus();
    renderScmBadge();
  });
  bus.on('git-busy', (b) => {
    gitBusy = b;
    scheduleStatus();
  });
  bus.on('workspace', () => {
    renderProject();
    scheduleStatus();
    editor.rerender();
    document.title = workspace.root ? `${workspace.name} — Termux Studio Code` : 'Termux Studio Code';
  });
  let gitTimer = null;
  bus.on('saved', () => {
    clearTimeout(gitTimer);
    gitTimer = setTimeout(() => workspace.refreshGit(), 1200);
  });
  bus.on('tabs-changed', schedulePersist);
  // Commands run in the terminal change files behind the app's back: sync once their output
  // settles (and on resume), and poll lightly in case anything else changes the project.
  bus.on('terminal-idle', () => workspace.sync());
  setInterval(() => {
    if (!document.hidden) workspace.poll();
  }, POLL_MS);
  bus.on('settings', scheduleStatus);
  bus.on('nav-state', (n) => {
    els.back.classList.toggle('dim', !n.back);
    els.forward.classList.toggle('dim', !n.forward);
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    workspace.persist();
    if (settings.autoSave) editor.saveAll({ auto: true });
  });
  window.addEventListener('resize', () => {
    setSidebarWidth(settings.sidebarWidth);
    els.main.classList.toggle('narrow', isNarrow());
  });
  els.main.classList.toggle('narrow', isNarrow());

  renderProject();
  renderStatus();

  if (!hasNative) {
    toast('Native bridge unavailable — running in browser preview mode', { type: 'warn', timeout: 0 });
    return;
  }
  if (!storageGranted()) showStorageGate();
  else startWorkspace();
}

window.addEventListener('error', (e) => {
  console.error(`Uncaught: ${e.error?.stack ?? e.message} @${e.filename}:${e.lineno}`);
  toast(`Error: ${e.message}`, { type: 'error', timeout: 8000 });
});
window.addEventListener('unhandledrejection', (e) => {
  console.error(`Unhandled rejection: ${e.reason?.code ? `[${e.reason.code}] ` : ''}${e.reason?.stack ?? e.reason}`);
  toast(`Error: ${e.reason?.message ?? e.reason}`, { type: 'error', timeout: 8000 });
});

// UI freezes (main-thread tasks over 300 ms) go to the app log, to find what still lags.
try {
  new PerformanceObserver((list) => {
    for (const t of list.getEntries()) {
      if (t.duration > 300) console.warn(`Long task: ${Math.round(t.duration)} ms (${document.querySelector('.tab.active .tab-title')?.textContent ?? 'no file'})`);
    }
  }).observe({ type: 'longtask' });
} catch {
  /* not supported */
}
// JS heap size every 2 minutes, to spot memory growth.
if (performance.memory) {
  setInterval(() => {
    if (!document.hidden) console.info(`Heap: ${Math.round(performance.memory.usedJSHeapSize / 1048576)} MB used, ${app.editor.getTabs().length} tabs`);
  }, 120000);
}

boot();
