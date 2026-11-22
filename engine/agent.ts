import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { wikilinksInexistentes } from './agent-links.ts';
import { listLibrariesForAgent } from './agent-libraries.ts';
import { buildSystemPrompt, type PromptModo } from './agent-prompt.ts';
import {
  createProviderClient,
  type AgentModelClient,
  type AgentModelMessage,
  type AgentModelReply,
  type FetchLike,
} from './agent-client.ts';
import { provedor } from './agent-providers.ts';
import { type Raciocinio } from './agent-reasoning.ts';
import { EngineError } from './errors.ts';
import { callTool, toolMutates, tools, trackedVersionId, type Tool } from './tools.ts';

export type { AgentModelClient, AgentModelMessage, AgentModelReply, FetchLike };

export type AgentModo = PromptModo;

export type AgentContext = {
  notePath?: string;
  selection?: { text: string; from: number; to: number };
  modo?: AgentModo;
};

export type AgentAction = {
  id: string;
  tool: string;
  label: string;
  input: Record<string, unknown>;
  ok: boolean;
  error?: string;
  versionId?: string;
};

export type AgentProgress = {
  phase: 'thinking' | 'reasoning' | 'tool' | 'done' | 'error';
  label: string;
  tool?: string;
  actionId?: string;
  canceled?: boolean;
  resumo?: string;
};

export type AgentConfirmRequest = {
  confirmId: string;
  tool: string;
  label: string;
  input: Record<string, unknown>;
};

export type AgentSuggestion = { titulo: string; conteudo: string };

export type AgentTurn = {
  text: string;
  actions: AgentAction[];
  canceled?: boolean;
  sugestoes?: AgentSuggestion[];
  linksInexistentes?: string[];
  raciocinio?: string;
};

/** Cliente de chat injetável. Os testes passam um falso; a janela usa o fetch do provedor. */

export type AgentTurnOptions = {
  libraryPath: string;
  message: string;
  key: string;
  context?: unknown;
  modo?: AgentModo;
  provider?: string;
  endpoint?: string;
  model?: string;
  requiresKey?: boolean;
  raciocinio?: Raciocinio | null;
  fetchImpl?: FetchLike;
  client?: AgentModelClient;
  confirm?: (request: AgentConfirmRequest) => Promise<boolean> | boolean;
  onProgress?: (event: AgentProgress) => void;
  onLibraryChanged?: (info: { id: string; name: string; path: string }) => void;
  signal?: AbortSignal;
  maxSteps?: number;
};

const blocked = /key|chave|secret|token|senha/i;
const unsafe = new Set([
  'site.export',
  'vault.import',
  'entry.trash',
  'note.deletePermanent',
  'trash.purge',
  'trash.empty',
  'version.restore',
]);
const secretKeys = new Set(['key', 'apiKey', 'token', 'secret', 'senha', 'authorization']);
const DEFAULT_STEPS = 8;

type Phrase = { progress: string; done: string; failed: string; denied: string };

export function agentTools(modo: AgentModo = 'agente') {
  return tools
    .filter((tool) => offered(tool.name))
    .filter((tool) => modo === 'agente' || !toolMutates(tool.name))
    .map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: parametersOf(tool),
      },
    }));
}

function offered(name: string) {
  return !name.startsWith('ui.') && !blocked.test(name) && !unsafe.has(name);
}

export function agentConfirmation(name: string, args: Record<string, unknown>) {
  if (name === 'site.export') return 'Exportar o site da biblioteca para fora dela?';
  if (name === 'vault.import')
    return `Importar um vault para a estante ${String(args.shelf || '').trim() || 'indicada'}?`;
  if (name === 'entry.trash') return `Mover ${String(args.path || 'o item')} para a lixeira?`;
  if (name === 'version.restore') return 'Restaurar um ponto antigo por cima da biblioteca?';
  if (name === 'history.undo') return 'Desfazer a última ação da biblioteca?';
  if (name === 'agent.undo') return 'Desfazer essa ação da biblioteca?';
  if (name === 'library.switch') return confirmacaoDeBiblioteca(args);
  if (name === 'trash.restore') return 'Restaurar este item da lixeira?';
  if (name === 'trash.purge') return 'Apagar de vez este item da lixeira?';
  if (name === 'trash.empty') return 'Esvaziar a lixeira da biblioteca?';
  if (name === 'note.deletePermanent')
    return `Apagar de vez ${String(args.path || 'o item')}?`;
  if (name === 'note.write') return `Sobrescrever a nota ${String(args.path || '')}?`;
  if (name === 'entry.move') {
    const from = String(args.from || '');
    return from.includes('/') ? `Mover a nota ${from}?` : `Mover ou renomear a estante ${from}?`;
  }
  if (name.startsWith('canvas.') && name !== 'canvas.read')
    return `Alterar o canvas ${String(args.path || '')}?`;
  return '';
}

