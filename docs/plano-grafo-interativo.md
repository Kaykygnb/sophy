# Plano de implementação — grafo interativo

**Escopo:** substituir a visualização atual por um grafo navegável inspirado nas referências fornecidas, integrado à biblioteca e às estantes existentes.

**Estado deste documento:** planejamento baseado no código atual. A implementação ainda não foi alterada.

## 1. O que existe hoje

- `engine/graph.ts` e a tool `graph.query` já entregam notas e wikilinks resolvidos como nós e arestas. A consulta pode filtrar por estante e tag.
- `src/ui/app.js` monta a tela em `paintGraph`, desenha em um único `<canvas>` e calcula as posições na função `layout`.
- A posição inicial é recalculada ao redesenhar. O layout executa 80 iterações com repulsão de todos os pares de nós, custo quadrático, na thread da interface.
- O ponteiro no canvas sempre move a câmera. Não há seleção de nó no arraste; clicar em um nó abre a nota.
- A barra atual tem estante, tag, linha do tempo, legenda e zoom. Não há busca própria no grafo, modo local, painel de forças, minimapa, cartão de prévia nem controles de órfãos.
- As cores das estantes, o foco da nota ativa, o tema e a abertura da nota já têm integração com o restante do Sophy.

## 2. Resultado desejado

Um grafo de tela cheia, legível em tema claro e escuro, cujas notas continuam sendo os arquivos Markdown da biblioteca e cujos links continuam sendo os wikilinks já indexados. A interface deverá oferecer:

1. **Nós arrastáveis:** pressionar uma bolinha e arrastá-la move somente aquela nota. O movimento usa Pointer Events e pointer capture; soltar mantém a posição manual e libera o ponteiro com segurança.
2. **Câmera independente:** arrastar o fundo desloca a câmera. A roda aproxima ou afasta em torno do cursor; botões oferecem zoom, ajuste à rede e retorno ao enquadramento inicial.
3. **Global e local:** global exibe a biblioteca; local parte da nota ativa ou selecionada e permite expandir vizinhos por profundidade. A interface informa qual nota está no centro do modo local.
4. **Busca e filtros combináveis:** buscar pelo título/caminho; filtrar por estante, tag e notas órfãs; mostrar filtros ativos como chips e permitir removê-los individualmente ou limpar todos.
5. **Contexto do nó:** hover ou foco por teclado destaca a vizinhança e as arestas, reduz o contraste do restante e exibe um cartão pequeno com título, estante, contagens de links e data de edição. Abrir o cartão ou ativar o nó abre a nota.
6. **Forças ajustáveis:** painel com distância, repulsão, força das ligações, centralização e atração por estante; ligar/desligar a simulação, restaurar valores padrão e escolher a exibição de órfãos e rótulos.
7. **Orientação no espaço:** minimapa clicável e arrastável, zoom visível, contagem de notas/links, legenda por cor da estante, status do layout e estados de vazio/erro/carregamento.
8. **Movimento controlado:** animação curta ao entrar e após alterar filtros, respeito a `prefers-reduced-motion`, e controles para pausar/retomar a estabilização. Não animar continuamente quando a rede estiver estável.
9. **Persistência útil:** guardar posições movidas manualmente e preferências de câmera/forças por biblioteca, sem escrever nos Markdown, sem alterar wikilinks e sem serializar posições automáticas em massa a cada frame.
10. **Escala progressiva:** nenhuma quantidade fixa de notas será imposta pela interface. Com redes grandes, manter pan, zoom, busca e seleção responsivos usando cálculo de forças fora da thread visual, renderização por nível de detalhe e descarte de desenho fora do viewport. O limite real continuará sendo memória e hardware; a interface deve comunicar redes muito grandes sem travar.

## 3. Organização proposta

### Arquivos novos

