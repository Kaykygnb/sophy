const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function makeLibrary() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-rich-ui-'));
  fs.mkdirSync(path.join(root, 'Estudos'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'Estudos', 'Cores.md'),
    [
      '# Cores',
      '',
      'Texto com <span data-cor="azul" data-fundo="amarelo">marca limpa</span> e <span data-cor="azul" style="color:red" onclick="alert(1)">sujeira</span>.',
      '',
      '> [!alerta]',
      '> Cuidado com o prazo',
      '',
      '> [!pergunta]',
      '> Por que isso?',
      '',
      '> [!tarefa]',
      '> Revisar a nota',
      '',
      '> [!dica]',
      '> Use a barra flutuante',
      '',
    ].join('\n'),
  );
  return root;
}

async function launch(root) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-rich-data-'));
  const env = { ...process.env, NODE_OPTIONS: '--experimental-strip-types' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    args: ['.', `--test-user-data=${userData}`, `--biblioteca=${root}`, '--theme=light'],
    env,
  });
  const page = await app.firstWindow();
  return { app, page };
}

test('cor, sanitização, barra e destaques', async () => {
  const root = makeLibrary();
  const file = path.join(root, 'Estudos', 'Cores.md');
  const { app, page } = await launch(root);
  try {
    await page.locator('#arvore').getByRole('button', { name: 'Cores', exact: true }).click();
    await expect(page.locator('.marca-cor--azul').first()).toBeVisible();
    await expect(page.locator('.marca-fundo--amarelo').first()).toBeVisible();
    await expect(page.locator('.bloco--callout-alerta')).toContainText('Cuidado com o prazo');
    await expect(page.locator('.bloco--callout-pergunta')).toContainText('Por que isso?');
    await expect(page.locator('.bloco--callout-tarefa')).toContainText('Revisar a nota');
    await expect(page.locator('.bloco--callout-dica')).toContainText('Use a barra flutuante');
    await expect(page.locator('.coluna')).not.toContainText('onclick');
    await expect(page.locator('[onclick]')).toHaveCount(0);

    await page.locator('.bloco--texto').first().evaluate((el) => {
      el.focus();
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (!node.textContent.includes('sujeira')) continue;
        const range = document.createRange();
        range.setStart(node, 0);
        range.setEnd(node, node.textContent.length);
        const selection = getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
        return;
      }
    });
    await expect(page.locator('.barra-formato')).toBeVisible();
    await page.locator('.barra-formato [data-cor]').click();
    await page.locator('.barra-formato__paleta [data-kind="cor"] [data-value="vermelho"]').click();
    await page.evaluate(() => saveNow());
    await expect.poll(() => fs.readFileSync(file, 'utf8')).toMatch(/data-cor="vermelho"/);
    const saved = fs.readFileSync(file, 'utf8');
    expect(saved).not.toContain('onclick');
    expect(saved).not.toContain('style=');
    expect(saved).toContain('[!alerta]');
    expect(saved).toContain('[!dica]');

    await page.locator('.bloco--texto').first().evaluate((el) => {
      el.focus();
      el.textContent = '';
      el.dispatchEvent(new InputEvent('input', { bubbles: true }));
    });
    await page.keyboard.type('/');
    await expect(page.locator('.menu--blocos')).toBeVisible();
    await page.keyboard.type('aler');
    await expect(page.locator('.menu--blocos')).toContainText('Alerta');
  } finally {
    await app.close();
  }
});
