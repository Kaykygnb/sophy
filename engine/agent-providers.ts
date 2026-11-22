export type AgentProtocol = 'openai' | 'anthropic';

export type AgentProvider = {
  id: string;
  nome: string;
  endpointPadrao: string;
  precisaChave: boolean;
  modelosSugeridos: string[];
  protocolo: AgentProtocol;
};

export const AGENT_PROVIDERS: readonly AgentProvider[] = [
  {
    id: 'openai',
    nome: 'OpenAI',
    endpointPadrao: 'https://api.openai.com/v1',
    precisaChave: true,
    modelosSugeridos: ['gpt-4o-mini', 'gpt-4o', 'gpt-5', 'o4-mini'],
    protocolo: 'openai',
  },
  {
    id: 'anthropic',
    nome: 'Anthropic',
    endpointPadrao: 'https://api.anthropic.com/v1',
    precisaChave: true,
    modelosSugeridos: ['claude-sonnet-4-5', 'claude-3-5-haiku-latest'],
    protocolo: 'anthropic',
  },
  {
    id: 'gemini',
    nome: 'Gemini',
    endpointPadrao: 'https://generativelanguage.googleapis.com/v1beta/openai',
    precisaChave: true,
    modelosSugeridos: ['gemini-2.5-flash', 'gemini-2.5-pro'],
    protocolo: 'openai',
  },
  {
    id: 'openrouter',
    nome: 'OpenRouter',
    endpointPadrao: 'https://openrouter.ai/api/v1',
    precisaChave: true,
    modelosSugeridos: ['openai/gpt-4o-mini', 'anthropic/claude-sonnet-4-5', 'deepseek/deepseek-r1'],
    protocolo: 'openai',
  },
  {
    id: 'nvidia',
    nome: 'NVIDIA',
    endpointPadrao: 'https://integrate.api.nvidia.com/v1',
    precisaChave: true,
    modelosSugeridos: ['meta/llama-3.1-8b-instruct'],
    protocolo: 'openai',
  },
  {
    id: 'groq',
    nome: 'Groq',
    endpointPadrao: 'https://api.groq.com/openai/v1',
    precisaChave: true,
    modelosSugeridos: ['llama-3.3-70b-versatile', 'openai/gpt-oss-20b', 'qwen/qwen3-32b'],
    protocolo: 'openai',
  },
  {
    id: 'xai',
    nome: 'xAI',
    endpointPadrao: 'https://api.x.ai/v1',
    precisaChave: true,
    modelosSugeridos: ['grok-3', 'grok-3-mini', 'grok-4'],
    protocolo: 'openai',
  },
  {
    id: 'ollama',
    nome: 'Ollama',
    endpointPadrao: 'http://localhost:11434/v1',
    precisaChave: false,
    modelosSugeridos: ['llama3.2', 'qwen3', 'deepseek-r1'],
    protocolo: 'openai',
  },
  {
    id: 'personalizado',
    nome: 'Personalizado',
    endpointPadrao: '',
    precisaChave: true,
    modelosSugeridos: [],
    protocolo: 'openai',
  },
];

export function provedor(id: string) {
  return AGENT_PROVIDERS.find((item) => item.id === id);
}

export function agentProviders() {
  return AGENT_PROVIDERS.map((item) => ({ ...item, modelosSugeridos: [...item.modelosSugeridos] }));
}
