# Sophy

Electron com bibliotecas e estantes locais.

## Identidade visual revisada

O aplicativo usa a direção visual consolidada do projeto no FigCraft: azul `#4B6284`, texto `#344463`, superfícies neutras e componentes com espaçamento regular. `src/design-system.css` compartilha cores, fontes e temas entre a janela principal e o editor isolado; `src/visual.css` e `src/editor/visual.css` aplicam os layouts. O azul anterior é migrado para o novo padrão; outras cores escolhidas nas Configurações são mantidas. O texto dos botões se adapta ao contraste da cor escolhida.

A área de escrita tem uma única barra superior, navegação compacta por padrão, painel de arquivos redimensionável e biblioteca fixa no rodapé. O menu **Conforto de leitura** ajusta tamanho do texto, largura e entrelinha sem alterar o Markdown. **Ctrl+Shift+Enter** entra no modo de foco; **Esc** sai dele. As notas abertas mantêm a sessão do editor ao alternar abas, incluindo posição, cursor e histórico de desfazer. O canvas também conserva seu enquadramento e registra mudanças antes de trocar de nota.

A fonte Inter é distribuída localmente em `src/fonts/`, com licença OFL incluída, e funciona sem internet. Os estilos históricos permanecem em camadas de menor prioridade para que os estilos atuais controlem cores e medidas de forma previsível. `tests/e2e/writing-polish.spec.js` verifica texto longo, foco, leitura em janelas de 640 a 1440 pixels, retomada do cursor, desfazer entre abas e salvamento real.

A primeira abertura apresenta as ações de criar e abrir uma biblioteca; bibliotecas e estantes exibem somente os dados locais cadastrados. O grafo oferece busca, nomes, filtro de notas isoladas, zoom e abertura por teclado, com estados de carregamento, vazio e falha recuperável. Os atalhos Ctrl+K, Ctrl+P e Ctrl+Shift+F abrem a busca.

Os arquivos de revisão do FigCraft e suas imagens em `assets/` são referências de desenvolvimento e ficam fora do instalador. Execute `npm run test:e2e` para conferir os fluxos revisados, os temas e o salvamento em dados temporários.

## Executar

- `npm install`
- `npm start`
- `npm run dev`: abrir com DevTools.
- `npm run check`: verificar sintaxe.
- `npm test`: testes de persistência, caminhos e operações de pasta em diretórios temporários.
- `npm run dist:win`: gerar instalador Windows (NSIS) em `release/`.
- `npm run pack`: empacotar sem instalador (pasta em `release/`).

## Conceito

Uma **biblioteca** (mundo no disco) é a pasta raiz do projeto carregado. Cada **estante** (área de trabalho) é uma subpasta direta dessa raiz, criada ou cadastrada explicitamente pelo Sophy. Subpastas adicionadas pelo gerenciador de arquivos não viram estantes automaticamente.

```
Meu mundo/
├── .notas1/world.json
├── Estudos/
└── Livro/
```

Na primeira abertura, criar um mundo pede nome e pasta pai. Carregar mundo escolhe uma pasta raiz; se ela ainda não tiver metadados, uma confirmação nativa permite inicializá-la sem importar suas subpastas. A navegação oferece Trocar mundo e os mundos conhecidos. O último mundo é reaberto no dashboard; nenhuma área é aberta automaticamente.

Criar área pede apenas o nome e cria uma subpasta no mundo atual. Cadastrar subpasta aceita somente subpastas diretas dentro desse mundo, com confirmação. Renomear altera somente o apelido. Excluir exige digitar o nome e confirmar o caminho em diálogo nativo; apaga permanentemente só a subpasta registrada e seu conteúdo. Uma área indisponível pode ser localizada dentro do mundo ou removida apenas do cadastro.

Abrir uma área mostra seu gerenciador de arquivos e o editor visual de notas Markdown. As Configurações controlam o tema global e a cor de destaque. Nenhuma conta é exigida.

## Persistência e portabilidade

