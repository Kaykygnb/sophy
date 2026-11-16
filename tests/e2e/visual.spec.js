const { test, expect, _electron } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { WorldManager } = require('../../src/worlds');
const Markdown = require('../../src/editor/markdown');
let app, page, base;
const scratch = path.join(os.homedir(), 'Documents/Codex/2026-11-07/en/work');
const captures = path.join(scratch, 'sophy-qa');
test.beforeEach(async () => {
  fs.mkdirSync(captures, { recursive: true });
  base = fs.mkdtempSync(path.join(scratch, 'sophy-visual-'));
  const data = path.join(base, 'data');
  fs.mkdirSync(data);
  const manager = new WorldManager(path.join(data, 'worlds.json'), {
    home: os.homedir(),
    protectedPaths: [data],
  });
  manager.create('Atlas', base);
  const area = manager.current().create('Jardim de ideias').workspace;
  manager.current().create('Pesquisa');
  manager.current().create('Arquivo');
  fs.mkdirSync(path.join(area.path, 'Projetos'));
  fs.writeFileSync(
    path.join(area.path, 'Projetos', 'Próximos passos.md'),
    '# Próximos passos\n\n- Escrever com calma\n- Conectar boas ideias\n',
  );
  const body =
    '## Um espaço para pensar.\n\nAlgumas ideias precisam de tempo. Outras, de um lugar para começar. Aqui, elas podem crescer juntas.\n\n- Capture o que chamou sua atenção.\n- Conecte uma ideia a outra com [[Referências]].\n- Volte quando fizer sentido.\n\n> Uma boa nota é uma conversa com o seu eu do futuro.\n';
  const meta = {
    version: 1,
    bodyHash: Markdown.hash(body),
    metadata: {
      icon: '🌿',
      properties: [
        {
          id: 'status',
          name: 'Status',
          type: 'select',
          options: ['Semente', 'Em andamento', 'Concluída'],
          value: 'Em andamento',
        },
        { id: 'tipo', name: 'Tipo', type: 'text', value: 'Ideias e descobertas' },
      ],
    },
  };
  fs.writeFileSync(
    path.join(area.path, 'Sobre o Sophy.md'),
    '---\nnotas1_editor: ' + JSON.stringify(meta) + '\n---\n' + body,
  );
  fs.writeFileSync(
    path.join(area.path, 'Referências.md'),
    '# Referências\n\nVolte ao [[Sobre o Sophy]] para encontrar o fio da conversa.\n',
  );
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await _electron.launch({
    args: ['.', `--test-user-data=${data}`],
    cwd: path.resolve(__dirname, '../..'),
    env,
  });
  page = await app.firstWindow();
});
test.afterEach(async () => {
  if (app) await app.close();
  if (base) fs.rmSync(base, { recursive: true, force: true });
});
test('Sophy tem identidade própria e controles de layout funcionam em janela estreita', async () => {
  await expect(page.locator('.app-brand')).toContainText('Sophy');
  await expect(page).toHaveTitle(/Sophy/);
  await page.getByRole('button', { name: 'Voltar a esta biblioteca', exact: true }).click();
  await expect(page.locator('.workspace-card')).toHaveCount(3);
  await page
    .locator('.workspace-card')
    .filter({ hasText: 'Jardim de ideias' })
    .getByRole('button', { name: 'Abrir estante', exact: true })
    .press('Enter');
  await page.locator('.file-tree [data-path="Sobre o Sophy.md"]').press('Enter');
  await expect(page.frameLocator('iframe:not([hidden])').locator('#title')).toHaveText(
    'Sobre o Sophy',
  );
  await expect(page.locator('.backlink-item')).toHaveCount(1);
  await expect(page.locator('.note-backlinks')).not.toHaveAttribute('open', '');
  const frame = page.frameLocator('iframe:not([hidden])');
  await expect(frame.locator('#noteProperties')).toBeHidden();
  await frame.locator('.note-details > summary').click();
  await expect(frame.locator('#noteProperties')).toBeVisible();
  await frame.locator('.note-details > summary').click();
  await frame.locator('.page-options > summary').click();
  await expect(frame.locator('#openComments')).toBeVisible();
  await frame.locator('.page-options > summary').click();
  await page.getByRole('button', { name: 'Ações de Sobre o Sophy.md', exact: true }).press('Enter');
  await expect(page.locator('.file-context')).toBeVisible();
  await page.getByRole('treeitem').filter({ hasText: 'Projetos' }).press('Enter');
  await expect(page.locator('.file-tree [data-path="Projetos/Próximos passos.md"]')).toBeVisible();
  await page.getByRole('button', { name: 'Recolher todas as pastas' }).press('Enter');
  await expect(page.locator('.file-tree [data-path="Projetos/Próximos passos.md"]')).toHaveCount(0);
  const resize = page.getByRole('separator', { name: 'Largura da árvore de arquivos' });
  const before = Number(await resize.getAttribute('aria-valuenow'));
  await resize.press('ArrowRight');
  await expect(resize).toHaveAttribute('aria-valuenow', String(before + 16));
  await page.getByRole('button', { name: 'Modo de foco', exact: true }).press('Enter');
  await expect(page.locator('.area-files')).toBeHidden();
  await expect(page.locator('.study-nav')).toBeHidden();
  await page.getByRole('button', { name: 'Modo de foco', exact: true }).press('Enter');
  await expect(page.locator('.area-files')).toBeVisible();
  await page.getByRole('button', { name: 'Expandir navegação', exact: true }).press('Enter');
  await expect(page.locator('.area-shell')).not.toHaveClass(/nav-compact/);
  await page.getByRole('button', { name: 'Recolher navegação', exact: true }).press('Enter');
  await expect(page.locator('.area-shell')).toHaveClass(/nav-compact/);
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(760, 800),
  );
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(760);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
