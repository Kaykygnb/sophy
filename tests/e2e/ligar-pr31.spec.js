const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function library() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-pr31-'));
  fs.mkdirSync(path.join(root, '.sophy'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Estudos'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'Estudos', 'Leitura.md'),
    '# Leitura\n\nCapital da França :: Paris\n\nMaior planeta :: Júpiter\n',
  );
  fs.writeFileSync(path.join(root, 'Estudos', 'Plano.md'), '# Plano\n\nTexto.\n');
  return root;
}

async function launch(root, theme = 'light', size = null) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-pr31-data-'));
  fs.writeFileSync(
    path.join(userData, 'ui.json'),
    JSON.stringify({ onboarded: true, libraryPath: root, libraries: [root], theme }),
  );
  const env = { ...process.env, NODE_OPTIONS: '--experimental-strip-types' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', `--test-user-data=${userData}`], env });
  const page = await app.firstWindow();
  if (size) await page.setViewportSize(size);
  return { app, page };
}

async function openNote(page, title) {
  await page.locator('#arvore').getByText(title, { exact: true }).first().click();
  await expect(page.locator('.bloco').first()).toBeVisible();
}

/* ------------------------------------------------------------------ Lixeira */

test('lixeira: apagar mostra Desfazer, a tela lista, restaura, exclui e esvazia com confirmação', async () => {
  const root = library();
  const { app, page } = await launch(root);
  try {
    // acesso visível pela navegação e pelo menu da biblioteca
    const entry = page.locator('.lateral__rodape [data-nav="lixeira"]');
    await expect(entry).toBeVisible();
    await entry.click();
    await expect(page.getByRole('heading', { name: 'A lixeira está vazia' })).toBeVisible();
    await expect(page.locator('.lixeira-vazia svg, .lixeira-vazia img').first()).toBeVisible();
    await expect(entry).toHaveAttribute('aria-current', 'page');

    // apagar uma nota mostra o aviso com Desfazer, e Desfazer devolve o arquivo
    await page.locator('#arvore').getByText('Plano', { exact: true }).first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Excluir…' }).click();
    await page.getByRole('button', { name: 'Excluir', exact: true }).click();
    const toast = page.locator('.toast').filter({ hasText: 'Movido para a lixeira' });
    await expect(toast).toBeVisible();
    expect(fs.existsSync(path.join(root, 'Estudos', 'Plano.md'))).toBe(false);
    await toast.getByRole('button', { name: 'Desfazer' }).click();
    await expect.poll(() => fs.existsSync(path.join(root, 'Estudos', 'Plano.md'))).toBe(true);

    // apaga de novo, agora para ver na tela: título, pasta de origem, quando e tamanho
    await page.evaluate(async () => {
      await tool('entry.trash', { path: 'Estudos/Plano.md' });
      await tool('entry.trash', { path: 'Estudos/Leitura.md' });
    });
    await page.locator('#novo').waitFor();
    await entry.click();
    const rows = page.locator('.lixeira__item');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText('Leitura'); // a mais recente primeiro
    await expect(rows.first()).toContainText('Estudos');
    await expect(rows.first()).toContainText(/agora há pouco|há \d+ min/);
    await expect(rows.first()).toContainText(/\d+ (B|KB)/);

    // restaurar devolve ao lugar de origem
    await rows.first().getByRole('button', { name: /Restaurar/ }).click();
    await expect.poll(() => fs.existsSync(path.join(root, 'Estudos', 'Leitura.md'))).toBe(true);
    await expect(rows).toHaveCount(1);

    // excluir de vez pede confirmação; cancelar mantém o item
    await rows.first().getByRole('button', { name: 'Excluir de vez' }).click();
    await expect(page.getByRole('alertdialog')).toContainText('Não dá para desfazer');
    await page.getByRole('button', { name: 'Cancelar' }).click();
    await expect(rows).toHaveCount(1);
    await rows.first().getByRole('button', { name: 'Excluir de vez' }).click();
    await page.getByRole('button', { name: 'Excluir de vez', exact: true }).last().click();
    await expect(page.getByRole('heading', { name: 'A lixeira está vazia' })).toBeVisible();

    // esvaziar também pede confirmação
    await page.evaluate(() => tool('entry.trash', { path: 'Estudos/Leitura.md' }));
    await page.locator('.lateral__rodape [data-nav="config"]').click();
    await entry.click();
    await expect(rows).toHaveCount(1);
    await page.getByRole('button', { name: 'Esvaziar lixeira' }).click();
    await expect(page.getByRole('alertdialog')).toContainText('excluídos de vez');
    await page.getByRole('button', { name: 'Esvaziar lixeira', exact: true }).last().click();
    await expect(page.getByRole('heading', { name: 'A lixeira está vazia' })).toBeVisible();
    expect(fs.existsSync(path.join(root, 'Estudos', 'Leitura.md'))).toBe(false);

    // também pelo menu da biblioteca
    await page.locator('[data-nav="inicio"]').click();
    await page.locator('#seletor-biblioteca').click();
    await page.getByRole('menuitem', { name: 'Lixeira' }).click();
    await expect(page.getByRole('heading', { name: 'A lixeira está vazia' })).toBeVisible();
  } finally {
    await app.close();
  }
});

