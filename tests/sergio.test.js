const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('a lixeira copia quando o rename cruza de disco', async () => {
  const { moveToTrash } = await import('../engine/trash.ts');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-trash-'));
  const source = path.join(root, 'nota.md');
  const trash = path.join(root, 'lixo');
  fs.writeFileSync(source, 'oi');
  const original = fs.renameSync;
  fs.renameSync = () => {
    const error = new Error('EXDEV');
    error.code = 'EXDEV';
    throw error;
  };
  try {
    const moved = moveToTrash(source, { trashRoot: trash });
    assert.equal(fs.existsSync(source), false);
    assert.equal(fs.readFileSync(moved.trashPath, 'utf8'), 'oi');
  } finally {
    fs.renameSync = original;
  }
});

test('busca ignora acento e nome reservado é recusado', async () => {
  const { fold } = await import('../engine/search.ts');
  const { validateSegment } = await import('../engine/paths.ts');
  assert.equal(fold('coração'), 'coracao');
  assert.throws(() => validateSegment('CON'), /reservado pelo Windows/);
  assert.throws(() => validateSegment('Aula: 1'), /caractere/);
});

test('wikilink não engole um [[ seguinte', () => {
  const doc = require('../src/ui/doc');
  const parts = doc.parseInlines('[[Capitulo e [[Inexistente Nova]]');
  const links = parts.filter((part) => part.type === 'wikilink');
  assert.deepEqual(links.map((part) => part.target), ['Inexistente Nova']);
  const closed = doc.parseInlines('veja [[Nota]] e [[Outra]]');
  assert.equal(closed.filter((part) => part.type === 'wikilink').length, 2);
});

test('a Sofi não recebe tools que saem da biblioteca', async () => {
  const { agentTools } = await import('../engine/agent.ts');
  const names = agentTools().map((tool) => tool.function.name);
  for (const blocked of ['site.export', 'vault.import', 'entry.trash', 'version.restore'])
    assert.equal(names.includes(blocked), false);
});
