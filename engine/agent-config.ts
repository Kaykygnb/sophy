import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { EngineError } from './errors.ts';
import { provedor } from './agent-providers.ts';
import { sanitizarRaciocinio, type Raciocinio } from './agent-reasoning.ts';

/**
 * Perfis da Sofi. A chave não entra no JSON do perfil.
 *
 * `modo: 'cofre'` guarda `safeStorage.encryptString` em base64. É o caminho
 * normal, quando o cofre do sistema está disponível.
 * `modo: 'arquivo'` é o fallback: a chave fica em base64 puro dentro de
 * `agent-secrets.json`, na pasta de dados do app. Quem lê essa pasta recupera
 * a chave. Só usamos isso quando `cofre.disponivel` é falso.
 */
export type Cofre = {
  disponivel: boolean;
  cifrar(texto: string): string;
  decifrar(dados: string): string;
};

export type Armazenamento = 'cofre' | 'arquivo';

export type PerfilPublico = {
  id: string;
  provider: string;
  nome: string;
  endpoint: string;
  model: string;
  temChave: boolean;
  /** Como esta chave está guardada. Só existe quando `temChave` é verdadeiro. */
  armazenamento?: Armazenamento;
  raciocinio?: Raciocinio;
};

export type ConfigPublico = {
  ativo: string | null;
  /** Modo em que uma chave nova seria guardada agora. */
  armazenamento: Armazenamento;
  perfis: PerfilPublico[];
};

type Perfil = Omit<PerfilPublico, 'temChave' | 'armazenamento'>;

type Segredo = { modo: 'cofre' | 'arquivo'; dados: string };

type Estado = {
  ativo: string | null;
  perfis: Perfil[];
  chaves: Record<string, Segredo>;
};

function vazio(): Estado {
  return { ativo: null, perfis: [], chaves: {} };
}

function lerJson(file: string) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
  } catch {
    throw new EngineError('invalid-path', 'O arquivo de perfis da Sofi está inválido.');
  }
}

function carregar(dir: string): Estado {
  const perfis = lerJson(path.join(dir, 'agent-profiles.json'));
  const segredos = lerJson(path.join(dir, 'agent-secrets.json'));
  const estado = vazio();
  if (perfis && typeof perfis === 'object' && !Array.isArray(perfis)) {
    const bruto = perfis as Record<string, unknown>;
    estado.ativo = typeof bruto.ativo === 'string' ? bruto.ativo : null;
    if (Array.isArray(bruto.perfis)) {
      for (const item of bruto.perfis) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        const perfil = item as Record<string, unknown>;
        if (typeof perfil.id !== 'string' || typeof perfil.provider !== 'string') continue;
        if (typeof perfil.model !== 'string' || typeof perfil.endpoint !== 'string') continue;
        const salvo: Perfil = {
          id: perfil.id,
          provider: perfil.provider,
          nome: typeof perfil.nome === 'string' ? perfil.nome : perfil.provider,
          endpoint: perfil.endpoint,
          model: perfil.model,
        };
        if (perfil.raciocinio && typeof perfil.raciocinio === 'object') {
          const raciocinio = sanitizarRaciocinio(salvo.provider, salvo.model, perfil.raciocinio);
          if (raciocinio) salvo.raciocinio = raciocinio;
        }
        estado.perfis.push(salvo);
      }
    }
    if (estado.ativo && !estado.perfis.some((item) => item.id === estado.ativo)) estado.ativo = null;
  }
  if (segredos && typeof segredos === 'object' && !Array.isArray(segredos)) {
    const chaves = (segredos as Record<string, unknown>).chaves;
    if (chaves && typeof chaves === 'object' && !Array.isArray(chaves)) {
      for (const [id, value] of Object.entries(chaves)) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
        const item = value as Record<string, unknown>;
        if ((item.modo !== 'cofre' && item.modo !== 'arquivo') || typeof item.dados !== 'string')
          continue;
        estado.chaves[id] = { modo: item.modo, dados: item.dados };
      }
    }
  }
  return estado;
}

