import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { callTool } from './tools.ts';
import { moveToTrash, restoreFromTrash } from './trash.ts';

for (const [name, bytes] of [
  ['bytes.bin', Buffer.from([0xff, 0xfe, 0x80, 0x41])],
  [
    'pixel.png',
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=',
      'base64',
    ),
  ],
] as const) {
  for (const operation of ['move', 'trash']) {
    test(`desfazer ${operation} preserva os bytes e hash de ${name}`, (t) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-binary-'));
      const trash = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-trash-'));
      const previous = process.env.XDG_DATA_HOME;
      process.env.XDG_DATA_HOME = trash;
      t.after(() => {
        if (previous === undefined) delete process.env.XDG_DATA_HOME;
        else process.env.XDG_DATA_HOME = previous;
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(trash, { recursive: true, force: true });
      });
      fs.writeFileSync(path.join(root, name), bytes);
      const input = { libraryPath: root, origin: 'cli' };
      if (operation === 'move')
        callTool('entry.move', { ...input, from: name, to: 'destino/' + name });
      else callTool('entry.trash', { ...input, path: name });
      callTool('history.undo', input);
      const restored = fs.readFileSync(path.join(root, name));
      assert.deepEqual(restored, bytes);
      const hash = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');
      assert.equal(hash(restored), hash(bytes));
    });
  }
}

test('lixeira devolve o caminho dos metadados sem substituir separadores', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-trash-path-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'nota.md');
  fs.writeFileSync(file, 'original');
  const result = moveToTrash(file, { trashRoot: path.join(root, 'trash') });
  assert.equal(
    result.infoPath,
    path.join(root, 'trash', 'info', path.basename(result.trashPath) + '.trashinfo'),
  );
  assert.match(fs.readFileSync(result.infoPath, 'utf8'), /^\[Trash Info\]/);
  assert.equal(fs.readFileSync(result.trashPath, 'utf8'), 'original');
});

test('restore da lixeira do sistema usa o sufixo quando o caminho existe', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-restore-sufixo-'));
  const library = path.join(root, 'biblioteca');
  const trash = path.join(root, 'trash');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(library, 'Diário'), { recursive: true });
  const file = path.join(library, 'Diário', '2026-11-21.md');
  fs.writeFileSync(file, 'velha\n');
  const moved = moveToTrash(file, { trashRoot: trash });
  fs.writeFileSync(file, 'nova\n');
  const restored = restoreFromTrash(library, path.basename(moved.trashPath), { trashRoot: trash });
  assert.match(restored.path, / \(restaurado\)\.md$/);
  assert.equal(restored.restored, true);
  assert.equal('conflict' in restored, false);
  assert.match(fs.readFileSync(file, 'utf8'), /nova/);
  assert.match(fs.readFileSync(path.join(library, ...restored.path.split('/')), 'utf8'), /velha/);
});
