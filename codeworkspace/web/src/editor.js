// Editor area: CodeMirror view, tabs, breadcrumbs, editor actions, navigation history.
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightSpecialChars, drawSelection, dropCursor,
  rectangularSelection, crosshairCursor, highlightActiveLine } from '@codemirror/view';
import { EditorState, EditorSelection, Compartment } from '@codemirror/state';
import { history, defaultKeymap, historyKeymap, indentWithTab, redo, undo, indentLess, indentMore, toggleComment,
  selectAll, moveLineUp, moveLineDown, copyLineUp, copyLineDown, selectLine, selectParentSyntax, deleteLine,
  toggleBlockComment } from '@codemirror/commands';
import { foldGutter, indentOnInput, bracketMatching, foldKeymap, indentUnit } from '@codemirror/language';
import { searchKeymap, highlightSelectionMatches, search, openSearchPanel, selectNextOccurrence, selectSelectionMatches } from '@codemirror/search';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';

import { app, bus } from './app.js';
import { fs } from './native.js';
import { h, iconButton, toast, errorToast, choose, onContext, contextMenu, prompt, esc } from './ui.js';
import { icon, fileBadge } from './icons.js';
import { basename, dirname, extname, relative, join, isInside } from './path.js';
import { settings, updateSettings } from './settings.js';
import { languageId, languageName, loadLanguage } from './languages.js';
import { darkTheme } from './theme.js';
import { extractSymbols } from './symbols.js';
import { canFormat, formatText } from './format.js';

const langComp = new Compartment();
const tabComp = new Compartment();
const wrapComp = new Compartment();
const gutterComp = new Compartment();

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg']);

let view;
let tabs = [];
let active = null;
let tabSeq = 0;
const closedStack = [];
const navBack = [];
const navForward = [];
let els = {};
let dirtyTimer = null;
let autoSaveTimer = null;
const AUTO_SAVE_DELAY = 1000;
let outlineTimer = null;
// Open files whose editor state (document, undo history, syntax tree) stays in memory. Older
// clean tabs keep only their path and cursor and are re-read from disk when activated.
const MAX_LIVE_TABS = 8;

// ------------------------------------------------------------------ setup

function indentConfig() {
  return [EditorState.tabSize.of(settings.tabSize), indentUnit.of(settings.insertSpaces ? ' '.repeat(settings.tabSize) : '\t')];
}

function extensions(lineSep) {
  return [
    gutterComp.of(settings.lineNumbers ? [lineNumbers(), foldGutter()] : [foldGutter()]),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    search({ top: true }),
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      indentWithTab,
      { key: 'Mod-Shift-z', run: redo, preventDefault: true },
      { key: 'Mod-d', run: selectNextOccurrence, preventDefault: true },
      { key: 'Mod-/', run: toggleComment },
    ]),
    darkTheme,
    langComp.of([]),
    tabComp.of(indentConfig()),
    wrapComp.of(settings.wordWrap ? EditorView.lineWrapping : []),
    lineSep ? EditorState.lineSeparator.of(lineSep) : [],
    EditorView.contentAttributes.of({ autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', translate: 'no' }),
    EditorView.updateListener.of(onUpdate),
  ];
}

function onUpdate(u) {
  const tab = active;
  if (!tab || tab.kind !== 'file' || u.view !== view) return;
  if (u.docChanged) {
    if (!tab.dirty) {
      tab.dirty = true;
      bus.emit('dirty', tab);
      renderTabs();
    }
    clearTimeout(dirtyTimer);
    dirtyTimer = setTimeout(() => {
      const dirty = !view.state.doc.eq(tab.savedDoc);
      if (dirty !== tab.dirty) {
        tab.dirty = dirty;
        bus.emit('dirty', tab);
        renderTabs();
      }
    }, 300);
    clearTimeout(outlineTimer);
    outlineTimer = setTimeout(() => bus.emit('outline'), 600);
    if (settings.autoSave) {
      clearTimeout(autoSaveTimer);
      autoSaveTimer = setTimeout(() => tab.dirty && save(tab, { auto: true }), AUTO_SAVE_DELAY);
    }
  }
  if (u.docChanged || u.selectionSet) emitCursor();
}

