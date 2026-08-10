# Recovery 9.5-05 — Operações de modelagem

## Estado

- **Branch:** `recovery/9.5-05-modeling-operations`
- **Base exata aprovada:** `f8ffb889603e87de8b00b9bcbb782f86d2e6de27`
- **Gate anterior:** 9.5-04 aprovado manualmente.
- **Implementação funcional validada automaticamente:** `5b505916be951dcbc887e84f5ddb5c6e384b7474`.
- **Situação deste gate:** implementação concluída para validação; **aguardando aprovação manual**.
- `main` permanece congelada. Nenhum merge deste gate foi realizado.
- 9.5-06, moldes-base, manga, avatar, 3D, física e Prompt 10 permanecem fora do escopo.

## Fonte de verdade

O Documento V3 continua sendo o formato persistente canônico. Em runtime, `garment.pieces` define as peças existentes. As operações deste gate produzem um novo estado de `GarmentDraft` e entram no histórico como uma única transação; snapshot legado não é usado como fonte autoritativa para criar geometria de modelagem.

## Operações entre peças

### Duplicar e espelhar

- duplicação de uma ou várias peças;
- deslocamento previsível de `+40 mm` em X e Y, preservando a disposição relativa do grupo;
- metadados, tecido, quantidade de corte, guias, anotações, caminhos internos e pences são clonados com IDs novos;
- espelhamento em torno do eixo vertical ou horizontal da peça, com rótulos explícitos na interface;
- a orientação do contorno é corrigida após o espelho;
- handles Bézier de entrada/saída são remapeados;
- referências de recorte `segmentId + t` são remapeadas; quando a orientação da borda é invertida, `t` é convertido para `1 - t`.

### Alinhar e distribuir

- esquerda, direita, topo, base, centro X e centro Y;
- cálculo usa o bounding box transformado em coordenadas de mundo, portanto respeita deslocamento e rotação;
- distribuição horizontal/vertical exige três ou mais peças e mantém os dois extremos como âncoras;
- peças bloqueadas não são alteradas.

### Unir

A união desta etapa aceita exatamente duas peças e exige um par de bordas:

- de comprimentos compatíveis;
- com orientação oposta coerente;
- coincidentes dentro de tolerância explícita;
- cujo resultado seja fechado, não degenerado e sem auto-interseção.

A borda compartilhada é removida e os demais trechos formam um novo contorno. Conteúdo interno da segunda peça é transformado para o espaço local da primeira. Como a topologia muda, costuras ligadas às peças originais que não podem ser remapeadas com segurança são invalidadas/removidas com diagnóstico explícito, nunca mantidas silenciosamente apontando para IDs inexistentes.

## Caminhos internos

A implementação existente de `InternalPath` foi mantida como representação persistente:

- nós editáveis;
- segmentos `line` ou `cubic`;
- handles Bézier editáveis após confirmação;
- finalidade;
- visibilidade;
- bloqueio;
- metadados primitivos persistidos pelo Documento V3.

Finalidades disponíveis: referência, dobra, marcação, corte, corte e costura e pence.

## Recorte ancorado ao contorno

### Causa do caso V antigo

O motor de divisão topológica já conseguia dividir curvas por De Casteljau, gerar duas peças e remapear/inativar costuras. O erro estava na entrada: as extremidades do caminho eram apenas coordenadas próximas ao contorno e o analisador esperava uma travessia geométrica. Isso incentivava o usuário a ultrapassar a borda.

### Regra implementada

Para `cut` e `cut-and-sew`, cada extremidade próxima do contorno passa a armazenar:

- `cutStartEdgeId` / `cutEndEdgeId`;
- `cutStartT` / `cutEndT`;
- versão da referência de borda.

A coordenada do nó é projetada para a borda real. Pontos próximos de vértices são normalizados para `t = 0` ou `t = 1`.

Para reutilizar o analisador de interseções existente sem exigir que a geometria do usuário ultrapasse o contorno, uma pequena extensão é criada **somente como proxy temporário de análise/aplicação**. Essa extensão não é persistida e não entra na geometria resultante. A fonte persistente continua sendo o nó ancorado por `segmentId + t`.