export function agentActionPhrase(tool: string, input: Record<string, unknown>): Phrase {
  const title = fileTitle(input.path);
  const from = fileTitle(input.from);
  const to = fileTitle(input.to);
  if (tool === 'note.suggest')
    return said(
      'Sugerindo',
      'Sugeriu',
      'Não sugeriu',
      'Recusou sugerir',
      `a nota ${fileTitle(input.titulo)}`,
    );
  if (tool === 'library.list')
    return said('Listando', 'Listou', 'Não listou', 'Recusou listar', 'as bibliotecas');
  if (tool === 'library.read')
    return said('Lendo', 'Leu', 'Não leu', 'Recusou ler', 'outra biblioteca');
  if (tool === 'library.switch')
    return said('Trocando', 'Trocou', 'Não trocou', 'Recusou trocar', 'a biblioteca');
  if (tool === 'note.create')
    return said('Criando', 'Criou', 'Não criou', 'Recusou criar', `a nota ${title}`);
  if (tool === 'note.write')
    return said('Gravando', 'Gravou', 'Não gravou', 'Recusou gravar', `a nota ${title}`);
  if (tool === 'note.read')
    return said('Lendo', 'Leu', 'Não leu', 'Recusou ler', `a nota ${title}`);
  if (tool === 'note.child.create')
    return said(
      'Criando',
      'Criou',
      'Não criou',
      'Recusou criar',
      `a nota filha ${fileTitle(input.title)}`,
    );
  if (tool === 'workspace.create')
    return said(
      'Criando',
      'Criou',
      'Não criou',
      'Recusou criar',
      `a estante ${fileTitle(input.name)}`,
    );
  if (tool === 'directory.create')
    return said('Criando', 'Criou', 'Não criou', 'Recusou criar', `a pasta ${title}`);
  if (tool === 'entry.move') {
    const note = String(input.from || '').includes('/') || String(input.from || '').endsWith('.md');
    const rest = note ? `a nota ${from} para ${to}` : `a estante ${from}`;
    return said('Movendo', 'Moveu', 'Não moveu', 'Recusou mover', rest);
  }
  if (tool === 'entry.trash')
    return said('Enviando', 'Enviou', 'Não enviou', 'Recusou enviar', `${title} para a lixeira`);
  if (tool === 'trash.restore')
    return said(
      'Restaurando',
      'Restaurou',
      'Não restaurou',
      'Recusou restaurar',
      'um item da lixeira',
    );
  if (tool === 'trash.purge')
    return said('Apagando', 'Apagou', 'Não apagou', 'Recusou apagar', 'um item da lixeira');
  if (tool === 'trash.empty')
    return said('Esvaziando', 'Esvaziou', 'Não esvaziou', 'Recusou esvaziar', 'a lixeira');
  if (tool === 'note.deletePermanent')
    return said('Apagando', 'Apagou', 'Não apagou', 'Recusou apagar', title);
  if (tool === 'history.undo')
    return said('Desfazendo', 'Desfez', 'Não desfez', 'Recusou desfazer', 'a última ação');
  if (tool === 'agent.undo')
    return said('Desfazendo', 'Desfez', 'Não desfez', 'Recusou desfazer', 'uma ação');
  if (tool === 'site.export')
    return said('Exportando', 'Exportou', 'Não exportou', 'Recusou exportar', 'o site');
  if (tool === 'vault.import')
    return said(
      'Importando',
      'Importou',
      'Não importou',
      'Recusou importar',
      `o vault para ${fileTitle(input.shelf)}`,
    );
  if (tool === 'version.restore')
    return said(
      'Restaurando',
      'Restaurou',
      'Não restaurou',
      'Recusou restaurar',
      'um ponto da biblioteca',
    );
  if (tool === 'version.point')
    return said('Gravando', 'Gravou', 'Não gravou', 'Recusou gravar', 'um ponto da biblioteca');
  if (tool === 'attachment.import')
    return said('Importando', 'Importou', 'Não importou', 'Recusou importar', 'anexos');
  if (tool === 'search.query')
    return said(
      'Buscando',
      'Buscou',
      'Não buscou',
      'Recusou buscar',
      clip(String(input.query || 'na biblioteca')),
    );
  if (tool === 'canvas.read')
    return said('Lendo', 'Leu', 'Não leu', 'Recusou ler', `o canvas ${title}`);
  if (tool.startsWith('canvas.'))
    return said('Alterando', 'Alterou', 'Não alterou', 'Recusou alterar', `o canvas ${title}`);
  return said('Executando', 'Fez', 'Não fez', 'Recusou', 'uma ação');
}

