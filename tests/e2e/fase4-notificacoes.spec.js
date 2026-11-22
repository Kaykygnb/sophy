const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function library() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-f4n-'));
  fs.mkdirSync(path.join(root, '.sophy'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Estudos'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Estudos', 'Leitura.md'), '# Leitura\n\nTexto.\n');
  fs.writeFileSync(path.join(root, 'Estudos', 'Plano.md'), '# Plano\n\nTexto.\n');
  return root;
}

async function launch(root, theme = 'light') {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-f4n-data-'));
  fs.writeFileSync(
    path.join(userData, 'ui.json'),
    JSON.stringify({ onboarded: true, libraryPath: root, libraries: [root], theme }),
  );
  const env = { ...process.env, NODE_OPTIONS: '--experimental-strip-types' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', `--test-user-data=${userData}`], env });
  return { app, page: await app.firstWindow() };
}

const weekday = (page, day) => page.evaluate((d) => { Date.prototype.getDay = () => d; return refreshNotifications(); }, day);

test('notificações: sino no lugar da faixa, estado vazio, revisão, lixeira e dispensar', async () => {
  const { app, page } = await launch(library());
  try {
    await expect(page.locator('#notificacoes')).toBeVisible();
    await weekday(page, 1);
    await expect(page.locator('#revisao-semana')).toHaveCount(0);
    await expect(page.locator('#notificacoes-contador')).toBeHidden();
    await page.locator('#notificacoes').click();
    const panel = page.locator('#notificacoes-painel');
    await expect(panel).toContainText('Tudo em dia');
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);

    // domingo: a revisão chega pelo sino, nunca como faixa
    await weekday(page, 0);
    await expect(page.locator('#revisao-semana')).toHaveCount(0);
    await expect(page.locator('#notificacoes-contador')).toHaveText('1');
    await page.locator('#notificacoes').click();
    await expect(panel).toContainText('Revisão da semana pronta');
    await panel.getByRole('button', { name: 'Abrir revisão' }).click();
    await expect(panel).toHaveCount(0);
    await expect(page.locator('#notificacoes-contador')).toBeHidden(); // abrir a ação marca como lida

    // lixeira
    await page.evaluate(async () => {
      await tool('entry.trash', { path: 'Estudos/Plano.md' });
      await tool('entry.trash', { path: 'Estudos/Leitura.md' });
      state.notifTrashAt = 0;
      await refreshNotifications();
    });
    await page.locator('#notificacoes').click();
    await expect(panel).toContainText('Lixeira com 2 itens');
    await panel.getByRole('button', { name: 'Abrir lixeira' }).click();
    await expect(page.locator('.lixeira__item')).toHaveCount(2);

    // dispensar remove só aquele aviso
    await page.locator('#notificacoes').click();
    await expect(panel.locator('.notif__item')).toHaveCount(2);
    await panel.locator('.notif__item', { hasText: 'Lixeira com 2 itens' }).locator('[data-notif-dispensar]').click();
    await expect(panel.locator('.notif__item')).toHaveCount(1);
    await expect(panel).not.toContainText('Lixeira com');
    await panel.locator('[data-notif-dispensar]').click();
    await expect(panel).toContainText('Tudo em dia');
  } finally {
    await app.close();
  }
});

test('notificações: exportação, marcar todas como lidas e ligar/desligar tipos em Configurações', async () => {
  const { app, page } = await launch(library());
  try {
    await expect(page.locator('#notificacoes')).toBeVisible();
    await weekday(page, 1);
    await page.evaluate(() => {
      pushNotification({ type: 'exportacao', title: 'PDF exportado', body: '“Leitura” foi salvo.' });
      pushNotification({ type: 'sofi', title: 'A Sofi terminou', body: 'Criou 2 flashcards.', action: { label: 'Abrir a Sofi', kind: 'sofi' } });
    });
    await expect(page.locator('#notificacoes-contador')).toHaveText('2');
    await page.locator('#notificacoes').click();
    const panel = page.locator('#notificacoes-painel');
    await expect(panel.locator('.notif__item')).toHaveCount(2);
    await panel.getByRole('button', { name: 'Marcar todas como lidas' }).click();
    await expect(page.locator('#notificacoes-contador')).toBeHidden();
    await expect(panel.locator('.notif__item.is-nova')).toHaveCount(0);

    // Configurações > Notificações
    await panel.getByRole('button', { name: 'Configurar avisos' }).click();
    await expect(page.locator('#cfg-notificacoes')).toBeVisible();
    await expect(page.locator('[id^="cfg-notif-"]')).toHaveCount(5);
    await page.locator('label.alternar', { has: page.locator('#cfg-notif-sofi') }).click();
    await expect(page.locator('#cfg-notif-sofi')).not.toBeChecked();
    await page.locator('#notificacoes').click();
    await expect(panel.locator('.notif__item')).toHaveCount(1);
    await expect(panel).not.toContainText('A Sofi terminou');
  } finally {
    await app.close();
  }
});