- O mundo tem um ID e guarda seu cadastro em `.notas1/world.json` (versão 2).
- Áreas têm ID estável, apelido, datas e nome de subpasta relativo à raiz. Não são guardados caminhos absolutos no manifesto.
- Fora do mundo, `app.getPath('userData')/worlds.json` guarda apenas referências aos mundos conhecidos e o último carregado.
- Se mover o mundo, use Carregar mundo para localizar a nova raiz. IDs e áreas são preservados. Cópias simultâneas com o mesmo ID são bloqueadas enquanto a pasta original estiver disponível.
- O antigo `workspaces.json` da implementação anterior é preservado e não é importado automaticamente. Nenhuma pasta antiga é movida ou excluída.

## Proteções

Raiz e `.notas1` nunca podem ser áreas. Links simbólicos, subpastas ocultas, áreas sobrepostas, pastas críticas e diretórios fora da raiz são rejeitados. Antes de excluir, caminho e identidade física são revalidados após a confirmação. A exclusão não segue links simbólicos internos. A identidade da raiz é monitorada durante a sessão; ao carregar um mundo movido, as identidades físicas são reconstruídas a partir dos caminhos relativos.

Cadastros são gravados por arquivo temporário e substituição atômica. Um cadastro inválido é preservado. Só uma instância do aplicativo pode gerenciar os arquivos por vez.

## Arquitetura

- `src/main.js`: janela, IPC validado e diálogos nativos.
- `src/worlds.js`: mundos conhecidos, raiz ativa e portabilidade.
- `src/workspaces.js`: áreas, validação e operações locais.
- `src/preload.js`: métodos específicos via contextBridge.
- `src/renderer.js`, `src/index.html`, `src/styles.css`: interface sem Node.js.
- `src/workspace-core.js`: núcleo local compartilhado entre o app e integrações sem interface.
- `engine/cli.ts`: servidor MCP local por stdio, preso a uma biblioteca (`npm run mcp -- --biblioteca <pasta>`).

Sandbox e contextIsolation permanecem habilitados. Operações IPC são serializadas.

## Arquivos e editor Markdown

A área aberta tem uma árvore de arquivos com busca por nome, pastas recolhíveis, menu de contexto, renomear (também F2), mover por diálogo ou arraste, e exclusão pela lixeira do sistema. A raiz da área e os arquivos internos ocultos não podem ser gerenciados por esses comandos. As pastas existentes são lidas do disco; arquivos do gerenciador não ficam em banco de dados.

Notas são arquivos `.md` UTF-8 reais; a extensão fica oculta nos campos de criação e renomeação. Abrem em abas, com o motor visual Bloco (o editor inspirado no Notion do projeto anterior), seus blocos, atalhos, formatação, tabelas, capa, ícone, comentários e propriedades. A revisão ortográfica nativa sublinha palavras suspeitas, oferece sugestões no menu de contexto e permite adicionar palavras ao dicionário; Português (Brasil) é selecionado por padrão e outros idiomas podem ser ativados em Configurações. Ela não altera o texto automaticamente, e os blocos de código ficam fora da revisão. O título visual é o nome do arquivo; use Renomear para alterá-lo. O conteúdo Markdown mantém seus próprios títulos.

