import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { openLibrary } from './library.ts';
import { readShelfStyles, writeShelfStyle } from './shelves.ts';
import { callTool } from './tools.ts';

test('a cor e o ícone da estante ficam em .sophy/estantes.json', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-estante-'));
  const library = openLibrary(root);
  assert.deepEqual(readShelfStyles(library), {});
  const saved = writeShelfStyle(library, 'Estudos', { color: 3, icon: 'capelo' });
  assert.equal(saved.Estudos.icon, 'capelo');
  assert.equal(readShelfStyles(library).Estudos.color, 3);
  assert.equal(fs.existsSync(path.join(root, '.sophy', 'estantes.json')), true);
  const listed = callTool('shelf.style.list', { libraryPath: root }) as Record<string, { icon: string }>;
  assert.equal(listed.Estudos.icon, 'capelo');
});
