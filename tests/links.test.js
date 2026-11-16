const { test } = require('node:test');
const assert = require('node:assert/strict');
const links = require('../src/note-links');
const md = require('../src/editor/markdown');
test('wikilinks e aliases viram links visuais sem escapar seu destino', () => {
  const d = md.decode('Veja [[Pesquisa]] e [[Pasta/Ideia#Detalhes|um detalhe]].\n');
  assert.match(d.blocks[0].html, /href="notas1-wiki:Pesquisa"/);
  assert.match(d.blocks[0].html, /Pasta%2FIdeia%23Detalhes%7Cum%20detalhe/);
  assert.match(d.blocks[0].html, />um detalhe<\/a>/);
});
test('resolver nota, caminho, título, bloco e ambiguidade na mesma área', () => {
  const paths = ['A.md', 'Pasta/A.md', 'Pasta/B.md', 'Outra/A.md'];
  assert.equal(links.resolve('A', 'Pasta/B.md', paths).path, 'Pasta/A.md');
  assert.equal(links.resolve('Pasta/A#Título|Alias', 'A.md', paths).path, 'Pasta/A.md');
  assert.equal(links.resolve('#^bloco', 'Pasta/B.md', paths).path, 'Pasta/B.md');
  assert.equal(links.resolve('../A.md', 'Pasta/B.md', paths, 'markdown').path, 'A.md');
  assert.equal(links.resolve('../A', 'Pasta/B.md', paths).invalid, false);
  const ambiguous = links.resolve('A', 'Vazia/Raiz.md', paths);
  assert.equal(ambiguous.path, null);
  assert.equal(ambiguous.candidates.length, 3);
});
test('links fora da área, esquemas, metadados e nomes inválidos são rejeitados', () => {
  for (const s of ['/tmp/A', '../../A', 'javascript:alert(1)', '.notas1/world'])
    assert.equal(links.resolve(s, 'A.md', ['A.md']).invalid, true, s);
  assert.equal(links.createPath('Pasta/Nova', 'A.md'), 'Pasta/Nova.md');
  assert.equal(links.createPath('../../Fora', 'Pasta/A.md'), null);
  assert.equal(links.safeHref('javascript:alert(1)'), false);
});
test('scanner ignora frontmatter, código e escapes e distingue embeds de links', () => {
  const source =
    '---\nref: [[Ignorar]]\n---\n[[Existe|apelido]] e [Um](Pasta/A.md#Título)\n\n`[[Código]]`\n\n```md\n[[Cerca]]\n```\n\n\\[[Escapado]] ![[Embed]]\n';
  assert.deepEqual(
    links.scan(source).map((l) => l.target),
    ['Existe', 'Pasta/A.md#Título', 'Embed'],
  );
  assert.equal(links.scan(source).at(-1).format, 'embed');
});
test('títulos são indexados sem capturar cabeçalhos em código', () => {
  assert.deepEqual(
    links.headings('# Um\n\n## Dois\n\n```md\n# Três\n```\n').map((h) => h.text),
    ['Um', 'Dois'],
  );
});
test('renomear atualiza links de entrada e caminhos relativos sem alterar código ou aliases', () => {
  const { rewriteDocument } = require('../src/link-rewrite');
  const paths = ['Origem.md', 'Pasta/Alvo.md', 'Pasta/Outra.md'];
  const map = (p) => (p === 'Pasta/Alvo.md' ? 'Nova/Nome.md' : p);
  const content = '[[Pasta/Alvo#Detalhes|apelido]] e [Texto](Pasta/Alvo.md)\n\n`[[Pasta/Alvo]]`\n';
  const out = rewriteDocument(content, 'Origem.md', paths, map);
  assert.match(out, /\[\[Nova\/Nome#Detalhes\|apelido\]\]/);
  assert.match(out, /\[Texto\]\(Nova\/Nome.md\)/);
  assert.match(out, /`\[\[Pasta\/Alvo\]\]`/);
  const moved = rewriteDocument('[Outra](Outra.md)\n', 'Pasta/Alvo.md', paths, map);
  assert.equal(moved, '[Outra](../Pasta/Outra.md)\n');
});
test('atualização nativa de links preserva propriedades e apresentação do motor', () => {
  const { rewriteDocument } = require('../src/link-rewrite');
  const body = '[[Alvo]]\n';
  const meta = {
    bodyHash: md.hash(body),
    metadata: { icon: '🌿' },
    presentation: [{ id: 'bloco', type: 'text', color: 'sage', children: [] }],
  };
  const original = '---\nnotas1_editor: ' + JSON.stringify(meta) + '\n---\n' + body;
  const rewritten = rewriteDocument(original, 'Origem.md', ['Origem.md', 'Alvo.md'], (p) =>
    p === 'Alvo.md' ? 'Novo.md' : p,
  );
  const restored = md.decode(rewritten);
  assert.equal(restored.metadata.icon, '🌿');
  assert.equal(restored.blocks[0].color, 'sage');
  assert.match(restored.blocks[0].html, /notas1-wiki:Novo/);
});
