# ESPEC-BACK: o que o front precisa do back

Autora: Pricila (design e front). Destino: Fernando (engine, main, preload, IPC).
Branch do front: `pricila/revisao-visual` (PR #30). Nada abaixo foi implementado no back.
No front existe só o visual estático: ••• da nota com "Exportar como PDF" e "Exportar como Markdown" desabilitados, e itens "em breve" em Configurações.

## Convenções

- Todo IPC novo segue o padrão atual: `ipcRenderer.invoke('sophy:<nome>')` exposto no `window.sophy`, com resposta `{ ok, value | error }` via `handle()`.
- O que é operação de biblioteca entra como **tool** do engine, chamada por `sophy:tool`. Assim o agente e o MCP herdam a operação de graça. O IPC direto fica só para o que depende do Electron: diálogos, `shell`, `safeStorage` e janelas.
- Cada erro volta em pt-BR, curto e acionável. O front mostra a mensagem do jeito que chegar.
- Cada escrita grava um ponto de versão antes de agir, como já fazem agente e MCP.

---

## 1. Anexos

### Onde fica na interface (para ver, sem decorar atalho)

| Lugar | O que aparece |
|---|---|
| Editor | Arrastar arquivo para a nota mostra a faixa "Solte para anexar". Colar imagem (Ctrl+V) também anexa. |
| Editor, botão visível | Item **Anexo** no menu `+` da margem e no `/`, com o ícone `anexo` que já está no sprite. |
| Bloco renderizado | Imagem vira `![[anexos/foto.png]]`, exibida inline com legenda. Outro arquivo vira um cartão com ícone, nome, tamanho e os botões Abrir e Mostrar na pasta. |
| Painel Conexões | Nova seção **Anexos desta nota**, com a lista e a contagem. |
| Árvore | Anexos ficam escondidos por padrão. Opção de mostrar em Configurações → Editor ("Anexos", hoje "em breve"). |
| Configurações → Editor | Pasta padrão dos anexos: "ao lado da nota" (padrão) ou "pasta única da biblioteca". |

### Onde fica no disco

- **Padrão:** `<Estante>/anexos/<arquivo>`, ao lado das notas da estante. Exemplo: `Estudos/anexos/grafico.png`.
- O link na nota é relativo e no formato do Obsidian (`![[anexos/grafico.png]]`). Assim continua portátil e o importador do Obsidian não precisa converter nada.
- **Alternativa,** escolhida em Configurações: `Anexos/` na raiz da biblioteca.
- **Nome em conflito:** `grafico (2).png`. Nunca sobrescreve.
- **Limite sugerido:** 50 MB por arquivo, com aviso amigável.
- O engine já classifica qualquer arquivo não `.md`/`.canvas` como `attachment` (`engine/library.ts`). O que falta é **criar, listar e apagar**.

### APIs

| Tipo | Nome | Entrada → saída |
|---|---|---|
| tool | `attachment.add` | `{ notePath, sourcePath? , bytesBase64?, fileName }` → `{ path, link, size, mime }`. Copia (não move) e devolve o `link` pronto para inserir. |
| tool | `attachment.list` | `{ notePath }` → `[{ path, size, mime, usedBy: [notePath] }]` |
| tool | `attachment.remove` | `{ path }` → `{ removed, brokenLinks: [notePath] }`. O front confirma antes. |
| tool | `attachment.rename` | `{ path, name }` → `{ path, updatedNotes }`. Reescreve os links, como `note.rename` já faz. |
| IPC | `sophy:choose-files` | **Já existe.** Basta devolver os caminhos absolutos para o `attachment.add`. |
| IPC | `sophy:attachment-open` | `(path)` → `shell.openPath` |
| IPC | `sophy:attachment-reveal` | `(path)` → `shell.showItemInFolder`. Pode reaproveitar `library-reveal` com caminho. |
| protocolo | `sophy-file://` | Servir imagens da biblioteca para o `<img>` do editor sem liberar `file://` geral. Só leitura e só dentro da raiz. |

---

## 2. Exportar como PDF e como Markdown (por nota, no menu •••)

**Já existe:** `sophy:export-pdf (html)`. Ele recebe HTML claro, faz `printToPDF`, abre o diálogo de salvar e devolve o caminho. Também existe a exportação de site e PDF da biblioteca, em Configurações → Bibliotecas → Exportar.

**O que falta para o ••• da nota:**

| Tipo | Nome | Entrada → saída |
|---|---|---|
| tool | `note.export.html` | `{ path, theme: 'light' }` → `{ html, title }`. Renderização oficial da nota, com wikilinks resolvidos e embeds e anexos inline. Evita o front montar HTML por conta própria. |
| IPC | `sophy:export-pdf` | Já existe. Proposta: aceitar `{ html, suggestedName }`, para o diálogo vir com o título da nota em vez de `nota.pdf`. |
| tool | `note.export.markdown` | `{ path, mode: 'portable' \| 'raw' }` → `{ markdown, attachments: [path] }`. No modo `portable`, os `[[wikilinks]]` viram `[texto](caminho.md)` e as imagens viram caminhos relativos. |
| IPC | `sophy:save-file` | `{ suggestedName, content, filters, attachments? }` → `path \| null`. Diálogo de salvar. Com anexos, grava uma pasta `<nome>/` com `nota.md` e `anexos/`. |

**Front, quando o back existir:** os itens do ••• saem de `disabled`. O fluxo mostra um toast "Exportando…" com `carregando` animado e termina num toast "PDF salvo" com a ação **Mostrar na pasta**.

---

## 3. Troca de biblioteca

**Hoje:** o seletor da lateral já lista as recentes e chama `sophy:switch-library`. Em Configurações → Bibliotecas, a lista aparece com a atual marcada, e "Abrir" está "em breve", porque a troca ainda precisa das garantias abaixo.

**O que falta:**

- **Troca segura.** Antes de trocar, o main pede `flush` ao renderer (`sophy:flush-request`, que já existe) e só troca com `flushed(true)`. Sem isso, perde a edição em andamento.
- **Evento de volta.** `sophy:library-changed` → `{ root, name, libraries }`. Serve para o front repintar tudo sem reload, e para outra janela ou o MCP avisarem.
- **Metadados da lista.** `sophy:library-list` deveria devolver `[{ root, name, lastOpenedAt, notes, exists }]`. Com isso a lista mostra a contagem e marca "pasta não encontrada" quando sumiu.
- **Nome amigável.** `sophy:library-rename (root, name)`. Grava em `.sophy/library.json` e não muda a pasta.
- **Abrir em nova janela (opcional).** `sophy:library-open-window (root)`.

---

## 4. Harness da Sofi

**Hoje:** `sophy:agent-ask (message)` → `{ text }`, numa ida e volta só. A confirmação vem por `dialog.showMessageBox` nativo, e o status é só `{ saved }`.

**O que o front precisa para uma Sofi visível e confiável:**

| Tipo | Nome | Para quê |
|---|---|---|
| IPC | `sophy:agent-status` | Ampliar para `{ saved, provider, model, ready, lastError }`. Alimenta o cabeçalho de Configurações → Sofi e IA, que hoje diz só "tem chave" ou "ainda não tem". |
| IPC | `sophy:agent-start (message, { notePath?, selection? })` | Devolve `{ turnId }`. Inicia o turno sem bloquear. |
| evento | `sophy:agent-event` | `{ turnId, kind: 'thinking' \| 'tool' \| 'text' \| 'confirm' \| 'done' \| 'error', payload }`. Com isso o front mostra o passo a passo ("Lendo Estudos/Leitura.md…"), o mascote pensando e o ícone `agente-trabalhando` na barra. |
| IPC | `sophy:agent-confirm (turnId, requestId, accepted)` | Substitui o `showMessageBox` nativo por um diálogo do próprio Sophy, com diff do que vai mudar. |
| IPC | `sophy:agent-cancel (turnId)` | Botão **Parar** visível (ícone `parar` já existe). |
| IPC | `sophy:agent-config ({ provider, model, permissions })` | Itens "em breve" de Configurações: Provedor e modelo, Permissões. As permissões propostas são ler, criar, editar e apagar, cada uma liga/desliga. |
| tool | `history.restore (pointId)` | Já existe a gravação de pontos. Precisa do "Desfazer o que a Sofi fez", que o toast oferece com o ícone `desfazer`. |

---

## 5. MCP

**Hoje:** o servidor MCP roda por CLI (`engine/mcp.ts`, `src/mcp.js`) para clientes externos usarem a biblioteca. Não há interface nem a Sofi como cliente de MCPs externos.

**Proposta de interface:** Configurações → Sofi e IA → "Ferramentas externas (MCP)", hoje "em breve".

- **Seção A, "Usar o Sophy em outros apps":** mostra o comando ou o JSON de configuração para colar no cliente, com botão Copiar e um indicador "conectado agora" quando houver sessão ativa.
- **Seção B, "Conectar a Sofi a outros serviços":** lista de servidores, cada um com nome, estado e ferramentas expostas, mais os botões Adicionar e Remover.

| Tipo | Nome | Entrada → saída |
|---|---|---|
| IPC | `sophy:mcp-server-info` | `{ command, args, configJson, running, clients: [{ name, since }] }` |
| IPC | `sophy:mcp-servers` | `[{ id, name, transport: 'stdio' \| 'http', status, tools: [name] }]` |
| IPC | `sophy:mcp-add ({ name, command \| url, env? })` | `{ id }`. Segredos vão para o `safeStorage`, nunca para a biblioteca. |
| IPC | `sophy:mcp-remove (id)` / `sophy:mcp-toggle (id, enabled)` | — |
| evento | `sophy:mcp-event` | `{ id, status, error? }` para o estado em tempo real |

---

## Pendência de higiene no back (fora do meu escopo)

- `engine/links.ts` ainda tem blocos `// #region agent log` que fazem `fetch('http://127.0.0.1:7516/ingest/…')`, nas linhas ~246 e ~278. No front eu removi os quatro equivalentes de `src/ui/app.js`, que geravam `ERR_CONNECTION_REFUSED` no console e derrubavam o e2e "editor visual o tempo todo". Vale tirar do engine também.
