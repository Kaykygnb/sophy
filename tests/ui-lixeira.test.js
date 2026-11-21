const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Trash = require('../src/ui/lixeira');
const commands = require('../src/ui/commands');

const now = new Date(2026, 10, 21, 15, 30, 0);

function at(offsetMs) {
  return new Date(now.getTime() - offsetMs).toISOString();
}

test('a data relativa cobre agora, minutos, horas, ontem e dias', () => {
  assert.equal(Trash.formatDeletedAt(at(20 * 1000), now).relative, 'agora');
  assert.equal(Trash.formatDeletedAt(at(60 * 1000), now).relative, 'há 1 min');
  assert.equal(Trash.formatDeletedAt(at(5 * 60 * 1000), now).relative, 'há 5 min');
  assert.equal(Trash.formatDeletedAt(at(3 * 60 * 60 * 1000), now).relative, 'há 3 h');
  assert.equal(Trash.formatDeletedAt(at(60 * 60 * 1000), now).relative, 'há 1 h');

  const yesterday = new Date(2026, 10, 20, 9, 0, 0).toISOString();
  assert.equal(Trash.formatDeletedAt(yesterday, now).relative, 'ontem');

  const threeDays = new Date(2026, 10, 18, 15, 30, 0).toISOString();
  assert.equal(Trash.formatDeletedAt(threeDays, now).relative, 'há 3 dias');

  const sameYear = Trash.formatDeletedAt(new Date(2026, 9, 2, 8, 0, 0).toISOString(), now);
  assert.equal(sameYear.relative, '2 de out.');
  assert.match(sameYear.full, /sexta-feira, 2 de outubro de 2026 às 08:00/);

  const otherYear = Trash.formatDeletedAt(new Date(2025, 10, 21, 8, 15, 0).toISOString(), now);
  assert.equal(otherYear.relative, '21 de nov. de 2025');
  assert.match(otherYear.full, /21 de novembro de 2025 às 08:15/);

  assert.deepEqual(Trash.formatDeletedAt('nao-e-data', now), {
    relative: 'nao-e-data',
    full: 'nao-e-data',
  });
  assert.deepEqual(Trash.formatDeletedAt('', now), { relative: '', full: '' });
});

test('o tamanho usa B, KB, MB e GB com vírgula', () => {
  assert.equal(Trash.formatSize(0), '0 B');
  assert.equal(Trash.formatSize(-4), '0 B');
  assert.equal(Trash.formatSize(Number.NaN), '0 B');
  assert.equal(Trash.formatSize(512), '512 B');
  assert.equal(Trash.formatSize(1024), '1 KB');
  assert.equal(Trash.formatSize(1536), '1,5 KB');
  assert.equal(Trash.formatSize(10 * 1024), '10 KB');
  assert.equal(Trash.formatSize(1024 * 1024), '1 MB');
  assert.equal(Trash.formatSize(2.5 * 1024 * 1024), '2,5 MB');
  assert.equal(Trash.formatSize(1024 ** 3), '1 GB');
});

test('a ordenação é da exclusão mais recente para a mais antiga', () => {
  const items = [
    { id: '1000-aaaaaaaa', deletedAt: '2026-01-01T00:00:00.000Z', title: 'antiga' },
    { id: '3000-cccccccc', deletedAt: '2026-03-01T00:00:00.000Z', title: 'nova' },
    { id: '2000-bbbbbbbb', deletedAt: '2026-03-01T00:00:00.000Z', title: 'empate' },
    { id: '0500-dddddddd', deletedAt: '2025-12-01T00:00:00.000Z', title: 'velha' },
  ];
  assert.deepEqual(
    Trash.sortTrash(items).map((item) => item.title),
    ['nova', 'empate', 'antiga', 'velha'],
  );
  assert.deepEqual(Trash.sortTrash(null), []);
  assert.deepEqual(
    items.map((item) => item.title),
    ['antiga', 'nova', 'empate', 'velha'],
  );
});

