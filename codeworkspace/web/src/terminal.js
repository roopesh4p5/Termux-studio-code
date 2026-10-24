// Integrated terminal: xterm.js front-end talking to ttyd running inside Termux over a
// localhost WebSocket. Every command runs in Termux with the user's full environment.
//
// ttyd protocol (subprotocol "tty"):
//   client -> server: first message JSON {AuthToken, columns, rows}; then '0'+input, '1'+JSON{columns,rows}
//   server -> client: '0'+output, '1'+window title, '2'+preferences JSON
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { app, bus } from './app.js';
import { call, fs } from './native.js';
import { h, iconButton, toast, onContext, contextMenu, quickPick } from './ui.js';
import { icon } from './icons.js';
import { basename, join } from './path.js';
import { settings, updateSettings } from './settings.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const THEME = {
  background: '#181818',
  foreground: '#cccccc',
  cursor: '#ffffff',
  cursorAccent: '#181818',
  selectionBackground: '#264f78',
  black: '#000000', red: '#cd3131', green: '#0dbc79', yellow: '#e5e510',
  blue: '#2472c8', magenta: '#bc3fbc', cyan: '#11a8cd', white: '#e5e5e5',
  brightBlack: '#666666', brightRed: '#f14c4c', brightGreen: '#23d18b', brightYellow: '#f5f543',
  brightBlue: '#3b8eea', brightMagenta: '#d670d6', brightCyan: '#29b8db', brightWhite: '#e5e5e5',
};

let config = null;
let els = {};
const sessions = [];
let active = null;
let seq = 0;
let starting = null;

// ---------------------------------------------------------------- server

async function getConfig() {
  if (!config) config = await call('terminal.config');
  return config;
}

// The WebView may not connect to localhost itself (Local Network Access rules), so the
// WebSocket to ttyd lives in Java (TermSocket.java) and events come back via window.__term.
const sockets = new Map();
let socketSeq = 0;

window.__term = (id, event, data) => {
  const sock = sockets.get(id);
  if (!sock) return;
  if (event === 'open') {
    sock.readyState = 1;
    sock.onopen?.();
  } else if (event === 'data') {
    const bin = atob(data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    sock.onmessage?.(bytes);
  } else if (event === 'error') {
    sock.onerror?.(new Error(data));
  } else if (event === 'close') {
    sock.readyState = 3;
    sockets.delete(id);
    sock.onclose?.();
  }
};

class NativeSocket {
  constructor(port, path) {
    this.id = 't' + ++socketSeq;
    this.readyState = 0;
    sockets.set(this.id, this);
    window.Native.termOpen(this.id, port, path);
  }

  /** Sends a ttyd message ('0' + input, '1' + resize JSON, or the initial auth JSON). */
  send(text) {
    if (this.readyState === 1) window.Native.termSend(this.id, text);
  }

  close() {
    window.Native.termClose(this.id);
  }
}

function openSocket(cfg, cwd) {
  return new Promise((resolve, reject) => {
    const ws = new NativeSocket(cfg.port, `/${cfg.token}/ws?arg=${encodeURIComponent(cwd)}`);
    let settled = false;
    const fail = (msg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ws.close();
      reject(new Error(msg));
    };
    const timer = setTimeout(() => fail('timeout'), 3000);
    ws.onopen = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ws.onerror = null;
      ws.onclose = null;
      resolve(ws);
    };
    ws.onerror = (e) => fail(e.message);
    ws.onclose = () => fail('connection closed');
  });
}

/** Ensures the ttyd server is running in Termux (starting it if needed). */
async function startServer(onStatus) {
  if (starting) return starting;
  starting = (async () => {
    onStatus?.('Starting terminal server in Termux…');
    const res = await call('terminal.start');
    if (res === 'permission') {
      const e = new Error('Allow Termux Studio Code to run commands in Termux (permission prompt), then open the terminal again.');
      e.code = 'PERMISSION';
      throw e;
    }
  })();
  try {
    await starting;
  } finally {
    starting = null;
  }
}

async function connect(cwd, onStatus) {
  const cfg = await getConfig();
  let lastError = '';
  try {
    return await openSocket(cfg, cwd);
  } catch (e) {
    lastError = e.message; // not running yet
  }
  await startServer(onStatus);
  for (let i = 0; i < 30; i++) {
    await sleep(i < 5 ? 300 : 500);
    try {
      return await openSocket(cfg, cwd);
    } catch (e) {
      lastError = e.message;
    }
  }
  throw new Error(
    `Could not reach the terminal server in Termux (port ${cfg.port}). Last error: ${lastError}. ` +
      'Check that Termux is running, "allow-external-apps = true" is set in ~/.termux/termux.properties, and ttyd is installed (pkg install ttyd).',
  );
}

// --------------------------------------------------------------- session

class Session {
  constructor(cwd, command) {
    this.id = ++seq;
    this.cwd = cwd;
    this.command = command;
    this.name = command ? command.split(' ').slice(0, 3).join(' ') : basename(cwd) || 'bash';
    this.el = h('div', { class: 'term-instance' });
    this.ws = null;
    this.exited = false;
    this.initTerm();
  }

