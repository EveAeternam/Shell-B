import { useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { createTheme } from '@uiw/codemirror-themes';
import { tags as t } from '@lezer/highlight';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { javascript } from '@codemirror/lang-javascript';
import { markdown } from '@codemirror/lang-markdown';
import { json } from '@codemirror/lang-json';
import { python } from '@codemirror/lang-python';
import { cpp } from '@codemirror/lang-cpp';
import { rust } from '@codemirror/lang-rust';
import { go } from '@codemirror/lang-go';
import { java } from '@codemirror/lang-java';
import { sql } from '@codemirror/lang-sql';
import { yaml } from '@codemirror/lang-yaml';
import { xml } from '@codemirror/lang-xml';
import { EditorView, keymap } from '@codemirror/view';
import { Prec } from '@codemirror/state';

const dark = createTheme({
  theme: 'dark',
  settings: {
    background: 'var(--bg-code)', foreground: '#e0deda', caret: 'var(--accent-soft)', selection: 'rgba(168,85,247,.32)',
    selectionMatch: 'rgba(168,85,247,.16)', lineHighlight: 'rgba(255,255,255,.03)', gutterBackground: 'var(--bg-code)',
    gutterForeground: '#5f5d59', gutterBorder: 'transparent', fontFamily: '"JetBrains Mono Variable", ui-monospace, monospace',
  },
  styles: [
    { tag: [t.comment, t.meta], color: '#7d7a75', fontStyle: 'italic' },
    { tag: [t.keyword, t.tagName, t.modifier], color: '#e8916f' },
    { tag: [t.string, t.special(t.string), t.regexp], color: '#a8c98a' },
    { tag: [t.number, t.bool, t.null, t.atom, t.color], color: '#e5c07b' },
    { tag: [t.attributeName, t.propertyName], color: '#e8b48a' },
    { tag: [t.function(t.variableName), t.className, t.typeName], color: '#7fb4e6' },
    { tag: [t.heading], color: '#e8916f', fontWeight: '700' },
    { tag: [t.link, t.url], color: '#7fb4e6', textDecoration: 'underline' },
    { tag: [t.punctuation, t.angleBracket, t.bracket], color: '#9d9a95' },
  ],
});

const light = createTheme({
  theme: 'light',
  settings: {
    background: 'var(--bg-code)', foreground: '#2c2a26', caret: '#b5532f', selection: 'rgba(201,100,66,.22)',
    selectionMatch: 'rgba(201,100,66,.12)', lineHighlight: 'rgba(0,0,0,.03)', gutterBackground: 'var(--bg-code)',
    gutterForeground: '#a8a49c', gutterBorder: 'transparent', fontFamily: '"JetBrains Mono Variable", ui-monospace, monospace',
  },
  styles: [
    { tag: [t.comment, t.meta], color: '#8c8983', fontStyle: 'italic' },
    { tag: [t.keyword, t.tagName, t.modifier], color: '#b5532f' },
    { tag: [t.string, t.special(t.string), t.regexp], color: '#4f7a28' },
    { tag: [t.number, t.bool, t.null, t.atom, t.color], color: '#a86a00' },
    { tag: [t.attributeName, t.propertyName], color: '#9a5320' },
    { tag: [t.function(t.variableName), t.className, t.typeName], color: '#2a64a8' },
    { tag: [t.heading], color: '#b5532f', fontWeight: '700' },
    { tag: [t.punctuation, t.angleBracket, t.bracket], color: '#77746e' },
  ],
});

function language(path: string) {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'html' || ext === 'htm' || ext === 'vue' || ext === 'svelte') return [html()];
  if (ext === 'svg' || ext === 'xml' || ext === 'qrc' || ext === 'ui') return [xml()];
  if (ext === 'css' || ext === 'scss' || ext === 'less') return [css()];
  if (['js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx'].includes(ext)) return [javascript({ jsx: ext.endsWith('x'), typescript: ext.startsWith('t') })];
  if (ext === 'md' || ext === 'markdown') return [markdown()];
  if (ext === 'json' || ext === 'jsonc') return [json()];
  if (ext === 'py' || ext === 'pyi') return [python()];
  if (['c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'hh', 'ino'].includes(ext)) return [cpp()];
  if (ext === 'rs') return [rust()];
  if (ext === 'go') return [go()];
  if (ext === 'java' || ext === 'kt' || ext === 'cs') return [java()];
  if (ext === 'sql') return [sql()];
  if (ext === 'yaml' || ext === 'yml') return [yaml()];
  return [];
}

export default function CodeEditor({ path, value, onChange, onSave, onRun, dark: isDark, readOnly }: {
  path: string; value: string; onChange: (v: string) => void; onSave: () => void; onRun?: () => void; dark: boolean; readOnly?: boolean;
}) {
  const extensions = useMemo(() => [
    ...language(path),
    EditorView.lineWrapping,
    keymap.of([
      { key: 'Mod-s', preventDefault: true, run: () => { onSave(); return true; } },
    ]),
    // above basicSetup's own Mod-Enter (insert blank line)
    ...(onRun ? [Prec.high(keymap.of([{ key: 'Mod-Enter', preventDefault: true, run: () => { onRun(); return true; } }]))] : []),
    EditorView.theme({ '&': { height: '100%', fontSize: '12.5px' }, '.cm-scroller': { lineHeight: '1.6' } }),
  ], [path, onSave, onRun]);
  return (
    <CodeMirror
      value={value} onChange={onChange} extensions={extensions} theme={isDark ? dark : light} readOnly={readOnly}
      height="100%" className="h-full" basicSetup={{ foldGutter: true, highlightActiveLine: true, tabSize: 2 }}
    />
  );
}
