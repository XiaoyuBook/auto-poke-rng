import { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import { EditorState, RangeSet, StateEffect, StateField, Transaction } from '@codemirror/state';
import { Decoration, EditorView, GutterMarker, drawSelection, keymap, lineNumberMarkers, lineNumbers, placeholder } from '@codemirror/view';
import { codeFolding, foldAll, foldEffect, foldGutter, foldKeymap, foldedRanges, foldState, unfoldAll, unfoldEffect } from '@codemirror/language';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { scriptFolding } from '../scriptFolding';

interface LineStatus { runningLine?: number; errorLine?: number; message?: string }
interface Props extends LineStatus {
  scriptId: string;
  value: string;
  followLine?: number;
  onChange: (value: string) => void;
  onCursorChange: (position: { line: number; column: number }) => void;
  onManualBrowse: () => void;
}
export interface ScriptEditorHandle {
  revealLine: (line: number) => void;
  foldAll: () => void;
  unfoldAll: () => void;
}

const setLineStatus = StateEffect.define<LineStatus>();
const lineStatus = StateField.define<LineStatus>({
  create: () => ({}),
  update(value, transaction) {
    if (transaction.docChanged) value = {};
    for (const effect of transaction.effects) if (effect.is(setLineStatus)) value = effect.value;
    return value;
  },
});

function visibleLineStart(state: EditorState, number: number) {
  let position = state.doc.line(number).from;
  foldedRanges(state).between(0, position, (from, to) => {
    if (from < position && to >= position) position = state.doc.lineAt(from).from;
  });
  return position;
}

function markedLines(state: EditorState) {
  const status = state.field(lineStatus);
  const marks = new Map<number, { className: string; title?: string }>();
  for (const [number, className] of [[status.runningLine, 'is-running'], [status.errorLine, 'has-syntax-error']] as const) {
    if (!number || number < 1 || number > state.doc.lines) continue;
    const from = visibleLineStart(state, number);
    const previous = marks.get(from);
    marks.set(from, { className: `${previous?.className || ''} ${className}`, title: className === 'has-syntax-error' ? `第 ${number} 行：${status.message}` : previous?.title });
  }
  return [...marks].sort(([a], [b]) => a - b);
}

class StatusMarker extends GutterMarker {
  constructor(readonly elementClass: string) { super(); }
  eq(other: StatusMarker) { return this.elementClass === other.elementClass; }
}

function revealLine(view: EditorView, number: number, select = false) {
  if (number < 1 || number > view.state.doc.lines) return;
  const line = view.state.doc.line(number);
  const effects: StateEffect<unknown>[] = [];
  foldedRanges(view.state).between(0, view.state.doc.length, (from, to) => {
    if (from < line.from && to >= line.from) effects.push(unfoldEffect.of({ from, to }));
  });
  effects.push(EditorView.scrollIntoView(line.from, { y: 'nearest', yMargin: 24 }));
  view.dispatch({ effects, ...(select ? { selection: { anchor: line.from, head: line.to } } : {}) });
  if (select) view.focus();
}

export const ScriptEditor = forwardRef<ScriptEditorHandle, Props>(function ScriptEditor(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const states = useRef(new Map<string, EditorState>());
  const latest = useRef(props);
  latest.current = props;

  useImperativeHandle(ref, () => ({
    revealLine: line => { if (viewRef.current) revealLine(viewRef.current, line, true); },
    foldAll: () => { if (viewRef.current) foldAll(viewRef.current); },
    unfoldAll: () => { if (viewRef.current) unfoldAll(viewRef.current); },
  }), []);

  useLayoutEffect(() => {
    const saved = states.current.get(props.scriptId);
    const state = saved?.doc.toString() === latest.current.value ? saved : EditorState.create({
      doc: latest.current.value,
      extensions: [
        history(), drawSelection(), lineNumbers(), scriptFolding,
        codeFolding({
          preparePlaceholder: (state, range) => state.doc.lineAt(range.to).number - state.doc.lineAt(range.from).number,
          placeholderDOM: (_view, onclick, count: number) => {
            const button = document.createElement('button');
            button.className = 'cm-foldPlaceholder';
            button.textContent = `⋯ ${count} 行`;
            button.title = '展开代码块';
            button.setAttribute('aria-label', `展开已折叠的 ${count} 行代码`);
            button.onclick = onclick;
            return button;
          },
        }),
        foldGutter({
          markerDOM: open => {
            const marker = document.createElement('span');
            marker.className = 'fold-toggle';
            const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            icon.setAttribute('viewBox', '0 0 16 16');
            icon.setAttribute('width', '12');
            icon.setAttribute('height', '12');
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', open ? 'M4 6 L8 10 L12 6' : 'M6 4 L10 8 L6 12');
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke', 'currentColor');
            path.setAttribute('stroke-width', '1.6');
            path.setAttribute('stroke-linecap', 'round');
            path.setAttribute('stroke-linejoin', 'round');
            icon.appendChild(path);
            marker.appendChild(icon);
            marker.title = open ? '折叠代码块 (Ctrl+Shift+[)' : '展开代码块 (Ctrl+Shift+])';
            marker.setAttribute('data-expanded', String(open));
            return marker;
          },
        }),
        keymap.of([...foldKeymap, ...defaultKeymap, ...historyKeymap]),
        EditorState.tabSize.of(2),
        EditorState.phrases.of({ 'Fold line': '折叠代码块', 'Unfold line': '展开代码块', 'Folded lines': '已折叠的代码行' }),
        EditorView.contentAttributes.of({ 'aria-label': '脚本内容', spellcheck: 'false', autocapitalize: 'off' }),
        EditorView.theme({}, { dark: true }),
        placeholder('# 在此输入脚本'),
        lineStatus,
        EditorView.decorations.compute([lineStatus, foldState], state => Decoration.set(markedLines(state).map(([from, mark]) => Decoration.line({
          attributes: { class: mark.className, 'data-line': String(state.doc.lineAt(from).number), ...(mark.title ? { title: mark.title } : {}) },
        }).range(from)))),
        lineNumberMarkers.compute([lineStatus, foldState], state => RangeSet.of(markedLines(state).map(([from, mark]) => new StatusMarker(mark.className).range(from)))),
        EditorView.domEventHandlers({ wheel: () => { latest.current.onManualBrowse(); } }),
        EditorView.updateListener.of(update => {
          if (update.docChanged && !update.transactions.every(transaction => transaction.annotation(Transaction.remote))) latest.current.onChange(update.state.doc.toString());
          if (update.selectionSet || update.docChanged) {
            const position = update.state.selection.main.head;
            const line = update.state.doc.lineAt(position);
            latest.current.onCursorChange({ line: line.number, column: position - line.from + 1 });
          }
          if (update.transactions.some(transaction => transaction.effects.some(effect => effect.is(foldEffect)))) latest.current.onManualBrowse();
        }),
      ],
    });
    const view = new EditorView({ state, parent: host.current! });
    viewRef.current = view;
    const position = state.selection.main.head, line = state.doc.lineAt(position);
    latest.current.onCursorChange({ line: line.number, column: position - line.from + 1 });
    return () => { states.current.set(props.scriptId, view.state); viewRef.current = null; view.destroy(); };
  }, [props.scriptId]);

  useLayoutEffect(() => {
    const view = viewRef.current!;
    const text = props.value.replace(/\r\n?/g, '\n');
    const previous = view.state.doc.toString();
    if (previous === text) return;
    // Preserve positions and folds for external additions such as recorded commands.
    let from = 0, oldTo = previous.length, newTo = text.length;
    while (from < oldTo && from < newTo && previous[from] === text[from]) from++;
    while (oldTo > from && newTo > from && previous[oldTo - 1] === text[newTo - 1]) { oldTo--; newTo--; }
    view.dispatch({ changes: { from, to: oldTo, insert: text.slice(from, newTo) }, annotations: [Transaction.remote.of(true), Transaction.addToHistory.of(false)] });
  }, [props.scriptId, props.value]);

  useLayoutEffect(() => {
    viewRef.current!.dispatch({ effects: setLineStatus.of({ runningLine: props.runningLine, errorLine: props.errorLine, message: props.message }) });
  }, [props.scriptId, props.value, props.runningLine, props.errorLine, props.message]);

  useLayoutEffect(() => {
    if (props.followLine) revealLine(viewRef.current!, props.followLine);
  }, [props.scriptId, props.followLine]);

  return <div ref={host} className="editor-surface" />;
});
