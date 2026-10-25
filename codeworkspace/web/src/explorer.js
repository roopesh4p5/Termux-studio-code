// Explorer side panel: lazy-loaded project tree with git decorations, file operations and outline.
import { app, bus } from './app.js';
import { fs } from './native.js';
import { h, iconButton, onContext, contextMenu, prompt, confirm, errorToast, toast, quickPick, fuzzy } from './ui.js';
import { icon, fileBadge } from './icons.js';
import { basename, dirname, join, relative, extname, isInside } from './path.js';
import { settings } from './settings.js';
import { KIND_ICON } from './symbols.js';

const children = new Map(); // dir -> sorted entries [{name, dir}]
let expanded = new Set();
let selected = null;
let root = null;
let els = {};
let outlineOpen = true;
let outlineStale = false;

function sortEntries(list) {
  return list.sort((a, b) => (a.dir !== b.dir ? (a.dir ? -1 : 1) : a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })));
}

async function loadDir(dir) {
  try {
    const list = await fs.list(dir);
    children.set(dir, sortEntries(list.filter((e) => e.name !== '.git' && (settings.showHidden || !e.name.startsWith('.')))));
  } catch (e) {
    children.set(dir, []);
    if (dir === root) errorToast('Cannot read folder', e);
  }
}

export const explorer = {
  el: null,

  build() {
    els.tree = h('div', { class: 'tree', role: 'tree' });
    els.outlineList = h('div', { class: 'outline-list' });
    els.outlineHeader = h(
      'button',
      { class: 'section-header', onClick: () => { outlineOpen = !outlineOpen; renderOutline(); } },
      h('span', { class: 'chev', html: icon('chevronDown') }),
      'OUTLINE',
    );
    els.outline = h('div', { class: 'outline-section' }, els.outlineHeader, els.outlineList);
    els.title = h('span', { class: 'panel-title' }, 'EXPLORER');
    els.actions = h(
      'div',
      { class: 'panel-actions' },
      iconButton('newFile', 'New File', () => newFile()),
      iconButton('newFolder', 'New Folder', () => newFolder()),
      iconButton('refresh', 'Refresh', () => app.workspace.sync()),
      iconButton('collapse', 'Collapse All', () => {
        expanded = new Set();
        render();
      }),
    );
    this.el = h('div', { class: 'panel explorer' }, h('div', { class: 'panel-header' }, els.title, els.actions), els.tree, els.outline);
    onContext(els.tree, (x, y, e) => {
      if (e.target === els.tree && root) dirMenu(root, x, y);
    });
    bus.on('git-status', render);
    // Typing and switching tabs only touch one or two rows; don't rebuild the tree for them.
    bus.on('dirty', (tab) => {
      const row = tab?.path && rowFor(tab.path);
      if (!row) return;
      const dot = row.querySelector('.row-dirty');
      if (tab.dirty && !dot) row.querySelector('.row-name').after(h('span', { class: 'row-dirty' }));
      else if (!tab.dirty) dot?.remove();
    });
    bus.on('active-tab', (tab) => {
      if (tab?.path) select(tab.path);
    });
    bus.on('outline', renderOutline);
    bus.on('view-shown', (view) => {
      if (view === 'explorer' && outlineStale) renderOutline();
    });
    bus.on('fs-changed', (dir) => explorer.refresh(dir));
    bus.on('workspace', (ws) => {
      if (!ws.root) explorer.unload();
    });
    render();
    return this.el;
  },

  async load(path, expandedList) {
    root = path;
    children.clear();
    expanded = new Set(expandedList.filter((p) => isInside(path, p)));
    expanded.add(path);
    selected = null;
    els.title.textContent = basename(path).toUpperCase();
    await Promise.all([...expanded].map(loadDir));
    render();
  },

  /** Forgets the closed project's tree. */
  unload() {
    root = null;
    children.clear();
    expanded = new Set();
    selected = null;
    render();
    renderOutline();
  },

  expandedList() {
    return [...expanded];
  },

  /**
   * Reloads one directory, or every expanded one (collapsed ones are dropped and re-read
   * when opened). Re-renders only when a listing changed; returns whether one did.
   */
  async refresh(dir) {
    if (!root) return false;
    let dirs;
    if (dir && children.has(dir)) {
      dirs = [dir];
    } else {
      for (const d of [...children.keys()]) if (!expanded.has(d)) children.delete(d);
      dirs = [...expanded];
    }
    const snapshot = () => dirs.map((d) => (children.get(d) ?? []).map((e) => (e.dir ? e.name + '/' : e.name)).join('|')).join('\n');
    const before = snapshot();
    await Promise.all(dirs.map(loadDir));
    if (!root) return false;
    const changed = snapshot() !== before;
    if (changed) render();
    return changed;
  },

  /** Expands to a path and selects it. */
  async reveal(path, show = false) {
    if (!root || !isInside(root, path)) return;
    selected = path;
    let d = dirname(path);
    const chain = [];
    while (isInside(root, d) && d !== root) {
      chain.unshift(d);
      d = dirname(d);
    }
    for (const dir of chain) {
      if (!expanded.has(dir)) {
        expanded.add(dir);
        if (!children.has(dir)) await loadDir(dir);
      }
    }
    render();
    if (show) app.layout.showView('explorer');
    requestAnimationFrame(() => els.tree.querySelector('.tree-row.selected')?.scrollIntoView({ block: 'nearest' }));
  },

  newFile: () => newFile(),
  newFolder: () => newFolder(),
};

