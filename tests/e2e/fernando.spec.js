const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function lib(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-fer-'));
  for (const dir of ['Estudos', '.sophy']) fs.mkdirSync(path.join(root, dir), { recursive: true });
  fs.writeFileSync(path.join(root, 'Estudos', 'Leitura.md'), '# Leitura\n\nTexto.\n');
  fs.writeFileSync(path.join(root, 'Estudos', 'Grafo.md'), '# Grafo\n');
  fs.writeFileSync(
    path.join(root, 'Estudos', 'Mapa.canvas'),
    JSON.stringify({ nodes: [{ id: 't', type: 'text', x: 0, y: 0, width: 200, height: 100, text: 'oi' }], edges: [] }),
  );
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(root, 'Estudos', name), body);
  return root;
}

async function open(root, note) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-fer-data-'));
  const env = { ...process.env, NODE_OPTIONS: '--experimental-strip-types' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    args: ['.', `--test-user-data=${userData}`, `--biblioteca=${root}`, '--theme=light'],
    env,
  });
  const page = await app.firstWindow();
  await page.getByRole('button', { name: 'Leitura', exact: true }).click();
  if (note) await page.locator(`#arvore [data-open="Estudos/${note}"]`).click();
  return { app, page };
}

const read = (root, name) => fs.readFileSync(path.join(root, 'Estudos', name), 'utf8');
const settle = (page) => page.waitForTimeout(800);

async function caretAfter(page, selector, needle) {
  await page.locator(selector).first().evaluate((el, word) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const at = node.textContent.indexOf(word);
      if (at < 0) continue;
      el.focus();
      const range = document.createRange();
      range.setStart(node, at + word.length);
      range.collapse(true);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
  }, needle);
}

