const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function library() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-revisao-'));
  fs.mkdirSync(path.join(root, '.sophy'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Estudos'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Trabalho'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'Estudos', 'Leitura.md'),
    '# Leitura\n\nTexto com <span data-cor="azul">cor</span>.\n\nCapital da França :: Paris\n',
  );
  fs.writeFileSync(
    path.join(root, 'Trabalho', 'Plano.md'),
    '# Plano\n\n- [ ] enviar a proposta revisada para o cliente 📅 2026-11-21 ⏫\n',
  );
  return root;
}

async function launch(root, theme = 'light') {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-revisao-data-'));
  fs.writeFileSync(
    path.join(userData, 'ui.json'),
    JSON.stringify({ onboarded: true, libraryPath: root, libraries: [root], theme }),
  );
  const env = { ...process.env, NODE_OPTIONS: '--experimental-strip-types' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', `--test-user-data=${userData}`], env });
  return { app, page: await app.firstWindow() };
}

test('Flashcards e Sofi têm entrada visível', async () => {
  const root = library();
  const { app, page } = await launch(root);
  const nav = page.locator('[data-nav="cartas"]');
  await expect(nav).toBeVisible();
  await expect(nav).toContainText('Flashcards');
  await nav.click();
  await expect(nav).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.fc-revisao')).toBeVisible();
  await expect(page.locator('#carta-virar')).toContainText('Mostrar resposta');
  await page.keyboard.press('Space');
  await expect(page.locator('.fc-revisao')).toHaveAttribute('data-lado', 'verso');
  await expect(page.locator('#carta-virar')).toContainText('Ver pergunta');

  const sofi = page.locator('#abrir-sofi');
  await expect(sofi).toBeVisible();
  await expect(sofi).toContainText('Sofi');
  await page.locator('[data-nav="inicio"]').click();
  await sofi.click();
  await expect(page.locator('#sofi-mascote')).toBeVisible();
  await expect(sofi).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#agente-fechar').click();
  await expect(sofi).toHaveAttribute('aria-pressed', 'false');
  await app.close();
});

test('página filha abre o diálogo do app, sem prompt()', async () => {
  const root = library();
  const { app, page } = await launch(root);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.locator('#arvore').getByRole('button', { name: 'Leitura', exact: true }).click();
  const last = page.locator('.bloco--texto').last();
  await last.click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/pág');
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Nova página filha' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Nome da página').fill('Resumo');
  await dialog.getByRole('button', { name: 'Criar página' }).click();
  await expect(dialog).toBeHidden();
  await expect
    .poll(() => fs.existsSync(path.join(root, 'Estudos', 'Leitura', 'Resumo.md')))
    .toBe(true);
  await expect(page.locator('.toast--erro')).toHaveCount(0);
  expect(errors.join('\n')).not.toContain('prompt');
  await app.close();
});

test('cartão de tarefa mantém o título numa linha legível', async () => {
  const root = library();
  const { app, page } = await launch(root);
  await page.locator('[data-nav="tarefas"]').click();
  const card = page.locator('.kcard', { hasText: 'enviar a proposta' }).first();
  await expect(card).toBeVisible();
  const box = await card.locator('.kcard__titulo').boundingBox();
  expect(box.width).toBeGreaterThan(120);
  expect(box.height).toBeLessThan(48);
  const chip = page.locator('button.chip').first();
  const border = await chip.evaluate((el) => getComputedStyle(el).borderTopStyle);
  expect(border).toBe('solid');
  await app.close();
});
