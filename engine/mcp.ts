import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { withAuthor } from './call-context.ts';
import { EngineError } from './errors.ts';
import { listNotes, openLibrary, readText } from './library.ts';
import { callTool, tools, type Tool } from './tools.ts';
import { libraryCatalog } from './catalog.ts';
import {
  resolveAccess,
  touchClient,
  userDataDir,
  watchClients,
  type Permissao,
} from './mcp-clients.ts';
import { openSession } from './mcp-sessions.ts';
import { isAppOnly, toolsForPermission } from './permissions.ts';

type McpFlags = { somenteLeitura?: boolean; escrita?: boolean };

type McpOptions = McpFlags & {
  libraries?: string[];
  permission?: Permissao;
  userData?: string;
  key?: string;
  closeSession?: () => void;
};

export type ServeMcpOptions = McpFlags & {
  libraries?: string[];
  userData?: string;
  key?: string;
  transport?: 'stdio' | 'http';
  port?: number;
  onListen?: (url: string) => void;
};

type Handler = (request: { params?: { name?: string } }, extra: unknown) => Promise<unknown> | unknown;

/**
 * Servidor MCP do motor. A biblioteca e a origem `mcp` vêm do processo.
 * A lista anunciada já vem filtrada pela permissão do cliente.
 */
export function createMcpServer(libraryPath: string, options: McpOptions = {}) {
  const library = openLibrary(libraryPath).root;
  const catalog = libraryCatalog([library, ...(options.libraries || [])]);
  const multiple = options.libraries !== undefined;
  const permission = options.permission ?? 'leitura';
  const allowed = new Set(toolsForPermission(permission).map((tool) => tool.name));
  if (multiple) allowed.add('library.list');
  const registry = new Set(tools.map((tool) => tool.name));
  const server = new McpServer({ name: 'sophy', version: '0.1.0' });
  if (multiple)
    server.registerTool(
      'library.list',
      {
        description:
          'Lista as bibliotecas autorizadas nesta sessão. Use o id como libraryId nas outras ferramentas.',
        inputSchema: z.object({}),
      },
      async () => ({ content: [{ type: 'text' as const, text: JSON.stringify(catalog) }] }),
    );
  for (const tool of tools) {
    if (!allowed.has(tool.name)) continue;
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: publicSchema(tool, multiple) },
      async (args) => {
        try {
          const libraryId = (args as Record<string, unknown>)?.libraryId;
          const selected =
            multiple && libraryId !== undefined
              ? catalog.find((entry) => entry.id === libraryId && entry.available)?.root
              : library;
          if (!selected)
            throw new EngineError(
              'invalid-path',
              'Biblioteca não autorizada nesta sessão. Use library.list.',
            );
          const value = callTool(tool.name, bindCall(tool, args, selected));
          const failure = toolFailure(value);
          if (failure) return { isError: true, content: [{ type: 'text' as const, text: failure }] };
          return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
        } catch (error) {
          return { isError: true, content: [{ type: 'text' as const, text: errorText(error) }] };
        }
      },
    );
  }
  server.registerResource(
    'nota',
    new ResourceTemplate('sophy://nota/{+path}', {
      list: async () => ({
        resources: listNotes(openLibrary(library)).map((note) => ({
          uri: noteUri(note.path),
          name: note.path,
          mimeType: 'text/markdown',
        })),
      }),
    }),
    {
      description: 'Nota Markdown da biblioteca. O caminho fica depois de sophy://nota/.',
      mimeType: 'text/markdown',
    },
    async (uri, variables) => {
      const relative = notePathFrom(uri, variables.path);
      const content = readText(openLibrary(library), relative).content;
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: content }] };
    },
  );
  if (multiple)
    server.registerResource(
      'nota-biblioteca',
      new ResourceTemplate('sophy://biblioteca/{libraryId}/nota/{+path}', {
        list: async () => ({
          resources: catalog
            .filter((entry) => entry.available)
            .flatMap((entry) =>
              listNotes(openLibrary(entry.root)).map((note) => ({
                uri: `sophy://biblioteca/${entry.id}/nota/${note.path.split('/').map(encodeURIComponent).join('/')}`,
                name: `${entry.name}/${note.path}`,
                mimeType: 'text/markdown',
              })),
            ),
        }),
      }),
      { mimeType: 'text/markdown' },
      async (uri, variables) => {
        const selected = catalog.find((entry) => entry.id === variables.libraryId && entry.available);
        if (!selected) throw new EngineError('invalid-path', 'Biblioteca não autorizada ou indisponível.');
        const relative = notePathFrom(uri, variables.path);
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: 'text/markdown',
              text: readText(openLibrary(selected.root), relative).content,
            },
          ],
        };
      },
    );
  installGate(server, { ...options, permission, allowed, registry });
  return server;
}

