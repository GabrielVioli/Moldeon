# Prompt 8: sistema guiado de mangas e compatibilidade com cavas

## Estado

Entrega concluída em 6 de agosto de 2026 na branch `main`.

- versão do domínio: `guided-sleeve@1`;
- commit anterior à documentação: `2f82b4bbdbb83854fa3f54a707880fe06da35a3a`;
- workflow de entrega: `31072088959`.

## Implementação

O gerador antigo continua preservado em projetos existentes, mas a criação guiada usa `domain/sleeveSystem.ts`. Frente e costas são detectadas pelos conectores `frontArmhole` e `backArmhole`. Ombros e axilas são confirmados por `shoulder` e `sideSeam`.

A cabeça frontal e a traseira são curvas independentes resolvidas por comprimento de arco. A manga contém ápice, marca de ombro, pique frontal, dois piques traseiros, axilas, bíceps, cotovelo quando longa, abertura/punho e fio.

## Assistente

`components/SleeveWizardDialog.tsx` implementa quatro etapas: corpo, tipo, medidas e encaixe. O usuário vê IDs dos conectores, arcos, métricas de compatibilidade, tolerâncias, landmarks e um mini diagrama. A ação fica disponível em desktop e mobile.

Uma definição gera duas instâncias. A direita é espelhada e associada ao braço direito. A criação completa é transacional e coberta por undo/redo.

## Costuras

Os grupos explícitos são:

- `guided-sleeve:front-armhole`;
- `guided-sleeve:back-armhole`;
- `guided-sleeve:underarm`;
- `guided-sleeve:body-shoulder`;
- `guided-sleeve:body-side`.

O pareamento é dividido nos landmarks. Testes de cobertura provam que todos os intervalos das cavas e da cabeça são consumidos exatamente uma vez.

## Validação

A execução final realizou typecheck, golden snapshot, suíte completa imutável, build e fluxo de navegador. A auditoria abriu a biblioteca, escolheu corpo básico, percorreu as quatro etapas, alterou o bíceps, abriu o encaixe e confirmou mangas curta e longa.

Capturas desktop e mobile, relatório JSON e resumo Markdown ficam em `docs/evidence/prompt08-sleeves/`.

## Pesquisa

A documentação compara GarmentCode, OpenPattern e referências públicas de construção por cava. A implementação Moldeon é original e não copia fórmulas proprietárias.

## Limitações

Não houve toile, dispositivo móvel físico, Safari ou prova de caimento. Manga bufante, capa, raglan, duas folhas, punhos complexos e XPBD permanecem em etapas futuras.
