const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const artifacts = process.env.SOPHY_ARTIFACTS || path.join(os.tmpdir(), 'sophy-ui-artifacts');
fs.mkdirSync(artifacts, { recursive: true });

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
  await expect(shelf).toHaveAttribute('aria-expanded', 'true');
  await shelf.locator('.arvore__seta').click();
  await expect(shelf).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#arvore [data-open="Estudos/Leitura.md"]')).toHaveCount(0);
  await shelf.locator('.arvore__seta').click();
  await expect(shelf).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#arvore [data-open="Estudos/Leitura.md"]')).toBeVisible();
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
  await expect(page.locator('.bloco--texto').first().locator('strong')).toBeVisible();
  await expect(page.locator('.bloco--texto').first()).not.toContainText('**');
  fs.appendFileSync(file, '\n**negrito** e *itálico*\n');
  await page.getByRole('button', { name: 'Leitura', exact: true }).click();
  await expect(page.locator('.bloco--texto strong', { hasText: 'negrito' })).toHaveText('negrito');
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
  await expect(page.locator('.cal-semana')).toContainText('S');
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
  await expect(card.locator('.tarefa-prio--alta')).toBeVisible();
  await expect(card.locator('.kcard__meta .chip')).toContainText(/atrasada|nov/i);
  await expect(card.locator('.chip__ponto')).toBeVisible();
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
  await expect(page.locator('.canvas-cartao--com-cor', { hasText: 'Mapa' })).toBeVisible();
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
  await expect(page.locator('#modo-leitura')).toHaveCount(0);
  await expect(page.locator('#coluna [contenteditable="true"]').first()).toBeVisible();
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
  await page.locator('[data-nav="config"]').click();
  await page.locator('#cfg-agente-chave').fill('segredo-da-sofi-teste');
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
  await darkPage.locator('[data-nav="config"]').click();
  await darkPage.locator('#cfg-agente-chave').click();
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
  await page.locator('.cal-dia.is-hoje').click();
  await expect(page.locator('.painel-dia')).toBeVisible();
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

test('rodada 4: capa da estante, semana, prévia e restaurar', async () => {
  test.setTimeout(90000);
  const root = library();
  fs.writeFileSync(
    path.join(root, 'Estudos', 'Cor.md'),
    '---\ncapa: cor:estante\n---\n# Cor\n\nA faixa usa a cor da estante.\n',
    'utf8',
  );
  const app = await launch([`--biblioteca=${root}`, '--theme=light']);
  const page = await app.firstWindow();
  fs.mkdirSync(artifacts, { recursive: true });
  await page.locator('#arvore').getByRole('button', { name: 'Cor', exact: true }).click();
  const paint = await page.locator('.capa--cor').getAttribute('style');
  expect(paint).toContain('--shelf-');
  expect(paint).not.toContain('var(--estante-cor');
  await expect(page.locator('.coluna .capa-galeria')).toHaveCount(0);
  await page.getByRole('button', { name: 'Trocar capa' }).click();
  await expect(page.getByRole('dialog', { name: 'Capa da nota' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Usar arquivo do computador…' })).toBeVisible();
  await expect(page.locator('[data-cor="estante"]')).toBeVisible();
  await page.screenshot({ path: path.join(artifacts, 'ui-capa-seletor-claro.png') });
  await page.keyboard.press('Escape');
  await page.evaluate(() =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: ',', ctrlKey: true, bubbles: true })),
  );
  await page.locator('input[name="cfg-semana"][value="0"]').check();
  await page.locator('[data-nav="calendario"]').click();
  await expect(page.locator('.cal-semana span').first()).toHaveText('S');
  await expect(page.locator('.cal-dia strong').first()).toHaveText('26');
  await page.screenshot({ path: path.join(artifacts, 'ui-semana-domingo-claro.png') });
  await page.evaluate(() =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', altKey: true, bubbles: true })),
  );
  await expect(page.locator('.semana-diaria__dia').first()).toContainText('dom');
  await page.locator('#arvore').getByRole('button', { name: 'Leitura', exact: true }).click();
  await page.evaluate(() =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: ',', ctrlKey: true, bubbles: true })),
  );
  await page.locator('#cfg-pdf').click();
  await expect(page.locator('.pdf-pagina')).toContainText('memória');
  const wrap = await page.locator('.opcao-cartao b').first().evaluate((el) => getComputedStyle(el).whiteSpace);
  expect(wrap).toBe('nowrap');
  await page.screenshot({ path: path.join(artifacts, 'ui-exportar-previa-claro.png') });
  await page.keyboard.press('Escape');
  await page.evaluate(() =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true, bubbles: true })),
  );
  await page.locator('#comando-q').fill('Histórico');
  await page.locator('#comando-lista .menu__item', { hasText: 'Histórico de versões' }).click();
  await page.getByRole('button', { name: 'Gravar ponto agora' }).click();
  await page.locator('[data-versao]').first().click();
  await page.getByRole('button', { name: 'Restaurar esta versão' }).click();
  await page.getByRole('button', { name: 'Restaurar', exact: true }).click();
  await expect(page.locator('#st-estado')).not.toHaveText('Conflito');
  await app.close();
});