export async function runAgentTurn(options: AgentTurnOptions): Promise<AgentTurn> {
  const key = String(options.key || '').trim();
  const providerId = options.provider || 'openai';
  const precisaChave = options.requiresKey ?? (provedor(providerId)?.precisaChave ?? true);
  if (precisaChave && !key) {
    options.onProgress?.({ phase: 'error', label: 'Guarde a chave no cofre do sistema.' });
    throw new EngineError('sem_chave', 'Guarde a chave no cofre do sistema.');
  }
  const signal = options.signal;
  const modo = modoOf(options);
  const context = normalizeContext(options.context);
  let libraryPath = options.libraryPath;
  const messages: AgentModelMessage[] = [
    { role: 'system', content: sofiSystemPrompt({ libraryPath, context, modo }) },
    { role: 'user', content: options.message },
  ];
  const actions: AgentAction[] = [];
  const sugestoes: AgentSuggestion[] = [];
  let raciocinio = '';
  const maxSteps = options.maxSteps && options.maxSteps > 0 ? options.maxSteps : DEFAULT_STEPS;
  let lastFailure = '';
  const finish = (text: string): AgentTurn =>
    fecharTurno(text, actions, sugestoes, raciocinio, libraryPath, context?.notePath, key);
  try {
    for (let step = 0; step < maxSteps; step += 1) {
      throwIfAborted(signal);
      options.onProgress?.({
        phase: 'thinking',
        label: step === 0 ? 'Pensando…' : 'Pensando no que fazer…',
      });
      const reply = await complete(options, messages, key, modo, signal);
      throwIfAborted(signal);
      const trecho = lembrarRaciocinio(raciocinio, reply.reasoning, key);
      if (trecho.houve) {
        raciocinio = trecho.acumulado;
        const evento: AgentProgress = { phase: 'reasoning', label: 'Raciocinando…' };
        if (trecho.resumo) evento.resumo = trecho.resumo;
        options.onProgress?.(evento);
      }
      if (!reply.toolCalls.length) {
        const text = redact(reply.content || (actions.length ? 'Pronto.' : 'Sem resposta.'), key);
        options.onProgress?.({ phase: 'done', label: 'Pronto.' });
        return finish(text);
      }
      const assistant: AgentModelMessage = {
        role: 'assistant',
        content: reply.content ? redact(reply.content, key) : null,
        tool_calls: reply.toolCalls.map((call) => ({
          id: call.id,
          type: 'function' as const,
          function: { name: call.name, arguments: call.argumentsJson },
        })),
      };
      if (reply.providerContent !== undefined) assistant.providerContent = reply.providerContent;
      messages.push(assistant);
      let halt = false;
      for (const call of reply.toolCalls) {
        throwIfAborted(signal);
        const outcome = await runCall(options, call, key, signal, libraryPath, modo);
        actions.push(outcome.action);
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: redact(stringifyResult(outcome.model), key),
        });
        if (outcome.suggestion) sugestoes.push(outcome.suggestion);
        if (outcome.switched) {
          libraryPath = outcome.switched.path;
          options.onLibraryChanged?.(outcome.switched);
        }
        if (!outcome.action.ok) {
          const signature = `${outcome.action.tool}\0${outcome.action.error || ''}`;
          if (signature === lastFailure) {
            halt = true;
            options.onProgress?.({
              phase: 'error',
              label: 'A mesma ação falhou outra vez.',
              tool: outcome.action.tool,
              actionId: outcome.action.id,
            });
            break;
          }
          lastFailure = signature;
        } else {
          lastFailure = '';
        }
      }
      if (halt) {
        const text = 'Parei porque a mesma ação falhou outra vez.';
        options.onProgress?.({ phase: 'done', label: text });
        return finish(text);
      }
    }
    const text = `Parei depois de ${maxSteps} passos.`;
    options.onProgress?.({ phase: 'done', label: text });
    return finish(text);
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) return canceledTurn(actions, options.onProgress);
    const label =
      error instanceof Error && error.message ? error.message : 'A Sofi não conseguiu responder.';
    options.onProgress?.({ phase: 'error', label: redact(label, key) });
    throw error;
  }
}

