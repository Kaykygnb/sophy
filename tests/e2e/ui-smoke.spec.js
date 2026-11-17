const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const artifacts = '/opt/cursor/artifacts';

function library() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-ui-e2e-'));
  fs.mkdirSync(path.join(root, 'Estudos'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Livro'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Entrada'), { recursive: true });
  fs.mkdirSync(path.join(root, '.sophy'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'Estudos', 'Leitura.md'),
    `---
tags:
  - estudo
---
# Leitura espaçada

A memória se liga a [[Estudos/Grafo|o grafo]] e também a um [[ incompleto.

- [ ] abrir o capítulo
- [/] revisar o capítulo 📅 2026-11-20 ⏫
- [x] capítulo lido
- [-] capítulo cancelado
`,
  );
  fs.writeFileSync(
    path.join(root, 'Estudos', 'Grafo.md'),
    '# Grafo\n\nCada nota é um nó. A aresta nasce do wikilink.\n',
  );
  fs.writeFileSync(
    path.join(root, 'Livro', 'Capitulo.md'),
    '# Capítulo\n\nVoltar para [[Estudos/Leitura]].\n',
  );
  fs.writeFileSync(
    path.join(root, 'Estudos', 'Mapa.canvas'),
    JSON.stringify(
      {
        nodes: [
          {
            id: 'g',
            type: 'group',
            x: 40,
            y: 20,
            width: 680,
            height: 400,
            label: 'Estudos',
            color: '1',
          },
          {
            id: 't',
            type: 'text',
            x: 80,
            y: 80,
            width: 280,
            height: 140,
            text: 'A memória liga com [[Estudos/Leitura|a leitura]].',
          },
          {
            id: 'f',
            type: 'file',
            x: 420,
            y: 90,
            width: 250,
            height: 160,
            file: 'Estudos/Leitura.md',
          },
          {
            id: 'l',
            type: 'link',
            x: 80,
            y: 270,
            width: 240,
            height: 70,
            url: 'https://obsidian.md',
            label: 'JSON Canvas',
          },
        ],
        edges: [
          {
            id: 'e',
            fromNode: 't',
            toNode: 'f',
            fromSide: 'right',
            toSide: 'left',
            toEnd: 'arrow',
            label: 'explica',
          },
        ],
      },
      null,
      2,
    ),
  );
  for (const shelf of ['Pesquisa', 'Trabalho', 'Diário', 'Leituras']) {
    fs.mkdirSync(path.join(root, shelf), { recursive: true });
    fs.writeFileSync(
      path.join(root, shelf, 'Nota.md'),
      `# ${shelf}\n\nLiga com [[Estudos/Leitura]].\n`,
    );
  }
  return root;
}

function env() {
  const copy = { ...process.env };
  delete copy.ELECTRON_RUN_AS_NODE;
  copy.NODE_OPTIONS = '--experimental-strip-types';
  return copy;
}

async function launch(args) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-ui-data-'));
  return electron.launch({
    args: ['.', `--test-user-data=${userData}`, ...args],
    env: env(),
  });
}

