import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { EngineError } from './errors.ts';
import { serveMcp } from './mcp.ts';
import { callTool, tools } from './tools.ts';

type Io = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdin: string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
};

class CliError extends Error {
  readonly exitCode: 1 | 2;
  constructor(message: string, exitCode: 1 | 2) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
  }
}

type Parsed = {
  command: string | undefined;
  positionals: string[];
  flags: Record<string, string | boolean>;
  jsonOutput: boolean;
  jsonInput: Record<string, unknown> | undefined;
  biblioteca: string | undefined;
  texto: string | undefined;
  somenteLeitura: boolean;
  escrita: boolean;
};

const SHORTCUTS = new Set([
  'init',
  'estantes',
  'nova',
  'ler',
  'buscar',
  'links',
  'backlinks',
  'mover',
  'lixeira',
  'grafo',
  'historico',
  'desfazer',
  'tools',
  'help',
]);

export async function execute(argv: string[], io: Io): Promise<number> {
  try {
    const parsed = parseArgv(argv);
    if (!parsed.command || parsed.command === 'help') {
      if (parsed.positionals[0]) return helpTool(parsed.positionals[0], io);
      io.stdout(generalHelp());
      return 0;
    }
    if (parsed.command === 'tools') {
      for (const tool of tools) io.stdout(`${tool.name} — ${tool.description}\n`);
      return 0;
    }
    if (parsed.command === 'mcp') {
      if (parsed.positionals.length)
        throw new CliError('Uso: sophy mcp [--biblioteca <pasta>] [--escrita]', 1);
      await serveMcp(findLibrary(io, parsed.biblioteca), { readonly: !parsed.escrita || parsed.somenteLeitura });
      return 0;
    }
    if (parsed.command === 'init') return initLibrary(parsed, io);
    if (SHORTCUTS.has(parsed.command)) return runShortcut(parsed, io);
    if (tools.some((tool) => tool.name === parsed.command))
      return runTool(parsed.command, parsed, io);
    throw new CliError(`Comando desconhecido: ${parsed.command}. Use sophy help.`, 1);
  } catch (error) {
    if (error instanceof CliError) {
      io.stderr(`${error.message}\n`);
      return error.exitCode;
    }
    if (error instanceof z.ZodError) {
      io.stderr(`Argumento inválido: ${error.issues.map((issue) => issue.message).join(' ')}\n`);
      return 1;
    }
    if (error instanceof EngineError) {
      io.stderr(`${error.message}\n`);
      return 2;
    }
    const message = error instanceof Error ? error.message : 'Falha inesperada.';
    io.stderr(`${message}\n`);
    return 2;
  }
}

function parseArgv(argv: string[]): Parsed {
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];
  let jsonOutput = false;
  let jsonInput: Record<string, unknown> | undefined;
  let biblioteca: string | undefined;
  let texto: string | undefined;
  let somenteLeitura = false;
  let escrita = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      positionals.unshift('help');
      continue;
    }
    if (arg === '--somente-leitura') {
      somenteLeitura = true;
      continue;
    }
    if (arg === '--escrita') {
      escrita = true;
      continue;
    }
    if (arg === '--biblioteca' || arg.startsWith('--biblioteca=')) {
      biblioteca = valueOf(arg, argv, index, 'biblioteca');
      if (!arg.includes('=')) index += 1;
      continue;
    }
    if (arg === '--texto' || arg.startsWith('--texto=')) {
      texto = valueOf(arg, argv, index, 'texto');
      if (!arg.includes('=')) index += 1;
      continue;
    }
    if (arg === '--json' || arg.startsWith('--json=')) {
      const inline = arg.startsWith('--json=') ? arg.slice('--json='.length) : undefined;
      const next = inline === undefined ? argv[index + 1] : inline;
      if (next && next.startsWith('{')) {
        jsonInput = parseJsonObject(next);
        jsonOutput = true;
        if (inline === undefined) index += 1;
      } else if (inline !== undefined)
        throw new CliError(
          'Depois de --json use um objeto JSON, como --json \'{"path":"Nota.md"}\'.',
          1,
        );
      else jsonOutput = true;
      continue;
    }
    if (arg.startsWith('--')) {
      const body = arg.slice(2);
      if (!body) throw new CliError('Opção vazia.', 1);
      if (body.includes('=')) {
        const cut = body.indexOf('=');
        flags[body.slice(0, cut)] = body.slice(cut + 1);
      } else if (argv[index + 1] === undefined || argv[index + 1].startsWith('--'))
        flags[body] = true;
      else {
        flags[body] = argv[index + 1];
        index += 1;
      }
      continue;
    }
    positionals.push(arg);
  }
  return {
    command: positionals[0],
    positionals: positionals.slice(1),
    flags,
    jsonOutput,
    jsonInput,
    biblioteca,
    texto,
    somenteLeitura,
    escrita,
  };
}

