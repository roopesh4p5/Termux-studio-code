// Persistent settings, recent projects and per-workspace state (localStorage).
import { bus } from './app.js';

const KEY = 'cw.settings';

export const DEFAULTS = {
  fontSize: 14,
  tabSize: 2,
  insertSpaces: true,
  wordWrap: false,
  lineNumbers: true,
  formatOnSave: false,
  autoSave: false,
  panelHeight: 260,
  reopenLastProject: true,
  showHidden: true,
  searchExclude: '.git, node_modules',
  prettierSemi: true,
  prettierSingleQuote: false,
  prettierPrintWidth: 80,
  prettierTrailingComma: 'all',
  gitAuthorName: '',
  gitAuthorEmail: '',
  sidebarWidth: 280,
};

function load(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn('storage write failed', e);
  }
}

export const settings = { ...DEFAULTS, ...load(KEY, {}) };

export function updateSettings(patch) {
  Object.assign(settings, patch);
  save(KEY, settings);
  bus.emit('settings', patch);
}

export function excludeList() {
  return settings.searchExclude.split(',').map((s) => s.trim()).filter(Boolean);
}

// ------------------------------------------------------------------ recents

export function recentProjects() {
  return load('cw.recent', []);
}

export function addRecentProject(path) {
  const list = recentProjects().filter((p) => p.path !== path);
  list.unshift({ path, time: Date.now() });
  save('cw.recent', list.slice(0, 15));
}

export function removeRecentProject(path) {
  save('cw.recent', recentProjects().filter((p) => p.path !== path));
}

export function lastProject() {
  return load('cw.lastProject', null);
}

export function setLastProject(path) {
  save('cw.lastProject', path);
}

// --------------------------------------------------------- workspace state

export function workspaceState(root) {
  return load('cw.ws:' + root, {});
}

export function saveWorkspaceState(root, state) {
  save('cw.ws:' + root, state);
}