export async function serveMcp(libraryPath: string, options: ServeMcpOptions = {}) {
  const userData = options.userData ?? userDataDir();
  const flags = { somenteLeitura: options.somenteLeitura === true, escrita: options.escrita === true };
  if (options.transport === 'http') {
    await serveHttp(libraryPath, { ...options, userData, flags });
    return;
  }
  const access = resolveAccess(userData, options.key, flags);
  if (!access.ok) throw accessError(access.erro);
  const gate = { close: () => {} };
  const server = createMcpServer(libraryPath, {
    libraries: options.libraries,
    permission: access.permissao,
    userData,
    key: options.key,
    ...flags,
    closeSession: () => gate.close(),
  });
  const transport = new StdioServerTransport();
  gate.close = () => {
    void transport.close();
  };
  const release = openSession(access.clientId, () => gate.close());
  const stopWatch = watchClients(userData);
  await server.connect(transport);
  await new Promise<void>((resolve) => {
    if (process.stdin.readableEnded) {
      release();
      stopWatch();
      resolve();
      return;
    }
    const previous = transport.onclose;
    transport.onclose = () => {
      previous?.();
      release();
      stopWatch();
      resolve();
    };
  });
}

function installGate(
  server: McpServer,
  options: McpOptions & {
    permission: Permissao;
    allowed: Set<string>;
    registry: Set<string>;
  },
) {
  const userData = options.userData;
  if (!userData) return;
  const handlers = (
    server.server as unknown as { _requestHandlers: Map<string, Handler> }
  )._requestHandlers;
  let closed = false;
  const scheduleClose = () => {
    if (closed) return;
    closed = true;
    setTimeout(() => options.closeSession?.(), 20);
  };
  const guard = (method: string, original: Handler): Handler => {
    return (request, extra) => {
      const access = resolveAccess(userData, options.key, options);
      if (!access.ok) {
        scheduleClose();
        if (method === 'tools/call') return fail(access.erro);
        throw new EngineError(access.erro, access.erro);
      }
      if (access.clientId) touchClient(userData, access.clientId);
      if (method === 'tools/call') {
        const name = request?.params?.name;
        if (
          typeof name === 'string' &&
          !options.allowed.has(name) &&
          (isAppOnly(name) || options.registry.has(name))
        )
          return fail('permissao_negada');
      }
      return withAuthor(access.autor, () => original(request, extra));
    };
  };
  for (const method of ['tools/list', 'tools/call', 'resources/list', 'resources/read', 'resources/templates/list']) {
    const original = handlers.get(method);
    if (!original) continue;
    handlers.set(method, guard(method, original));
  }
}

type HttpOptions = ServeMcpOptions & { userData: string; flags: McpFlags };