async function paste(page, selector, text) {
  await page.locator(selector).first().evaluate((el, value) => {
    const selection = getSelection();
    if (!selection?.rangeCount || !el.contains(selection.anchorNode)) el.focus();
    const data = new DataTransfer();
    data.setData('text/plain', value);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
}

test('1 clicar na própria aba não descarta a digitação', async () => {
  const root = lib({ 'A.md': 'Nota A.\n' });
  const { app, page } = await open(root, 'A.md');
  await caretAfter(page, '.bloco--texto', 'Nota A.');
  await page.keyboard.type(' perdido?');
  await page.locator('[data-tab="Estudos/A.md"]').click();
  await settle(page);
  expect(read(root, 'A.md')).toContain('perdido?');
  await expect(page.locator('.bloco--texto').first()).toContainText('perdido?');
  await app.close();
});

test('2 abrir canvas antes do autosave grava a nota', async () => {
  const root = lib({ 'A.md': 'Nota A.\n' });
  const { app, page } = await open(root, 'A.md');
  await caretAfter(page, '.bloco--texto', 'Nota A.');
  await page.keyboard.type(' perdido?');
  await page.locator('#arvore [data-canvas="Estudos/Mapa.canvas"]').click();
  await expect(page.locator('.canvas-area')).toBeVisible();
  await settle(page);
  expect(read(root, 'A.md')).toContain('perdido?');
  await app.close();
});

test('3 Enter, Shift+Enter e colar dentro do código mantêm a cerca', async () => {
  const root = lib({ 'C.md': '# C\n\n```js\nabcdef\n```\n' });
  const { app, page } = await open(root, 'C.md');
  await caretAfter(page, 'pre.bloco--codigo', 'abc');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Z');
  await page.keyboard.press('Shift+Enter');
  await paste(page, 'pre.bloco--codigo', '# não');
  await settle(page);
  const saved = read(root, 'C.md');
  expect(saved).toMatch(/```js\n/);
  expect(saved).toMatch(/abc\nZ/);
  expect(saved).toContain('# não');
  expect(saved).toMatch(/```\n/);
  await app.close();
});

test('4 bloco --- depois do frontmatter sobrevive ao save', async () => {
  const root = lib({ 'F.md': '---\ntags: [teste]\n---\n---\nTexto importante\n---\nFim\n' });
  const { app, page } = await open(root, 'F.md');
  await expect(page.locator('#coluna')).toContainText('Texto importante');
  await caretAfter(page, '.bloco--texto:has-text("Fim")', 'Fim');
  await page.keyboard.type('!');
  await settle(page);
  const saved = read(root, 'F.md');
  expect(saved).toContain('Texto importante');
  expect(saved).toContain('Fim!');
  expect(saved).toContain('tags:');
  await app.close();
});

test('5 editar célula preserva alinhamento e pipe escapado', async () => {
  const root = lib({ 'Tab.md': '# T\n\n| Nome | Valor |\n|:--|--:|\n| a \\| b | z |\n' });
  const { app, page } = await open(root, 'Tab.md');
  await expect(page.locator('td[data-cell="1:0"]')).toContainText('a \\| b');
  await expect(page.locator('td')).toHaveCount(4);
  await caretAfter(page, 'td[data-cell="1:1"]', 'z');
  await page.keyboard.type('!');
  await settle(page);
  const saved = read(root, 'Tab.md');
  expect(saved).toContain('a \\| b');
  expect(saved).toContain(':--');
  expect(saved).toContain('--:');
  expect(saved).toContain('z!');
  expect(saved).not.toContain('| --- | --- | --- |');
  await app.close();
});

test('6 colar numa célula não vai para o cabeçalho', async () => {
  const root = lib({ 'T.md': '| H1 | H2 |\n| --- | --- |\n| a | b |\n' });
  const { app, page } = await open(root, 'T.md');
  await caretAfter(page, 'td[data-cell="1:1"]', 'b');
  await paste(page, 'td[data-cell="1:1"]', 'X');
  await settle(page);
  const saved = read(root, 'T.md');
  expect(saved).toContain('| a | bX |');
  expect(saved).toContain('| H1 | H2 |');
  await app.close();
});

test('7 [[ numa tarefa preserva estado, data e prioridade', async () => {
  const root = lib({ 'K.md': '# K\n\n- [x] Ler 📅 2026-11-20 ⏫\n' });
  const { app, page } = await open(root, 'K.md');
  await caretAfter(page, '.tarefa__texto', 'Ler');
  await page.keyboard.type(' [[Graf');
  await page.locator('[data-insert]').first().click();
  await settle(page);
  const saved = read(root, 'K.md');
  expect(saved).toMatch(/- \[x\] Ler \[\[Estudos\/Grafo\]\]/);
  expect(saved).toContain('2026-11-20');
  expect(saved).toContain('⏫');
  await app.close();
});

test('8 / numa tarefa vira o bloco escolhido sem perder o título', async () => {
  const root = lib({ 'K.md': '- [ ] comprar 📅 2026-11-20 ⏫\n' });
  const { app, page } = await open(root, 'K.md');
  await caretAfter(page, '.tarefa__texto', 'comprar');
  await page.keyboard.type(' /');
  await page.getByRole('option', { name: 'Título 1' }).click();
  await settle(page);
  const saved = read(root, 'K.md');
  expect(saved).toMatch(/# comprar/);
  expect(saved).not.toContain('- [ ]');
  await app.close();
});

test('9 Backspace entre tarefas guarda o metadado', async () => {
  const root = lib({ 'J.md': '- [ ] uma\n- [x] duas 📅 2026-11-20 ⏫\n' });
  const { app, page } = await open(root, 'J.md');
  await page.locator('.tarefa__texto').nth(1).evaluate((el) => {
    el.focus();
    const range = document.createRange();
    range.setStart(el.firstChild, 0);
    range.collapse(true);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await page.keyboard.press('Backspace');
  await settle(page);
  const saved = read(root, 'J.md');
  expect(saved).toMatch(/\[x\] uma duas/);
  expect(saved).toContain('2026-11-20');
  expect(saved).toContain('⏫');
  await app.close();
});

test('10 arrastar um bloco move uma vez', async () => {
  const root = lib({ 'D.md': 'A\n\nB\n\nC\n' });
  const { app, page } = await open(root, 'D.md');
  const from = await page.locator('.bloco--texto', { hasText: /^A$/ }).getAttribute('data-block');
  await page.locator('.bloco--texto', { hasText: /^C$/ }).evaluate((el, source) => {
    const data = new DataTransfer();
    data.setData('application/x-sophy-block', source);
    el.dispatchEvent(new DragEvent('dragover', { dataTransfer: data, bubbles: true, cancelable: true }));
    el.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }));
  }, from);
  await settle(page);
  const saved = read(root, 'D.md');
  expect(saved.indexOf('B')).toBeLessThan(saved.indexOf('C'));
  expect(saved.indexOf('C')).toBeLessThan(saved.indexOf('A'));
  expect(saved.match(/^A$/m)).toBeTruthy();
  expect(saved.match(/A/g)).toHaveLength(1);
  await app.close();
});

test('11 Ctrl+Z depois de excluir não apaga a edição anterior', async () => {
  const root = lib({ 'U.md': 'Original\n\nApagar\n' });
  const { app, page } = await open(root, 'U.md');
  await caretAfter(page, '.bloco--texto', 'Original');
  await page.keyboard.type(' editado');
  await page.waitForTimeout(1200);
  const index = await page.locator('.bloco--texto', { hasText: 'Apagar' }).getAttribute('data-block');
  await page.locator(`[data-menu="${index}"]`).click({ force: true });
  await page.locator('[data-bloco="apagar"]').click();
  await settle(page);
  await page.keyboard.press('Control+z');
  await settle(page);
  const saved = read(root, 'U.md');
  expect(saved).toContain('editado');
  expect(saved).toContain('Apagar');
  await app.close();
});

test('12 colar com seleção substitui o trecho', async () => {
  const root = lib({ 'S.md': 'abcDEFghi\n' });
  const { app, page } = await open(root, 'S.md');
  await page.locator('.bloco--texto').first().evaluate((el) => {
    el.focus();
    const range = document.createRange();
    range.setStart(el.firstChild, 3);
    range.setEnd(el.firstChild, 6);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await paste(page, '.bloco--texto', 'X');
  await settle(page);
  expect(read(root, 'S.md')).toContain('abcXghi');
  expect(read(root, 'S.md')).not.toContain('DEF');
  await app.close();
});

test('13 lista numerada renumera e Tab recua', async () => {
  const root = lib({ 'N.md': '1. um\n2. dois\n' });
  const { app, page } = await open(root, 'N.md');
  await caretAfter(page, '.bloco--item', 'um');
  await page.keyboard.press('Enter');
  await page.keyboard.type('meio');
  await settle(page);
  expect(read(root, 'N.md')).toMatch(/1\. um\n2\. meio\n3\. dois/);
  const before = await page.locator('.bloco--item', { hasText: 'dois' }).evaluate((el) => el.getBoundingClientRect().left);
  await caretAfter(page, '.bloco--item:has-text("dois")', 'dois');
  await page.keyboard.press('Tab');
  await settle(page);
  const after = await page.locator('.bloco--item', { hasText: 'dois' }).evaluate((el) => el.getBoundingClientRect().left);
  expect(after).toBeGreaterThan(before);
  expect(read(root, 'N.md')).toMatch(/ {2}3\. dois/);
  await app.close();
});

test('14 embed pode ser apagado e o Backspace não o atravessa', async () => {
  const root = lib({ 'E.md': '![[Estudos/Grafo]]\n\ntexto\n' });
  const { app, page } = await open(root, 'E.md');
  await expect(page.locator('figure.embed[data-block]')).toBeVisible();
  await page.locator('.bloco--texto', { hasText: 'texto' }).evaluate((el) => {
    el.focus();
    const range = document.createRange();
    range.setStart(el.firstChild, 0);
    range.collapse(true);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await page.keyboard.press('Backspace');
  await settle(page);
  expect(read(root, 'E.md')).toMatch(/!\[\[Estudos\/Grafo\]\]/);
  expect(read(root, 'E.md')).toContain('texto');
  await app.close();
});

test('15 cerca de 4 crases continua um bloco', async () => {
  const root = lib({ 'Cod.md': '# C\n\n````md\n```js\nx\n```\n````\n\ndepois\n' });
  const { app, page } = await open(root, 'Cod.md');
  await expect(page.locator('pre.bloco--codigo')).toHaveCount(1);
  await caretAfter(page, 'pre.bloco--codigo', 'x');
  await page.keyboard.type('y');
  await settle(page);
  const saved = read(root, 'Cod.md');
  expect(saved).toContain('````md');
  expect(saved).toContain('xy');
  expect(saved.match(/````/g).length).toBeGreaterThanOrEqual(2);
  await app.close();
});

test('16 cerca ~~~ é código', async () => {
  const root = lib({ 'Til.md': '# C\n\n~~~js\nconst a = 1;\n~~~\n' });
  const { app, page } = await open(root, 'Til.md');
  await expect(page.locator('pre.bloco--codigo')).toHaveCount(1);
  await expect(page.locator('pre.bloco--codigo')).toContainText('const a = 1;');
  await app.close();
});