  initTerm() {
    this.term = new Terminal({
      // xterm needs a concrete font family, not a CSS variable.
      fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--mono').trim() || 'monospace',
      fontSize: Math.max(10, settings.fontSize - 1),
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: 10000,
      allowProposedApi: true,
      theme: THEME,
    });
    this.fit = new FitAddon();
    this.term.loadAddon(this.fit);
    this.term.loadAddon(new WebLinksAddon((e, uri) => call('app.openUrl', { url: uri })));
    this.term.attachCustomKeyEventHandler((e) => this.onKey(e));
    this.term.onData((d) => this.send('0' + d));
    this.term.onResize(({ cols, rows }) => this.send('1' + JSON.stringify({ columns: cols, rows })));
    this.term.onTitleChange((title) => this.onTitle(title));
    // After the shell exits, Enter starts a fresh one in the same terminal.
    this.term.onKey(({ domEvent }) => {
      if (this.exited && domEvent.key === 'Enter') this.restart();
    });
  }

  /** VS Code-style clipboard keys inside the terminal. */
  onKey(e) {
    if (e.type !== 'keydown') return true;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.shiftKey && e.code === 'KeyC') {
      const sel = this.term.getSelection();
      if (sel) app.copy(sel);
      return false;
    }
    if (ctrl && e.shiftKey && e.code === 'KeyV') {
      call('clipboard.get').then((t) => t && this.term.paste(t));
      return false;
    }
    if (ctrl && !e.shiftKey && e.code === 'KeyC' && this.term.hasSelection()) {
      app.copy(this.term.getSelection());
      this.term.clearSelection();
      return false;
    }
    return true;
  }

  async start() {
    this.term.open(this.el);
    this.fitNow();
    this.term.write('\x1b[90mConnecting to Termux…\x1b[0m');
    try {
      this.ws = await connect(this.cwd, (msg) => this.term.write(`\r\x1b[2K\x1b[90m${msg}\x1b[0m`));
    } catch (e) {
      this.term.write(`\r\x1b[2K\x1b[31m${e.message}\x1b[0m\r\n`);
      this.exited = true;
      if (e.code === 'PERMISSION') toast(e.message, { type: 'warn', timeout: 8000 });
      return;
    }
    this.term.write('\r\x1b[2K');
    const ws = this.ws;
    // Terminal output bytes (Java strips ttyd's message-type byte and ignores other messages;
    // the shell's own title escapes arrive in the output and surface via onTitleChange).
    ws.onmessage = (bytes) => this.term.write(bytes);
    ws.onclose = () => {
      if (this.exited) return;
      this.exited = true;
      this.term.write('\r\n\x1b[90m[Process exited — press Enter to restart]\x1b[0m\r\n');
      renderTabs();
    };
    ws.send(JSON.stringify({ AuthToken: '', columns: this.term.cols, rows: this.term.rows }));
    if (this.command) setTimeout(() => this.send('0' + this.command + '\r'), 250);
  }

  async restart() {
    this.exited = true;
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
    this.command = null;
    this.term.dispose();
    this.el.innerHTML = '';
    this.initTerm();
    this.exited = false;
    await this.start();
    this.term.focus();
    renderTabs();
  }

  onTitle(title) {
    // Shell titles look like "user@host:/path" — show the folder name.
    const i = title.indexOf(':');
    const path = (i >= 0 ? title.slice(i + 1) : title).trim();
    if (path && !this.command) this.name = basename(path.replace(/\/+$/, '')) || path;
    renderTabs();
  }

  send(str) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(str);
  }

  fitNow() {
    try {
      if (this.el.offsetParent) this.fit.fit();
    } catch {
      /* not visible */
    }
  }

  dispose() {
    this.exited = true;
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.term.dispose();
    this.el.remove();
  }
}

// ------------------------------------------------------------------ panel

function renderTabs() {
  const list = els.list;
  if (!list) return;
  list.innerHTML = '';
  sessions.forEach((s, i) => {
    const tab = h(
      'button',
      {
        class: `term-tab ${s === active ? 'active' : ''} ${s.exited ? 'exited' : ''}`,
        title: s.cwd,
        onClick: () => activate(s),
      },
      h('span', { html: icon('terminal') }),
      h('span', { class: 'term-tab-name' }, `${i + 1}: ${s.name}`),
      h('span', {
        class: 'term-tab-close',
        html: icon('close'),
        onClick: (e) => {
          e.stopPropagation();
          kill(s);
        },
      }),
    );
    onContext(tab, (x, y) =>
      contextMenu(x, y, [
        { label: 'Kill Terminal', icon: 'trash', run: () => kill(s) },
        { label: 'Restart Terminal', icon: 'refresh', run: () => s.restart() },
        { label: 'Clear', run: () => s.term.clear() },
      ]),
    );
    list.append(tab);
  });
}

function activate(s) {
  active = s;
  for (const x of sessions) x.el.hidden = x !== s;
  renderTabs();
  requestAnimationFrame(() => {
    s.fitNow();
    s.term.focus();
  });
}