// ------------------------------------------------------------------ render

function render() {
  const tree = els.tree;
  if (!tree) return;
  tree.innerHTML = '';
  if (!root) {
    els.title.textContent = 'EXPLORER';
    tree.append(
      h(
        'div',
        { class: 'empty-panel' },
        h('p', {}, 'No folder opened.'),
        h('button', { class: 'btn primary', onClick: () => app.commands.run('openFolder') }, 'Open Folder'),
        h('button', { class: 'btn', onClick: () => app.commands.run('gitClone') }, 'Clone Repository'),
      ),
    );
    return;
  }
  const frag = document.createDocumentFragment();
  renderDir(root, 0, frag);
  tree.append(frag);
}

function rowFor(path) {
  return els.tree.querySelector(`.tree-row[data-path="${CSS.escape(path)}"]`);
}

/** Moves the selection highlight without rebuilding the tree. */
function select(path) {
  if (selected === path) return;
  selected = path;
  els.tree.querySelector('.tree-row.selected')?.classList.remove('selected');
  rowFor(path)?.classList.add('selected');
}

function renderDir(dir, depth, frag) {
  const list = children.get(dir);
  if (!list) return;
  const gitMap = app.workspace.gitMap;
  const gitDirs = app.workspace.gitDirs;
  for (const entry of list) {
    const path = join(dir, entry.name);
    const rel = relative(root, path);
    const isOpen = entry.dir && expanded.has(path);
    const git = entry.dir ? (gitDirs.has(rel) ? '•' : null) : gitMap[rel];
    const dirty = !entry.dir && app.editor.isDirty(path);
    const row = h(
      'div',
      {
        class: `tree-row ${selected === path ? 'selected' : ''} ${git ? 'git-' + (git === '•' ? 'dir' : git.toLowerCase()) : ''}`,
        style: { paddingLeft: 6 + depth * 14 + 'px' },
        role: 'treeitem',
        title: rel,
        dataset: { path },
        onClick: () => onRowClick(path, entry),
      },
      h('span', { class: 'chev', html: entry.dir ? icon(isOpen ? 'chevronDown' : 'chevronRight') : '' }),
      h('span', { class: 'row-icon', html: entry.dir ? icon(isOpen ? 'folderOpen' : 'folder', 'folder-icon') : fileBadge(entry.name) }),
      h('span', { class: 'row-name' }, entry.name),
      dirty ? h('span', { class: 'row-dirty' }) : null,
      git ? h('span', { class: 'row-git' }, git) : null,
    );
    onContext(row, (x, y) => {
      select(path);
      entry.dir ? dirMenu(path, x, y) : fileMenu(path, x, y);
    });
    frag.append(row);
    if (isOpen) renderDir(path, depth + 1, frag);
  }
}

