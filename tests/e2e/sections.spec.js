const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function makeLibrary() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-secoes-ui-'));
  fs.mkdirSync(path.join(root, 'Estudos'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'Estudos', 'Secoes.md'),
    [
      '# Secoes',
      '',
      '## Alpha',
      '',
      'corpo alpha',
      '',
      '### Detalhe',
      '',
      'detalhe',
      '',
      '## Beta',
      '',
      'corpo beta',
      '',
      '[[Secoes#Alpha]] e [[Secoes#Fantasma]]',
      '',
    ].join('\n'),
  );
  return root;
}

async function launch(root) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-secoes-data-'));
  const env = { ...process.env, NODE_OPTIONS: '--experimental-strip-types' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    args: ['.', `--test-user-data=${userData}`, `--biblioteca=${root}`, '--theme=light'],
    env,
  });
  const page = await app.firstWindow();
  return { app, page, userData };
}

test('recolher seção, link e seção renomeada quebrada', async () => {
  const root = makeLibrary();
  const { app, page, userData } = await launch(root);
  try {
    await page.locator('#arvore').getByRole('button', { name: 'Secoes', exact: true }).click();
    await expect(page.locator('#coluna')).toContainText('corpo alpha');
    await page.locator('[data-secao-toggle="Alpha"]').click();
    await expect(page.locator('#coluna')).not.toContainText('corpo alpha');
    await expect(page.locator('.bloco--titulo', { hasText: 'Detalhe' })).toHaveCount(0);
    await expect(page.locator('#coluna')).toContainText('corpo beta');

    const settings = JSON.parse(fs.readFileSync(path.join(userData, 'ui.json'), 'utf8'));
    expect(settings.collapsedSections['Estudos/Secoes.md']).toContain('Alpha');

    await page.locator('[data-secao-toggle="Alpha"]').click();
    await expect(page.locator('#coluna')).toContainText('corpo alpha');
    await expect(page.locator('.bloco--titulo', { hasText: 'Detalhe' })).toBeVisible();

    await page.locator('#abrir-conexoes').click();
    await expect(page.locator('.sumario')).toContainText('Alpha');
    await page.locator('.sumario__item', { hasText: 'Beta' }).click();
    await expect(page.locator('.bloco--titulo', { hasText: 'Beta' })).toHaveClass(/is-secao-alvo/);

    await expect(page.locator('a.wikilink[data-raw="[[Secoes#Alpha]]"]')).not.toHaveClass(/wikilink--quebrado/);
    await expect(page.locator('a.wikilink[data-raw="[[Secoes#Fantasma]]"]')).toHaveClass(/wikilink--quebrado/);

    await page.locator('a.wikilink[data-raw="[[Secoes#Alpha]]"]').click();
    await expect(page.locator('.bloco--titulo', { hasText: 'Alpha' })).toHaveClass(/is-secao-alvo/);
  } finally {
    await app.close();
  }
});
