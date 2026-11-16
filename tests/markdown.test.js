const { test } = require('node:test');
const assert = require('node:assert/strict');
const md = require('../src/editor/markdown');
const inline = (html) => html.replace(/<b>(.*?)<\/b>/g, '**$1**').replace(/<[^>]+>/g, '');
test('Markdown vira blocos com formatação, listas aninhadas, tarefas, tabela e código', () => {
  const d = md.decode(
    '# Título\n\n**Negrito** e *itálico*\n\n- item\n    - filho\n- [x] tarefa\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```js\nconst n = 1;\n```\n',
  );
  assert.deepEqual(
    d.blocks.map((b) => b.type),
    ['h1', 'text', 'bullet', 'todo', 'table', 'code'],
  );
  assert.match(d.blocks[1].html, /<strong>Negrito/);
  assert.equal(d.blocks[2].children[0].html, 'filho');
  assert.equal(d.blocks[3].checked, true);
  assert.equal(d.blocks[5].language, 'js');
});
test('metadados e frontmatter externo persistem e corpo continua Markdown', () => {
  const source = '---\nauthor: Kayky\n---\n# Olá\n\nTexto\n';
  const decoded = md.decode(source);
  const state = {
    blocks: decoded.blocks,
    icon: '🌿',
    properties: [{ id: 'status', name: 'Status', type: 'text', value: 'Ideia' }],
  };
  const encoded = md.encode(state, decoded, inline);
  assert.match(encoded, /author: Kayky/);
  assert.match(encoded, /# Olá/);
  const restored = md.decode(encoded);
  assert.equal(restored.metadata.icon, '🌿');
  assert.equal(restored.metadata.properties[0].value, 'Ideia');
  assert.equal(restored.blocks[0].id, decoded.blocks[0].id);
});
test('alteração externa no corpo prevalece sobre apresentação anterior', () => {
  const d = md.decode('Texto original\n');
  d.blocks[0].color = 'sage';
  const content = md
    .encode({ blocks: d.blocks }, d, inline)
    .replace('Texto original', 'Texto externo');
  const result = md.decode(content);
  assert.equal(result.blocks[0].html, 'Texto externo');
  assert.equal(result.blocks[0].color, undefined);
});
test('sintaxe não suportada é preservada como Markdown e não descartada', () => {
  const source = '![Foto](foto.png)\n\n<div>HTML externo</div>\n';
  const d = md.decode(source);
  assert.equal(
    d.blocks.every((b) => b.rawMarkdown),
    true,
  );
  const out = md.encode({ blocks: d.blocks }, d, inline);
  assert.ok(out.endsWith(source));
});
test('CRLF preserva apresentação em ciclos de leitura e escrita', () => {
  const d = md.decode('Texto\r\n');
  const state = { blocks: d.blocks };
  state.blocks[0].color = 'rose';
  const out = md.encode(state, d, inline);
  assert.equal(md.decode(out).blocks[0].color, 'rose');
});
test('hierarquia visual não representável em Markdown conserva estrutura sem ignorar edição externa', () => {
  const d = md.decode('Título\n');
  d.blocks[0].type = 'h2';
  d.blocks[0].children = [{ id: 'filho', type: 'text', html: 'Texto aninhado', children: [] }];
  const out = md.encode({ blocks: d.blocks }, d, inline);
  const restored = md.decode(out);
  assert.deepEqual(restored.blocks, d.blocks);
  const external = out.replace(/## Título/, '## Título externo');
  assert.equal(md.decode(external).blocks[0].html, 'Título externo');
});
