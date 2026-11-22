export const ESFORCOS = ['baixo', 'medio', 'alto'] as const;

export type Esforco = (typeof ESFORCOS)[number];

export type ModeloCapacidade = {
  raciocinio: boolean;
  esforcos: Esforco[] | null;
  pensamentoOrcamento: boolean;
};

export type Raciocinio = {
  ativo: boolean;
  esforco?: Esforco;
  orcamentoTokens?: number;
};

const ORCAMENTO_POR_ESFORCO: Record<Esforco, number> = {
  baixo: 1024,
  medio: 4096,
  alto: 16384,
};

const API_ESFORCO: Record<Esforco, 'low' | 'medium' | 'high'> = {
  baixo: 'low',
  medio: 'medium',
  alto: 'high',
};

function nenhuma(): ModeloCapacidade {
  return { raciocinio: false, esforcos: null, pensamentoOrcamento: false };
}

function comEsforco(): ModeloCapacidade {
  return { raciocinio: true, esforcos: [...ESFORCOS], pensamentoOrcamento: false };
}

function comOrcamento(): ModeloCapacidade {
  return { raciocinio: true, esforcos: [...ESFORCOS], pensamentoOrcamento: true };
}

function soRaciocinio(pensamentoOrcamento: boolean): ModeloCapacidade {
  return { raciocinio: true, esforcos: null, pensamentoOrcamento };
}

function openaiRazao(id: string) {
  return /(^|\/)(o\d|gpt-5)([^a-z0-9]|$)/.test(id);
}

function claudePensamento(id: string) {
  return /claude-(3-7|3\.7|sonnet-4|opus-4|haiku-4)/.test(id);
}

function geminiPensamento(id: string) {
  return /gemini-(2\.5|3)([^0-9]|$)/.test(id);
}

function grokRazao(id: string) {
  return /grok-3-mini|grok-4([^0-9]|$)/.test(id);
}

function esforcoGroq(id: string) {
  return /gpt-oss|qwen3|qwq/.test(id);
}

function deepseek(id: string) {
  return /deepseek-r1|deepseek-reasoner/.test(id);
}

function ollamaPensamento(id: string) {
  return /deepseek-r1|qwen3|qwq|gpt-oss|openthinker/.test(id);
}

/**
 * Tabela de capacidades por provedor e pelo id do modelo.
 * O que não está aqui cai em `raciocinio: false`.
 */
export function capacidadeDoModelo(provider: string, modelId: string): ModeloCapacidade {
  const id = modelId.trim().toLowerCase();
  const provedor = provider.trim().toLowerCase();
  if (!id) return nenhuma();
  switch (provedor) {
    case 'openai':
      return openaiRazao(id) ? comEsforco() : nenhuma();
    case 'anthropic':
      return claudePensamento(id) ? comOrcamento() : nenhuma();
    case 'gemini':
      return geminiPensamento(id) ? comOrcamento() : nenhuma();
    case 'xai':
      return grokRazao(id) ? comEsforco() : nenhuma();
    case 'groq':
      if (deepseek(id)) return soRaciocinio(false);
      if (esforcoGroq(id)) return comEsforco();
      return nenhuma();
    case 'openrouter':
      if (claudePensamento(id) || geminiPensamento(id)) return comOrcamento();
      if (deepseek(id)) return soRaciocinio(true);
      if (openaiRazao(id) || grokRazao(id) || esforcoGroq(id)) return comEsforco();
      return nenhuma();
    case 'ollama':
      return ollamaPensamento(id) ? comEsforco() : nenhuma();
    case 'nvidia':
    case 'personalizado':
      if (deepseek(id)) return soRaciocinio(false);
      if (openaiRazao(id) || esforcoGroq(id)) return comEsforco();
      return nenhuma();
    default:
      return nenhuma();
  }
}

export function anunciarModelo(provider: string, id: string, nome = id) {
  const capacidade = capacidadeDoModelo(provider, id);
  return {
    id,
    nome,
    raciocinio: capacidade.raciocinio,
    esforcos: capacidade.esforcos,
    pensamentoOrcamento: capacidade.pensamentoOrcamento,
  };
}

/** Descarta esforço ou orçamento que o modelo não declara. Não lança erro. */
export function sanitizarRaciocinio(
  provider: string,
  model: string,
  raw: unknown,
): Raciocinio | undefined {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const capacidade = capacidadeDoModelo(provider, model);
  if (!capacidade.raciocinio) return undefined;
  const item = raw as Record<string, unknown>;
  if (typeof item.ativo !== 'boolean') return undefined;
  if (!item.ativo) return { ativo: false };
  const next: Raciocinio = { ativo: true };
  if (
    capacidade.esforcos &&
    typeof item.esforco === 'string' &&
    (capacidade.esforcos as string[]).includes(item.esforco)
  ) {
    next.esforco = item.esforco as Esforco;
  }
  const orcamento = item.orcamentoTokens;
  if (
    capacidade.pensamentoOrcamento &&
    typeof orcamento === 'number' &&
    Number.isInteger(orcamento) &&
    orcamento > 0 &&
    orcamento <= 128000
  ) {
    next.orcamentoTokens = orcamento;
  }
  return next;
}

export function esforcoApi(esforco: Esforco | undefined) {
  return API_ESFORCO[esforco || 'medio'];
}

export function orcamentoDe(raciocinio: Raciocinio | undefined) {
  if (!raciocinio?.ativo) return undefined;
  if (raciocinio.orcamentoTokens) return raciocinio.orcamentoTokens;
  return ORCAMENTO_POR_ESFORCO[raciocinio.esforco || 'medio'];
}

export function endpointGeminiNativo(endpoint: string) {
  return (
    endpoint.includes('generativelanguage.googleapis.com') && !endpoint.includes('/openai')
  );
}
