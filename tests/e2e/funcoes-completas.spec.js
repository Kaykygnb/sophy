const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Prints reais para o relatório: SOPHY_PRINTS=/pasta grava claro e escuro de cada tela nova.
const PRINTS = process.env.SOPHY_PRINTS || '';

function iso(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function plus(days) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return iso(date);
}

function weekDays() {
  const now = new Date();
  const shift = (now.getDay() + 6) % 7; // semana começando na segunda
  return { untilEnd: 6 - shift };
}

function library() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `sophy-funcoes-${process.pid}-`));
  fs.mkdirSync(path.join(root, 'Estudos'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Projetos'), { recursive: true });
  const { untilEnd } = weekDays();
  fs.writeFileSync(
    path.join(root, 'Estudos', 'Biologia.md'),
    `---\ncriada: 2025-01-10T10:00:00\n---\n# Biologia\n\nResumo da aula de hoje com [[Inexistente]] e [[Codigo#soma]].\n\n- [x] Ler capítulo 3 📅 ${plus(0)}\n- [ ] Entregar resumo 📅 ${plus(-10)}\n- [ ] Prova de cálculo 📅 ${plus(untilEnd + 2)}\n\nFotossíntese :: processo em que as plantas fazem energia com luz\n`,
  );
  fs.writeFileSync(
    path.join(root, 'Estudos', 'Codigo.md'),
    '# Código\n\nUm bloco com nome.\n\n```js title="soma"\nconst soma = (a, b) => a + b;\n```\n',
  );
  fs.writeFileSync(path.join(root, 'Estudos', 'Clorofila.md'), '# Clorofila\n\nPigmento verde das plantas.\n');
  fs.writeFileSync(path.join(root, 'Projetos', 'Roteiro.md'), '# Roteiro\n\nVeja [[Ideias soltas]] depois.\n\nTexto para formatar aqui.\n');
  return root;
}

async function launch(root, extra = {}) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), `sophy-funcoes-data-${process.pid}-`));
  fs.writeFileSync(
    path.join(userData, 'ui.json'),
    JSON.stringify({ onboarded: true, libraryPath: root, libraries: [root, ...(extra.libraries || [])], theme: 'light' }),
  );
  const env = { ...process.env, NODE_OPTIONS: '--experimental-strip-types' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', `--test-user-data=${userData}`], env });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.unmaximize();
    win.setResizable(true);
    win.setBounds({ x: 0, y: 0, width: 1400, height: 900 });
  });
  await expect(page.locator('#arvore')).toBeVisible();
  return { app, page };
}

async function shoot(page, name, { repaint = true } = {}) {
  if (!PRINTS) return;
  fs.mkdirSync(PRINTS, { recursive: true });
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(PRINTS, `${name}-claro.png`) });
  await page.evaluate((again) => {
    applyTheme('dark');
    if (again) paintCenter();
  }, repaint);
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(PRINTS, `${name}-escuro.png`) });
  await page.evaluate((again) => {
    applyTheme('light');
    if (again) paintCenter();
  }, repaint);
  await page.waitForTimeout(150);
}

test('Ctrl+K mistura a busca local com o selo “parecido”', async () => {
  const root = library();
  const { app, page } = await launch(root);
  await page.locator('[data-nav="config"]').click();
  await page.locator('[data-cfg-secao="bibliotecas"]').click();
  await page.locator('label:has(#cfg-busca)').click();
  await expect.poll(() => fs.existsSync(path.join(root, '.sophy', 'busca.json'))).toBeTruthy();
  await page.keyboard.press('Control+k');
  await page.locator('#paleta-q').fill('plantas cometa');
  const similar = page.locator('#paleta-lista .menu__item', { has: page.locator('.selo-parecido') });
  await expect(similar.first()).toBeVisible();
  await expect(similar.filter({ hasText: 'Clorofila' })).toHaveCount(1);
  await shoot(page, '01-ctrlk-parecido', { repaint: false });
  await similar.filter({ hasText: 'Clorofila' }).click();
  await expect(page.locator('#coluna')).toContainText('Pigmento verde');
  await app.close();
});

