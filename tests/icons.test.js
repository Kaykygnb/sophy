const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const { render } = require(path.join(root, 'scripts', 'build-icons'));

function read(file) {
  return fs
    .readFileSync(file, 'utf8')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n');
}

function symbolIds(svg) {
  return [...svg.matchAll(/id="(i-[a-z0-9-]+)"/g)].map((match) => match[1]);
}

function contrast(hexA, hexB) {
  const channel = (hex, shift) => {
    const value = (parseInt(hex.slice(1), 16) >> shift) & 255;
    const ratio = value / 255;
    return ratio <= 0.03928 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4;
  };
  const lum = (hex) =>
    0.2126 * channel(hex, 16) + 0.7152 * channel(hex, 8) + 0.0722 * channel(hex, 0);
  const left = lum(hexA);
  const right = lum(hexB);
  const [hi, lo] = left > right ? [left, right] : [right, left];
  return (hi + 0.05) / (lo + 0.05);
}

test('o sprite gerado cobre só os glifos pedidos e o Fill existe', () => {
  const rendered = render();
  const spritePath = path.join(root, 'src', 'ui', 'assets', 'sprite.svg');
  const manifestPath = path.join(root, 'src', 'ui', 'assets', 'icons-manifest.json');
  const dataPath = path.join(root, 'src', 'ui', 'assets', 'icons-data.js');
  assert.equal(read(spritePath), rendered.sprite);
  assert.deepEqual(JSON.parse(read(manifestPath)), rendered.manifest);
  assert.equal(read(dataPath), rendered.data);

  const ids = new Set(symbolIds(rendered.sprite));
  for (const name of rendered.used) {
    assert.ok(ids.has(`i-${name}`), `falta #i-${name}`);
  }
  for (const id of ids) {
    const fill = id.endsWith('-fill');
    const name = fill ? id.slice(2, -5) : id.slice(2);
    assert.ok(rendered.used.includes(name), `símbolo órfão ${id}`);
    if (fill) assert.ok(rendered.fillNames.includes(name), `Fill sem par ${id}`);
    else if (rendered.fillNames.includes(name))
      assert.ok(ids.has(`${id}-fill`), `falta Fill de ${name}`);
  }

  const commands = read(path.join(root, 'src', 'ui', 'commands.js'));
  assert.equal(commands.includes("icone: 'ajuste'"), false);
  assert.equal(commands.includes("icone: 'olho'"), false);
  assert.equal(commands.includes("icone: 'gear'"), true);
  assert.equal(commands.includes("icone: 'arrows-in'"), true);
});

test('a cor do ícone passa de 3:1 no claro e no escuro', () => {
  const css = read(path.join(root, 'src', 'ui', 'assets', 'tokens.css'));
  const [light, dark] = css.split(':root[data-theme="dark"]');
  const pick = (block, name) => {
    const match = block.match(new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`));
    assert.ok(match, name);
    return match[1];
  };
  const pairs = [
    ['repouso na lateral', pick(light, '--ink-2'), pick(light, '--sidebar')],
    ['repouso na superfície', pick(light, '--ink-2'), pick(light, '--surface')],
    ['hover', pick(light, '--ink'), pick(light, '--hover')],
    ['ativo', pick(light, '--accent'), pick(light, '--sel')],
    ['repouso na lateral escura', pick(dark, '--ink-2'), pick(dark, '--sidebar')],
    ['repouso na superfície escura', pick(dark, '--ink-2'), pick(dark, '--surface')],
    ['hover escuro', pick(dark, '--ink'), pick(dark, '--hover')],
    ['ativo escuro', pick(dark, '--accent'), pick(dark, '--sel')],
  ];
  for (let index = 1; index <= 8; index += 1) {
    pairs.push(
      [`estante ${index} clara`, pick(light, `--shelf-${index}`), pick(light, '--sidebar')],
      [`estante ${index} escura`, pick(dark, `--shelf-${index}`), pick(dark, '--sidebar')],
    );
  }
  for (const [label, ink, surface] of pairs) {
    const ratio = contrast(ink, surface);
    assert.ok(ratio >= 3, `${label} ficou em ${ratio.toFixed(2)}:1`);
  }
});

test('a transição do ícone usa 180ms e respeita reduced motion', () => {
  const css = read(path.join(root, 'src', 'ui', 'assets', 'icons.css'));
  const tokens = read(path.join(root, 'src', 'ui', 'assets', 'tokens.css'));
  assert.match(css, /transition:\s*color var\(--dur-medium\) var\(--ease\)/);
  assert.match(css, /transition:\s*opacity var\(--dur-medium\) var\(--ease\)/);
  assert.match(tokens, /--dur-medium:\s*180ms/);
  assert.match(tokens, /--ease:\s*cubic-bezier\(\.2,\s*\.8,\s*\.2,\s*1\)/);
  assert.match(tokens, /@media \(prefers-reduced-motion:\s*reduce\)/);
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*transition:\s*none/);
});