function valueOf(arg: string, argv: string[], index: number, name: string) {
  const inline = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : argv[index + 1];
  if (!inline || inline.startsWith('--')) throw new CliError(`Informe o valor de --${name}.`, 1);
  return inline;
}

function parseJsonObject(text: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new CliError('O JSON informado não é válido.', 1);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new CliError('O JSON da tool precisa ser um objeto.', 1);
  return parsed as Record<string, unknown>;
}

function initLibrary(parsed: Parsed, io: Io) {
  const target = parsed.positionals[0];
  if (!target || parsed.positionals.length > 1) throw new CliError('Uso: sophy init <pasta>', 1);
  const folder = path.resolve(io.cwd, target);
  fs.mkdirSync(folder, { recursive: true });
  fs.mkdirSync(path.join(folder, '.sophy'), { recursive: true });
  return emit(callTool('library.open', { path: folder }), parsed, io, 'init');
}

function runShortcut(parsed: Parsed, io: Io) {
  if (Object.keys(parsed.flags).length)
    throw new CliError('Este atalho não usa essas opções. Use sophy help.', 1);
  if (parsed.texto !== undefined && parsed.command !== 'nova')
    throw new CliError('--texto só vale para sophy nova.', 1);
  if (parsed.jsonInput) throw new CliError('Este atalho não recebe JSON de entrada.', 1);
  const library = findLibrary(io, parsed.biblioteca);
  const texto = readTextFlag(parsed.texto, io);
  switch (parsed.command) {
    case 'estantes':
      requireEmpty(parsed);
      return emit(callTool('workspace.list', { libraryPath: library }), parsed, io, 'estantes');
    case 'nova': {
      const note = noteArg(
        parsed.positionals[0],
        'Uso: sophy nova <Estante/Nota> [--texto <texto>]',
      );
      if (parsed.positionals.length > 1)
        throw new CliError('Uso: sophy nova <Estante/Nota> [--texto <texto>]', 1);
      return emit(
        callTool('note.create', {
          libraryPath: library,
          path: note,
          body: texto ?? '',
          origin: 'cli',
        }),
        parsed,
        io,
        'nova',
      );
    }
    case 'ler':
      return emit(
        callTool('note.read', {
          libraryPath: library,
          path: noteArg(parsed.positionals[0], 'Uso: sophy ler <nota>'),
        }),
        parsed,
        io,
        'ler',
      );
    case 'buscar': {
      const query = parsed.positionals.join(' ').trim();
      if (!query) throw new CliError('Uso: sophy buscar <termo>', 1);
      return emit(callTool('search.query', { libraryPath: library, query }), parsed, io, 'buscar');
    }
    case 'links':
      return emit(
        callTool('links.outgoing', {
          libraryPath: library,
          path: noteArg(parsed.positionals[0], 'Uso: sophy links <nota>'),
        }),
        parsed,
        io,
        'links',
      );
    case 'backlinks':
      return emit(
        callTool('links.backlinks', {
          libraryPath: library,
          path: noteArg(parsed.positionals[0], 'Uso: sophy backlinks <nota>'),
        }),
        parsed,
        io,
        'backlinks',
      );
    case 'mover': {
      const [from, to] = parsed.positionals;
      if (!from || !to || parsed.positionals.length > 2)
        throw new CliError('Uso: sophy mover <origem> <destino>', 1);
      return emit(
        callTool('entry.move', { libraryPath: library, from, to, origin: 'cli' }),
        parsed,
        io,
        'mover',
      );
    }
    case 'lixeira': {
      const target = parsed.positionals[0];
      if (!target || parsed.positionals.length > 1)
        throw new CliError('Uso: sophy lixeira <caminho>', 1);
      return emit(
        callTool('entry.trash', { libraryPath: library, path: target, origin: 'cli' }),
        parsed,
        io,
        'lixeira',
      );
    }
    case 'grafo':
      requireEmpty(parsed);
      return emit(callTool('graph.query', { libraryPath: library }), parsed, io, 'grafo');
    case 'historico':
      requireEmpty(parsed);
      return emit(callTool('history.list', { libraryPath: library }), parsed, io, 'historico');
    case 'desfazer':
      requireEmpty(parsed);
      return emit(
        callTool('history.undo', { libraryPath: library, origin: 'cli' }),
        parsed,
        io,
        'desfazer',
      );
    default:
      throw new CliError(`Comando desconhecido: ${parsed.command}.`, 1);
  }
}