test('revisão da semana mostra tarefas, notas e cartões, e o sino abre a tela', async () => {
  const root = library();
  const { app, page } = await launch(root);
  await page.locator('#notificacoes').click();
  await page.locator('#notif-revisao').click();
  await expect(page.getByRole('heading', { name: 'Revisão da semana' })).toBeVisible();
  await expect(page.locator('[data-revisao="feitas"]')).toContainText('Ler capítulo 3');
  await expect(page.locator('[data-revisao="atrasadas"]')).toContainText('Entregar resumo');
  await expect(page.locator('[data-revisao="proxima"]')).toContainText('Prova de cálculo');
  await expect(page.locator('[data-revisao="criadas"]')).toContainText('Codigo');
  await expect(page.locator('[data-revisao="editadas"]')).toContainText('Biologia');
  await expect(page.locator('[data-revisao="cartoes"]')).toContainText('Fotossíntese');
  await shoot(page, '02-revisao-semana');
  await page.locator('[data-semana="-1"]').first().click();
  await expect(page.locator('.revisao-tela__rotulo')).toHaveText('Semana passada');
  await page.locator('[data-semana="-2"]').first().click();
  await expect(page.locator('.revisao-tela__rotulo')).toHaveText('2 semanas atrás');
  await page.locator('[data-semana="-3"]').first().click();
  await expect(page.locator('.revisao-tela__vazio')).toContainText('Semana tranquila');
  await shoot(page, '03-revisao-vazia');
  await page.locator('[data-semana="0"]').click();
  await page.locator('[data-revisao="atrasadas"] [data-abrir-nota]').first().click();
  await expect(page.locator('#coluna')).toContainText('Resumo da aula');
  await app.close();
});

test('Abrir biblioteca em Configurações troca a biblioteca', async () => {
  const root = library();
  const other = fs.mkdtempSync(path.join(os.tmpdir(), `sophy-funcoes-outra-${process.pid}-`));
  fs.mkdirSync(path.join(other, 'Viagens'));
  fs.writeFileSync(path.join(other, 'Viagens', 'Lisboa.md'), '# Lisboa\n');
  const { app, page } = await launch(root, { libraries: [other] });
  await page.locator('[data-nav="config"]').click();
  await page.locator('[data-cfg-secao="bibliotecas"]').click();
  const open = page.locator(`[data-abrir-lib="${other}"]`);
  await expect(open).toBeEnabled();
  await expect(page.locator('#cfg-bibliotecas .em-breve')).toHaveCount(0);
  await page.locator('#cfg-bibliotecas').scrollIntoViewIfNeeded();
  await shoot(page, '04-config-bibliotecas', { repaint: false });
  await open.click();
  await expect(page.locator('#arvore [data-open="Viagens/Lisboa.md"]')).toBeVisible();
  await expect(page.locator('.biblioteca-seletor__nome')).toHaveText(path.basename(other));
  await app.close();
});

test('links quebrados: lista por nota, abre e cria a nota faltante', async () => {
  const root = library();
  const { app, page } = await launch(root);
  await page.locator('[data-nav="config"]').click();
  await page.locator('[data-cfg-secao="bibliotecas"]').click();
  await page.locator('#cfg-quebrados').click();
  await expect(page.getByRole('heading', { name: 'Links quebrados' })).toBeVisible();
  const biology = page.locator('[data-quebrado-nota="Estudos/Biologia.md"]');
  await expect(biology).toContainText('[[Inexistente]]');
  await expect(page.locator('[data-quebrado-nota="Projetos/Roteiro.md"]')).toContainText('Ideias soltas');
  await shoot(page, '05-links-quebrados');
  await biology.locator('[data-criar-faltante]').click();
  await expect.poll(() => fs.existsSync(path.join(root, 'Estudos', 'Inexistente.md'))).toBeTruthy();
  await expect(page.locator('[data-quebrado-nota="Estudos/Biologia.md"]')).toHaveCount(0);
  await page.locator('[data-quebrado-nota="Projetos/Roteiro.md"] [data-abrir-nota="Projetos/Roteiro.md"]').click();
  await expect(page.locator('#coluna')).toContainText('Texto para formatar');
  // também pela paleta de comandos
  await page.keyboard.press('Control+Shift+P');
  await page.locator('#comando-q').fill('Links quebrados');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Links quebrados' })).toBeVisible();
  await page.locator('[data-criar-faltante]').click();
  await expect(page.locator('.quebrados__vazio')).toContainText('Nenhum link quebrado');
  await shoot(page, '06-links-quebrados-vazio');
  await app.close();
});

test('Conexões lista o histórico e desfaz uma ação do meio', async () => {
  const root = library();
  const { app, page } = await launch(root);
  await page.locator('#novo').click();
  await page.locator('[data-novo="nota"]').click();
  await page.waitForTimeout(400);
  await page.locator('#novo').click();
  await page.locator('[data-novo="nota"]').click();
  await page.waitForTimeout(400);
  await page.locator('#arvore [data-open="Projetos/Roteiro.md"]').click();
  await page.locator('#abrir-conexoes').click();
  const items = page.locator('#historico-lista .historico__item');
  await expect(items).toHaveCount(2);
  await shoot(page, '07-historico-conexoes', { repaint: false });
  const older = items.nth(1);
  const label = await older.locator('b').textContent();
  const created = label.replace(/^Criar /, '').trim();
  await older.locator('[data-desfazer-id]').click();
  await expect.poll(() => fs.existsSync(path.join(root, created))).toBeFalsy();
  await expect(page.locator('#historico-lista .historico__item')).toHaveCount(1);
  await app.close();
});

