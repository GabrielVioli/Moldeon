# PROMPT 02: estabilização do domínio e formato de projeto

## Estado

Concluído em `main` em 5 de agosto de 2026.

Esta etapa estabilizou o formato de projeto e as relações entre molde editável, cópias físicas, conectores, costuras, tecidos, medidas e bancada. Ela não corrigiu ferramentas do editor, moldes-base, montagem visual ou física.

## Referências lidas antes da implementação

- `docs/MOLDEON_MASTER_PLAN.md`
- `docs/BASELINE_2026.md`
- `docs/ARCHITECTURE.md`
- `docs/ROADMAP.md`
- parsers e tipos atuais em `domain/pattern.ts`
- tecidos em `domain/fabric.ts`
- autosave em `storage/opfs.ts`
- geradores e placements existentes
- fixtures determinísticas da Fase 0

Não existiam documentos anteriores em `docs/progress` no início desta etapa.

## Decisões arquiteturais

### 1. PatternDocumentV3 é o formato canônico persistido

Foi criado um documento raiz com:

- `formatVersion: 3` explícito;
- `units: "mm"` obrigatório;
- metadata do projeto;
- conjunto de medidas corporais;
- variáveis e grafo construtivo preparados para evolução futura;
- definições de molde;
- instâncias físicas;
- conectores semânticos;
- grupos de costura;
- tecidos;
- corpo;
- estado da bancada;
- configurações da roupa;
- preferências de simulação.

O documento não armazena câmera, renderer, buffers, partículas, velocidades ou outro estado temporário.

### 2. PatternDefinitionV3 possui a geometria 2D

`PatternDefinitionV3` é a única proprietária da geometria técnica autoritativa. Ela preserva:

- pontos de compatibilidade;
- nós;
- segmentos retos e cúbicos;
- contornos;
- linhas internas;
- pences;
- fio;
- anotações;
- guias;
- margem de costura;
- acabamentos de borda;
- quantidade de corte;
- regra de espelhamento;
- tecido padrão;
- conectores.

Nenhuma instância física duplica essa geometria.

### 3. PanelInstanceV3 representa cópias físicas

Cada instância possui:

- `sourcePatternId`;
- `copyIndex`;
- lado corporal;
- superfície;
- espelhamento;
- tecido;
- anchor de arranjo;
- estado de participação futura na simulação;
- metadados primitivos.

IDs de instância são determinísticos:

```text
<sourcePatternId>:panel:<copyIndex + 1>
```

A fixture de calça resulta em duas definições e quatro instâncias. A definição de manga com quantidade de corte 2 resulta em uma instância esquerda e uma direita.

### 4. Conectores vêm de semântica de borda

Conectores não são determinados pelo nome de peça ou template. A migração converte somente papéis de segmento inequívocos, incluindo:

- cava frontal e traseira;
- cabeça frontal e traseira da manga;
- ombro;
- lateral;
- cintura;
- entreperna;
- lateral da perna;
- gancho frontal e traseiro;
- decote;
- barra.

Um conector pode agrupar vários intervalos e landmarks. Ausência de semântica inequívoca produz warning, não uma inferência inventada.

### 5. SeamGroupV3 substitui a costura persistida simples

`SeamGroupV3` suporta:

- vários intervalos em cada lado;
- direção;
- tratamento;
- distribuição;
- `targetRatio`;
- `slackMm`;
- estado ativo;
- metadados temporários de compatibilidade.

Costuras V2 são migradas para um grupo ativo com um intervalo por lado. `easeRatio`, `type` e `treatment` legados são preservados em `compatibility`.

O solver ainda não consome SeamGroupV3.

### 6. A projeção para GarmentDraft nunca perde dados silenciosamente

A aplicação atual ainda usa `GarmentDraft`. Foram criados adaptadores nos dois sentidos.

A projeção V3 para o runtime legado é recusada quando encontra:

- grupo inativo;
- múltiplos intervalos;
- slack diferente de zero;
- distribuição ainda não suportada;
- zíper.

Nesses casos é lançada `PatternDocumentCompatibilityError`. O sistema não reduz um recurso V3 avançado a uma costura simples.

## Migrações

A cadeia implementada é sequencial:

```text
projeto legado sem envelope
    ↓ migrateLegacyProjectToV2
PatternProjectV2
    ↓ migrateProjectV2ToV3
PatternDocumentV3
```

Um documento V2 entra na segunda etapa. Um V3 é apenas validado.

Falhas indicam o estágio:

- `legacy-to-v2`
- `v2-to-v3`

Warnings são retornados separadamente dos erros.

## Backup recuperável

Antes de restaurar e migrar um autosave V1 ou V2, a string original é preservada uma vez.

OPFS:

```text
moldeon-autosave-pre-v3-backup.json
```

localStorage:

```text
moldeon-autosave:pre-v3-backup
```

O backup existente não é substituído silenciosamente.

## Importação e exportação

Foi criada a fronteira `storage/patternProjectIO.ts`.

- importação aceita legado, V2 e V3;
- exportação sempre produz V3 validado;
- a string original fica disponível no resultado de importação;
- extensão planejada: `.moldeon`;
- MIME type: `application/vnd.moldeon.pattern-document+json`.

A interface visual para abrir e salvar arquivo ficou fora do escopo.

## Validação

O parser estrutural rejeita:

- versão ou unidade incorreta;
- IDs duplicados;
- referências para molde, borda ou tecido inexistente;
- intervalos fora de 0 a 1;
- intervalo invertido ou vazio;
- instância ausente, duplicada ou com índice inválido;
- conector vazio, cruzando ownership ou com landmark inválido;
- grupo de costura duplicado;
- costura própria degenerada;
- referências inválidas da bancada.