function emitCursor() {
  if (!active || active.kind !== 'file') return bus.emit('cursor', null);
  const st = view.state;
  const sel = st.selection.main;
  const line = st.doc.lineAt(sel.head);
  bus.emit('cursor', {
    line: line.number,
    col: sel.head - line.from + 1,
    selected: sel.empty ? 0 : sel.to - sel.from,
    cursors: st.selection.ranges.length,
    lang: languageName(active.langId),
    eol: active.eol,
  });
}

export function initEditor(container) {
  els.root = container;
  els.tabbar = h('div', { class: 'tabbar', role: 'tablist' });
  els.actions = h('div', { class: 'editor-actions' });
  els.tabrow = h('div', { class: 'tabrow' }, els.tabbar, els.actions);
  els.crumbs = h('div', { class: 'breadcrumbs' });
  els.cmHost = h('div', { class: 'cm-host' });
  els.altHost = h('div', { class: 'alt-host' });
  els.stack = h('div', { class: 'editor-stack' }, els.cmHost, els.altHost);
  container.append(els.tabrow, els.crumbs, els.stack);

  view = new EditorView({ parent: els.cmHost, state: EditorState.create({ doc: '', extensions: extensions() }) });
  applyFontSize();
  setupPinchZoom(els.cmHost);

  bus.on('settings', (patch) => {
    if ('fontSize' in patch) applyFontSize();
    if ('tabSize' in patch || 'insertSpaces' in patch || 'wordWrap' in patch || 'lineNumbers' in patch) reconfigureAll();
  });
  bus.on('git-status', () => renderTabs());
  showAlt();
}

function applyFontSize() {
  document.documentElement.style.setProperty('--editor-font-size', settings.fontSize + 'px');
  view?.requestMeasure();
}

function reconfigureAll() {
  const effects = [
    tabComp.reconfigure(indentConfig()),
    wrapComp.reconfigure(settings.wordWrap ? EditorView.lineWrapping : []),
    gutterComp.reconfigure(settings.lineNumbers ? [lineNumbers(), foldGutter()] : [foldGutter()]),
  ];
  for (const t of tabs) {
    if (t.kind !== 'file' || !t.state) continue;
    if (t === active) view.dispatch({ effects });
    else t.state = t.state.update({ effects }).state;
  }
}

// ------------------------------------------------------------------- tabs

function currentState(tab) {
  return tab === active && tab.kind === 'file' && tab.loaded ? view.state : tab.state;
}

export function getTabs() {
  return tabs;
}

export function activeTab() {
  return active;
}

export function getView() {
  return view;
}

export function findTab(path) {
  return tabs.find((t) => t.kind === 'file' && t.path === path);
}

export function isDirty(path) {
  return !!findTab(path)?.dirty;
}

export function dirtyTabs() {
  return tabs.filter((t) => t.kind === 'file' && t.dirty);
}

async function loadTab(tab) {
  const res = await fs.readText(tab.path);
  const eol = res.text.includes('\r\n') ? 'CRLF' : 'LF';
  tab.eol = eol;
  tab.mtime = res.mtime;
  tab.state = EditorState.create({
    doc: res.text,
    selection: { anchor: Math.min(tab.restorePos ?? 0, res.text.length) },
    extensions: extensions(eol === 'CRLF' ? '\r\n' : null),
  });
  tab.savedDoc = tab.state.doc;
  tab.dirty = false;
  tab.loaded = true;
  tab.langId = languageId(tab.path);
  loadLanguage(tab.langId).then((lang) => {
    const effects = langComp.reconfigure(lang);
    if (tab === active) view.dispatch({ effects });
    else if (tab.state) tab.state = tab.state.update({ effects }).state;
  });
}