O caso bloqueador de três nós em V, começando e terminando no mesmo segmento do contorno, é aceito sem pontos externos.

### Prévia

Antes de aplicar um recorte válido, a ContextBar mostra duas regiões resultantes em SVG e suas áreas aproximadas. O botão de aplicação permanece desabilitado quando a análise é inválida.

## Pence estrutural

O fechamento usa a implementação estrutural já existente de pence e não reduz a operação a uma linha decorativa.

A pence fechada mantém:

- pernas;
- ápice;
- centro;
- largura;
- comprimento;
- direção;
- estado aberto/fechado;
- IDs das duas pernas estruturais;
- relação `closure.kind = "paired-legs"` com distância alvo zero.

O caminho estrutural resultante possui duas pernas independentes convergindo ao ápice. Undo restaura o estado anterior e redo reaplica a relação estrutural.

## Prega simples

A prega permanece semanticamente distinta da pence. Nesta etapa ela é registrada como preparação estrutural por duas linhas internas de finalidade `fold`.

Metadados persistidos nas duas dobras:

- ID comum da prega;
- papel `fold-a` / `fold-b`;
- profundidade;
- direção;
- sentido `inward` / `outward`;
- consumo adicional de tecido (`2 × profundidade`);
- efeito declarado `fold-preparation`.

Não há alegação de simulação 3D ou caimento da prega neste gate.

## Transações e persistência

Duplicar, espelhar, alinhar, distribuir, unir, aplicar recorte, fechar pence e criar prega entram no histórico do Documento como transações reversíveis. Testes cobrem undo/redo e round-trip pelo serializador Documento V3 e parser real do autosave.

## Regressões obrigatórias cobertas

O conjunto de testes do gate cobre:

1. corte reto de uma borda até outra sem overshoot;
2. V com três nós começando e terminando no mesmo contorno;
3. início e fim no mesmo segmento;
4. extremidade no meio de segmento e sobre vértice (`t=0/1`);
5. caminho curvo, preservação de segmento cúbico e rejeição de tangência;
6. duas interseções próximas, mas geometricamente distintas;
7. peça movida/rotacionada, navegação de câmera e espelhamento de referências;
8. undo/redo, round-trip do autosave V3 e costura remapeada ou explicitamente invalidada;
9. duplicação/espelho de múltiplas peças;
10. alinhamento/distribuição;
11. união compatível e rejeição de união inválida;
12. pence estrutural `paired-legs`;
13. prega com duas dobras e consumo de tecido.

Há também um roteiro de navegador que percorre o V real pela UI, navega com zoom/pan antes da aplicação, aplica/undo/redo, fecha uma pence pela UI e cria uma prega pela UI.

## Evidência automatizada final

No commit funcional `5b505916be951dcbc887e84f5ddb5c6e384b7474`:

- `npm run typecheck`: aprovado;
- `npm test`: **57 arquivos / 330 testes aprovados**;
- `npm run build`: aprovado;
- regressão real em Chromium: aprovada;
- V em peça deslocada e rotacionada: aprovado;
- snapping das duas extremidades com `segmentId + t`: aprovado;
- preview das duas regiões: aprovado;
- zoom/pan preservando o caminho: aprovado;
- aplicar + undo/redo do V: aprovado;
- pence estrutural + undo/redo: aprovado;
- prega simples + undo/redo: aprovado.

Preview para validação manual:

`https://project-bbln2-mj7lcq8j0-gabrielviolis-projects.vercel.app`

O preview foi publicado a partir do artefato de build produzido pela validação do commit funcional acima.

## Critérios para validação manual

O gate só pode ser aprovado após reprodução manual no preview, principalmente:

- V de três nós sem ultrapassar a borda;
- preview das duas regiões;
- aplicação gerando duas peças válidas;
- zoom/pan sem alterar o caminho ou as referências;
- undo/redo do corte;
- duplicar/espelhar/alinha/distribuir;
- união somente quando as bordas forem realmente compatíveis;
- pence fechada mantendo duas pernas estruturais;
- prega com duas linhas de dobra e parâmetros visíveis/persistentes.

**Não avançar para 9.5-06 sem aprovação manual explícita.**