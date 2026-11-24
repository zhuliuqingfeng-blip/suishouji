import { _electron as electron, chromium } from 'playwright';
import electronPath from 'electron';
import koffi from 'koffi';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { appRoot, testRoot } from './paths.mjs';

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
let instance, page, savedClipboard;

async function start() {
  instance = await electron.launch({ executablePath: exe || electronPath, cwd: appRoot,
    args: exe ? [] : ['.'], env: { ...process.env, NOTES_TEST_MODE: '1', NOTES_DATA_DIR: data } });
  page = await instance.firstWindow();
  await page.getByRole('button', { name: '数据与设置', exact: true }).waitFor();
  savedClipboard = await instance.evaluate(async ({ clipboard }) =>
    Promise.all((await clipboard.read()).map(async item => Object.fromEntries(await Promise.all(item.types.map(async type => {
      const value = await item.getType(type);
      return [type, value instanceof Blob ? { blob: Array.from(new Uint8Array(await value.arrayBuffer())), mime: value.type } : { bookmark: value }];
    }))))));
}

async function restoreClipboard() {
  if (savedClipboard === undefined) return;
  await instance.evaluate(async ({ clipboard, ClipboardItem }, items) => {
    if (!items.length) { clipboard.clear(); return; }
    await clipboard.write(items.map(item => new ClipboardItem(Object.fromEntries(Object.entries(item).map(([type, value]) =>
      [type, value.blob ? new Blob([new Uint8Array(value.blob)], { type: value.mime }) : value.bookmark])))));
  }, savedClipboard);
  savedClipboard = undefined;
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
  for (let i = 0; i < 50; i++) {
    const result = await clipboardInfo();
    if (result.size) { assert.deepEqual(result, { size, text: '', html: false }, `剪贴板应包含选中的 ${ext} 图片`); return; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.fail('系统剪贴板没有图片：' + await page.locator('.toast').allTextContents());
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
    await page.keyboard.press('Control+x');
    assert.equal(await instance.evaluate(({ clipboard }) => clipboard.readText()), expected);
    await release();
    // Allow the resumed image request time to reach the clipboard if it was not canceled.
    await page.waitForTimeout(500);
    const afterRead = await clipboardInfo();
    assert.equal(afterRead.text, expected, '切出的文字应保留在剪贴板中');
    assert.equal(afterRead.size, null);
    await page.keyboard.press('Control+v');
    assert.equal(isTitle ? await field.inputValue() : await field.innerText(), expected);
  });
}

async function checkExternalClipboardDuringImageRead(image, source) {
  const expected = '其他 Windows 应用刚写入的文字';
  await withDelayedImageRead(image, source, async release => {
    await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command', `
      $ErrorActionPreference='Stop'
      Add-Type -AssemblyName System.Windows.Forms
      [Windows.Forms.Clipboard]::SetText($env:MEMO_TEST_TEXT)
    `], { env: { ...process.env, MEMO_TEST_TEXT: expected }, windowsHide: true });
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
  });
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
  await instance.evaluate(async ({ clipboard, ClipboardItem }, base64) => {
    const bytes = Buffer.from(base64, 'base64');
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([bytes], { type: 'image/png' }) })]);
  }, pixels[0]);
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
  await restoreClipboard();
  await instance.close(); instance = null;
  await start();
  await page.getByRole('button', { name: '继续上次记录', exact: true }).click();
  const images = page.locator('.tiptap img');
  await images.nth(4).waitFor();
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
  await instance.evaluate(({ clipboard }, marker) => clipboard.writeText(marker), rightClickMarker);
  assert.deepEqual(await clipboardInfo(), { size: null, text: rightClickMarker, html: false });
  await images.first().click({ button: 'right' });
  await checkClipboardImage(fixtures[0]);
  assert.deepEqual(await instance.evaluate(() => globalThis.__imageMenuLabels), ['复制图片']);
  assert.equal(await page.evaluate(() => window.getSelection().toString()), '普通文字依然可以复制');
  await checkNativePaste();
  await checkExternalAppPaste();
  console.log('右键复制后，CF_DIBV5 为正高度、底行在前，WinForms 读取上下方向正确，Edge 可粘贴');

  for (const [i, fixture] of fixtures.entries()) {
    await instance.evaluate(({ clipboard }) => clipboard.writeText('等待复制'));
    // Distinct click positions avoid double-click detection when scrolling brings images to the same spot.
    await images.nth(i).click({ position: { x: 40 + i * 32, y: 5 } });
    await images.nth(i).and(page.locator('.ProseMirror-selectednode')).waitFor();
    await page.keyboard.press('Control+c');
    await checkClipboardImage(fixture);
  }
  console.log('PNG、JPEG、WebP、BMP、GIF 经 Ctrl+C 复制为原分辨率图片');

  await images.first().dblclick();
  await page.getByRole('dialog', { name: '查看图片' }).waitFor();
  await page.keyboard.press('Escape');
  await text.evaluate(element => {
    document.querySelector('.tiptap').focus();
    const range = document.createRange(); range.selectNodeContents(element);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
  });
  await page.waitForTimeout(100);
  await page.keyboard.press('Control+c');
  assert.deepEqual(await clipboardInfo(), { size: null, text: '普通文字依然可以复制', html: true });
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
  await images.last().click({ button: 'right' });
  await page.getByRole('alert').filter({ hasText: '无法读取原图' }).waitFor();
  assert.equal((await clipboardInfo()).text, '普通文字依然可以复制');
  console.log('原图缺失或剪贴板写入失败会给出提示，之前的剪贴板内容仍可用');

  const firstImageId = original.note.document.content.find(node => node.type === 'image').attrs.assetId;
  const source = path.join(data, original.attachments.find(asset => asset.id === firstImageId).relativePath);
  await checkCutDuringImageRead(images.first(), source, page.getByLabel('记录标题'), '等待期间剪切的标题', true);
  await checkCutDuringImageRead(images.first(), source, text, '普通文字依然可以复制', false);
  console.log('图片原件读取延迟时，标题和正文剪切的文字仍可粘贴');
  await checkExternalClipboardDuringImageRead(images.first(), source);
  console.log('独立 Windows 进程更新剪贴板时，旧图片复制取消，外部文字仍可粘贴');
} finally {
  if (instance) {
    try { await restoreClipboard(); }
    finally { await instance.close(); }
  }
}