test('acabamento: Sofi, biblioteca, revisão e o dia', async () => {
  test.setTimeout(60000);
  const root = library();
  const app = await launch([`--biblioteca=${root}`, '--theme=light']);
  const page = await app.firstWindow();
  fs.mkdirSync(artifacts, { recursive: true });
  await expect(page.locator('#arvore')).toBeVisible();
  await page.evaluate(() =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', ctrlKey: true, bubbles: true })),
  );
  await expect(page.locator('.sofi-chat__topo')).toBeVisible();
  await expect(page.locator('#sofi-mascote')).toBeVisible();
  await expect(page.locator('#conexoes')).not.toContainText('origem agent');
  await page.screenshot({ path: path.join(artifacts, 'ui-sofi-painel-claro.png') });
  await page.locator('#seletor-biblioteca').click();
  await page.getByRole('menuitem', { name: 'Nova biblioteca…' }).click();
  await expect(page.getByRole('dialog', { name: 'Nova biblioteca' })).toBeVisible();
  await expect(page.locator('#biblioteca-nome')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('[data-nav="calendario"]').click();
  await page.locator('.cal-dia.is-hoje').click();
  await expect(page.locator('.painel-dia')).toBeVisible();
  await page.screenshot({ path: path.join(artifacts, 'ui-painel-dia-claro.png') });
  await page.evaluate(() =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: ',', ctrlKey: true, bubbles: true })),
  );
  await page.locator('#abrir-revisao').click();
  await expect(page.locator('.revisao-cartao')).toBeVisible();
  await app.close();
});

