// Termux Studio Code file agent. Runs inside Termux (started by the app through RUN_COMMAND)
// and serves the bridge's fs.* and search.* operations for paths under Termux's private
// storage, which the app itself cannot read. Results match Bridge.java / SearchOps.java:
// {"ok": value} or {"err": message, "code": code}.
//
// Usage: node agent.js <port> <token>    — listens on 127.0.0.1, POST /<token> {op, args}
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');

const [port, token] = process.argv.slice(2);
const MAX_TEXT_BYTES = 8 * 1024 * 1024;
const MAX_SEARCH_BYTES = 2 * 1024 * 1024;
const MAX_PREVIEW = 240;
const DEFAULT_EXCLUDE = ['.git', 'node_modules'];

class OpError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function looksBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

/** stat() that falls back to lstat() for dangling symlinks. */
function statSafe(p) {
  try {
    return fs.statSync(p);
  } catch {
    return fs.lstatSync(p);
  }
}

function existing(p) {
  if (!fs.existsSync(p)) {
    try {
      fs.lstatSync(p); // dangling symlink still counts
    } catch {
      throw new OpError('ENOENT', 'No such file or directory: ' + p);
    }
  }
  return p;
}

// ------------------------------------------------------------------ filesystem

function list(p) {
  const st = fs.statSync(existing(p));
  if (!st.isDirectory()) throw new OpError('ENOTDIR', 'Not a directory: ' + p);
  return fs.readdirSync(p).map((name) => {
    let s;
    try {
      s = statSafe(path.join(p, name));
    } catch {
      return { name, dir: false, size: 0, mtime: 0 };
    }
    return { name, dir: s.isDirectory(), size: s.isDirectory() ? 0 : s.size, mtime: Math.floor(s.mtimeMs) };
  });
}

function readdir(p) {
  const st = fs.statSync(existing(p));
  if (!st.isDirectory()) throw new OpError('ENOTDIR', 'Not a directory: ' + p);
  return fs.readdirSync(p);
}

function readText(p) {
  const st = fs.statSync(existing(p));
  if (st.isDirectory()) throw new OpError('EISDIR', 'Is a directory: ' + p);
  if (st.size > MAX_TEXT_BYTES) throw new OpError('ETOOBIG', `File is too large to open (${Math.floor(st.size / 1024 / 1024)} MB)`);
  const buf = fs.readFileSync(p);
  if (looksBinary(buf)) throw new OpError('EBINARY', 'File appears to be binary');
  return { text: buf.toString('utf8'), mtime: Math.floor(st.mtimeMs), size: st.size };
}

function writeBytes(p, data) {
  const parent = path.dirname(p);
  if (!fs.existsSync(parent)) throw new OpError('ENOENT', 'Parent directory does not exist: ' + parent);
  fs.writeFileSync(p, data);
  return { mtime: Math.floor(fs.statSync(p).mtimeMs) };
}

function stat(p, link) {
  const s = link ? fs.lstatSync(p, { bigint: true }) : fs.statSync(p, { bigint: true });
  return {
    mode: Number(s.mode),
    size: Number(s.size),
    ino: Number(s.ino),
    dev: Number(s.dev),
    uid: Number(s.uid),
    gid: Number(s.gid),
    mtimeSec: Number(s.mtimeNs / 1000000000n),
    mtimeNsec: Number(s.mtimeNs % 1000000000n),
    ctimeSec: Number(s.ctimeNs / 1000000000n),
    ctimeNsec: Number(s.ctimeNs % 1000000000n),
    mtimeMs: Number(s.mtimeMs),
    isDir: s.isDirectory(),
  };
}

function mkdir(p, recursive) {
  if (fs.existsSync(p)) {
    if (recursive && fs.statSync(p).isDirectory()) return null;
    throw new OpError('EEXIST', 'Already exists: ' + p);
  }
  fs.mkdirSync(p, { recursive: !!recursive });
  return null;
}

function rename(from, to, overwrite) {
  existing(from);
  if (fs.existsSync(to) && !overwrite && fs.realpathSync(from).toLowerCase() !== fs.realpathSync(to).toLowerCase()) {
    throw new OpError('EEXIST', 'Destination already exists: ' + to);
  }
  fs.renameSync(from, to);
  return null;
}

