const { test, expect, _electron: electron } = require('@playwright/test');
const { makeGraphLibrary, launchArgs } = require('./grafo-biblioteca.js');

async function launch(theme = 'light') {
  const root = makeGraphLibrary('sophy-tags-cor-');
  const app = await electron.launch(launchArgs(root, theme));
  const page = await app.firstWindow();
  await expect(page.locator('#tags-painel .tags-painel__topo')).toBeVisible();
  return { app, page, root };
}

/* Mock do contrato no processo principal (o contextBridge não deixa trocar sophy.tool na página). */
async function mockContract(app, page, { cores = {}, related = {}, setError } = {}) {
  await app.evaluate(
    ({ ipcMain }, { cores: initial, related: mapa, setError: erro }) => {
      const original = ipcMain._invokeHandlers.get('sophy:tool');
      ipcMain.removeHandler('sophy:tool');
      const cores = { ...initial };
      ipcMain.handle('sophy:tool', async (event, name, input = {}) => {
        if (name === 'tag.color.get') return { ok: true, value: { ...cores } };
        if (name === 'tag.color.set') {
          if (erro) return { ok: false, code: erro.code, error: erro.error };
          const tag = String(input.tag || '')
            .replace(/^#/, '')
            .normalize('NFC')
            .toLocaleLowerCase('pt-BR');
          if (!tag) return { ok: false, code: 'tag_invalida', error: 'A tag é inválida.' };
          const cor = input.cor;
          if (cor == null || cor === '') {
            delete cores[tag];
            return { ok: true, value: { tag, cor: null } };
          }
          const named = String(cor).normalize('NFC').trim().toLocaleLowerCase('pt-BR');
          const palette = [
            'cinza',
            'marrom',
            'laranja',
            'amarelo',
            'verde',
            'azul',
            'roxo',
            'rosa',
            'vermelho',
          ];
          let saved = null;
          if (palette.includes(named)) saved = named;
          else if (/^#[0-9a-f]{6}$/i.test(String(cor).trim())) saved = String(cor).trim().toLowerCase();
          if (!saved) return { ok: false, code: 'cor_invalida', error: 'A cor é inválida.' };
          cores[tag] = saved;
          return { ok: true, value: { tag, cor: saved } };
        }
        if (name === 'tags.related') {
          const tag = String(input.tag || '')
            .replace(/^#/, '')
            .normalize('NFC')
            .toLocaleLowerCase('pt-BR');
          if (!tag) return { ok: false, code: 'tag_invalida', error: 'A tag é inválida.' };
          if (
            Object.prototype.hasOwnProperty.call(mapa, tag) ||
            Object.prototype.hasOwnProperty.call(mapa, input.tag)
          ) {
            return { ok: true, value: mapa[tag] || mapa[input.tag] };
          }
          return { ok: true, value: mapa[tag] || [] };
        }
        return original(event, name, input);
      });
    },
    { cores, related, setError },
  );
  await page.reload();
  await expect(page.locator('#tags-painel .tags-painel__topo')).toBeVisible();
}

test('mock do contrato: paleta, sem cor, aparece junto com e estado vazio', async () => {
  const { app, page } = await launch();
  try {
    await mockContract(app, page, {
      cores: { estudo: 'verde' },
      related: {
        estudo: [
          { tag: 'metodo', juntas: 3 },
          { tag: 'livro', juntas: 1 },
        ],
        metodo: [],
      },
    });
    await page.locator('#tags-painel [data-tag="estudo"]').click();
    await expect(page.locator('.etiqueta-capa .tag-selo')).toHaveText('#estudo');
    const juntas = page.locator('#tag-juntas');
    await expect(juntas.locator('[data-tag-ir="metodo"]')).toContainText('3');
    await expect(juntas.locator('[data-tag-ir="livro"]')).toContainText('1');
    await page.locator('#tag-cor').click();
    await expect(page.locator('#tag-cores [data-tag-cor="verde"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.locator('#tag-cores [data-tag-cor="roxo"]').click();
    await expect(page.locator('#tag-cores [data-tag-cor="roxo"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await juntas.locator('[data-tag-ir="metodo"]').click();
    await expect(page.locator('.etiqueta-capa .tag-selo')).toHaveText('#metodo');
    await expect(page.locator('#tag-juntas .lixeira__nota')).toContainText(
      'Nenhuma outra tag aparece nas mesmas notas',
    );
  } finally {
    await app.close();
  }
});

test('mock do contrato: cor inválida mostra aviso e não quebra a tela', async () => {
  const { app, page } = await launch();
  try {
    await mockContract(app, page, {
      cores: { estudo: 'azul' },
      related: { estudo: [{ tag: 'livro', juntas: 1 }] },
      setError: { code: 'cor_invalida', error: 'A cor é inválida.' },
    });
    await page.locator('#tags-painel [data-tag="estudo"]').click();
    await expect(page.locator('.etiqueta-capa .tag-selo')).toHaveText('#estudo');
    await page.locator('#tag-cor').click();
    await page.locator('#tag-cores [data-tag-cor="vermelho"]').click();
    await expect(page.locator('.toast--erro')).toContainText('Essa cor não é válida');
    await expect(page.locator('.etiqueta-capa .tag-selo')).toHaveText('#estudo');
    await expect(page.locator('#tag-cores')).toBeVisible();
  } finally {
    await app.close();
  }
});
