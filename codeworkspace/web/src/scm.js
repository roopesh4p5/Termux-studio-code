// Source Control side panel + git commands (branches, history, pull/push, clone).
import { app, bus } from './app.js';
import { call, fs } from './native.js';
import * as git from './git.js';
import { h, iconButton, toast, errorToast, confirm, prompt, quickPick, fuzzy, dialog, menuAt, onContext, contextMenu, esc } from './ui.js';
import { icon, fileBadge } from './icons.js';
import { basename, dirname, join, relative, isInside } from './path.js';
import { settings, updateSettings } from './settings.js';

let els = {};
let busy = false;

const LABEL = { M: 'Modified', A: 'Added', D: 'Deleted', U: 'Untracked' };

function repo() {
  return app.workspace.repoRoot;
}

async function withBusy(label, fn) {
  if (busy) return toast('Another git operation is running', { type: 'warn' });
  busy = true;
  els.el?.classList.add('busy');
  const t = label ? toast(label, { timeout: 0 }) : null;
  try {
    return await fn(t);
  } catch (e) {
    errorToast(label ? label.replace(/…$/, '') + ' failed' : 'Git error', e);
  } finally {
    busy = false;
    els.el?.classList.remove('busy');
    t?.dismiss();
  }
}

async function afterRepoChange({ reload = false } = {}) {
  git.resetCache();
  await app.workspace.refreshGit();
  if (reload) {
    bus.emit('fs-changed');
    await app.editor.checkAllExternal();
  }
}

export const scm = {
  build() {
    els.message = h('textarea', {
      class: 'input commit-input',
      rows: 2,
      placeholder: 'Message (Ctrl+Enter to commit)',
      autocapitalize: 'sentences',
      spellcheck: 'true',
    });
    els.message.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        commit();
      }
    });
    els.branch = h('button', { class: 'branch-btn', onClick: () => branchPicker() });
    els.commitBtn = h('button', { class: 'btn primary commit-btn', onClick: () => commit() }, h('span', { html: icon('check') }), 'Commit');
    els.commitMore = h('button', {
      class: 'btn primary commit-more',
      'aria-label': 'More commit actions',
      html: icon('chevronDown'),
      onClick: () =>
        menuAt(els.commitMore, [
          { label: 'Commit', icon: 'check', run: () => commit() },
          { label: 'Commit & Push', icon: 'push', run: () => commit({ push: true }) },
          { label: 'Commit Staged + Unstaged', run: () => commit({ all: true }) },
        ]),
    });
    els.body = h('div', { class: 'scm-body' });
    els.el = h(
      'div',
      { class: 'panel scm-panel' },
      h(
        'div',
        { class: 'panel-header' },
        h('span', { class: 'panel-title' }, 'SOURCE CONTROL'),
        h(
          'div',
          { class: 'panel-actions' },
          iconButton('refresh', 'Refresh', () => afterRepoChange({ reload: true })),
          iconButton('pull', 'Pull', () => pull()),
          iconButton('push', 'Push', () => push()),
          iconButton('history', 'History', () => showHistory()),
          iconButton('more', 'More Actions', (e) => moreMenu(e.currentTarget)),
        ),
      ),
      els.body,
    );
    bus.on('git-status', render);
    bus.on('workspace', render);
    git.setAuthProvider(authPrompt);
    render();
    return els.el;
  },

  openDiffForPath,
  branchPicker: () => branchPicker(),
  showHistory: () => showHistory(),
  pull: () => pull(),
  push: () => push(),
  clone: () => clone(),
  commit: (o) => commit(o),
  stageAll: () => stageAll(),
  init: () => initRepo(),
};

// ------------------------------------------------------------------ render

