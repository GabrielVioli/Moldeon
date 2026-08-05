# PatternDocumentV3

## Objetivo

`PatternDocumentV3` é o formato canônico e versionado de projeto do Moldeon. Ele separa a geometria técnica editável das cópias físicas usadas em montagem e simulação, preserva projetos anteriores por migrações sequenciais e mantém milímetros como unidade autoritativa.

O documento não afirma que a física ou a montagem estejam completas. Ele fornece entidades estáveis para que editor, montagem, mangas, calça e solver possam evoluir sem deduzir significado pelo nome de templates ou duplicar geometria.

## Arquivos de implementação

```text
apps/web/src/domain/patternDocumentV3.types.ts
apps/web/src/domain/patternDocumentV3.ts
apps/web/src/storage/patternProjectIO.ts
apps/web/src/storage/opfs.ts
```

Fixtures e testes:

```text
apps/web/src/testFixtures/patternDocumentFixtures.ts
apps/web/src/domain/patternDocumentV3.test.ts
apps/web/src/storage/patternProjectIO.test.ts
apps/web/src/storage/opfs.test.ts
```

## Documento raiz

```ts
interface PatternDocumentV3 {
  formatVersion: 3;
  metadata: ProjectMetadataV3;
  units: "mm";
  measurements: MeasurementSetV3;
  variables: FormulaVariableV3[];
  constructionGraph: ConstructionGraphV3;
  patternDefinitions: PatternDefinitionV3[];
  panelInstances: PanelInstanceV3[];
  seamGroups: SeamGroupV3[];
  fabrics: FabricSource[];
  body: BodyDefinitionV3;
  workspace: WorkspaceStateV3;
  garmentSettings: GarmentSettingsV3;
  simulationSettings: SimulationSettingsV3;
}
```

### Campos obrigatórios

- `formatVersion` é exatamente `3`.
- `units` é exatamente `mm`.
- `metadata.projectId` identifica o projeto, não uma peça.
- `measurements` contém o conjunto corporal autoritativo e registra quais chaves foram estimadas.
- `patternDefinitions` contém a geometria 2D autoritativa.
- `panelInstances` contém cópias físicas derivadas, sem copiar geometria.
- `seamGroups` contém relações topológicas entre intervalos de borda.
- `fabrics` contém fontes de tecido e propriedades atuais.
- `workspace` contém apenas estado persistente da bancada 2D.
- `simulationSettings` contém preferências, não posições temporárias de partículas.

## Ownership e invariantes

### PatternDefinitionV3

Uma `PatternDefinitionV3` é o molde técnico editável na bancada.

Ela possui:

- pontos legados sincronizados para compatibilidade temporária;
- nós, segmentos e contornos V2;
- curvas cúbicas e seus controles;
- linhas internas;
- pences;
- fio;
- anotações e guias;
- margem e acabamentos de borda;
- quantidade de corte;
- regra de espelhamento;
- tecido padrão;
- conectores semânticos.

A geometria de uma definição existe uma única vez. Nenhuma `PanelInstanceV3` pode copiar ou substituir essa geometria.

### PanelInstanceV3

Uma `PanelInstanceV3` representa uma cópia física derivada de uma definição.

Campos essenciais:

- `sourcePatternId`: definição de origem;
- `copyIndex`: índice zero-based dentro da quantidade de corte;
- `bodySide`: centro, esquerda ou direita;
- `surface`: frente, costas ou lateral;
- `mirrored`: espelhamento físico;
- `fabricId`: tecido efetivamente usado pela cópia;
- `arrangementAnchor`: posição inicial semântica ou manual;
- `simulationEnabled`: participação futura no solver.

O identificador determinístico usado por testes e migrações é:

```text
<sourcePatternId>:panel:<copyIndex + 1>
```

Exemplos:

```text
straight-pants-front:panel:1
straight-pants-front:panel:2
straight-pants-back:panel:1
straight-pants-back:panel:2
```

