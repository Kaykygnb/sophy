# Motor do Sophy

O motor fica em `engine/` e não usa Electron nem DOM. A janela em `src/` chama o mesmo registro de tools. O desenho dela está em `docs/interface.md`.

## Nomes

| Código, tools, CLI e MCP | Texto na interface |
| ------------------------ | ------------------ |
| `library`                | Biblioteca         |
| `workspace`              | Estante            |

`library` é a pasta que a pessoa abre. `workspace` é cada subpasta visível de primeiro nível dessa pasta. Não existe cadastro: a pasta é a lista, como no Obsidian. Arquivos `.md` na raiz da biblioteca pertencem à biblioteca e têm `workspace: null`.

## Formato no disco

Igual ao Obsidian, há três papéis e nenhum formato proprietário de nota:

| Arquivo                        | Papel                                                                                                                      |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `*.md`                         | Nota. Markdown comum com frontmatter YAML. É o único formato de nota.                                                      |
| `*.canvas`                     | Canvas. JSON Canvas, o mesmo arquivo que o Obsidian abre: nós `text`, `file`, `link` e `group`, arestas com lados e cores. |
| qualquer outro arquivo visível | Anexo. Bytes no disco, sem envelope. A tool `file.list` devolve o caminho e o tamanho.                                     |

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
- Consultas salvas sobre a mesma listagem de notas.

`entry.move` reescreve os wikilinks que apontavam para o arquivo movido, inclusive os que estão no texto de um cartão de canvas. O nó `file` que apontava para a nota também muda de caminho. Alias e âncora permanecem. Um `[[` incompleto não é um link e não é escapado. O canvas entra no grafo e nos backlinks quando cita uma nota.

## Operações

O registro em `engine/tools.ts` é a borda que CLI, MCP, UI e o agente vão usar. A entrada é validada com Zod.

| Tool                 | Função                                                       |
| -------------------- | ------------------------------------------------------------ |
| `library.open`       | Abre a pasta e devolve a raiz e as estantes                  |
| `workspace.list`     | Lista as estantes                                            |
| `workspace.create`   | Cria uma subpasta de primeiro nível                          |
| `directory.create`   | Cria uma pasta, inclusive dentro de uma estante              |
| `note.list`          | Lista só arquivos `.md`, com filtro opcional por estante     |
| `file.list`          | Lista `.canvas` e anexos, sem ler o conteúdo                 |
| `canvas.read`        | Lê o JSON Canvas e a revisão                                 |
| `canvas.create`      | Cria um `.canvas` sem sobrescrever                           |
| `canvas.update`      | Grava o JSON se a revisão ainda confere                      |
| `canvas.node.put`    | Cria ou substitui um nó                                      |
| `canvas.node.remove` | Remove um nó e as arestas ligadas                            |
| `canvas.edge.put`    | Cria ou substitui uma aresta                                 |
| `canvas.edge.remove` | Remove uma aresta                                            |
| `note.read`          | Lê corpo, frontmatter e revisão                              |
| `note.create`        | Cria `.md` sem sobrescrever                                  |
| `note.write`         | Grava o corpo se a revisão SHA-256 ainda confere             |
| `entry.move`         | Move ou renomeia e reescreve os wikilinks afetados           |
| `entry.trash`        | Move para a lixeira do sistema                               |
| `links.outgoing`     | Wikilinks da nota, com status resolvido, ambíguo ou quebrado |
| `links.backlinks`    | Notas que apontam para um caminho                            |
| `links.broken`       | Links quebrados ou ambíguos                                  |
| `search.query`       | Busca em título, texto limpo, tags e frontmatter             |
| `graph.query`        | Nós e arestas, com filtro de estante e tag                   |
| `history.list`       | Ações ainda desfazíveis                                      |
| `history.undo`       | Desfaz a última ação, se os arquivos não mudaram depois      |
| `library.watch`      | Watcher opcional para mudanças externas em `.md`             |

Um wikilink é `[[Nota]]`, `[[Estante/Nota]]`, `[[Nota|texto]]`, `[[Nota#Cabeçalho]]`, `[[Nota#^id]]` ou o embed `![[...]]`. O nome simples resolve se houver um único arquivo com esse nome, ou se houver um na mesma pasta da nota de origem. Vários homônimos, sem caminho, ficam ambíguos. Caminho com barra escolhe o arquivo. Âncora que não existe na nota de destino deixa o link quebrado. Código cercado, código inline e frontmatter não entram no índice.

A busca compara o texto limpo: o rótulo do wikilink no lugar de `[[ ]]`, sem cercas de título. Cada acerto volta em segmentos `{ text, match }`. O grafo devolve nós e arestas para a interface desenhar; não há figura nesta etapa.

Toda tool que altera arquivo pede `origin`: `ui`, `cli`, `mcp` ou `agent` (Agente na interface). O histórico fica em `.sophy/history.json`, pasta oculta, e não é nota. `history.undo` desfaz a última ação se o disco ainda está como ela deixou. Desfazer remove essa ação da lista.