test('seletor de capa dentro da janela e a Sofi cabe na coluna', async () => {
  test.setTimeout(90000);
  const root = library();
  const app = await launch([`--biblioteca=${root}`, '--theme=light']);
  const page = await app.firstWindow();
  fs.mkdirSync(artifacts, { recursive: true });
  await page.locator('#arvore').getByRole('button', { name: 'Leitura', exact: true }).click();
  await page.getByRole('button', { name: 'Adicionar capa' }).click();
  const picker = page.getByRole('dialog', { name: 'Capa da nota' });
  await expect(picker).toBeVisible();
  const inside = await picker.evaluate((el) => {
    const box = el.getBoundingClientRect();
    return box.top >= 0 && box.left >= 0 && box.bottom <= window.innerHeight + 1 && box.right <= window.innerWidth + 1;
  });
  expect(inside).toBe(true);
  await picker.getByRole('button', { name: 'Ondas' }).click();
  await expect(page.locator('.coluna > .capa .capa__arte use')).toHaveAttribute('href', '#capa-ondas');
  await page.keyboard.press('Escape');
  await page.evaluate(() =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', ctrlKey: true, bubbles: true })),
  );
  await expect(page.locator('#conexoes .agente--lateral')).toBeVisible();
  const fits = await page.locator('#conexoes').evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
  expect(fits).toBe(true);
  const erase = await page.locator('#agente-enviar').evaluate((button) => {
    const host = document.querySelector('#conexoes').getBoundingClientRect();
    const box = button.getBoundingClientRect();
    return box.right <= host.right + 1 && box.bottom <= host.bottom + 1 && box.width > 0;
  });
  expect(erase).toBe(true);
  const windowHandle = await app.browserWindow(page);
  await windowHandle.evaluate((win) => win.setContentSize(800, 600));
  await page.evaluate(() =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', ctrlKey: true, bubbles: true })),
  );
  await expect(page.locator('#sofi-gaveta.is-aberta')).toBeVisible();
  await expect(page.locator('#gaveta-veu')).toBeVisible();
  await page.screenshot({ path: path.join(artifacts, 'ui-sofi-gaveta-800-claro.png') });
  await app.close();
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
  await expect(page.locator('.coluna a.wikilink')).toContainText('o grafo');
  await expect(page.locator('#nota-tags')).toContainText('estudo');
  await expect(page.locator('body')).toContainText('2026-11-20');
  const fontsReady = await page.evaluate(async () => {
    await document.fonts.load('400 14px "JetBrains Mono"');
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

test('rodada 5: prévia, versões, agenda, cores e abas', async () => {
  test.setTimeout(90000);
  const root = library();
  const app = await launch([`--biblioteca=${root}`]);
  const page = await app.firstWindow();
  fs.mkdirSync(artifacts, { recursive: true });
  await page.getByRole('button', { name: 'Leitura', exact: true }).click();
  await page.evaluate(() =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: ',', ctrlKey: true, bubbles: true })),
  );
  await page.locator('#cfg-pdf').click();
  await expect(page.locator('.pdf-pagina a.wikilink')).toContainText('o grafo');
  await page.keyboard.press('Escape');
  await page.evaluate(() =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true, bubbles: true })),
  );
  await page.locator('#comando-q').fill('Histórico');
  await page.locator('#comando-lista .menu__item', { hasText: 'Histórico de versões' }).click();
  await page.getByRole('button', { name: 'Gravar ponto agora' }).click();
  await expect(page.locator('.versao').first()).toContainText('Hoje');
  await page.screenshot({ path: path.join(artifacts, 'ui-versoes-diff-claro.png') });
  await page.locator('[data-nav="calendario"]').click();
  await page.locator('.cal-dia.is-hoje').click();
  await expect(page.locator('.painel-dia')).toBeVisible();
  await expect(page.locator('.painel-dia')).toContainText(/Criar nota do dia|de novembro/);
  await page.screenshot({ path: path.join(artifacts, 'ui-agenda-painel-claro.png') });
  await page.locator('#arvore [data-shelf="Estudos"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Cor e ícone' }).click();
  await expect(page.getByRole('button', { name: 'Índigo' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.evaluate(() =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: ',', ctrlKey: true, bubbles: true })),
  );
  await expect(page.locator('.config')).toContainText('começa na segunda');
  await page.locator('input[name="cfg-semana"][value="0"]').check();
  await expect(page.locator('.config')).toContainText('começa no domingo');
  expect(await page.locator('#gaveta-veu').count()).toBe(0);
  const windowHandle = await app.browserWindow(page);
  await windowHandle.evaluate((win) => win.setContentSize(800, 600));
  await page.locator('#abrir-lateral').click();
  await expect(page.locator('#gaveta-veu')).toBeVisible();
  const gap = await page.evaluate(() => {
    const tabs = document.querySelector('.titulo__abas').getBoundingClientRect();
    const actions = document.querySelector('.titulo__acoes').getBoundingClientRect();
    return actions.left - tabs.right;
  });
  expect(gap).toBeGreaterThan(8);
  await page.screenshot({ path: path.join(artifacts, 'ui-abas-800-claro.png') });
  await app.close();
});