test('troca de biblioteca, formatação e comandos', async () => {
  test.setTimeout(60000);
  const first = library();
  const second = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-ui-outra-'));
  fs.mkdirSync(path.join(second, '.sophy'));
  fs.writeFileSync(path.join(second, 'Outra.md'), '# Outra biblioteca\n');
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-ui-data-'));
  fs.writeFileSync(
    path.join(userData, 'ui.json'),
    JSON.stringify({
      onboarded: true,
      libraryPath: first,
      libraries: [first, second],
      theme: 'light',
    }),
  );
  const app = await electron.launch({
    args: ['.', `--test-user-data=${userData}`],
    env: env(),
  });
  const page = await app.firstWindow();
  fs.mkdirSync(artifacts, { recursive: true });
  await page.locator('#seletor-biblioteca').click();
  await expect(page.getByRole('menuitem', { name: 'Nova biblioteca…' })).toBeVisible();
  await page.screenshot({ path: path.join(artifacts, 'ui-bibliotecas-claro.png') });
  await page.getByRole('menuitem', { name: path.basename(second) }).click();
  await expect(page.getByRole('button', { name: 'Outra', exact: true })).toBeVisible();
  await page.locator('#seletor-biblioteca').click();
  await page.getByRole('menuitem', { name: path.basename(first) }).click();
  await page.getByRole('button', { name: 'Leitura', exact: true }).click();
  await page.locator('.bloco--texto').first().evaluate((el) => {
    const text = [...el.childNodes].find((node) => node.nodeType === 3 && node.textContent.trim());
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, Math.min(6, text.textContent.length));
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await expect(page.locator('.barra-formato')).toBeVisible();
  await page.screenshot({ path: path.join(artifacts, 'ui-formato-claro.png') });
  await page.locator('.barra-formato button[aria-label="Negrito"]').click();
  await expect
    .poll(() => fs.readFileSync(path.join(first, 'Estudos', 'Leitura.md'), 'utf8'))
    .toContain('**');
  await page.locator('.bloco-linha').first().hover();
  await expect(page.locator('.bloco__mais').first()).toBeVisible();
  await page.keyboard.press('Control+Shift+P');
  await expect(page.getByRole('dialog', { name: 'Comandos' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nova biblioteca' })).toBeVisible();
  await page.screenshot({ path: path.join(artifacts, 'ui-comandos-claro.png') });
  await app.close();

  const marked = fs.readFileSync(path.join(first, 'Estudos', 'Leitura.md'), 'utf8');
  fs.writeFileSync(path.join(first, 'Estudos', 'Leitura.md'), marked.replace(/\*\*([^*]+)\*\*/g, '$1'));
  const darkData = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-ui-data-'));
  fs.writeFileSync(
    path.join(darkData, 'ui.json'),
    JSON.stringify({
      onboarded: true,
      libraryPath: first,
      libraries: [first, second],
      theme: 'dark',
    }),
  );
  const dark = await electron.launch({
    args: ['.', `--test-user-data=${darkData}`],
    env: env(),
  });
  const darkPage = await dark.firstWindow();
  await darkPage.locator('#seletor-biblioteca').click();
  await darkPage.screenshot({ path: path.join(artifacts, 'ui-bibliotecas-escuro.png') });
  await darkPage.keyboard.press('Escape');
  await darkPage.getByRole('button', { name: 'Leitura', exact: true }).click();
  await darkPage.locator('.bloco--texto').first().evaluate((el) => {
    const text = [...el.childNodes].find((node) => node.nodeType === 3 && node.textContent.trim());
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, Math.min(6, text.textContent.length));
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await darkPage.locator('.bloco-linha').first().hover();
  await darkPage.screenshot({ path: path.join(artifacts, 'ui-formato-escuro.png') });
  await darkPage.keyboard.press('Control+Shift+P');
  await darkPage.screenshot({ path: path.join(artifacts, 'ui-comandos-escuro.png') });
  await dark.close();
});

test('Canvas na árvore cria um quadro vazio', async () => {
  test.setTimeout(60000);
  const root = library();
  const app = await launch([`--biblioteca=${root}`, '--theme=light']);
  const page = await app.firstWindow();
  await page.locator('#arvore [data-shelf="Estudos"]').click();
  await page.locator('#novo').click();
  await page.getByRole('menuitem', { name: 'Novo canvas' }).click();
  await expect(page.locator('.canvas-area')).toBeVisible();
  expect(fs.existsSync(path.join(root, 'Estudos', 'Sem título.canvas'))).toBe(true);
  await page.keyboard.press('Control+Shift+P');
  await expect(page.getByRole('button', { name: 'Novo canvas' })).toBeVisible();
  await app.close();
});

test('Enter cria bloco, Ctrl+B formata e a árvore marca um item', async () => {
  test.setTimeout(60000);
  const root = library();
  const app = await launch([`--biblioteca=${root}`, '--theme=light']);
  const page = await app.firstWindow();
  await page.getByRole('button', { name: 'Leitura', exact: true }).click();
  const note = page.locator('#arvore [data-open="Estudos/Leitura.md"]');
  const shelf = page.locator('#arvore [data-shelf="Estudos"]');
  await expect(note).toHaveAttribute('aria-selected', 'true');
  await expect(shelf).toHaveAttribute('aria-selected', 'false');
  await shelf.click();
  await expect(shelf).toHaveAttribute('aria-selected', 'true');
  await expect(note).toHaveAttribute('aria-selected', 'false');
  await note.click();
  const paragraph = page.locator('.bloco--texto').first();
  await paragraph.click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Segunda linha');
  const file = path.join(root, 'Estudos', 'Leitura.md');
  await expect.poll(() => fs.readFileSync(file, 'utf8')).toContain('Segunda linha');
  const saved = fs.readFileSync(file, 'utf8');
  expect(saved).not.toContain('incompleto.Segunda');
  expect(saved).toMatch(/incompleto\.\r?\n\r?\nSegunda linha/);
  await paragraph.click();
  await paragraph.evaluate((el) => {
    const text = [...el.childNodes].find((node) => node.nodeType === 3 && node.textContent.includes('memó'));
    const start = text.textContent.indexOf('memó');
    const range = document.createRange();
    range.setStart(text, start);
    range.setEnd(text, start + 6);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await paragraph.press('Control+B');
  await expect.poll(() => fs.readFileSync(file, 'utf8')).toContain('**');
  fs.appendFileSync(file, '\n**negrito** e *itálico*\n');
  await page.getByRole('button', { name: 'Leitura', exact: true }).click();
  await expect(page.locator('.bloco--texto strong')).toHaveText('negrito');
  await page.screenshot({ path: path.join(artifacts, 'ui-formatado-claro.png') });
  await expect(page.locator('.bloco--texto em')).toHaveText('itálico');
  await app.close();
});

test('tarefas e calendário listam a biblioteca', async () => {
  test.setTimeout(60000);
  const root = library();
  const app = await launch([`--biblioteca=${root}`, '--theme=light']);
  const page = await app.firstWindow();
  fs.mkdirSync(artifacts, { recursive: true });
  await page.locator('[data-nav="tarefas"]').click();
  await expect(page.getByRole('heading', { name: 'Tarefas' })).toBeVisible();
  await expect(page.locator('.kcard', { hasText: 'abrir o capítulo' })).toBeVisible();
  await page.getByRole('button', { name: 'Quadro' }).click();
  await page
    .locator('.kcard', { hasText: 'abrir o capítulo' })
    .dragTo(page.locator('.quadro__coluna[data-status="feita"]'));
  const file = path.join(root, 'Estudos', 'Leitura.md');
  await expect.poll(() => fs.readFileSync(file, 'utf8')).toMatch(/\[x\] abrir o capítulo/);
  await page.screenshot({ path: path.join(artifacts, 'ui-tarefas-claro.png') });
  await page.locator('[data-nav="calendario"]').click();
  await expect(page.getByRole('heading', { name: /novembro de 2026/i })).toBeVisible();
  await expect(page.locator('.cal-semana')).toContainText('seg');
  await expect(page.locator('.cal-dia.is-hoje')).toBeVisible();
  await page.screenshot({ path: path.join(artifacts, 'ui-calendario-claro.png') });
  await app.close();
  const dark = await launch([`--biblioteca=${root}`, '--theme=dark']);
  const darkPage = await dark.firstWindow();
  await darkPage.locator('[data-nav="tarefas"]').click();
  await darkPage.screenshot({ path: path.join(artifacts, 'ui-tarefas-escuro.png') });
  await darkPage.locator('[data-nav="calendario"]').click();
  await darkPage.screenshot({ path: path.join(artifacts, 'ui-calendario-escuro.png') });
  await dark.close();
});

test('Canvas da navegação lista sem criar e a busca não duplica', async () => {
  test.setTimeout(60000);
  const root = library();
  const folder = path.join(root, 'Estudos');
  const before = fs.readdirSync(folder).filter((name) => name.endsWith('.canvas'));
  const app = await launch([`--biblioteca=${root}`, '--theme=light']);
  const page = await app.firstWindow();
  await page.locator('[data-nav="canvas"]').click();
  await expect(page.locator('[data-nav="canvas"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.nav__item').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Canvas' })).toBeVisible();
  expect(fs.readdirSync(folder).filter((name) => name.endsWith('.canvas'))).toEqual(before);
  await page.keyboard.press('Control+k');
  await page.locator('#paleta-q').fill('Mapa');
  await expect(page.locator('.menu__grupo', { hasText: 'Canvas' })).toBeVisible();
  await expect(page.locator('#paleta-lista .menu__item', { hasText: 'Mapa' })).toHaveCount(1);
  await app.close();
});

test('rodada 2: gaveta, quadro, semana, cartão e canvas', async () => {
  test.setTimeout(90000);
  const root = library();
  const app = await launch([`--biblioteca=${root}`, '--theme=light']);
  const page = await app.firstWindow();
  fs.mkdirSync(artifacts, { recursive: true });
  await page.getByRole('button', { name: 'Leitura', exact: true }).click();
  const windowHandle = await app.browserWindow(page);
  await windowHandle.evaluate((win) => win.setSize(800, 600));
  await expect.poll(() => page.locator('#lateral').evaluate((el) => getComputedStyle(el).transform)).not.toBe('none');
  await expect(page.locator('#lateral')).not.toHaveClass(/is-aberta/);
  await page.locator('#abrir-lateral').click();
  await expect(page.locator('#lateral')).toHaveClass(/is-aberta/);
  await page.screenshot({ path: path.join(artifacts, 'ui-gaveta-800.png') });
  await page.locator('#recolher').click();
  await expect(page.locator('#lateral')).not.toHaveClass(/is-aberta/);
  await expect(page.locator('#lateral')).not.toHaveClass(/is-fechada/);
  await page.locator('#abrir-lateral').click();
  await page.keyboard.press('Control+\\');
  await expect(page.locator('#lateral')).not.toHaveClass(/is-aberta/);
  const pad = await page.locator('.centro').evaluate((el) => Number.parseFloat(getComputedStyle(el).paddingBottom));
  expect(pad).toBeGreaterThan(0);
  const gap = await page.evaluate(() => {
    const tabs = document.querySelector('.titulo__abas').getBoundingClientRect();
    const minimize = document.querySelector('[data-window="minimize"]').getBoundingClientRect();
    return minimize.left - tabs.right;
  });
  expect(gap).toBeGreaterThanOrEqual(0);
  await windowHandle.evaluate((win) => win.setSize(1440, 900));
  await page.locator('[data-nav="tarefas"]').click();
  const card = page.locator('.kcard', { hasText: 'revisar o capítulo' });
  await expect(card).toBeVisible();
  const chips = await card.locator('.kcard__meta .chip').allTextContents();
  expect(chips.map((chip) => chip.trim())).toEqual(['Alta', '20 nov', 'Estudos']);
  await expect(card.locator('.tarefa__origem')).toHaveCount(0);
  await expect(card.locator('.chip', { hasText: 'Status' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Quadro' }).click();
  const board = page.locator('.quadro');
  await expect(board).toBeVisible();
  const grid = await board.evaluate((el) => {
    const style = getComputedStyle(el);
    return { display: style.display, columns: style.gridTemplateColumns, overflowX: style.overflowX };
  });
  expect(grid.display).toBe('grid');
  expect(grid.overflowX).toBe('auto');
  expect(grid.columns.split(' ').length).toBe(3);
  await page.screenshot({ path: path.join(artifacts, 'ui-tarefas-quadro-claro.png') });

  await page.locator('[data-nav="calendario"]').click();
  await page.getByRole('button', { name: 'Próximo mês' }).click();
  await page.getByRole('button', { name: 'Semana' }).click();
  await expect(page.locator('.cal-dia.is-hoje')).toBeVisible();
  await expect(page.locator('.cal-dia strong')).toHaveText(['16', '17', '18', '19', '20', '21', '22']);
  await page.getByRole('button', { name: 'Próxima semana' }).click();
  await expect(page.locator('.cal-dia strong')).toHaveText(['23', '24', '25', '26', '27', '28', '29']);
  await expect(page.locator('.cal-dia.is-hoje')).toHaveCount(0);
  await page.screenshot({ path: path.join(artifacts, 'ui-calendario-semana-claro.png') });

  const before = fs.readdirSync(path.join(root, 'Estudos')).filter((name) => name.endsWith('.canvas'));
  await page.locator('[data-nav="canvas"]').click();
  await expect(page.locator('.canvas-cartao', { hasText: 'Mapa' })).toBeVisible();
  await expect(page.locator('.canvas-cartao', { hasText: 'Estudos' })).toBeVisible();
  await expect(page.locator('.canvas-cartao__previa')).toContainText('leitura');
  await expect(page.locator('.menu__item', { hasText: 'Estudos/Mapa.canvas' })).toHaveCount(0);
  await page.screenshot({ path: path.join(artifacts, 'ui-canvas-grade-claro.png') });
  expect(fs.readdirSync(path.join(root, 'Estudos')).filter((name) => name.endsWith('.canvas'))).toEqual(before);
  await page.keyboard.press('Control+Shift+P');
  await page.locator('#comando-q').fill('Novo canvas');
  await page.locator('#comando-lista .menu__item', { hasText: 'Novo canvas' }).click();
  await expect.poll(() => fs.readdirSync(path.join(root, 'Estudos')).filter((name) => name.endsWith('.canvas')).length).toBe(before.length + 1);
  await app.close();
});

test('gaveta abaixo de 1024 px com véu, Esc e deslize', async () => {
  test.setTimeout(90000);
  const root = library();
  const app = await launch([`--biblioteca=${root}`, '--theme=light']);
  const page = await app.firstWindow();
  fs.mkdirSync(artifacts, { recursive: true });
  const windowHandle = await app.browserWindow(page);
  await windowHandle.evaluate((win) => win.setContentSize(1000, 700));
  await expect.poll(() => page.locator('#lateral').evaluate((el) => getComputedStyle(el).transform)).not.toBe('none');
  const motion = await page.locator('#lateral').evaluate((el) => {
    const style = getComputedStyle(el);
    return { duration: style.transitionDuration, timing: style.transitionTimingFunction };
  });
  expect(motion.duration).toBe('0.2s');
  expect(motion.timing === 'ease-out' || motion.timing.includes('cubic-bezier')).toBe(true);
  await page.locator('#abrir-lateral').click();
  await expect(page.locator('#lateral')).toHaveClass(/is-aberta/);
  await expect(page.locator('#gaveta-veu')).toBeVisible();
  const veilMatches = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.background = 'var(--overlay)';
    document.body.append(probe);
    const expected = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return getComputedStyle(document.querySelector('#gaveta-veu')).backgroundColor === expected;
  });
  expect(veilMatches).toBe(true);
  await page.screenshot({ path: path.join(artifacts, 'ui-gaveta-1000-claro.png') });
  const box = await page.locator('#gaveta-veu').boundingBox();
  await page.mouse.click(box.x + box.width - 24, box.y + 80);
  await expect(page.locator('#lateral')).not.toHaveClass(/is-aberta/);
  await expect(page.locator('#gaveta-veu')).toBeHidden();
  await expect(page.locator('#abrir-lateral')).toBeFocused();
  await page.locator('#abrir-lateral').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#lateral')).not.toHaveClass(/is-aberta/);
  await expect(page.locator('#abrir-lateral')).toBeFocused();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => page.locator('#lateral').evaluate((el) => getComputedStyle(el).transitionDuration)).toBe('0s');
  await windowHandle.evaluate((win) => win.setContentSize(800, 600));
  await page.locator('#abrir-lateral').click();
  await page.screenshot({ path: path.join(artifacts, 'ui-gaveta-800-claro.png') });
  await app.close();

  const dark = await launch([`--biblioteca=${root}`, '--theme=dark']);
  const darkPage = await dark.firstWindow();
  const darkWindow = await dark.browserWindow(darkPage);
  await darkWindow.evaluate((win) => win.setContentSize(1000, 700));
  await darkPage.locator('#abrir-lateral').click();
  await expect(darkPage.locator('#gaveta-veu')).toBeVisible();
  const darkVeilMatches = await darkPage.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.background = 'var(--overlay)';
    document.body.append(probe);
    const expected = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return getComputedStyle(document.querySelector('#gaveta-veu')).backgroundColor === expected;
  });
  expect(darkVeilMatches).toBe(true);
  await darkPage.screenshot({ path: path.join(artifacts, 'ui-gaveta-1000-escuro.png') });
  await darkWindow.evaluate((win) => win.setContentSize(800, 600));
  await darkPage.screenshot({ path: path.join(artifacts, 'ui-gaveta-800-escuro.png') });
  await dark.close();
});

test('Configurações e Início', async () => {
  test.setTimeout(60000);
  const root = library();
  const app = await launch([`--biblioteca=${root}`, '--theme=light']);
  const page = await app.firstWindow();
  fs.mkdirSync(artifacts, { recursive: true });
  await page.locator('[data-nav="inicio"]').click();
  await expect(page.getByRole('heading', { name: 'Início' })).toBeVisible();
  await expect(page.locator('.cartao-estante', { hasText: 'Estudos' })).toBeVisible();
  await page.screenshot({ path: path.join(artifacts, 'ui-inicio-claro.png') });
  await page.keyboard.press('Control+Comma');
  await expect(page.getByRole('heading', { name: 'Configurações' })).toBeVisible();
  await page.getByRole('button', { name: 'Azul' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'azul');
  await page.screenshot({ path: path.join(artifacts, 'ui-config-claro.png') });
  await app.close();
  const dark = await launch([`--biblioteca=${root}`, '--theme=dark']);
  const darkPage = await dark.firstWindow();
  await darkPage.locator('[data-nav="inicio"]').click();
  await darkPage.screenshot({ path: path.join(artifacts, 'ui-inicio-escuro.png') });
  await darkPage.keyboard.press('Control+Comma');
  await darkPage.screenshot({ path: path.join(artifacts, 'ui-config-escuro.png') });
  await dark.close();
});

test('nota do dia, captura, leitura e grafo no tempo', async () => {
  test.setTimeout(60000);
  const root = library();
  fs.mkdirSync(path.join(root, 'Modelos'));
  fs.writeFileSync(path.join(root, 'Modelos', 'Reuniao.md'), '# {{titulo}}\n\n{{data}} {{hora}}\n{{cursor}}\n', 'utf8');
  const app = await launch([`--biblioteca=${root}`, '--theme=light']);
  const page = await app.firstWindow();
  fs.mkdirSync(artifacts, { recursive: true });
  await expect(page.getByRole('button', { name: 'Hoje' })).toBeVisible();
  await page.evaluate(() =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', altKey: true, bubbles: true })),
  );
  await expect(page.locator('.semana-diaria')).toBeVisible();
  await page.screenshot({ path: path.join(artifacts, 'ui-diario-claro.png') });
  await page.evaluate(() =>
    document.dispatchEvent(
      new KeyboardEvent('keydown', { code: 'Space', key: ' ', ctrlKey: true, shiftKey: true, bubbles: true }),
    ),
  );
  await page.locator('#captura').fill('Ideia solta');
  await page.locator('#captura').press('Enter');
  await expect.poll(() => fs.readdirSync(path.join(root, 'Entrada')).some((name) => name.includes('Ideia solta'))).toBe(true);
  await page.locator('#modo-leitura').click();
  await expect(page.locator('#coluna')).toHaveClass(/is-leitura/);
  await page.locator('#modo-foco').click();
  await expect(page.locator('#shell')).toHaveClass(/is-foco/);
  await page.screenshot({ path: path.join(artifacts, 'ui-foco-claro.png') });
  await page.locator('#modo-foco').click();
  await page.locator('[data-nav="grafo"]').click();
  await expect(page.locator('#grafo-tempo')).toBeVisible();
  await expect(page.locator('#grafo-quadros')).toBeVisible();
  await page.screenshot({ path: path.join(artifacts, 'ui-grafo-tempo-claro.png') });
  await page.locator('#novo').click();
  await page.getByRole('menuitem', { name: 'A partir de modelo' }).click();
  await page.getByRole('dialog', { name: 'Modelos' }).getByRole('button', { name: 'Reuniao' }).click();
  await expect.poll(() => {
    const file = fs.readdirSync(path.join(root, 'Entrada')).find((name) => name.includes('Sem título'));
    return file ? fs.readFileSync(path.join(root, 'Entrada', file), 'utf8') : '';
  }).not.toContain('{{');
  await app.close();
});

test('flashcards e a busca por significado desligada', async () => {
  test.setTimeout(60000);
  const root = library();
  fs.appendFileSync(path.join(root, 'Estudos', 'Leitura.md'), '\ncapital :: Brasília\n');
  const app = await launch([`--biblioteca=${root}`, '--theme=light']);
  const page = await app.firstWindow();
  fs.mkdirSync(artifacts, { recursive: true });
  await expect(page.getByRole('button', { name: 'Hoje' })).toBeVisible();
  await page.evaluate(() =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: ',', ctrlKey: true, bubbles: true })),
  );
  await expect(page.getByRole('heading', { name: 'Busca por significado' })).toBeVisible();
  await expect(page.locator('#cfg-busca')).not.toBeChecked();
  await expect(page.locator('#cfg-sistema')).not.toBeChecked();
  await expect(page.getByText('Desligada', { exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(artifacts, 'ui-config-busca-claro.png') });
  await page.keyboard.press('Control+Shift+P');
  await page.locator('#comando-q').fill('Flashcards');
  await page.locator('#comando-lista .menu__item', { hasText: 'Flashcards' }).click();
  await expect(page.locator('.fc-face__p')).toHaveText('capital');
  await expect(page.locator('.fc-revisao')).toBeVisible();
  await page.screenshot({ path: path.join(artifacts, 'ui-flashcards-claro.png') });
  await app.close();
});

test('a Sofi abre e a chave não entra na biblioteca', async () => {
  test.setTimeout(60000);
  const root = library();
  const app = await launch([`--biblioteca=${root}`, '--theme=light']);
  const page = await app.firstWindow();
  fs.mkdirSync(artifacts, { recursive: true });
  await expect(page.getByRole('button', { name: 'Hoje' })).toBeVisible();
  await page.evaluate(() =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', ctrlKey: true, bubbles: true })),
  );
  await expect(page.getByRole('dialog', { name: 'Sofi' })).toBeVisible();
  await page.locator('#agente-chave').fill('segredo-da-sofi-teste');
  await page.screenshot({ path: path.join(artifacts, 'ui-sofi-claro.png') });
  const leaked = walk(root).includes('segredo-da-sofi-teste');
  expect(leaked).toBe(false);
  await app.close();
  const dark = await launch([`--biblioteca=${root}`, '--theme=dark']);
  const darkPage = await dark.firstWindow();
  await expect(darkPage.getByRole('button', { name: 'Hoje' })).toBeVisible();
  await darkPage.evaluate(() =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', ctrlKey: true, bubbles: true })),
  );
  await expect(darkPage.getByRole('dialog', { name: 'Sofi' })).toBeVisible();
  await darkPage.locator('#agente-chave').click();
  await darkPage.screenshot({ path: path.join(artifacts, 'ui-sofi-escuro.png') });
  await dark.close();
});

function walk(directory) {
  let text = '';
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) text += walk(full);
    else text += fs.readFileSync(full);
  }
  return text;
}

test('acabamento da rodada 3', async () => {
  test.setTimeout(90000);
  const root = library();
  fs.writeFileSync(
    path.join(root, 'Estudos', 'Capa.md'),
    '---\ncapa: sophy:ondas\ncapa_y: 40%\n---\n# Capa\n\n',
    'utf8',
  );
  fs.writeFileSync(path.join(root, 'Estudos', 'Velha.md'), '---\nilustracao: 0\n---\n# Velha\n\n', 'utf8');
  const app = await launch([`--biblioteca=${root}`, '--theme=light']);
  const page = await app.firstWindow();
  fs.mkdirSync(artifacts, { recursive: true });
  await expect(page.getByRole('heading', { name: 'Início' })).toBeVisible();
  await expect(page.locator('.cartao-estante', { hasText: 'Estudos' })).toBeVisible();
  await page.evaluate(() =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true, bubbles: true })),
  );
  await page.locator('#comando-q').fill('Configurações');
  await page.locator('#comando-lista .menu__item', { hasText: 'Configurações' }).click();
  await page.locator('input[name="cfg-fonte"][value="literata"]').check();
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--font-reading')))
    .toContain('Literata');
  await page.locator('#arvore').getByRole('button', { name: 'Capa', exact: true }).click();
  await expect(page.locator('.coluna > .capa .capa__arte use')).toHaveAttribute('href', '#capa-ondas');
  await expect(page.locator('.coluna > .capa')).toHaveAttribute('style', /--capa-y:0\.4/);
  await page.screenshot({ path: path.join(artifacts, 'ui-capa-1440-claro.png') });
  await page.locator('#arvore').getByRole('button', { name: 'Velha', exact: true }).click();
  await expect(page.locator('.coluna > .capa .capa__arte use')).toHaveAttribute('href', '#capa-rede');
  await page.locator('[data-nav="tarefas"]').click();
  await page.getByRole('button', { name: 'Quadro' }).click();
  await expect(page.getByRole('button', { name: 'Status', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Estante', exact: true })).toHaveCount(0);
  await expect(page.locator('#conexoes')).toHaveClass(/is-oculta/);
  await page.locator('[data-nav="calendario"]').click();
  await page.getByRole('button', { name: 'Agenda' }).click();
  await expect(page.locator('.agenda')).toBeVisible();
  await page.evaluate(() =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true, bubbles: true })),
  );
  await page.locator('#comando-q').fill('Histórico');
  await page.locator('#comando-lista .menu__item', { hasText: 'Histórico de versões' }).click();
  await expect(page.locator('.versoes-lista')).toBeVisible();
  await page.screenshot({ path: path.join(artifacts, 'ui-versoes-1440-claro.png') });
  await page.evaluate(() =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: ',', ctrlKey: true, bubbles: true })),
  );
  await page.locator('#cfg-pdf').click();
  await expect(page.locator('.pdf-pagina')).toBeVisible();
  await page.screenshot({ path: path.join(artifacts, 'ui-exportar-1440-claro.png') });
  await page.keyboard.press('Escape');
  const windowHandle = await app.browserWindow(page);
  await windowHandle.evaluate((win) => win.setSize(800, 600));
  await page.locator('#abrir-lateral').click();
  const pad = await page.locator('#lateral').evaluate((el) => Number.parseFloat(getComputedStyle(el).paddingBottom));
  expect(pad).toBeGreaterThan(28);
  await page.screenshot({ path: path.join(artifacts, 'ui-gaveta-800-claro.png') });
  await app.close();

  const dark = await launch([`--biblioteca=${root}`, '--theme=dark']);
  const darkPage = await dark.firstWindow();
  await expect(darkPage.getByRole('heading', { name: 'Início' })).toBeVisible();
  await darkPage.locator('.cartao-estante', { hasText: 'Estudos' }).click();
  await darkPage.locator('[data-nav="inicio"]').click();
  await darkPage.screenshot({ path: path.join(artifacts, 'ui-inicio-1440-escuro.png') });
  await darkPage.locator('#arvore').getByRole('button', { name: 'Capa', exact: true }).click();
  await darkPage.screenshot({ path: path.join(artifacts, 'ui-capa-1440-escuro.png') });
  const darkWindow = await dark.browserWindow(darkPage);
  await darkWindow.evaluate((win) => win.setSize(800, 600));
  await darkPage.locator('#abrir-lateral').click();
  await darkPage.screenshot({ path: path.join(artifacts, 'ui-gaveta-800-escuro.png') });
  await dark.close();
});

