import { _electron as electron, chromium } from 'playwright';
import electronPath from 'electron';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { appRoot, testRoot } from './paths.mjs';

const execute = promisify(execFile);
const root = await fs.mkdtemp(path.join(testRoot, 'image-copy-'));
const data = path.join(root, 'data');
const exe = process.env.NOTES_PACKAGED_EXE;
const width = 1200, height = 47;
let instance, page, savedClipboard;

async function start() {
  instance = await electron.launch({ executablePath: exe || electronPath, cwd: appRoot,
    args: exe ? [] : ['.'], env: { ...process.env, NOTES_TEST_MODE: '1', NOTES_DATA_DIR: data } });
  page = await instance.firstWindow();
  await page.getByRole('button', { name: '数据与设置', exact: true }).waitFor();
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

async function checkClipboardImage() {
  for (let i = 0; i < 50; i++) {
    const result = await clipboardInfo();
    if (result.size) { assert.deepEqual(result, { size: [width, height], text: '', html: false }); return; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.fail('系统剪贴板没有图片：' + await page.locator('.toast').allTextContents());
}

async function checkNativePaste() {
  const script = `
    $ErrorActionPreference='Stop'
    Add-Type -AssemblyName System.Windows.Forms
    $bitmap=[Windows.Forms.Clipboard]::GetImage()
    if(!$bitmap){throw 'Native WinForms clipboard has no bitmap'}
    $pixel=$bitmap.GetPixel(15,15)
    @{width=$bitmap.Width;height=$bitmap.Height;red=$pixel.R;blue=$pixel.B}|ConvertTo-Json -Compress
    $bitmap.Dispose()
  `;
  const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command', script], { windowsHide: true });
  assert.deepEqual(JSON.parse(stdout), { width, height, red: 223, blue: 49 });
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
  savedClipboard = await instance.evaluate(async ({ clipboard }) =>
    Promise.all((await clipboard.read()).map(async item => Object.fromEntries(await Promise.all(item.types.map(async type => {
      const value = await item.getType(type);
      return [type, value instanceof Blob ? { blob: Array.from(new Uint8Array(await value.arrayBuffer())), mime: value.type } : { bookmark: value }];
    }))))));
  const pixels = await page.evaluate(({ width, height }) => {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d'); context.fillStyle = '#df1231'; context.fillRect(0, 0, width, height);
    context.fillStyle = '#128f35'; context.fillRect(width - 50, 0, 50, height);
    return ['png', 'jpeg', 'webp'].map(ext => [ext, canvas.toDataURL(`image/${ext}`, 0.95).split(',')[1]]);
  }, { width, height });
  const sources = [];
  for (const [ext, encoded] of pixels) {
    const file = path.join(root, `copy.${ext}`); await fs.writeFile(file, Buffer.from(encoded, 'base64')); sources.push(file);
  }
  await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `
    $ErrorActionPreference='Stop'
    Add-Type -AssemblyName System.Drawing
    $bitmap=[Drawing.Image]::FromFile($env:MEMO_TEST_PNG)
    try {
      $bitmap.Save([IO.Path]::ChangeExtension($env:MEMO_TEST_PNG,'bmp'),[Drawing.Imaging.ImageFormat]::Bmp)
      $bitmap.Save([IO.Path]::ChangeExtension($env:MEMO_TEST_PNG,'gif'),[Drawing.Imaging.ImageFormat]::Gif)
    } finally { $bitmap.Dispose() }
  `], { env: { ...process.env, MEMO_TEST_PNG: sources[0] }, windowsHide: true });
  sources.push(path.join(root, 'copy.bmp'), path.join(root, 'copy.gif'));

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
  }, pixels[0][1]);
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
  await images.first().click({ button: 'right' });
  await checkClipboardImage();
  assert.deepEqual(await instance.evaluate(() => globalThis.__imageMenuLabels), ['复制图片']);
  assert.equal(await page.evaluate(() => window.getSelection().toString()), '普通文字依然可以复制');
  await checkNativePaste();
  await checkExternalAppPaste();
  console.log('右键复制后，Windows WinForms 读到原分辨率位图，独立 Edge 窗口 Ctrl+V 收到图片');

  for (let i = 0; i < 5; i++) {
    await instance.evaluate(({ clipboard }) => clipboard.writeText('等待复制'));
    await images.nth(i).click();
    await images.nth(i).and(page.locator('.ProseMirror-selectednode')).waitFor();
    await page.keyboard.press('Control+c');
    await checkClipboardImage();
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

  await instance.evaluate(({ clipboard }) => {
    globalThis.__imageTestWrite = clipboard.write;
    clipboard.write = async () => { throw new Error('Simulated clipboard failure'); };
  });
  try {
    await images.first().click({ button: 'right' });
    await page.getByRole('alert').filter({ hasText: '无法写入系统剪贴板' }).waitFor();
    assert.equal((await clipboardInfo()).text, '普通文字依然可以复制');
  } finally {
    await instance.evaluate(({ clipboard }) => { clipboard.write = globalThis.__imageTestWrite; });
  }
  const missing = original.attachments.find(asset => asset.name === 'copy.gif');
  await fs.unlink(path.join(data, missing.relativePath));
  await images.last().click({ button: 'right' });
  await page.getByRole('alert').filter({ hasText: '无法读取原图' }).waitFor();
  assert.equal((await clipboardInfo()).text, '普通文字依然可以复制');
  console.log('原图缺失或剪贴板写入失败会给出提示，之前的剪贴板内容仍可用');
} finally {
  if (instance) {
    try {
      if (savedClipboard) await instance.evaluate(async ({ clipboard, ClipboardItem }, items) => {
        if (!items.length) { clipboard.clear(); return; }
        await clipboard.write(items.map(item => new ClipboardItem(Object.fromEntries(Object.entries(item).map(([type, value]) =>
          [type, value.blob ? new Blob([new Uint8Array(value.blob)], { type: value.mime }) : value.bookmark])))));
      }, savedClipboard);
    } finally { await instance.close(); }
  }
}