test('editor visual o tempo todo e os fluxos da janela sem erro', async () => {
  test.setTimeout(120000);
  const root = library();
  const app = await launch([`--biblioteca=${root}`, '--theme=light']);
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  fs.mkdirSync(artifacts, { recursive: true });
  await page.getByRole('button', { name: 'Leitura', exact: true }).click();
  const paragraph = page.locator('.bloco--texto').first();
  await paragraph.click();
  await expect(paragraph.locator('a.wikilink')).toContainText('grafo');
  await expect(paragraph).not.toContainText('[[Estudos');
  await page.keyboard.press('End');
  await page.keyboard.type(' **vivo**');
  await expect(paragraph.locator('strong')).toHaveText('vivo');
  await expect(paragraph).not.toContainText('**');
  await page.keyboard.press('Control+z');
  await expect(paragraph).not.toContainText('vivo');
  await page.keyboard.press('Control+Shift+Z');
  await expect(paragraph.locator('strong')).toHaveText('vivo');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('# Titulo curto');
  await expect(page.locator('h1.bloco--titulo', { hasText: 'Titulo curto' })).toBeVisible();
  await page.keyboard.press('Enter');
  await page.keyboard.type('- item um');
  await expect(page.locator('.bloco--item', { hasText: 'item um' })).toBeVisible();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('[] tarefa viva');
  await expect(page.locator('.tarefa__texto', { hasText: 'tarefa viva' })).toBeVisible();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('> uma citacao');
  await expect(page.locator('blockquote.bloco--citacao', { hasText: 'uma citacao' })).toBeVisible();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('```');
  await expect(page.locator('.bloco--codigo')).toBeVisible();
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('blockquote.bloco--citacao').last()).toBeFocused();
  await page.keyboard.insertText(' e link');
  await expect(page.locator('blockquote.bloco--citacao').last()).toContainText('e link');
  const file = path.join(root, 'Estudos', 'Leitura.md');
  await expect.poll(() => fs.readFileSync(file, 'utf8')).toContain('Titulo curto');
  await expect.poll(() => fs.readFileSync(file, 'utf8')).toContain('- [ ] tarefa viva');
  await page.screenshot({ path: path.join(artifacts, 'ui-editor-wysiwyg-claro.png') });

  await page.locator('#novo').click();
  await page.getByRole('menuitem', { name: 'Nova nota' }).click();
  await expect(page.locator('.bloco--titulo').first()).toBeVisible();
  await page.locator('#arvore [data-open="Estudos/Sem título.md"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Renomear' }).click();
  await page.locator('[data-rename="note"]').fill('Renomeada');
  await page.locator('[data-rename="note"]').press('Enter');
  await expect.poll(() => fs.existsSync(path.join(root, 'Estudos', 'Renomeada.md'))).toBe(true);
  await page.locator('#novo').click();
  await page.getByRole('menuitem', { name: 'Nova estante' }).click();
  await page.locator('#nome-estante').fill('Arquivo');
  await page.locator('#nome-estante').press('Enter');
  await expect(page.locator('#arvore [data-shelf="Arquivo"]')).toBeVisible();
  await page.locator('#arvore [data-shelf="Arquivo"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Nova nota aqui' }).click();
  await expect.poll(() => fs.readdirSync(path.join(root, 'Arquivo')).some((name) => name.endsWith('.md'))).toBe(true);
  await page.locator('#arvore [data-shelf="Arquivo"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Excluir…' }).click();
  await page.getByRole('button', { name: 'Excluir', exact: true }).click();
  await expect(page.locator('#arvore [data-shelf="Arquivo"]')).toHaveCount(0);

  await page.locator('#novo').click();
  await page.getByRole('menuitem', { name: 'Novo canvas' }).click();
  await expect(page.locator('.cv-barra').first()).toBeVisible();
  await page.locator('[data-nav="tarefas"]').click();
  await expect(page.getByRole('heading', { name: 'Tarefas' })).toBeVisible();
  await page.locator('[data-nav="calendario"]').click();
  await expect(page.locator('.calendario')).toBeVisible();
  await page.locator('#arvore').getByRole('button', { name: 'Leitura', exact: true }).click();
  await page.getByRole('button', { name: 'Adicionar capa' }).click();
  await expect(page.getByRole('dialog', { name: 'Capa da nota' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.evaluate(() =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: ',', ctrlKey: true, bubbles: true })),
  );
  await expect(page.locator('.config')).toBeVisible();
  await page.locator('#cfg-pdf').click();
  await expect(page.locator('.pdf-pagina')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.evaluate(() =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true, bubbles: true })),
  );
  await page.locator('#comando-q').fill('Histórico');
  await page.locator('#comando-lista .menu__item', { hasText: 'Histórico de versões' }).click();
  await expect(page.locator('.versoes-tela')).toBeVisible();
  await page.evaluate(() =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', ctrlKey: true, bubbles: true })),
  );
  await expect(page.locator('.agente--lateral, #sofi-gaveta').first()).toBeVisible();
  await page.screenshot({ path: path.join(artifacts, 'ui-fluxos-claro.png') });
  expect(errors).toEqual([]);
  await app.close();
});

