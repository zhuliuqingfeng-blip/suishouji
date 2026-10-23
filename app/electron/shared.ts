export interface RichNode { type?: string; text?: string; attrs?: Record<string, unknown>; marks?: { type: string; attrs?: Record<string, unknown> }[]; content?: RichNode[] }
export interface Attachment { id: string; noteId: string; name: string; mime: string; size: number; kind: 'image' | 'file'; relativePath: string }
export interface Note {
  id: string; title: string; document: RichNode; plainText: string; tags: string[];
  createdAt: string; updatedAt: string; pinned: boolean; deletedAt: string | null;
}
export interface NoteInput { id: string; title: string; document: RichNode; tags: string[] }
export interface NoteSummary extends Omit<Note, 'document'> { attachmentCount: number }
export interface NoteDetail { note: Note; attachments: Attachment[] }
export type SortOrder = 'updated' | 'created' | 'title';
export interface Filter { query?: string; tag?: string; trash?: boolean; sort?: SortOrder }
export interface BatchResult { succeeded: string[]; failed: { id: string; error: string }[]; cancelled?: boolean; warnings?: string[]; undo?: { token: string; expiresAt: number } }
export interface Overview { active: number; trash: number; tags: { name: string; count: number }[] }
export interface AppInfo { dataDir: string; version: string; lastBackup: string | null; backupWarning: string | null }
export interface ImportantDayInput {
  id?: string; name: string; calendar: 'solar' | 'lunar'; year: number | null; month: number; day: number;
  isLeapMonth: boolean;
  yearly: boolean; reminderDays: number; note: string;
}
export interface ImportantDay extends ImportantDayInput { id: string; createdAt: string; updatedAt: string }
export interface DayReminder { key: string; dayId: string; occurrence: string; stage: 'advance' | 'today' }
export type Result<T> = { ok: true; data: T } | { ok: false; error: string };
export type TextMenuAction = 'copyPlain' | 'pastePlain' | 'copyAllPlain';
export interface TextMenuOptions { mode: 'context' | 'toolbar'; hasSelection: boolean; hasText: boolean; editable: boolean; x: number; y: number }
export interface NotesAPI {
  listImportantDays(): Promise<ImportantDay[]>; saveImportantDay(input: ImportantDayInput): Promise<ImportantDay>;
  removeImportantDay(id: string): Promise<void>; pendingDayReminders(): Promise<DayReminder[]>;
  acknowledgeDayReminders(keys: string[]): Promise<void>;
  list(filter: Filter): Promise<NoteSummary[]>; overview(): Promise<Overview>;
  create(): Promise<NoteDetail>; get(id: string): Promise<NoteDetail>; save(input: NoteInput): Promise<Note>;
  pin(id: string, pinned: boolean): Promise<void>; trash(id: string): Promise<void>; restoreNote(id: string): Promise<void>;
  remove(id: string): Promise<void>; emptyTrash(): Promise<void>;
  trashMany(ids: string[]): Promise<BatchResult>; restoreMany(ids: string[]): Promise<BatchResult>;
  removeMany(ids: string[]): Promise<BatchResult>; undoDelete(token: string): Promise<BatchResult>;
  pickFiles(noteId: string): Promise<Attachment[]>;
  importPaths(noteId: string, paths: string[]): Promise<Attachment[]>;
  pasteImage(noteId: string, bytes: Uint8Array, mime: string): Promise<Attachment>;
  openAttachment(id: string): Promise<void>; openLink(url: string): Promise<void>;
  backup(): Promise<string | null>; restoreBackup(): Promise<boolean>; exportNotes(id?: string): Promise<string | null>;
  info(): Promise<AppInfo>; openDataDir(): Promise<void>;
  readClipboardText(): Promise<string>; writeClipboardText(text: string): Promise<void>;
  showTextMenu(options: TextMenuOptions): Promise<TextMenuAction | null>;
  readyToClose(): Promise<void>; onCloseRequested(callback: () => void): () => void;
  onOperation(callback: (busy: boolean) => void): () => void;
  pathsForFiles(files: File[]): string[];
}