test('Nota e Estante criam arquivos sem diálogo nativo', async () => {
  test.setTimeout(60000);
  const root = library();
  const app = await launch([`--biblioteca=${root}`, '--theme=light']);
  const page = await app.firstWindow();
  await page.locator('#novo').click();
  await page.getByRole('menuitem', { name: 'Nova nota' }).click();
  await expect(page.locator('.bloco--titulo')).toHaveText('Sem título');
  expect(fs.existsSync(path.join(root, 'Entrada', 'Sem título.md'))).toBe(true);
  await page.locator('#novo').click();
  await page.getByRole('menuitem', { name: 'Nova estante' }).click();
  const name = page.locator('#nome-estante');
  await name.fill('Viagem');
  await name.press('Enter');
  await expect(page.locator('[data-shelf="Viagem"]')).toBeVisible();
  expect(fs.existsSync(path.join(root, 'Viagem'))).toBe(true);
  expect(fs.statSync(path.join(root, 'Viagem')).isDirectory()).toBe(true);
  await app.close();
});

test('a janela abre a biblioteca e mostra a nota', async () => {
  test.setTimeout(90000);
  fs.mkdirSync(artifacts, { recursive: true });
  const root = library();
  const app = await launch([`--biblioteca=${root}`, '--theme=light']);
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await expect(page.locator('.titulo')).toBeVisible();
  await page.getByRole('button', { name: 'Leitura', exact: true }).click();
  await expect(page.locator('.coluna')).toContainText('memória se liga');
  await expect(page.locator('.wikilink')).toContainText('o grafo');
  await expect(page.locator('.nota__meta')).toContainText('#estudo');
  await expect(page.locator('body')).toContainText('2026-11-20');
  const fontsReady = await page.evaluate(async () => {
    await document.fonts.ready;
    return (
      document.fonts.check('600 32px Fraunces') &&
      document.fonts.check('400 16px Inter') &&
      document.fonts.check('400 14px "JetBrains Mono"')
    );
  });
  expect(fontsReady).toBe(true);
  await expect(page.locator('.arvore__linha[style*="--nivel:2"]').first()).toBeVisible();
  await expect(page.locator('.check[data-status="feita"]')).toBeVisible();
  await expect(page.locator('.check[data-status="andamento"]')).toBeVisible();
  await expect(page.locator('.check[data-status="cancelada"]')).toBeVisible();
  await expect(page.locator('.onboarding')).toHaveCount(0);
  await page.keyboard.press('Control+k');
  await page.locator('#paleta-q').fill('memória');
  await expect(page.locator('.menu__grupo').first()).toContainText('Notas');
  await page.screenshot({ path: path.join(artifacts, 'ui-busca-claro.png') });
  await page.keyboard.press('Escape');
  await page.screenshot({ path: path.join(artifacts, 'ui-editor-claro.png') });
  await page.getByRole('button', { name: 'Mostrar grafo' }).click();
  await expect(page.locator('#grafo-canvas')).toBeVisible();
  await expect(page.locator('.grafo__legenda')).toContainText('Estudos');
  await expect(page.locator('#conexoes')).toContainText('Leitura');
  await expect(page.locator('#conexoes')).not.toContainText('Abra uma nota');
  await page.screenshot({ path: path.join(artifacts, 'ui-grafo-claro.png') });
  await page.locator('#arvore').getByRole('button', { name: 'Mapa', exact: true }).click();
  await expect(page.locator('.cv-cartao').first()).toBeVisible();
  await expect(page.locator('.cv-grupo')).toContainText('Estudos');
  const card = page.locator('.cv-cartao').filter({ has: page.locator('.check') });
  await expect(card.locator('.check[data-status="aberta"]')).toBeVisible();
  await expect(card.locator('.wikilink', { hasText: 'o grafo' })).toBeVisible();
  await expect(card).toContainText('2026-11-20');
  await expect(card).toContainText('Alta');
  await expect(card).not.toContainText('- [ ]');
  await expect(card).not.toContainText('📅');
  await expect(card).not.toContainText('⏫');
  await page.locator('#novo').click();
  await expect(page.getByRole('menuitem', { name: 'Nova estante' })).toBeVisible();
  await page.screenshot({ path: path.join(artifacts, 'ui-canvas-novo-claro.png') });
  expect(errors).toEqual([]);
  await app.close();
});