function runTool(name: string, parsed: Parsed, io: Io) {
  const tool = tools.find((item) => item.name === name);
  if (!tool) throw new CliError(`Tool desconhecida: ${name}.`, 1);
  if (parsed.positionals.length)
    throw new CliError(`A tool ${name} recebe opções, não argumentos soltos.`, 1);
  const properties = schemaProperties(tool.input);
  const input: Record<string, unknown> = { ...(parsed.jsonInput ?? {}) };
  for (const [key, value] of Object.entries(parsed.flags)) {
    if (!properties[key]) throw new CliError(`Opção desconhecida para ${name}: --${key}.`, 1);
    input[key] = coerce(properties[key], value, key);
  }
  if (parsed.texto !== undefined && input.body === undefined)
    input.body = readTextFlag(parsed.texto, io);
  if (input.body === '-') input.body = io.stdin;
  if ('origin' in properties) input.origin = 'cli';
  const library = needsLibrary(properties, input) ? findLibrary(io, parsed.biblioteca) : undefined;
  if (library && 'libraryPath' in properties && input.libraryPath === undefined)
    input.libraryPath = library;
  if (library && name === 'library.open' && input.path === undefined) input.path = library;
  return emit(callTool(name, input), parsed, io, name);
}

function needsLibrary(properties: Record<string, JsonSchema>, input: Record<string, unknown>) {
  if ('libraryPath' in properties && input.libraryPath === undefined) return true;
  if ('path' in properties && input.path === undefined) return true;
  return false;
}

function emit(value: unknown, parsed: Parsed, io: Io, command: string) {
  if (isConflict(value)) {
    io.stderr('A nota mudou desde a leitura. Nada foi gravado.\n');
    if (parsed.jsonOutput) io.stdout(`${JSON.stringify(value, null, 2)}\n`);
    return 2;
  }
  io.stdout(parsed.jsonOutput ? `${JSON.stringify(value, null, 2)}\n` : human(command, value));
  if (hasAmbiguous(value)) {
    io.stderr('Há link ambíguo. Use o caminho da estante, como [[Estudos/Nota]].\n');
    return 2;
  }
  return 0;
}

function human(command: string, value: unknown) {
  if (command === 'ler' && isRecord(value) && typeof value.body === 'string')
    return value.body.endsWith('\n') ? value.body : `${value.body}\n`;
  if (command === 'nova' && isRecord(value) && typeof value.path === 'string')
    return `Criada ${value.path}\n`;
  if (command === 'init' && isRecord(value) && typeof value.root === 'string')
    return `Biblioteca pronta em ${value.root}\n`;
  if (command === 'desfazer' && isRecord(value) && typeof value.summary === 'string')
    return `Desfeito: ${value.summary}\n`;
  if (
    command === 'grafo' &&
    isRecord(value) &&
    Array.isArray(value.nodes) &&
    Array.isArray(value.edges)
  ) {
    const lines = value.edges.map((edge) => {
      const item = edge as { from?: string; to?: string };
      return `${item.from} -> ${item.to}`;
    });
    if (!lines.length) lines.push('(sem arestas)');
    return `${value.nodes.length} notas\n${lines.join('\n')}\n`;
  }
  if (Array.isArray(value)) {
    if (!value.length) return '(vazio)\n';
    return `${value.map((item) => humanItem(command, item)).join('\n')}\n`;
  }
  if (typeof value === 'string') return value.endsWith('\n') ? value : `${value}\n`;
  return `${JSON.stringify(value, null, 2)}\n`;
}

function humanItem(command: string, item: unknown) {
  if (!isRecord(item)) return String(item);
  if (typeof item.name === 'string' && command === 'estantes') return item.name;
  if (typeof item.path === 'string' && Array.isArray(item.segments)) {
    const text = item.segments
      .map((part) => (isRecord(part) && typeof part.text === 'string' ? part.text : ''))
      .join('');
    return `${item.path} [${item.field}] ${text}`;
  }
  if (typeof item.path === 'string' && typeof item.workspace === 'string') return item.path;
  if (typeof item.path === 'string' && item.workspace === null) return item.path;
  if (typeof item.summary === 'string' && typeof item.origin === 'string')
    return `${item.origin} ${item.tool} ${item.summary}`;
  if (typeof item.raw === 'string' && typeof item.status === 'string')
    return `${item.status} ${item.raw}${item.path ? ` -> ${item.path}` : ''}`;
  if (typeof item.from === 'string' && typeof item.display === 'string')
    return `${item.from}: ${item.display}`;
  if (typeof item.path === 'string') return item.path;
  return JSON.stringify(item);
}