async function onRowClick(path, entry) {
  selected = path;
  if (entry.dir) {
    if (expanded.has(path)) expanded.delete(path);
    else {
      expanded.add(path);
      if (!children.has(path)) await loadDir(path);
    }
    render();
  } else {
    select(path);
    await app.editor.openFile(path);
    app.layout.autoHideSidebar();
  }
}

/** Symbols are re-extracted only while the outline is on screen; otherwise when it next shows. */
function renderOutline() {
  const list = els.outlineList;
  if (!list) return;
  els.outline.classList.toggle('collapsed', !outlineOpen);
  if (outlineOpen && !app.layout?.isVisible('explorer')) {
    outlineStale = true;
    return;
  }
  outlineStale = false;
  list.innerHTML = '';
  if (!outlineOpen) return;
  const syms = app.editor.symbols();
  if (!syms.length) {
    list.append(h('div', { class: 'muted pad' }, app.editor.activeTab()?.kind === 'file' ? 'No symbols found' : 'No file open'));
    return;
  }
  for (const s of syms.slice(0, 500)) {
    list.append(
      h(
        'div',
        {
          class: 'outline-row',
          style: { paddingLeft: 10 + s.depth * 12 + 'px' },
          onClick: () => {
            app.editor.pushNav();
            app.editor.revealLine(s.line + 1, 1, 0, false);
          },
        },
        h('span', { class: `sym-kind sym-${s.kind}` }, KIND_ICON[s.kind] ?? '•'),
        h('span', { class: 'row-name' }, s.name),
        h('span', { class: 'muted small' }, String(s.line + 1)),
      ),
    );
  }
}

// ---------------------------------------------------------------- actions

function targetDir() {
  if (!selected) return root;
  if (children.has(selected) || expanded.has(selected)) return selected;
  return dirname(selected);
}

async function newFile(dir = targetDir()) {
  if (!root) return app.commands.run('openFolder');
  const name = await prompt('New File', { placeholder: 'name.ext  (use / for subfolders)', message: `In ${relative(root, dir) || basename(root)}` });
  if (!name) return;
  const path = join(dir, name.trim());
  try {
    if (await fs.exists(path)) return toast(`${name} already exists`, { type: 'warn' });
    await fs.mkdir(dirname(path), true);
    await fs.writeText(path, '');
    await afterChange(dirname(path));
    expanded.add(dirname(path));
    await app.editor.openFile(path);
  } catch (e) {
    errorToast('Could not create file', e);
  }
}

async function newFolder(dir = targetDir()) {
  if (!root) return app.commands.run('openFolder');
  const name = await prompt('New Folder', { placeholder: 'folder name', message: `In ${relative(root, dir) || basename(root)}` });
  if (!name) return;
  const path = join(dir, name.trim());
  try {
    await fs.mkdir(path, false);
    expanded.add(dir);
    expanded.add(path);
    await afterChange(dir);
    selected = path;
    render();
  } catch (e) {
    errorToast('Could not create folder', e);
  }
}

async function afterChange(dir) {
  bus.emit('fs-changed', dir);
  await loadDir(dir);
  render();
  app.workspace.refreshGit();
}

async function rename(path) {
  const name = basename(path);
  const dot = name.lastIndexOf('.');
  const next = await prompt('Rename', { value: name, select: [0, dot > 0 ? dot : name.length] });
  if (!next || next === name) return;
  const to = join(dirname(path), next);
  try {
    await fs.rename(path, to);
    renamed(path, to);
    await afterChange(dirname(path));
  } catch (e) {
    errorToast('Rename failed', e);
  }
}

function renamed(from, to) {
  app.editor.pathRenamed(from, to);
  const next = new Set();
  for (const p of expanded) next.add(isInside(from, p) ? to + p.slice(from.length) : p);
  expanded = next;
  for (const k of [...children.keys()]) if (isInside(from, k)) children.delete(k);
  if (expanded.has(to)) loadDir(to).then(render);
  selected = to;
}