function canceledTurn(
  actions: AgentAction[],
  onProgress?: (event: AgentProgress) => void,
): AgentTurn {
  onProgress?.({ phase: 'done', label: 'Cancelado.', canceled: true });
  return { text: 'Cancelado.', actions, canceled: true };
}

type NormalizedCall = {
  id: string;
  name: string;
  argumentsJson: string;
  args: Record<string, unknown> | null;
};

async function complete(
  options: AgentTurnOptions,
  messages: AgentModelMessage[],
  key: string,
  modo: AgentModo,
  signal?: AbortSignal,
): Promise<{
  content: string | null;
  toolCalls: NormalizedCall[];
  reasoning: string | null;
  providerContent?: unknown;
}> {
  const client =
    options.client ||
    providerClient(options, key);
  const reply = await withSignal(
    Promise.resolve(client({ messages, tools: agentTools(modo), signal })),
    signal,
  );
  return normalizeReply(reply);
}

function providerClient(options: AgentTurnOptions, key: string): AgentModelClient {
  if (!options.fetchImpl)
    throw new EngineError('invalid-note', 'O pedido à Sofi sai só do processo principal.');
  const providerId = options.provider || 'openai';
  const item = provedor(providerId);
  return createProviderClient({
    provider: providerId,
    endpoint: options.endpoint || item?.endpointPadrao || 'https://api.openai.com/v1',
    model: options.model || 'gpt-4o-mini',
    key,
    fetchImpl: options.fetchImpl,
    raciocinio: options.raciocinio,
  });
}

function normalizeReply(reply: AgentModelReply | undefined): {
  content: string | null;
  toolCalls: NormalizedCall[];
  reasoning: string | null;
  providerContent?: unknown;
} {
  const toolCalls = (reply?.toolCalls || []).map((call, index) => {
    const parsed = parseArguments(call.arguments);
    const args = parsed.ok ? parsed.value : null;
    return {
      id: call.id || `call-${index + 1}-${randomUUID()}`,
      name: String(call.name || ''),
      argumentsJson: JSON.stringify(args || {}),
      args,
    };
  });
  const content = typeof reply?.content === 'string' ? reply.content : null;
  const reasoning = typeof reply?.reasoning === 'string' ? reply.reasoning : null;
  return {
    content,
    toolCalls,
    reasoning,
    ...(reply?.providerContent !== undefined ? { providerContent: reply.providerContent } : {}),
  };
}

async function runCall(
  options: AgentTurnOptions,
  call: NormalizedCall,
  key: string,
  signal: AbortSignal | undefined,
  libraryPath: string,
  modo: AgentModo,
): Promise<{
  action: AgentAction;
  model: unknown;
  suggestion?: AgentSuggestion;
  switched?: { id: string; name: string; path: string };
}> {
  const name = call.name;
  const phrase = agentActionPhrase(name, call.args || {});
  const id = randomUUID();
  if (modo === 'pergunta' && toolMutates(name)) {
    return failure(id, name, phrase, call.args || {}, 'modo_pergunta');
  }
  if (!call.args) {
    return failure(id, name, phrase, {}, 'Os argumentos da ferramenta não são um JSON válido.');
  }
  const input = publicInput(call.args, key);
  const known = tools.find((tool) => tool.name === name);
  if (!known || name.startsWith('ui.') || blocked.test(name)) {
    const error = known
      ? 'Essa ferramenta não está disponível para a Sofi.'
      : 'Ferramenta desconhecida.';
    return failure(id, name || 'desconhecida', phrase, input, error);
  }
  const question = agentConfirmation(name, call.args);
  if (question) {
    const request: AgentConfirmRequest = {
      confirmId: randomUUID(),
      tool: name,
      label: question,
      input,
    };
    let allowed = false;
    try {
      allowed = options.confirm
        ? Boolean(await withSignal(Promise.resolve(options.confirm(request)), signal))
        : false;
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) throw abortError();
      throw error;
    }
    throwIfAborted(signal);
    if (!allowed)
      return failure(id, name, phrase, input, 'A pessoa recusou esta ação.', phrase.denied);
  }
  options.onProgress?.({ phase: 'tool', label: phrase.progress, tool: name, actionId: id });
  try {
    const value = callTool(name, bindInput(known, call.args, libraryPath));
    const versionId = trackedVersionId(value);
    const action: AgentAction = { id, tool: name, label: phrase.done, input, ok: true };
    if (versionId) action.versionId = versionId;
    const model = versionId ? { ok: true, value, versionId } : { ok: true, value };
    const suggestion = suggestionOf(name, value);
    const switched = switchOf(name, value);
    return { action, model, ...(suggestion ? { suggestion } : {}), ...(switched ? { switched } : {}) };
  } catch (error) {
    return failure(id, name, phrase, input, errorText(error));
  }
}