function newTab(props) {
  return { id: ++tabSeq, kind: 'file', dirty: false, loaded: false, preview: false, scrollTop: 0, ...props };
}

function placeTab(tab) {
  const i = active ? tabs.indexOf(active) : tabs.length - 1;
  tabs.splice(i + 1, 0, tab);
}

/**
 * Opens a file in a tab (or focuses its existing tab).
 * opts: {line (1-based), col (1-based), length, history: bool, focus: bool}
 */
export async function openFile(path, opts = {}) {
  const { line, col = 1, length = 0, focus = true } = opts;
  if (opts.history !== false) pushNav();
  let tab = findTab(path);
  if (!tab) {
    if (IMAGE_EXT.has(extname(path)) && extname(path) !== 'svg') {
      return openSpecial({ key: 'img:' + path, kind: 'image', path, title: basename(path) });
    }
    tab = newTab({ path, title: basename(path) });
    try {
      await loadTab(tab);
    } catch (e) {
      if (e.code === 'EBINARY' && IMAGE_EXT.has(extname(path))) {
        return openSpecial({ key: 'img:' + path, kind: 'image', path, title: basename(path) });
      }
      if (e.code === 'EBINARY') return toast(`${basename(path)} is a binary file and can't be opened`, { type: 'warn' });
      return errorToast(`Can't open ${basename(path)}`, e);
    }
    placeTab(tab);
  }
  await activate(tab, { focus: focus && line == null });
  if (line != null) revealLine(line, col, length, focus);
  app.explorer?.reveal(path);
  return tab;
}

/** Opens a non-editor tab (diff, image). Reuses a tab with the same key. */
export function openSpecial(props) {
  let tab = tabs.find((t) => t.key === props.key);
  if (tab) Object.assign(tab, props);
  else {
    tab = newTab({ ...props, loaded: true });
    placeTab(tab);
  }
  activate(tab);
  return tab;
}

export async function activate(tab, { focus = false } = {}) {
  // The view holds the live state of the active tab; stash it before switching (or re-activating).
  if (active && active.kind === 'file' && active.loaded) {
    active.state = view.state;
    active.scrollTop = view.scrollDOM.scrollTop;
    // Auto Save also saves when switching away from a file (VS Code "onFocusChange").
    if (settings.autoSave && active.dirty && active !== tab) {
      clearTimeout(autoSaveTimer);
      save(active, { auto: true });
    }
  }
  let justLoaded = false;
  if (tab?.kind === 'file' && !tab.loaded) {
    try {
      await loadTab(tab);
      justLoaded = true;
    } catch (e) {
      errorToast(`Can't open ${tab.title}`, e);
      tabs = tabs.filter((t) => t !== tab);
      if (active === tab) active = null;
      return activate(tabs[0] ?? null);
    }
  }
  active = tab;
  if (tab) tab.usedAt = Date.now();
  releaseIdleTabs();
  if (tab?.kind === 'file') {
    view.setState(tab.state);
    if (justLoaded && tab.restorePos) {
      view.dispatch({ effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: 'center' }) });
    } else {
      const top = tab.scrollTop;
      requestAnimationFrame(() => (view.scrollDOM.scrollTop = top));
    }
    if (focus) view.focus();
    checkExternalChange(tab);
  }
  showAlt();
  renderTabs();
  renderCrumbs();
  emitCursor();
  bus.emit('active-tab', tab);
  bus.emit('outline');
  bus.emit('tabs-changed');
}

/** Unloads the least recently used clean tabs beyond MAX_LIVE_TABS (dirty tabs always stay). */
function releaseIdleTabs() {
  const idle = tabs.filter((t) => t.kind === 'file' && t.loaded && t !== active && !t.dirty);
  const excess = idle.length - (MAX_LIVE_TABS - 1);
  if (excess <= 0) return;
  idle.sort((a, b) => (a.usedAt ?? 0) - (b.usedAt ?? 0));
  for (const t of idle.slice(0, excess)) {
    t.restorePos = t.state.selection.main.head;
    t.state = null;
    t.savedDoc = null;
    t.loaded = false;
  }
}

