/**
 * Monta o sprite da janela a partir do Phosphor (@phosphor-icons/core)
 * e, enquanto um nome antigo ainda é pedido pelo código, do sprite legado.
 * Só entram glifos referenciados. Fill acompanha o Regular, exceto semFill.
 *
 * Uso: node scripts/build-icons.js
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const catalog = require('./icons-catalog');
const phosphorRoot = path.join(root, 'node_modules', '@phosphor-icons', 'core');
const legacyPath = path.join(root, 'scripts', 'sprite-legado.svg');
const outSprite = path.join(root, 'src', 'ui', 'assets', 'sprite.svg');
const outManifest = path.join(root, 'src', 'ui', 'assets', 'icons-manifest.json');
const outData = path.join(root, 'src', 'ui', 'assets', 'icons-data.js');

const catalogByName = new Map(
  catalog.glifos.map(([nome, rotulo, categoria]) => [
    nome,
    { nome, rotulo, categoria, fill: !catalog.semFill.includes(nome) },
  ]),
);

function read(file) {
  return fs
    .readFileSync(file, 'utf8')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n');
}

function walkJs(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkJs(full, acc);
    else if (entry.name.endsWith('.js') && entry.name !== 'icons-data.js') acc.push(full);
  }
  return acc;
}

function firstArgument(inner) {
  let depth = 0;
  let quote = '';
  for (let index = 0; index < inner.length; index += 1) {
    const char = inner[index];
    if (quote) {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (char === quote) quote = '';
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    else if (char === ',' && depth === 0) return inner.slice(0, index);
  }
  return inner;
}

function addQuoted(names, chunk) {
  for (const match of chunk.matchAll(/'([a-z0-9-]+)'/g)) names.add(match[1]);
}

function knownIconName(name, legacy) {
  return catalogByName.has(name) || legacy.has(name);
}

function collectUsedNames(source, legacy) {
  const names = new Set();
  const required = new Set();
  const remember = (name, mustExist) => {
    if (mustExist || knownIconName(name, legacy)) {
      names.add(name);
      if (mustExist) required.add(name);
    }
  };
  let cursor = 0;
  while (cursor < source.length) {
    const at = source.indexOf('icon(', cursor);
    if (at < 0) break;
    const before = source[at - 1];
    if (before && /[A-Za-z0-9_]/.test(before)) {
      cursor = at + 5;
      continue;
    }
    let depth = 1;
    let quote = '';
    let index = at + 5;
    for (; index < source.length && depth > 0; index += 1) {
      const char = source[index];
      if (quote) {
        if (char === '\\') {
          index += 1;
          continue;
        }
        if (char === quote) quote = '';
        continue;
      }
      if (char === "'" || char === '"') {
        quote = char;
        continue;
      }
      if (char === '(') depth += 1;
      else if (char === ')') depth -= 1;
    }
    const arg = firstArgument(source.slice(at + 5, index - 1)).trim();
    const exact = arg.match(/^'([a-z0-9-]+)'$/);
    if (exact) remember(exact[1], true);
    else {
      for (const match of arg.matchAll(/'([a-z0-9-]+)'/g)) {
        if (catalogByName.has(match[1])) remember(match[1], true);
      }
    }
    const around = source.slice(Math.max(0, at - 1600), at);
    if (
      /icon\(glyph\)\s*$/.test(source.slice(at, at + 12)) ||
      source.slice(at, at + 11) === 'icon(glyph)'
    ) {
      for (const match of around.matchAll(/\['[a-z0-9-]+',\s*'([a-z0-9-]+)',\s*'[^']*'\]/g)) {
        if (knownIconName(match[1], legacy)) remember(match[1], true);
      }
      for (const match of around.matchAll(/\['[a-z0-9-]+',\s*'[^']+',\s*'([a-z0-9-]+)'\]/g)) {
        if (knownIconName(match[1], legacy)) remember(match[1], true);
      }
      for (const match of around.matchAll(/\['[^']+',\s*'([a-z0-9-]+)',\s*'[^']*',\s*'[^']*'\]/g)) {
        remember(match[1], true);
      }
    }
    cursor = index;
  }
  for (const match of source.matchAll(/\b(?:icone|icon):\s*'([a-z0-9-]+)'/g))
    remember(match[1], true);
  const shelfIcons = source.match(/const SHELF_ICONS = \{([\s\S]*?)\n  \};/);
  if (shelfIcons) {
    for (const match of shelfIcons[1].matchAll(/:\s*'([a-z0-9-]+)'/g)) remember(match[1], true);
  }
  const shelfMark = source.match(/function shelfMark\(name\) \{([\s\S]*?)\n  \}/);
  if (shelfMark) {
    const list = shelfMark[1].match(/const icons = \[([\s\S]*?)\];/);
    if (list) for (const match of list[1].matchAll(/'([a-z0-9-]+)'/g)) remember(match[1], true);
  }
  const shelfDialog = source.match(/function openShelfStyle\(name\) \{([\s\S]*?)\n\}/);
  if (shelfDialog) {
    const list = shelfDialog[1].match(/const icons = \[([\s\S]*?)\];/);
    if (list) for (const match of list[1].matchAll(/'([a-z0-9-]+)'/g)) remember(match[1], true);
  }
  for (const target of Object.values(catalog.apelidos || {})) remember(target, true);
  return { names: [...names].sort(), required: [...required].sort() };
}

function legacySymbols(svg) {
  const found = new Map();
  for (const match of svg.matchAll(/<symbol id="(i-[a-z0-9-]+)"[\s\S]*?<\/symbol>/g)) {
    found.set(match[1].slice(2), match[0]);
  }
  return found;
}

function phosphorSymbol(name, weight) {
  const fileName = weight === 'fill' ? `${name}-fill.svg` : `${name}.svg`;
  const file = path.join(phosphorRoot, 'assets', weight, fileName);
  if (!fs.existsSync(file)) {
    throw new Error(`Phosphor não tem ${weight}/${fileName}. Confira o catálogo.`);
  }
  const svg = read(file);
  const viewBox = (svg.match(/viewBox="([^"]+)"/) || [])[1] || '0 0 256 256';
  const inner = svg
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .trim();
  const spec = catalogByName.get(name);
  const id = weight === 'fill' ? `i-${name}-fill` : `i-${name}`;
  const title = spec ? spec.rotulo : name;
  return `<symbol id="${id}" viewBox="${viewBox}" fill="currentColor"><title>${title}</title>${inner}</symbol>`;
}

function render() {
  if (!fs.existsSync(path.join(phosphorRoot, 'package.json'))) {
    throw new Error('Instale @phosphor-icons/core antes de gerar os ícones.');
  }
  const packageJson = JSON.parse(read(path.join(phosphorRoot, 'package.json')));
  const source = walkJs(path.join(root, 'src', 'ui'))
    .map((file) => read(file))
    .join('\n');
  const legacy = legacySymbols(read(legacyPath));
  const collected = collectUsedNames(source, legacy);
  const used = collected.names;
  const missing = [];
  const symbols = [];
  const manifestIcons = [];
  const fillNames = [];

  for (const name of used) {
    const spec = catalogByName.get(name);
    const holdLegacy = (catalog.segurarLegado || []).includes(name) && legacy.has(name);
    if (spec && !holdLegacy) {
      symbols.push(phosphorSymbol(name, 'regular'));
      manifestIcons.push({
        nome: name,
        rotulo: spec.rotulo,
        categoria: spec.categoria,
        origem: 'phosphor',
        peso: spec.fill ? ['regular', 'fill'] : ['regular'],
        sprite_id: `i-${name}`,
        fill_id: spec.fill ? `i-${name}-fill` : null,
      });
      if (spec.fill) {
        symbols.push(phosphorSymbol(name, 'fill'));
        fillNames.push(name);
      }
      continue;
    }
    const symbol = legacy.get(name);
    if (!symbol) {
      missing.push(name);
      continue;
    }
    symbols.push(symbol);
    const title = (symbol.match(/<title>([^<]*)<\/title>/) || [])[1] || name;
    manifestIcons.push({
      nome: name,
      rotulo: title,
      categoria: 'legado',
      origem: 'legado',
      peso: ['regular'],
      sprite_id: `i-${name}`,
      fill_id: null,
    });
  }

  if (missing.length) {
    throw new Error(
      `Ícones pedidos pelo código e ausentes no Phosphor e no sprite legado: ${missing.join(', ')}`,
    );
  }

  const symbolId = (symbol) => (symbol.match(/id="([^"]+)"/) || [])[1] || '';
  symbols.sort((a, b) => (symbolId(a) < symbolId(b) ? -1 : symbolId(a) > symbolId(b) ? 1 : 0));
  manifestIcons.sort((a, b) => (a.nome < b.nome ? -1 : a.nome > b.nome ? 1 : 0));
  fillNames.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const sprite = `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">\n${symbols.join('\n')}\n</svg>\n`;
  const manifest = {
    nome: 'Sophy · ícones da janela',
    pacote: '@phosphor-icons/core',
    licenca: 'MIT',
    versaoPacote: packageJson.version,
    geradoPor: 'scripts/build-icons.js',
    regras: {
      repouso: 'Phosphor Regular',
      ativo:
        'Phosphor Fill quando o controle está ativo (aria-current, aria-selected, aria-pressed, aria-expanded ou is-escolhida)',
      corRepouso: '--ink-2',
      corHover: '--ink',
      corAtivo: '--accent',
      corEstante: '--estante-cor',
      transicao: '180ms cubic-bezier(.2, .8, .2, 1)',
      reducedMotion: 'a duração vai a 0 com prefers-reduced-motion e com a classe motion-reduce',
      cor: 'currentColor',
    },
    apelidos: catalog.apelidos || {},
    icones: manifestIcons,
  };
  const fillList = fillNames.map((name) => `    '${name}',`).join('\n');
  const data =
    '/* Gerado por scripts/build-icons.js. Não edite à mão. */\n' +
    'window.SophyIconsData = {\n' +
    '  fill: [\n' +
    (fillList ? `${fillList}\n` : '') +
    '  ],\n' +
    '};\n';
  return { sprite, manifest, data, used, fillNames };
}

function writeOutputs() {
  const rendered = render();
  fs.writeFileSync(outSprite, rendered.sprite);
  fs.writeFileSync(outManifest, `${JSON.stringify(rendered.manifest, null, 2)}\n`);
  fs.writeFileSync(outData, rendered.data);
  return rendered;
}

if (require.main === module) {
  const rendered = writeOutputs();
  process.stdout.write(
    `Sprite com ${rendered.used.length} glifos (${rendered.fillNames.length} com Fill).\n`,
  );
}

module.exports = { render, writeOutputs, collectUsedNames, catalogByName };
