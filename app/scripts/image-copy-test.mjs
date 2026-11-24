import { _electron as electron, chromium } from 'playwright';
import electronPath from 'electron';
import koffi from 'koffi';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import path from 'node:path';
import { appRoot, testRoot } from './paths.mjs';
import { createTestClipboard } from './image-copy-test-clipboard.mjs';

const execute = promisify(execFile);
await fs.mkdir(testRoot, { recursive: true });
const root = await fs.mkdtemp(path.join(testRoot, 'image-copy-'));
const data = path.join(root, 'data');
const exe = process.env.NOTES_PACKAGED_EXE;
const fixtures = [
  { ext: 'png', size: [1200, 47] },
  { ext: 'jpeg', size: [1184, 53] },
  { ext: 'webp', size: [1168, 59] },
  { ext: 'bmp', size: [1152, 65] },
  { ext: 'gif', size: [1136, 71] },
];
const [width, height] = fixtures[0].size;
const testClipboard = createTestClipboard();
let instance, page, appPid;

async function start() {
  instance = await electron.launch({ executablePath: exe || electronPath, cwd: appRoot,
    args: exe ? [] : ['.'], env: { ...process.env, NOTES_TEST_MODE: '1', NOTES_DATA_DIR: data } });
  page = await instance.firstWindow();
  appPid = await instance.evaluate(() => process.pid);
  await page.getByRole('button', { name: '数据与设置', exact: true }).waitFor();
  await instance.evaluate(({ ipcMain }) => {
    const channel = 'notes:call';
    // Electron's test driver can wrap the existing handler without exposing a production test API.
    const invoke = ipcMain._invokeHandlers?.get(channel);
    if (!invoke) throw new Error('无法保护验收脚本触发的剪贴板写入');
    let pendingRevision;
    globalThis.__armTestImageCopy = revision => { pendingRevision = revision; };
    globalThis.__testImageWrites = 0;
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, async (event, method, ...args) => {
      if (method === 'readImageForClipboard') {
        const revision = pendingRevision;
        pendingRevision = undefined;
        if (!revision) return { ok: false, error: '该图片复制未登记测试剪贴板版本' };
        const result = await invoke(event, method, ...args);
        if (result.ok) result.data.revision = revision;
        return result;
      }
      if (method === 'writeClipboardImage') globalThis.__testImageWrites++;
      return invoke(event, method, ...args);
    });
  });
  await testClipboard.snapshot();
}

async function armImageCopy() {
  // Reads can synthesize formats. Refresh only while the harness still owns its fixture.
  await testClipboard.rememberWrite(process.pid);
  const expected = testClipboard.expectedRevision();
  assert.ok(expected, '触发图片复制前必须登记测试剪贴板版本');
  await instance.evaluate((_electron, revision) => globalThis.__armTestImageCopy({
    sequence: revision.sequence, owner: revision.owner === null ? null : BigInt(revision.owner),
  }), { sequence: expected.sequence, owner: expected.owner?.toString() ?? null });
}

async function recordAppClipboardWrite(action) {
  try { await action(); }
  finally { await testClipboard.rememberWrite(appPid); }
}

async function clipboardInfo() {
  return instance.evaluate(async ({ clipboard }) => {
    const items = await clipboard.read();
    const image = items.find(item => item.types.includes('image/png'));
    const bytes = image ? Buffer.from(await (await image.getType('image/png')).arrayBuffer()) : null;
    return { size: bytes ? [bytes.readUInt32BE(16), bytes.readUInt32BE(20)] : null,
      text: await clipboard.readText(), html: items.some(item => item.types.includes('text/html')) };
  });
}