- `src/ui/graph-view.js` — controlador da tela: câmera, zoom, hit testing, arraste, seleção, minimapa, hover, controles acessíveis, ciclo de vida e ligação com `app.js`.
- `src/ui/graph-sim.js` — simulação de forças no fio da interface: repulsão Barnes-Hut (quadtree), molas, ímã de estante (grupos que não se cobrem), colisão pelo raio e pelo rótulo e um passo final que garante nós sem sobreposição. O `graph-view.js` monta a cena (Notas, Estantes ou Tags), desenha no canvas e anima a linha do tempo.
- `tests/graph.test.js` — testes unitários das funções puras exportadas pelo módulo de grafo: normalização de dados, vizinhança local, filtros, hit testing, coordenadas de câmera, layout determinístico e cancelamento/limites da simulação.
- `tests/e2e/graph.spec.js` — fluxos reais do grafo em biblioteca temporária, incluindo arrastar nó e fundo, zoom, busca, filtros, abertura de nota e restauração de layout.

### Arquivos existentes a alterar

- `src/index.html` — carregar `graph-view.js` antes de `app.js`; manter dependências sem módulos compatíveis com o padrão de scripts globais já usado.
- `src/ui/app.js` — manter a navegação e os dados da aplicação; substituir a montagem e o desenho atuais por integração com `GraphView`; passar a biblioteca, estantes, nota ativa, consulta `graph.query`, abertura de notas e preferências. Remover o `layout` quadrático e os listeners do grafo que migrarem para o controlador.
- `src/ui/app.css` — compor barra flutuante, palco, painel de forças, cartão do nó, minimapa, legenda, chips de filtro, estados vazios e responsividade. Usar tokens de tema e cores `--shelf-*` existentes.
- `src/main.js` — se a escolha de persistência usar o arquivo de configurações da aplicação, validar e aceitar o novo campo de layout do grafo pela lista de chaves permitidas. Validar formato, tamanho e identidade da biblioteca; nunca aceitar caminho de arquivo vindo do renderer como destino de escrita.
- `src/preload.js` — provavelmente sem mudança: `saveSettings` já expõe a gravação de preferências. Reavaliar só se a validação exigir uma operação específica de leitura/escrita.
- `tests/e2e/ui-smoke.spec.js` ou os testes existentes do fluxo de navegação — ajustar somente se IDs/semântica já cobertos mudarem; manter um teste básico de abrir o grafo.
- `docs/interface.md` e `README.md` — atualizar o comportamento documentado depois que a implementação passar pelos testes.

### Arquivos que devem permanecer como fonte dos dados

- `engine/graph.ts`, `engine/links.ts` e a definição `graph.query` em `engine/tools.ts` continuam sendo a origem dos nós e arestas.
- Não criar um formato alternativo de notas nem duplicar links no frontend.
- Só alterar o motor caso a medição mostre que a consulta ou a busca atual é o gargalo. Se necessário, evoluir a consulta de modo compatível e cobrir essa mudança com testes do motor.

## 4. Modelo e interação

### Coordenadas

- Separar coordenadas do mundo (posições dos nós) de coordenadas da tela (câmera e zoom).
- Guardar posições manuais como posições fixadas (`pinned`) identificadas por `path`, e não pelo índice do array.
- Novos nós recebem uma posição inicial determinística perto de seus vizinhos; posição fixa antiga não muda quando a ordem da consulta mudar.
- Zoom mantém o ponto sob o cursor no mesmo lugar visual. Pan e seleção usam conversões explícitas entre tela e mundo.
- Ao filtrar, não descartar a posição dos nós ocultos. Ao remover uma nota, ignorar sua posição antiga quando ela não existir mais.

### Gestos e teclado

- Nó: `pointerdown` seleciona e inicia arraste; movimento acima do limiar vira drag; `pointerup` finaliza; clique sem movimento abre/seleciona a nota conforme o modo da interface.
- Fundo: arrasta a câmera. Painéis e controles não iniciam pan.
- Roda: zoom ancorado no cursor. Atalhos `+`, `-`, `0` e `/` ficam disponíveis sem capturar teclas enquanto um campo de texto estiver ativo.
- Teclado: nós focáveis com nome acessível; setas navegam pela rede visível; Enter abre; Escape fecha o cartão ou limpa a seleção; botões de zoom e painel têm rótulos acessíveis.
- O canvas expõe uma alternativa navegável/listada para leitores de tela e para quem não usa ponteiro.

