const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function library() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `sophy-wiki-${process.pid}-`));
  fs.mkdirSync(path.join(root, 'Estudos'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Arquivo'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'Estudos', 'José.md'),
    '---\naliases:\n  - Zé\n---\n# Seção\n\nParágrafo ^bloco-1\n',
  );
  fs.writeFileSync(
    path.join(root, 'Estudos', 'Fonte.md'),
    'Veja [[José|o Zé]] e [[José#Seção]] e [[José#^bloco-1]].\n\n`[[José]]`\n\n```\n[[José]]\n```\n',
  );
  fs.writeFileSync(path.join(root, 'Estudos', 'Quebrado.md'), 'Link [[NotaInexistente]] aqui.\n');
  fs.writeFileSync(
    path.join(root, 'Estudos', 'Suja.md'),
    'Texto <script>alert(1)</script> e <img src=x onerror=alert(2)>.\n',
  );
  fs.writeFileSync(path.join(root, 'Estudos', 'Operation Dominion.md'), 'Missão.\n');
  return root;
}

async function launch(root) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), `sophy-wiki-data-${process.pid}-`));
  const env = { ...process.env, NODE_OPTIONS: '--experimental-strip-types' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    args: ['.', `--test-user-data=${userData}`, `--biblioteca=${root}`, '--theme=light'],
    env,
  });
  const page = await app.firstWindow();
  await page.getByRole('button', { name: 'Fonte', exact: true }).click();
  return { app, page };
}

test('renomear atualiza links com apelido seção e bloco, e o toast oferece desfazer', async () => {
  const root = library();
  const { app, page } = await launch(root);
  await page.locator('#arvore [data-open="Estudos/José.md"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Renomear' }).click();
  await page.locator('[data-rename="note"]').fill('João Silva');
  await page.locator('[data-rename="note"]').press('Enter');
  await expect(page.getByText(/link.*atualizado/i)).toBeVisible({ timeout: 8000 });
  const disk = fs.readFileSync(path.join(root, 'Estudos', 'Fonte.md'), 'utf8');
  expect(disk).toMatch(/\[\[Estudos\/João Silva\|o Zé\]\]|\[\[João Silva\|o Zé\]\]/);
  expect(disk).toMatch(/#Seção/);
  expect(disk).toMatch(/#\^bloco-1/);
  expect(disk).toContain('`[[José]]`');
  await page.getByRole('button', { name: 'Desfazer' }).click();
  await page.waitForTimeout(600);
  expect(fs.existsSync(path.join(root, 'Estudos', 'José.md'))).toBeTruthy();
  expect(fs.readFileSync(path.join(root, 'Estudos', 'Fonte.md'), 'utf8')).toContain('[[José|o Zé]]');
  await app.close();
});

test('autocomplete fuzzy e link quebrado cria nota', async () => {
  const root = library();
  const { app, page } = await launch(root);
  await page.locator('.bloco--texto').first().click();
  await page.keyboard.press('End');
  await page.keyboard.type('\n[[oper dom');
  await expect(page.locator('.menu--wiki')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.menu--wiki')).toContainText(/Operation Dominion/i);
  await page.keyboard.press('Escape');
  await page.locator('#arvore [data-open="Estudos/Quebrado.md"]').click();
  await page.waitForTimeout(400);
  const broken = page.locator('a.wikilink--quebrado').first();
  await expect(broken).toBeVisible();
  await broken.click();
  await page.waitForTimeout(800);
  expect(
    fs.existsSync(path.join(root, 'Estudos', 'NotaInexistente.md')) ||
      fs.existsSync(path.join(root, 'NotaInexistente.md')),
  ).toBeTruthy();
  await app.close();
});

test('prévia ao pairar não executa script da nota', async () => {
  const root = library();
  const { app, page } = await launch(root);
  await page.locator('.bloco--texto').first().click();
  await page.keyboard.press('End');
  await page.keyboard.type('\n[[Suja]]');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  const link = page.locator('a.wikilink[data-target="Suja"], a.wikilink[data-target="Estudos/Suja"]').first();
  await link.hover();
  await page.waitForTimeout(500);
  const preview = page.locator('.wiki-previa');
  await expect(preview).toBeVisible({ timeout: 3000 });
  const html = await preview.innerHTML();
  expect(html).not.toContain('<script>');
  expect(html).not.toContain('<img');
  expect(html).toContain('&lt;script&gt;');
  expect(html).toContain('&lt;img');
  const scripts = await page.locator('.wiki-previa script').count();
  expect(scripts).toBe(0);
  await page.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);
  await app.close();
});
