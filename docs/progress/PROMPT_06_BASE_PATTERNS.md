# Prompt 6: moldes-base de torso, camiseta, blusa e saias

## Estado

Implementação publicada em `main` em 5 de agosto de 2026.

- commit de implementação: `267098860fdd3f66475c56aed2b3adabd556a7f5`;
- workflow de validação: `31065287860`;
- commit que iniciou a execução: `2a8583bbd87761bc79437aa8da7734b2f552f344`;
- versões: `bodice-block@2`, `tshirt@2`, `blouse@2`, `straight-skirt@2` e `mini-skirt@2`.

## Arquitetura entregue

`apps/web/src/patterns/basePatternDrafting.ts` concentra os novos geradores puros. O módulo usa o motor de fórmulas seguro do Prompt 5, produz variáveis versionadas, grafo construtivo V2, geometria 2D, fio, linhas de referência, pences, anotações, folgas e metadados de confiança.

O catálogo continua compatível com `GarmentDraft` e `PatternDocumentV3`. Projetos antigos mantêm a geometria e a versão já persistidas. Novos projetos registram sistema de construção, medidas exigidas e estimadas, folgas, limites e estado de revisão em cada `PatternGenerationRecord`.

Conectores V3 agora recebem landmarks determinísticos por papel semântico. A implementação não consulta nome de template ou peça para criar piques.

## Bases superiores

O corpo básico, a camiseta e a blusa compartilham uma construção estrutural versionada, mas usam opções estéticas diferentes. Frente e costas possuem:

- distribuição de busto, cintura e quadril calculada separadamente;
- decotes diferentes;
- comprimentos centrais diferentes;
- ombro calculado por comprimento e inclinação;
- profundidade e curvas de cava diferentes;
- níveis laterais compartilhados para compatibilidade;
- fio, centro na dobra, linhas de busto/cintura/quadril e landmarks.

A manga existente foi preservada para não quebrar as cinco costuras canônicas da montagem. Ela passou a ter assimetria frontal/traseira e landmarks, mas continua classificada como experimental e não é usada para declarar o template manualmente validado.

## Saias

Saia reta e minissaia usam frente/costas diferentes, distribuição de cintura e quadril, altura de quadril, curvas laterais e barras versionadas. A tomada das pences participa da largura aberta da cintura; zerar a tomada muda o contorno e a área, comprovado por teste.

A abertura futura da saia reta está documentada, sem geometria incompleta ou zíper fictício.

## Confiança

- `bodice-block@2`: validado geometricamente, revisão manual pendente;
- `tshirt@2` e `blouse@2`: experimentais no conjunto, corpo validado geometricamente e manga experimental;
- `straight-skirt@2` e `mini-skirt@2`: validados geometricamente, revisão manual pendente;
- nenhum template foi marcado como `manually-reviewed`;
- calça e jaqueta não foram promovidas.

## Verificações executadas

- `npm run typecheck`;
- atualização e repetição dos golden snapshots;
- suíte completa `npm test`;
- `npm run build`;
- invariantes em cinco corpos de proporções diferentes;
- área, perímetro, dimensões-chave, ombros, laterais e cavas;
- contornos degenerados e autointerseções;
- fio, landmarks e conectores V3;
- pences com efeito geométrico;
- continuidade ao alterar busto em passos de 10 mm;
- inspeção 2D de cada template e comparações entre corpos.

Os números finais da suíte e do build estão no log do workflow `31065287860`. As evidências permanentes ficam em `docs/evidence/prompt06-base-patterns/`.

## Pesquisa e licenças

A pesquisa conceitual está registrada em `docs/PATTERN_LIBRARY.md`. Nenhuma dependência de runtime foi adicionada e nenhum código ou fórmula de projeto GPL/AGPL foi incorporado. FreeSewing e literatura pública foram usados para princípios, terminologia, distinção entre bloco e molde final, medidas, opções e necessidade de mock-up.

## Limitações

A auditoria é geométrica e visual em Chromium automatizado. Não houve toile, comparação externa de vestibilidade, aparelho físico, Safari, impressão 1:1 ou revisão presencial por modelista. O 3D foi explicitamente excluído como prova de correção.
