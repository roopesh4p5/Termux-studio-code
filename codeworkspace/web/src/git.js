// Git operations, run with Termux's real git through the file agent (see termux/agent.js).
// Each operation is one asynchronous bridge call, so the UI never blocks on git.
import { call } from './native.js';

let rootCache = new Map();
let authProvider = null;

/** Forgets cached repository roots, e.g. after Termux may have created or removed a repo. */
export function resetCache() {
  rootCache = new Map();
}

/** provider({url, failed}) -> {username, password} | null (null cancels). */
export function setAuthProvider(fn) {
  authProvider = fn;
}

/** Runs git; resolves {code, stdout, stderr} whatever the exit status. */
function run(dir, args, { env, config, input } = {}) {
  return call('git.run', { cwd: dir, args, env, config, input });
}

function gitError(res, args) {
  const lines = (res.stderr || res.stdout).trim().split('\n').filter((l) => l && !l.startsWith('hint:'));
  // Prefer git's own error lines over progress chatter like "Cloning into '.'...".
  const errors = lines.filter((l) => /^(fatal|error):/.test(l));
  const msg = (errors.length ? errors : lines).join('\n');
  const e = new Error(msg || `git ${args[0]} failed (exit ${res.code})`);
  e.code = 'EGIT';
  return e;
}

/** Runs git and returns stdout; throws with git's message on a non-zero exit. */
async function git(dir, args, opts) {
  const res = await run(dir, args, opts);
  if (res.code !== 0) throw gitError(res, args);
  return res.stdout;
}

async function config(dir, key) {
  const res = await run(dir, ['config', '--get', key]);
  return res.code === 0 ? res.stdout.trim() : null;
}

// ------------------------------------------------------------- credentials

const AUTH_FAILED = /Authentication failed|could not read (Username|Password)|terminal prompts disabled|Invalid username or password|HTTP Basic: Access denied|\b40[13]\b/i;

// Replaces any configured helper with one that answers from the environment, so the
// password never appears on a command line.
const HELPER = [
  'credential.helper=',
  'credential.helper=!f() { test "$1" = get && printf "username=%s\\npassword=%s\\n" "$TSC_GIT_USER" "$TSC_GIT_PASS"; }; f',
];

/**
 * Runs a network operation. It first runs with the user's own git setup (credential
 * helpers, SSH keys, public repos); when that fails for lack of credentials it asks the
 * auth provider (saved login first, then a sign-in dialog) and retries.
 */
async function withAuth(dir, args, url) {
  let creds = null;
  let failed = false;
  for (;;) {
    const opts = creds ? { config: HELPER, env: { TSC_GIT_USER: creds.username, TSC_GIT_PASS: creds.password } } : {};
    const res = await run(dir, args, opts);
    if (res.code === 0) return res;
    if (!authProvider || !AUTH_FAILED.test(res.stderr)) throw gitError(res, args);
    creds = await authProvider({ url: url ?? (await remoteUrl(dir)), failed });
    failed = true;
    if (!creds) throw new Error('Authentication cancelled');
  }
}

async function upstreamRemote(dir) {
  const branch = await currentBranch(dir);
  return branch ? config(dir, `branch.${branch}.remote`) : null;
}

async function remoteUrl(dir) {
  const remote = (await upstreamRemote(dir)) ?? 'origin';
  return (await config(dir, `remote.${remote}.url`)) ?? '';
}

// -------------------------------------------------------------- repository

/** The repository containing `dir`, or null. Cached until resetCache(). */
export function findRoot(dir) {
  if (!rootCache.has(dir)) {
    const p = run(dir, ['rev-parse', '--show-toplevel']).then((res) => (res.code === 0 ? res.stdout.trim() : null));
    p.catch(() => rootCache.delete(dir));
    rootCache.set(dir, p);
  }
  return rootCache.get(dir);
}

// porcelain v2 X/Y letter -> the app's change letter
function letter(c) {
  if (c === '.') return null;
  if (c === 'A' || c === 'C') return 'A';
  if (c === 'D') return 'D';
  return 'M'; // M, T (type change), R (worktree rename)
}

