const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

async function open(body) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-writing-'));
  fs.mkdirSync(path.join(root, '.sophy'));
  fs.writeFileSync(path.join(root, 'Nota.md'), body);
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-writing-data-'));
  const env = { ...process.env, NODE_OPTIONS: '--experimental-strip-types' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    args: ['.', '--test-user-data=' + data, '--biblioteca=' + root],
    env,
  });
  const page = await app.firstWindow();
  await page.locator('#arvore [data-open="Nota.md"]').click();
  const readRaw = () => fs.readFileSync(path.join(root, 'Nota.md'), 'utf8');
  const read = () => readRaw().replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
  return { app, page, read, readRaw };
}

async function select(page, first, from, last = first, to = from) {
  await page.evaluate(
    ({ first, from, last, to }) => {
      const edits = [...document.querySelectorAll('#coluna [data-block][contenteditable="true"]')];
      const point = (el, offset) => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          if (offset <= node.length) return [node, offset];
          offset -= node.length;
        }
        return [el, el.childNodes.length];
      };
      edits[first].focus();
      getSelection().setBaseAndExtent(...point(edits[first], from), ...point(edits[last], to));
    },
    { first, from, last, to },
  );
}

async function dispose(app) {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
}

test('Enter divide texto formatado sem expor asteriscos', async () => {
  const { app, page, read } = await open('**abcdef**\n');
  try {
    await select(page, 0, 3);
    await page.keyboard.press('Enter');
    await expect(page.locator('.bloco--texto strong')).toHaveText(['abc', 'def']);
    await expect.poll(read).toBe('**abc**\n\n**def**\n');
  } finally {
    await dispose(app);
  }
});

test('Enter substitui a seleção antes de dividir o parágrafo', async () => {
  const { app, page, read } = await open('abcDEFghi\n');
  try {
    await select(page, 0, 3, 0, 6);
    await page.keyboard.press('Enter');
    await expect.poll(read).toBe('abc\n\nghi\n');
  } finally {
    await dispose(app);
  }
});

test('negrito sem seleção atua na digitação e pode ser desligado', async () => {
  const { app, page, read } = await open('Texto\n');
  try {
    await select(page, 0, 5);
    await page.keyboard.press('Control+b');
    await page.keyboard.type(' forte');
    await page.keyboard.press('Control+b');
    await page.keyboard.type(' normal');
    await expect.poll(read).toContain('Texto **forte** normal');
    await expect(page.locator('.bloco--texto')).not.toContainText('**');
  } finally {
    await dispose(app);
  }
});

test('formatação aninhada e repetir o atalho removem somente a marca escolhida', async () => {
  const { app, page, read } = await open('**texto forte**\n');
  try {
    await select(page, 0, 6, 0, 11);
    await page.keyboard.press('Control+i');
    await expect(page.locator('strong em')).toHaveText('forte');
    await select(page, 0, 6, 0, 11);
    await page.keyboard.press('Control+i');
    await expect.poll(read).toBe('**texto forte**\n');
  } finally {
    await dispose(app);
  }
});

test('seleção parcial entre blocos pode ser substituída e desfeita', async () => {
  const { app, page, read } = await open('**Primeiro**\n\nMeio\n\n*Ultimo*\n');
  try {
    await select(page, 0, 3, 2, 3);
    await page.keyboard.type('X');
    await expect(page.locator('.bloco--texto')).toHaveCount(1);
    await expect(page.locator('.bloco--texto')).toHaveText('PriXimo');
    await page.keyboard.press('Control+z');
    await expect(page.locator('.bloco--texto')).toHaveCount(3);
    await expect.poll(read).toContain('Meio');
  } finally {
    await dispose(app);
  }
});

test('Backspace no início do título vira parágrafo sem juntar a nota anterior', async () => {
  const { app, page, read } = await open('Antes\n\n## Titulo\n');
  try {
    await select(page, 1, 0);
    await page.keyboard.press('Backspace');
    await expect.poll(read).toBe('Antes\n\nTitulo\n');
  } finally {
    await dispose(app);
  }
});

test('Enter e Tab dentro do código continuam dentro da cerca', async () => {
  const { app, page, read } = await open('```js\nabc\n```\n');
  try {
    await select(page, 0, 3);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    await page.keyboard.type('def');
    await expect.poll(read).toContain('```js\nabc\n  def\n```');
    await expect(page.locator('.bloco--codigo')).toHaveCount(1);
  } finally {
    await dispose(app);
  }
});