- Salvamento automático após 650 ms sem digitação e Ctrl+S.
- “Ver Markdown” permite editar o arquivo original, incluindo seu frontmatter.
- Ícones, comentários, propriedades e apresentação são guardados em frontmatter `notas1_editor`, em JSON válido como valor YAML. Os campos de frontmatter já existentes são preservados.
- O corpo continua Markdown legível. Uma assinatura do corpo impede reaplicar apresentação antiga após alterações externas. Hierarquias de blocos que Markdown não representa têm sua estrutura guardada adicionalmente no frontmatter e somente restaurada se o corpo não mudou.
- Imagens, PDFs e outros arquivos entram pela ação “Anexo” e são copiados para `Anexos/` dentro da área. Se uma nota estiver aberta, a importação também insere o link no cursor. Imagens são incorporadas com `![[Anexos/foto.png]]`; outros anexos usam `[[Anexos/arquivo.pdf]]` e abrem na prévia local, com opção de abrir no aplicativo do sistema. Arraste anexos somente dentro de `Anexos/`; a pasta é reservada e não pode ser renomeada ou excluída pelo gerenciador.
- HTML arbitrário não suportado pelo motor permanece como Markdown bruto, sem ser descartado.
- Mudanças externas são verificadas periodicamente, em intervalos de aproximadamente 3 segundos; o sistema pode reduzir a frequência em segundo plano. Sem edição local, a nota é recarregada. Com edição local, o arquivo não é sobrescrito: o usuário escolhe a versão do disco ou salva sua versão como cópia.
- PNG, JPG, GIF e WebP têm prévia na área. Outros anexos abrem no aplicativo padrão após confirmação; tipos executáveis e conteúdo ativo são apenas revelados no gerenciador do sistema.
- Fechar aba, voltar ao dashboard e trocar de seção aguardam o salvamento. A janela avisa antes de sair com alterações não salvas.

Limites iniciais: notas até 8 MB, prévias de imagens até 20 MB, árvore até 20 mil itens e 40 níveis. Links simbólicos não são seguidos. “Lixeira” nunca recorre à exclusão permanente se o sistema falhar.

`npm run test:e2e` executa testes reais no Electron com dados temporários isolados, sem usar os mundos do usuário. Os testes cobrem edição no motor, persistência no disco, abas, criação, movimentação, mudanças externas, conflitos e propriedades. `src/editor/` contém o motor portado e a licença do Marked usado para interpretar Markdown.

## MCP local

O servidor MCP da engine usa transporte stdio e a biblioteca indicada. Execute `npm run mcp -- --biblioteca /caminho/da/biblioteca`, ou configure o cliente para iniciar `node --experimental-strip-types` com `engine/cli.ts` e os argumentos `mcp --biblioteca`. O protocolo usa stdin/stdout; mensagens de diagnóstico vão para stderr.

As tools da engine listam, leem, buscam, criam e editam notas, canvas, tarefas e links. Escritas exigem a revisão obtida na leitura. O servidor não apaga de forma permanente: a lixeira é a do sistema quando a janela está aberta, e uma cópia para a lixeira local quando o arquivo está em outro disco.

## Links internos

Use `[[Nome da nota]]`, `[[Pasta/Nota]]`, `[[Nota|apelido]]`, `[[Nota#Título]]` ou `[[Nota#^identificador]]`. Links para a própria nota podem usar `[[#Título]]`. Identificadores de bloco são marcadores `^identificador` no final do texto do bloco. Links Markdown como `[texto](Pasta/Nota.md#Título)` também navegam internamente. Imagens em `Anexos/` podem ser incorporadas com `![[Anexos/foto.png]]`; imagens, PDFs e outros arquivos podem ser vinculados por caminho, como `[[Anexos/guia.pdf]]`.

Ao digitar `[[`, o motor sugere notas e anexos existentes; `![[` sugere imagens para incorporar e `#` depois do destino sugere títulos. Setas navegam, Enter/Tab selecionam e Escape fecha. Um link inexistente para nota pede confirmação para criar o arquivo `.md` e as subpastas necessárias. Links são abertos na área. Em “Ver Markdown”, posicione o cursor no link e use Ctrl+Enter.

O painel “Referências a esta nota” lista as notas que apontam para a atual, com contagem de referências. O índice ignora frontmatter, trechos de código, links escapados e embeds. No primeiro passo, limita-se a 3 mil notas editáveis por área; notas inacessíveis ou grandes geram aviso de índice parcial.

Notas com o mesmo nome priorizam a pasta da nota de origem. Se restar ambiguidade, o aplicativo pede o caminho desejado. As sugestões inserem caminhos explícitos para evitar ambiguidade. Não há navegação entre áreas ou mundos por links locais.

