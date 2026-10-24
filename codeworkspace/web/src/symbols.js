// Lightweight, regex-based symbol extraction for outline / go-to-symbol (no LSP).

const JS_KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'with', 'else', 'do', 'new', 'typeof', 'await']);

const RULES = {
  js: [
    [/^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/, 'function'],
    [/^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, 'class'],
    [/^\s*(?:export\s+)?(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/, 'type'],
    [/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:function|\([^)]*\)\s*(?::[^=]+)?=>|[A-Za-z_$][\w$]*\s*=>)/, 'function'],
    [/^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:defineComponent|defineStore|createApp|reactive|ref)\b/, 'variable'],
    [/^\s{2,}(?:(?:public|private|protected|static|readonly|async|get|set|override)\s+)*([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\([^)]*\)\s*(?::[^{]+)?\{\s*$/, 'method'],
  ],
  python: [
    [/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/, 'function'],
    [/^\s*class\s+([A-Za-z_]\w*)/, 'class'],
  ],
  clike: [
    [/^\s*(?:[\w@]+\s+)*(?:class|interface|enum|struct|record|object|trait|impl|union)\s+([A-Za-z_]\w*)/, 'class'],
    [/^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|func|fun|def)\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/, 'function'],
    [/^\s*(?:(?:public|private|protected|static|final|virtual|override|inline|abstract|synchronized|extern|const|unsigned|signed)\s+)*[\w:<>,\[\]*&]+\s+\**([A-Za-z_]\w*)\s*\([^;]*\)\s*(?:const\s*)?(?:throws [\w, .]+)?\s*\{?\s*$/, 'method'],
  ],
  css: [[/^\s*([^\s@{}][^{}]*?)\s*\{/, 'selector'], [/^\s*(@media[^{]*)\{/, 'selector']],
  markdown: [[/^(#{1,6})\s+(.+?)\s*#*\s*$/, 'heading']],
  yaml: [[/^([A-Za-z_][\w.-]*)\s*:/, 'key']],
  json: [[/^ {0,4}"([^"]+)"\s*:/, 'key']],
  shell: [[/^\s*(?:function\s+)?([A-Za-z_][\w-]*)\s*\(\)\s*\{?/, 'function'], [/^\s*function\s+([A-Za-z_][\w-]*)/, 'function']],
  sql: [[/^\s*create\s+(?:or\s+replace\s+)?(?:table|view|function|procedure|index|trigger)\s+(?:if\s+not\s+exists\s+)?([\w."`]+)/i, 'table']],
  html: [[/<(h[1-6])[^>]*>([^<]+)</i, 'heading'], [/\sid="([^"]+)"/, 'id']],
};

const FAMILY = {
  javascript: 'js', typescript: 'js', tsx: 'js', vue: 'js',
  python: 'python',
  java: 'clike', cpp: 'clike', csharp: 'clike', kotlin: 'clike', go: 'clike', rust: 'clike', dart: 'clike', swift: 'clike', php: 'clike', groovy: 'clike',
  css: 'css', scss: 'css', less: 'css',
  markdown: 'markdown', yaml: 'yaml', json: 'json', shell: 'shell', sql: 'sql', html: 'html', xml: 'html',
};

/** @returns {Array<{name, kind, line, depth}>} with 0-based line numbers */
export function extractSymbols(text, languageId) {
  const rules = RULES[FAMILY[languageId]];
  if (!rules) return [];
  const out = [];
  const lines = text.split('\n');
  const max = Math.min(lines.length, 20000);
  let inFence = false;
  for (let i = 0; i < max; i++) {
    const line = lines[i];
    if (line.length > 400) continue;
    if (languageId === 'markdown' && /^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) continue;
    for (const [re, kind] of rules) {
      const m = re.exec(line);
      if (!m) continue;
      let name;
      let depth = 0;
      if (kind === 'heading' && languageId === 'markdown') {
        depth = m[1].length - 1;
        name = m[2];
      } else if (kind === 'heading') {
        depth = Number(m[1][1]) - 1;
        name = m[2].trim();
      } else {
        name = m[1].trim();
        depth = Math.min(4, Math.floor((line.length - line.trimStart().length) / 2));
      }
      if (kind === 'method' && JS_KEYWORDS.has(name)) continue;
      if (!name) continue;
      out.push({ name, kind, line: i, depth });
      break;
    }
  }
  return out;
}

export const KIND_ICON = {
  function: 'ƒ', method: 'ƒ', class: 'C', type: 'T', variable: 'v', selector: '#', heading: 'H', key: 'k', table: '▦', id: '#',
};
