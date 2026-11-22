const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function makeLibrary() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-codigo-ui-'));
  fs.mkdirSync(path.join(root, 'Estudos'), { recursive: true });
  const note = [
    '# Código',
    '',
    '```ts',
    'const pronto = true;',
    '// ! cuidado',
    '// ? porque',
    '// TODO depois',
    '// * nota',
    '/* * bloco */',
    '-- ? sql',
    '```',
    '',
    '```linguagem-que-nao-existe',
    'echo ok',
    '# ! shell',
    '```',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(root, 'Estudos', 'Codigo.md'), note);
  fs.writeFileSync(path.join(root, 'Estudos', 'Outra.md'), '# Outra\n\nTexto.\n');
  return root;
}

async function launch(root) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-codigo-data-'));
  const env = { ...process.env, NODE_OPTIONS: '--experimental-strip-types' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    args: ['.', `--test-user-data=${userData}`, `--biblioteca=${root}`, '--theme=light'],
    env,
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return { app, page, errors };
}

test('linguagem da cerca, linguagem desconhecida e comentários só na tela', async () => {
  const root = makeLibrary();
  const file = path.join(root, 'Estudos', 'Codigo.md');
  const before = fs.readFileSync(file, 'utf8');
  const { app, page, errors } = await launch(root);
  try {
    await page.locator('#arvore').getByRole('button', { name: 'Codigo', exact: true }).click();
    await expect(page.locator('.codigo__lingua').nth(0)).toHaveText('TypeScript');
    await expect(page.locator('.codigo__lingua').nth(1)).toHaveText('linguagem-que-nao-existe');
    await expect(page.locator('pre.bloco--codigo').nth(1)).toContainText('echo ok');
    await expect
      .poll(() => fs.readFileSync(file, 'utf8').replace(/^---\n(?:.*\n)*?---\n/, ''))
      .toBe(before.replace(/^---\n(?:.*\n)*?---\n/, ''));
    await expect.poll(() => fs.readFileSync(file, 'utf8')).toMatch(/^---\nid: /);

    await expect(page.locator('.codigo-marca--alerta').first()).toBeAttached();
    await expect(page.locator('.codigo-marca--duvida').first()).toBeAttached();
    await expect(page.locator('.codigo-marca--todo').first()).toBeAttached();
    await expect(page.locator('.codigo-marca--nota').first()).toBeAttached();
    await expect(page.locator('.codigo__realce .token.keyword').first()).toBeAttached();

    const colors = await page.evaluate(() => {
      const sample = (theme) => {
        document.documentElement.dataset.theme = theme;
        const mark = document.querySelector('.codigo-marca--alerta');
        const probe = document.createElement('i');
        probe.style.color = 'var(--danger)';
        document.body.append(probe);
        const markColor = getComputedStyle(mark).color;
        const token = getComputedStyle(probe).color;
        probe.remove();
        return { markColor, same: markColor === token };
      };
      const light = sample('light');
      const dark = sample('dark');
      document.documentElement.dataset.theme = 'light';
      return { light, dark };
    });
    expect(colors.light.same).toBe(true);
    expect(colors.dark.same).toBe(true);
    expect(colors.light.markColor).not.toBe(colors.dark.markColor);

    await page.locator('.codigo__lingua').nth(0).click();
    await page.locator('.codigo-linguas__busca').fill('Python');
    await page.getByRole('option', { name: 'Python', exact: true }).click();
    await page.evaluate(() => saveNow());
    await expect.poll(() => fs.readFileSync(file, 'utf8')).toMatch(/```py\n/);
    let saved = fs.readFileSync(file, 'utf8');
    expect(saved).toContain('// ! cuidado');
    expect(saved).toContain('// ? porque');
    expect(saved).toContain('// TODO depois');
    expect(saved).toContain('// * nota');
    expect(saved).toContain('```linguagem-que-nao-existe');
    expect(saved).not.toContain('codigo-marca');
    expect(saved).not.toContain('<span');

    await page.locator('pre.bloco--codigo').nth(0).evaluate((el) => {
      el.focus();
      const node = el.firstChild;
      const range = document.createRange();
      range.setStart(node, node.textContent.indexOf('true;') + 'true;'.length);
      range.collapse(true);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    });
    await page.keyboard.press('Enter');
    await page.keyboard.type('// ! fim');
    await page.evaluate(() => saveNow());
    saved = fs.readFileSync(file, 'utf8');
    expect(saved).toContain('// ! fim');
    expect(saved).toContain('```py\n');
    expect(saved).not.toContain('codigo-marca');
    expect(saved).not.toContain('<span');

    const withComment = fs.readFileSync(file, 'utf8');
    await page.locator('[data-code-lines]').first().click();
    await expect(page.locator('.codigo--linhas').first()).toBeVisible();
    await expect(page.locator('.codigo__nums').first()).toBeVisible();
    expect(fs.readFileSync(file, 'utf8')).toBe(withComment);

    await page.locator('[data-code-copy]').first().click();
    await expect(page.locator('.toast')).toContainText('Copiado');

    await page.locator('#arvore').getByRole('button', { name: 'Outra', exact: true }).click();
    await page.locator('#arvore').getByRole('button', { name: 'Codigo', exact: true }).click();
    await expect(page.locator('.codigo__lingua').nth(0)).toHaveText('Python');
    await expect(page.locator('.codigo__lingua').nth(1)).toHaveText('linguagem-que-nao-existe');
    await expect(page.locator('pre.bloco--codigo').nth(0)).toContainText('// ! fim');
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
