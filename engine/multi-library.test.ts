import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { libraryCatalog, readCatalog } from './catalog.ts';
import { splitMarkdown } from './markdown.ts';

function noteBody(file: string) {
  return splitMarkdown(fs.readFileSync(file, 'utf8')).body;
}

test('biblioteca indisponível não impede listar as outras cadastradas', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-catalog-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const missing = path.join(root, 'indisponivel');
  const file = path.join(root, 'ui.json');
  fs.writeFileSync(file, JSON.stringify({ libraryPath: missing, libraries: [missing, root] }));
  const entries = libraryCatalog(readCatalog(file));
  assert.equal(entries.length, 2);
  assert.equal(entries[0].available, false);
  assert.equal(entries[1].available, true);
});

for (const write of [false, true]) {
  test(`MCP multi-biblioteca isola arquivos, revisões e permissões (escrita=${write})`, async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-multi-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const libraries = ['Primeira', 'Segunda'].map((name) => {
      const folder = path.join(root, name);
      fs.mkdirSync(folder);
      fs.writeFileSync(path.join(folder, 'Nota.md'), name + '\n');
      return folder;
    });
    const catalog = path.join(root, 'ui.json');
    fs.writeFileSync(catalog, JSON.stringify({ libraryPath: libraries[0], libraries }));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        '--experimental-strip-types',
        path.resolve('engine/cli.ts'),
        'mcp',
        '--todas-bibliotecas',
        '--catalogo',
        catalog,
        ...(write ? ['--escrita'] : []),
      ],
      stderr: 'pipe',
    });
    const client = new Client({ name: 'multi-test', version: '1' });
    await client.connect(transport);
    try {
      const call = (name: string, args: Record<string, unknown> = {}) =>
        client.callTool({ name, arguments: args });
      const json = (result: any) => JSON.parse(result.content[0].text);
      const entries = json(await call('library.list')) as Array<{ id: string; root: string }>;
      assert.equal(entries.length, 2);
      const second = entries.find((entry) => entry.root === libraries[1])!;
      const read = json(
        await call('note.read', {
          path: 'Nota.md',
          libraryId: second.id,
          libraryPath: libraries[0],
        }),
      );
      assert.equal(read.body, 'Segunda\n');
      const resource = await client.readResource({
        uri: `sophy://biblioteca/${second.id}/nota/Nota.md`,
      });
      assert.equal(splitMarkdown(resource.contents[0].text ?? '').body, 'Segunda\n');
      const saved = await call('note.write', {
        path: 'Nota.md',
        body: 'alterada',
        expectedRevision: read.revision,
        libraryId: second.id,
        origin: 'ui',
      });
      assert.equal(saved.isError === true, !write);
      assert.equal(noteBody(path.join(libraries[0], 'Nota.md')), 'Primeira\n');
      assert.equal(
        noteBody(path.join(libraries[1], 'Nota.md')),
        write ? 'alterada' : 'Segunda\n',
      );
      const denied = await call('note.read', {
        path: 'Nota.md',
        libraryId: 'nao-autorizada',
        libraryPath: root,
      });
      assert.equal(denied.isError, true);
      if (write) {
        const history = json(await call('history.list', { libraryId: second.id }));
        assert.equal(history[0].origin, 'mcp');
        assert.deepEqual(json(await call('history.list')), []);
        const conflict = await call('note.write', {
          path: 'Nota.md',
          body: 'não gravar',
          expectedRevision: read.revision,
          libraryId: second.id,
        });
        assert.equal(conflict.isError, true);
      } else {
        for (const [name, input] of [
          ['ui.setTheme', { theme: 'dark' }],
          ['ui.window', { action: 'show' }],
          ['ui.setLayout', { sidebar: true }],
        ] as const)
          assert.equal((await call(name, { ...input, libraryId: second.id })).isError, true);
      }
    } finally {
      await client.close();
    }
  });
}