Uma manga com quantidade de corte 2 produz uma instância esquerda e uma direita. Uma calça com duas definições, frente e costas, cada uma com quantidade 2, produz quatro instâncias.

### Conectores semânticos

Conectores agrupam um ou mais intervalos de borda que têm a mesma função de construção. Eles não são calculados pelo nome da peça.

Papéis atuais:

```text
front-armhole
back-armhole
sleeve-cap-front
sleeve-cap-back
shoulder
side-seam
underarm
neckline
waist
waistband
inseam
outseam
front-rise
back-rise
crotch
hem
custom
```

Cada conector possui:

- um ID estável;
- papel semântico;
- um ou mais `EdgeRange`;
- landmarks opcionais;
- direção;
- metadados primitivos opcionais.

Landmarks referenciam um intervalo pelo índice e uma posição normalizada `t` entre 0 e 1. Piques, pontos de balanço e divisões futuras podem ser representados sem criar geometria paralela.

A migração converte apenas papéis de segmento inequívocos. Quando não há semântica suficiente, o molde continua válido e uma advertência `no-semantic-connectors` é registrada. Nenhum nome de template é usado para inventar conectores.

### SeamGroupV3

`SeamGroupV3` substitui o modelo persistido de costura simples.

```ts
interface SeamGroupV3 {
  id: string;
  name: string;
  first: EdgeRange[];
  second: EdgeRange[];
  direction: "same" | "opposite";
  treatment: SeamTreatmentV3;
  distribution: SeamDistributionV3;
  targetRatio: number;
  slackMm: number;
  active: boolean;
  compatibility?: SeamGroupCompatibilityV3;
}
```

Tratamentos atuais:

```text
standard
ease
gather
elastic
zipper
intentional-mismatch
```

Distribuições atuais:

```text
uniform
proportional
center-biased
custom
```

`targetRatio` é positivo. `slackMm` é não negativo. Um grupo pode ter múltiplos intervalos em cada lado. O solver físico não usa esses campos ainda.

Costuras V2 são migradas para um grupo ativo, com um intervalo de cada lado, `slackMm = 0` e metadados de compatibilidade que preservam `easeRatio`, `type` e `treatment` legados.

## Validação estrutural

O parser V3 não faz coerções perigosas. Ele rejeita:

- versão ou unidade incorreta;
- IDs duplicados;
- definição, borda ou tecido inexistente;
- intervalos fora de 0 a 1;
- intervalo invertido ou vazio;
- instância com `copyIndex` inválido;
- duas instâncias para a mesma definição e índice;
- ausência de uma cópia exigida por `cutQuantity`;
- conector vazio ou apontando para outra definição;
- landmark fora do intervalo ou com índice inválido;
- grupo de costura duplicado;
- costura própria com os mesmos intervalos dos dois lados;
- referência inválida da bancada.

A validação retorna issues estruturadas. O parser converte qualquer issue de erro em exceção compreensível e nunca retorna um documento parcialmente aceito.

## Migrações sequenciais

A entrada segue esta ordem:

```text
legado sem envelope
    ↓ migrateLegacyProjectToV2
PatternProjectV2
    ↓ migrateProjectV2ToV3
PatternDocumentV3
```

Um envelope V2 existente começa diretamente na segunda etapa. Um documento V3 passa apenas pelo parser V3.

Pontos importantes:

- não existe um parser único cheio de condicionais para todas as versões;
- cada fronteira tem função nomeada e erro de estágio;
- `PatternDocumentMigrationError.stage` identifica `legacy-to-v2` ou `v2-to-v3`;
- warnings de migração são separados de erros;
- nenhum erro de migração autoriza sobrescrita do original.

## Backup antes da migração do autosave

Ao restaurar um autosave V1 ou V2, o conteúdo serializado original é preservado antes de qualquer novo save.

OPFS:

```text
moldeon-autosave-pre-v3-backup.json
```

localStorage:

```text
moldeon-autosave:pre-v3-backup
```

O backup é criado uma vez e não é substituído silenciosamente por migrações posteriores.

## Importação e exportação

`patternProjectIO.ts` fornece a fronteira de arquivos portáteis:

- `importPatternProject(serialized)` aceita legado, V2 e V3;
- `exportPatternProject(document)` produz somente V3 validado;
- `createPatternProjectBlob(document)` usa o MIME type do Moldeon;
- a entrada serializada original permanece disponível no resultado de importação.

Extensão planejada:

```text
.moldeon
```

MIME type:

```text
application/vnd.moldeon.pattern-document+json
```

A interface visual de abrir e salvar arquivo não foi criada nesta etapa.

## Compatibilidade temporária com GarmentDraft

A aplicação ainda opera sobre `GarmentDraft`. Por isso existem dois adaptadores:

```text
GarmentDraft → PatternDocumentV3
PatternDocumentV3 → GarmentDraft
```

A projeção V3 para o runtime legado é permitida somente quando não perde dados. Ela rejeita explicitamente:

- grupos inativos;
- mais de um intervalo em qualquer lado;
- `slackMm` diferente de zero;
- distribuição `center-biased` ou `custom`;
- tratamento `zipper`.

Essa restrição é deliberada. O sistema não reduz silenciosamente uma costura V3 avançada a uma costura simples.

## Compatibilidade TypeScript e WASM

O engine Rust/WASM ainda recebe `PatternPiece`, não `PatternDocumentV3`. O adaptador produz uma `PatternPiece` V2 validada, incluindo pontos sincronizados, para manter a fronteira atual de fallback TypeScript e WASM.

Nesta etapa:

- o fallback TypeScript é coberto por teste de restauração da peça projetada;
- `npm run build:wasm` comprova a compatibilidade de compilação da fronteira atual;
- a equivalência integral do documento V3 no Rust ainda não existe;
- o Rust não é fonte autoritativa do documento raiz.

## Estado da bancada

`WorkspaceStateV3` persiste:

- molde ativo;
- transformação 2D por definição;
- visibilidade;
- bloqueio.

Transforms usam `patternId` como ownership. A cópia física não possui transform da bancada. Renderização, câmera, seleção temporária e posição de partículas não entram no documento.

## Configurações futuras

`variables` e `constructionGraph` existem como coleções versionadas vazias nesta etapa. Elas preparam dependências paramétricas futuras sem inventar fórmulas ou reconstruir templates agora.

`simulationSettings` registra preferências iniciais, mas não conecta física. Valores de gravidade, iterações ou qualidade não indicam que o solver profissional esteja implementado.

## Compatibilidades a remover em fases futuras

A próxima evolução do runtime pode remover, nesta ordem:

1. `GarmentDraft` como documento persistido.
2. `PatternPiece.points` como segunda representação persistida, após todos os consumidores usarem nós e segmentos.
3. `workspaceTransforms`, mantendo apenas `workspace.patterns`.
4. `previewPlacements` e `assemblyPlacements`, substituídos por `PanelInstanceV3.arrangementAnchor`.
5. `Seam`, substituído por `SeamGroupV3` em estado, montagem e interface.
6. `compatibility.legacyEaseRatio`, `legacyType` e `legacyTreatment` após o runtime consumir diretamente V3.
7. inferências semânticas legadas de `AssemblyPlacement`.

Essas remoções não devem ocorrer antes de os consumidores React, montagem, viewport, persistência e WASM aceitarem o documento canônico.

## Fora do escopo desta versão

- correção do editor de pontos;
- novo sistema de corte;
- reconstrução dos moldes-base;
- remoção da peça flutuante;
- solver de costura;
- física, colisão e autocolisão;
- WebGPU compute;
- redesign da interface;
- criação visual de conectores e SeamGroups avançados.
