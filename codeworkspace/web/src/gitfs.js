// Node-style fs + http adapters so isomorphic-git can work through the Java bridge.
import { Buffer } from 'buffer';
import { sync, call } from './native.js';

// Sync bridge calls are fast but block the UI; yield to the event loop periodically
// so large status scans stay responsive.
let opsSinceYield = 0;
async function tick() {
  if (++opsSinceYield >= 60) {
    opsSinceYield = 0;
    await new Promise((r) => setTimeout(r, 0));
  }
}

const S_IFMT = 0o170000;
const S_IFDIR = 0o040000;
const S_IFREG = 0o100000;
const S_IFLNK = 0o120000;

function toStat(s) {
  const type = s.mode & S_IFMT;
  return {
    mode: s.mode,
    size: s.size,
    ino: s.ino,
    dev: s.dev,
    uid: s.uid,
    gid: s.gid,
    mtimeSeconds: s.mtimeSec,
    mtimeNanoseconds: s.mtimeNsec,
    ctimeSeconds: s.ctimeSec,
    ctimeNanoseconds: s.ctimeNsec,
    mtimeMs: s.mtimeSec * 1000 + s.mtimeNsec / 1e6,
    ctimeMs: s.ctimeSec * 1000 + s.ctimeNsec / 1e6,
    isFile: () => type === S_IFREG,
    isDirectory: () => type === S_IFDIR,
    isSymbolicLink: () => type === S_IFLNK,
  };
}

function encodingOf(opts) {
  if (typeof opts === 'string') return opts;
  return opts && opts.encoding;
}

const promises = {
  async readFile(path, opts) {
    await tick();
    const buf = Buffer.from(sync('fs.readB64', { path }), 'base64');
    const enc = encodingOf(opts);
    return enc ? buf.toString(enc === 'utf-8' ? 'utf8' : enc) : buf;
  },
  async writeFile(path, data, opts) {
    await tick();
    if (typeof data === 'string') {
      const enc = encodingOf(opts);
      if (!enc || enc === 'utf8' || enc === 'utf-8') {
        sync('fs.writeText', { path, text: data });
        return;
      }
      data = Buffer.from(data, enc);
    }
    sync('fs.writeB64', { path, data: Buffer.from(data).toString('base64') });
  },
  async unlink(path) {
    await tick();
    sync('fs.unlink', { path });
  },
  async readdir(path) {
    await tick();
    return sync('fs.readdir', { path });
  },
  async mkdir(path) {
    await tick();
    sync('fs.mkdir', { path, recursive: false });
  },
  async rmdir(path) {
    await tick();
    sync('fs.rmdir', { path });
  },
  async stat(path) {
    await tick();
    return toStat(sync('fs.stat', { path }));
  },
  async lstat(path) {
    await tick();
    return toStat(sync('fs.lstat', { path }));
  },
  async readlink(path) {
    return sync('fs.readlink', { path });
  },
  async symlink(target, path) {
    sync('fs.symlink', { target, path });
  },
  async chmod(path, mode) {
    sync('fs.chmod', { path, mode });
  },
};

export const gitFs = { promises };

// isomorphic-git HTTP client implemented with Java's HttpURLConnection (no CORS limits).
export const gitHttp = {
  async request({ url, method = 'GET', headers = {}, body }) {
    let bodyB64 = '';
    if (body) {
      const chunks = [];
      for await (const chunk of body) chunks.push(Buffer.from(chunk));
      bodyB64 = Buffer.concat(chunks).toString('base64');
    }
    const res = await call('http.request', { url, method, headers, body: bodyB64 });
    return {
      url: res.url,
      method,
      statusCode: res.status,
      statusMessage: res.statusText,
      headers: res.headers,
      body: [new Uint8Array(Buffer.from(res.body, 'base64'))],
    };
  },
};