function gravar(dir: string, estado: Estado) {
  fs.mkdirSync(dir, { recursive: true });
  const perfis = {
    ativo: estado.ativo,
    perfis: estado.perfis.map((item) => {
      const publico: Perfil = {
        id: item.id,
        provider: item.provider,
        nome: item.nome,
        endpoint: item.endpoint,
        model: item.model,
      };
      if (item.raciocinio) publico.raciocinio = item.raciocinio;
      return publico;
    }),
  };
  fs.writeFileSync(path.join(dir, 'agent-profiles.json'), JSON.stringify(perfis, null, 2));
  fs.writeFileSync(
    path.join(dir, 'agent-secrets.json'),
    JSON.stringify({ chaves: estado.chaves }, null, 2),
  );
}

function endpointDe(providerId: string, informado: unknown) {
  const item = provedor(providerId);
  if (!item) throw new EngineError('invalid-path', 'Provedor desconhecido.');
  const texto = typeof informado === 'string' ? informado.trim() : '';
  const bruto = texto || item.endpointPadrao;
  if (!bruto) throw new EngineError('invalid-path', 'Informe o endpoint.');
  let url: URL;
  try {
    url = new URL(bruto);
  } catch {
    throw new EngineError('invalid-path', 'Endpoint inválido.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new EngineError('invalid-path', 'O endpoint precisa ser http ou https.');
  return url.toString().replace(/\/$/, '');
}

function publico(estado: Estado, cofre: Cofre): ConfigPublico {
  return {
    ativo: estado.ativo,
    armazenamento: cofre.disponivel ? 'cofre' : 'arquivo',
    perfis: estado.perfis.map((item) => {
      const segredo = estado.chaves[item.id];
      const perfil: PerfilPublico = {
        id: item.id,
        provider: item.provider,
        nome: item.nome,
        endpoint: item.endpoint,
        model: item.model,
        temChave: Boolean(segredo),
      };
      if (segredo) perfil.armazenamento = segredo.modo;
      if (item.raciocinio) perfil.raciocinio = item.raciocinio;
      return perfil;
    }),
  };
}

export function abrirAgentConfig(dir: string, cofre: Cofre) {
  const estado = carregar(dir);

  function salvar() {
    gravar(dir, estado);
  }

  function guardarChave(id: string, key: string) {
    if (cofre.disponivel) {
      estado.chaves[id] = { modo: 'cofre', dados: cofre.cifrar(key) };
      return;
    }
    estado.chaves[id] = { modo: 'arquivo', dados: Buffer.from(key, 'utf8').toString('base64') };
  }

  return {
    temPerfis() {
      return estado.perfis.length > 0;
    },
    get() {
      return publico(estado, cofre);
    },
    segredo(id: string) {
      const item = estado.chaves[id];
      if (!item) return null;
      if (item.modo === 'arquivo') return Buffer.from(item.dados, 'base64').toString('utf8');
      try {
        return cofre.decifrar(item.dados);
      } catch {
        throw new EngineError('invalid-path', 'Não foi possível ler a chave no cofre.');
      }
    },
    set(input: Record<string, unknown>) {
      const idInformado = typeof input.id === 'string' ? input.id.trim() : '';
      const atual = idInformado ? estado.perfis.find((item) => item.id === idInformado) : undefined;
      if (idInformado && !atual) throw new EngineError('not-found', 'Perfil não encontrado.');
      const provider =
        typeof input.provider === 'string' && input.provider.trim()
          ? input.provider.trim()
          : atual?.provider;
      if (!provider || !provedor(provider))
        throw new EngineError('invalid-path', 'Provedor desconhecido.');
      const model =
        typeof input.model === 'string' && input.model.trim()
          ? input.model.trim().slice(0, 200)
          : atual?.model;
      if (!model) throw new EngineError('invalid-path', 'Informe o modelo.');
      const nomeBruto =
        typeof input.nome === 'string' && input.nome.trim()
          ? input.nome.trim()
          : atual?.nome || provedor(provider)?.nome || provider;
      const endpoint = endpointDe(
        provider,
        'endpoint' in input ? input.endpoint : atual?.endpoint,
      );
      let raciocinio = atual?.raciocinio;
      if ('raciocinio' in input) raciocinio = sanitizarRaciocinio(provider, model, input.raciocinio);
      else if (raciocinio) raciocinio = sanitizarRaciocinio(provider, model, raciocinio);
      const perfil: Perfil = {
        id: atual?.id || randomUUID(),
        provider,
        nome: nomeBruto.slice(0, 80),
        endpoint,
        model,
      };
      if (raciocinio) perfil.raciocinio = raciocinio;
      if (atual) {
        delete atual.raciocinio;
        Object.assign(atual, perfil);
      } else estado.perfis.push(perfil);
      if ('apiKey' in input) {
        const chave = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
        if (chave) guardarChave(perfil.id, chave);
        else delete estado.chaves[perfil.id];
      }
      if (input.ativar === true || !estado.ativo) estado.ativo = perfil.id;
      salvar();
      return { ...publico(estado, cofre), id: perfil.id };
    },
    remove(id: unknown) {
      if (typeof id !== 'string' || !estado.perfis.some((item) => item.id === id))
        throw new EngineError('not-found', 'Perfil não encontrado.');
      estado.perfis = estado.perfis.filter((item) => item.id !== id);
      delete estado.chaves[id];
      if (estado.ativo === id) estado.ativo = null;
      salvar();
      return publico(estado, cofre);
    },
    activate(id: unknown) {
      if (typeof id !== 'string' || !estado.perfis.some((item) => item.id === id))
        throw new EngineError('not-found', 'Perfil não encontrado.');
      estado.ativo = id;
      salvar();
      return publico(estado, cofre);
    },
    importarLegado(key: string) {
      if (estado.perfis.length) return false;
      const limpa = key.trim();
      if (!limpa) return false;
      this.set({
        provider: 'openai',
        nome: 'OpenAI',
        model: 'gpt-4o-mini',
        apiKey: limpa,
        ativar: true,
      });
      return true;
    },
  };
}

type Loja = {
  get(): { perfis: PerfilPublico[] };
  segredo(id: string): string | null;
};

function texto(valor: unknown) {
  return typeof valor === 'string' ? valor.trim() : '';
}

/** Lista modelos de um perfil salvo ou de um provedor ainda não gravado. Não lê chave de outro perfil. */
export function resolverModelos(loja: Loja, input: Record<string, unknown>) {
  const id = texto(input.id);
  if (id) {
    const perfil = loja.get().perfis.find((item) => item.id === id);
    if (!perfil) throw new EngineError('not-found', 'Perfil não encontrado.');
    return {
      provider: perfil.provider,
      endpoint: perfil.endpoint,
      apiKey: loja.segredo(perfil.id) || '',
    };
  }
  const provider = texto(input.provider);
  if (!provider || !provedor(provider))
    throw new EngineError('invalid-path', 'Informe o perfil ou o provedor.');
  const endpoint = texto(input.endpoint);
  const apiKey =
    Object.prototype.hasOwnProperty.call(input, 'apiKey') && typeof input.apiKey === 'string'
      ? input.apiKey.trim()
      : '';
  return { provider, ...(endpoint ? { endpoint } : {}), apiKey };
}

/** Monta o teste de conexão. Com `id`, os campos informados só substituem o perfil nesta chamada. */
export function resolverTeste(loja: Loja, input: Record<string, unknown>) {
  const id = texto(input.id);
  if (id) {
    const perfil = loja.get().perfis.find((item) => item.id === id);
    if (!perfil) throw new EngineError('not-found', 'Perfil não encontrado.');
    const endpoint = texto(input.endpoint) || perfil.endpoint;
    const model = texto(input.model) || perfil.model;
    const apiKey = Object.prototype.hasOwnProperty.call(input, 'apiKey')
      ? texto(input.apiKey)
      : loja.segredo(perfil.id) || '';
    const raciocinio = Object.prototype.hasOwnProperty.call(input, 'raciocinio')
      ? input.raciocinio
      : perfil.raciocinio;
    return { provider: perfil.provider, endpoint, model, apiKey, raciocinio };
  }
  const provider = texto(input.provider);
  const model = texto(input.model);
  if (!provider || !model)
    throw new EngineError('invalid-path', 'Informe o perfil ou o provedor e o modelo.');
  const item = provedor(provider);
  if (!item) throw new EngineError('invalid-path', 'Provedor desconhecido.');
  return {
    provider,
    endpoint: texto(input.endpoint) || item.endpointPadrao,
    model,
    apiKey: texto(input.apiKey),
    raciocinio: input.raciocinio,
  };
}
