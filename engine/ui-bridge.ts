import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EngineError } from './errors.ts';

/**
 * Canal que a interface vai assinar na etapa 5.
 * O processo do `sophy mcp` não tem essa assinatura, então as tools de UI
 * respondem que a interface não está aberta.
 */
export type UiCommand =
  | { type: 'openNote'; libraryPath: string; path: string }
  | { type: 'openCanvas'; libraryPath: string; path: string }
  | { type: 'showGraph'; libraryPath: string; workspace?: string }
  | { type: 'setTheme'; theme: 'light' | 'dark' };

type UiListener = (command: UiCommand) => void;

const listeners = new Set<UiListener>();

export function subscribeUi(listener: UiListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function uiIsOpen() {
  return listeners.size > 0;
}

/** Pasta em que a janela publica que está aberta. O MCP de outro processo entrega por aqui. */
export function uiDirectory() {
  if (process.env.SOPHY_UI_DIR) return process.env.SOPHY_UI_DIR;
  const testing =
    process.env.NODE_TEST_CONTEXT !== undefined ||
    process.execArgv.some((arg) => arg.includes('test')) ||
    process.argv.some((arg) => arg.includes('--test'));
  if (testing) return path.join(os.tmpdir(), `sophy-ui-test-${process.pid}`);
  const uid = typeof process.getuid === 'function' ? String(process.getuid()) : 'user';
  return path.join(os.tmpdir(), `sophy-ui-${uid}`);
}

export function publishUiPresence() {
  const dir = uiDirectory();
  fs.mkdirSync(dir, { recursive: true });
  const lock = path.join(dir, 'lock');
  fs.writeFileSync(lock, String(process.pid));
  return () => {
    try {
      if (fs.readFileSync(lock, 'utf8').trim() === String(process.pid)) fs.unlinkSync(lock);
    } catch {
      /* a janela seguinte já assumiu o lugar */
    }
  };
}

function remoteUiAlive() {
  try {
    const pid = Number(fs.readFileSync(path.join(uiDirectory(), 'lock'), 'utf8'));
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function deliverRemote(command: UiCommand) {
  const dir = uiDirectory();
  const id = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const request = path.join(dir, `${id}.req.json`);
  const response = path.join(dir, `${id}.res.json`);
  fs.writeFileSync(request, JSON.stringify(command));
  const slot = new Int32Array(new SharedArrayBuffer(4));
  const started = Date.now();
  while (Date.now() - started < 800) {
    if (fs.existsSync(response)) {
      const body = JSON.parse(fs.readFileSync(response, 'utf8')) as { ok?: boolean };
      fs.rmSync(request, { force: true });
      fs.rmSync(response, { force: true });
      if (!body.ok) throw new EngineError('ui-offline', 'A interface não está aberta.');
      return { delivered: true, command };
    }
    Atomics.wait(slot, 0, 0, 20);
  }
  fs.rmSync(request, { force: true });
  throw new EngineError('ui-offline', 'A interface não está aberta.');
}

/** A janela lê os pedidos deixados por um `sophy mcp` de outro processo. */
export function takeUiRequests(): UiCommand[] {
  const dir = uiDirectory();
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir).filter((name) => name.endsWith('.req.json'));
  } catch {
    return [];
  }
  const commands: UiCommand[] = [];
  for (const name of names) {
    const request = path.join(dir, name);
    try {
      const command = JSON.parse(fs.readFileSync(request, 'utf8')) as UiCommand;
      if (!command || typeof command !== 'object' || typeof command.type !== 'string') continue;
      fs.writeFileSync(request.replace(/\.req\.json$/, '.res.json'), '{"ok":true}');
      fs.rmSync(request, { force: true });
      commands.push(command);
    } catch {
      /* pedido ainda incompleto */
    }
  }
  return commands;
}

export function requestUi(command: UiCommand) {
  if (listeners.size === 0) {
    if (remoteUiAlive()) return deliverRemote(command);
    throw new EngineError('ui-offline', 'A interface não está aberta.');
  }
  for (const listener of listeners) listener(command);
  return { delivered: true, command };
}
