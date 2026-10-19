import type { NotesAPI } from '../electron/shared';
declare global { interface Window { notes: NotesAPI } }
