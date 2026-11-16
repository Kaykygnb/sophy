'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');
const { createWorkspaceCore } = require('./workspace-core');

function sendGuiCommand(command) {
  const executable = require('electron');
  if (typeof executable !== 'string') throw Error('Não foi possível localizar o Electron.');
  const appPath = path.resolve(__dirname, '..');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [appPath, `--sophy-ui=${command}`], {
      cwd: appPath,
      detached: true,
      stdio: 'ignore',
      env,
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve({ requested: command, accepted: true });
    });
  });
}

async function main() {
  const [{ McpServer }, { serveStdio }, z] = await Promise.all([
    import('@modelcontextprotocol/server'),
    import('@modelcontextprotocol/server/stdio'),
    import('zod/v4'),
  ]);
  const core = createWorkspaceCore();
  const server = new McpServer({ name: 'sophy', version: '0.2.0' });

  function result(value) {
    return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
  }

  function register(name, description, inputSchema, handler) {
    server.registerTool(name, { description, inputSchema }, async (args) => {
      try {
        return result(await handler(args));
      } catch (error) {
        return {
          content: [{ type: 'text', text: error.message || 'Falha na operação.' }],
          isError: true,
        };
      }
    });
  }

  function workspace(store, workspaceId) {
    const item = store.list().find((entry) => entry.id === workspaceId);
    if (!item) throw Error('Área de trabalho não encontrada no mundo atual.');
    if (!item.available) throw Error(item.reason || 'A pasta desta área está indisponível.');
    return item;
  }

  function collectNotes(items, out = []) {
    for (const item of items) {
      if (item.kind === 'directory') collectNotes(item.children || [], out);
      else if (/\.md$/i.test(item.path)) out.push(item);
    }
    return out;
  }

  register(
    'sophy_show_app',
    'Abre a interface gráfica do Sophy ou traz a janela existente para frente.',
    z.object({}),
    () => sendGuiCommand('show'),
  );

  register(
    'sophy_close_app',
    'Solicita o fechamento gracioso da interface. O Sophy pode pedir confirmação se houver alterações não salvas; o servidor MCP continua ativo.',
    z.object({}),
    () => sendGuiCommand('close'),
  );

  register(
    'sophy_list_worlds',
    'Lista os mundos Sophy registrados e informa qual deles está carregado.',
    z.object({}),
    () => core.worlds.state(),
  );

  register(
    'sophy_create_world',
    'Cria um mundo Sophy dentro de uma pasta pai local escolhida pelo usuário.',
    z.object({ name: z.string().min(1).max(100), parentPath: z.string().min(1) }),
    ({ name, parentPath }) => core.worlds.create(name, parentPath),
  );

  register(
    'sophy_open_world',
    'Carrega um mundo pelo identificador já registrado no Sophy.',
    z.object({ worldId: z.string().min(1) }),
    ({ worldId }) => {
      const known = core.worlds.known.worlds.find((world) => world.id === worldId);
      if (!known) throw Error('Mundo não encontrado.');
      return core.worlds.load(known.path, worldId);
    },
  );

  register(
    'sophy_list_workspaces',
    'Lista as áreas gerenciadas no mundo atual, com seus identificadores e caminhos.',
    z.object({}),
    () => {
      const state = core.worlds.state();
      return { world: state.world, workspaces: state.workspaces, error: state.error };
    },
  );

  register(
    'sophy_create_workspace',
    'Cria uma área como subpasta direta do mundo atual.',
    z.object({ name: z.string().min(1).max(100) }),
    ({ name }) => {
      const created = core.current().create(name);
      if (created.exists) throw Error('Já existe uma pasta com esse nome; nada foi sobrescrito.');
      return created.workspace;
    },
  );

  register(
    'sophy_register_workspace',
    'Registra uma subpasta direta já existente no mundo atual para o Sophy administrar.',
    z.object({ folderPath: z.string().min(1), name: z.string().min(1).max(100).optional() }),
    ({ folderPath, name }) => {
      const store = core.current();
      const safe = store.safe(folderPath);
      return store.register(name || path.basename(safe), safe);
    },
  );

  register(
    'sophy_open_workspace',
    'Abre uma área do mundo atual e atualiza sua data de último acesso.',
    z.object({ workspaceId: z.string().min(1) }),
    ({ workspaceId }) => core.current().open(workspaceId),
  );

  register(
    'sophy_rename_workspace',
    'Altera o nome exibido de uma área sem renomear a pasta no sistema.',
    z.object({ workspaceId: z.string().min(1), name: z.string().min(1).max(100) }),
    ({ workspaceId, name }) => {
      const store = core.current();
      store.rename(workspaceId, name);
      return store.get(workspaceId);
    },
  );

  register(
    'sophy_list_files',
    'Lista pastas e arquivos de uma área gerenciada.',
    z.object({ workspaceId: z.string().min(1) }),
    ({ workspaceId }) => core.files(workspaceId).tree(),
  );

  register(
    'sophy_search_notes',
    'Busca texto nas notas Markdown de uma área e retorna trechos com seus caminhos.',
    z.object({ workspaceId: z.string().min(1), query: z.string().min(1).max(300) }),
    ({ workspaceId, query }) => core.files(workspaceId).searchNotes(query),
  );

  register(
    'sophy_read_note',
    'Lê uma nota Markdown. Retorna uma revisão que deve ser enviada ao escrever para evitar sobrescrever alterações novas.',
    z.object({ workspaceId: z.string().min(1), path: z.string().min(1) }),
    ({ workspaceId, path: relative }) => core.files(workspaceId).read(relative),
  );

  register(
    'sophy_write_note',
    'Salva uma nota Markdown somente se a revisão ainda corresponder à última leitura.',
    z.object({
      workspaceId: z.string().min(1),
      path: z.string().min(1),
      content: z.string(),
      expectedRevision: z.string().length(64),
    }),
    ({ workspaceId, path: relative, content, expectedRevision }) => {
      const saved = core.files(workspaceId).write(relative, content, expectedRevision);
      if (saved.conflict)
        throw Error('A nota mudou desde a leitura. Leia novamente antes de escrever.');
      return saved;
    },
  );

  register(
    'sophy_create_item',
    'Cria uma nota Markdown ou uma pasta dentro de uma área. Não sobrescreve itens existentes.',
    z.object({
      workspaceId: z.string().min(1),
      parentPath: z.string(),
      name: z.string().min(1).max(160),
      kind: z.enum(['file', 'directory']),
      content: z.string().optional(),
    }),
    ({ workspaceId, parentPath, name, kind, content }) =>
      core.files(workspaceId).create(parentPath, name, kind, content || ''),
  );

  register(
    'sophy_create_linked_note',
    'Cria uma nota Markdown no caminho de destino de um link interno que ainda não existe.',
    z.object({ workspaceId: z.string().min(1), path: z.string().min(1) }),
    ({ workspaceId, path: relative }) => core.files(workspaceId).createLinked(relative),
  );

  register(
    'sophy_move_item',
    'Move ou renomeia um item dentro da mesma área e atualiza links Markdown relacionados.',
    z.object({
      workspaceId: z.string().min(1),
      sourcePath: z.string().min(1),
      targetPath: z.string().min(1),
    }),
    ({ workspaceId, sourcePath, targetPath }) =>
      core.files(workspaceId).moveWithLinks(sourcePath, targetPath),
  );

  serveStdio(() => server);
}

main().catch((error) => {
  console.error('Não foi possível iniciar o servidor MCP do Sophy:', error);
  process.exitCode = 1;
});