### Modos e filtros

- **Global:** todos os nós devolvidos por `graph.query` após filtros.
- **Local:** BFS no grafo a partir de uma nota central, com profundidade selecionável. Deve funcionar também para notas sem vizinhos.
- **Busca:** destaca e centraliza o resultado escolhido, sem alterar o arquivo.
- **Órfãs:** nós com grau zero no conjunto de links visível; deixar claro se o cálculo é global ou após filtros.
- **Linha do tempo:** manter a ideia atual apenas se a interação ficar clara e o controle corresponder às datas reais dos nós. Não deixar o filtro temporal invisível ao usuário.

## 5. Estratégia de desempenho

1. Medir com bibliotecas sintéticas crescentes (por exemplo 100, 1.000, 5.000 e 10.000 notas, com densidade de links variada) antes de fixar metas de interação.
2. Mover cálculo de forças para Worker; interromper e descartar respostas antigas ao trocar filtros ou sair da tela.
3. Usar Barnes–Hut/quadtree ou estratégia equivalente para evitar comparar todos os pares em cada iteração. As arestas continuam proporcionais ao número de links reais.
4. Rodar a simulação em lotes e limitar mensagens de atualização ao renderer; usar `requestAnimationFrame` apenas para pintar o último estado disponível.
5. Não redesenhar durante cada evento de entrada sem coalescência; agrupar movimentos com `requestAnimationFrame`.
6. Aplicar nível de detalhe: reduzir/ocultar rótulos em zoom distante, simplificar as arestas e desenhar rótulos de nós próximos/selecionados; testar limites de densidade.
7. Evitar alocar mapas, gradientes, estilos e textos repetidamente dentro do loop de pintura. Recalcular índices apenas quando dados/filtros mudarem.
8. Minimapa agrega a posição de todos os nós em resolução pequena; cliques reposicionam a câmera e arraste move a janela do viewport.
9. Em aparelhos lentos ou movimento reduzido, oferecer layout estático rápido e botões explícitos para iniciar/estabilizar forças.
10. Registrar e exibir estado: carregando, estabilizando, estável ou pausado. Um limite de tempo para estabilização não remove nós; permite parar o cálculo e continuar navegando.

## 6. Plano de execução

### Etapa A — Base funcional

- Extrair integração do grafo para `graph-view.js` e definir uma API pequena entre UI e módulo.
- Implementar conversão de coordenadas, pan/zoom ancorado, hit testing, arraste individual e seleção/abertura de nota.
- Preservar filtros atuais de estante/tag e cores de estante.
- Migrar os testes mínimos existentes e adicionar unit/e2e para arraste de nó, pan no fundo, zoom e nota clicável.

### Etapa B — Layout estável e escala

- Introduzir Worker e layout aproximado escalável, com cancelamento por geração e fallback seguro.
- Manter nós fixados manualmente enquanto o restante estabiliza; adicionar pausa/retomada e ajuste de forças.
- Implementar renderização em níveis de detalhe, coalescência de desenho, observação do tamanho da janela e minimapa.
- Comparar tempo de abertura, estabilidade e resposta de pan/zoom nos conjuntos sintéticos definidos.

### Etapa C — Recursos da referência

- Adicionar modo local e níveis de profundidade, busca própria, filtros de tag/estante/órfãos, chips removíveis e estados sem resultado.
- Adicionar realce de vizinhos/arestas, cartão de prévia no hover/foco, legenda por estante e contador de nós/links.
- Completar painel de forças e controles visuais de órfãos, rótulos e movimento.

### Etapa D — Persistência e acabamento

- Persistir posições manuais e preferências por biblioteca com debounce e validação; não gravar a cada frame.
- Confirmar que uma biblioteca não herda o layout de outra e que notas renomeadas/removidas não quebram a recuperação.
- Aplicar tema claro/escuro, janelas estreitas, estados de carregamento/erro e `prefers-reduced-motion`.
- Atualizar a documentação de interface e revisar a implantação empacotada do worker no Electron.

## 7. Verificação automatizada planejada

### Unitários (`tests/graph.test.js`)