async function checkClipboardImage({ ext, size }) {
  let status = [];
  for (let i = 0; i < 50; i++) {
    const result = await clipboardInfo();
    if (result.size) { assert.deepEqual(result, { size, text: '', html: false }, `剪贴板应包含选中的 ${ext} 图片`); return; }
    const current = await page.locator('.toast').allTextContents();
    if (current.length) status = current;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.fail(`系统剪贴板没有 ${ext} 图片：${status.join(' ')}`);
}

async function withDelayedImageRead(image, source, action) {
  await instance.evaluate((_electron, file) => {
    const fs = process.getBuiltinModule('node:fs/promises');
    const readFile = fs.readFile;
    const race = { started: false, release: null };
    const blocked = new Promise(resolve => { race.release = resolve; });
    race.restore = () => { fs.readFile = readFile; race.release(); };
    globalThis.__cutRace = race;
    fs.readFile = async (filePath, ...args) => {
      const bytes = await readFile(filePath, ...args);
      if (filePath === file) { race.started = true; await blocked; }
      return bytes;
    };
  }, source);
  try {
    await image.click();
    await armImageCopy();
    await page.keyboard.press('Control+c');
    for (let i = 0; i < 50; i++) {
      if (await instance.evaluate(() => globalThis.__cutRace.started)) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(await instance.evaluate(() => globalThis.__cutRace.started), '图片复制应该已开始读原图');
    await action(() => instance.evaluate(() => globalThis.__cutRace.release()));
  } finally {
    await instance.evaluate(() => globalThis.__cutRace.restore());
  }
}

async function checkCutDuringImageRead(image, source, field, expected, isTitle) {
  await testClipboard.writeText('等待剪切事件');
  await withDelayedImageRead(image, source, async release => {
    if (isTitle) {
      await field.fill(expected);
      await field.selectText();
    } else {
      await field.evaluate(element => {
        const range = document.createRange(); range.selectNodeContents(element);
        document.querySelector('.tiptap').focus();
        const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      });
      await page.waitForFunction(value => window.getSelection().toString() === value, expected);
    }
    const writesBefore = await instance.evaluate(() => globalThis.__testImageWrites);
    const cutText = await field.evaluate((element, title) => {
      const transfer = new DataTransfer();
      const event = new ClipboardEvent('cut', { clipboardData: transfer, bubbles: true, cancelable: true });
      if (title) transfer.setData('text/plain', element.value.slice(element.selectionStart, element.selectionEnd));
      element.dispatchEvent(event);
      return transfer.getData('text/plain');
    }, isTitle);
    assert.equal(cutText, expected);
    if (isTitle) await field.fill('');
    await release();
    await page.waitForTimeout(500);
    assert.equal(await instance.evaluate(() => globalThis.__testImageWrites), writesBefore, '剪切事件应取消待处理图片写入');
    assert.equal((await clipboardInfo()).text, '等待剪切事件');
    await testClipboard.writeText(cutText);
    await page.keyboard.press('Control+v');
    assert.equal(isTitle ? await field.inputValue() : await field.innerText(), expected);
  });
}

async function checkInterleavedClipboardWrite(image) {
  const marker = '已登记的图片复制标记';
  const newer = '图片读取前已由另一进程更新';
  await testClipboard.writeText(marker);
  assert.equal((await clipboardInfo()).text, marker);
  await armImageCopy();
  await withExternalClipboardWriter(newer, async () => {
    await image.click({ button: 'right' });
    await page.getByText('剪贴板已有更新，已取消图片复制', { exact: true }).waitFor({ timeout: 5000 });
    assert.deepEqual(await clipboardInfo(), { size: null, text: newer, html: false });
    // Return ownership to the harness while the external test writer is still alive.
    await testClipboard.writeText('跨进程写入竞态已检查');
  }, { restoreOnSuccess: false });
}

async function checkUnexpectedWriteCleanup(image) {
  await testClipboard.snapshot();
  const before = await clipboardInfo();
  await testClipboard.writeText('等待模拟意外图片写入');
  await armImageCopy();
  await image.click({ button: 'right' });
  await checkClipboardImage(fixtures[0]);
  // Deliberately leave the last recognized write on the marker, as on a failed assertion.
  assert.equal(await testClipboard.restore(appPid), true, '意外的测试应用写入应恢复快照');
  assert.deepEqual(await clipboardInfo(), before);
}

async function checkExternalClipboardDuringImageRead(image, source) {
  const expected = '其他 Windows 应用刚写入的文字';
  await withDelayedImageRead(image, source, release => withExternalClipboardWriter(expected, async () => {
    assert.equal((await clipboardInfo()).text, expected);
    await release();
    await page.getByText('剪贴板已有更新，已取消图片复制', { exact: true }).waitFor({ timeout: 5000 });
    const afterRead = await clipboardInfo();
    assert.equal(afterRead.text, expected);
    assert.equal(afterRead.size, null);
    const title = page.getByLabel('记录标题');
    await title.fill('');
    await title.press('Control+v');
    assert.equal(await title.inputValue(), expected);
    await checkCleanupPreservesExternalWrite();
  }));
}

async function withExternalClipboardWriter(text, action, { restoreOnSuccess = true } = {}) {
  const helper = fileURLToPath(new URL('./image-copy-test-clipboard.mjs', import.meta.url));
  const writer = spawn(process.execPath, [helper, '--fixture-writer', text], { windowsHide: true, stdio: ['pipe', 'pipe', 'inherit'] });
  const closed = once(writer, 'close');
  let adopted = false;
  let completed = false;
  try {
    await Promise.race([
      once(writer.stdout, 'data', { signal: AbortSignal.timeout(10000) }),
      closed.then(([code]) => { throw new Error(`外部剪贴板进程提前退出 (${code})`); }),
    ]);
    adopted = await testClipboard.rememberWrite(writer.pid);
    assert.ok(adopted, '应能确认外部测试进程拥有剪贴板');
    await action();
    completed = true;
  } finally {
    try {
      if (!completed || restoreOnSuccess) {
        if (!adopted && writer.pid) adopted = await testClipboard.rememberWrite(writer.pid);
        await testClipboard.restore(appPid);
      }
    } finally {
      writer.stdin.end(adopted ? 'adopted\n' : undefined);
      await closed;
    }
  }
}

async function checkCleanupPreservesExternalWrite() {
  const newer = '退出前另一进程又写入了剪贴板';
  const earlierRevision = testClipboard.expectedRevision();
  await withExternalClipboardWriter(newer, async () => {
    assert.equal(await testClipboard.restore(appPid, earlierRevision), false, '清理必须跳过另一进程写入的新内容');
    assert.equal((await clipboardInfo()).text, newer);
  });
}

async function checkExternalWriterTimeoutCleanup() {
  await testClipboard.snapshot();
  const before = await clipboardInfo();
  const marker = '等待验收提示超时的测试文字';
  await assert.rejects(withExternalClipboardWriter(marker, async () => {
    assert.equal((await clipboardInfo()).text, marker);
    await page.getByText('故意不出现的剪贴板验收提示', { exact: true }).waitFor({ timeout: 100 });
  }, { restoreOnSuccess: false }), { name: 'TimeoutError' });
  assert.deepEqual(await clipboardInfo(), before, '辅助进程写入后的验收超时应恢复原剪贴板');
}

async function checkNativePaste() {
  // Read CF_DIBV5 directly before WinForms can choose a synthesized clipboard format.
  const user = koffi.load('user32.dll');
  const kernel = koffi.load('kernel32.dll');
  const open = user.func('int __stdcall OpenClipboard(void *window)');
  const close = user.func('int __stdcall CloseClipboard()');
  const getData = user.func('void * __stdcall GetClipboardData(uint32_t format)');
  const size = kernel.func('size_t __stdcall GlobalSize(void *memory)');
  const lock = kernel.func('void * __stdcall GlobalLock(void *memory)');
  const unlock = kernel.func('int __stdcall GlobalUnlock(void *memory)');
  const copy = kernel.func('void __stdcall RtlMoveMemory(void *destination, const void *source, size_t bytes)');
  const headerSize = 124, rowBytes = width * 4;
  let opened = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    if (open(null)) { opened = true; break; }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.ok(opened, '应能打开 Windows 剪贴板读取位图');
  try {
    const memory = getData(17); // CF_DIBV5
    assert.ok(memory && size(memory) >= headerSize + rowBytes * height, '剪贴板应含完整的 CF_DIBV5');
    const pixels = lock(memory);
    assert.ok(pixels, '应能读取 CF_DIBV5 内存');
    try {
      const header = Buffer.alloc(headerSize);
      copy(header, pixels, header.length);
      assert.equal(header.readUInt32LE(0), headerSize);
      assert.equal(header.readInt32LE(4), width);
      assert.equal(header.readInt32LE(8), height, 'CF_DIBV5 应使用正高度');
      const pixel = Buffer.alloc(4);
      copy(pixel, pixels + BigInt(headerSize), pixel.length);
      assert.deepEqual([...pixel], [53, 143, 18, 255], '第一行应为图像底部的绿色');
      copy(pixel, pixels + BigInt(headerSize + rowBytes * (height - 1)), pixel.length);
      assert.deepEqual([...pixel], [49, 18, 223, 255], '最后一行应为图像顶部的红色');
    } finally { unlock(memory); }
  } finally { close(); }

  const script = `
    $ErrorActionPreference='Stop'
    Add-Type -AssemblyName System.Windows.Forms
    $bitmap=[Windows.Forms.Clipboard]::GetImage()
    if(!$bitmap){throw 'Native WinForms clipboard has no bitmap'}
    try {
      $top=$bitmap.GetPixel(15,8)
      $bottom=$bitmap.GetPixel(15,$bitmap.Height-9)
      @{width=$bitmap.Width;height=$bitmap.Height;top=@($top.R,$top.G,$top.B);bottom=@($bottom.R,$bottom.G,$bottom.B)}|ConvertTo-Json -Compress
    } finally { $bitmap.Dispose() }
  `;
  const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command', script], { windowsHide: true });
  assert.deepEqual(JSON.parse(stdout), { width, height, top: [223, 18, 49], bottom: [18, 143, 53] });
}

async function checkExternalAppPaste() {
  const browser = await chromium.launch({ channel: 'msedge', headless: false, args: ['--disable-background-networking'] });
  try {
    const receiver = await browser.newPage();
    await receiver.setContent('<div aria-label="外部粘贴区" contenteditable="true"></div>');
    const editable = receiver.getByLabel('外部粘贴区');
    await editable.evaluate(element => {
      element.addEventListener('paste', async event => {
        event.preventDefault();
        const file = Array.from(event.clipboardData.files).find(item => item.type === 'image/png');
        if (!file) return;
        const bitmap = await createImageBitmap(file);
        const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
        canvas.getContext('2d').drawImage(bitmap, 0, 0); bitmap.close(); element.append(canvas);
      });
    });
    await editable.focus();
    await receiver.keyboard.press('Control+v');
    const canvas = editable.locator('canvas');
    await canvas.waitFor();
    assert.deepEqual(await canvas.evaluate(el => [el.width, el.height]), [width, height]);
  } finally { await browser.close(); }
  await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus());
}

try {
  await fs.mkdir(data, { recursive: true });
  await start();
  const pixels = await page.evaluate(formats => formats.map(({ ext, size: [width, height] }) => {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d'), split = Math.floor(height / 2);
    context.fillStyle = '#df1231'; context.fillRect(0, 0, width, split);
    context.fillStyle = '#128f35'; context.fillRect(0, split, width, height - split);
    const format = ext === 'bmp' || ext === 'gif' ? 'png' : ext;
    return canvas.toDataURL(`image/${format}`, 0.95).split(',')[1];
  }), fixtures);
  const sources = fixtures.map(({ ext }) => path.join(root, `copy.${ext}`));
  for (const [index, { ext }] of fixtures.entries()) {
    const file = ext === 'bmp' || ext === 'gif' ? path.join(root, `copy-${ext}.png`) : sources[index];
    await fs.writeFile(file, Buffer.from(pixels[index], 'base64'));
  }
  await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `
    $ErrorActionPreference='Stop'
    Add-Type -AssemblyName System.Drawing
    foreach($ext in @('bmp','gif')) {
      $format=if($ext -eq 'bmp'){[Drawing.Imaging.ImageFormat]::Bmp}else{[Drawing.Imaging.ImageFormat]::Gif}
      $inputFile=Join-Path $env:MEMO_TEST_FIXTURES ('copy-'+$ext+'.png')
      $outputFile=Join-Path $env:MEMO_TEST_FIXTURES ('copy.'+$ext)
      $bitmap=[Drawing.Image]::FromFile($inputFile)
      try { $bitmap.Save($outputFile,$format) } finally { $bitmap.Dispose() }
    }
    $seed=[Drawing.Image]::FromFile((Join-Path $env:MEMO_TEST_FIXTURES 'copy.png'))
    try { $seed.Save((Join-Path $env:MEMO_TEST_FIXTURES 'seed.bmp'),[Drawing.Imaging.ImageFormat]::Bmp) } finally { $seed.Dispose() }
  `], { env: { ...process.env, MEMO_TEST_FIXTURES: root }, windowsHide: true });

  await page.keyboard.press('Control+n');
  await page.getByLabel('记录标题').fill('原图复制专项');
  await page.locator('.tiptap').focus();
  await page.keyboard.insertText('普通文字依然可以复制');
  const testNote = await page.evaluate(async files => {
    const api = window.notes;
    const note = (await api.list({}))[0];
    const images = await api.importPaths(note.id, files);
    return { id: note.id, images };
  }, sources.slice(1));
  // Use the normal clipboard insertion path for the PNG and saved fixtures for the other formats.
  const seedBitmap = await fs.readFile(path.join(root, 'seed.bmp'));
  await testClipboard.writeImage(Buffer.from(pixels[0], 'base64'), seedBitmap.subarray(14));
  await page.keyboard.press('Control+v');
  await page.locator('.tiptap img').waitFor();
  await page.keyboard.press('Control+s');
  await page.getByText('所有更改已保存', { exact: true }).waitFor();
  const original = await page.evaluate(async ({ id, images }) => {
    const api = window.notes;
    const { note } = await api.get(id);
    const document = { ...note.document, content: [...note.document.content, ...images.map(image => ({
      type: 'image', attrs: { src: `app-asset://media/${image.id}`, assetId: image.id, alt: image.name, width: 280 }
    }))] };
    await api.save({ ...note, document });
    return api.get(id);
  }, testNote);
  // Restore before closing so a failed restart cannot leave the test image on the clipboard.
  await testClipboard.rememberWrite(process.pid);
  await testClipboard.restore(appPid);
  await instance.close(); instance = null; appPid = undefined;
  await start();
  await page.getByRole('button', { name: '继续上次记录', exact: true }).click();
  const images = page.locator('.tiptap img');
  await images.nth(4).waitFor();
  const shortImage = images.first();
  const toolbar = page.locator('.image-controls');
  await toolbar.waitFor({ state: 'hidden' });
  await shortImage.scrollIntoViewIfNeeded();
  const bounds = await shortImage.boundingBox();
  assert.ok(bounds && bounds.height < 23, '首次双击应覆盖高度不足原工具条内边距的短图');
  const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
  await page.mouse.click(x, y);
  await toolbar.waitFor();
  assert.deepEqual(await shortImage.boundingBox(), bounds, '第一次点击后图片位置不应移动');
  await page.mouse.click(x, y, { clickCount: 2 });
  await page.getByRole('dialog', { name: '查看图片' }).waitFor();
  await page.keyboard.press('Escape');
  console.log('未选中的短图在同一位置双击可打开预览');
  const fileBytes = await Promise.all(original.attachments.map(asset => fs.readFile(path.join(data, asset.relativePath))));

  const text = page.locator('.tiptap p').filter({ hasText: '普通文字依然可以复制' });
  await text.evaluate(element => {
    document.querySelector('.tiptap').focus();
    const range = document.createRange(); range.selectNodeContents(element);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
  });
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => window.getSelection().toString()), '普通文字依然可以复制');
  await instance.evaluate(({ Menu }) => {
    Menu.prototype.popup = function (options) {
      globalThis.__imageMenuLabels = this.items.map(item => item.label);
      this.items.find(item => item.label === '复制图片')?.click();
      options.callback?.();
    };
  });
  const rightClickMarker = '等待右键复制图片';
  await testClipboard.writeText(rightClickMarker);
  assert.deepEqual(await clipboardInfo(), { size: null, text: rightClickMarker, html: false });
  await armImageCopy();
  await recordAppClipboardWrite(async () => {
    await images.first().click({ button: 'right' });
    await checkClipboardImage(fixtures[0]);
  });
  assert.deepEqual(await instance.evaluate(() => globalThis.__imageMenuLabels), ['复制图片']);
  assert.equal(await page.evaluate(() => window.getSelection().toString()), '普通文字依然可以复制');
  await checkNativePaste();
  await checkExternalAppPaste();
  // Reading a synthesized bitmap can advance the clipboard sequence without changing its owner.
  await testClipboard.rememberWrite(appPid);
  console.log('右键复制后，CF_DIBV5 为正高度、底行在前，WinForms 读取上下方向正确，Edge 可粘贴');

  for (const [i, fixture] of fixtures.entries()) {
    await testClipboard.writeText('等待复制');
    // Distinct click positions avoid double-click detection when scrolling brings images to the same spot.
    await images.nth(i).click({ position: { x: 40 + i * 32, y: 5 } });
    await images.nth(i).and(page.locator('.ProseMirror-selectednode')).waitFor();
    await armImageCopy();
    await recordAppClipboardWrite(async () => {
      await page.keyboard.press('Control+c');
      await checkClipboardImage(fixture);
    });
  }
  console.log('PNG、JPEG、WebP、BMP、GIF 经 Ctrl+C 复制为原分辨率图片');

  await text.evaluate(element => {
    document.querySelector('.tiptap').focus();
    const range = document.createRange(); range.selectNodeContents(element);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
  });
  await page.waitForTimeout(100);
  const copied = await text.evaluate(element => {
    const clipboardData = new DataTransfer();
    element.dispatchEvent(new ClipboardEvent('copy', { clipboardData, bubbles: true, cancelable: true }));
    return { text: clipboardData.getData('text/plain'), html: clipboardData.getData('text/html') };
  });
  assert.equal(copied.text, '普通文字依然可以复制');
  assert.ok(copied.html);
  await testClipboard.writeText(copied.text);
  const after = await page.evaluate(id => window.notes.get(id), testNote.id);
  assert.deepEqual(after, original);
  for (const [index, asset] of original.attachments.entries())
    assert.deepEqual(await fs.readFile(path.join(data, asset.relativePath)), fileBytes[index]);
  console.log('双击预览与普通富文本复制正常，保存的记录和附件字节保持一致');

  await instance.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    globalThis.__imageTestWindowHandle = window.getNativeWindowHandle;
    window.getNativeWindowHandle = () => { throw new Error('Simulated unavailable clipboard owner window'); };
  });
  try {
    await armImageCopy();
    await images.first().click({ button: 'right' });
    await page.getByRole('alert').filter({ hasText: '无法写入系统剪贴板' }).waitFor();
    assert.equal((await clipboardInfo()).text, '普通文字依然可以复制');
  } finally {
    await instance.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].getNativeWindowHandle = globalThis.__imageTestWindowHandle;
    });
  }
  const missing = original.attachments.find(asset => asset.name === 'copy.gif');
  await fs.unlink(path.join(data, missing.relativePath));
  await armImageCopy();
  await images.last().click({ button: 'right' });
  await page.getByRole('alert').filter({ hasText: '无法读取原图' }).waitFor();
  assert.equal((await clipboardInfo()).text, '普通文字依然可以复制');
  console.log('原图缺失或剪贴板写入失败会给出提示，之前的剪贴板内容仍可用');

  const firstImageId = original.note.document.content.find(node => node.type === 'image').attrs.assetId;
  const source = path.join(data, original.attachments.find(asset => asset.id === firstImageId).relativePath);
  await checkInterleavedClipboardWrite(images.first());
  console.log('登记版本与触发复制之间的外部写入得到保留');
  await checkCutDuringImageRead(images.first(), source, page.getByLabel('记录标题'), '等待期间剪切的标题', true);
  await checkCutDuringImageRead(images.first(), source, text, '普通文字依然可以复制', false);
  console.log('图片原件读取延迟时，标题和正文剪切的文字仍可粘贴');
  await checkExternalClipboardDuringImageRead(images.first(), source);
  console.log('独立 Windows 进程更新剪贴板时，旧图片复制取消，外部文字仍可粘贴');
  console.log('退出清理保留更晚的跨进程写入，随后仅恢复已确认属于测试的夹具');
  await checkUnexpectedWriteCleanup(images.first());
  console.log('验收失败路径能识别并清理测试应用意外写入的图片');
  await checkExternalWriterTimeoutCleanup();
  console.log('外部进程写入后等待提示超时，原剪贴板在辅助进程退出前已恢复');
} finally {
  try { await testClipboard.restore(appPid); }
  finally {
    try { if (instance) await instance.close(); }
    finally { testClipboard.dispose(); }
  }
}
