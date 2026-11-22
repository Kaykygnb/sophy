const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sectionsOf, anchorExists, headingsOf } = require('../engine/wikilinks.ts');
const { openLibrary } = require('../engine/library.ts');
const { catalogNotes, outgoingLinks } = require('../engine/links.ts');

test('seções vão do H1–H3 até o próximo título do mesmo nível ou maior', () => {
  const body = [
    '# Um',
    'a',
    '## Dois',
    'b',
    '### Tres',
    'c',
    '## Quatro',
    'd',
    '# Cinco',
    'e',
  ].join('\n');
  const sections = sectionsOf(body);
  assert.deepEqual(
    sections.map((item) => [item.title, item.level]),
    [
      ['Um', 1],
      ['Dois', 2],
      ['Tres', 3],
      ['Quatro', 2],
      ['Cinco', 1],
    ],
  );
  assert.equal(body.slice(sections[0].start, sections[0].end).includes('## Quatro'), true);
  assert.equal(body.slice(sections[0].start, sections[0].end).includes('# Cinco'), false);
  assert.equal(body.slice(sections[1].start, sections[1].end).includes('### Tres'), true);
  assert.equal(body.slice(sections[1].start, sections[1].end).includes('## Quatro'), false);
});

test('link para seção inexistente fica quebrado e o catálogo lista seções', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-secoes-'));
  fs.mkdirSync(path.join(root, 'Estudos'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Estudos', 'A.md'), '# A\n\n## Secao boa\n\nTexto.\n\n[[A#Secao boa]]\n[[A#Secao velha]]\n');
  const library = openLibrary(root);
  const catalog = catalogNotes(library);
  const note = catalog.find((item) => item.path === 'Estudos/A.md');
  assert.ok(note.sections.some((section) => section.title === 'Secao boa'));
  assert.equal(anchorExists(note.headings, note.blockIds, 'Secao boa'), true);
  assert.equal(anchorExists(note.headings, note.blockIds, 'Secao velha'), false);
  const links = outgoingLinks(library, 'Estudos/A.md');
  const good = links.find((link) => link.anchor === 'Secao boa');
  const broken = links.find((link) => link.anchor === 'Secao velha');
  assert.equal(good?.status, 'resolved');
  assert.equal(broken?.status, 'broken');
  assert.deepEqual(headingsOf('# A\n\n## Secao boa\n'), ['A', 'Secao boa']);
});
