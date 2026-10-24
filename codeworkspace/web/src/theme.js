// Dark editor theme modelled on VS Code "Dark Modern" / Dark+ token colors.
import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

const editorTheme = EditorView.theme(
  {
    '&': { color: '#d4d4d4', backgroundColor: 'var(--editor-bg)', height: '100%' },
    '.cm-content': { caretColor: '#aeafad', fontFamily: 'var(--mono)', padding: '4px 0 40vh' },
    '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.55' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#aeafad', borderLeftWidth: '2px' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: '#264f78 !important',
    },
    '.cm-activeLine': { backgroundColor: '#ffffff0a' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#cccccc' },
    '.cm-gutters': { backgroundColor: 'var(--editor-bg)', color: '#6e7681', border: 'none' },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 12px 0 10px', minWidth: '36px' },
    '.cm-foldGutter .cm-gutterElement': { color: '#8b8f94', padding: '0 4px' },
    '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
      backgroundColor: '#0064001a',
      outline: '1px solid #888888aa',
      color: 'inherit',
    },
    '.cm-nonmatchingBracket': { color: '#f14c4c' },
    '.cm-selectionMatch': { backgroundColor: '#add6ff26' },
    '.cm-searchMatch': { backgroundColor: '#623315', outline: '1px solid #9e6a03' },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: '#9e6a03' },
    '.cm-foldPlaceholder': { backgroundColor: '#3a3d41', border: 'none', color: '#c5c5c5', padding: '0 6px' },
    '.cm-tooltip': { backgroundColor: '#252526', border: '1px solid #454545', color: '#ccc' },
    '.cm-panels': { backgroundColor: '#252526', color: '#ccc' },
    '.cm-panels.cm-panels-top': { borderBottom: '1px solid #2b2b2b' },
    '.cm-panels.cm-panels-bottom': { borderTop: '1px solid #2b2b2b' },
    '.cm-highlightSpace': { backgroundImage: 'radial-gradient(circle at 50% 55%, #ffffff30 11%, transparent 5%)' },
    '.cm-flash-line': { backgroundColor: '#3794ff33', transition: 'background-color .6s' },
  },
  { dark: true },
);

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.operatorKeyword], color: '#569cd6' },
  { tag: [t.controlKeyword, t.moduleKeyword], color: '#c586c0' },
  { tag: [t.definitionKeyword, t.self, t.null, t.bool, t.atom], color: '#569cd6' },
  { tag: [t.string, t.special(t.string), t.character], color: '#ce9178' },
  { tag: [t.regexp, t.escape], color: '#d16969' },
  { tag: [t.number, t.integer, t.float], color: '#b5cea8' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: '#6a9955', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: '#dcdcaa' },
  { tag: [t.variableName, t.attributeName, t.labelName], color: '#9cdcfe' },
  { tag: [t.propertyName], color: '#9cdcfe' },
  { tag: [t.definition(t.variableName)], color: '#9cdcfe' },
  { tag: [t.constant(t.variableName), t.standard(t.variableName)], color: '#4fc1ff' },
  { tag: [t.typeName, t.className, t.namespace, t.definition(t.typeName)], color: '#4ec9b0' },
  { tag: [t.tagName], color: '#569cd6' },
  { tag: [t.angleBracket], color: '#808080' },
  { tag: [t.attributeValue], color: '#ce9178' },
  { tag: [t.operator, t.punctuation, t.separator, t.bracket], color: '#d4d4d4' },
  { tag: [t.meta, t.annotation, t.processingInstruction], color: '#c586c0' },
  { tag: [t.heading, t.heading1, t.heading2, t.heading3], color: '#569cd6', fontWeight: 'bold' },
  { tag: [t.strong], fontWeight: 'bold' },
  { tag: [t.emphasis], fontStyle: 'italic' },
  { tag: [t.strikethrough], textDecoration: 'line-through' },
  { tag: [t.link, t.url], color: '#3794ff', textDecoration: 'underline' },
  { tag: [t.monospace], color: '#ce9178' },
  { tag: [t.quote], color: '#6a9955' },
  { tag: [t.list], color: '#6796e6' },
  { tag: [t.inserted], color: '#b5cea8' },
  { tag: [t.deleted], color: '#ce9178' },
  { tag: [t.changed], color: '#569cd6' },
  { tag: [t.invalid], color: '#f44747' },
  { tag: [t.unit], color: '#b5cea8' },
  { tag: [t.color], color: '#ce9178' },
]);

export const darkTheme = [editorTheme, syntaxHighlighting(highlight)];