function helpTool(name: string, io: Io) {
  const tool = tools.find((item) => item.name === name);
  if (!tool) throw new CliError(`Tool desconhecida: ${name}. Use sophy tools.`, 1);
  io.stdout(`${tool.name}\n${tool.description}\n`);
  try {
    io.stdout(`${JSON.stringify(tool.input.toJSONSchema(), null, 2)}\n`);
  } catch {
    io.stderr('Não foi possível derivar o schema desta tool.\n');
    return 2;
  }
  return 0;
}

function generalHelp() {
  return `Sophy — biblioteca local de notas Markdown

Uso:
  sophy init <pasta>
  sophy estantes
  sophy nova <Estante/Nota> [--texto <texto> | --texto -]
  sophy ler <nota>
  sophy buscar <termo>
  sophy links <nota>
  sophy backlinks <nota>
  sophy mover <origem> <destino>
  sophy lixeira <caminho>
  sophy grafo
  sophy historico
  sophy desfazer
  sophy tools
  sophy help <tool>
  sophy mcp [--escrita]
  sophy <tool> [--campo valor] [--json '{...}']

A biblioteca vem de --biblioteca, de SOPHY_LIBRARY, ou da pasta atual
subindo até encontrar .sophy. Toda alteração usa a origem cli.
--json sozinho imprime a resposta para máquina. --json '{...}' envia a entrada.
Códigos: 0 ok, 1 uso, 2 erro do motor.
`;
}

function findLibrary(io: Io, explicit: string | undefined) {
  if (explicit) return path.resolve(io.cwd, explicit);
  if (io.env.SOPHY_LIBRARY) return path.resolve(io.cwd, io.env.SOPHY_LIBRARY);
  let current = path.resolve(io.cwd);
  for (;;) {
    const marker = path.join(current, '.sophy');
    if (fs.existsSync(marker) && fs.statSync(marker).isDirectory()) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new CliError(
    'Não encontrei a biblioteca. Use --biblioteca, defina SOPHY_LIBRARY ou entre numa pasta que contenha .sophy.',
    1,
  );
}

function noteArg(value: string | undefined, usage: string) {
  if (!value) throw new CliError(usage, 1);
  return value.toLowerCase().endsWith('.md') ? value : `${value}.md`;
}

function requireEmpty(parsed: Parsed) {
  if (parsed.positionals.length) throw new CliError(`Uso: sophy ${parsed.command}`, 1);
}

function readTextFlag(texto: string | undefined, io: Io) {
  if (texto === undefined) return undefined;
  return texto === '-' ? io.stdin : texto;
}

type JsonSchema = { type?: string | string[]; properties?: Record<string, JsonSchema> };

function schemaProperties(schema: z.ZodType) {
  const json = schema.toJSONSchema() as JsonSchema;
  return json.properties ?? {};
}

function coerce(schema: JsonSchema, value: string | boolean, key: string) {
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (type === 'boolean') {
    if (value === true || value === 'true') return true;
    if (value === 'false') return false;
    throw new CliError(`--${key} espera true ou false.`, 1);
  }
  if (type === 'number' || type === 'integer') {
    const number = Number(value);
    if (typeof value !== 'string' || Number.isNaN(number))
      throw new CliError(`--${key} espera um número.`, 1);
    return number;
  }
  if (typeof value === 'boolean') throw new CliError(`Informe o valor de --${key}.`, 1);
  return value === '-' ? value : value;
}

function isConflict(value: unknown) {
  return isRecord(value) && value.conflict === true;
}

function hasAmbiguous(value: unknown) {
  return (
    Array.isArray(value) && value.some((item) => isRecord(item) && item.status === 'ambiguous')
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
const isDirectRun = entry !== '' && import.meta.url === pathToFileURL(entry).href;
if (isDirectRun) {
  Promise.resolve(
    execute(process.argv.slice(2), {
      cwd: process.cwd(),
      env: process.env,
      stdin: wantsStdin(process.argv.slice(2)) ? fs.readFileSync(0, 'utf8') : '',
      stdout: (text) => process.stdout.write(text),
      stderr: (text) => process.stderr.write(text),
    }),
  ).then(
    (code) => process.exit(code),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Falha inesperada.';
      process.stderr.write(`${message}\n`);
      process.exit(2);
    },
  );
}

function wantsStdin(argv: string[]) {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if ((arg === '--texto' || arg === '--body') && argv[index + 1] === '-') return true;
    if (arg === '--texto=-' || arg === '--body=-') return true;
  }
  return false;
}
