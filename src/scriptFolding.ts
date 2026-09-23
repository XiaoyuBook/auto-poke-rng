import type { Text } from '@codemirror/state';
import { foldService } from '@codemirror/language';

interface FoldRange { from: number; to: number }
const closers: Record<string, string> = { IF: 'ENDIF', FOR: 'NEXT', WHILE: 'END', FUNC: 'ENDFUNC' };
const cache = new WeakMap<Text, Map<number, FoldRange>>();

// This only finds matched block boundaries, even while a statement is being edited.
// Syntax and type checking remain the responsibility of the EasyCon compiler.
export function scriptFoldRanges(doc: Text): Map<number, FoldRange> {
  const cached = cache.get(doc);
  if (cached) return cached;
  const ranges = new Map<number, FoldRange>();
  const stack: { kind: string; start: number; from: number; branch?: { start: number; from: number } }[] = [];
  for (let number = 1; number <= doc.lines; number++) {
    const line = doc.line(number);
    // Commands must be the first token; comments and quoted keyword text never open blocks.
    const keyword = /^\s*([a-z]+)(?=\s|#|$)/i.exec(line.text)?.[1].toUpperCase();
    if (!keyword) continue;
    if (closers[keyword]) {
      stack.push({ kind: keyword, start: line.from, from: line.to });
      continue;
    }
    const open = stack.at(-1);
    if ((keyword === 'ELIF' || keyword === 'ELSE') && open?.kind === 'IF') {
      if (open.branch && line.from - 1 > open.branch.from) ranges.set(open.branch.start, { from: open.branch.from, to: line.from - 1 });
      open.branch = { start: line.from, from: line.to };
    } else if (Object.values(closers).includes(keyword)) {
      if (!open || closers[open.kind] !== keyword) {
        stack.length = 0; // A mismatched terminator must not hide unrelated later code.
        continue;
      }
      stack.pop();
      if (open.branch && line.from - 1 > open.branch.from) ranges.set(open.branch.start, { from: open.branch.from, to: line.from - 1 });
      ranges.set(open.start, { from: open.from, to: line.to });
    }
  }
  cache.set(doc, ranges);
  return ranges;
}

export const scriptFolding = foldService.of((state, from) => scriptFoldRanges(state.doc).get(from) || null);