`note.write` sem `frontmatter` preserva o bloco YAML original. `null` ou `{}` remove o bloco. A revisão é o SHA-256 do arquivo inteiro. Se o arquivo mudou desde a leitura, a escrita devolve `conflict: true` e não altera o disco.

A gravação usa arquivo temporário, `fsync` e `rename`. O caminho relativo não pode sair da biblioteca (`..`, absoluto, barra invertida, nome oculto). Nota acima de 8 MB é recusada. A árvore para em 20 mil itens ou 40 níveis.

A lixeira segue o layout do Freedesktop (`files/` e `info/`). Se o movimento falha, o original fica onde está. Não há exclusão permanente.

Ao abrir a biblioteca, o motor recusa a própria home, um ancestral da home e diretórios protegidos (`.ssh`, `.config`, `.local`, `.gnupg`, `.codex`). A pasta de trabalho pode ficar dentro da biblioteca, que é o uso normal da CLI. A pasta da biblioteca não precisa estar dentro da home: o chamador entrega o caminho. Isso permite testes em diretório temporário e uma pasta escolhida fora do perfil.

## CLI

O comando `sophy` fica em `engine/bin/sophy`. Ele roda o TypeScript com Node 22 e `--experimental-strip-types`, sem compilação. Não há lógica própria de nota: a CLI só interpreta argumentos, chama `callTool` e formata a saída. Toda alteração passa `origin: "cli"`, mesmo que o JSON de entrada diga outra origem.

```bash
sophy init ~/Notas
sophy estantes
sophy nova Estudos/Ideia --texto "Um [[ começo"
sophy ler Estudos/Ideia
sophy buscar gato
sophy links Estudos/Ideia
sophy backlinks Estudos/Ideia
sophy mover Estudos/Ideia.md Livro/Ideia.md
sophy lixeira Livro/Ideia.md
sophy grafo --json
sophy historico
sophy desfazer
sophy tools
sophy help note.read
sophy note.list --json
```

A biblioteca é `--biblioteca <caminho>`, ou a variável `SOPHY_LIBRARY`, ou a primeira pasta acima do diretório atual que contém `.sophy`. `sophy init` cria essa pasta oculta. Sem extensão, `nova`, `ler`, `links` e `backlinks` acrescentam `.md`. `--texto -` lê o corpo da entrada padrão.

A saída humana é o padrão. `--json` sozinho imprime o resultado para máquina. `--json '{...}'` envia o objeto da tool e também imprime JSON. Código 0 é sucesso, 1 é erro de uso, 2 é erro do motor (conflito de revisão ou link ambíguo).

## MCP

`sophy mcp` sobe um servidor stdio com o SDK `@modelcontextprotocol/sdk`. As tools são as do registro: o schema anunciado sai do Zod, sem uma segunda implementação. O servidor usa a mesma descoberta de biblioteca da CLI (`--biblioteca`, `SOPHY_LIBRARY` ou a pasta `.sophy` acima). `libraryPath` e `path` de `library.open` enviados pelo cliente são ignorados, para o processo não ser apontado a outra pasta. Toda mutação grava `origin: "mcp"`, mesmo que o input peça outra origem.

Conflito de revisão, link ambíguo e caminho proibido voltam como resultado de erro do MCP, com a mensagem em texto. Não há tool de chave de API nem de configuração sensível.

Notas são resources `sophy://nota/<caminho>`, por exemplo `sophy://nota/Estudos/Nota.md`.

`ui.openNote`, `ui.openCanvas`, `ui.showGraph` e `ui.setTheme` estão no registro. Elas publicam num canal em processo (`subscribeUi`). A janela do Electron assina esse canal. Se o `sophy mcp` for outro processo, ele entrega o pedido numa pasta temporária que a janela lê, desde que ela esteja aberta. Sem a janela, a resposta continua `A interface não está aberta.`

Exemplo para Claude Desktop ou Cursor:

```json
{
  "mcpServers": {
    "sophy": {
      "command": "node",
      "args": [
        "--experimental-strip-types",
        "/caminho/absoluto/do/sophy/engine/cli.ts",
        "mcp",
        "--biblioteca",
        "/caminho/da/biblioteca"
      ]
    }
  }
}
```

O bin `sophy mcp --biblioteca /caminho/da/biblioteca` é equivalente.

## Testes

Na raiz do repositório, com Node 22:

```bash
npm run test:engine
```

O comando é `node --experimental-strip-types --test engine/*.test.ts`. Não há passo de compilação. `npm test` cobre o app anterior e a camada da interface que não precisa de janela (`tests/ui-*.test.js`), e esse script também usa `--experimental-strip-types` para falar com o motor. O smoke do Electron é `npm run test:e2e`.

A janela está descrita em `docs/interface.md`.