function showAlt() {
  const tab = active;
  const alt = !tab || tab.kind !== 'file' || tab.preview;
  els.cmHost.hidden = alt;
  els.altHost.hidden = !alt;
  els.altHost.innerHTML = '';
  els.altHost.className = 'alt-host';
  if (!tab) {
    els.altHost.append(app.welcome.render());
  } else if (tab.kind === 'diff') {
    app.diffView.render(els.altHost, tab);
  } else if (tab.render) {
    tab.render(els.altHost);
  } else if (tab.kind === 'image') {
    els.altHost.classList.add('image-view');
    els.altHost.append(h('img', { src: '/__fs' + encodeURI(tab.path), alt: tab.title }));
  } else if (tab.preview) {
    app.markdown.render(els.altHost, view.state.doc.toString(), tab.path);
  }
}

export function revealLine(line, col = 1, length = 0, focus = true) {
  const doc = view.state.doc;
  const l = doc.line(Math.max(1, Math.min(line, doc.lines)));
  const from = Math.min(l.from + Math.max(0, col - 1), l.to);
  const to = Math.min(from + length, doc.length);
  view.dispatch({ selection: EditorSelection.range(from, to), effects: EditorView.scrollIntoView(from, { y: 'center' }) });
  if (focus) view.focus();
}

/** Closes a tab. Returns false if the user cancelled. */
export async function closeTab(tab, { force = false } = {}) {
  if (!tab) return true;
  if (tab.dirty && !force) {
    if (tab !== active) await activate(tab);
    const r = await choose(`Save changes to ${tab.title}?`, 'Your changes will be lost if you don\'t save them.', [
      { label: 'Cancel', value: 'cancel' },
      { label: "Don't Save", value: 'discard', danger: true },
      { label: 'Save', value: 'save', primary: true },
    ]);
    if (r === 'cancel' || r == null) return false;
    if (r === 'save' && !(await save(tab))) return false;
  }
  const i = tabs.indexOf(tab);
  if (i < 0) return true;
  tabs.splice(i, 1);
  if (tab.kind === 'file') {
    closedStack.push(tab.path);
    if (closedStack.length > 30) closedStack.shift();
  }
  if (tab === active) {
    active = null;
    await activate(tabs[Math.min(i, tabs.length - 1)] ?? null);
  } else {
    renderTabs();
    bus.emit('tabs-changed');
  }
  return true;
}

export async function closeTabs(list) {
  for (const t of [...list]) if (!(await closeTab(t))) return false;
  return true;
}

export function reopenClosed() {
  const path = closedStack.pop();
  if (path) openFile(path);
}

export function cycleTab(dir) {
  if (tabs.length < 2) return;
  const i = tabs.indexOf(active);
  activate(tabs[(i + dir + tabs.length) % tabs.length], { focus: true });
}

function moveTab(tab, dir) {
  const i = tabs.indexOf(tab);
  const j = i + dir;
  if (j < 0 || j >= tabs.length) return;
  [tabs[i], tabs[j]] = [tabs[j], tabs[i]];
  renderTabs();
  bus.emit('tabs-changed');
}

// ---------------------------------------------------------------- saving

/** Saves a tab. Auto saves skip format-on-save (like VS Code's delayed auto save). */
export async function save(tab = active, { skipFormat = false, auto = false } = {}) {
  if (!tab || tab.kind !== 'file' || !tab.loaded) return true;
  if (auto && (!tab.dirty || tab.missing)) return true;
  if (settings.formatOnSave && !skipFormat && !auto && canFormat(tab.path)) {
    await formatDocument(tab, { quiet: true });
  }
  const state = currentState(tab);
  try {
    const res = await fs.writeText(tab.path, state.doc.toString());
    tab.savedDoc = state.doc;
    tab.mtime = res.mtime;
    tab.dirty = false;
    renderTabs();
    bus.emit('dirty', tab);
    bus.emit('saved', tab);
    if (tab.preview && tab === active) showAlt();
    return true;
  } catch (e) {
    errorToast(`Failed to save ${tab.title}`, e);
    return false;
  }
}

