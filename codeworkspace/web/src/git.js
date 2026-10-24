// Git operations built on isomorphic-git, running fully in-app through the Java bridge.
import './polyfill.js';
import git from 'isomorphic-git';
import { gitFs as fs, gitHttp as http } from './gitfs.js';

let cache = {};
let authProvider = null;

/** Drops parsed index/pack caches, e.g. after Termux may have changed the repo. */
export function resetCache() {
  cache = {};
}

/** provider({url, failed}) -> {username, password} | null (null cancels). */
export function setAuthProvider(fn) {
  authProvider = fn;
}

function authCallbacks() {
  return {
    onAuth: async (url) => (await authProvider?.({ url, failed: false })) ?? { cancel: true },
    onAuthFailure: async (url) => (await authProvider?.({ url, failed: true })) ?? { cancel: true },
  };
}

export async function findRoot(dir) {
  try {
    return await git.findRoot({ fs, filepath: dir });
  } catch {
    return null;
  }
}

// statusMatrix row: [filepath, HEAD, WORKDIR, STAGE]
//  HEAD: 0 absent, 1 present
//  WORKDIR: 0 absent, 1 same as HEAD, 2 differs from HEAD
//  STAGE: 0 absent, 1 same as HEAD, 2 same as WORKDIR, 3 differs from WORKDIR
export function classify([path, h, w, s]) {
  let staged = null;
  let unstaged = null;
  if (h === 0 && s !== 0) staged = 'A';
  else if (h === 1 && s === 0) staged = 'D';
  else if (h === 1 && s >= 2) staged = 'M';

  if (s === 0 && w !== 0) unstaged = 'U';
  else if (s !== 0 && w === 0) unstaged = 'D';
  else if (s === 3 || (s === 1 && w === 2)) unstaged = 'M';
  return { path, staged, unstaged };
}

/** @returns {Promise<Array<{path, staged, unstaged}>>} only changed files */
export async function status(dir) {
  const matrix = await git.statusMatrix({ fs, dir, cache });
  const out = [];
  for (const row of matrix) {
    const c = classify(row);
    if (c.staged || c.unstaged) out.push(c);
  }
  return out;
}

export async function currentBranch(dir) {
  try {
    return (await git.currentBranch({ fs, dir, fullname: false })) || null;
  } catch {
    return null;
  }
}

export async function headOid(dir) {
  try {
    return await git.resolveRef({ fs, dir, ref: 'HEAD' });
  } catch {
    return null;
  }
}

export async function stage(dir, files) {
  for (const f of files) {
    if (f.unstaged === 'D') await git.remove({ fs, dir, filepath: f.path, cache });
    else await git.add({ fs, dir, filepath: f.path, cache });
  }
}

export async function unstage(dir, paths) {
  const head = await headOid(dir);
  for (const filepath of paths) {
    if (head) await git.resetIndex({ fs, dir, filepath, cache });
    else await git.remove({ fs, dir, filepath, cache });
  }
}

async function readBlobAt(dir, oid, filepath) {
  try {
    const { blob } = await git.readBlob({ fs, dir, oid, filepath, cache });
    return blob;
  } catch (e) {
    if (e.code === 'NotFoundError') return null;
    throw e;
  }
}

/** Contents of a file at HEAD (or any commit), or null if absent. */
export async function readCommitted(dir, filepath, ref = 'HEAD') {
  let oid;
  try {
    oid = await git.resolveRef({ fs, dir, ref });
  } catch {
    oid = ref.length === 40 ? ref : null;
  }
  if (!oid) return null;
  return readBlobAt(dir, oid, filepath);
}

/** Contents of a file as staged in the index, or null if absent. */
export async function readStaged(dir, filepath) {
  let found = null;
  await git.walk({
    fs,
    dir,
    cache,
    trees: [git.STAGE()],
    map: async (fp, [entry]) => {
      if (fp === '.') return true;
      if (fp === filepath) {
        if (entry) found = await entry.oid();
        return null;
      }
      return filepath.startsWith(fp + '/') ? true : null;
    },
  });
  if (!found) return null;
  const { blob } = await git.readBlob({ fs, dir, oid: found, cache });
  return blob;
}

export function decode(blob) {
  if (blob == null) return '';
  return new TextDecoder('utf-8').decode(blob);
}

export function isBinary(blob) {
  if (!blob) return false;
  const n = Math.min(blob.length, 8000);
  for (let i = 0; i < n; i++) if (blob[i] === 0) return true;
  return false;
}

