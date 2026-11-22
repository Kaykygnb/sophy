const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

async function launch() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-f4h-'));
  fs.mkdirSync(path.join(root, '.sophy'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Leitura.md'), '# Leitura\n\nUma frase para selecionar.\n');
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-f4h-data-'));
  fs.writeFileSync(path.join(userData, 'ui.json'), JSON.stringify({ onboarded: true, libraryPath: root, libraries: [root], theme: 'light' }));
  const env = { ...process.env, NODE_OPTIONS: '--experimental-strip-types' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', `--test-user-data=${userData}`], env });
  return { app, page: await app.firstWindow() };
}

// Simula o processo principal do PR 4: o cliente do modelo é falso, só os canais IPC valem.
async function fakeHarness(app, mode) {
  await app.evaluate(({ ipcMain, BrowserWindow }, mode) => {
    const win = () => BrowserWindow.getAllWindows()[0];
    globalThis.__asks = [];
    globalThis.__replies = [];
    let release;
    ipcMain.removeHandler('sophy:agent-ask');
    ipcMain.removeHandler('sophy:agent-cancel');
    ipcMain.removeHandler('sophy:agent-confirm-reply');
    ipcMain.handle('sophy:agent-ask', async (_e, message, context) => {
      globalThis.__asks.push({ message, context });
      if (mode === 'sem_chave') return { ok: false, error: 'Guarde a chave no cofre antes de pedir.', code: 'sem_chave' };
      win().webContents.send('sophy:agent-progress', { phase: 'thinking', label: 'Pensando…' });
      win().webContents.send('sophy:agent-progress', { phase: 'tool', label: 'Criando a nota Reunião', tool: 'note.create', actionId: 'a1' });
      if (mode === 'confirmar') {
        win().webContents.send('sophy:agent-confirm', { confirmId: 'c1', tool: 'entry.move', label: 'Mover a nota Estudos/A.md?', input: {} });
        const allow = await new Promise((resolve) => (release = resolve));
        return { ok: true, value: { text: allow ? 'Movi.' : 'Tudo bem, não movi.', actions: [{ id: 'a1', tool: 'entry.move', label: 'Mover a nota A', input: {}, ok: allow, error: allow ? undefined : 'A pessoa recusou esta ação.' }] } };
      }
      if (mode === 'parar') {
        await new Promise((resolve) => (release = resolve));
        return { ok: true, value: { text: 'Cancelado.', actions: [{ id: 'a1', tool: 'note.create', label: 'Criou a nota Reunião', input: {}, ok: true, versionId: 'v9' }], canceled: true } };
      }
      return { ok: true, value: { text: 'Pronto, criei.', actions: [{ id: 'a1', tool: 'note.create', label: 'Criou a nota Reunião', input: {}, ok: true, versionId: 'v-inexistente' }, { id: 'a2', tool: 'note.read', label: 'Leu a nota X', input: {}, ok: false, error: 'Nota não encontrada.' }] } };
    });
    ipcMain.handle('sophy:agent-confirm-reply', (_e, id, allow) => {
      globalThis.__replies.push({ id, allow });
      release?.(allow === true);
      return { ok: true, value: true };
    });
    ipcMain.handle('sophy:agent-cancel', () => {
      release?.();
      return { ok: true, value: { canceled: true } };
    });
  }, mode);
}

async function openSofi(page) {
  await page.locator('#arvore').getByText('Leitura', { exact: true }).first().click();
  await page.keyboard.press('Control+j');
  await page.evaluate(() => { state.sofiKey = true; paintSofi(document.querySelector('.sofi-chat').parentElement, true); });
}

test('harness: contexto estruturado, fase da ferramenta, cartões de ação e desfazer com erro explícito', async () => {
  const { app, page } = await launch();
  try {
    test.skip(!(await page.evaluate(() => typeof sophy.onAgentProgress === 'function')), 'precisa do preload do PR 4');
    await fakeHarness(app, 'normal');
    await openSofi(page);
    // seleciona um trecho do texto antes de ir para o campo da Sofi
    await page.evaluate(() => {
      const block = [...document.querySelectorAll('.bloco[data-block]')].find((b) => b.textContent.includes('Uma frase'));
      const range = document.createRange();
      range.selectNodeContents(block.firstChild);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    });
    await page.waitForTimeout(150);
    await page.locator('#agente-pedido').fill('Crie uma nota de reunião');
    await page.locator('#agente-enviar').click();
    await expect(page.locator('.sofi-acao')).toHaveCount(2);
    const ask = await app.evaluate(() => globalThis.__asks[0]);
    expect(ask.message).toBe('Crie uma nota de reunião');
    expect(ask.context.notePath).toBe('Leitura.md');
    expect(ask.context.selection.text).toContain('Uma frase');
    expect(ask.context.selection.to).toBeGreaterThan(ask.context.selection.from);
    await expect(page.locator('.sofi-acao.is-falhou')).toContainText('Nota não encontrada.');
    await page.locator('[data-desfazer="v-inexistente"]').click();
    await expect(page.locator('.toast, [role="status"]').filter({ hasText: /Não deu para desfazer/ })).toBeVisible();
  } finally {
    await app.close();
  }
});

test('harness: confirmação inline permite ou recusa sem encerrar o turno, e a fase aparece no estado', async () => {
  const { app, page } = await launch();
  try {
    test.skip(!(await page.evaluate(() => typeof sophy.onAgentProgress === 'function')), 'precisa do preload do PR 4');
    await fakeHarness(app, 'confirmar');
    await openSofi(page);
    await page.locator('#agente-pedido').fill('Mova a nota A');
    await page.locator('#agente-enviar').click();
    await expect(page.locator('#agente-estado')).toContainText('Aguardando você');
    const card = page.locator('.sofi-confirma');
    await expect(card).toContainText('Mover a nota Estudos/A.md?');
    await card.getByRole('button', { name: 'Recusar' }).click();
    await expect(page.locator('.sofi-confirma')).toHaveCount(0);
    await expect(page.locator('.sofi-msg--sofi').last()).toContainText('não movi');
    expect(await app.evaluate(() => globalThis.__replies)).toEqual([{ id: 'c1', allow: false }]);
  } finally {
    await app.close();
  }
});

test('harness: Parar cancela o pedido e sem_chave abre o cartão Conectar a Sofi', async () => {
  const { app, page } = await launch();
  try {
    test.skip(!(await page.evaluate(() => typeof sophy.onAgentProgress === 'function')), 'precisa do preload do PR 4');
    await fakeHarness(app, 'parar');
    await openSofi(page);
    await page.locator('#agente-pedido').fill('Faça algo longo');
    await page.locator('#agente-enviar').click();
    await expect(page.locator('#agente-parar')).toBeVisible();
    await page.locator('#agente-parar').click();
    await expect(page.locator('#agente-parar')).toBeHidden();
    await expect(page.locator('.sofi-msg--sofi').last()).toContainText('cancelado');
    await expect(page.locator('.sofi-acao')).toHaveCount(1);

    await fakeHarness(app, 'sem_chave');
    await page.locator('#agente-pedido').fill('Oi');
    await page.locator('#agente-enviar').click();
    await expect(page.locator('.sofi-conectar')).toContainText('Conectar a Sofi');
  } finally {
    await app.close();
  }
});