function kill(s) {
  const i = sessions.indexOf(s);
  if (i < 0) return;
  sessions.splice(i, 1);
  s.dispose();
  if (active === s) active = null;
  if (sessions.length) activate(sessions[Math.min(i, sessions.length - 1)]);
  else terminal.hide();
  renderTabs();
}

function setHeight(px, persist = false) {
  const area = els.panel.parentElement;
  const max = Math.max(120, (area?.getBoundingClientRect().height ?? window.innerHeight) - 120);
  const hgt = Math.round(Math.max(90, Math.min(px, max)));
  els.panel.style.height = hgt + 'px';
  active?.fitNow();
  if (persist) updateSettings({ panelHeight: hgt });
}

function setupResizer(handle) {
  let startY = 0;
  let startH = 0;
  const move = (e) => setHeight(startH - (e.clientY - startY));
  const up = (e) => {
    handle.releasePointerCapture(e.pointerId);
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', up);
    setHeight(els.panel.getBoundingClientRect().height, true);
  };
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    startY = e.clientY;
    startH = els.panel.getBoundingClientRect().height;
    handle.setPointerCapture(e.pointerId);
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });
}

async function packageScripts(root) {
  try {
    const { text } = await fs.readText(join(root, 'package.json'));
    return Object.keys(JSON.parse(text).scripts ?? {});
  } catch {
    return [];
  }
}

export const terminal = {
  /** Builds the bottom panel; returns [resizeHandle, panel]. */
  build() {
    els.list = h('div', { class: 'term-tabs' });
    els.body = h('div', { class: 'term-body' });
    els.maxBtn = iconButton('chevronDown', 'Maximize Panel Size', () => terminal.toggleMaximize(), 'max-btn');
    els.panel = h(
      'div',
      { class: 'bottom-panel', hidden: true },
      h(
        'div',
        { class: 'bottom-panel-header' },
        h('span', { class: 'bottom-panel-title' }, 'TERMINAL'),
        els.list,
        h('span', { class: 'spacer' }),
        iconButton('plus', 'New Terminal (Ctrl+Shift+`)', () => terminal.create()),
        iconButton('play', 'Run Task…', () => terminal.runTask()),
        iconButton('trash', 'Kill Terminal', () => active && kill(active)),
        els.maxBtn,
        iconButton('close', 'Hide Panel (Ctrl+`)', () => terminal.hide()),
      ),
      els.body,
    );
    els.handle = h('div', { class: 'panel-resizer', hidden: true });
    setupResizer(els.handle);
    new ResizeObserver(() => active?.fitNow()).observe(els.body);
    bus.on('settings', (patch) => {
      if ('fontSize' in patch) for (const s of sessions) {
        s.term.options.fontSize = Math.max(10, settings.fontSize - 1);
        s.fitNow();
      }
    });
    return [els.handle, els.panel];
  },

  isVisible() {
    return !els.panel.hidden;
  },

  show() {
    els.panel.hidden = false;
    els.handle.hidden = false;
    setHeight(settings.panelHeight ?? 260);
    if (!sessions.length) return terminal.create();
    activate(active ?? sessions[0]);
  },

  hide() {
    els.panel.hidden = true;
    els.handle.hidden = true;
    els.panel.classList.remove('maximized');
    app.editor.getView()?.focus();
  },

  /** Ctrl+`: show + focus the terminal, or hide it when it already has focus. */
  toggle() {
    if (terminal.isVisible() && els.panel.contains(document.activeElement)) terminal.hide();
    else terminal.show();
  },

  toggleMaximize() {
    const max = els.panel.classList.toggle('maximized');
    els.maxBtn.title = max ? 'Restore Panel Size' : 'Maximize Panel Size';
    requestAnimationFrame(() => active?.fitNow());
  },

  /** Opens a new terminal in the project folder, optionally running a command. */
  async create(command) {
    const cwd = app.workspace.root ?? '/storage/emulated/0';
    els.panel.hidden = false;
    els.handle.hidden = false;
    setHeight(settings.panelHeight ?? 260);
    const s = new Session(cwd, command);
    sessions.push(s);
    els.body.append(s.el);
    activate(s);
    await s.start();
    s.fitNow();
    renderTabs();
    return s;
  },

  /** Runs a command in the active terminal (creating one if needed). */
  async run(command) {
    if (!active || active.exited) return terminal.create(command);
    terminal.show();
    active.send('0' + command + '\r');
  },

  async runTask() {
    const root = app.workspace.root;
    const scripts = root ? await packageScripts(root) : [];
    quickPick({
      placeholder: 'Select a task to run in a new terminal',
      emptyText: 'No package.json scripts found — type a command and press Enter',
      provider: (q) => {
        const items = scripts
          .filter((s) => !q || s.toLowerCase().includes(q.toLowerCase()))
          .map((s) => ({ label: `npm run ${s}`, icon: icon('play'), command: `npm run ${s}` }));
        if (q && !items.length) items.push({ label: q, description: 'run command', icon: icon('terminal'), command: q });
        return items;
      },
      onAccept: (it) => {
        app.editor.saveAll();
        terminal.create(it.command);
      },
    });
  },

  focused() {
    return !!els.panel && els.panel.contains(document.activeElement);
  },
};