test('Tab e Enter navegam na tabela mantendo o alinhamento', async () => {
  const { app, page, read } = await open('| A | B |\n| :--- | ---: |\n| C | D |\n');
  try {
    await page.locator('td[data-cell="0:0"]').click();
    await page.keyboard.press('Tab');
    await expect(page.locator('td[data-cell="0:1"]')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('td[data-cell="1:1"]')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('td[data-cell="2:0"]')).toBeFocused();
    await expect.poll(read).toContain('| :--- | ---: |');
  } finally {
    await dispose(app);
  }
});

test('Ctrl+D duplica o bloco e mantém o desfazer isolado', async () => {
  const { app, page } = await open('Duplicar\n');
  try {
    await select(page, 0, 4);
    await page.keyboard.press('Control+d');
    await expect(page.locator('.bloco--texto')).toHaveText(['Duplicar', 'Duplicar']);
    await page.keyboard.press('Control+z');
    await expect(page.locator('.bloco--texto')).toHaveCount(1);
  } finally {
    await dispose(app);
  }
});

test('colar HTML conserva texto, negrito e listas sem executar conteúdo', async () => {
  const { app, page, read } = await open('Inicio\n');
  try {
    await select(page, 0, 6);
    await page.locator('.bloco--texto').evaluate((el) => {
      const data = new DataTransfer();
      data.setData('text/plain', ' rico\nitem');
      data.setData(
        'text/html',
        '<p> <strong>rico</strong></p><ul><li>item</li></ul><script>window.pasteExecuted=true</script>',
      );
      el.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
      );
    });
    await expect(page.locator('.bloco--texto strong')).toHaveText('rico');
    await expect(page.locator('.bloco--item')).toHaveText('item');
    await expect.poll(read).toContain('**rico**');
    expect(await page.evaluate(() => window.pasteExecuted)).toBeUndefined();
  } finally {
    await dispose(app);
  }
});

test('nota vazia aceita escrita e desfazer sem mudar o frontmatter', async () => {
  const { app, page, read, readRaw } = await open('---\ntags: [teste]\n---\n');
  try {
    await page.locator('.bloco--texto').click();
    await page.keyboard.insertText('Ação e coração 🌿');
    await expect.poll(read).toContain('Ação e coração 🌿');
    expect(readRaw()).toContain('tags: [teste]');
    await page.keyboard.press('Control+z');
    await expect(page.locator('.bloco--texto')).toHaveText('');
  } finally {
    await dispose(app);
  }
});

test('texto-guia desaparece assim que o primeiro caractere é digitado', async () => {
  const { app, page } = await open('\n');
  try {
    const block = page.locator('.bloco--texto');
    await expect(block).toHaveAttribute('data-placeholder', 'Digite / para comandos');
    await block.click();
    await page.keyboard.insertText('A');
    await expect(block).not.toHaveAttribute('data-placeholder');
    await expect(block).not.toHaveAttribute('data-dica');
    await expect.poll(() => block.evaluate((el) => getComputedStyle(el, '::before').content)).toBe('none');
  } finally {
    await dispose(app);
  }
});

test('colar sobre seleção entre blocos é uma única ação de desfazer', async () => {
  const { app, page, read } = await open('Primeiro\n\nSegundo\n');
  try {
    await select(page, 0, 3, 1, 3);
    await page.locator('.bloco--texto').first().evaluate((el) => {
      const data = new DataTransfer();
      data.setData('text/plain', 'X');
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    });
    await expect.poll(read).toBe('PriXundo\n');
    await page.keyboard.press('Control+z');
    await expect.poll(read).toBe('Primeiro\n\nSegundo\n');
  } finally {
    await dispose(app);
  }
});

test('Shift+Enter cria quebra suave que permanece após reabrir a nota', async () => {
  const { app, page, read } = await open('Primeira\n');
  try {
    await select(page, 0, 8);
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('Segunda');
    await expect.poll(read).toContain('Primeira  \nSegunda');
    await page.evaluate(() => openNote('Nota.md', { force: true }));
    await expect(page.locator('.bloco--texto')).toHaveCount(1);
    await expect(page.locator('.bloco--texto br')).toHaveCount(1);
  } finally {
    await dispose(app);
  }
});

test('formatação atua na ocorrência selecionada, mesmo com palavras iguais', async () => {
  const { app, page, read } = await open('uma uma\n');
  try {
    await select(page, 0, 4, 0, 7);
    await page.getByRole('button', { name: 'Negrito', exact: true }).click();
    await expect.poll(read).toBe('uma **uma**\n');
  } finally {
    await dispose(app);
  }
});

