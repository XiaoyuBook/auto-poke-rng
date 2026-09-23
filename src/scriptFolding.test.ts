import { EditorState } from '@codemirror/state';
import { codeFolding, foldEffect, foldedRanges } from '@codemirror/language';
import { expect, it } from 'vitest';
import { scriptFoldRanges, scriptFolding } from './scriptFolding';

function blocks(text: string) {
  const state = EditorState.create({ doc: text });
  return [...scriptFoldRanges(state.doc)].map(([start, { from, to }]) => [state.doc.lineAt(start).number, state.doc.lineAt(to).number, state.sliceDoc(from, to)]);
}

it('pairs nested loops, functions and IF branches without swallowing adjacent blocks', () => {
  const ranges = blocks('FUNC run\nIF true\nFOR 2\nA\nNEXT\nELIF false\nB\nELSE\nWHILE true\nBREAK\nEND\nENDIF\nENDFUNC\nFOR 3\nX\nNEXT');
  expect(ranges.map(([start, end]) => [start, end])).toEqual([[3, 5], [6, 7], [9, 11], [8, 11], [2, 12], [1, 13], [14, 16]]);
});

it('ignores keywords inside comments, strings, identifiers and external function declarations', () => {
  expect(blocks('# IF true\nPRINT "FOR 3 # NEXT"\n$FOR = "FUNC test"\nEXTERN FUNC f(): INT FROM "m"\nif true # comment\nPRINT "ENDIF"\nendif# comment')).toEqual([[5, 7, '\nPRINT "ENDIF"\nendif# comment']]);
});

it('leaves incomplete or mismatched blocks open, while folding later independent blocks', () => {
  expect(blocks('IF true\nFOR 3\nA\nENDIF\nNEXT\nFOR 2\nB\nNEXT\nFUNC incomplete')).toEqual([[6, 8, '\nB\nNEXT']]);
  expect(blocks('IF true\nBAD_COMMAND\nENDIF')).toEqual([[1, 3, '\nBAD_COMMAND\nENDIF']]);
});

it('keeps full source and shifts collapsed ranges when editing above them', () => {
  const text = 'FOR 3\nA 50\nNEXT\nB 50';
  let state = EditorState.create({ doc: text, extensions: [scriptFolding, codeFolding()] });
  const range = scriptFoldRanges(state.doc).get(0)!;
  state = state.update({ effects: foldEffect.of(range) }).state;
  expect(state.doc.toString()).toBe(text);
  state = state.update({ changes: { from: 0, insert: '# before\n' } }).state;
  const folded: string[] = [];
  foldedRanges(state).between(0, state.doc.length, (from, to) => { folded.push(state.sliceDoc(from, to)); });
  expect(folded).toEqual(['\nA 50\nNEXT']);
  expect(state.doc.toString()).toBe('# before\n' + text);
});