test('rodada 6: barra, enter, atalhos, desfazer e capa', async () => {
  test.setTimeout(120000);
  const root = library();
  const app = await launch([`--biblioteca=${root}`, '--theme=light']);
  const page = await app.firstWindow();
  fs.mkdirSync(artifacts, { recursive: true });
  await page.locator('#novo').click();
  await page.getByRole('menuitem', { name: 'Nova nota' }).click();
  await expect(page.locator('#modo-leitura')).toHaveCount(0);
  const opened = await page.locator('#arvore [data-open][aria-selected="true"]').getAttribute('data-open');
  const file = path.join(root, opened);
  await page.locator('.bloco--titulo').first().click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/');
  await page.getByRole('option', { name: 'Título 1' }).click();
  expect(await page.evaluate(() => document.activeElement?.tagName || '')).not.toBe('BODY');
  await page.keyboard.type('Cabeçalho via barra');
  await expect(page.locator('.bloco--titulo', { hasText: 'Cabeçalho via barra' })).toBeVisible();
  await expect.poll(() => fs.readFileSync(file, 'utf8')).toContain('Cabeçalho via barra');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/');
  await page.getByRole('option', { name: 'Bloco de código' }).click();
  await page.keyboard.type('const x = 1;');
  await expect(page.locator('.bloco--codigo')).toContainText('const x = 1;');
  await expect.poll(() => fs.readFileSync(file, 'utf8')).toContain('const x = 1;');

  await page.keyboard.press('Control+Enter');
  await page.keyboard.type('Alpha uma.');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Bravo duas.');
  await expect.poll(() => fs.readFileSync(file, 'utf8')).toMatch(/Alpha uma\.\n\nBravo duas\./);
  await page.keyboard.press('Home');
  await page.keyboard.press('Backspace');
  await expect.poll(() => fs.readFileSync(file, 'utf8')).toContain('Alpha uma. Bravo duas.');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Primeiro');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Segundo');
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('End');
  await page.keyboard.press('Delete');
  await expect.poll(() => fs.readFileSync(file, 'utf8')).toContain('Primeiro Segundo');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('# Titulo digitado');
  await expect(page.getByRole('heading', { name: 'Titulo digitado', exact: true })).toBeVisible();
  await expect.poll(() => fs.readFileSync(file, 'utf8')).toContain('Alpha uma. Bravo duas.');
  await page.keyboard.press('Enter');
  await page.keyboard.type('- item digitado');
  await expect(page.locator('.bloco--item', { hasText: 'item digitado' })).toBeVisible();
  await page.keyboard.press('Enter');
  await page.keyboard.type('item seguinte');
  await expect(page.locator('.bloco--item', { hasText: 'item seguinte' })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect.poll(() => fs.readFileSync(file, 'utf8')).toMatch(/\n {2}- item seguinte/);
  expect(await page.evaluate(() => document.activeElement?.isContentEditable === true)).toBe(true);

  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.evaluate(() => {
    const target = document.activeElement;
    const data = new DataTransfer();
    data.setData('text/plain', '# Título colado\n- item colado\n> citação colada');
    target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
  });
  await expect(page.locator('.bloco--titulo', { hasText: 'Título colado' })).toBeVisible();
  await expect(page.locator('.bloco--item', { hasText: 'item colado' })).toBeVisible();
  await expect(page.locator('blockquote', { hasText: 'citação colada' })).toBeVisible();

  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Palavra');
  await page.waitForTimeout(800);
  await page.keyboard.type(' EXTRA');
  await page.locator('#coluna .nota__caminho').click();
  await page.keyboard.press('Control+z');
  await expect.poll(() => fs.readFileSync(file, 'utf8')).not.toMatch(/EXTRA/);
  await expect.poll(() => fs.readFileSync(file, 'utf8')).toContain('Palavra');
  await page.keyboard.press('Control+y');
  await expect.poll(() => fs.readFileSync(file, 'utf8')).toMatch(/EXTRA/);

  const paragraph = page.locator('.bloco--texto').first();
  await paragraph.click();
  await page.keyboard.type('**negrito**');
  await expect(paragraph.locator('strong')).toHaveText('negrito');
  await expect(paragraph).not.toContainText('**negrito**');

  await page.getByRole('button', { name: 'Adicionar capa' }).click();
  await page.getByRole('button', { name: 'Ondas' }).click();
  await page.getByRole('button', { name: 'Trocar capa' }).click();
  await page.locator('#capa-y').evaluate((input) => {
    input.value = '30';
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect.poll(() => fs.readFileSync(file, 'utf8')).toMatch(/capa_y: .?30%/);
  await page.screenshot({ path: path.join(artifacts, 'ui-editor-rodada6-claro.png') });
  await app.close();
});

test('rodada 6: seleção entre blocos e lista numerada', async () => {
  test.setTimeout(60000);
  const root = library();
  const app = await launch([`--biblioteca=${root}`, '--theme=light']);
  const page = await app.firstWindow();
  await page.locator('#novo').click();
  await page.getByRole('menuitem', { name: 'Nova nota' }).click();
  const opened = await page.locator('#arvore [data-open][aria-selected="true"]').getAttribute('data-open');
  const file = path.join(root, opened);
  await page.locator('.bloco--titulo').first().click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('1. um');
  await expect(page.locator('.bloco--item', { hasText: 'um' })).toBeVisible();
  await page.keyboard.press('Enter');
  await page.keyboard.type('dois');
  await expect.poll(() => fs.readFileSync(file, 'utf8')).toMatch(/1\. um\n2\. dois/);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('> uma citacao');
  await expect(page.locator('blockquote', { hasText: 'uma citacao' })).toBeVisible();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Alpha sel');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Bravo sel');
  await page.keyboard.press('Home');
  await page.keyboard.down('Shift');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.up('Shift');
  await expect(page.locator('.is-selecionado').first()).toBeVisible();
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Backspace');
  await expect.poll(() => fs.readFileSync(file, 'utf8')).not.toContain('Alpha sel');
  await expect.poll(() => fs.readFileSync(file, 'utf8')).not.toContain('Bravo sel');
  await app.close();
});

test('rodada 7: reabrir, item no início, cursor formatado, colar e canvas', async () => {
  test.setTimeout(90000);
  const root = library();
  const formatted = path.join(root, 'Estudos', 'Formato.md');
  fs.writeFileSync(
    formatted,
    '# Formato\n\nTexto com **negrito**, *itálico*, [[Estudos/Grafo|grafo]] e `codigo` no fim.\n',
    'utf8',
  );
  const app = await launch([`--biblioteca=${root}`, '--theme=light']);
  const page = await app.firstWindow();
  await page.locator('#novo').click();
  await page.getByRole('menuitem', { name: 'Nova nota' }).click();
  const opened = await page.locator('#arvore [data-open][aria-selected="true"]').getAttribute('data-open');
  const file = path.join(root, opened);
  await page.locator('.bloco--titulo').first().click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Paragrafo A da quebra');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Paragrafo B da quebra');
  await expect.poll(() => fs.readFileSync(file, 'utf8')).toMatch(/Paragrafo A da quebra\n\nParagrafo B da quebra/);
  await page.locator('#arvore').getByRole('button', { name: 'Leitura', exact: true }).click();
  await page.locator(`#arvore [data-open="${opened}"]`).click();
  await expect(page.locator('.bloco--texto', { hasText: 'Paragrafo A da quebra' })).toBeVisible();
  await expect(page.locator('.bloco--texto', { hasText: 'Paragrafo B da quebra' })).toBeVisible();
  await expect(page.locator('.bloco--texto', { hasText: 'Paragrafo A da quebra Paragrafo B da quebra' })).toHaveCount(0);

  await page.locator('.bloco--texto', { hasText: 'Paragrafo B da quebra' }).click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('- item dois');
  await page.keyboard.press('Home');
  await page.keyboard.press('Enter');
  await expect.poll(() => fs.readFileSync(file, 'utf8')).toMatch(/item dois/);
  const afterEnter = fs.readFileSync(file, 'utf8');
  expect(afterEnter).toMatch(/- item dois/);

  await page.evaluate(() => {
    const target = document.querySelector('.bloco--texto, .bloco--item');
    target.focus();
    const data = new DataTransfer();
    data.setData('text/plain', 'Colado linha um\n\nColado linha dois');
    target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
  });
  await expect(page.locator('.bloco--texto', { hasText: 'Colado linha um' })).toBeVisible();
  await expect(page.locator('.bloco--texto', { hasText: 'Colado linha dois' })).toBeVisible();
  await expect(page.locator('.bloco--texto', { hasText: 'Colado linha um Colado linha dois' })).toHaveCount(0);

  await page.locator('#arvore').getByRole('button', { name: 'Formato', exact: true }).click();
  const rich = page.locator('.bloco--texto').first();
  await rich.click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Novo');
  await expect.poll(() => fs.readFileSync(formatted, 'utf8')).toContain('no fim.');
  await expect.poll(() => fs.readFileSync(formatted, 'utf8')).not.toMatch(/pará\n/);
  await expect(page.locator('.bloco--texto', { hasText: 'Novo' })).toBeVisible();
  await expect(rich.locator('strong')).toHaveText('negrito');
  await expect(rich.locator('em')).toHaveText('itálico');
  await expect(rich.locator('code')).toHaveText('codigo');
  await expect(rich.locator('a.wikilink')).toContainText('grafo');

  await page.locator('#arvore [data-canvas="Estudos/Mapa.canvas"]').click();
  await expect(page.locator('.canvas-area')).toBeVisible();
  await page.locator('[data-nav="canvas"]').click();
  await page.locator('[data-abrir-canvas="Estudos/Mapa.canvas"]').click();
  await expect(page.locator('.canvas-area')).toBeVisible();
  const beforeCards = await page.locator('.cv-cartao').count();
  await page.locator('[data-tool="select"]').click();
  await page.locator('.canvas-area').dispatchEvent('pointerdown', { clientX: 700, clientY: 500 });
  await expect(page.locator('.cv-cartao')).toHaveCount(beforeCards);
  await page.locator('[data-tool="rectangle"]').click();
  await page.locator('.canvas-area').dispatchEvent('pointerdown', { clientX: 700, clientY: 500 });
  await expect(page.locator('.cv-cartao')).toHaveCount(beforeCards + 1);
  await expect(page.locator('[data-tool="select"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.cv-cartao[aria-selected="true"] .cv-alca')).toHaveCount(4);
  await expect(page.locator('.cv-cartao[aria-selected="true"] .cv-texto')).toHaveAttribute(
    'data-placeholder',
    'Escreva algo… use [[ para ligar',
  );
  await page.locator('[data-tool="rectangle"]').click();
  await page.locator('.canvas-area').dispatchEvent('pointerdown', { clientX: 430, clientY: 360 });
  const rectangle = page.locator('.cv-forma--rectangle').last();
  await expect(rectangle).toBeVisible();
  await rectangle.locator('.cv-texto').fill('Ideia ligada a [[Estudos/Formato]]');
  await page.locator('[data-tool="ellipse"]').click();
  await page.locator('.canvas-area').dispatchEvent('pointerdown', { clientX: 900, clientY: 360 });
  await expect(page.locator('.cv-forma--ellipse')).toBeVisible();
  await expect(rectangle.locator('a.wikilink')).toHaveText('Formato');
  await expect(rectangle.locator('a.wikilink')).toHaveAttribute('data-target', 'Estudos/Formato');
  await page.locator('[data-tool="connect"]').click();
  const ellipse = page.locator('.cv-forma--ellipse').last();
  const from = await rectangle.boundingBox();
  const to = await ellipse.boundingBox();
  await rectangle.dispatchEvent('pointerdown', { clientX: from.x + 8, clientY: from.y + 8 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2);
  await page.mouse.up();
  await expect(page.locator('.cv-seta [data-edge]')).not.toHaveCount(0);
  await app.close();
});