export async function saveAll(opts) {
  for (const t of dirtyTabs()) await save(t, opts);
}

export async function saveAs() {
  const tab = active;
  if (!tab || tab.kind !== 'file') return;
  const root = app.workspace.root ?? dirname(tab.path);
  const rel = await prompt('Save As', { value: relative(root, tab.path), message: `Path relative to ${basename(root)}` });
  if (!rel) return;
  const target = rel.startsWith('/') ? rel : join(root, rel);
  if (await fs.exists(target)) {
    const ok = await choose('File exists', `${basename(target)} already exists. Overwrite?`, [
      { label: 'Cancel', value: false }, { label: 'Overwrite', value: true, danger: true },
    ]);
    if (!ok) return;
  }
  try {
    await fs.mkdir(dirname(target), true);
    await fs.writeText(target, view.state.doc.toString());
    // Revert the original tab to its saved state and open the new file in its place.
    tab.dirty = false;
    await closeTab(tab, { force: true });
    await openFile(target);
    bus.emit('fs-changed', dirname(target));
  } catch (e) {
    errorToast('Save As failed', e);
  }
}

/** Reloads a clean tab from disk, or offers to when it has unsaved edits. */
export async function checkExternalChange(tab) {
  if (!tab || tab.kind !== 'file' || !tab.loaded) return;
  let st;
  try {
    st = await fs.stat(tab.path);
  } catch (e) {
    if (e.code === 'ENOENT' && !tab.missing) {
      tab.missing = true;
      toast(`${tab.title} was deleted from disk`, { type: 'warn' });
    }
    return;
  }
  tab.missing = false;
  if (st.mtimeMs === tab.mtime) return;
  if (tab.dirty) {
    tab.mtime = st.mtimeMs;
    toast(`${tab.title} changed on disk`, {
      type: 'warn',
      timeout: 8000,
      action: { label: 'Reload', run: () => reloadFromDisk(tab) },
    });
  } else {
    await reloadFromDisk(tab);
  }
}

async function reloadFromDisk(tab) {
  try {
    const res = await fs.readText(tab.path);
    const state = currentState(tab);
    const sel = state.selection.main.head;
    const tr = state.update({
      changes: { from: 0, to: state.doc.length, insert: res.text },
      selection: { anchor: Math.min(sel, res.text.length) },
    });
    if (tab === active) view.dispatch(tr);
    else tab.state = tr.state;
    tab.savedDoc = tr.state.doc;
    tab.mtime = res.mtime;
    tab.dirty = false;
    renderTabs();
    bus.emit('dirty', tab);
    if (tab === active && tab.preview) showAlt();
  } catch (e) {
    errorToast(`Reload failed for ${tab.title}`, e);
  }
}

export async function checkAllExternal() {
  for (const t of tabs) if (t.kind === 'file' && t.loaded) await checkExternalChange(t);
}

/** Reloads clean tabs for the given paths (e.g. after project-wide replace or git discard). */
export async function reloadPaths(paths) {
  const set = new Set(paths);
  for (const t of tabs) if (t.kind === 'file' && t.loaded && set.has(t.path) && !t.dirty) await reloadFromDisk(t);
}

// ------------------------------------------------- file-system integration

/** Updates tabs after a rename/move of a file or folder. */
export function pathRenamed(from, to) {
  for (const t of tabs) {
    if (t.path && isInside(from, t.path)) {
      t.path = to + t.path.slice(from.length);
      t.title = basename(t.path);
      if (t.kind === 'file') t.langId = languageId(t.path);
    }
  }
  renderTabs();
  renderCrumbs();
  bus.emit('tabs-changed');
}

