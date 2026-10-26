import {appRoot, testRoot} from './paths.mjs';
import {_electron as electron} from 'playwright';
import electronPath from 'electron';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

process.chdir(appRoot);
const root = path.join(testRoot, 'help-' + Date.now());
const shots = path.join(root, 'screenshots');
await fs.mkdir(shots, {recursive: true});
let instance, page;
const checks = [], errors = [];
const help = () => page.getByRole('dialog', {name: '使用说明', exact: true});
async function open() {
  await page.getByRole('button', {name: '数据与设置', exact: true}).click();
  assert.equal(await page.getByRole('button', {name: '使用说明与数据位置', exact: true}).innerText(), '使用说明');
  await page.getByRole('button', {name: '使用说明与数据位置', exact: true}).click();
  await help().waitFor();
}
async function closed() {
  await help().waitFor({state: 'detached'});
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '数据与设置');
}
async function resize(width, height) {
  await instance.evaluate(({BrowserWindow}, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height), {width, height});
  await page.waitForFunction(size => Math.abs(innerWidth-size.width) <= 2 && Math.abs(innerHeight-size.height) <= 2, {width, height});
}
async function geometry() {
  const result = await help().evaluate(el => {
    const rect = el.getBoundingClientRect();
    const body = el.querySelector('.usage-help-body');
    const visible = selector => {
      const node = el.querySelector(selector), box = node.getBoundingClientRect();
      return box.top >= rect.top && box.bottom <= rect.bottom && el.contains(document.elementFromPoint(box.x+box.width/2, box.y+box.height/2));
    };
    return {inside: rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth,
      noOverflow: body.scrollWidth <= body.clientWidth+1,
      closeVisible: visible('[aria-label="关闭说明"]'), doneVisible: visible('.usage-help-footer button')};
  });
  assert.deepEqual(result, {inside: true, noOverflow: true, closeVisible: true, doneVisible: true});
}
try {
  instance = await electron.launch({executablePath: process.env.NOTES_PACKAGED_EXE || electronPath,
    args: process.env.NOTES_PACKAGED_EXE ? [] : ['.'], env: {...process.env, NOTES_TEST_MODE: '1', NOTES_DATA_DIR: root}});
  page = await instance.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('button', {name: '新建记录', exact: true}).first().waitFor();
  await page.waitForFunction(() => !document.querySelector('[aria-label="数据与设置"]').disabled);
  await resize(1440, 900);
  await open();
  assert.equal(await help().locator('details[open]').count(), 0);
  assert.equal(await help().locator('.usage-help-start li').count(), 3);
  assert.equal(await help().locator('code').isVisible(), false);
  assert.equal(await help().evaluate(el => el.matches(':modal')), true);
  assert.ok(!(await help().innerText()).includes('后续支持'));
  await geometry();
  await page.screenshot({path: path.join(shots, '01-使用说明.png')});
  checks.push('三步入门、默认收起细节、当前内容与正常窗口');

  for (let i = 0; i < 16; i++) {
    await page.keyboard.press('Tab');
    assert.equal(await help().evaluate(el => el.contains(document.activeElement)), true);
  }
  await page.keyboard.press('Control+n');
  await page.keyboard.press('Control+f');
  assert.equal((await page.evaluate(() => window.notes.list({}))).length, 0);
  assert.equal(await page.locator('.home-mode').count(), 1);
  await page.keyboard.press('Escape'); await closed();
  checks.push('原生模态焦点约束、快捷键隔离和Esc焦点恢复');

  await open();
  const summaries = help().locator('summary');
  for (let i = 0; i < 4; i++) {
    await summaries.nth(i).focus(); await page.keyboard.press('Enter');
    assert.equal(await help().locator('details[open]').count(), 1);
    assert.equal(await help().locator('details').nth(i).getAttribute('open'), '');
  }
  assert.ok((await help().locator('details').nth(2).textContent()).includes('公历、农历都可以'));
  checks.push('折叠分组支持键盘且每次仅展开一项、农历说明准确');

  await instance.evaluate(({shell}) => {
    globalThis.helpOriginalOpenPath = shell.openPath;
    globalThis.helpOpenedPaths = [];
    shell.openPath = async target => { globalThis.helpOpenedPaths.push(target); return '测试：无法打开'; };
  });
  await help().getByRole('button', {name: '打开数据文件夹', exact: true}).click();
  await help().getByRole('alert').waitFor();
  assert.match(await help().getByRole('alert').innerText(), /请重试/);
  await instance.evaluate(({shell}) => { shell.openPath = async target => { globalThis.helpOpenedPaths.push(target); return ''; }; });
  await help().getByRole('button', {name: '打开数据文件夹', exact: true}).click();
  await help().getByRole('alert').waitFor({state: 'detached'});
  const paths = await instance.evaluate(() => globalThis.helpOpenedPaths);
  assert.deepEqual(paths, [root, root]);
  await instance.evaluate(({shell}) => { shell.openPath = globalThis.helpOriginalOpenPath; });
  checks.push('系统打开目录实际失败被捕获、保留对话框并可重试');

  await resize(920, 650);
  // A fictional long path exercises wrapping without exposing the host filesystem in screenshots.
  await help().locator('code').evaluate(el => { el.textContent = 'C:\\我的笔记\\' + '换电脑也要带走的个人资料\\'.repeat(8) + '我的数据'; });
  await geometry();
  await help().locator('.usage-help-body').evaluate(el => { el.scrollTop = el.scrollHeight; });
  await geometry();
  await page.screenshot({path: path.join(shots, '02-窄窗口与备份.png')});
  await help().getByRole('button', {name: '知道了', exact: true}).click(); await closed();
  checks.push('920×650、长路径换行、正文滚动而关闭与底部操作保持可见');

  await open();
  await help().locator('summary').nth(1).click();
  await page.screenshot({path: path.join(shots, '03-纯文本提示.png')});
  const box = await help().boundingBox();
  await page.mouse.click(box.x+3, box.y+3);
  assert.equal(await help().isVisible(), true);
  await help().getByRole('button', {name: '关闭说明', exact: true}).click(); await closed();
  await open(); await page.mouse.click(4, 4); await closed();
  checks.push('内部空白不关闭、关闭按钮与遮罩关闭均恢复焦点');

  await page.keyboard.press('Control+n');
  await page.getByLabel('记录标题', {exact: true}).fill('周末随想');
  const editor = page.getByRole('textbox', {name: '记录正文', exact: true});
  await editor.fill('还没写完的一点想法，打开说明以后也要留在这里。');
  await open();
  await page.waitForFunction(async () => (await window.notes.list({}))[0]?.plainText.includes('还没写完的一点想法'));
  await help().getByRole('button', {name: '知道了', exact: true}).click(); await closed();
  assert.match(await editor.innerText(), /打开说明以后也要留在这里/);
  await editor.focus(); await page.keyboard.press('Control+a');
  await page.getByRole('button', {name: '插入网页链接', exact: true}).click();
  await page.getByRole('dialog', {name: '插入网页链接', exact: true}).waitFor();
  await page.getByLabel('网页地址', {exact: true}).fill('https://example.com');
  await page.getByRole('button', {name: '确定', exact: true}).click();
  await page.getByRole('dialog', {name: '插入网页链接', exact: true}).waitFor({state: 'detached'});
  assert.equal(await editor.locator('a[href="https://example.com"]').count(), 1);
  assert.deepEqual(errors, []);
  checks.push('写作中查看说明继续自动保存、关闭后草稿不变、原插入链接弹窗回归');
  const closedEvent = instance.waitForEvent('close');
  await instance.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].close()); await closedEvent; instance = null;
  console.log(JSON.stringify({passed: true, checks, screenshots: shots}, null, 2));
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({path: path.join(shots, 'failure.png')}).catch(() => {});
  throw error;
} finally { if (instance) await instance.close(); }
