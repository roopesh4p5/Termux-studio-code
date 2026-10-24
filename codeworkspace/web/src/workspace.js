// Workspace: the open project folder, its git state and file index.
import { app, bus } from './app.js';
import { fs } from './native.js';
import * as git from './git.js';
import { basename, join, relative, isInside, dirname } from './path.js';
import { addRecentProject, setLastProject, workspaceState, saveWorkspaceState, excludeList, settings } from './settings.js';
import { errorToast } from './ui.js';

export const workspace = {
  root: null,
  name: '',
  repoRoot: null,
  branch: null,
  changes: [], // [{path (repo-relative), staged, unstaged}]
  gitMap: {}, // workspace-relative path -> 'M' | 'A' | 'D' | 'U'
  gitDirs: new Set(), // workspace-relative dirs containing changes
  gitBusy: false,
  fileList: null,

  async open(path) {
    if (this.root === path) return;
    if (this.root) {
      this.persist();
      if (!(await app.editor.closeAll())) return;
    }
    this.root = path;
    this.name = basename(path) || path;
    this.repoRoot = null;
    this.branch = null;
    this.changes = [];
    this.gitMap = {};
    this.gitDirs = new Set();
    this.fileList = null;
    git.resetCache();
    addRecentProject(path);
    setLastProject(path);
    const state = workspaceState(path);
    bus.emit('workspace', this);
    await app.explorer.load(path, state.expanded ?? []);
    await app.editor.restore(state.editor);
    await this.detectRepo();
  },

  async close() {
    if (!this.root) return;
    this.persist();
    if (!(await app.editor.closeAll())) return;
    this.root = null;
    this.name = '';
    this.repoRoot = null;
    this.branch = null;
    this.changes = [];
    this.gitMap = {};
    this.gitDirs = new Set();
    setLastProject(null);
    bus.emit('workspace', this);
    bus.emit('git-status', this);
  },

  persist() {
    if (!this.root) return;
    saveWorkspaceState(this.root, {
      editor: app.editor.serialize(),
      expanded: app.explorer.expandedList(),
    });
  },

  async detectRepo() {
    this.repoRoot = this.root ? await git.findRoot(this.root) : null;
    await this.refreshGit();
  },

  /** Re-reads git status. Coalesces concurrent requests. */
  async refreshGit() {
    if (this.gitBusy) {
      this.gitPending = true;
      return;
    }
    if (!this.repoRoot) {
      this.changes = [];
      this.gitMap = {};
      this.gitDirs = new Set();
      this.branch = null;
      bus.emit('git-status', this);
      return;
    }
    this.gitBusy = true;
    bus.emit('git-busy', true);
    try {
      const [changes, branch] = await Promise.all([git.status(this.repoRoot), git.currentBranch(this.repoRoot)]);
      this.changes = changes;
      this.branch = branch ?? (await git.headOid(this.repoRoot))?.slice(0, 7) ?? null;
      this.buildGitMap();
    } catch (e) {
      errorToast('Git status failed', e);
    } finally {
      this.gitBusy = false;
      bus.emit('git-busy', false);
    }
    bus.emit('git-status', this);
    if (this.gitPending) {
      this.gitPending = false;
      this.refreshGit();
    }
  },

  buildGitMap() {
    const map = {};
    const dirs = new Set();
    for (const c of this.changes) {
      const abs = join(this.repoRoot, c.path);
      if (!isInside(this.root, abs)) continue;
      const rel = relative(this.root, abs);
      map[rel] = c.unstaged ?? c.staged;
      let d = dirname(rel);
      while (d && d !== '/' && d !== '.' && !dirs.has(d)) {
        dirs.add(d);
        d = dirname(d);
      }
    }
    this.gitMap = map;
    this.gitDirs = dirs;
  },

  /** All file paths (workspace-relative) for quick open. Cached until the tree changes. */
  async files() {
    if (!this.root) return [];
    if (!this.fileList) {
      this.fileList = fs.listFiles(this.root, excludeList()).catch((e) => {
        this.fileList = null;
        throw e;
      });
    }
    return this.fileList;
  },

  abs(rel) {
    return join(this.root, rel);
  },

  rel(abs) {
    return relative(this.root, abs);
  },

  /** Resolves a commit author from settings or repo config. */
  async author() {
    let name = settings.gitAuthorName;
    let email = settings.gitAuthorEmail;
    if ((!name || !email) && this.repoRoot) {
      const cfg = await git.getAuthor(this.repoRoot);
      name = name || cfg.name;
      email = email || cfg.email;
    }
    return name && email ? { name, email } : null;
  },
};

bus.on('fs-changed', () => {
  workspace.fileList = null;
});
