# Prompt 5: medidas, variáveis e motor paramétrico

## Estado

Implementação publicada em `main` em 5 de agosto de 2026.

- commit de implementação: `c444f4fb5fb2c10a0bab7f42fd109b74477fc795`;
- workflow de validação: `31060908459`;
- navegador da inspeção: Chromium `140.0.7339.16`;
- formato persistido: `PatternDocumentV3`, sem alteração de `formatVersion`.

## Arquitetura entregue

O módulo `formulaEngine.ts` contém lexer, parser, AST V1, verificação de unidades, allowlist de funções, avaliação determinística, serialização estável e um grafo incremental com cache e dependências reversas. Não existe `eval`, `new Function` ou execução de código arbitrário.

`parametricMeasurements.ts` define o catálogo corporal expandido, perfis versionados e origem por medida. Valores informados são autoritativos; estimativas e derivadas carregam fórmula, dependências e versão. Estimativas podem ser substituídas e restauradas.

`constructionGraph.ts` avalia medidas, variáveis, pontos livres, pontos calculados, linhas, arcos, curvas, transformações e operações iniciais sem DOM. O desenho 2D continua sendo a geometria autoritativa persistida.

## Compatibilidade e versionamento

O `formatVersion` permanece 3. Campos paramétricos são opcionais. Documentos V3 existentes continuam aceitos sem receber automaticamente uma nova versão de fórmula. Projetos novos registram:

- versão do template;
- versão do motor;
- valores e origens das medidas;
- defaults calculados;
- conjunto de fórmulas usado para cada peça gerada.

A geometria já gerada não é reconstruída silenciosamente ao abrir um projeto antigo. Regeneração completa dos moldes-base fica para uma etapa explícita posterior.

## Interface

O formulário corporal possui modo simples e avançado. O modo simples mostra valor, unidade e origem. O avançado mostra fórmula, dependências, versão e erros. Uma fórmula inválida permanece como erro local e não substitui o último perfil válido.

Os campos foram agrupados em medidas gerais, pescoço e ombros, tronco, braços, quadril e gancho, pernas e outras medidas. A disposição é responsiva e mantém entradas com tamanho adequado no mobile.

## Arquivos principais

- `apps/web/src/domain/formulaEngine.ts`;
- `apps/web/src/domain/parametricMeasurements.ts`;
- `apps/web/src/domain/constructionGraph.ts`;
- `apps/web/src/components/BodyMeasurementsForm.tsx`;
- `apps/web/src/domain/pattern.ts`;
- `apps/web/src/domain/patternDocumentV3.types.ts`;
- `apps/web/src/domain/patternDocumentV3.ts`;
- `apps/web/src/state/editorStore.ts`;
- `apps/web/src/patterns/templateCatalog.ts`;
- testes e fixtures paramétricos;
- `docs/PATTERN_DOCUMENT_V3.md`;
- `docs/DEPENDENCY_AUDIT.md`.

## Testes e build

- `npm run typecheck`: aprovado;
- `npm test`: aprovado;
- `npm run build`: aprovado;
- precedência, funções permitidas e unidades: aprovados;
- ciclos, variável ausente, divisão por zero e domínio inválido: aprovados;
- recomputação incremental: aprovada;
- serialização e round trip: aprovados;
- cinco proporções corporais: aprovadas;
- override e restauração de estimativa: aprovados;
- busca por `eval` e construtor `Function`: aprovada;
- compatibilidade e round trip V3: aprovados.

## Inspeção visual

| Cenário | Resultado | Erros de console |
|---|---|---:|
| `desktop-1366-simple` | passed | 0 |
| `desktop-1920-advanced` | passed | 0 |
| `mobile-390-simple` | passed | 0 |
| `mobile-844-advanced` | passed | 0 |

Capturas e relatório estão em `docs/evidence/prompt05-parametric/`.

## Limitações restantes

A inspeção visual foi executada em Chromium automatizado nas resoluções 1366×768, 1920×1080, 390×844 e 844×390. Não houve validação em aparelho físico, Safari ou leitor de tela real.

Os moldes-base legados continuam usando seus geradores geométricos existentes. Esta etapa registra versão e snapshot e entrega a infraestrutura segura; não converteu todos os geradores antigos para o novo grafo nem implementou gradação industrial.
