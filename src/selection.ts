import type { Editor, EditorPosition, TFile } from "obsidian";
import type { CapturedSelection } from "./types";

export function captureSelection(editor: Editor, sourceFile: TFile): CapturedSelection | null {
  const text = editor.getSelection();
  if (!text.trim()) {
    return null;
  }
  const ranges = editor.listSelections();
  const range = ranges[0];
  if (!range) {
    return null;
  }
  const from = minPosition(range.anchor, range.head);
  const to = maxPosition(range.anchor, range.head);
  return {
    editor,
    sourceFile,
    text,
    from,
    to,
  };
}

export function deleteSelectionIfUnchanged(captured: CapturedSelection): boolean {
  const current = captured.editor.getRange(captured.from, captured.to);
  if (current !== captured.text) {
    return false;
  }
  captured.editor.replaceRange("", captured.from, captured.to);
  return true;
}

function minPosition(a: EditorPosition, b: EditorPosition): EditorPosition {
  if (a.line < b.line || (a.line === b.line && a.ch <= b.ch)) {
    return { line: a.line, ch: a.ch };
  }
  return { line: b.line, ch: b.ch };
}

function maxPosition(a: EditorPosition, b: EditorPosition): EditorPosition {
  if (a.line > b.line || (a.line === b.line && a.ch >= b.ch)) {
    return { line: a.line, ch: a.ch };
  }
  return { line: b.line, ch: b.ch };
}