test('itens de formatação da paleta formatam o trecho selecionado', async () => {
  const root = library();
  const { app, page } = await launch(root);
  await page.locator('#arvore [data-open="Projetos/Roteiro.md"]').click();
  const select = (word) =>
    page.evaluate((needle) => {
      const block = [...document.querySelectorAll('#coluna [data-block][contenteditable="true"]')].find((el) => el.textContent.includes(needle));
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const at = node.textContent.indexOf(needle);
        if (at >= 0) {
          block.focus();
          const range = document.createRange();
          range.setStart(node, at);
          range.setEnd(node, at + needle.length);
          getSelection().removeAllRanges();
          getSelection().addRange(range);
          return true;
        }
      }
      return false;
    }, word);
  const run = async (label) => {
    await page.keyboard.press('Control+Shift+P');
    await page.locator('#comando-q').fill(label);
    await page.locator('#comando-lista .menu__item', { hasText: label }).first().click();
  };
  expect(await select('formatar')).toBe(true);
  await run('Negrito');
  await expect.poll(() => fs.readFileSync(path.join(root, 'Projetos', 'Roteiro.md'), 'utf8')).toContain('**formatar**');
  expect(await select('Texto')).toBe(true);
  await run('Itálico');
  await expect.poll(() => fs.readFileSync(path.join(root, 'Projetos', 'Roteiro.md'), 'utf8')).toMatch(/[*_]Texto[*_]/);
  // sem nota aberta, explica o que fazer
  await page.locator('[data-nav="inicio"]').click();
  await run('Riscado');
  await expect(page.getByText('Abra uma nota e selecione um trecho para formatar.')).toBeVisible();
  await app.close();
});

test('Nova pasta pelo menu Novo e pelo menu de contexto da estante', async () => {
  const root = library();
  const { app, page } = await launch(root);
  await page.locator('#novo').click();
  await expect(page.locator('[data-novo="pasta"]')).toBeVisible();
  await page.locator('[data-novo="pasta"]').click();
  await page.locator('#pasta-nome').fill('Aulas');
  await page.locator('#pasta-destino').selectOption('Estudos');
  await shoot(page, '08-nova-pasta-dialogo', { repaint: false });
  await page.locator('#pasta-criar').click();
  await expect.poll(() => fs.existsSync(path.join(root, 'Estudos', 'Aulas'))).toBeTruthy();
  const row = page.locator('#arvore [data-pasta="Estudos/Aulas"]');
  await expect(row).toBeVisible();
  await shoot(page, '09-nova-pasta-arvore', { repaint: false });
  await row.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Nova nota aqui' }).click();
  await expect.poll(() => fs.readdirSync(path.join(root, 'Estudos', 'Aulas')).some((name) => name.endsWith('.md'))).toBeTruthy();
  await page.locator('#arvore [data-shelf="Projetos"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Nova pasta aqui…' }).click();
  await expect(page.locator('#pasta-destino')).toHaveValue('Projetos');
  await page.locator('#pasta-nome').fill('a/b');
  await page.locator('#pasta-criar').click();
  await expect(page.locator('#pasta-erro')).toContainText('nome simples');
  await page.locator('#pasta-nome').fill('Rascunhos');
  await page.locator('#pasta-criar').click();
  await expect.poll(() => fs.existsSync(path.join(root, 'Projetos', 'Rascunhos'))).toBeTruthy();
  await app.close();
});