/** Closes tabs for a deleted file or folder (without prompting). */
export async function pathDeleted(path) {
  for (const t of tabs.filter((t) => t.path && isInside(path, t.path))) await closeTab(t, { force: true });
}

// -------------------------------------------------------------- formatting

export async function formatDocument(tab = active, { quiet = false, selection = false } = {}) {
  if (!tab || tab.kind !== 'file') return;
  if (!canFormat(tab.path)) {
    if (!quiet) toast(`No formatter for ${extname(tab.path) || 'this file'} files`, { type: 'warn' });
    return;
  }
  const state = currentState(tab);
  const text = state.doc.toString();
  const sel = state.selection.main;
  try {
    const range = selection && !sel.empty ? { from: sel.from, to: sel.to } : undefined;
    const res = await formatText(text, tab.path, { root: app.workspace.root, cursorOffset: sel.head, range });
    if (res.formatted === text) return;
    const tr = state.update({
      changes: { from: 0, to: state.doc.length, insert: res.formatted },
      selection: { anchor: Math.max(0, Math.min(res.cursorOffset, res.formatted.length)) },
      userEvent: 'format',
    });
    if (tab === active) view.dispatch(tr);
    else tab.state = tr.state;
  } catch (e) {
    const msg = String(e.message ?? e).split('\n')[0];
    toast(`Format failed: ${msg}`, { type: 'error', timeout: 6000 });
  }
}

// ---------------------------------------------------------- search / goto

export function openFind(replace = false) {
  if (!active || active.kind !== 'file' || active.preview) return;
  openSearchPanel(view);
  setTimeout(() => {
    const sel = replace ? '.cm-search input[name=replace]' : '.cm-search input[name=search]';
    const input = view.dom.querySelector(sel);
    input?.focus();
    input?.select();
  }, 30);
}

const CM_COMMANDS = {
  undo, redo, selectAll, toggleComment, toggleBlockComment, moveLineUp, moveLineDown, copyLineUp, copyLineDown,
  selectLine, selectParentSyntax, deleteLine, indentMore, indentLess, selectNextOccurrence, selectSelectionMatches,
};

/** Runs a CodeMirror command by name on the active editor. */
export function exec(name) {
  if (!active || active.kind !== 'file' || active.preview) return;
  view.focus();
  CM_COMMANDS[name]?.(view);
}

export function symbols() {
  if (!active || active.kind !== 'file' || !active.loaded) return [];
  return extractSymbols(currentState(active).doc.toString(), active.langId);
}

export function lineCount() {
  return active?.kind === 'file' ? view.state.doc.lines : 0;
}

export function togglePreview() {
  if (!active || active.kind !== 'file') return;
  if (!['md', 'markdown', 'mdx'].includes(extname(active.path))) {
    return toast('Preview is available for Markdown files', { type: 'warn' });
  }
  active.preview = !active.preview;
  showAlt();
  renderCrumbs();
  if (!active.preview) view.focus();
}

// ---------------------------------------------------------- nav history

function currentLocation() {
  if (!active || active.kind !== 'file' || !active.loaded) return null;
  const head = view.state.selection.main.head;
  return { path: active.path, line: view.state.doc.lineAt(head).number };
}

export function pushNav() {
  const loc = currentLocation();
  if (!loc) return;
  const last = navBack[navBack.length - 1];
  if (last && last.path === loc.path && last.line === loc.line) return;
  navBack.push(loc);
  if (navBack.length > 100) navBack.shift();
  navForward.length = 0;
}

export async function navigate(dir) {
  const from = dir < 0 ? navBack : navForward;
  const to = dir < 0 ? navForward : navBack;
  const loc = from.pop();
  if (!loc) return;
  const cur = currentLocation();
  if (cur) to.push(cur);
  await openFile(loc.path, { line: loc.line, history: false });
  renderCrumbs();
}

