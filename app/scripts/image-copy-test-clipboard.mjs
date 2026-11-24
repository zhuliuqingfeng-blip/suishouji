import koffi from 'koffi';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';

// These formats store their payload in movable global memory, unlike GDI handles.
const standardFormats = new Set([1, 7, 8, 13, 16, 17]);
const registeredFormats = new Set(['HTML Format', 'Rich Text Format', 'PNG', 'Chromium Web Custom MIME Data Format',
  'Chromium internal source RFH token', 'Chromium internal source URL']);
const maxSnapshotBytes = 32 * 1024 * 1024;

export function createTestClipboard() {
  const user = koffi.load('user32.dll');
  const kernel = koffi.load('kernel32.dll');
  const hwnd = user.func('void * __stdcall CreateWindowExW(uint32_t,str16,str16,uint32_t,int,int,int,int,void*,void*,void*,void*)')(
    0, 'STATIC', 'Suishouji clipboard test', 0, 0, 0, 0, 0, null, null, null, null);
  if (!hwnd) throw new Error('无法创建剪贴板测试窗口');
  const destroy = user.func('int __stdcall DestroyWindow(void*)');
  const open = user.func('int __stdcall OpenClipboard(void*)');
  const close = user.func('int __stdcall CloseClipboard()');
  const empty = user.func('int __stdcall EmptyClipboard()');
  const sequence = user.func('uint32_t __stdcall GetClipboardSequenceNumber()');
  const owner = user.func('void * __stdcall GetClipboardOwner()');
  const ownerProcess = user.func('uint32_t __stdcall GetWindowThreadProcessId(void*, _Out_ uint32_t*)');
  const nextFormat = user.func('uint32_t __stdcall EnumClipboardFormats(uint32_t)');
  const countFormats = user.func('int __stdcall CountClipboardFormats()');
  const formatName = user.func('int __stdcall GetClipboardFormatNameW(uint32_t,void*,int)');
  const register = user.func('uint32_t __stdcall RegisterClipboardFormatW(str16)');
  const getData = user.func('void * __stdcall GetClipboardData(uint32_t)');
  const setData = user.func('void * __stdcall SetClipboardData(uint32_t,void*)');
  const size = kernel.func('size_t __stdcall GlobalSize(void*)');
  const allocate = kernel.func('void * __stdcall GlobalAlloc(uint32_t,size_t)');
  const lock = kernel.func('void * __stdcall GlobalLock(void*)');
  const unlock = kernel.func('int __stdcall GlobalUnlock(void*)');
  const free = kernel.func('void * __stdcall GlobalFree(void*)');
  const copy = kernel.func('void __stdcall RtlMoveMemory(void*,const void*,size_t)');
  let snapshot, initialRevision, lastWrite;

  async function withClipboard(action) {
    for (let attempt = 0; attempt < 20; attempt++) {
      if (open(hwnd)) {
        try { return action(); }
        finally { close(); }
      }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error('Windows 剪贴板正在使用，请稍后重新运行测试');
  }

  function supportsSnapshot(format) {
    if (standardFormats.has(format)) return true;
    const name = Buffer.alloc(512);
    const length = formatName(format, name, name.length / 2);
    return registeredFormats.has(name.toString('utf16le', 0, length * 2));
  }

  const revision = () => ({ sequence: sequence(), owner: owner() });
  const matches = expected => expected && sequence() === expected.sequence && owner() === expected.owner;

  function publish(entries) {
    const prepared = [];
    try {
      for (const { format, bytes } of entries) {
        const memory = allocate(0x0042, bytes.length); // GMEM_MOVEABLE | GMEM_ZEROINIT
        if (!memory) throw new Error('无法分配剪贴板测试内存');
        prepared.push({ format, memory });
        const address = lock(memory);
        if (!address) throw new Error('无法准备剪贴板测试内容');
        try { copy(address, bytes, bytes.length); }
        finally { unlock(memory); }
      }
      if (!empty()) throw new Error('无法更新测试剪贴板');
      for (const entry of prepared) {
        if (!setData(entry.format, entry.memory)) throw new Error('无法写入剪贴板测试内容');
        entry.memory = null; // Clipboard owns the handle after a successful write.
      }
    } finally { for (const { memory } of prepared) if (memory) free(memory); }
  }

  async function writeFixture(entries) {
    if (entries.some(entry => !entry.format)) throw new Error('无法注册剪贴板测试格式');
    await withClipboard(() => {
      if (!matches(lastWrite ?? initialRevision)) throw new Error('剪贴板已被其他程序更新，已停止写入测试数据');
      publish(entries);
      lastWrite = revision();
    });
  }

  return {
    async snapshot() {
      await withClipboard(() => {
        const count = countFormats();
        const formats = [];
        for (let format = nextFormat(0); format; format = nextFormat(format)) formats.push(format);
        // CF_BITMAP is synthesized from the DIB when read back.
        const hasDib = formats.includes(8) || formats.includes(17);
        const stored = formats.filter(format => format !== 2 || !hasDib);
        if (count !== formats.length || stored.some(format => !supportsSnapshot(format)))
          throw new Error('当前剪贴板格式无法安全备份。请在禁用剪贴板共享的 Windows 会话中运行图片复制测试。');
        let total = 0;
        snapshot = stored.map(format => {
          const memory = getData(format);
          const length = memory ? Number(size(memory)) : 0;
          total += length;
          if (!length || total > maxSnapshotBytes) throw new Error('无法安全保存当前剪贴板内容');
          const address = lock(memory);
          if (!address) throw new Error('无法读取测试前的剪贴板内容');
          try {
            const bytes = Buffer.alloc(length);
            copy(bytes, address, length);
            return { format, bytes };
          } finally { unlock(memory); }
        });
        initialRevision = revision();
      });
      lastWrite = undefined;
    },
    async rememberWrite(pid) {
      return withClipboard(() => {
        const currentOwner = owner();
        const currentPid = [0];
        if (!currentOwner || !ownerProcess(currentOwner, currentPid) || currentPid[0] !== pid) return false;
        lastWrite = { sequence: sequence(), owner: currentOwner };
        return true;
      });
    },
    writeText(text) { return writeFixture([{ format: 13, bytes: Buffer.from(text + '\0', 'utf16le') }]); },
    writeImage(png, dib) { return writeFixture([{ format: register('PNG'), bytes: png }, { format: 8, bytes: dib }]); },
    async restore() {
      if (snapshot === undefined || !lastWrite) return false;
      return withClipboard(() => {
        // The version and owner are checked while holding the lock used to restore.
        if (!matches(lastWrite)) return false;
        publish(snapshot);
        initialRevision = lastWrite = snapshot = undefined;
        return true;
      });
    },
    dispose() { destroy(hwnd); },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv[2] === '--fixture-writer') {
  const clipboard = createTestClipboard();
  try {
    await clipboard.snapshot();
    await clipboard.writeText(process.argv[3]);
    console.log('ready');
    process.stdin.resume();
    await once(process.stdin, 'end');
  } finally { clipboard.dispose(); }
}
