const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const shots = path.join('/workspace', 'slash-mermaid-prints');

function launchWith(files, theme = 'light') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-slash-mmd-'));
  fs.mkdirSync(path.join(root, '.sophy'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Estudos'), { recursive: true });
  for (const [name, text] of Object.entries(files))
    fs.writeFileSync(path.join(root, 'Estudos', name), text);
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-slash-mmd-data-'));
  fs.writeFileSync(
    path.join(userData, 'ui.json'),
    JSON.stringify({ onboarded: true, libraryPath: root, libraries: [root], theme }),
  );
  const env = { ...process.env, NODE_OPTIONS: '--experimental-strip-types' };
  delete env.ELECTRON_RUN_AS_NODE;
  return electron.launch({ args: ['.', `--test-user-data=${userData}`], env });
}

test('o menu / insere um diagrama Mermaid e desenha', async () => {
  const app = await launchWith({ 'Rascunho.md': '# Rascunho\n\nEscreva aqui.\n' });
  const page = await app.firstWindow();
  fs.mkdirSync(shots, { recursive: true });
  try {
    await page.locator('#arvore').getByText('Rascunho', { exact: true }).first().click();
    const block = page.locator('.bloco--texto').first();
    await expect(block).toBeVisible();
    await block.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('/merm');
    const menu = page.locator('.menu--blocos');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('option', { name: 'Diagrama (Mermaid)' })).toBeVisible();
    await expect(menu).toContainText('Sequência');
    await menu.screenshot({ path: path.join(shots, 'menu.png') });
    await page.screenshot({ path: '/workspace/slash-mermaid-menu.png' });

    await menu.getByRole('option', { name: 'Diagrama (Mermaid)' }).click();
    const wrap = page.locator('.codigo--mermaid');
    await expect(wrap).toBeVisible();
    await expect(wrap.locator('.codigo__diagrama svg')).toBeVisible({ timeout: 20000 });
    await expect(wrap.locator('.codigo__diagrama')).toContainText('Início');
    await expect(wrap.locator('.codigo__diagrama')).toContainText('Próximo passo');
    await wrap.screenshot({ path: path.join(shots, 'diagrama.png') });
    await page.screenshot({ path: '/workspace/slash-mermaid-diagrama.png' });
  } finally {
    await app.close();
  }
});

test('o menu / tem os quatro modelos Mermaid e todos desenham no tema escuro', async () => {
  const names = ['Um', 'Dois', 'Tres', 'Quatro'];
  const app = await launchWith(Object.fromEntries(names.map((name) => [`${name}.md`, `# ${name}\n\nEscreva aqui.\n`])), 'dark');
  const page = await app.firstWindow();
  try {
    await expect(page.locator('#tags-painel .tags-painel__topo')).toBeVisible();
    const models = [
      ['Diagrama (Mermaid)', 'Próximo passo'],
      ['Sequência', 'Bruno'],
      ['Mapa mental', 'Ramo A'],
      ['Gantt', 'Tarefa'],
    ];
    for (const [index, [label, text]] of models.entries()) {
      await page.locator('#arvore').getByText(names[index], { exact: true }).first().click();
      await expect(page.locator('#st-caminho')).toContainText(`${names[index]}.md`);
      const block = page.locator('.bloco--texto').first();
      await block.click();
      await page.keyboard.press('Control+A');
      await page.keyboard.type('/merm');
      const menu = page.locator('.menu--blocos');
      await expect(menu).toBeVisible();
      for (const [other] of models) await expect(menu.getByRole('option', { name: other }).first()).toBeVisible();
      await menu.getByRole('option', { name: label }).first().click();
      const wrap = page.locator('.codigo--mermaid');
      await expect(wrap.locator('.codigo__diagrama svg')).toBeVisible({ timeout: 20000 });
      await expect(wrap.locator('.codigo__diagrama')).toContainText(text);
      await expect(wrap.locator('.codigo__erro, .codigo__diagrama .error-icon')).toHaveCount(0);
    }
    // no escuro o texto do desenho é claro (o tema do Mermaid segue o app)
    const light = await page.locator('.codigo__diagrama svg text, .codigo__diagrama svg .taskText').first().evaluate((el) => {
      const [r, g, b] = getComputedStyle(el).fill.match(/\d+/g).map(Number);
      return (r + g + b) / 3;
    });
    expect(light).toBeGreaterThan(140);
  } finally {
    await app.close();
  }
});