function failure(
  id: string,
  tool: string,
  phrase: Phrase,
  input: Record<string, unknown>,
  error: string,
  label = phrase.failed,
): { action: AgentAction; model: unknown } {
  return {
    action: { id, tool, label, input, ok: false, error },
    model: { ok: false, error },
  };
}

function bindInput(tool: Tool, args: Record<string, unknown>, libraryPath: string) {
  const input = { ...args };
  for (const secret of secretKeys) delete input[secret];
  delete input.libraryPath;
  delete input.origin;
  const keys = inputKeys(tool);
  if (keys.has('libraryPath')) input.libraryPath = libraryPath;
  if (keys.has('origin')) input.origin = 'agent';
  return input;
}

function publicInput(args: Record<string, unknown>, key: string) {
  const copy: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(args)) {
    if (secretKeys.has(name) || name === 'libraryPath' || name === 'origin') continue;
    copy[name] = typeof value === 'string' ? redact(value, key) : value;
  }
  return copy;
}

export function sofiSystemPrompt(input: {
  libraryPath?: string;
  context?: unknown;
  modo?: AgentModo;
}) {
  const modo = input.modo === 'pergunta' ? 'pergunta' : modoOf({ context: input.context, modo: input.modo });
  const context = normalizeContext(input.context);
  return buildSystemPrompt({
    modo,
    libraryPath: input.libraryPath,
    notePath: context?.notePath,
    selection: context?.selection,
    tools: agentTools(modo).map((tool) => ({
      name: tool.function.name,
      description: tool.function.description,
      entrada: Object.keys(tool.function.parameters.properties || {}),
    })),
  });
}

export function normalizeContext(value: unknown): AgentContext | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const context: AgentContext = {};
  if (typeof raw.notePath === 'string' && raw.notePath.trim())
    context.notePath = raw.notePath.trim().slice(0, 500);
  const selection = raw.selection;
  if (selection && typeof selection === 'object' && !Array.isArray(selection)) {
    const item = selection as Record<string, unknown>;
    if (typeof item.text === 'string') {
      context.selection = {
        text: item.text.slice(0, 4000),
        from: typeof item.from === 'number' && Number.isFinite(item.from) ? item.from : 0,
        to: typeof item.to === 'number' && Number.isFinite(item.to) ? item.to : 0,
      };
    }
  }
  if (!context.notePath && !context.selection) return undefined;
  return context;
}

function modoOf(options: { modo?: AgentModo; context?: unknown }): AgentModo {
  if (options.modo === 'pergunta' || options.modo === 'agente') return options.modo;
  if (options.context && typeof options.context === 'object' && !Array.isArray(options.context)) {
    const modo = (options.context as Record<string, unknown>).modo;
    if (modo === 'pergunta') return 'pergunta';
  }
  return 'agente';
}

function confirmacaoDeBiblioteca(args: Record<string, unknown>) {
  const id = String(args.id || '').trim();
  let nome = 'indicada';
  try {
    const found = listLibrariesForAgent().find((item) => item.id === id);
    if (found?.name) nome = found.name;
  } catch {
    /* a pergunta segue genérica */
  }
  return `Trocar para a biblioteca ${nome}?`;
}

function suggestionOf(name: string, value: unknown): AgentSuggestion | undefined {
  if (name !== 'note.suggest' || !value || typeof value !== 'object') return undefined;
  const item = value as Record<string, unknown>;
  if (typeof item.titulo !== 'string') return undefined;
  return { titulo: item.titulo, conteudo: typeof item.conteudo === 'string' ? item.conteudo : '' };
}