- Grafo vazio, nota isolada, link unilateral, links recíprocos e caminhos repetidos.
- Modo local para profundidades 1–3 e troca da nota central.
- Filtros combinados, contagem de órfãos e remoção individual de chips.
- Converter tela↔mundo com pan/zoom, incluindo zoom ancorado e limites extremos.
- Hit testing seleciona o nó mais próximo e respeita o raio visual.
- Worker ignora resultado antigo após cancelamento e mantém posições fixas.
- Layout determinístico para mesma entrada/semente; nenhuma coordenada NaN/Infinity para nós coincidentes ou sem arestas.
- Dados de layout inválidos, caminho removido, limite de entrada e migração de versão.

### Electron/Playwright (`tests/e2e/graph.spec.js`)

- Abrir o grafo global e confirmar nós/arestas da biblioteca temporária.
- Arrastar um nó e conferir que sua posição mudou sem deslocar a câmera; soltar fora do palco sem deixar drag preso.
- Arrastar o fundo e conferir pan; aproximar/afastar na roda e nos botões; ajustar à rede.
- Buscar uma nota, navegar para o resultado, ativar modo local e alterar a profundidade.
- Filtrar por estante/tag/órfã, remover um chip e recuperar o estado sem resultados.
- Ver o cartão de contexto e abrir a nota, sem confundir clique com arraste.
- Persistir, fechar/reabrir a tela e confirmar coordenada e preferências; trocar biblioteca e confirmar isolamento.
- Confirmar layout com `prefers-reduced-motion`, teclado, tema claro/escuro e dimensões de janela compactas.
- Gerar biblioteca sintética grande e validar que a interface continua recebendo eventos e pode pausar/recentralizar. Os números-alvo de latência serão definidos após medir o hardware do ambiente de desenvolvimento.

### Regressão do projeto

- Executar `npm run check`, `npm test`, `npm run test:engine` e os testes e2e relevantes; depois `npm run test:e2e` completo.
- Conferir `git diff` para garantir que só arquivos do grafo, testes e documentação planejados foram tocados.
- Não aceitar regressão em abertura de nota, tema, troca de biblioteca, busca geral e editor.

## 8. Roteiro de teste manual do Kayky

1. Abrir o grafo em uma biblioteca com notas de várias estantes e links entre elas.
2. Segurar uma bolinha, arrastar para outro ponto e soltar. Confirmar que só o nó se moveu.
3. Arrastar um espaço vazio. Confirmar que a rede toda acompanhou o movimento.
4. Usar roda, botões de zoom, ajuste à rede e minimapa; confirmar que não perde o acesso às notas nas bordas.
5. Passar o mouse por um nó, inspecionar o cartão e abrir a nota. Repetir com teclado.
6. Pesquisar título parcial; alternar global/local; expandir profundidade e recentralizar em outro nó.
7. Combinar estante, tag e órfãs; remover um filtro pelo chip e limpar todos; testar filtro sem resultado.
8. Alterar forças, pausar e retomar. Confirmar que o arraste manual continua funcionando enquanto a simulação está parada e depois que ela volta.
9. Mover alguns nós, sair e voltar ao grafo e reiniciar o aplicativo; confirmar a restauração. Abrir outra biblioteca e verificar que o layout é independente.
10. Repetir em tema claro/escuro, janela menor, teclado e movimento reduzido. Com uma biblioteca grande, confirmar que busca, zoom, pan, seleção e pausa continuam acessíveis.

## 9. Critérios para considerar concluído

- Um nó arrastado permanece onde foi solto, sem pan acidental; arrastar o fundo continua sendo pan.
- Busca, foco, filtros, modo local, órfãos, cartão, minimapa, zoom e forças operam sobre a consulta real da biblioteca.
- Layout manual persiste por biblioteca, sem alterar notas, links, formato Markdown ou compatibilidade MCP.
- Não há loop de força quadrático na thread da interface nem renderização contínua depois do estado estável.
- Redes de tamanhos crescentes são mensuradas; ao exceder o desempenho aceitável, o usuário ainda consegue pausar, buscar, recentralizar e navegar.
- Testes automatizados e roteiro manual passam; documentação reflete a implementação final.
