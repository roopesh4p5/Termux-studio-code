// File extension -> language. Language packages are lazy-loaded (separate chunks).
import { basename, extname } from './path.js';

const legacy = (load) => async () => {
  const [{ StreamLanguage }, mode] = await Promise.all([import('@codemirror/language'), load()]);
  return StreamLanguage.define(mode);
};

const LANGS = {
  javascript: { name: 'JavaScript', load: async () => (await import('@codemirror/lang-javascript')).javascript({ jsx: true }) },
  typescript: { name: 'TypeScript', load: async () => (await import('@codemirror/lang-javascript')).javascript({ typescript: true }) },
  tsx: { name: 'TypeScript JSX', load: async () => (await import('@codemirror/lang-javascript')).javascript({ typescript: true, jsx: true }) },
  json: { name: 'JSON', load: async () => (await import('@codemirror/lang-json')).json() },
  html: { name: 'HTML', load: async () => (await import('@codemirror/lang-html')).html() },
  vue: { name: 'Vue', load: async () => (await import('@codemirror/lang-vue')).vue() },
  css: { name: 'CSS', load: async () => (await import('@codemirror/lang-css')).css() },
  scss: { name: 'SCSS', load: async () => (await import('@codemirror/lang-css')).css() },
  less: { name: 'Less', load: async () => (await import('@codemirror/lang-css')).css() },
  markdown: { name: 'Markdown', load: async () => (await import('@codemirror/lang-markdown')).markdown() },
  xml: { name: 'XML', load: async () => (await import('@codemirror/lang-xml')).xml() },
  yaml: { name: 'YAML', load: async () => (await import('@codemirror/lang-yaml')).yaml() },
  python: { name: 'Python', load: async () => (await import('@codemirror/lang-python')).python() },
  java: { name: 'Java', load: async () => (await import('@codemirror/lang-java')).java() },
  cpp: { name: 'C/C++', load: async () => (await import('@codemirror/lang-cpp')).cpp() },
  sql: { name: 'SQL', load: async () => (await import('@codemirror/lang-sql')).sql() },
  php: { name: 'PHP', load: async () => (await import('@codemirror/lang-php')).php() },
  rust: { name: 'Rust', load: async () => (await import('@codemirror/lang-rust')).rust() },
  shell: { name: 'Shell', load: legacy(async () => (await import('@codemirror/legacy-modes/mode/shell')).shell) },
  go: { name: 'Go', load: legacy(async () => (await import('@codemirror/legacy-modes/mode/go')).go) },
  kotlin: { name: 'Kotlin', load: legacy(async () => (await import('@codemirror/legacy-modes/mode/clike')).kotlin) },
  csharp: { name: 'C#', load: legacy(async () => (await import('@codemirror/legacy-modes/mode/clike')).csharp) },
  dart: { name: 'Dart', load: legacy(async () => (await import('@codemirror/legacy-modes/mode/clike')).dart) },
  ruby: { name: 'Ruby', load: legacy(async () => (await import('@codemirror/legacy-modes/mode/ruby')).ruby) },
  lua: { name: 'Lua', load: legacy(async () => (await import('@codemirror/legacy-modes/mode/lua')).lua) },
  swift: { name: 'Swift', load: legacy(async () => (await import('@codemirror/legacy-modes/mode/swift')).swift) },
  toml: { name: 'TOML', load: legacy(async () => (await import('@codemirror/legacy-modes/mode/toml')).toml) },
  dockerfile: { name: 'Dockerfile', load: legacy(async () => (await import('@codemirror/legacy-modes/mode/dockerfile')).dockerFile) },
  properties: { name: 'Properties', load: legacy(async () => (await import('@codemirror/legacy-modes/mode/properties')).properties) },
  diff: { name: 'Diff', load: legacy(async () => (await import('@codemirror/legacy-modes/mode/diff')).diff) },
  groovy: { name: 'Groovy', load: legacy(async () => (await import('@codemirror/legacy-modes/mode/groovy')).groovy) },
  plain: { name: 'Plain Text', load: async () => [] },
};

const BY_EXT = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'tsx',
  json: 'json', jsonc: 'json', json5: 'json', webmanifest: 'json',
  html: 'html', htm: 'html', svelte: 'html',
  vue: 'vue',
  css: 'css', scss: 'scss', less: 'less',
  md: 'markdown', markdown: 'markdown', mdx: 'markdown',
  xml: 'xml', svg: 'xml', xsd: 'xml', plist: 'xml',
  yml: 'yaml', yaml: 'yaml',
  py: 'python', pyw: 'python',
  java: 'java',
  c: 'cpp', h: 'cpp', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp', ino: 'cpp',
  sql: 'sql',
  php: 'php',
  rs: 'rust',
  sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell', ksh: 'shell',
  go: 'go', kt: 'kotlin', kts: 'kotlin', cs: 'csharp', dart: 'dart',
  rb: 'ruby', lua: 'lua', swift: 'swift', toml: 'toml',
  properties: 'properties', ini: 'properties', cfg: 'properties', conf: 'properties', env: 'properties',
  diff: 'diff', patch: 'diff', gradle: 'groovy', groovy: 'groovy',
};

const BY_NAME = {
  Dockerfile: 'dockerfile', Makefile: 'shell', '.bashrc': 'shell', '.zshrc': 'shell', '.profile': 'shell',
  '.bash_profile': 'shell', '.env': 'properties', '.gitignore': 'properties', '.npmrc': 'properties',
  '.editorconfig': 'properties', '.prettierrc': 'json', '.eslintrc': 'json', '.babelrc': 'json',
};

export function languageId(path) {
  const name = basename(path);
  if (BY_NAME[name]) return BY_NAME[name];
  if (name.startsWith('.env')) return 'properties';
  return BY_EXT[extname(path)] ?? 'plain';
}

export function languageName(id) {
  return LANGS[id]?.name ?? 'Plain Text';
}

const loaded = new Map();
export function loadLanguage(id) {
  if (!loaded.has(id)) {
    loaded.set(id, (LANGS[id] ?? LANGS.plain).load().catch((e) => {
      console.error('language load failed', id, e);
      return [];
    }));
  }
  return loaded.get(id);
}