function render() {
  const body = els.body;
  if (!body) return;
  body.innerHTML = '';
  const ws = app.workspace;
  if (!ws.root) {
    body.append(h('div', { class: 'empty-panel' }, h('p', {}, 'Open a folder to use source control.')));
    return;
  }
  if (!ws.repoRoot) {
    body.append(
      h(
        'div',
        { class: 'empty-panel' },
        h('p', {}, 'This folder is not a Git repository.'),
        h('button', { class: 'btn primary', onClick: initRepo }, 'Initialize Repository'),
        h('button', { class: 'btn', onClick: clone }, 'Clone Repository'),
      ),
    );
    return;
  }
  els.branch.innerHTML = `${icon('branch')}<span>${esc(ws.branch ?? '(no branch)')}</span>`;
  const staged = ws.changes.filter((c) => c.staged);
  const unstaged = ws.changes.filter((c) => c.unstaged);
  els.commitBtn.lastChild.textContent = staged.length ? `Commit (${staged.length})` : 'Commit';
  body.append(
    h('div', { class: 'scm-top' }, els.branch, h('span', { class: 'muted small' }, relative(dirname(ws.repoRoot), ws.repoRoot))),
    els.message,
    h('div', { class: 'commit-row' }, els.commitBtn, els.commitMore),
  );
  if (staged.length) {
    body.append(section('Staged Changes', staged, true, [iconButton('minus', 'Unstage All', unstageAll)]));
  }
  body.append(
    section('Changes', unstaged, false, [
      iconButton('discard', 'Discard All Changes', discardAll),
      iconButton('plus', 'Stage All Changes', stageAll),
    ]),
  );
  if (!ws.changes.length) body.append(h('div', { class: 'muted pad' }, 'No changes. Working tree clean.'));
}

function section(title, list, isStaged, actions) {
  const sec = h(
    'div',
    { class: 'scm-section' },
    h(
      'div',
      { class: 'section-header static' },
      h('span', {}, title.toUpperCase()),
      h('span', { class: 'count-badge' }, String(list.length)),
      h('div', { class: 'panel-actions' }, ...(list.length ? actions : [])),
    ),
  );
  for (const c of list) sec.append(changeRow(c, isStaged));
  return sec;
}

function changeRow(c, isStaged) {
  const letter = isStaged ? c.staged : c.unstaged;
  const dir = dirname('/' + c.path).slice(1);
  const abs = join(repo(), c.path);
  const actions = h('div', { class: 'row-actions' });
  if (letter !== 'D') actions.append(iconButton('files', 'Open File', () => app.editor.openFile(abs)));
  if (isStaged) {
    actions.append(iconButton('minus', 'Unstage', () => unstage([c])));
  } else {
    actions.append(iconButton('discard', 'Discard Changes', () => discard([c])));
    actions.append(iconButton('plus', 'Stage', () => stage([c])));
  }
  const row = h(
    'div',
    { class: `scm-row git-${letter.toLowerCase()}`, title: `${c.path} — ${LABEL[letter]}`, onClick: () => openDiff(c, isStaged) },
    h('span', { class: 'row-icon', html: fileBadge(c.path) }),
    h('span', { class: `row-name ${letter === 'D' ? 'strike' : ''}` }, basename(c.path)),
    h('span', { class: 'result-dir' }, dir),
    actions,
    h('span', { class: 'row-git' }, letter),
  );
  onContext(row, (x, y) =>
    contextMenu(x, y, [
      { label: 'Open Changes', icon: 'git', run: () => openDiff(c, isStaged) },
      letter !== 'D' && { label: 'Open File', icon: 'files', run: () => app.editor.openFile(abs) },
      isStaged ? { label: 'Unstage', icon: 'minus', run: () => unstage([c]) } : { label: 'Stage', icon: 'plus', run: () => stage([c]) },
      !isStaged && { label: 'Discard Changes', icon: 'discard', danger: true, run: () => discard([c]) },
      '-',
      { label: 'Copy Path', run: () => app.copy(abs) },
      { label: 'Reveal in Explorer', run: () => app.explorer.reveal(abs, true) },
    ]),
  );
  return row;
}

// ----------------------------------------------------------------- actions

async function stage(list) {
  await withBusy(null, async () => {
    await git.stage(repo(), list);
    await afterRepoChange();
  });
}

async function stageAll() {
  await stage(app.workspace.changes.filter((c) => c.unstaged));
}

async function unstage(list) {
  await withBusy(null, async () => {
    await git.unstage(repo(), list.map((c) => c.path));
    await afterRepoChange();
  });
}

async function unstageAll() {
  await unstage(app.workspace.changes.filter((c) => c.staged));
}

