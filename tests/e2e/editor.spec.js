const { test, expect, _electron } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { WorldManager } = require('../../src/worlds');
let app, base, area, page, errors;
test.beforeEach(async () => {
  const scratch = path.join(os.homedir(), 'Documents/Codex/2026-11-07/en/work');
  fs.mkdirSync(scratch, { recursive: true });
  base = fs.mkdtempSync(path.join(scratch, 'notas1-e2e-'));
  const data = path.join(base, 'data');
  fs.mkdirSync(data);
  const worlds = new WorldManager(path.join(data, 'worlds.json'), {
    home: os.homedir(),
    protectedPaths: [data],
  });
  worlds.create('Mundo de teste', base);
  area = worlds.current().create('Pesquisa').workspace;
  fs.writeFileSync(path.join(area.path, 'Ideia.md'), '# Pesquisa\n\nTexto inicial.\n');
  fs.writeFileSync(path.join(area.path, 'Segunda.md'), 'Segunda nota.\n');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await _electron.launch({
    args: ['.', `--test-user-data=${data}`],
    cwd: path.resolve(__dirname, '../..'),
    env,
  });
  page = await app.firstWindow();
  errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.getByRole('button', { name: 'Voltar a esta biblioteca', exact: true }).click();
  await page.getByRole('button', { name: 'Abrir estante', exact: true }).click();
  await expect(page.getByRole('tree', { name: 'Arquivos da estante' })).toBeVisible();
});
test.afterEach(async () => {
  if (app) await app.close();
  if (base) fs.rmSync(base, { recursive: true, force: true });
});
test('motor visual edita Markdown real; abas, criação e alterações externas funcionam', async () => {
  await page.locator('.file-tree [data-path="Ideia.md"]').click();
  const frame = page.frameLocator('iframe.block-editor:not([hidden])');
  await expect(frame.locator('#page .edit').last()).toHaveText('Texto inicial.');
  await frame.locator('#page .edit').last().click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Mais uma ideia.');
  await expect
    .poll(() => fs.readFileSync(path.join(area.path, 'Ideia.md'), 'utf8'))
    .toContain('Mais uma ideia.');
  await page.locator('.file-tree [data-path="Segunda.md"]').click();
  await expect(page.locator('.note-tab')).toHaveCount(2);
  await expect(
    page.frameLocator('iframe.block-editor:not([hidden])').locator('#page .edit'),
  ).toHaveText('Segunda nota.');
  fs.writeFileSync(path.join(area.path, 'Segunda.md'), 'Mudou por fora.\n');
  await expect(
    page.frameLocator('iframe.block-editor:not([hidden])').locator('#page .edit'),
  ).toHaveText('Mudou por fora.', { timeout: 12000 });
  await page.getByRole('button', { name: 'Nova nota', exact: true }).click();
  await page.getByLabel('Nome da nota', { exact: true }).fill('Nova ideia');
  await page.getByRole('button', { name: 'Criar', exact: true }).click();
  await expect.poll(() => fs.existsSync(path.join(area.path, 'Nova ideia.md'))).toBe(true);
  await expect(page.frameLocator('iframe.block-editor:not([hidden])').locator('#title')).toHaveText(
    'Nova ideia',
  );
  expect(errors).toEqual([]);
});
test('pastas, mover e renomear trabalham no disco; conflitos preservam ambas as versões', async () => {
  await page.getByRole('button', { name: 'Nova pasta', exact: true }).click();
  await page.getByLabel('Nome da pasta', { exact: true }).fill('Referências');
  await page.getByRole('button', { name: 'Criar', exact: true }).click();
  await page.locator('.file-tree [data-path="Ideia.md"]').click();
  await expect(
    page.frameLocator('iframe.block-editor:not([hidden])').locator('#page .edit').last(),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Ações de Ideia.md', exact: true }).click();
  await page
    .locator('.file-context')
    .getByRole('button', { name: 'Renomear', exact: true })
    .click();
  await page.getByLabel('Nome', { exact: true }).fill('Renomeada.md');
  await page.getByRole('button', { name: 'Renomear', exact: true }).click();
  await expect.poll(() => fs.existsSync(path.join(area.path, 'Renomeada.md'))).toBe(true);
  await page.getByRole('button', { name: 'Ações de Renomeada.md', exact: true }).click();
  await page.getByRole('button', { name: 'Mover para…', exact: true }).click();
  await page.getByLabel('Pasta de destino', { exact: true }).selectOption('Referências');
  await page.getByRole('button', { name: 'Mover', exact: true }).click();
  const moved = path.join(area.path, 'Referências', 'Renomeada.md');
  await expect.poll(() => fs.existsSync(moved)).toBe(true);
  const edit = page.frameLocator('iframe.block-editor:not([hidden])').locator('#page .edit').last();
  await expect(edit).toBeVisible();
  await edit.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Local');
  fs.writeFileSync(moved, 'Externa preservada.\n');
  await expect(page.locator('.note-conflict')).toContainText('mudou fora', { timeout: 10000 });
  expect(fs.readFileSync(moved, 'utf8')).toBe('Externa preservada.\n');
  await page.getByRole('button', { name: 'Salvar cópia da edição local', exact: true }).click();
  await expect
    .poll(() => fs.readdirSync(path.dirname(moved)).some((n) => n.includes('(cópia')))
    .toBe(true);
  expect(fs.readFileSync(moved, 'utf8')).toBe('Externa preservada.\n');
  expect(errors).toEqual([]);
});
test('propriedades do motor persistem no MD e o dashboard volta sem perder a nota', async () => {
  await page.locator('.file-tree [data-path="Ideia.md"]').click();
  const frame = page.frameLocator('iframe.block-editor:not([hidden])');
  await expect(frame.locator('#title')).toHaveText('Ideia');
  await frame.locator('.page-options > summary').click();
  await frame.getByRole('button', { name: '☺ Adicionar ícone', exact: true }).click();
  await frame.getByRole('button', { name: 'Usar ícone 🌿', exact: true }).click();
  await frame.locator('.page-options > summary').click();
  await frame.locator('.note-details > summary').click();
  await frame.getByRole('button', { name: '+ Adicionar propriedade', exact: true }).click();
  await frame.getByLabel('Nome', { exact: true }).fill('Status');
  await frame.getByLabel('Tipo', { exact: true }).selectOption('text');
  await frame.getByRole('button', { name: 'Salvar propriedade', exact: true }).click();
  await frame.getByLabel('Status', { exact: true }).fill('Rascunho');
  await frame.getByLabel('Status', { exact: true }).blur();
  await expect
    .poll(() => fs.readFileSync(path.join(area.path, 'Ideia.md'), 'utf8'))
    .toContain('Rascunho');
  await page.locator('.file-tree [data-path="Segunda.md"]').click();
  await page.locator('.file-tree [data-path="Ideia.md"]').click();
  await expect(
    page.frameLocator('iframe.block-editor:not([hidden])').locator('#pageIcon'),
  ).toHaveText('🌿');
  await expect(
    page.frameLocator('iframe.block-editor:not([hidden])').getByLabel('Status', { exact: true }),
  ).toHaveValue('Rascunho');
  await page
    .getByRole('button', { name: 'Alternar entre o editor visual e o Markdown', exact: true })
    .click();
  await expect(page.getByLabel('Código Markdown')).toHaveValue(/notas1_editor:/);
  await page.getByRole('button', { name: 'Voltar às estantes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Mundo de teste', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
test('wikilinks navegam para seções, exibem backlinks e criam nota inexistente', async () => {
  fs.writeFileSync(
    path.join(area.path, 'Ideia.md'),
    'Veja [[Segunda#Detalhes|abrir detalhes]] e [[Nova Nota]].\n\n[Outra referência](Segunda.md#Detalhes)\n',
  );
  fs.writeFileSync(path.join(area.path, 'Segunda.md'), '# Detalhes\n\nConteúdo do destino.\n');
  await page.locator('.file-tree [data-path="Ideia.md"]').press('Enter');
  await page
    .frameLocator('iframe.block-editor:not([hidden])')
    .getByRole('link', { name: 'abrir detalhes', exact: true })
    .click();
  await expect(page.frameLocator('iframe.block-editor:not([hidden])').locator('#title')).toHaveText(
    'Segunda',
  );
  await expect(
    page.frameLocator('iframe.block-editor:not([hidden])').locator('.link-jump'),
  ).toContainText('Detalhes');
  await expect(page.locator('.note-backlinks')).toContainText('Referências (1)', {
    timeout: 12000,
  });
  await page.locator('.note-backlinks > summary').click();
  await page
    .getByRole('button', { name: 'Abrir referência em Ideia.md', exact: true })
    .press('Enter');
  await expect(page.frameLocator('iframe.block-editor:not([hidden])').locator('#title')).toHaveText(
    'Ideia',
  );
  await page
    .frameLocator('iframe.block-editor:not([hidden])')
    .getByRole('link', { name: 'Nova Nota', exact: true })
    .click();
  await page.getByRole('button', { name: 'Criar e abrir', exact: true }).press('Enter');
  await expect.poll(() => fs.existsSync(path.join(area.path, 'Nova Nota.md'))).toBe(true);
  await expect(page.frameLocator('iframe.block-editor:not([hidden])').locator('#title')).toHaveText(
    'Nova Nota',
  );
  expect(errors).toEqual([]);
});
test('digitar dois colchetes sugere notas e salva wikilink nativo', async () => {
  await page.locator('.file-tree [data-path="Ideia.md"]').press('Enter');
  const frame = page.frameLocator('iframe.block-editor:not([hidden])');
  await expect(frame.locator('#page .edit').last()).toBeVisible();
  await frame.locator('#page .edit').last().fill('[[Seg');
  await expect(frame.getByRole('listbox', { name: 'Vincular nota' })).toBeVisible();
  await frame.getByRole('option').filter({ hasText: 'Segunda.md' }).click();
  await expect(frame.locator('#page a.internal-link')).toHaveText('Segunda');
  await expect
    .poll(() => fs.readFileSync(path.join(area.path, 'Ideia.md'), 'utf8'))
    .toContain('[[Segunda]]');
  await expect
    .poll(() => fs.readFileSync(path.join(area.path, 'Ideia.md'), 'utf8'))
    .not.toContain('\\[\\[');
  expect(errors).toEqual([]);
});
test('alias digitado permanece no Markdown e renomear atualiza links de notas abertas', async () => {
  await page.locator('.file-tree [data-path="Ideia.md"]').press('Enter');
  const frame = page.frameLocator('iframe.block-editor:not([hidden])');
  await expect(frame.locator('#page .edit').last()).toBeVisible();
  await frame.locator('#page .edit').last().fill('Veja [[Segunda|apelido]]');
  await expect(frame.getByRole('link', { name: 'apelido', exact: true })).toBeVisible();
  await expect
    .poll(() => fs.readFileSync(path.join(area.path, 'Ideia.md'), 'utf8'))
    .toContain('[[Segunda|apelido]]');
  await page.locator('.file-tree [data-path="Segunda.md"]').press('Enter');
  await page.getByRole('button', { name: 'Ações de Segunda.md', exact: true }).press('Enter');
  await page
    .locator('.file-context')
    .getByRole('button', { name: 'Renomear', exact: true })
    .press('Enter');
  await page.getByLabel('Nome', { exact: true }).fill('Destino.md');
  await page.getByRole('button', { name: 'Renomear', exact: true }).press('Enter');
  await expect
    .poll(() => fs.readFileSync(path.join(area.path, 'Ideia.md'), 'utf8'))
    .toContain('[[Destino|apelido]]');
  await page.locator('.file-tree [data-path="Ideia.md"]').press('Enter');
  await page
    .frameLocator('iframe.block-editor:not([hidden])')
    .getByRole('link', { name: 'apelido', exact: true })
    .click();
  await expect(page.frameLocator('iframe.block-editor:not([hidden])').locator('#title')).toHaveText(
    'Destino',
  );
  expect(errors).toEqual([]);
});
test('Ctrl com mouse sobre link exibe prévia somente leitura e soltar fecha', async () => {
  fs.writeFileSync(path.join(area.path, 'Ideia.md'), 'Veja [[Segunda]].\n');
  fs.writeFileSync(
    path.join(area.path, 'Segunda.md'),
    '# Destino\n\nConteúdo para espiar sem abrir.\n',
  );
  await page.locator('.file-tree [data-path="Ideia.md"]').press('Enter');
  const frame = page.frameLocator('iframe.block-editor:not([hidden])');
  const link = frame.getByRole('link', { name: 'Segunda', exact: true });
  await expect(link).toBeVisible();
  await link.hover();
  await page.keyboard.down('Control');
  const preview = frame.getByRole('dialog', { name: 'Prévia da nota', exact: true });
  await expect(preview).toBeVisible();
  await expect(preview).toContainText('Conteúdo para espiar sem abrir.');
  await expect(frame.locator('#title')).toHaveText('Ideia');
  await expect(page.locator('.note-tab')).toHaveCount(1);
  await page.keyboard.up('Control');
  await expect(preview).toBeHidden();
  expect(fs.readFileSync(path.join(area.path, 'Segunda.md'), 'utf8')).toBe(
    '# Destino\n\nConteúdo para espiar sem abrir.\n',
  );
  expect(errors).toEqual([]);
});
test('comando /link abre o seletor de notas e insere link nativo', async () => {
  await page.locator('.file-tree [data-path="Ideia.md"]').press('Enter');
  const frame = page.frameLocator('iframe.block-editor:not([hidden])');
  const edit = frame.locator('#page .edit').last();
  await expect(edit).toBeVisible();
  await edit.fill('/link');
  await expect(frame.locator('#menu')).toContainText('Link para nota');
  await page.keyboard.press('Enter');
  await expect(frame.getByRole('listbox', { name: 'Vincular nota' })).toBeVisible();
  await frame.getByRole('option').filter({ hasText: 'Segunda.md' }).click();
  await expect(frame.getByRole('link', { name: 'Segunda', exact: true })).toBeVisible();
  await expect
    .poll(() => fs.readFileSync(path.join(area.path, 'Ideia.md'), 'utf8'))
    .toContain('[[Segunda]]');
  expect(errors).toEqual([]);
});
