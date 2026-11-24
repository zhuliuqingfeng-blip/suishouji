import koffi from 'koffi';
import { nativeImage } from 'electron';
import type { ClipboardRevision } from './shared.js';

function loadClipboardApi() {
  const user = koffi.load('user32.dll');
  const kernel = koffi.load('kernel32.dll');
  return {
    sequence: user.func('uint32_t __stdcall GetClipboardSequenceNumber()'),
    owner: user.func('void * __stdcall GetClipboardOwner()'),
    open: user.func('int __stdcall OpenClipboard(void *window)'),
    close: user.func('int __stdcall CloseClipboard()'),
    empty: user.func('int __stdcall EmptyClipboard()'),
    set: user.func('void * __stdcall SetClipboardData(uint32_t format, void *memory)'),
    pngFormat: user.func('uint32_t __stdcall RegisterClipboardFormatW(str16 name)')('PNG') as number,
    alloc: kernel.func('void * __stdcall GlobalAlloc(uint32_t flags, size_t bytes)'),
    lock: kernel.func('void * __stdcall GlobalLock(void *memory)'),
    unlock: kernel.func('int __stdcall GlobalUnlock(void *memory)'),
    free: kernel.func('void * __stdcall GlobalFree(void *memory)'),
    moveMemory: kernel.func('void __stdcall RtlMoveMemory(void *destination, const void *source, size_t bytes)'),
  };
}

let api: ReturnType<typeof loadClipboardApi> | undefined;
const clipboardApi = () => api ??= loadClipboardApi();
const CF_DIBV5 = 17;
const GMEM_MOVEABLE = 0x0002;
const GMEM_ZEROINIT = 0x0040;

export function windowsClipboardRevision(): ClipboardRevision {
  const clipboard = clipboardApi();
  return { sequence: clipboard.sequence(), owner: clipboard.owner() };
}

function clipboardUnchanged(expected: ClipboardRevision) {
  const current = windowsClipboardRevision();
  return current.sequence === expected.sequence && current.owner === expected.owner;
}

function createBitmap(png: Buffer) {
  const image = nativeImage.createFromBuffer(png);
  if (image.isEmpty()) throw new Error('Invalid clipboard PNG');
  const pixels = image.toBitmap();
  const { width, height } = image.getSize();
  if (pixels.length !== width * height * 4) throw new Error('Invalid clipboard bitmap');
  const header = Buffer.alloc(124); // BITMAPV5HEADER followed by top-down BGRA pixels.
  header.writeUInt32LE(header.length, 0);
  header.writeInt32LE(width, 4);
  header.writeInt32LE(-height, 8);
  header.writeUInt16LE(1, 12); // planes
  header.writeUInt16LE(32, 14); // bits per pixel
  header.writeUInt32LE(3, 16); // BI_BITFIELDS
  header.writeUInt32LE(pixels.length, 20);
  header.writeUInt32LE(0x00ff0000, 40); // red mask
  header.writeUInt32LE(0x0000ff00, 44); // green mask
  header.writeUInt32LE(0x000000ff, 48); // blue mask
  header.writeUInt32LE(0xff000000, 52); // alpha mask
  header.writeUInt32LE(0x73524742, 56); // LCS_sRGB
  header.writeUInt32LE(4, 108); // LCS_GM_IMAGES
  return [header, pixels];
}

function globalBytes(parts: Buffer[]) {
  const clipboard = clipboardApi();
  const length = parts.reduce((total, part) => total + part.length, 0);
  const memory: bigint | null = clipboard.alloc(GMEM_MOVEABLE | GMEM_ZEROINIT, length);
  if (!memory) throw new Error('Cannot allocate clipboard data');
  try {
    const address: bigint | null = clipboard.lock(memory);
    if (!address) throw new Error('Cannot lock clipboard memory');
    try {
      let destination = address;
      for (const part of parts) {
        clipboard.moveMemory(destination, part, part.length);
        destination += BigInt(part.length);
      }
    } finally {
      clipboard.unlock(memory);
    }
    return memory;
  } catch (error) {
    clipboard.free(memory);
    throw error;
  }
}

export function writeWindowsClipboardImage(windowHandle: Buffer, expected: ClipboardRevision, png: Buffer) {
  if (!clipboardUnchanged(expected)) return false;
  const clipboard = clipboardApi();
  const window = windowHandle.length === 8 ? windowHandle.readBigUInt64LE() : BigInt(windowHandle.readUInt32LE());
  if (!window || !clipboard.pngFormat) throw new Error('Clipboard window or PNG format is unavailable');

  let pngMemory: bigint | null = null, bitmapMemory: bigint | null = null;
  try {
    pngMemory = globalBytes([png]);
    bitmapMemory = globalBytes(createBitmap(png));
    if (!clipboard.open(window)) throw new Error('Clipboard is busy');
    try {
      // Hold the OS lock across the final check and write so another app cannot write in between.
      if (!clipboardUnchanged(expected)) return false;
      if (!clipboard.empty()) throw new Error('Cannot empty clipboard');

      // Offer PNG first for Office and DIBV5 for consumers of native Windows bitmaps.
      if (clipboard.set(clipboard.pngFormat, pngMemory)) pngMemory = null;
      if (clipboard.set(CF_DIBV5, bitmapMemory)) bitmapMemory = null;
      if (pngMemory && bitmapMemory) throw new Error('Cannot publish clipboard image');
      return true;
    } finally {
      clipboard.close();
    }
  } finally {
    // A successfully transferred handle belongs to Windows.
    if (pngMemory) clipboard.free(pngMemory);
    if (bitmapMemory) clipboard.free(bitmapMemory);
  }
}
