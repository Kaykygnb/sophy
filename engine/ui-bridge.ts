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

export function requestUi(command: UiCommand) {
  if (listeners.size === 0) throw new EngineError('ui-offline', 'A interface não está aberta.');
  for (const listener of listeners) listener(command);
  return { delivered: true, command };
}
