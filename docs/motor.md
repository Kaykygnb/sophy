# Motor do Sophy

O motor fica em `engine/` e não usa Electron, DOM nem a interface em `src/`. O app atual continua como está.

## Nomes

| Código, tools, CLI e MCP | Texto na interface |
| ------------------------ | ------------------ |
| `library`                | Biblioteca         |
| `workspace`              | Estante            |

`library` é a pasta que a pessoa abre. `workspace` é cada subpasta visível de primeiro nível dessa pasta. Não existe cadastro: a pasta é a lista, como no Obsidian. Arquivos `.md` na raiz da biblioteca pertencem à biblioteca e têm `workspace: null`.

## Formato no disco

Igual ao Obsidian, há três papéis e nenhum formato proprietário de nota:

| Arquivo                        | Papel                                                                                                                             |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `*.md`                         | Nota. Markdown comum com frontmatter YAML. É o único formato de nota.                                                             |
| `*.canvas`                     | Canvas. JSON Canvas, o mesmo arquivo que o Obsidian abre. Nesta etapa o motor só reconhece a extensão; não lê nem regrava o JSON. |
| qualquer outro arquivo visível | Anexo. Bytes no disco, sem envelope. A tool `file.list` devolve o caminho e o tamanho.                                            |

Uma nota é um arquivo `.md` em UTF-8.

```yaml
---
tags:
  - estudo
---
Texto com [[Estudos/Outra]] e uma tarefa - [ ] em aberto.
```

O frontmatter é YAML comum, o mesmo bloco entre `---` que o Obsidian lê. O corpo é gravado como texto opaco: o motor não escapa `[[`, não reescreve Markdown e não interpreta `- [ ]`.

Não há compatibilidade com a pasta `.notas1`. Abrir uma biblioteca não cria nem exige esse diretório. Se uma nota ainda tiver a chave `notas1_editor` no frontmatter, ela permanece no arquivo quando só o corpo muda. O motor não lê esse campo para decidir nada.

Pastas e arquivos cujo nome começa com `.` ficam fora da listagem. Links simbólicos são recusados e não são seguidos.

## O que o modelo deixa aberto

Nada disto entra nesta etapa. O arquivo continua sendo Markdown e YAML, então dá para acrescentar depois sem trocar o formato:

- Tarefas a partir de `- [ ]` no corpo, com data e prioridade no texto ou no frontmatter.
- Calendário: notas diárias pelo nome do arquivo, datas de tarefas e datas declaradas no YAML.
- Wikilinks dentro de cartões de canvas, contando em backlinks, no grafo e na renomeação. O arquivo já é `.canvas` (JSON Canvas); o caminho da nota continua estável.
- Consultas salvas sobre a mesma listagem de notas.

`entry.move` reescreve os wikilinks que apontavam para o arquivo movido. Alias e âncora permanecem. Um `[[` incompleto não é um link e não é escapado.

## Operações

O registro em `engine/tools.ts` é a borda que CLI, MCP, UI e o agente vão usar. A entrada é validada com Zod.

| Tool               | Função                                                       |
| ------------------ | ------------------------------------------------------------ |
| `library.open`     | Abre a pasta e devolve a raiz e as estantes                  |
| `workspace.list`   | Lista as estantes                                            |
| `workspace.create` | Cria uma subpasta de primeiro nível                          |
| `directory.create` | Cria uma pasta, inclusive dentro de uma estante              |
| `note.list`        | Lista só arquivos `.md`, com filtro opcional por estante     |
| `file.list`        | Lista `.canvas` e anexos, sem ler o conteúdo                 |
| `note.read`        | Lê corpo, frontmatter e revisão                              |
| `note.create`      | Cria `.md` sem sobrescrever                                  |
| `note.write`       | Grava o corpo se a revisão SHA-256 ainda confere             |
| `entry.move`       | Move ou renomeia e reescreve os wikilinks afetados           |
| `entry.trash`      | Move para a lixeira do sistema                               |
| `links.outgoing`   | Wikilinks da nota, com status resolvido, ambíguo ou quebrado |
| `links.backlinks`  | Notas que apontam para um caminho                            |
| `links.broken`     | Links quebrados ou ambíguos                                  |
| `search.query`     | Busca em título, texto limpo, tags e frontmatter             |
| `graph.query`      | Nós e arestas, com filtro de estante e tag                   |
| `history.list`     | Ações ainda desfazíveis                                      |
| `history.undo`     | Desfaz a última ação, se os arquivos não mudaram depois      |
| `library.watch`    | Watcher opcional para mudanças externas em `.md`             |

Um wikilink é `[[Nota]]`, `[[Estante/Nota]]`, `[[Nota|texto]]`, `[[Nota#Cabeçalho]]`, `[[Nota#^id]]` ou o embed `![[...]]`. O nome simples resolve se houver um único arquivo com esse nome, ou se houver um na mesma pasta da nota de origem. Vários homônimos, sem caminho, ficam ambíguos. Caminho com barra escolhe o arquivo. Âncora que não existe na nota de destino deixa o link quebrado. Código cercado, código inline e frontmatter não entram no índice.

A busca compara o texto limpo: o rótulo do wikilink no lugar de `[[ ]]`, sem cercas de título. Cada acerto volta em segmentos `{ text, match }`. O grafo devolve nós e arestas para a interface desenhar; não há figura nesta etapa.

Toda tool que altera arquivo pede `origin`: `ui`, `cli`, `mcp` ou `agent` (Agente na interface). O histórico fica em `.sophy/history.json`, pasta oculta, e não é nota. `history.undo` desfaz a última ação se o disco ainda está como ela deixou. Desfazer remove essa ação da lista.

`note.write` sem `frontmatter` preserva o bloco YAML original. `null` ou `{}` remove o bloco. A revisão é o SHA-256 do arquivo inteiro. Se o arquivo mudou desde a leitura, a escrita devolve `conflict: true` e não altera o disco.

A gravação usa arquivo temporário, `fsync` e `rename`. O caminho relativo não pode sair da biblioteca (`..`, absoluto, barra invertida, nome oculto). Nota acima de 8 MB é recusada. A árvore para em 20 mil itens ou 40 níveis.

A lixeira segue o layout do Freedesktop (`files/` e `info/`). Se o movimento falha, o original fica onde está. Não há exclusão permanente.

Ao abrir a biblioteca, o motor recusa a própria home, um ancestral da home, a pasta do processo e diretórios protegidos (`.ssh`, `.config`, `.local`, `.gnupg`, `.codex`). A pasta da biblioteca não precisa estar dentro da home: o chamador entrega o caminho. Isso permite testes em diretório temporário e uma pasta escolhida fora do perfil.

## Testes

Na raiz do repositório, com Node 22:

```bash
npm run test:engine
```

O comando é `node --experimental-strip-types --test engine/*.test.ts`. Não há passo de compilação. Os testes do app em `tests/` continuam em `npm test` e não carregam o motor.
