/** Erro do motor. `code` é estável para CLI, MCP e UI. */
export class EngineError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
  }
}