function copy(from, to) {
  existing(from);
  if (fs.existsSync(to)) throw new OpError('EEXIST', 'Destination already exists: ' + to);
  fs.cpSync(from, to, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
  return null;
}

/** Iterative walk; symlinked directories are not followed (avoids cycles). */
function* walkFiles(root, skip, cancelled) {
  const stack = [root];
  while (stack.length) {
    if (cancelled && cancelled()) throw new OpError('ECANCELED', 'Search cancelled');
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => b.name.toLowerCase().localeCompare(a.name.toLowerCase()));
    for (const e of entries) {
      if (skip.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else yield full;
    }
  }
}

function listFiles(root, exclude, max) {
  const out = [];
  const skip = new Set(exclude ?? DEFAULT_EXCLUDE);
  for (const f of walkFiles(root, skip)) {
    out.push(path.relative(root, f));
    if (out.length >= max) break;
  }
  return out;
}

// ---------------------------------------------------------------------- search

let generation = 0;

function compile(a) {
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let p = a.regex ? a.query : escape(a.query);
  if (a.wholeWord) p = `\\b(?:${p})\\b`;
  try {
    return new RegExp(p, 'gm' + (a.caseSensitive ? '' : 'i'));
  } catch (e) {
    throw new OpError('EREGEX', 'Invalid regular expression: ' + e.message);
  }
}

function globSet(a, key) {
  const v = (a[key] ?? '').trim();
  return v ? v.split(/\s*,\s*/) : null;
}

function globMatch(globs, rel) {
  return globs.some((g) => g && (g.startsWith('*.') ? rel.endsWith(g.slice(1)) : rel.includes(g)));
}

/** Calls visit(full, rel) for each candidate file; yields to the event loop so cancel can arrive. */
async function walk(a, gen, visit) {
  const root = a.root;
  if (a.paths) {
    for (const rel of a.paths) if ((await visit(path.join(root, rel), rel)) === false) return;
    return;
  }
  const include = globSet(a, 'include');
  const excludeGlobs = globSet(a, 'excludeGlobs');
  let n = 0;
  for (const full of walkFiles(root, new Set(a.exclude ?? DEFAULT_EXCLUDE), () => generation !== gen)) {
    if (++n % 200 === 0) await new Promise((r) => setImmediate(r));
    const rel = path.relative(root, full);
    if (include && !globMatch(include, rel)) continue;
    if (excludeGlobs && globMatch(excludeGlobs, rel)) continue;
    let st;
    try {
      st = fs.statSync(full);
    } catch {
      continue;
    }
    if (!st.isFile() || st.size > MAX_SEARCH_BYTES) continue;
    if ((await visit(full, rel)) === false) return;
  }
}

function readTextOrNull(f) {
  try {
    const buf = fs.readFileSync(f);
    return looksBinary(buf) ? null : buf.toString('utf8');
  } catch {
    return null;
  }
}

async function searchText(a) {
  const gen = ++generation;
  const re = compile(a);
  const max = a.max ?? 2000;
  const files = [];
  let total = 0;
  let truncated = false;
  await walk(a, gen, (f, rel) => {
    const text = readTextOrNull(f);
    if (text == null) return true;
    let matches = null;
    let line = 0;
    let lineStart = 0;
    let scanned = 0;
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const start = m.index;
      const end = start + m[0].length;
      if (end === start) {
        re.lastIndex++;
        continue;
      }
      for (let i = scanned; i < start; i++) {
        if (text.charCodeAt(i) === 10) {
          line++;
          lineStart = i + 1;
        }
      }
      scanned = start;
      let lineEnd = text.indexOf('\n', lineStart);
      if (lineEnd < 0) lineEnd = text.length;
      const len = Math.min(end, lineEnd) - start;
      const from = Math.max(lineStart, start - 60);
      const to = Math.min(lineEnd, Math.max(start + len + 60, from + MAX_PREVIEW));
      (matches ??= []).push({
        line,
        col: start - lineStart,
        len,
        preview: text.slice(from, to),
        previewCol: start - from,
        leading: from > lineStart,
      });
      if (++total >= max) {
        truncated = true;
        break;
      }
    }
    if (matches) files.push({ path: rel, matches });
    return !truncated;
  });
  return { files, total, truncated };
}

async function replaceText(a) {
  const gen = ++generation;
  const re = compile(a);
  const changed = [];
  let count = 0;
  await walk(a, gen, (f, rel) => {
    const text = readTextOrNull(f);
    if (text == null) return true;
    const n = (text.match(re) ?? []).length;
    if (!n) return true;
    const out = a.regex ? text.replace(re, a.replacement) : text.replace(re, () => a.replacement);
    fs.writeFileSync(f, out);
    count += n;
    changed.push(rel);
    return true;
  });
  return { files: changed, count };
}

// -------------------------------------------------------------------- dispatch

async function dispatch(op, a) {
  switch (op) {
    case 'fs.list': return list(a.path);
    case 'fs.readdir': return readdir(a.path);
    case 'fs.readText': return readText(a.path);
    case 'fs.writeText': return writeBytes(a.path, Buffer.from(a.text, 'utf8'));
    case 'fs.readB64': return fs.readFileSync(existing(a.path)).toString('base64');
    case 'fs.writeB64': return writeBytes(a.path, Buffer.from(a.data, 'base64'));
    case 'fs.stat': return stat(a.path, false);
    case 'fs.lstat': return stat(a.path, true);
    case 'fs.exists': return fs.existsSync(a.path);
    case 'fs.mkdir': return mkdir(a.path, a.recursive);
    case 'fs.rmdir': {
      if (!fs.statSync(existing(a.path)).isDirectory()) throw new OpError('ENOTDIR', 'Not a directory: ' + a.path);
      fs.rmdirSync(a.path);
      return null;
    }
    case 'fs.unlink': fs.unlinkSync(a.path); return null;
    case 'fs.delete': fs.rmSync(existing(a.path), { recursive: true }); return null;
    case 'fs.rename': return rename(a.from, a.to, a.overwrite);
    case 'fs.copy': return copy(a.from, a.to);
    case 'fs.readlink': return fs.readlinkSync(a.path);
    case 'fs.symlink': fs.symlinkSync(a.target, a.path); return null;
    case 'fs.chmod':
      try {
        fs.chmodSync(a.path, a.mode);
      } catch {
        /* ignored, like the Java side */
      }
      return null;
    case 'fs.listFiles': return listFiles(a.root, a.exclude, a.max ?? 50000);
    case 'search.text': return searchText(a);
    case 'search.replace': return replaceText(a);
    case 'search.cancel': generation++; return null;
    case 'agent.ping': return true;
    default: throw new OpError('ENOSYS', 'Unknown operation: ' + op);
  }
}

http
  .createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/' + token) {
      res.writeHead(404).end();
      return;
    }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      let out;
      try {
        const { op, args } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const value = await dispatch(op, args ?? {});
        out = { ok: value === undefined ? null : value };
      } catch (e) {
        out = { err: e.message || String(e), code: e.code && /^E[A-Z]+$/.test(e.code) ? e.code : 'EIO' };
      }
      const body = Buffer.from(JSON.stringify(out), 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': body.length });
      res.end(body);
    });
  })
  .listen(Number(port), '127.0.0.1');