test('boas-vindas no claro e no escuro, editor escuro', async () => {
  test.setTimeout(120000);
  const welcome = await launch([]);
  const page = await welcome.firstWindow();
  await expect(page.getByRole('heading', { name: 'Olá, eu sou a Sofi.' })).toBeVisible();
  await expect(page.locator('body')).toContainText('Só funciona se você conectar uma chave.');
  await expect(page.locator('body')).not.toContainText('etapa seguinte');
  await expect(page.getByRole('button', { name: 'Voltar' })).toHaveCount(0);
  await expect(page.locator('[data-window="close"]')).toBeVisible();
  await page.screenshot({ path: path.join(artifacts, 'ui-boas-vindas-claro.png') });
  await welcome.close();

  const root = library();
  const dark = await launch([`--biblioteca=${root}`, '--theme=dark']);
  const darkPage = await dark.firstWindow();
  await darkPage.getByRole('button', { name: 'Leitura', exact: true }).click();
  await expect(darkPage.locator('.coluna')).toContainText('memória se liga');
  await expect(darkPage.locator('.check[data-status="feita"]')).toBeVisible();
  await darkPage.screenshot({ path: path.join(artifacts, 'ui-editor-escuro.png') });
  await darkPage.keyboard.press('Control+k');
  await darkPage.locator('#paleta-q').fill('memória');
  await expect(darkPage.locator('.menu__grupo').first()).toContainText('Notas');
  await darkPage.screenshot({ path: path.join(artifacts, 'ui-busca-escuro.png') });
  await darkPage.keyboard.press('Escape');
  await darkPage.getByRole('button', { name: 'Mostrar grafo' }).click();
  await expect(darkPage.locator('#grafo-canvas')).toBeVisible();
  await expect(darkPage.locator('#conexoes')).toContainText('Leitura');
  await darkPage.screenshot({ path: path.join(artifacts, 'ui-grafo-escuro.png') });
  await darkPage.locator('#arvore').getByRole('button', { name: 'Mapa', exact: true }).click();
  await expect(darkPage.locator('.cv-cartao').first()).toBeVisible();
  await darkPage.locator('.cv-cartao').first().click();
  await darkPage.screenshot({ path: path.join(artifacts, 'ui-canvas-novo-escuro.png') });
  await dark.close();

  const welcomeDark = await launch(['--theme=dark']);
  const welcomeDarkPage = await welcomeDark.firstWindow();
  await expect(welcomeDarkPage.getByRole('heading', { name: 'Olá, eu sou a Sofi.' })).toBeVisible();
  await welcomeDarkPage.screenshot({ path: path.join(artifacts, 'ui-boas-vindas-escuro.png') });
  await welcomeDark.close();
});