test('item aninhado vazio sai um nível antes de virar parágrafo', async () => {
  const { app, page, read } = await open('- Pai\n  - Filho\n');
  try {
    await select(page, 1, 5);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await expect.poll(read).toContain('- Pai\n  - Filho\n- ');
    await page.keyboard.press('Enter');
    await expect(page.locator('.bloco--texto')).toHaveCount(1);
  } finally {
    await dispose(app);
  }
});

test('menu de blocos oferece os seis níveis de título e aceita Tab', async () => {
  const { app, page, read } = await open('Texto\n');
  try {
    await select(page, 0, 5);
    await page.keyboard.press('Enter');
    await page.keyboard.type('/h6');
    await page.keyboard.press('Tab');
    await page.keyboard.type('Subtitulo');
    await expect(page.locator('h6')).toHaveText('Subtitulo');
    await expect.poll(read).toContain('###### Subtitulo');
  } finally {
    await dispose(app);
  }
});

test('composição de texto não converte o bloco durante a digitação', async () => {
  const { app, page, read } = await open('Antes\n');
  try {
    await page.locator('.bloco--texto').evaluate((el) => {
      el.focus();
      el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      el.textContent = 'Antes **composto**';
      el.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          isComposing: true,
          inputType: 'insertCompositionText',
        }),
      );
    });
    await expect(page.locator('.bloco--texto strong')).toHaveCount(0);
    await page
      .locator('.bloco--texto')
      .evaluate((el) =>
        el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })),
      );
    await expect.poll(read).toContain('**composto**');
    await expect(page.locator('.bloco--texto strong')).toHaveText('composto');
  } finally {
    await dispose(app);
  }
});

test('arrastar seleção entre parágrafos permite substituir apenas o trecho', async () => {
  const { app, page } = await open('Primeiro\n\nUltimo\n');
  try {
    const bounds = await page.locator('.bloco--texto').evaluateAll((edits) =>
      edits.map((el) => {
        const rect = el.getBoundingClientRect();
        return { x: rect.left + 25, y: rect.top + rect.height / 2 };
      }),
    );
    await page.mouse.move(bounds[0].x, bounds[0].y);
    await page.mouse.down();
    await page.mouse.move(bounds[1].x, bounds[1].y, { steps: 12 });
    await page.mouse.up();
    expect(
      await page.evaluate(() => Writing.selection()?.first !== Writing.selection()?.last),
    ).toBe(true);
    await page.keyboard.type('X');
    await expect(page.locator('.bloco--texto')).toHaveCount(1);
    await expect(page.locator('.bloco--texto')).toContainText('X');
  } finally {
    await dispose(app);
  }
});

test('copiar seleção entre título e texto exclui controles e metadados', async () => {
  const { app, page } = await open('# Titulo\n\nParagrafo\n');
  try {
    await select(page, 0, 0, 1, 9);
    const copied = await page.evaluate(() => {
      const data = new DataTransfer();
      document.dispatchEvent(
        new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }),
      );
      return data.getData('text/plain');
    });
    expect(copied).toBe('Titulo\n\nParagrafo');
    expect(copied).not.toContain('Conexões');
  } finally {
    await dispose(app);
  }
});

test('realce pode ser ligado antes de digitar e desligado depois', async () => {
  const { app, page, read } = await open('Texto \n');
  try {
    await select(page, 0, 6);
    await page.keyboard.press('Control+Shift+h');
    await page.keyboard.type('Realce');
    await page.keyboard.press('Control+Shift+h');
    await page.keyboard.type(' normal');
    await expect.poll(read).toContain('==Realce== normal');
  } finally {
    await dispose(app);
  }
});

test('código na barra formata a seleção e volta ao Markdown', async () => {
  const { app, page, read } = await open('uma palavra\n');
  try {
    await select(page, 0, 4, 0, 11);
    await page.getByRole('button', { name: 'Código', exact: true }).click();
    await expect.poll(read).toBe('uma `palavra`\n');
    await expect(page.locator('.bloco--texto code')).toHaveText('palavra');
  } finally {
    await dispose(app);
  }
});

test('inserir link conserva a seleção e só abre protocolos permitidos', async () => {
  const { app, page, read } = await open('visite uma uma\n');
  try {
    await select(page, 0, 11, 0, 14);
    await page.keyboard.press('Control+l');
    await page.getByLabel('Endereço do link').fill('https://example.com/documento');
    await page.getByLabel('Endereço do link').press('Enter');
    await expect.poll(read).toBe('visite uma [uma](https://example.com/documento)\n');
    const invalid = await page.evaluate(() => sophy.openExternal('javascript:alert(1)'));
    expect(invalid.ok).toBe(false);
  } finally {
    await dispose(app);
  }
});

