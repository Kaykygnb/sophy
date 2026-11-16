import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { EngineError } from './errors.ts';
import { listNotes, openLibrary, readText } from './library.ts';
import { callTool, tools, type Tool } from './tools.ts';

/**
 * Servidor MCP do motor. Expõe o mesmo registro de tools.
 * A biblioteca e a origem `mcp` vêm do processo, não do cliente.
 */
export function createMcpServer(libraryPath: string) {
  const library = openLibrary(libraryPath).root;
  const server = new McpServer({ name: 'sophy', version: '0.1.0' });
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: publicSchema(tool),
      },
      async (args) => {
        try {
          const value = callTool(tool.name, bindCall(tool, args, library));
          const failure = toolFailure(value);
          if (failure)
            return {
              isError: true,
              content: [{ type: 'text' as const, text: failure }],
            };
          return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
        } catch (error) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: errorText(error) }],
          };
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
  return server;
}

export async function serveMcp(libraryPath: string) {
  const server = createMcpServer(libraryPath);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  await new Promise<void>((resolve) => {
    if (process.stdin.readableEnded) {
      resolve();
      return;
    }
    const previous = transport.onclose;
    transport.onclose = () => {
      previous?.();
      resolve();
    };
  });
}

function publicSchema(tool: Tool) {
  if (!(tool.input instanceof z.ZodObject)) return tool.input;
  const hidden = new Set(['origin', 'libraryPath']);
  if (tool.name === 'library.open') hidden.add('path');
  const shape: Record<string, z.ZodType> = {};
  for (const [key, value] of Object.entries(tool.input.shape)) {
    if (!hidden.has(key)) shape[key] = value as z.ZodType;
  }
  return z.object(shape);
}

function bindCall(tool: Tool, args: unknown, library: string) {
  const input =
    args && typeof args === 'object' && !Array.isArray(args)
      ? { ...(args as Record<string, unknown>) }
      : {};
  const names = propertyNames(tool.input);
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
  if (value && typeof value === 'object' && 'conflict' in value && value.conflict === true)
    return 'A nota mudou desde a leitura. Nada foi gravado.\n' + JSON.stringify(value, null, 2);
  if (
    Array.isArray(value) &&
    value.some(
      (item) => item && typeof item === 'object' && 'status' in item && item.status === 'ambiguous',
    )
  )
    return (
      'Há link ambíguo. Use o caminho da estante, como [[Estudos/Nota]].\n' +
      JSON.stringify(value, null, 2)
    );
  return null;
}

function errorText(error: unknown) {
  if (error instanceof EngineError || error instanceof z.ZodError) return error.message;
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
    relative
      .split('/')
      .some((part) => !part || part === '.' || part === '..' || part.startsWith('.'))
  )
    throw new EngineError('invalid-path', 'Caminho de nota inválido.');
  return relative;
}