/** Parses `git status --porcelain=v2 --branch -z`. Paths are repository-relative. */
export function parseStatus(out) {
  const changes = [];
  let branch = null;
  let oid = null;
  const parts = out.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    if (!e) continue;
    const type = e[0];
    if (type === '#') {
      if (e.startsWith('# branch.head ')) branch = e.slice(14);
      else if (e.startsWith('# branch.oid ')) oid = e.slice(13);
      continue;
    }
    if (type === '?') {
      changes.push({ path: e.slice(2), staged: null, unstaged: 'U' });
      continue;
    }
    if (type === '!') continue;
    const xy = e.slice(2, 4);
    // Space-separated fields before the path: 8 for "1", 9 for "2" (whose original path is
    // the next entry), 10 for "u" (unmerged).
    const fields = type === '1' ? 8 : type === '2' ? 9 : 10;
    let at = 0;
    for (let n = 0; n < fields; n++) at = e.indexOf(' ', at) + 1;
    const path = e.slice(at);
    if (type === 'u') {
      changes.push({ path, staged: null, unstaged: 'M' });
      continue;
    }
    if (type === '2') {
      const orig = parts[++i];
      // A staged rename shows as the old path deleted and the new one added.
      if (xy[0] === 'R') {
        changes.push({ path: orig, staged: 'D', unstaged: null });
        changes.push({ path, staged: 'A', unstaged: letter(xy[1]) });
        continue;
      }
    }
    const staged = letter(xy[0]);
    const unstaged = letter(xy[1]);
    if (staged || unstaged) changes.push({ path, staged, unstaged });
  }
  return {
    changes,
    branch: branch && branch !== '(detached)' ? branch : null,
    oid: oid && oid !== '(initial)' ? oid : null,
  };
}

/**
 * Changed files plus the branch and HEAD, in a single git call.
 * @returns {Promise<{changes: Array<{path, staged, unstaged}>, branch: string|null, oid: string|null}>}
 */