test('Delete no início de bloco vazio sobe para o bloco acima', async () => {
  const { app, page, read } = await open('Primeiro\n');
  try {
    const blocks = page.locator('#coluna [data-block][contenteditable="true"]');
    await blocks.first().click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await expect(blocks).toHaveCount(2);
    await page.keyboard.press('Delete');
    await expect.poll(read).toBe('Primeiro\n');
    await expect(blocks).toHaveCount(1);
  } finally {
    await dispose(app);
  }
});

test('alterar o título H1 renomeia o arquivo da nota', async () => {
  const { app, page } = await open('# Antigo\n\ncorpo\n');
  try {
    const title = page.locator('.bloco--titulo').first();
    await title.click();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('Novo nome');
    await page.locator('.bloco--texto').click();
    await expect(page.locator('#arvore [data-open="Novo nome.md"]')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('#arvore [data-open="Antigo.md"]')).toHaveCount(0);
  } finally {
    await dispose(app);
  }
});

test('opções da nota persistem aparência, propriedades, capa e saída do foco', async () => {
  const { app, page, readRaw } = await open('# Minha nota\n\nTexto de exemplo\n');
  try {
    await page.locator('#nota-mais').click();
    await page.locator('[data-note-font="mono"]').click();
    await expect(page.locator('#coluna')).toHaveClass(/nota--font-mono/);
    await expect.poll(readRaw).toContain('layout:');

    await page.locator('#nota-mais').click();
    await page.locator('#menu-properties').click();
    await page.locator('#adicionar-propriedade').click();
    await expect(page.locator('.propriedade-editor')).toBeVisible();
    const modalBox = await page.locator('.propriedade-editor').boundingBox();
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    expect(modalBox.x).toBeGreaterThanOrEqual(0);
    expect(modalBox.y).toBeGreaterThanOrEqual(0);
    expect(modalBox.x + modalBox.width).toBeLessThanOrEqual(viewport.width);
    expect(modalBox.y + modalBox.height).toBeLessThanOrEqual(viewport.height);
    await page.locator('#property-name').fill('Publicado');
    await page.locator('#property-type').selectOption('checkbox');
    await page.locator('#property-save').click();
    await expect(page.locator('.propriedade[data-property]')).toContainText('Publicado');
    await page.locator('[data-property-value]').check();
    await expect.poll(readRaw).toContain('properties:');
    await expect.poll(readRaw).toContain('value: true');

    await page.locator('#adicionar-propriedade').click();
    await page.locator('#property-name').fill('Status');
    await page.locator('#property-type').selectOption('select');
    await page.locator('#property-save').click();
    await expect(page.locator('.propriedade[data-property]')).toHaveCount(2);
    await page.locator('[data-property-picker]').click();
    await page.locator('#property-new-value').fill('Rascunho');
    await page.locator('#property-create-value').click();
    await expect(page.locator('[data-property-picker]')).toHaveText('Rascunho');
    await expect.poll(readRaw).toContain('Rascunho');

    await page.keyboard.press('Control+n');
    await page.keyboard.type('Outra nota');
    await page.locator('#nota-mais').click();
    await page.locator('#menu-properties').click();
    await page.locator('#adicionar-propriedade').click();
    await expect(page.locator('[data-property-template]', { hasText: 'Status' })).toBeVisible();
    await page.locator('[data-property-template]', { hasText: 'Status' }).click();
    await expect(page.locator('#property-name')).toHaveValue('Status');
    await expect(page.locator('#property-type')).toHaveValue('select');
    await page.locator('#property-save').click();
    await expect(page.locator('.propriedade[data-property]')).toContainText('Status');

    await page.locator('#nota-mais').click();
    await page.locator('#menu-cover').click();
    await page.locator('[data-capa="sophy:ondas"]').click();
    await expect(page.locator('#coluna .capa')).toBeVisible();

    await page.locator('#modo-foco').click();
    await expect(page.locator('#shell')).toHaveClass(/is-foco/);
    await expect(page.locator('#modo-foco')).toHaveText('Sair do foco');
    await page.locator('#modo-foco').click();
    await expect(page.locator('#shell')).not.toHaveClass(/is-foco/);
  } finally {
    await dispose(app);
  }
});