async function discard(list) {
  const untracked = list.filter((c) => c.unstaged === 'U');
  const what = list.length === 1 ? basename(list[0].path) : `${list.length} files`;
  const msg = untracked.length
    ? `Untracked files will be DELETED. This cannot be undone.`
    : `Your changes to ${what} will be lost. This cannot be undone.`;
  if (!(await confirm(`Discard changes in ${what}?`, msg, { okLabel: 'Discard', danger: true }))) return;
  await withBusy(null, async () => {
    for (const c of list) {
      const abs = join(repo(), c.path);
      if (c.unstaged === 'U') {
        await fs.delete(abs);
        await app.editor.pathDeleted(abs);
      } else {
        await git.discard(repo(), c.path);
      }
    }
    await app.editor.reloadPaths(list.map((c) => join(repo(), c.path)));
    await afterRepoChange({ reload: true });
  });
}

async function discardAll() {
  const list = app.workspace.changes.filter((c) => c.unstaged);
  if (list.length) await discard(list);
}

async function ensureAuthor() {
  let author = await app.workspace.author();
  if (author) return author;
  const name = await prompt('Git author name', { value: settings.gitAuthorName, message: 'Used for your commits (saved in Settings).' });
  if (!name) return null;
  const email = await prompt('Git author email', { value: settings.gitAuthorEmail, type: 'email' });
  if (!email) return null;
  updateSettings({ gitAuthorName: name, gitAuthorEmail: email });
  return { name, email };
}

async function commit({ push: andPush = false, all = false } = {}) {
  const ws = app.workspace;
  if (!ws.repoRoot) return;
  await app.editor.saveAll();
  await ws.refreshGit();
  let staged = ws.changes.filter((c) => c.staged);
  const unstaged = ws.changes.filter((c) => c.unstaged);
  if (all || (!staged.length && unstaged.length)) {
    if (!all && !(await confirm('No staged changes', 'There are no staged changes. Stage all changes and commit them?', { okLabel: 'Stage All & Commit' }))) return;
    await git.stage(ws.repoRoot, unstaged);
    await afterRepoChange();
    staged = ws.changes.filter((c) => c.staged);
  }
  if (!staged.length) return toast('Nothing to commit', { type: 'warn' });
  let message = els.message.value.trim();
  if (!message) {
    message = (await prompt('Commit message', { placeholder: 'Describe your changes' }))?.trim();
    if (!message) return;
  }
  const author = await ensureAuthor();
  if (!author) return;
  await withBusy('Committing…', async () => {
    const oid = await git.commit(ws.repoRoot, message, author);
    els.message.value = '';
    await afterRepoChange();
    toast(`Committed ${oid.slice(0, 7)} on ${ws.branch}`, { type: 'success' });
  });
  if (andPush) await push();
}

function progressText(p) {
  if (!p) return '';
  const pct = p.total ? ` ${Math.round((p.loaded / p.total) * 100)}%` : '';
  return `${p.phase}${pct}`;
}

async function pull() {
  if (!repo()) return;
  const author = await ensureAuthor();
  if (!author) return;
  await withBusy('Pulling…', async (t) => {
    await git.pull(repo(), author, (p) => t.update('Pulling… ' + progressText(p)));
    await afterRepoChange({ reload: true });
    toast('Pull complete', { type: 'success' });
  });
}

async function push() {
  if (!repo()) return;
  await withBusy('Pushing…', async (t) => {
    const res = await git.push(repo(), (p) => t.update('Pushing… ' + progressText(p)));
    if (res && res.ok === false) throw new Error(res.error || 'Push rejected');
    await afterRepoChange();
    toast('Push complete', { type: 'success' });
  });
}

async function initRepo() {
  const root = app.workspace.root;
  if (!root) return;
  await withBusy('Initializing…', async () => {
    await git.init(root);
    await app.workspace.detectRepo();
    toast('Initialized empty Git repository', { type: 'success' });
  });
}

// -------------------------------------------------------------------- auth

