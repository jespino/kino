import { useEffect, useRef } from 'react';
import { Annotation, EditorState, StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, highlightActiveLine, keymap, lineNumbers, type DecorationSet } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { editSource } from '../engine.ts';
import { useStore } from '../store.ts';
import { kinoHighlight, kinoLanguage } from './kinoLanguage.ts';

const setErrorLine = StateEffect.define<number | null>();
/** tags changes that come from the store, so they aren't echoed back as edits */
const fromStore = Annotation.define<boolean>();

/** Marks the line of the current compile error. */
const errorLine = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setErrorLine)) continue;
      const line = e.value;
      deco = line && line <= tr.state.doc.lines ? Decoration.set([Decoration.line({ class: 'cm-error-line' }).range(tr.state.doc.line(line).from)]) : Decoration.none;
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const extensions: Extension[] = [
  lineNumbers(),
  highlightActiveLine(),
  history(),
  kinoLanguage,
  kinoHighlight,
  errorLine,
  EditorState.tabSize.of(2),
  keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
];

/** The script, saved to disk as you type; the agent's edits appear here live. */
export function SourcePanel() {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const sourceRev = useStore((s) => s.sourceRev);
  const error = useStore((s) => s.error);
  const reveal = useStore((s) => s.reveal);
  const file = useStore((s) => s.project?.path.split(/[\\/]/).pop());

  useEffect(() => {
    view.current = new EditorView({
      state: EditorState.create({
        doc: useStore.getState().source,
        extensions: [
          ...extensions,
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !u.transactions.some((tr) => tr.annotation(fromStore))) editSource(u.state.doc.toString());
          }),
        ],
      }),
      parent: host.current!,
    });
    return () => {
      view.current?.destroy();
      view.current = null;
    };
  }, []);

  // the script was replaced from outside (disk, another project)
  useEffect(() => {
    const v = view.current;
    const source = useStore.getState().source;
    if (!v || v.state.doc.toString() === source) return;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: source }, annotations: fromStore.of(true) });
  }, [sourceRev]);

  useEffect(() => {
    view.current?.dispatch({ effects: setErrorLine.of(error?.line ?? null) });
  }, [error, sourceRev]);

  useEffect(() => {
    const v = view.current;
    if (!v || !reveal || reveal.line > v.state.doc.lines) return;
    const line = v.state.doc.line(reveal.line);
    v.dispatch({ selection: { anchor: line.from, head: line.to }, effects: EditorView.scrollIntoView(line.from, { y: 'center' }) });
    v.focus();
  }, [reveal]);

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
      <div className="source-editor" ref={host} />
    </div>
  );
}
