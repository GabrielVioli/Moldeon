# Prompt 7: calça paramétrica e montagem lógica das quatro instâncias

## Estado

Implementação e evidências publicadas em `main` em 6 de agosto de 2026.

- versão: `straight-pants@2`;
- commit anterior à documentação: `c101ce3d168e7c53f69b085aec87bb441ba4de9b`;
- workflow final: `31068460407`.

## Entrega

A base simplificada foi substituída por `patterns/trouserPatternDrafting.ts`, um gerador puro com fórmulas versionadas. Frente e costas possuem cintura, quadril, coxa, joelho, barra, lateral, entreperna e gancho próprios. A extensão traseira e a elevação da cintura traseira participam da construção e não são offsets visuais aplicados depois do contorno.

As duas definições continuam editáveis na bancada. `cutQuantity: 2` e placements explícitos geram quatro instâncias determinísticas:

- frente esquerda;
- frente direita espelhada;
- costas esquerda;
- costas direita espelhada.

A biblioteca explica essa expansão antes da criação do projeto.

## Montagem lógica

`domain/trouserLogicalAssembly.ts` trabalha apenas com domínio e geometria. O módulo não importa React, Three.js ou solver. Ele cria laterais, entrepernas, ganchos frontal/traseiro, duas pernas tubulares, continuidade de gancho e lista de cinturas/barras abertas.

O runtime simples recebe os intervalos de lateral e entreperna. O gancho entre cópias permanece no grafo lógico porque o modelo legado `Seam` não identifica instâncias físicas e autocosturaria cada cópia. Essa limitação é explícita e reservada para a integração por `PanelInstanceV3` e XPBD.

## Diagnósticos

Foram adicionadas mensagens com instância e conector para:

- quatro painéis no mesmo lado;
- espelhamento incorreto;
- conector ausente;
- lateral ou entreperna cruzada;
- gancho torcido;
- perna ou continuidade de gancho incompleta;
- ID duplicado.

A API localiza a definição 2D de origem a partir de um painel lógico. Testes de assinatura provam que uma alteração frontal só atualiza as frentes e uma alteração traseira só atualiza as costas.

## Testes

A execução final inclui:

- typecheck;
- golden datasets em cinco corpos;
- áreas, perímetros e dimensões-chave;
- frente e costas distintas;
- pences estruturais;
- quatro IDs estáveis;
- lados e espelhamentos;
- duas pernas tubulares;
- continuidade dos ganchos;
- cintura e barras abertas;
- ausência de costuras cruzadas;
- isolamento de atualização por definição;
- suíte completa e build de produção.

## Inspeção visual

As evidências permanentes ficam em `docs/evidence/prompt07-trousers/`:

- `trouser-front-back-medium.svg` e `.png`;
- `trouser-body-comparison.svg` e `.png`;
- `trouser-assembly-graph.svg` e `.png`;
- relatório JSON e Markdown da auditoria.

Chromium abriu os três SVGs, confirmou dimensões positivas, paths válidos e ausência de erros de console. O 3D não foi usado como prova.

## Pesquisa

`docs/PATTERN_LIBRARY.md` compara FreeSewing Paco/Charlie/Titan/Crux, a construção conceitual publicada pela Threads e a referência pública de NuriaMo. O método Moldeon é original; não incorpora código ou fórmulas licenciadas de forma incompatível.

## Confiança e limitações

`straight-pants@2` está validado geometricamente e topologicamente, com revisão manual pendente. Não houve toile, prova física, impressão 1:1, revisão presencial, dispositivo real ou Safari. Braguilha, cós, bolsos, zíper, jeans e física XPBD permanecem em fases próprias.