async function authPrompt({ url, failed }) {
  const host = (() => {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  })();
  const key = 'git-auth:' + host;
  if (!failed) {
    const saved = await call('secret.get', { key });
    if (saved) return JSON.parse(saved);
  } else {
    await call('secret.set', { key, value: null });
  }
  const user = h('input', { class: 'input', placeholder: 'Username', autocapitalize: 'off', autocomplete: 'username' });
  const pass = h('input', { class: 'input', type: 'password', placeholder: 'Password or personal access token', autocomplete: 'current-password' });
  const remember = h('input', { type: 'checkbox', checked: true });
  const res = await dialog({
    title: `Sign in to ${host}`,
    body: h(
      'div',
      { class: 'form' },
      failed ? h('div', { class: 'dialog-message error-text' }, 'Authentication failed. Try again.') : null,
      h('div', { class: 'dialog-message' }, 'For GitHub/GitLab use a personal access token as the password.'),
      user,
      pass,
      h('label', { class: 'check' }, remember, ' Remember on this device'),
    ),
    buttons: [
      { label: 'Cancel', value: null },
      { label: 'Sign In', primary: true, value: () => ({ username: user.value, password: pass.value }) },
    ],
    onOpen: () => setTimeout(() => user.focus(), 50),
  });
  if (!res) return null;
  if (remember.checked) await call('secret.set', { key, value: JSON.stringify(res) });
  return res;
}

// -------------------------------------------------------------------- diff

async function openDiff(c, isStaged) {
  const r = repo();
  const abs = join(r, c.path);
  const key = `diff:${isStaged ? 'index' : 'work'}:${abs}`;
  const title = `${basename(c.path)} (${isStaged ? 'Index' : 'Working Tree'})`;
  const tab = app.editor.openSpecial({
    key,
    kind: 'diff',
    path: abs,
    title,
    diffLabel: isStaged ? 'HEAD ↔ Index' : 'Index ↔ Working Tree',
    diff: { loading: true },
  });
  try {
    let oldBlob;
    let newBlob;
    if (isStaged) {
      oldBlob = await git.readCommitted(r, c.path);
      newBlob = await git.readStaged(r, c.path);
    } else {
      oldBlob = (await git.readStaged(r, c.path)) ?? (await git.readCommitted(r, c.path));
      newBlob = c.unstaged === 'D' ? null : new TextEncoder().encode((await fs.readText(abs)).text);
    }
    tab.diff = {
      binary: git.isBinary(oldBlob) || git.isBinary(newBlob),
      oldText: git.decode(oldBlob),
      newText: git.decode(newBlob),
      status: isStaged ? c.staged : c.unstaged,
    };
  } catch (e) {
    tab.diff = { error: e.code === 'EBINARY' ? 'Binary file' : e.message };
  }
  if (app.editor.activeTab() === tab) app.editor.activate(tab);
}

async function openDiffForPath(abs) {
  const r = repo();
  if (!r || !isInside(r, abs)) return;
  const rel = relative(r, abs);
  const c = app.workspace.changes.find((x) => x.path === rel);
  if (c) openDiff(c, !c.unstaged);
}

// ----------------------------------------------------------------- branches

async function branchPicker() {
  const r = repo();
  if (!r) return toast('Not a git repository', { type: 'warn' });
  let data;
  try {
    data = await git.branches(r);
  } catch (e) {
    return errorToast('Could not list branches', e);
  }
  quickPick({
    placeholder: `Select a branch to checkout (current: ${data.current ?? 'detached'})`,
    provider: (q) => {
      const items = [
        { label: '+ Create new branch…', action: 'create' },
        { label: '+ Create new branch from current and checkout', action: 'create', hidden: true },
        { label: '− Delete branch…', action: 'delete' },
      ].filter((x) => !x.hidden);
      const local = data.local
        .map((b) => ({ b, m: fuzzy(q, b) }))
        .filter((x) => x.m)
        .map(({ b, m }) => ({ label: b, highlights: m.indices, icon: icon('branch'), description: b === data.current ? '✓ current' : '', branch: b }));
      const remote = data.remote
        .map((b) => ({ b, m: fuzzy(q, b) }))
        .filter((x) => x.m)
        .map(({ b, m }) => ({ label: b, highlights: m.indices, icon: icon('git'), description: 'remote', branch: b, remote: true }));
      return [
        ...(q ? [] : items),
        local.length ? { separator: 'Branches' } : null,
        ...local,
        remote.length ? { separator: 'Remote branches' } : null,
        ...remote,
      ].filter(Boolean);
    },
    onAccept: async (it) => {
      if (it.action === 'create') return createBranch();
      if (it.action === 'delete') return deleteBranchPicker(data);
      if (it.branch === data.current) return;
      await checkoutBranch(it.branch, it.remote);
    },
  });
}

