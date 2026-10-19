export interface RichNode { type?: string; text?: string; attrs?: Record<string, unknown>; marks?: { type: string; attrs?: Record<string, unknown> }[]; content?: RichNode[] }
export interface Attachment { id: string; noteId: string; name: string; mime: string; size: number; kind: 'image' | 'file'; relativePath: string }
export interface Note {
  id: string; title: string; document: RichNode; plainText: string; tags: string[];
  createdAt: string; updatedAt: string; pinned: boolean; deletedAt: string | null;
}
export interface NoteInput { id: string; title: string; document: RichNode; tags: string[] }
export interface NoteSummary extends Omit<Note, 'document'> { attachmentCount: number }
export interface NoteDetail { note: Note; attachments: Attachment[] }
export interface Filter { query?: string; tag?: string; trash?: boolean }
export interface Overview { active: number; trash: number; tags: { name: string; count: number }[] }
export interface AppInfo { dataDir: string; version: string; lastBackup: string | null; backupWarning: string | null }
export type Result<T> = { ok: true; data: T } | { ok: false; error: string };
export interface NotesAPI {
  list(filter: Filter): Promise<NoteSummary[]>; overview(): Promise<Overview>;
  create(): Promise<NoteDetail>; get(id: string): Promise<NoteDetail>; save(input: NoteInput): Promise<Note>;
  pin(id: string, pinned: boolean): Promise<void>; trash(id: string): Promise<void>; restoreNote(id: string): Promise<void>;
  remove(id: string): Promise<void>; emptyTrash(): Promise<void>;
  pickFiles(noteId: string): Promise<Attachment[]>;
  importPaths(noteId: string, paths: string[]): Promise<Attachment[]>;
  pasteImage(noteId: string, bytes: Uint8Array, mime: string): Promise<Attachment>;
  openAttachment(id: string): Promise<void>; openLink(url: string): Promise<void>;
  backup(): Promise<string | null>; restoreBackup(): Promise<boolean>; exportNotes(id?: string): Promise<string | null>;
  info(): Promise<AppInfo>; openDataDir(): Promise<void>;
  readyToClose(): Promise<void>; onCloseRequested(callback: () => void): () => void;
  onOperation(callback: (busy: boolean) => void): () => void;
  pathsForFiles(files: File[]): string[];
}
