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

## 1. Anexos (contrato fechado com Fernando e Kayky)

### Onde fica no disco

- **Pasta única `Anexos/` na raiz da biblioteca.** Exemplo: `Anexos/grafico.png`. Não existe pasta por estante.
- **Nome repetido** ganha o sufixo ` (2)`, depois ` (3)` e assim por diante. Exemplo: `grafico (2).png`. Nunca sobrescreve.
- O link na nota é no formato do Obsidian (`![[Anexos/grafico.png]]`), para continuar portátil.

### Onde fica na interface (para ver, sem decorar atalho)

| Lugar | O que aparece |
|---|---|
| Editor | Arrastar arquivo para a nota mostra a faixa "Solte para anexar". Colar imagem (Ctrl+V) também anexa. Os dois usam `attachment.import`. |
| Editor, botão visível | Item **Anexo** no menu `+` da margem e no `/`, com o ícone `anexo` do sprite. |
| Bloco renderizado | Imagem inline, lida por `attachment.read`. Outro arquivo vira um cartão com ícone, nome, tamanho e os botões Abrir e Mostrar na pasta. |
| Painel Conexões | Seção **Anexos desta nota**: `attachment.list` filtrado pelos que têm a nota em `referencedBy`. |
| Configurações → Bibliotecas | "Anexos" com a contagem e o filtro **Órfãos** (`orphan: true`). Hoje está "em breve". |
| Árvore | `Anexos/` aparece como pasta da raiz, com o ícone de anexo. |

### APIs

| Tipo | Nome | Estado | Entrada → saída |
|---|---|---|---|
| tool | `attachment.import` | **já existe** | Copia o arquivo para `Anexos/`, aplicando o sufixo ` (2)` em nome repetido. |
| tool | `attachment.read` | **já existe** | Lê o anexo para exibir no editor. |
| tool | `attachment.list` | contrato | `{ path? }` → `[{ path, name, size, kind, referencedBy: [notePath], orphan }]`. Sem `path`, lista todos. |
| IPC | `sophy:open-attachment (path)` | contrato | `resolveInside` (só dentro da biblioteca) e depois `shell.openPath`. Para executáveis, usa `shell.showItemInFolder` em vez de abrir. |
| IPC | `sophy:choose-files` | já existe | Seletor de arquivos que alimenta o `attachment.import`. |

---

## 2. Exportar como PDF e como Markdown (por nota, no menu •••)

**Contrato:** `exportNote({ path, format: 'pdf' | 'md' })`. O main abre `showSaveDialog` com o título da nota como nome sugerido e devolve o caminho salvo, ou `null` se cancelado.

- **`pdf`:** sempre em papel claro, reaproveitando o `printToPDF` do `sophy:export-pdf` atual.
- **`md`:** o frontmatter exportado sai **sem a linha `id:`** (decisão do Kayky). As outras propriedades ficam.

**Front, quando o back existir:** os dois itens do ••• (hoje desabilitados, com "em breve") chamam `exportNote`. O fluxo mostra um toast "Exportando…" com o ícone `carregando` e termina com "PDF salvo" ou "Markdown salvo", com a ação **Mostrar na pasta**.

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

**Hoje:** `sophy:agent-ask (message)` → `{ text }`, numa ida e volta só. A confirmação vem por `dialog.showMessageBox` nativo.

**Contrato:**

| Tipo | Nome | Para quê |
|---|---|---|
| evento | `sophy:agent-progress` | `{ phase: 'thinking' \| 'tool' \| 'confirm' \| 'done' \| 'error', label?, … }`. Na fase `tool`, `label` traz um texto legível, por exemplo "Lendo Estudos/Leitura.md". O front mostra o passo a passo, o mascote no humor certo e o ícone `agente-trabalhando` na barra. |
| evento | `sophy:agent-confirm` | Pedido de confirmação antes de uma escrita. O front abre um diálogo próprio, com o que vai mudar, no lugar do `showMessageBox`. |
| preload | `agentConfirmReply (requestId, accepted)` | Resposta do diálogo de confirmação. |
| preload | `agentCancel ()` | Botão **Parar** visível (ícone `parar`). |
| tool | `agent.undo { versionId }` | "Desfazer o que a Sofi fez": volta ao ponto gravado antes da ação. O front oferece isso no toast de "done", com o ícone `desfazer`. |
| IPC | `sophy:agent-status` | Hoje devolve `{ saved }`. Pode crescer depois para provedor e modelo (em Configurações estão "em breve"). |

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