async function checkoutBranch(name, remote = false) {
  if (app.editor.dirtyTabs().length) {
    if (!(await confirm('Unsaved files', 'Save all files before switching branches?', { okLabel: 'Save All' }))) return;
    await app.editor.saveAll();
  }
  await withBusy(`Checking out ${name}…`, async () => {
    await git.checkout(repo(), name, { remoteBranch: remote });
    await afterRepoChange({ reload: true });
    toast(`Switched to ${app.workspace.branch}`, { type: 'success' });
  });
}

async function createBranch() {
  const name = (await prompt('Create branch', { placeholder: 'Branch name', message: `From ${app.workspace.branch}` }))?.trim();
  if (!name) return;
  await withBusy(`Creating ${name}…`, async () => {
    await git.createBranch(repo(), name.replace(/\s+/g, '-'), true);
    await afterRepoChange();
    toast(`Created and switched to ${app.workspace.branch}`, { type: 'success' });
  });
}

function deleteBranchPicker(data) {
  quickPick({
    placeholder: 'Select a branch to delete',
    provider: (q) =>
      data.local
        .filter((b) => b !== data.current)
        .map((b) => ({ b, m: fuzzy(q, b) }))
        .filter((x) => x.m)
        .map(({ b, m }) => ({ label: b, highlights: m.indices, icon: icon('branch'), branch: b })),
    emptyText: 'No other local branches',
    onAccept: async (it) => {
      if (!(await confirm(`Delete branch ${it.branch}?`, 'The branch reference will be removed.', { okLabel: 'Delete', danger: true }))) return;
      await withBusy(null, async () => {
        await git.deleteBranch(repo(), it.branch);
        toast(`Deleted branch ${it.branch}`);
      });
    },
  });
}

// ------------------------------------------------------------------ history

function showHistory() {
  const r = repo();
  if (!r) return toast('Not a git repository', { type: 'warn' });
  app.editor.openSpecial({
    key: 'git-log:' + r,
    kind: 'log',
    title: 'Git History',
    render: (el) => renderHistory(el, r),
  });
}

async function renderHistory(el, r) {
  el.classList.add('history-view');
  el.append(h('div', { class: 'muted pad' }, 'Loading history…'));
  let commits;
  let remotes;
  try {
    [commits, remotes] = await Promise.all([git.log(r, 300), git.remotes(r)]);
  } catch (e) {
    el.innerHTML = '';
    el.append(h('div', { class: 'error-text pad' }, e.message));
    return;
  }
  el.innerHTML = '';
  el.append(
    h(
      'div',
      { class: 'history-head' },
      h('h2', {}, basename(r)),
      h('div', { class: 'muted' }, `Branch ${app.workspace.branch ?? '-'} · ${commits.length}${commits.length === 300 ? '+' : ''} commits`),
      ...remotes.map((rm) => h('div', { class: 'muted small' }, `${rm.remote}: ${rm.url}`)),
    ),
  );
  const list = h('div', { class: 'commit-list' });
  for (const c of commits) {
    const when = new Date(c.commit.author.timestamp * 1000);
    const files = h('div', { class: 'commit-files', hidden: true });
    const row = h(
      'div',
      { class: 'commit-row' },
      h(
        'div',
        {
          class: 'commit-summary',
          onClick: async () => {
            files.hidden = !files.hidden;
            if (!files.hidden && !files.dataset.loaded) {
              files.dataset.loaded = '1';
              files.append(h('div', { class: 'muted small' }, 'Loading…'));
              try {
                const ch = await git.commitChanges(r, c.oid);
                files.innerHTML = '';
                if (c.commit.message.trim().includes('\n')) files.append(h('pre', { class: 'commit-body' }, c.commit.message.trim()));
                for (const f of ch.files) {
                  files.append(
                    h(
                      'div',
                      { class: `scm-row git-${f.status.toLowerCase()}`, onClick: () => openCommitDiff(r, c.oid, ch.parent, f) },
                      h('span', { class: 'row-icon', html: fileBadge(f.path) }),
                      h('span', { class: 'row-name' }, basename(f.path)),
                      h('span', { class: 'result-dir' }, dirname('/' + f.path).slice(1)),
                      h('span', { class: 'row-git' }, f.status),
                    ),
                  );
                }
                if (!ch.files.length) files.append(h('div', { class: 'muted small' }, 'No file changes'));
              } catch (e) {
                files.innerHTML = '';
                files.append(h('div', { class: 'error-text small' }, e.message));
              }
            }
          },
        },
        h('span', { class: 'commit-oid' }, c.oid.slice(0, 7)),
        h('span', { class: 'commit-msg' }, c.commit.message.split('\n')[0]),
        h('span', { class: 'commit-meta muted' }, `${c.commit.author.name} · ${when.toLocaleString()}`),
      ),
      files,
    );
    list.append(row);
  }
  if (!commits.length) list.append(h('div', { class: 'muted pad' }, 'No commits yet.'));
  el.append(list);
}

