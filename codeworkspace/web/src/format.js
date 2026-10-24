// Prettier-based formatting. Prettier and its plugins are lazy-loaded on first use.
import { extname, basename, join } from './path.js';
import { fs } from './native.js';
import { settings } from './settings.js';

const PARSERS = {
  js: 'babel', jsx: 'babel', mjs: 'babel', cjs: 'babel',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  json: 'json', jsonc: 'json', json5: 'json5', webmanifest: 'json',
  html: 'html', htm: 'html', vue: 'vue',
  css: 'css', scss: 'scss', less: 'less',
  md: 'markdown', markdown: 'markdown',
  yml: 'yaml', yaml: 'yaml',
};

const PLUGINS = {
  babel: ['babel', 'estree'],
  json: ['babel', 'estree'],
  json5: ['babel', 'estree'],
  typescript: ['typescript', 'estree'],
  html: ['html', 'babel', 'estree', 'postcss'],
  vue: ['html', 'babel', 'estree', 'postcss', 'typescript'],
  css: ['postcss'],
  scss: ['postcss'],
  less: ['postcss'],
  markdown: ['markdown', 'babel', 'estree', 'postcss', 'html', 'yaml'],
  yaml: ['yaml'],
};

const pluginLoaders = {
  babel: () => import('prettier/plugins/babel'),
  estree: () => import('prettier/plugins/estree'),
  typescript: () => import('prettier/plugins/typescript'),
  html: () => import('prettier/plugins/html'),
  postcss: () => import('prettier/plugins/postcss'),
  markdown: () => import('prettier/plugins/markdown'),
  yaml: () => import('prettier/plugins/yaml'),
};

export function parserFor(path) {
  if (basename(path) === 'package.json' || basename(path) === 'composer.json') return 'json-stringify';
  return PARSERS[extname(path)] ?? null;
}

export function canFormat(path) {
  return parserFor(path) != null;
}

/** Reads .prettierrc / .prettierrc.json / package.json#prettier from the project root. */
async function projectConfig(root) {
  if (!root) return {};
  for (const name of ['.prettierrc', '.prettierrc.json']) {
    try {
      const { text } = await fs.readText(join(root, name));
      return JSON.parse(text);
    } catch {
      /* missing or not JSON */
    }
  }
  try {
    const { text } = await fs.readText(join(root, 'package.json'));
    return JSON.parse(text).prettier ?? {};
  } catch {
    return {};
  }
}

/**
 * Formats text. Returns {formatted, cursorOffset}.
 * range: optional {from, to} to format a selection (honoured by JS/TS parsers).
 */
export async function formatText(text, path, { root, cursorOffset = 0, range } = {}) {
  let parser = parserFor(path);
  if (!parser) throw new Error('No formatter available for this file type');
  const names = PLUGINS[parser === 'json-stringify' ? 'json' : parser];
  const [prettier, ...plugins] = await Promise.all([
    import('prettier/standalone'),
    ...names.map((n) => pluginLoaders[n]()),
  ]);
  const options = {
    plugins: plugins.map((m) => m.default ?? m),
    tabWidth: settings.tabSize,
    useTabs: !settings.insertSpaces,
    semi: settings.prettierSemi,
    singleQuote: settings.prettierSingleQuote,
    printWidth: Number(settings.prettierPrintWidth) || 80,
    trailingComma: settings.prettierTrailingComma,
    ...(await projectConfig(root)),
    parser,
    cursorOffset: Math.min(cursorOffset, text.length),
  };
  delete options.overrides;
  delete options.$schema;
  if (range) {
    options.rangeStart = range.from;
    options.rangeEnd = range.to;
  }
  const api = prettier.default ?? prettier;
  return api.formatWithCursor(text, options);
}