// -------------------------------------------------------------- rendering

function tabLabelMap() {
  // Disambiguate duplicate file names with their parent folder.
  const counts = {};
  for (const t of tabs) counts[t.title] = (counts[t.title] ?? 0) + 1;
  return counts;
}

function renderTabs() {
  const bar = els.tabbar;
  if (!bar) return;
  const counts = tabLabelMap();
  const scroll = bar.scrollLeft;
  bar.innerHTML = '';
  const gitMap = app.workspace?.gitMap ?? {};
  const root = app.workspace?.root;
  for (const t of tabs) {
    const rel = root && t.path ? relative(root, t.path) : '';
    const git = t.kind === 'file' ? gitMap[rel] : null;
    const el = h(
      'div',
      {
        class: `tab ${t === active ? 'active' : ''} ${t.dirty ? 'dirty' : ''} ${git ? 'git-' + git.toLowerCase() : ''} ${t.kind !== 'file' ? 'special' : ''}`,
        role: 'tab',
        title: t.path ?? t.title,
        draggable: 'true',
        onClick: () => activate(t, { focus: false }),
        onAuxclick: (e) => e.button === 1 && closeTab(t),
      },
      h('span', { class: 'tab-icon', html: t.kind === 'diff' ? icon('git') : fileBadge(t.path ?? t.title) }),
      h('span', { class: 'tab-title' }, t.title),
      counts[t.title] > 1 && t.path ? h('span', { class: 'tab-desc' }, basename(dirname(t.path))) : null,
      h('button', {
        class: 'tab-close',
        'aria-label': 'Close',
        html: `<span class="dot"></span>${icon('close')}`,
        onClick: (e) => {
          e.stopPropagation();
          closeTab(t);
        },
      }),
    );
    el.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/tab', String(t.id)));
    el.addEventListener('dragover', (e) => e.preventDefault());
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      const src = tabs.find((x) => String(x.id) === e.dataTransfer.getData('text/tab'));
      if (!src || src === t) return;
      tabs.splice(tabs.indexOf(src), 1);
      tabs.splice(tabs.indexOf(t), 0, src);
      renderTabs();
      bus.emit('tabs-changed');
    });
    onContext(el, (x, y) => tabMenu(t, x, y));
    bar.append(el);
  }
  bar.scrollLeft = scroll;
  bar.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function tabMenu(t, x, y) {
  const i = tabs.indexOf(t);
  contextMenu(x, y, [
    { label: 'Close', icon: 'close', shortcut: 'Ctrl+W', run: () => closeTab(t) },
    { label: 'Close Others', run: () => closeTabs(tabs.filter((o) => o !== t)) },
    { label: 'Close to the Right', disabled: i === tabs.length - 1, run: () => closeTabs(tabs.slice(i + 1)) },
    { label: 'Close Saved', run: () => closeTabs(tabs.filter((o) => !o.dirty)) },
    { label: 'Close All', run: () => closeTabs(tabs) },
    '-',
    { label: 'Move Left', icon: 'back', disabled: i === 0, run: () => moveTab(t, -1) },
    { label: 'Move Right', icon: 'forward', disabled: i === tabs.length - 1, run: () => moveTab(t, 1) },
    '-',
    t.path && { label: 'Copy Path', icon: 'copy', run: () => app.copy(t.path) },
    t.path && app.workspace.root && { label: 'Copy Relative Path', run: () => app.copy(relative(app.workspace.root, t.path)) },
    t.path && { label: 'Reveal in Explorer', icon: 'files', run: () => app.explorer.reveal(t.path, true) },
  ]);
}