async function serveHttp(libraryPath: string, options: HttpOptions) {
  const sessions = new Map<
    string,
    { transport: StreamableHTTPServerTransport; clientId: string | null; release: () => void }
  >();
  const stopWatch = watchClients(options.userData);
  const closeSession = (sessionId: string) => {
    const session = sessions.get(sessionId);
    if (!session) return;
    sessions.delete(sessionId);
    session.release();
    void session.transport.close();
  };
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      if (url.pathname !== '/mcp') {
        res.writeHead(404).end();
        return;
      }
      if (req.method !== 'POST' && req.method !== 'GET' && req.method !== 'DELETE') {
        res.writeHead(405).end();
        return;
      }
      const body = req.method === 'POST' ? await readBody(req) : undefined;
      const presented = presentedKey(req.headers.authorization);
      if (presented.malformed) {
        writeAuthError(res, body, 'chave_invalida');
        return;
      }
      const access = resolveAccess(options.userData, presented.key, options.flags);
      if (!access.ok) {
        const sessionId = headerOne(req.headers['mcp-session-id']);
        if (sessionId) closeSession(sessionId);
        writeAuthError(res, body, access.erro);
        return;
      }
      if (access.clientId) touchClient(options.userData, access.clientId);
      const sessionId = headerOne(req.headers['mcp-session-id']);
      if (sessionId) {
        const session = sessions.get(sessionId);
        if (!session || session.clientId !== access.clientId) {
          writeAuthError(res, body, 'chave_invalida');
          return;
        }
        await session.transport.handleRequest(req, res, body);
        return;
      }
      if (req.method !== 'POST' || !isInitialize(body)) {
        writeAuthError(res, body, 'chave_invalida');
        return;
      }
      const gate = { close: () => {} };
      const mcp = createMcpServer(libraryPath, {
        libraries: options.libraries,
        permission: access.permissao,
        userData: options.userData,
        key: presented.key,
        ...options.flags,
        closeSession: () => gate.close(),
      });
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          const release = openSession(access.clientId, () => closeSession(id));
          sessions.set(id, { transport, clientId: access.clientId, release });
        },
      });
      gate.close = () => {
        const id = transport.sessionId;
        if (id) closeSession(id);
        else void transport.close();
      };
      transport.onclose = () => {
        const id = transport.sessionId;
        const session = id ? sessions.get(id) : undefined;
        if (session) {
          sessions.delete(id!);
          session.release();
        }
      };
      await mcp.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch {
      if (!res.headersSent) res.writeHead(500).end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 8734, '127.0.0.1', () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : options.port ?? 8734;
      options.onListen?.(`http://127.0.0.1:${port}/mcp`);
      resolve();
    });
  });
  await new Promise<void>((resolve) => {
    const stop = () => {
      stopWatch();
      for (const id of [...sessions.keys()]) closeSession(id);
      server.close(() => resolve());
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}

function presentedKey(header: string | string[] | undefined) {
  const value = headerOne(header);
  if (!value) return { malformed: false as const, key: undefined };
  const match = /^Bearer\s+(\S+)\s*$/i.exec(value);
  if (!match) return { malformed: true as const, key: undefined };
  return { malformed: false as const, key: match[1] };
}

function headerOne(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function isInitialize(body: unknown) {
  return Boolean(body && typeof body === 'object' && (body as { method?: string }).method === 'initialize');
}

function writeAuthError(res: http.ServerResponse, body: unknown, erro: string) {
  const id =
    body && typeof body === 'object' && 'id' in body ? ((body as { id?: unknown }).id ?? null) : null;
  const payload = JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32001, message: erro } });
  res.writeHead(401, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req: http.IncomingMessage) {
  return new Promise<unknown>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(new Error('corpo grande'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function fail(code: string) {
  return { isError: true, content: [{ type: 'text' as const, text: code }] };
}

function accessError(erro: 'chave_invalida' | 'cliente_desativado') {
  if (erro === 'cliente_desativado')
    return new EngineError('cliente_desativado', 'Este cliente MCP está desativado.');
  return new EngineError(
    'chave_invalida',
    'A conexão MCP exige uma chave de cliente válida. O modo legado está desligado, então a configuração antiga sem chave não entra.',
  );
}

function publicSchema(tool: Tool, multiple = false) {
  if (!(tool.input instanceof z.ZodObject)) return tool.input;
  const hidden = new Set(['origin', 'libraryPath']);
  if (tool.name === 'library.open') hidden.add('path');
  const shape: Record<string, z.ZodType> = {};
  for (const [key, value] of Object.entries(tool.input.shape)) {
    if (!hidden.has(key)) shape[key] = value as z.ZodType;
  }
  if (multiple) shape.libraryId = z.string().optional();
  return z.object(shape);
}

function bindCall(tool: Tool, args: unknown, library: string) {
  const input =
    args && typeof args === 'object' && !Array.isArray(args)
      ? { ...(args as Record<string, unknown>) }
      : {};
  const names = propertyNames(tool.input);
  delete input.libraryId;
  if (names.has('origin')) input.origin = 'mcp';
  if (names.has('libraryPath')) input.libraryPath = library;
  if (tool.name === 'library.open') input.path = library;
  return input;
}

function propertyNames(schema: z.ZodType) {
  const json = schema.toJSONSchema() as { properties?: Record<string, unknown> };
  return new Set(Object.keys(json.properties ?? {}));
}

function toolFailure(value: unknown) {
  if (value && typeof value === 'object' && 'erro' in value && typeof value.erro === 'string')
    return `${value.erro}\n${JSON.stringify(value)}`;
  if (value && typeof value === 'object' && 'conflict' in value && value.conflict === true)
    return 'A nota mudou desde a leitura. Nada foi gravado.\n' + JSON.stringify(value, null, 2);
  if (
    Array.isArray(value) &&
    value.some((item) => item && typeof item === 'object' && 'status' in item && item.status === 'ambiguous')
  )
    return (
      'Há link ambíguo. Use o caminho da estante, como [[Estudos/Nota]].\n' +
      JSON.stringify(value, null, 2)
    );
  return null;
}

function errorText(error: unknown) {
  if (error instanceof EngineError) return `${error.code}: ${error.message}`;
  if (error instanceof z.ZodError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return 'Falha na operação.';
}

function noteUri(relative: string) {
  return `sophy://nota/${relative.split('/').map(encodeURIComponent).join('/')}`;
}

function notePathFrom(uri: URL, variable: unknown) {
  const raw = typeof variable === 'string' && variable ? variable : uri.pathname.replace(/^\//, '');
  const relative = raw
    .split('/')
    .map((part) => decodeURIComponent(part))
    .join('/');
  if (
    !relative ||
    relative.split('/').some((part) => !part || part === '.' || part === '..' || part.startsWith('.'))
  )
    throw new EngineError('invalid-path', 'Caminho de nota inválido.');
  return relative;
}