async function move(path) {
  let dirs;
  try {
    const files = await app.workspace.files();
    const set = new Set(['']);
    for (const f of files) {
      let d = dirname('/' + f).slice(1);
      while (d && !set.has(d)) {
        set.add(d);
        d = dirname('/' + d).slice(1);
      }
    }
    dirs = [...set].filter((d) => !isInside(relative(root, path), d)).sort();
  } catch (e) {
    return errorToast('Could not list folders', e);
  }
  quickPick({
    placeholder: `Move ${basename(path)} to folder…`,
    provider: (q) =>
      dirs
        .map((d) => ({ d, m: fuzzy(q, d || '/') }))
        .filter((x) => x.m)
        .sort((a, b) => b.m.score - a.m.score)
        .slice(0, 200)
        .map(({ d, m }) => ({ label: d || '/ (project root)', highlights: d ? m.indices : [], icon: icon('folder'), dir: d })),
    onAccept: async (item) => {
      const destDir = item.dir ? join(root, item.dir) : root;
      const to = join(destDir, basename(path));
      if (to === path) return;
      try {
        await fs.rename(path, to);
        renamed(path, to);
        await afterChange(dirname(path));
        await afterChange(destDir);
        toast(`Moved to ${item.dir || '/'}`);
      } catch (e) {
        errorToast('Move failed', e);
      }
    },
  });
}

async function duplicate(path) {
  const dir = dirname(path);
  const name = basename(path);
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let n = 1;
  let to;
  do to = join(dir, `${stem} copy${n > 1 ? ' ' + n : ''}${ext}`);
  while (await fs.exists(to) && ++n);
  try {
    await fs.copy(path, to);
    await afterChange(dir);
    selected = to;
    render();
  } catch (e) {
    errorToast('Duplicate failed', e);
  }
}

async function remove(path) {
  const isDir = children.has(path) || expanded.has(path) || (await fs.stat(path).catch(() => ({}))).isDir;
  const ok = await confirm(
    `Delete ${basename(path)}?`,
    isDir ? 'This folder and everything inside it will be permanently deleted.' : 'This file will be permanently deleted.',
    { okLabel: 'Delete', danger: true },
  );
  if (!ok) return;
  try {
    await fs.delete(path);
    await app.editor.pathDeleted(path);
    expanded.delete(path);
    children.delete(path);
    await afterChange(dirname(path));
  } catch (e) {
    errorToast('Delete failed', e);
  }
}

function commonItems(path) {
  return [
    { label: 'Rename…', icon: 'edit', run: () => rename(path) },
    { label: 'Move to…', icon: 'forward', run: () => move(path) },
    { label: 'Duplicate', icon: 'copy', run: () => duplicate(path) },
    '-',
    { label: 'Copy Path', run: () => app.copy(path) },
    { label: 'Copy Relative Path', run: () => app.copy(relative(root, path)) },
    '-',
    { label: 'Delete', icon: 'trash', danger: true, run: () => remove(path) },
  ];
}

function fileMenu(path, x, y) {
  const rel = relative(root, path);
  const change = app.workspace.gitMap[rel];
  contextMenu(x, y, [
    { label: 'Open', icon: 'files', run: () => app.editor.openFile(path) },
    change && change !== 'U' && { label: 'Open Changes', icon: 'git', run: () => app.scm.openDiffForPath(path) },
    ['md', 'markdown'].includes(extname(path)) && {
      label: 'Open Preview',
      icon: 'eye',
      run: async () => {
        const tab = await app.editor.openFile(path);
        if (tab && !tab.preview) app.editor.togglePreview();
      },
    },
    '-',
    ...commonItems(path),
  ]);
}

function dirMenu(path, x, y) {
  const isRoot = path === root;
  contextMenu(x, y, [
    { label: 'New File…', icon: 'newFile', run: () => newFile(path) },
    { label: 'New Folder…', icon: 'newFolder', run: () => newFolder(path) },
    '-',
    { label: 'Find in Folder…', icon: 'search', run: () => app.search.show({ include: isRoot ? '' : relative(root, path) + '/' }) },
    { label: 'Open in Termux', icon: 'terminal', run: () => app.termux.open(path) },
    { label: 'Refresh', icon: 'refresh', run: () => explorer.refresh(path) },
    '-',
    ...(isRoot
      ? [{ label: 'Copy Path', run: () => app.copy(path) }, { label: 'Close Folder', icon: 'close', run: () => app.workspace.close() }]
      : commonItems(path)),
  ]);
}