/** Writes the staged (or HEAD) version of a file back to the working tree. */
export async function discard(dir, filepath) {
  const blob = (await readStaged(dir, filepath)) ?? (await readCommitted(dir, filepath));
  if (blob == null) throw new Error('No committed version of ' + filepath);
  await fs.promises.writeFile(dir + '/' + filepath, blob);
}

export async function getAuthor(dir) {
  const name = await git.getConfig({ fs, dir, path: 'user.name' }).catch(() => null);
  const email = await git.getConfig({ fs, dir, path: 'user.email' }).catch(() => null);
  return { name, email };
}

export async function commit(dir, message, author) {
  return git.commit({ fs, dir, message, author, cache });
}

export async function branches(dir) {
  const local = await git.listBranches({ fs, dir });
  const remotes = await git.listRemotes({ fs, dir });
  const remote = [];
  for (const r of remotes) {
    const list = await git.listBranches({ fs, dir, remote: r.remote }).catch(() => []);
    for (const b of list) if (b !== 'HEAD') remote.push(`${r.remote}/${b}`);
  }
  return { local, remote, remotes, current: await currentBranch(dir) };
}

export async function checkout(dir, ref, { remoteBranch } = {}) {
  if (remoteBranch) {
    // Create a local tracking branch from remote/branch.
    const [remote, ...rest] = ref.split('/');
    const name = rest.join('/');
    const local = await git.listBranches({ fs, dir });
    if (!local.includes(name)) {
      const oid = await git.resolveRef({ fs, dir, ref: `refs/remotes/${remote}/${name}` });
      await git.branch({ fs, dir, ref: name, object: oid });
      await git.setConfig({ fs, dir, path: `branch.${name}.remote`, value: remote });
      await git.setConfig({ fs, dir, path: `branch.${name}.merge`, value: `refs/heads/${name}` });
    }
    ref = name;
  }
  await git.checkout({ fs, dir, ref, cache });
}

export async function createBranch(dir, name, doCheckout = true) {
  await git.branch({ fs, dir, ref: name, checkout: doCheckout });
}

export async function deleteBranch(dir, name) {
  await git.deleteBranch({ fs, dir, ref: name });
}

export async function log(dir, depth = 200) {
  try {
    return await git.log({ fs, dir, depth, cache });
  } catch (e) {
    if (e.code === 'NotFoundError') return [];
    throw e;
  }
}

/** Files changed by a commit relative to its first parent. */
export async function commitChanges(dir, oid) {
  const { commit: c } = await git.readCommit({ fs, dir, oid, cache });
  const parent = c.parent[0];
  const trees = parent ? [git.TREE({ ref: parent }), git.TREE({ ref: oid })] : [git.TREE({ ref: oid })];
  const out = [];
  await git.walk({
    fs,
    dir,
    cache,
    trees,
    map: async (fp, entries) => {
      if (fp === '.') return true;
      const [a, b] = parent ? entries : [null, entries[0]];
      const ta = a ? await a.type() : null;
      const tb = b ? await b.type() : null;
      if (ta === 'tree' || tb === 'tree') {
        if (a && b && (await a.oid()) === (await b.oid())) return null;
        return true;
      }
      const oa = a ? await a.oid() : null;
      const ob = b ? await b.oid() : null;
      if (oa === ob) return null;
      out.push({ path: fp, status: !oa ? 'A' : !ob ? 'D' : 'M' });
      return null;
    },
  });
  return { commit: c, parent, files: out };
}

export async function remotes(dir) {
  return git.listRemotes({ fs, dir });
}

export async function pull(dir, author, onProgress) {
  const ref = await currentBranch(dir);
  await git.pull({
    fs,
    http,
    dir,
    ref,
    singleBranch: true,
    author,
    cache,
    onProgress,
    ...authCallbacks(),
  });
}

export async function push(dir, onProgress) {
  const ref = await currentBranch(dir);
  return git.push({ fs, http, dir, ref, onProgress, ...authCallbacks() });
}

export async function fetchRemote(dir, onProgress) {
  return git.fetch({ fs, http, dir, onProgress, cache, ...authCallbacks() });
}

export async function clone(dir, url, onProgress) {
  await git.clone({ fs, http, dir, url, singleBranch: true, onProgress, cache, ...authCallbacks() });
}

export async function init(dir) {
  await git.init({ fs, dir, defaultBranch: 'main' });
}

export async function isIgnored(dir, filepath) {
  return git.isIgnored({ fs, dir, filepath });
}
