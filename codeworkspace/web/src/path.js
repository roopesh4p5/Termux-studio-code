// Minimal POSIX path helpers (all paths in the app are absolute POSIX paths).

export function join(...parts) {
  return normalize(parts.filter(Boolean).join('/'));
}

export function normalize(p) {
  const abs = p.startsWith('/');
  const out = [];
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return (abs ? '/' : '') + out.join('/');
}

export function dirname(p) {
  const i = p.lastIndexOf('/');
  if (i <= 0) return '/';
  return p.slice(0, i);
}

export function basename(p) {
  return p.slice(p.lastIndexOf('/') + 1);
}

export function extname(p) {
  const b = basename(p);
  const i = b.lastIndexOf('.');
  return i > 0 ? b.slice(i + 1).toLowerCase() : '';
}

export function relative(root, p) {
  if (p === root) return '';
  return p.startsWith(root + '/') ? p.slice(root.length + 1) : p;
}

export function isInside(root, p) {
  return p === root || p.startsWith(root + '/');
}