function switchOf(name: string, value: unknown) {
  if (name !== 'library.switch' || !value || typeof value !== 'object') return undefined;
  const item = value as Record<string, unknown>;
  if (typeof item.path !== 'string' || typeof item.id !== 'string') return undefined;
  return {
    id: item.id,
    name: typeof item.name === 'string' ? item.name : item.id,
    path: item.path,
  };
}

function lembrarRaciocinio(acumulado: string, reasoning: string | null, key: string) {
  if (reasoning === null) return { houve: false, acumulado, resumo: '' };
  const resumo = redact(reasoning, key).trim().slice(0, 2000);
  const junto = resumo ? (acumulado ? `${acumulado}\n${resumo}` : resumo) : acumulado;
  return {
    houve: true,
    acumulado: junto.length > 2000 ? junto.slice(junto.length - 2000) : junto,
    resumo,
  };
}

function fecharTurno(
  text: string,
  actions: AgentAction[],
  sugestoes: AgentSuggestion[],
  raciocinio: string,
  libraryPath: string,
  notePath: string | undefined,
  key: string,
): AgentTurn {
  const turn: AgentTurn = { text, actions };
  if (sugestoes.length) turn.sugestoes = sugestoes;
  try {
    const missing = wikilinksInexistentes(libraryPath, text, notePath || '');
    if (missing.length) turn.linksInexistentes = missing;
  } catch {
    /* índice indisponível não impede a resposta */
  }
  const curto = redact(raciocinio, key).trim();
  if (curto) turn.raciocinio = curto.slice(0, 2000);
  return turn;
}

function parametersOf(tool: Tool) {
  const schema = tool.input.toJSONSchema() as {
    properties?: Record<string, unknown>;
    required?: string[];
  };
  const properties = { ...(schema.properties ?? {}) };
  delete properties.libraryPath;
  delete properties.origin;
  const required = (schema.required ?? []).filter(
    (key) => key !== 'libraryPath' && key !== 'origin',
  );
  return {
    type: 'object' as const,
    properties,
    ...(required.length ? { required } : {}),
  };
}

function inputKeys(tool: Tool) {
  const schema = tool.input.toJSONSchema() as { properties?: Record<string, unknown> };
  return new Set(Object.keys(schema.properties ?? {}));
}

function parseArguments(
  raw: unknown,
): { ok: true; value: Record<string, unknown> } | { ok: false } {
  if (raw && typeof raw === 'object' && !Array.isArray(raw))
    return { ok: true, value: { ...(raw as Record<string, unknown>) } };
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw || '{}') as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
        return { ok: true, value: parsed as Record<string, unknown> };
    } catch {
      return { ok: false };
    }
    return { ok: false };
  }
  if (raw == null) return { ok: true, value: {} };
  return { ok: false };
}

function said(
  progress: string,
  done: string,
  failed: string,
  denied: string,
  rest: string,
): Phrase {
  const join = (verb: string) => (rest ? `${verb} ${rest}` : verb);
  return { progress: join(progress), done: join(done), failed: join(failed), denied: join(denied) };
}

function fileTitle(value: unknown) {
  const base = String(value ?? '')
    .split(/[/\\]/)
    .pop();
  const bare = (base || '').replace(/\.(md|canvas|view)$/i, '').trim();
  return bare || 'sem nome';
}

function clip(value: string) {
  const text = value.trim();
  return text.length > 40 ? `${text.slice(0, 40)}…` : text || 'na biblioteca';
}

function stringifyResult(value: unknown) {
  try {
    const text = JSON.stringify(value);
    return text.length > 8000 ? `${text.slice(0, 8000)}…` : text;
  } catch {
    return '{"ok":false,"error":"Não foi possível ler o resultado."}';
  }
}

function redact(text: string, key: string) {
  if (!key) return text;
  return text.split(key).join('•••');
}

function errorText(error: unknown) {
  if (error instanceof EngineError) return error.message;
  if (error instanceof z.ZodError) return 'Os argumentos da ferramenta são inválidos.';
  if (error instanceof Error && error.message) return error.message;
  return 'A ferramenta falhou.';
}

function abortError() {
  const error = new Error('A operação foi cancelada.');
  error.name = 'AbortError';
  return error;
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError';
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError();
}

function withSignal<T>(promise: Promise<T>, signal?: AbortSignal) {
  throwIfAborted(signal);
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(isAbortError(error) || signal.aborted ? abortError() : error);
      },
    );
  });
}
