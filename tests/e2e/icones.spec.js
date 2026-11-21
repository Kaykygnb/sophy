const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function library() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-icones-'));
  fs.mkdirSync(path.join(root, 'Estudos'), { recursive: true });
  fs.mkdirSync(path.join(root, '.sophy'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'Estudos', 'Nota.md'),
    '# Nota\n\nUm texto curto para a janela.\n',
  );
  return root;
}

async function openApp() {
  const folder = library();
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-icones-data-'));
  fs.writeFileSync(
    path.join(userData, 'ui.json'),
    JSON.stringify({ onboarded: true, libraryPath: folder, libraries: [folder], theme: 'light' }),
  );
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.NODE_OPTIONS = '--experimental-strip-types';
  const app = await electron.launch({
    args: ['.', `--test-user-data=${userData}`],
    env,
  });
  const page = await app.firstWindow();
  await page.locator('#seletor-biblioteca').waitFor();
  return { app, page };
}

test('todo use href de ícone aponta para um símbolo do sprite', async () => {
  const { app, page } = await openApp();
  const broken = await page.evaluate(() => {
    const ids = new Set(
      [...document.querySelectorAll('#sprite symbol')].map((symbol) => symbol.id),
    );
    return [...document.querySelectorAll('use')]
      .map((use) => use.getAttribute('href') || '')
      .filter((href) => href.startsWith('#i-') && !ids.has(href.slice(1)));
  });
  expect(broken).toEqual([]);
  const total = await page.locator('use[href^="#i-"]').count();
  expect(total).toBeGreaterThan(0);
  await app.close();
});

test('o estado ativo mostra o Fill e esconde o Regular', async () => {
  const { app, page } = await openApp();
  await page.evaluate(() => {
    const host = document.createElement('button');
    host.id = 'prova-fill';
    host.className = 'nav__item';
    host.setAttribute('aria-current', 'page');
    host.innerHTML =
      '<svg class="icon" aria-hidden="true"><use class="icon__regular" href="#i-house"></use><use class="icon__fill" href="#i-house-fill"></use></svg>';
    document.body.append(host);
    const idle = document.createElement('button');
    idle.id = 'prova-repouso';
    idle.className = 'nav__item';
    idle.innerHTML = host.innerHTML;
    document.body.append(idle);
  });
  const active = await page.locator('#prova-fill .icon').evaluate((svg) => ({
    regular: getComputedStyle(svg.querySelector('.icon__regular')).opacity,
    fill: getComputedStyle(svg.querySelector('.icon__fill')).opacity,
    color: getComputedStyle(svg).color,
  }));
  const idle = await page.locator('#prova-repouso .icon').evaluate((svg) => ({
    regular: getComputedStyle(svg.querySelector('.icon__regular')).opacity,
    fill: getComputedStyle(svg.querySelector('.icon__fill')).opacity,
  }));
  const nav = page.locator('[data-nav="inicio"]');
  await expect(nav).toHaveAttribute('aria-current', 'page');
  await expect(nav.locator('use.icon__fill')).toHaveAttribute('href', '#i-house-fill');
  await expect(nav.locator('use.icon__regular')).toHaveAttribute('href', '#i-house');
  const navOpacity = await nav.locator('.icon').evaluate((svg) => ({
    regular: getComputedStyle(svg.querySelector('.icon__regular')).opacity,
    fill: getComputedStyle(svg.querySelector('.icon__fill')).opacity,
  }));
  expect(Number(navOpacity.fill)).toBeGreaterThan(0.9);
  expect(Number(navOpacity.regular)).toBeLessThan(0.1);
  expect(Number(active.fill)).toBeGreaterThan(0.9);
  expect(Number(active.regular)).toBeLessThan(0.1);
  expect(Number(idle.regular)).toBeGreaterThan(0.9);
  expect(Number(idle.fill)).toBeLessThan(0.1);
  const accent = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
  );
  expect(active.color).not.toBe('');
  expect(accent).toBe('#4B52B0');
  await app.close();
});

test('prefers-reduced-motion zera a transição do ícone', async () => {
  const { app, page } = await openApp();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const duration = await page
    .locator('.nav__item .icon')
    .first()
    .evaluate((icon) => {
      return getComputedStyle(icon).transitionDuration;
    });
  expect(duration === '0s' || duration === '0ms').toBeTruthy();
  await app.close();
});
