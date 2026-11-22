const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function library() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-tarefas-bug-'));
  fs.mkdirSync(path.join(root, '.sophy'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Diário'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'Diário', '2026-11-21.md'),
    `# Sábado, 21 de novembro de 2026

- [ ] Comprar a ração do tobi 2<span data-fundo="marrom">026-11-22</span>
- [ ]
- [ ] ⏫
- [ ] Passear com o tobi
`,
  );
  return root;
}

async function launch(root) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-tarefas-bug-data-'));
  fs.writeFileSync(
    path.join(userData, 'ui.json'),
    JSON.stringify({ onboarded: true, libraryPath: root, libraries: [root], theme: 'light' }),
  );
  const env = { ...process.env, NODE_OPTIONS: '--experimental-strip-types' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', `--test-user-data=${userData}`], env });
  return { app, page: await app.firstWindow() };
}

test('quadro de tarefas mostra o título limpo e ignora itens vazios', async () => {
  const root = library();
  const { app, page } = await launch(root);
  await page.locator('[data-nav="tarefas"]').click();
  await expect(page.getByRole('heading', { name: 'Tarefas' })).toBeVisible();
  await page.locator('[data-modo="quadro"]').click();
  const column = page.locator('.quadro__coluna[data-status="aberta"]');
  await expect(column.getByRole('heading', { name: /A fazer/ })).toContainText('2');
  const cards = column.locator('.kcard');
  await expect(cards).toHaveCount(2);
  const racao = column.locator('.kcard', { hasText: 'Comprar a ração do tobi 2026-11-22' });
  await expect(racao).toBeVisible();
  const title = racao.locator('.kcard__titulo');
  await expect(title).toHaveText('Comprar a ração do tobi 2026-11-22');
  const html = await title.innerHTML();
  expect(html).not.toMatch(/span|data-fundo|<|>/i);
  await expect(column.locator('.kcard', { hasText: 'Passear com o tobi' })).toBeVisible();
  const texts = await cards.locator('.kcard__titulo').allTextContents();
  expect(texts.every((text) => text.trim().length > 0)).toBe(true);
  await expect(page.locator('.kcard__titulo', { hasText: 'data-fundo' })).toHaveCount(0);
  await app.close();
});
