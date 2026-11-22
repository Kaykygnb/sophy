import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { runAgentTurn } from './agent.ts';
import { createNote, openLibrary } from './library.ts';
import { callTool } from './tools.ts';

function biblioteca(nome: string, dir: string) {
  const root = path.join(dir, nome);
  fs.mkdirSync(root);
  openLibrary(root);
  return root;
}

describe('bibliotecas da Sofi', { concurrency: 1 }, () => {
  test('lista, lê sem trocar e recusa id fora do catálogo', (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-libs-'));
    const anterior = process.env.SOPHY_SETTINGS_DIR;
    process.env.SOPHY_SETTINGS_DIR = dir;
    t.after(() => {
      if (anterior === undefined) delete process.env.SOPHY_SETTINGS_DIR;
      else process.env.SOPHY_SETTINGS_DIR = anterior;
      fs.rmSync(dir, { recursive: true, force: true });
    });
    const atual = biblioteca('Atual', dir);
    const outra = biblioteca('Outra', dir);
    createNote(openLibrary(outra), 'Estudos/Nota.md', 'conteúdo da outra\n');
    fs.writeFileSync(
      path.join(dir, 'ui.json'),
      JSON.stringify({ libraryPath: atual, libraries: [atual, outra] }),
    );
    const lista = callTool('library.list', { libraryPath: atual }) as Array<{
      id: string;
      name: string;
      path: string;
      current: boolean;
    }>;
    assert.equal(lista.length, 2);
    const marcada = lista.find((item) => item.current);
    const segunda = lista.find((item) => item.name === 'Outra');
    assert.equal(marcada?.path, atual);
    assert.equal(segunda !== undefined, true);
    const arvore = callTool('library.read', { id: segunda?.id, libraryPath: atual }) as {
      path: string;
      notas: Array<{ path: string }>;
    };
    assert.equal(arvore.path, outra);
    assert.equal(arvore.notas.some((nota) => nota.path === 'Estudos/Nota.md'), true);
    const nota = callTool('library.read', {
      id: segunda?.id,
      path: 'Estudos/Nota.md',
      libraryPath: atual,
    }) as { body: string; biblioteca: string };
    assert.match(nota.body, /conteúdo da outra/);
    assert.equal(nota.biblioteca, outra);
    assert.equal(fs.readFileSync(path.join(dir, 'ui.json'), 'utf8').includes(atual), true);
    assert.throws(() => callTool('library.read', { id: '../etc/passwd', libraryPath: atual }), /não encontrada/i);
    assert.throws(() => callTool('library.read', { id: outra, libraryPath: atual }), /não encontrada/i);
    assert.throws(
      () => callTool('library.read', { id: segunda?.id, path: '../segredo.md', libraryPath: atual }),
      /inválid|proibid|não/i,
    );
  });

  test('trocar pede confirmação, emite o caminho novo e a ação seguinte usa a outra pasta', async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-switch-'));
    const anterior = process.env.SOPHY_SETTINGS_DIR;
    process.env.SOPHY_SETTINGS_DIR = dir;
    t.after(() => {
      if (anterior === undefined) delete process.env.SOPHY_SETTINGS_DIR;
      else process.env.SOPHY_SETTINGS_DIR = anterior;
      fs.rmSync(dir, { recursive: true, force: true });
    });
    const atual = biblioteca('Casa', dir);
    const outra = biblioteca('Viagem', dir);
    fs.writeFileSync(
      path.join(dir, 'ui.json'),
      JSON.stringify({ libraryPath: atual, libraries: [atual, outra], theme: 'dark' }),
    );
    const id = (
      callTool('library.list', { libraryPath: atual }) as Array<{ id: string; name: string }>
    ).find((item) => item.name === 'Viagem')?.id;
    let trocou: { id: string; path: string } | undefined;
    let recusas = 0;
    const recusou = await runAgentTurn({
      libraryPath: atual,
      message: 'troque',
      key: 'chave-ficticia',
      confirm: () => false,
      onLibraryChanged: (info) => {
        trocou = info;
      },
      client: async () => {
        recusas += 1;
        if (recusas > 1) return { content: 'não troquei' };
        return { toolCalls: [{ name: 'library.switch', arguments: { id } }] };
      },
    });
    assert.equal(recusou.actions[0]?.ok, false);
    assert.match(recusou.actions[0]?.error || '', /recusou/i);
    assert.equal(trocou, undefined);
    assert.match(fs.readFileSync(path.join(dir, 'ui.json'), 'utf8'), /Casa/);
    const aceitou = await runAgentTurn({
      libraryPath: atual,
      message: 'troque e crie',
      key: 'chave-ficticia',
      confirm: (request) => {
        assert.equal(request.tool, 'library.switch');
        assert.match(request.label, /Viagem/);
        return true;
      },
      onLibraryChanged: (info) => {
        trocou = info;
      },
      client: async () => {
        if (!trocou) return { toolCalls: [{ name: 'library.switch', arguments: { id } }] };
        if (!fs.existsSync(path.join(outra, 'Diario.md'))) {
          return { toolCalls: [{ name: 'note.create', arguments: { path: 'Diario.md', body: 'lá\n' } }] };
        }
        return { content: 'feito' };
      },
    });
    assert.equal(aceitou.actions[0]?.ok, true);
    assert.equal(aceitou.actions[1]?.ok, true);
    assert.equal(trocou?.path, outra);
    assert.equal(fs.existsSync(path.join(outra, 'Diario.md')), true);
    assert.equal(fs.existsSync(path.join(atual, 'Diario.md')), false);
    const settings = JSON.parse(fs.readFileSync(path.join(dir, 'ui.json'), 'utf8'));
    assert.equal(settings.libraryPath, outra);
    assert.equal(settings.theme, 'dark');
  });
});
