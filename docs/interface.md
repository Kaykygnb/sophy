# Interface

A janela Electron é uma camada fina sobre o motor. O renderer não lê nem grava arquivo: cada operação passa por IPC e chega em `callTool`, com `origin: "ui"`. A biblioteca aberta é a da sessão. Um `libraryPath` vindo da página é ignorado.

## O que a pessoa vê

O nome da biblioteca, no topo da lateral, abre a lista de recentes. Dali dá para trocar, criar outra pasta, abrir uma pasta existente ou tirar a atual da lista. A cor e o ícone da estante usam `--shelf-1` a `--shelf-8` só como marcador. A estante Entrada não tem cor: o ícone é `caixa-entrada`. Abas na barra de título, painel direito com links de saída e backlinks, barra de status.

O editor mostra a nota, não o Markdown cru. O arquivo continua `.md`, com wikilinks, embeds e tarefas no padrão do Obsidian Tasks (`- [/]`, `📅`, `⏫`). Selecionar texto abre a barra de formatação (negrito, itálico, link, wikilink, título, lista, tarefa, citação e código). O `+` na margem do bloco abre o menu `/`, e a linha vazia diz “Digite / para comandos”. O menu `/` também abre no início da linha ou depois de espaço, inclusive no meio do texto, e pode abrir de novo depois do Esc. `[[` lista notas da biblioteca, com a estante. Ctrl+Shift+P lista os comandos e os atalhos. Salvar manda a revisão SHA-256. Se o arquivo mudou, a janela avisa e não grava por cima.

Ctrl+K busca. O grafo é desenhado na janela a partir de `graph.query`, com cor por estante, filtro de estante e tag, e foco na nota aberta.

Claro e escuro vêm de `src/ui/assets/tokens.css`. “Sistema” segue `prefers-color-scheme`. Com `prefers-reduced-motion` ou a opção da boas-vindas, a Sofi fica no SVG parado. O Lottie só é carregado quando a animação vai tocar.

A primeira abertura tem quatro passos: boas-vindas, pasta da biblioteca, tema, agente. O passo do agente não grava chave. O agente em si é a etapa 7.

O botão Novo, na base da lateral, abre nota, estante ou canvas. Canvas na paleta também cria um quadro vazio na estante selecionada (ou em Entrada). O cartão de nota do quadro mostra a prévia como o editor: checkbox, wikilink e chips de prazo e prioridade. `ui.openCanvas` abre o `.canvas`. O quadro tem pan e zoom, cartões de texto com `[[`, cartão de nota com prévia, cartão de link, grupos, setas com rótulo, seleção, encaixe na grade, arrastar uma nota da árvore, minimapa e desfazer. O arquivo continua JSON Canvas.

## Fora desta etapa

Tarefas e calendário como telas, visões salvas, nota do dia, captura rápida e o agente. Os arquivos continuam Markdown, então essas telas podem entrar depois sem outro formato.

## Ponte com o MCP

A janela chama `subscribeUi`. `ui.openNote`, `ui.openCanvas`, `ui.showGraph` e `ui.setTheme` no mesmo processo chegam nela. Um `sophy mcp` separado deixa o pedido em `sophy-ui-<uid>` no diretório temporário; a janela responde enquanto estiver aberta. Sem janela, a tool responde `A interface não está aberta.`

## Testes

`npm test` inclui a ida e volta do Markdown, a porta IPC e a grade do canvas (`tests/ui-canvas.test.js`). `npm run test:e2e` abre o Electron: boas-vindas, nota, grafo e um canvas.