export async function statusFull(dir) {
  return parseStatus(await git(dir, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all']));
}

export async function currentBranch(dir) {
  const res = await run(dir, ['symbolic-ref', '--short', '-q', 'HEAD']);
  return res.code === 0 ? res.stdout.trim() || null : null;
}

export async function headOid(dir) {
  const res = await run(dir, ['rev-parse', '-q', '--verify', 'HEAD']);
  return res.code === 0 ? res.stdout.trim() : null;
}

export async function stage(dir, files) {
  if (files.length) await git(dir, ['add', '-A', '--', ...files.map((f) => f.path)]);
}

export async function unstage(dir, paths) {
  if (!paths.length) return;
  if (await headOid(dir)) await git(dir, ['reset', '-q', '--', ...paths]);
  else await git(dir, ['rm', '--cached', '-q', '-r', '--', ...paths]);
}

/** Contents of a file at HEAD (or any commit), or null if absent. */
export async function readCommitted(dir, filepath, ref = 'HEAD') {
  const res = await run(dir, ['show', `${ref}:${filepath}`]);
  return res.code === 0 ? res.stdout : null;
}

/** Contents of a file as staged in the index, or null if absent. */
export async function readStaged(dir, filepath) {
  const res = await run(dir, ['show', `:${filepath}`]);
  return res.code === 0 ? res.stdout : null;
}

export function decode(text) {
  return text ?? '';
}

export function isBinary(text) {
  return !!text && text.slice(0, 8000).includes('\0');
}

/** Writes the staged (or HEAD) version of a file back to the working tree. */
export async function discard(dir, filepath) {
  const res = await run(dir, ['checkout', '-q', '--', filepath]);
  if (res.code !== 0) await git(dir, ['checkout', '-q', 'HEAD', '--', filepath]);
}

export async function getAuthor(dir) {
  const [name, email] = await Promise.all([config(dir, 'user.name'), config(dir, 'user.email')]);
  return { name, email };
}

export async function commit(dir, message, author) {
  await git(dir, ['commit', '-q', '-F', '-'], {
    config: [`user.name=${author.name}`, `user.email=${author.email}`],
    input: message,
  });
  return headOid(dir);
}

export async function branches(dir) {
  const out = await git(dir, ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes']);
  const local = [];
  const remote = [];
  for (const ref of out.split('\n')) {
    if (ref.startsWith('refs/heads/')) local.push(ref.slice(11));
    else if (ref.startsWith('refs/remotes/') && !ref.endsWith('/HEAD')) remote.push(ref.slice(13));
  }
  return { local, remote, current: await currentBranch(dir) };
}

export async function checkout(dir, ref, { remoteBranch } = {}) {
  if (remoteBranch) {
    // Switch to the local branch for remote/branch, creating it (tracking) if needed.
    const name = ref.split('/').slice(1).join('/');
    const exists = (await run(dir, ['rev-parse', '-q', '--verify', `refs/heads/${name}`])).code === 0;
    await git(dir, exists ? ['checkout', '-q', name] : ['checkout', '-q', '--track', ref]);
    return;
  }
  await git(dir, ['checkout', '-q', ref]);
}

export async function createBranch(dir, name, doCheckout = true) {
  await git(dir, doCheckout ? ['checkout', '-q', '-b', name] : ['branch', name]);
}

export async function deleteBranch(dir, name) {
  await git(dir, ['branch', '-D', name]);
}

/** Commits in the shape the history view reads: {oid, commit: {message, parent, author}}. */
export async function log(dir, depth = 200) {
  const res = await run(dir, ['log', '-n', String(depth), '--format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%B%x1e']);
  if (res.code !== 0) return []; // no commits yet
  return res.stdout
    .split('\x1e')
    .map((r) => r.replace(/^\n/, ''))
    .filter(Boolean)
    .map((r) => {
      const [oid, parents, name, email, time, message] = r.split('\x1f');
      return {
        oid,
        commit: { message, parent: parents ? parents.split(' ') : [], author: { name, email, timestamp: Number(time) } },
      };
    });
}

/** Files changed by a commit relative to its first parent. */
export async function commitChanges(dir, oid) {
  const parent = (await run(dir, ['rev-parse', '-q', '--verify', `${oid}^`])).stdout.trim() || null;
  const args = parent
    ? ['diff', '--no-renames', '--name-status', '-z', parent, oid]
    : ['diff-tree', '--root', '-r', '--no-commit-id', '--no-renames', '--name-status', '-z', oid];
  const parts = (await git(dir, args)).split('\0');
  const files = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const s = parts[i][0];
    files.push({ path: parts[i + 1], status: s === 'A' || s === 'D' ? s : 'M' });
  }
  return { parent, files };
}

export async function remotes(dir) {
  const out = await git(dir, ['remote', '-v']);
  const list = [];
  for (const line of out.split('\n')) {
    const m = /^(\S+)\t(\S+) \(fetch\)$/.exec(line);
    if (m) list.push({ remote: m[1], url: m[2] });
  }
  return list;
}

export async function pull(dir, author) {
  // With no pull.rebase setting, recent git refuses to reconcile diverged branches.
  const merge = (await config(dir, 'pull.rebase')) == null ? ['--no-rebase'] : [];
  await withAuth(dir, ['-c', `user.name=${author.name}`, '-c', `user.email=${author.email}`, 'pull', ...merge]);
}

export async function push(dir) {
  const branch = await currentBranch(dir);
  if (!branch) throw new Error('Not on a branch');
  const remote = (await upstreamRemote(dir)) ?? 'origin';
  await withAuth(dir, ['push', '-u', remote, branch]);
}

export async function fetchRemote(dir) {
  await withAuth(dir, ['fetch']);
}

/** Clones into `dir`, which must exist and be empty. */
export async function clone(dir, url) {
  await withAuth(dir, ['clone', '--single-branch', '--', url, '.'], url);
  resetCache();
}

export async function init(dir) {
  await git(dir, ['init', '-q', '-b', 'main']);
  resetCache();
}