test('lixeira: restaurar com o nome ocupado avisa e usa o sufixo (restaurado)', async () => {
  const root = library();
  const { app, page } = await launch(root);
  try {
    await expect(page.locator('#arvore')).toContainText('Plano');
    await page.evaluate(async () => {
      await tool('entry.trash', { path: 'Estudos/Plano.md' });
      await tool('note.create', { path: 'Estudos/Plano.md', body: 'nova\n' });
    });
    await page.locator('[data-nav="lixeira"]').click();
    await page.locator('.lixeira__item').first().getByRole('button', { name: /Restaurar/ }).click();
    await expect(page.locator('.toast').filter({ hasText: 'Plano (restaurado)' })).toBeVisible();
    expect(fs.existsSync(path.join(root, 'Estudos', 'Plano (restaurado).md'))).toBe(true);
  } finally {
    await app.close();
  }
});

/* ---------------------------------------------------------------- Flashcards */

test('flashcards: quatro notas com intervalo, teclas 1 a 4 e Desfazer', async () => {
  const root = library();
  const { app, page } = await launch(root);
  try {
    await page.locator('[data-nav="cartas"]').click();
    const buttons = page.locator('.fc-nota');
    await expect(buttons).toHaveCount(4);
    await expect(buttons.nth(0)).toContainText('Errei');
    await expect(buttons.nth(1)).toContainText('Difícil');
    await expect(buttons.nth(2)).toContainText('Bom');
    await expect(buttons.nth(3)).toContainText('Fácil');
    for (const index of [0, 1, 2, 3]) await expect(buttons.nth(index)).toContainText(/\d+(d|sem|mês|a)/);
    await expect(page.locator('#carta-desfazer')).toHaveCount(0);
    await expect(page.locator('.fc-contagem')).toContainText('2 para hoje');

    // tecla 3 = Bom; fica 1 para hoje e aparece Desfazer
    await page.locator('#centro').press('3');
    await expect(page.locator('.fc-contagem')).toContainText('1 para hoje');
    await expect(page.locator('#carta-desfazer')).toBeVisible();

    // Desfazer devolve o cartão, que volta a ser o primeiro
    await page.locator('#carta-desfazer').click();
    await expect(page.locator('.fc-contagem')).toContainText('2 para hoje');
    await expect(page.locator('#carta-desfazer')).toHaveCount(0);
    await expect(page.locator('.fc-face__p')).toContainText('Capital da França');

    // tecla 1 (Errei) e Z desfaz
    await page.locator('#centro').press('1');
    await expect(page.locator('.fc-contagem')).toContainText('1 para hoje');
    await page.locator('#centro').press('z');
    await expect(page.locator('.fc-contagem')).toContainText('2 para hoje');

    // responder os dois leva ao estado "tudo revisado", ainda com Desfazer
    await page.locator('#centro').press('4');
    await page.locator('#centro').press('2');
    await expect(page.getByRole('heading', { name: 'Tudo revisado por hoje' })).toBeVisible();
    await expect(page.locator('#carta-desfazer')).toBeVisible();
  } finally {
    await app.close();
  }
});

/* --------------------------------------------------------------- Painel Sofi */

