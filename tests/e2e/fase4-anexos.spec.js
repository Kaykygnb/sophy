const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function library() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-f4-'));
  fs.mkdirSync(path.join(root, '.sophy'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Estudos'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Anexos'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Anexos', 'artigo.pdf'), '%PDF-1.4 teste\n');
  fs.writeFileSync(path.join(root, 'Anexos', 'solto.csv'), 'a,b\n1,2\n');
  fs.writeFileSync(
    path.join(root, 'Estudos', 'Leitura.md'),
    '# Leitura\n\nTexto do parágrafo.\n\n![[Anexos/artigo.pdf]]\n',
  );
  return root;
}

async function launch(root, theme = 'light') {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-f4-data-'));
  fs.writeFileSync(
    path.join(userData, 'ui.json'),
    JSON.stringify({ onboarded: true, libraryPath: root, libraries: [root], theme }),
  );
  const env = { ...process.env, NODE_OPTIONS: '--experimental-strip-types' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', `--test-user-data=${userData}`], env });
  return { app, page: await app.firstWindow() };
}

async function hasTool(page, name) {
  await page.locator('#arvore button, #arvore [role="treeitem"], #arvore a').first().waitFor();
  return page.evaluate(async (tool) => (await sophy.tool(tool, {})).code !== 'not-found', name);
}

test('anexos: seção em Configurações lista tamanho, “usado em” e órfãos', async () => {
  const { app, page } = await launch(library());
  try {
    test.skip(!(await hasTool(page, 'attachment.list')), 'precisa do PR 32 (attachment.list)');
    await page.locator('.lateral__rodape [data-nav="config"]').click();
    await page.locator('.config__nav, #config-nav, [data-secao-ir="anexos"]').first().click().catch(() => {});
    await page.evaluate(() => document.querySelector('#cfg-anexos')?.scrollIntoView());
    const items = page.locator('.anexos__item');
    await expect(items).toHaveCount(2);
    const used = items.filter({ hasText: 'artigo.pdf' });
    await expect(used).toContainText('Usado em');
    await expect(used.locator('.anexos__nota')).toHaveText('Leitura');
    await expect(used).toContainText(/\d+ (B|KB)/);
    const orphan = items.filter({ hasText: 'solto.csv' });
    await expect(orphan.locator('.anexos__selo')).toHaveText('Sem uso');
    // Abrir chama o sistema (aqui interceptado)
    await app.evaluate(({ shell }) => {
      globalThis.__aberto = null;
      shell.openPath = async (full) => {
        globalThis.__aberto = full;
        return '';
      };
    });
    await used.getByRole('button', { name: 'Abrir' }).click();
    await expect.poll(() => app.evaluate(() => globalThis.__aberto)).toMatch(/Anexos[\\/]artigo\.pdf$/);
  } finally {
    await app.close();
  }
});

test('anexos: botão Anexar, arrastar e soltar, cartão de arquivo e PDF no menu •••', async () => {
  const root = library();
  const { app, page } = await launch(root);
  try {
    await page.locator('#arvore').getByText('Leitura', { exact: true }).first().click();
    await expect(page.locator('.bloco').first()).toBeVisible();
    await expect(page.locator('#nota-anexar')).toBeVisible();

    // arquivo que não é imagem vira cartão com Abrir
    const card = page.locator('.embed--arquivo');
    if (await hasTool(page, 'attachment.list')) {
      await expect(card).toContainText('artigo.pdf');
      await expect(card.getByRole('button', { name: 'Abrir' })).toBeVisible();
    }

    // soltar um arquivo qualquer grava em Anexos/ e insere o embed
    await page.evaluate(() => {
      const target = document.querySelector('#coluna [data-block]');
      const data = new DataTransfer();
      data.items.add(new File(['conteudo'], 'planilha.txt', { type: 'text/plain' }));
      target.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }));
    });
    await expect.poll(() => fs.existsSync(path.join(root, 'Anexos', 'planilha.txt'))).toBe(true);
    await expect(page.locator('.toast').filter({ hasText: 'anexado' })).toBeVisible();
    await expect(page.locator('#coluna')).toContainText('planilha.txt');

    // menu •••: PDF habilitado, Markdown “em breve”
    await page.locator('#nota-mais').click();
    const pdf = page.getByRole('button', { name: /Exportar como PDF/ });
    await expect(pdf).toBeEnabled();
    await expect(page.getByRole('button', { name: /Exportar como Markdown/ })).toBeEnabled();
    await expect(page.locator('.nota-menu .em-breve')).toHaveCount(0);
    await app.evaluate(({ dialog }) => {
      globalThis.__salvar = 0;
      dialog.showSaveDialog = async () => {
        globalThis.__salvar += 1;
        return { canceled: true };
      };
    });
    if (await hasTool(page, 'attachment.list')) {
      await pdf.click();
      await expect.poll(() => app.evaluate(() => globalThis.__salvar), { timeout: 15000 }).toBe(1);
    }
  } finally {
    await app.close();
  }
});
