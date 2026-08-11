# Recovery 9.5-06 — moldes-base e assistente de manga

## Decisão de fechamento

O 9.5-06 é fechado sem publicar moldes automáticos. A validação manual demonstrou que integridade computacional não basta para afirmar validade de modelagem: uma peça pode não ter `NaN`, autointerseção ou triangulação inválida e ainda assim não representar um molde real reconhecível e costurável.

Todos os templates atuais estão marcados como `visibility: internal` e `releaseStatus: deferred`. Não existe entrada pública para a biblioteca nesta entrega. Uma instalação sem autosave inicia diretamente na bancada vazia, cuja única ação inicial de criação é **Desenhar primeira peça**.

## Infraestrutura preservada

Permanecem no repositório, sem exclusão:

- geradores versionados de corpo, camiseta, blusa, saia, minissaia e calça;
- diagnóstico explícito da jaqueta pendente;
- fórmulas, perfis corporais, metadados, landmarks e conectores;
- definições de quantidade de corte, dobra, fio, espelhamento e instâncias;
- relações de costura e expansão lógica da calça;
- sistema guiado de manga e seus testes;
- testes geométricos, snapshots e documentos metodológicos.

O trabalho de reconstrução realizado antes desta decisão também foi preservado: adaptações documentadas de Brian/Teagan para a família superior, Penelope para saias e Titan para calça. Isso é material interno de pesquisa; não é uma declaração de que os resultados estão aprovados.

## Compatibilidade

A visibilidade atua somente sobre a lista pública. `createGarmentFromTemplate` e o catálogo interno continuam acessíveis para testes e manutenção. O carregamento de V3 usa as definições e a geometria persistidas no projeto, portanto:

- um projeto salvo com template oculto continua abrindo;
- as peças existentes não são filtradas nem apagadas;
- a versão e o registro de geração sobrevivem ao round trip;
- nenhuma abertura regenera ou substitui silenciosamente a geometria antiga.

## Assistente de manga

O botão permanece visível, porém desabilitado até existirem simultaneamente uma cava frontal e uma cava traseira explicitamente classificadas por papéis semânticos. O sistema não usa nome de peça nem tenta inferir cava a partir da silhueta. Em projetos criados ou importados pelo usuário que possuam esses conectores, o fluxo guiado continua disponível; em bancada vazia, o diagnóstico informa que são necessárias cavas semânticas.

## Critério para retorno público

Nenhum template pode voltar à biblioteca apenas por passar testes geométricos. O retorno exige, no mínimo:

1. método de modelagem documentado e rastreável;
2. forma 2D imediatamente reconhecível por profissional de modelagem sem depender do nome;
3. relações de costura e medidas conferidas;
4. revisão manual registrada e, quando pertinente, prova física/toile;
5. testes computacionais e de persistência continuando verdes.

## Limites desta entrega

Não houve avanço para montagem final, avatar ou física. Nenhum template automático atual é declarado pronto para produção ou oferecido ao usuário como solução pronta. O código fica preservado para uma futura rodada de validação técnica, fora do fluxo público.

## Correção bloqueadora — painéis e pence livre

O botão **Fechar** não encerrava alguns painéis porque a visibilidade era derivada novamente da seleção persistente: o handler limpava intenções, mas a mesma peça selecionada recriava o painel no render seguinte. O `ContextBar` agora mantém um estado explícito de dispensa, preserva a seleção, fecha por botão, Escape e clique no Canvas fora do painel, e reabre quando o usuário seleciona novamente o contexto. Rascunhos ativos mantêm os cliques do Canvas; Escape cancela o rascunho sem criar comando.

A pence dependia de `nodes[0]` como centro de borda e do último nó como ápice. O ponto intermediário era ignorado e as pernas eram sintetizadas por uma largura padrão. A normalização atual examina os três pontos, identifica duas projeções próximas ao contorno e um ápice interno, ordena as pernas deterministicamente pelo contorno, faz snapping e persiste referências topológicas. As sequências perna–ápice–perna, perna invertida–ápice–perna e ápice–perna–perna geram a mesma estrutura.

Não existem limites estéticos de largura ou comprimento. Permanecem somente impossibilidades estruturais: menos de três pontos, ausência de duas pernas associáveis ao contorno, ápice não identificável e região matematicamente degenerada. Após o fechamento, mover ápice ou pernas recalcula largura, comprimento, direção, centro e a relação estrutural; pernas próximas continuam aderindo ao contorno.

O smoke de regressão preserva o corte em V sem overshoot. A auditoria reproduzível está em `scripts/audit-dart-panel-ux.mjs` e cobre desktop, mobile/touch, Fechar, Escape, clique fora, reabertura repetida, cancelamento sem operação, undo/redo, autosave/reload, zoom e pan.