test('blocos nomeados: autocomplete [[Nota#, prévia e clique que rola até o bloco', async () => {
  const root = library();
  const { app, page } = await launch(root);
  await page.locator('#arvore [data-open="Projetos/Roteiro.md"]').click();
  await page.locator('#coluna .bloco--texto').last().click();
  await page.keyboard.press('End');
  await page.keyboard.type('\n[[Codigo#so');
  const menu = page.locator('.menu--wiki');
  await expect(menu).toContainText('soma');
  await expect(menu).toContainText('Bloco nomeado');
  await shoot(page, '10-autocomplete-bloco', { repaint: false });
  await menu.locator('.menu__item', { hasText: 'soma' }).first().click();
  await page.keyboard.press('Escape');
  await expect.poll(() => fs.readFileSync(path.join(root, 'Projetos', 'Roteiro.md'), 'utf8')).toContain('[[Codigo#soma]]');
  await page.locator('#arvore [data-open="Estudos/Biologia.md"]').click();
  const link = page.locator('#coluna a.wikilink[data-raw="[[Codigo#soma]]"]').first();
  await expect(link).toBeVisible();
  await page.keyboard.down('Control');
  await link.hover();
  const preview = page.locator('.wiki-previa');
  await expect(preview).toContainText('const soma');
  await expect(preview).toContainText('Ir para o bloco');
  await shoot(page, '11-previa-bloco', { repaint: false });
  await page.keyboard.up('Control');
  await preview.getByRole('button', { name: 'Ir para o bloco' }).click();
  await expect(page.locator('#coluna .codigo.is-secao-alvo')).toBeVisible();
  await expect(page.locator('#coluna .codigo.is-secao-alvo')).toContainText('const soma');
  await app.close();
});

test('renomear bloco atualiza os links e oferece Desfazer', async () => {
  const root = library();
  const { app, page } = await launch(root);
  await page.locator('#arvore [data-open="Estudos/Codigo.md"]').click();
  const rename = page.locator('[data-code-rename]');
  await expect(rename).toBeVisible();
  // Sem o block.rename do PR #42 a porta recusa a chamada: simula o contrato combinado com o Fernando.
  const supported = await page.evaluate(async () => {
    const probe = await window.sophy.tool('block.rename', { notePath: 'nao-existe.md', de: 'a', para: 'b' });
    return !/origin/i.test(String(probe.error || ''));
  });
  if (!supported) {
    await page.evaluate(() => {
      const real = window.tool;
      window.tool = async (name, input) => {
        if (name === 'block.rename') {
          const note = await real('note.read', { path: input.notePath });
          await real('note.write', { path: input.notePath, body: note.body.replace(`title="${input.de}"`, `title="${input.para}"`), expectedRevision: note.revision });
          const other = await real('note.read', { path: 'Estudos/Biologia.md' });
          await real('note.write', { path: 'Estudos/Biologia.md', body: other.body.replace(`[[Codigo#${input.de}]]`, `[[Codigo#${input.para}]]`), expectedRevision: other.revision });
          return { path: input.notePath, title: input.para, from: input.de, updated: [input.notePath, 'Estudos/Biologia.md'], shadowed: false };
        }
        return real(name, input);
      };
    });
  }
  await rename.click();
  await page.locator('#dialogo-valor').fill('somar');
  await page.locator('#dialogo-ok').click();
  await expect(page.getByText(/Bloco renomeado para “somar”/)).toBeVisible();
  await expect(page.getByText(/1 outra nota teve os links atualizados/)).toBeVisible();
  await shoot(page, '12-renomear-bloco', { repaint: false });
  expect(fs.readFileSync(path.join(root, 'Estudos', 'Biologia.md'), 'utf8')).toContain('[[Codigo#somar]]');
  if (supported) {
    await page.getByRole('button', { name: 'Desfazer' }).click();
    await expect.poll(() => fs.readFileSync(path.join(root, 'Estudos', 'Biologia.md'), 'utf8')).toContain('[[Codigo#soma]]');
    await page.locator('[data-code-rename]').click();
    await page.locator('#dialogo-valor').fill('Código');
    await page.locator('#dialogo-ok').click();
    await expect(page.getByText('Esse nome já é uma seção ou um bloco desta nota.')).toBeVisible();
  }
  await app.close();
});

test('exportar: “A estante” fica desabilitada com a dica', async () => {
  const root = library();
  const { app, page } = await launch(root);
  await page.locator('#arvore [data-open="Projetos/Roteiro.md"]').click();
  await page.locator('[data-nav="config"]').click();
  await page.locator('[data-cfg-secao="bibliotecas"]').click();
  await page.locator('#cfg-pdf').click();
  const dialog = page.getByRole('dialog', { name: 'Exportar' });
  await expect(dialog.locator('input[value="nota"]')).toBeChecked();
  await expect(dialog.locator('input[value="estante"]')).toBeDisabled();
  await expect(dialog).toContainText('O PDF da estante inteira ainda não existe');
  await shoot(page, '13-exportar-pdf', { repaint: false });
  await page.keyboard.press('Escape');
  await page.evaluate(() => { document.querySelector('#overlay').hidden = true; });
  await page.locator('#cfg-site').click();
  await expect(dialog.locator('input[value="biblioteca"]')).toBeChecked();
  await expect(dialog.locator('input[value="estante"]')).toBeDisabled();
  await expect(dialog).toContainText('O site sai com a biblioteca inteira');
  await app.close();
});