Renomear ou mover pelo aplicativo atualiza links resolvidos nas notas da área, preservando aliases e âncoras. Todas as abas são salvas antes da operação. Atualizações usam revisão do conteúdo: se uma nota mudar externamente durante a operação, ela é preservada e o aplicativo avisa quais referências não puderam ser atualizadas. Renomear externamente não dispara essa reescrita.

### Seções, comando de link e prévia

No motor atual, seções elegíveis são blocos Título 1, Título 2 e Título 3, incluindo os títulos alternantes. Em Markdown: `#`, `##` e `###`. Parágrafos comuns não são seções; podem receber um identificador `^nome` para links de bloco.

Digite `/link` (ou procure “Link para nota” no menu `/`) para abrir o mesmo seletor usado por `[[`, no ponto do cursor.

Segure Ctrl com o ponteiro sobre um link interno para espiar uma prévia somente leitura; no macOS, Cmd também funciona. É possível pressionar o modificador antes ou depois de posicionar o mouse. Soltar o modificador ou pressionar Escape fecha a prévia. O painel tem rolagem e um botão para abrir a nota. Notas inexistentes não são criadas ao passar o mouse: a ação de abrir continua exigindo confirmação. A prévia utiliza a versão local da aba quando houver alterações ainda não salvas.

## Paleta, busca e produtividade

- `Ctrl+K`: paleta de comandos (bibliotecas, estantes, backup, diário, inbox, mapa).
- `Ctrl+P`: ir para nota na estante aberta.
- `Ctrl+Shift+F`: busca no conteúdo das notas da estante.
- Nova nota aceita modelos (diário, reunião, projeto, personagem).
- Atalhos rápidos na estante: **Diário**, **Inbox** e **Mapa** de links.
- Em Configurações: backup one-click da biblioteca atual (cópia completa em pasta escolhida).
- Conflitos externos oferecem usar o disco, manter a versão local ou salvar cópia.

## Canvas (quadro infinito)

Arquivos `.canvas` na estante abrem um quadro infinito no estilo Obsidian:

- Cartões de **texto**, **nota** (`.md` da estante) e **grupo**
- Conexões arrastando as portas laterais dos cartões
- Pan (arrastar fundo / Espaço), zoom (scroll), redimensionar, cores e enquadramento
- Autosave no JSON do arquivo; criação pelo botão **＋ Canvas**

## Identidade e acabamento

O aplicativo se chama **Sophy**, com ícone próprio, conjunto de ícones SVG compartilhado e estilos organizados por tela. O nome de exibição e o pacote foram atualizados; o perfil existente continua em `app.getPath('appData')/notas1`, preservando bibliotecas e preferências do protótipo anterior. Os manifestos `.notas1` e a chave `notas1_editor` nos arquivos Markdown continuam compatíveis.

- O cabeçalho mantém apenas a navegação de mundos, o contexto atual, o tema global e as Configurações.
- O tema claro/escuro e a cor de destaque se aplicam ao dashboard, gerenciador de arquivos e editor.
- A divisória da árvore de arquivos pode ser arrastada ou ajustada com as setas do teclado; Home restaura a largura padrão. A largura se adapta à janela.
- O botão de foco amplia a área de leitura, ocultando os painéis laterais.
- Estados de salvamento, modais, ações de arquivo e painéis de referências usam a mesma linguagem visual.

Para desenvolvimento, `npm run format` organiza os arquivos e `npm run format:check` verifica a formatação. O motor de blocos mantém seus estilos básicos separados da camada de integração visual em `src/editor/sophy.css`. `src/icons.js` centraliza os ícones; `assets/` contém a marca SVG e o ícone nativo PNG.

### Layout de escrita

Ao abrir uma área, o cabeçalho fica compacto para privilegiar a escrita. A árvore mantém busca e criação; as ações de cada arquivo ficam no menu `⋯` (ou no clique direito).

O editor inicia com propriedades, informações e referências recolhidas. O menu “Página” reúne ícone, capa e comentários. Status de salvamento, alternância para Markdown e modo de foco ficam no rodapé, liberando o topo para a nota.