Não há coerção de texto para número, criação automática de referência ausente ou aceitação parcial de documento inválido.

## Fixtures adicionadas

- projeto legado determinístico;
- envelope V2 determinístico;
- documento V3 determinístico;
- round trip V3 rico com curvas, costura parcial, pence, linha interna, dois tecidos e transforms;
- calça com duas definições e quatro instâncias;
- manga com cópias esquerda e direita;
- documentos com referências quebradas, intervalos invertidos e costura própria degenerada.

## Testes executados

Execução de referência antes deste relatório:

```text
Commit: 99b7809a281e77555a835da7ed4faf2e905e0c24
Workflow: Prompt 02 Domain
Run: 31043240471
Artifact: prompt02-domain-99b7809a281e77555a835da7ed4faf2e905e0c24
Artifact ID: 8945541405
```

Resultados:

| Verificação | Resultado |
|---|---:|
| `npm run typecheck` | aprovado |
| `npm test` | 29 arquivos, 170 testes aprovados |
| `npm run build` | aprovado |
| `npm run build:wasm` | aprovado |
| `cargo test --workspace` | 3 testes aprovados |
| `cargo fmt --all -- --check` | aprovado |
| `cargo clippy --workspace --all-targets -- -D warnings` | aprovado |
| servidor fallback + Chromium | aprovado |
| servidor WASM + Chromium | aprovado |

A inspeção visual percorreu 1366×768, 1920×1080, 360×800 e 390×844. Nos dois backends, todas as ações automatizadas concluíram. O desktop 1366×768 montou um canvas 3D. Os demais viewports abriram e navegaram sem ação falha.

Os warnings do desktop 3D são os mesmos do baseline, ligados ao backend gráfico virtual e ao estado já conhecido do viewport. A etapa não corrigiu a qualidade visual das roupas, o lifecycle do 3D ou a responsividade mobile.

## Arquivos principais

```text
apps/web/src/domain/patternDocumentV3.types.ts
apps/web/src/domain/patternDocumentV3.ts
apps/web/src/domain/patternDocumentV3.test.ts
apps/web/src/storage/opfs.ts
apps/web/src/storage/opfs.test.ts
apps/web/src/storage/patternProjectIO.ts
apps/web/src/storage/patternProjectIO.test.ts
apps/web/src/testFixtures/patternDocumentFixtures.ts
.github/workflows/prompt02-domain.yml
docs/PATTERN_DOCUMENT_V3.md
docs/ARCHITECTURE.md
docs/ROADMAP.md
```

## Compatibilidades temporárias

1. `GarmentDraft` ainda é a estrutura consumida pelo Zustand e pela interface.
2. `PatternPiece.points` continua persistido e sincronizado com nós e segmentos.
3. `Seam` simples continua sendo usado pela montagem e pelo viewport atuais.
4. `previewPlacements` continuam sendo projetados a partir de `PanelInstanceV3`.
5. `AssemblyPlacement` continua sendo projetado do primeiro anchor compatível de cada definição.
6. `workspaceTransforms` e `workspaceStates` ainda são produzidos para consumidores legados.
7. `compatibility.legacyEaseRatio`, `legacyType` e `legacyTreatment` preservam round trip do modelo antigo.
8. O Rust/WASM ainda recebe `PatternPiece`, não `PatternDocumentV3`.
9. `semanticRole` pode herdar o placement legado durante a migração, mas conectores não dependem desse nome ou papel inferido.

## O que a próxima fase pode remover

A remoção deve ser incremental e acompanhada de migração dos consumidores.

1. Uso de `GarmentDraft` como formato de persistência.
2. Leitura direta de `workspaceTransforms` após todos os consumidores usarem `workspace.patterns`.
3. Leitura direta de `previewPlacements` após o viewport usar `PanelInstanceV3.arrangementAnchor`.
4. Leitura direta de `AssemblyPlacement` após a montagem usar as instâncias físicas.
5. `Seam` simples após estado, interface e montagem consumirem `SeamGroupV3`.
6. Metadados `compatibility.*` após o runtime suportar diretamente grupos de costura.
7. Inferências de papel baseadas em placements legados.
8. `PatternPiece.points` como representação persistida paralela, somente depois de editor, fallback e WASM usarem nós e segmentos.

## Limitações conhecidas

- O Zustand ainda não armazena o V3 diretamente.
- Recursos avançados de SeamGroup existem no schema, mas ainda não são editáveis na interface nem enviados ao solver.
- Conectores migrados não possuem landmarks quando o legado não tinha informação equivalente.
- O Rust não valida o documento raiz V3.
- Compatibilidade TypeScript/WASM é comprovada pela projeção para `PatternPiece`, pelos testes fallback e pelo build WASM, não por um schema V3 duplicado em Rust.
- Importação e exportação existem como API de domínio, sem botão visual.
- Não houve correção de inserção de pontos, corte, menus, painel de medidas, peça flutuante, templates, física, colisão ou WebGPU compute.
- Os defeitos visuais e mobile registrados no baseline continuam presentes.
- A inspeção foi executada em Chromium headless, não em dispositivo físico.

## Critérios de aceitação

- Formato V3 explícito, validado e documentado: atendido.
- PatternDefinition e PanelInstance separados: atendido.
- Conectores e SeamGroup representados: atendido.
- Projetos legados migrados com testes: atendido.
- Round trip técnico sem perda nos recursos compatíveis: atendido.
- Dados V3 avançados não são descartados silenciosamente: atendido por rejeição explícita da projeção legada.
- Aplicação anterior continua compilando e executando em fallback e WASM: atendido.
- Testes, builds, Rust e inspeção básica: atendidos.
- Mudanças publicadas em `main`: atendido.

A etapa termina aqui. Editor, montagem e física permanecem para as fases seguintes.
