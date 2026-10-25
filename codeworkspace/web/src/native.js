// Wrapper around the window.Native Java bridge (see Bridge.java).
// call(): async, runs on a Java worker thread. sync(): blocks JS briefly; use for cheap ops.

const pending = new Map();
let seq = 0;

function toError(res) {
  const e = new Error(res.err);
  e.code = res.code;
  return e;
}

window.__nativeResolve = (id, res) => {
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  if ('err' in res) p.reject(toError(res));
  else p.resolve(res.ok);
};

export const hasNative = typeof window.Native !== 'undefined';

export function call(op, args = {}) {
  return new Promise((resolve, reject) => {
    const id = 'c' + ++seq;
    pending.set(id, { resolve, reject });
    window.Native.call(id, op, JSON.stringify(args));
  });
}

export function sync(op, args = {}) {
  const res = JSON.parse(window.Native.sync(op, JSON.stringify(args)));
  if ('err' in res) throw toError(res);
  return res.ok;
}

let version = null;
/** The app's versionName (from the manifest), or '' in browser preview. */
export function appVersion() {
  if (version == null) {
    try {
      version = sync('platform').version ?? '';
    } catch {
      version = '';
    }
  }
  return version;
}

export const fs = {
  list: (path) => call('fs.list', { path }),
  readText: (path) => call('fs.readText', { path }),
  writeText: (path, text) => call('fs.writeText', { path, text }),
  mkdir: (path, recursive = true) => call('fs.mkdir', { path, recursive }),
  delete: (path) => call('fs.delete', { path }),
  rename: (from, to) => call('fs.rename', { from, to }),
  copy: (from, to) => call('fs.copy', { from, to }),
  exists: (path) => call('fs.exists', { path }),
  stat: (path) => call('fs.stat', { path }),
  listFiles: (root, exclude) => call('fs.listFiles', { root, exclude }),
};