function renderCrumbs() {
  const c = els.crumbs;
  c.innerHTML = '';
  els.actions.innerHTML = '';
  bus.emit('nav-state', { back: navBack.length > 0, forward: navForward.length > 0 });
  const tab = active;
  c.hidden = !tab || !tab.path;
  const trail = h('div', { class: 'crumb-trail' });
  c.append(trail);
  if (!tab || !tab.path) return;
  const root = app.workspace.root;
  const rel = root && isInside(root, tab.path) ? relative(root, tab.path) : tab.path;
  const parts = rel.split('/').filter(Boolean);
  parts.forEach((p, i) => {
    const full = root && isInside(root, tab.path) ? join(root, ...parts.slice(0, i + 1)) : '/' + parts.slice(0, i + 1).join('/');
    const last = i === parts.length - 1;
    trail.append(
      h('button', {
        class: `crumb ${last ? 'last' : ''}`,
        html: (last ? fileBadge(p) : '') + esc(p),
        onClick: () => (last ? app.commands.run('goToSymbol') : app.explorer.reveal(full, true)),
      }),
    );
    if (!last) trail.append(h('span', { class: 'crumb-sep', html: icon('chevronRight') }));
  });
  if (tab.kind === 'diff') trail.append(h('span', { class: 'crumb-note' }, tab.diffLabel ?? ''));
  trail.scrollLeft = trail.scrollWidth;

  const actions = els.actions;
  if (tab.kind === 'file') {
    if (['md', 'markdown', 'mdx'].includes(extname(tab.path))) {
      actions.append(iconButton(tab.preview ? 'edit' : 'eye', tab.preview ? 'Edit' : 'Preview', togglePreview, 'labelled'));
    }
    if (canFormat(tab.path)) actions.append(iconButton('format', 'Format Document (Shift+Alt+F)', () => formatDocument()));
  } else if (tab.kind === 'diff' && tab.path) {
    actions.append(iconButton('files', 'Open File', () => openFile(tab.path)));
  }
  if (tab) actions.append(iconButton('moreV', 'More Actions…', (e) => tabMenu(tab, e.currentTarget.getBoundingClientRect().left, e.currentTarget.getBoundingClientRect().bottom)));
}

// --------------------------------------------------------------- pinch zoom

function setupPinchZoom(el) {
  let startDist = 0;
  let startSize = 0;
  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  el.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      startDist = dist(e.touches);
      startSize = settings.fontSize;
    }
  }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    if (e.touches.length !== 2 || !startDist) return;
    e.preventDefault();
    const size = Math.round(Math.max(9, Math.min(32, startSize * (dist(e.touches) / startDist))));
    if (size !== settings.fontSize) {
      settings.fontSize = size;
      applyFontSize();
    }
  }, { passive: false });
  el.addEventListener('touchend', (e) => {
    if (startDist && e.touches.length < 2) {
      startDist = 0;
      updateSettings({ fontSize: settings.fontSize });
    }
  });
}

export function zoom(delta) {
  updateSettings({ fontSize: Math.max(9, Math.min(32, settings.fontSize + delta)) });
}

// ---------------------------------------------------------- persistence

export function serialize() {
  return {
    tabs: tabs
      .filter((t) => t.kind === 'file')
      .map((t) => {
        const st = currentState(t);
        return { path: t.path, pos: st ? st.selection.main.head : (t.restorePos ?? 0), preview: t.preview };
      }),
    active: active?.kind === 'file' ? active.path : null,
  };
}

/** Restores tabs lazily: only the active one is read from disk now. */
export async function restore(saved) {
  tabs = [];
  active = null;
  for (const s of saved?.tabs ?? []) {
    tabs.push(newTab({ path: s.path, title: basename(s.path), preview: !!s.preview, restorePos: s.pos }));
  }
  const target = tabs.find((t) => t.path === saved?.active) ?? tabs[0] ?? null;
  await activate(target);
}

export async function closeAll({ force = false } = {}) {
  if (!force && !(await closeTabs(dirtyTabs()))) return false;
  tabs = [];
  active = null;
  closedStack.length = 0;
  navBack.length = 0;
  navForward.length = 0;
  await activate(null);
  return true;
}

export function rerender() {
  renderTabs();
  renderCrumbs();
  if (!active) showAlt();
}
