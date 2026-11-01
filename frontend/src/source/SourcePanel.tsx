import { useMemo } from 'react';
import { EditorState, type Extension } from '@codemirror/state';
import { highlightActiveLine, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { SourceEditor, studioHighlight } from '@jespino/agentstudio';
import { editSource } from '../engine.ts';
import { useStore } from '../store.ts';
import { kinoLanguage } from './kinoLanguage.ts';

const extensions: Extension[] = [
  lineNumbers(),
  highlightActiveLine(),
  history(),
  kinoLanguage,
  studioHighlight,
  EditorState.tabSize.of(2),
  keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
];

/** The script, saved to disk as you type; the agent's edits appear here live. */
export function SourcePanel() {
  const source = useStore((s) => s.source);
  const sourceRev = useStore((s) => s.sourceRev);
  const error = useStore((s) => s.error);
  const reveal = useStore((s) => s.reveal);
  const file = useStore((s) => s.project?.path.split(/[\\/]/).pop());
  const marks = useMemo(() => (error?.line ? [{ line: error.line, className: 'cm-error-line' }] : []), [error]);

  return (
    <div className="panel source">
      <div className="panel-header">
        <span className="panel-title">Source</span>
        <span className="muted small ellipsis">{file}</span>
        <span className="spacer" />
        <span className="muted small">saved automatically</span>
      </div>
      {error && (
        <button className="source-error" onClick={() => error.line && useStore.getState().revealLine(error.line)} title="Go to the error">
          {error.line ? `${error.line}:${error.col} ` : ''}
          {error.message}
        </button>
      )}
      <SourceEditor value={source} revision={sourceRev} onEdit={editSource} extensions={extensions} marks={marks} reveal={reveal} />
    </div>
  );
}
