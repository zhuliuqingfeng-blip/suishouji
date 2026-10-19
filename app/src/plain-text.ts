import { Fragment, Slice, type Node } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import { closeHistory } from '@tiptap/pm/history';

// Keep text blocks and explicit line breaks; images and other non-text leaves
// deliberately contribute no filenames, URLs or hidden HTML.
export function plainText(doc: Node, from = 0, to = doc.content.size): string {
  return doc.textBetween(from, to, '\n', node => node.type.name === 'hardBreak' ? '\n' : '');
}

export function notePlainText(title: string, body: string): string {
  return [title.trim(), body].filter(part => part.length > 0).join('\n\n');
}

export function insertPlainText(view: EditorView, text: string): void {
  const { state } = view;
  const paragraphs = text.replace(/\r\n?/g, '\n').split('\n').map(line =>
    state.schema.nodes.paragraph.create(null, line ? state.schema.text(line) : undefined));
  // An open slice inserts inline at the cursor while keeping surrounding
  // paragraphs/list items intact. Explicit markless text also avoids inheriting
  // a destination's bold/link marks. This is one undoable edit.
  const slice = new Slice(Fragment.fromArray(paragraphs), 1, 1);
  view.dispatch(closeHistory(state.tr).replaceSelection(slice).setStoredMarks([]).scrollIntoView()
    .setMeta('paste', true).setMeta('uiEvent', 'paste'));
  view.dispatch(closeHistory(view.state.tr));
  view.focus();
}
