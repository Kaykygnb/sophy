const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function library() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-fase2-'));
  fs.mkdirSync(path.join(root, '.sophy'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Estudos'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Trabalho'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'Estudos', 'Leitura.md'),
    '# Leitura\n\nTexto do parágrafo.\n\n## Conceitos\n\nMais texto.\n\n```js\nconst a = 1;\n```\n',
  );
  fs.writeFileSync(
    path.join(root, 'Trabalho', 'Plano.md'),
    '# Plano\n\n- [ ] enviar a proposta revisada para o cliente 📅 2026-11-21 ⏫\n',
  );
  return root;
}

async function launch(root, theme = 'light') {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-fase2-data-'));
  fs.writeFileSync(
    path.join(userData, 'ui.json'),
    JSON.stringify({ onboarded: true, libraryPath: root, libraries: [root], theme }),
  );
  const env = { ...process.env, NODE_OPTIONS: '--experimental-strip-types' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', `--test-user-data=${userData}`], env });
  return { app, page: await app.firstWindow() };
}

test('Configurações é uma tela com seções e itens "em breve"', async () => {
  const { app, page } = await launch(library());
  const errors = [];
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  const entry = page.locator('.lateral__rodape [data-nav="config"]');
  await expect(entry).toBeVisible();
  await entry.click();
  await expect(entry).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { name: 'Configurações' })).toBeVisible();
  await expect(page.locator('#overlay')).toBeHidden();
  for (const name of ['Geral', 'Aparência', 'Editor', 'Bibliotecas', 'Sofi e IA', 'Atalhos', 'Sobre']) {
    await expect(page.locator('.config__nav').getByRole('button', { name })).toBeVisible();
  }
  await page.locator('[data-cfg-secao="sofi"]').click();
  await expect(page.locator('#cfg-sofi')).toBeInViewport();
  await expect(page.locator('#cfg-sofi .em-breve').first()).toBeVisible();
  await expect(page.locator('#cfg-sofi button[disabled]').first()).toBeVisible();
  await expect(page.locator('.config__atalhos')).toContainText('Ctrl');
  await page.locator('[data-cfg-secao="aparencia"]').click();
  await page.locator('#cfg-motion').check();
  await expect(page.locator('html')).toHaveClass(/motion-reduce/);
  expect(errors).toEqual([]);
  await app.close();
});

test('editor: títulos alinhados, + visível, linguagem como botão e exportar "em breve"', async () => {
  const { app, page } = await launch(library());
  await page.locator('#arvore').getByText('Leitura', { exact: true }).first().click();
  const heading = page.locator('h2.bloco--titulo', { hasText: 'Conceitos' });
  const paragraph = page.locator('.bloco--texto', { hasText: 'Mais texto' });
  await expect(heading).toBeVisible();
  const [h, p] = [await heading.boundingBox(), await paragraph.boundingBox()];
  expect(Math.abs(h.x - p.x)).toBeLessThan(2);
  await paragraph.click();
  await expect(page.locator('.bloco-linha:focus-within .bloco__mais')).toBeVisible();
  await expect(page.locator('.codigo__lingua')).toHaveText('JavaScript');
  await expect(page.locator('.codigo__lingua use').last()).toHaveAttribute('href', '#i-chevron-baixo');
  await expect(page.locator('#nota-filha')).toContainText('Página filha');
  await expect(page.locator('#nota-adicionar')).toBeVisible();
  await page.locator('#nota-mais').click();
  const pdf = page.locator('.nota-menu .menu__item', { hasText: 'Exportar como PDF' });
  const md = page.locator('.nota-menu .menu__item', { hasText: 'Exportar como Markdown' });
  await expect(pdf).toBeDisabled();
  await expect(md).toBeDisabled();
  await expect(pdf).toContainText('em breve');
  await app.close();
});

test('ícones animados entram sem poluir o texto e respeitam movimento reduzido', async () => {
  const { app, page } = await launch(library());
  await expect(page.locator('#novo .anim svg')).toHaveCount(1);
  await expect(page.locator('#novo')).toHaveText('Novo');
  await expect(page.locator('#anim-css')).toHaveCount(1);
  await page.locator('[data-nav="tarefas"]').click();
  await expect(page.locator('.seg-botao.is-ativa')).toHaveCount(1);
  await app.close();
});