test('painel da Sofi: cabeçalho, sugestões, contexto removível, campo e cartão de conexão', async () => {
  const root = library();
  const { app, page } = await launch(root);
  try {
    await openNote(page, 'Leitura');
    await page.locator('#abrir-sofi').click();
    const panel = page.locator('.sofi-chat');
    await expect(panel).toBeVisible();
    const box = await panel.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(320);
    expect(box.width).toBeLessThanOrEqual(360);

    // cabeçalho compacto
    await expect(panel.locator('.sofi-chat__topo h3')).toHaveText('Sofi');
    await expect(panel.getByRole('button', { name: 'Nova conversa' })).toBeVisible();
    await expect(panel.locator('#agente-fechar')).toBeVisible();
    await expect(panel).not.toContainText('Pedido');
    await expect(panel.locator('.chip')).toHaveCount(0);

    // sem chave: cartão Conectar a Sofi abre Configurações > Sofi e IA
    const connect = panel.locator('.sofi-conectar');
    if (await connect.count()) {
      await expect(connect).toContainText('Conectar a Sofi');
      await expect(connect.locator('.sofi-prov')).toHaveCount(9);
      await connect.locator('#agente-conectar').click();
      await expect(page.locator('#cfg-sofi')).toBeVisible();
      await expect(page.locator('#sofi-cfg .sofi-prov').first()).toBeVisible();
      if (!(await panel.count())) await page.locator('#abrir-sofi').click();
      await expect(panel).toBeVisible();
    }

    // com chave: estado vazio com sugestões
    await page.evaluate(() => {
      state.sofiKey = true;
      paintSofi(document.querySelector('.sofi-chat').parentElement, true);
    });
    await expect(panel.locator('#agente-vazio')).toBeVisible();
    await expect(panel.locator('[data-sugestao]')).toHaveCount(5);
    await expect(panel.getByRole('button', { name: 'Resumir esta nota' })).toBeVisible();
    await expect(panel.locator('#agente-chave')).toHaveCount(0);

    // contexto: “Nota atual: Leitura”, removível
    const chip = panel.locator('.sofi-contexto');
    await expect(chip).toContainText('Nota atual: Leitura');
    await chip.getByRole('button').click();
    await expect(chip).toHaveCount(0);

    // campo: Enter envia, Shift+Enter quebra a linha, enviar fica desligado sem texto
    const field = panel.locator('#agente-pedido');
    await expect(field).toHaveAttribute('placeholder', 'Pergunte ou peça algo à Sofi…');
    await expect(panel.locator('#agente-enviar')).toBeDisabled();
    await field.fill('olá');
    await field.press('Shift+Enter');
    await field.type('segunda linha');
    expect(await field.inputValue()).toBe('olá\nsegunda linha');
    expect(await field.evaluate((el) => el.scrollHeight)).toBeGreaterThan(0);
    await field.press('Enter');
    await expect(panel.locator('.sofi-msg--voce')).toContainText('segunda linha');
    expect(await field.inputValue()).toBe('');
    // sem chave guardada: com o harness (#36) o erro é `sem_chave` e o painel troca para o cartão
    // “Conectar a Sofi”; sem ele, a resposta chega como balão de erro amigável.
    const connectCard = page.locator('.sofi-conectar');
    const errorBubble = panel.locator('.sofi-msg--sofi');
    await expect(connectCard.or(errorBubble).first()).toBeVisible({ timeout: 15000 });
    if (await connectCard.count()) {
      await expect(connectCard).toContainText('Conectar a Sofi');
      await expect(page.locator('#agente-pedido')).toBeDisabled();
    } else {
      await expect(panel.locator('#agente-vazio')).toBeHidden();
      // Nova conversa limpa tudo
      await panel.getByRole('button', { name: 'Nova conversa' }).click();
      await expect(panel.locator('.sofi-msg')).toHaveCount(0);
      await expect(panel.locator('#agente-vazio')).toBeVisible();
    }

    // fechar
    await panel.locator('#agente-fechar').click();
    await expect(page.locator('.sofi-chat')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('painel da Sofi: clicar numa sugestão preenche e envia; escuro mantém contraste legível', async () => {
  const root = library();
  const { app, page } = await launch(root, 'dark');
  try {
    await openNote(page, 'Leitura');
    await page.locator('#abrir-sofi').click();
    await page.evaluate(() => {
      state.sofiKey = true;
      paintSofi(document.querySelector('.sofi-chat').parentElement, true);
    });
    const panel = page.locator('.sofi-chat');
    await panel.getByRole('button', { name: 'Achar notas relacionadas' }).click();
    await expect(panel.locator('.sofi-msg--voce')).toContainText('Achar notas relacionadas');
    const color = await panel.locator('.sofi-msg--voce p').evaluate((el) => {
      const style = getComputedStyle(el);
      return { fg: style.color, bg: style.backgroundColor };
    });
    expect(color.fg).not.toBe(color.bg);
  } finally {
    await app.close();
  }
});