async function openCommitDiff(r, oid, parent, f) {
  const abs = join(r, f.path);
  const tab = app.editor.openSpecial({
    key: `diff:${oid}:${abs}`,
    kind: 'diff',
    path: abs,
    title: `${basename(f.path)} (${oid.slice(0, 7)})`,
    diffLabel: `${parent ? parent.slice(0, 7) : 'empty'} ↔ ${oid.slice(0, 7)}`,
    diff: { loading: true },
  });
  try {
    const oldBlob = parent ? await git.readCommitted(r, f.path, parent) : null;
    const newBlob = await git.readCommitted(r, f.path, oid);
    tab.diff = { binary: git.isBinary(oldBlob) || git.isBinary(newBlob), oldText: git.decode(oldBlob), newText: git.decode(newBlob), status: f.status };
  } catch (e) {
    tab.diff = { error: e.message };
  }
  if (app.editor.activeTab() === tab) app.editor.activate(tab);
}

// --------------------------------------------------------------- more menu

function moreMenu(anchor) {
  const has = !!repo();
  menuAt(anchor, [
    { label: 'Checkout Branch…', icon: 'branch', disabled: !has, run: branchPicker },
    { label: 'Create Branch…', icon: 'plus', disabled: !has, run: createBranch },
    '-',
    { label: 'Pull', icon: 'pull', disabled: !has, run: pull },
    { label: 'Push', icon: 'push', disabled: !has, run: push },
    { label: 'Fetch', icon: 'sync', disabled: !has, run: fetchAll },
    '-',
    { label: 'Stage All Changes', icon: 'plus', disabled: !has, run: stageAll },
    { label: 'Unstage All Changes', icon: 'minus', disabled: !has, run: unstageAll },
    { label: 'Discard All Changes', icon: 'discard', danger: true, disabled: !has, run: discardAll },
    '-',
    { label: 'View History', icon: 'history', disabled: !has, run: showHistory },
    { label: 'Remotes…', icon: 'git', disabled: !has, run: showRemotes },
    { label: 'Initialize Repository', disabled: has || !app.workspace.root, run: initRepo },
    { label: 'Clone Repository…', icon: 'download', run: clone },
  ]);
}

async function fetchAll() {
  await withBusy('Fetching…', async (t) => {
    await git.fetchRemote(repo(), (p) => t.update('Fetching… ' + progressText(p)));
    await afterRepoChange();
    toast('Fetch complete', { type: 'success' });
  });
}

async function showRemotes() {
  const list = await git.remotes(repo());
  await dialog({
    title: 'Remotes',
    body: h(
      'div',
      { class: 'remote-list' },
      list.length
        ? list.map((r) => h('div', { class: 'remote-row' }, h('b', {}, r.remote), h('span', { class: 'muted' }, r.url)))
        : h('div', { class: 'muted' }, 'No remotes configured.'),
    ),
  });
}

// -------------------------------------------------------------------- clone

async function clone() {
  const url = (await prompt('Clone Repository', { placeholder: 'https://github.com/user/repo.git', message: 'Repository URL (HTTPS)', type: 'url' }))?.trim();
  if (!url) return;
  const parent = await app.folderPicker.pick({ title: 'Choose a folder to clone into', okLabel: 'Clone Here' });
  if (!parent) return;
  const name = basename(url.replace(/\/+$/, '').replace(/\.git$/, '')) || 'repo';
  const dir = join(parent, name);
  if (await fs.exists(dir)) return toast(`${name} already exists in that folder`, { type: 'warn' });
  await withBusy('Cloning…', async (t) => {
    await fs.mkdir(dir, true);
    try {
      await git.clone(dir, url, (p) => t.update(`Cloning ${name}… ${progressText(p)}`));
    } catch (e) {
      await fs.delete(dir).catch(() => {});
      throw e;
    }
    toast(`Cloned ${name}`, { type: 'success' });
    await app.workspace.open(dir);
  });
}
