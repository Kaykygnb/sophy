const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function launchWith(files, theme = 'light') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-f4m-'));
  fs.mkdirSync(path.join(root, '.sophy'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Estudos'), { recursive: true });
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(root, 'Estudos', name), text);
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-f4m-data-'));
  fs.writeFileSync(path.join(userData, 'ui.json'), JSON.stringify({ onboarded: true, libraryPath: root, libraries: [root], theme }));
  const env = { ...process.env, NODE_OPTIONS: '--experimental-strip-types' };
  delete env.ELECTRON_RUN_AS_NODE;
  return electron.launch({ args: ['.', `--test-user-data=${userData}`], env });
}

test('mermaid: só carrega a biblioteca quando há bloco, desenha, alterna e segue o tema', async () => {
  const app = await launchWith({
    'Sem.md': '# Sem\n\nTexto simples.\n',
    'Fluxo.md': '# Fluxo\n\n```mermaid\ngraph TD\n  A[Ler] --> B[Revisar]\n  B --> C[Lembrar]\n```\n',
  });
  const page = await app.firstWindow();
  try {
    // a lateral precisa estar pronta (as tags carregam junto) para o clique não cair na nota vizinha
    await expect(page.locator('#tags-painel .tags-painel__topo')).toBeVisible();
    await page.locator('#arvore').getByText('Sem', { exact: true }).first().click();
    await expect(page.locator('#st-caminho')).toContainText('Sem.md');
    await expect(page.locator('.bloco').first()).toBeVisible();
    await expect(page.locator('.codigo--mermaid')).toHaveCount(0);
    expect(await page.evaluate(() => Boolean(window.mermaid))).toBe(false);
    expect(await page.evaluate(() => [...document.scripts].some((s) => /mermaid/.test(s.src)))).toBe(false);

    await page.locator('#arvore').getByText('Fluxo', { exact: true }).first().click();
    const wrap = page.locator('.codigo--mermaid');
    await expect(wrap).toHaveAttribute('data-vista', 'diagrama');
    await expect(wrap.locator('.codigo__diagrama svg')).toBeVisible({ timeout: 20000 });
    await expect(wrap.locator('.codigo__diagrama')).toContainText('Revisar');
    await expect(wrap.locator('.codigo__rolagem')).toBeHidden();

    // alterna para o código e volta
    await wrap.getByRole('button', { name: 'Código' }).click();
    await expect(wrap.locator('.codigo__rolagem')).toBeVisible();
    await expect(wrap.locator('.codigo__diagrama')).toBeHidden();
    await wrap.getByRole('button', { name: 'Diagrama' }).click();
    await expect(wrap.locator('.codigo__diagrama svg')).toBeVisible();

    // tema escuro: o desenho muda de cor junto
    const fill = () => page.evaluate(() => getComputedStyle(document.querySelector('.codigo__diagrama svg .node rect, .codigo__diagrama svg .node polygon')).fill);
    const light = await fill();
    await page.locator('#tema').click();
    await expect.poll(fill, { timeout: 10000 }).not.toBe(light);
  } finally {
    await app.close();
  }
});

test('mermaid: sintaxe inválida mostra erro amigável e o código continua intacto', async () => {
  const source = '```mermaid\ndiagrama-que-nao-existe\n  A ??? B\n```\n';
  const app = await launchWith({ 'Quebrado.md': `# Quebrado\n\n${source}` });
  const page = await app.firstWindow();
  try {
    await page.locator('#arvore').getByText('Quebrado', { exact: true }).first().click();
    const error = page.locator('.diagrama__erro');
    await expect(error).toBeVisible({ timeout: 20000 });
    await expect(error).toContainText('Não deu para desenhar este diagrama');
    await error.getByRole('button', { name: 'Ver o código' }).click();
    await expect(page.locator('.codigo--mermaid')).toHaveAttribute('data-vista', 'codigo');
    await expect(page.locator('pre.bloco--codigo')).toContainText('A ??? B');
  } finally {
    await app.close();
  }
});