test('o filtro aceita tipo, acento e caminho', () => {
  const items = [
    {
      id: '3-aaaaaaaa',
      deletedAt: '2026-03-01T00:00:00.000Z',
      title: 'Ação & café',
      originalPath: 'Estudos/Ação & café.md',
      kind: 'note',
    },
    {
      id: '2-bbbbbbbb',
      deletedAt: '2026-02-01T00:00:00.000Z',
      title: 'Mapa',
      originalPath: 'Estudos/Mapa.canvas',
      kind: 'canvas',
    },
    {
      id: '1-cccccccc',
      deletedAt: '2026-01-01T00:00:00.000Z',
      title: 'foto.png',
      originalPath: 'Anexos/foto.png',
      kind: 'attachment',
    },
  ];
  assert.deepEqual(
    Trash.filterTrash(items, { query: 'acao' }).map((item) => item.kind),
    ['note'],
  );
  assert.deepEqual(
    Trash.filterTrash(items, { query: 'anexos' }).map((item) => item.title),
    ['foto.png'],
  );
  assert.deepEqual(
    Trash.filterTrash(items, { kind: 'canvas' }).map((item) => item.title),
    ['Mapa'],
  );
  assert.equal(Trash.filterTrash(items, { query: 'sumiu' }).length, 0);
  assert.deepEqual(
    Trash.filterTrash(items, {}).map((item) => item.id),
    ['3-aaaaaaaa', '2-bbbbbbbb', '1-cccccccc'],
  );
});

test('ícone, rótulo e contador da lixeira', () => {
  assert.equal(Trash.kindIcon('note'), 'nota');
  assert.equal(Trash.kindIcon('canvas'), 'canvas');
  assert.equal(Trash.kindIcon('attachment'), 'anexo');
  assert.equal(Trash.kindIcon('folder'), 'pasta');
  assert.equal(Trash.kindIcon('outro'), 'pagina');
  assert.equal(Trash.kindLabel('folder'), 'Pasta');
  assert.equal(Trash.countLabel(0), '0 itens');
  assert.equal(Trash.countLabel(1), '1 item');
  assert.equal(Trash.countLabel(12), '12 itens');
});

test('o seletor de arquivos aceita lista crua ou envelope, e o link externo só falha com erro', () => {
  assert.deepEqual(commands.chosenFileList(['/tmp/a.png', '', 2, '/tmp/b.png']), [
    '/tmp/a.png',
    '/tmp/b.png',
  ]);
  assert.deepEqual(commands.chosenFileList({ ok: true, value: [] }), []);
  assert.deepEqual(commands.chosenFileList({ ok: true, value: ['/tmp/a.png'] }), ['/tmp/a.png']);
  assert.deepEqual(commands.chosenFileList(null), []);
  assert.throws(
    () => commands.chosenFileList({ ok: false, error: 'cancelado pelo sistema' }),
    /cancelado/,
  );

  assert.equal(commands.externalOpenError({ ok: true, value: true }), '');
  assert.equal(commands.externalOpenError(true), '');
  assert.equal(commands.externalOpenError({ ok: false, error: 'Só http.' }), 'Só http.');
  assert.match(commands.externalOpenError(false), /Não foi possível/);
});

test('restore, purge, empty e deletePermanent passam pelo gate com origem ui', async () => {
  for (const name of ['trash.restore', 'trash.purge', 'trash.empty', 'note.deletePermanent']) {
    assert.equal(commands.ORIGIN_TOOLS.has(name), true, name);
    const prepared = commands.prepareCall(
      name,
      { id: '1', path: 'Nota.md', origin: 'mcp' },
      '/bib',
    );
    assert.equal(prepared.origin, 'ui');
    assert.equal(prepared.libraryPath, '/bib');
  }
  const listed = commands.prepareCall('trash.list', { origin: 'mcp' }, '/bib');
  assert.equal(listed.origin, undefined);

  const engine = await import('../engine/tools.ts');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-ui-lixeira-'));
  fs.writeFileSync(path.join(root, 'Nota.md'), 'oi\n');
  fs.writeFileSync(path.join(root, 'Outra.md'), 'x\n');
  let current = null;
  const gate = commands.createToolGate({
    call: engine.callTool,
    libraryPath: () => current,
    setLibraryPath: (value) => {
      current = value;
    },
  });
  gate('library.open', { path: root });
  const trashed = gate('entry.trash', { path: 'Nota.md' });
  assert.equal(trashed.trashed, true);
  const listedItems = gate('trash.list', {});
  assert.equal(listedItems.length, 1);
  assert.equal(listedItems[0].kind, 'note');
  const restored = gate('trash.restore', { id: listedItems[0].id });
  assert.equal(restored.path, 'Nota.md');
  assert.equal(fs.existsSync(path.join(root, 'Nota.md')), true);
  gate('entry.trash', { path: 'Nota.md' });
  const again = gate('trash.list', {});
  gate('trash.purge', { id: again[0].id });
  assert.equal(gate('trash.list', {}).length, 0);
  gate('note.deletePermanent', { path: 'Outra.md' });
  assert.equal(fs.existsSync(path.join(root, 'Outra.md')), false);
  assert.deepEqual(gate('trash.empty', {}), { purged: 0 });
});
