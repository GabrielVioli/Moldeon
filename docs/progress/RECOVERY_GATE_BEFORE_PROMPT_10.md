# Gate de recuperação antes do Prompt 10

## Regra de execução

O Prompt 10 permanece bloqueado. Cada etapa do Prompt 9.5 é desenvolvida em branch própria, recebe validação automatizada e visual, gera uma URL de preview e só pode ser mesclada após validação manual do usuário.

## Estado-base

- Commit-base da etapa de bancada vazia: `8366656d05cadd841a59a4c20029b5ecb4c0e0f2`.
- Branch: `recovery/9.5-03-empty-workspace`.
- Merge em `main`: pendente de validação manual.

## Etapa 03 — bancada vazia

### Regressão reproduzida

A biblioteca oferecia uma opção visual de projeto vazio, mas `parseGarmentDraft`, o Documento V3, o autosave e o store ainda exigiam pelo menos uma peça. Excluir a última peça também era bloqueado. A correção anterior substituiria o Canvas por uma tela vazia, impedindo desenhar a primeira peça.

### Causa

A invariável histórica “sempre existe uma peça ativa” estava duplicada no domínio, na serialização V3, na restauração, no histórico e na interface. O snapshot do motor era usado como fallback visual mesmo quando já não pertencia ao documento atual.

### Correção

- `pieces: []` e `patternDefinitions: []` passam a ser estados válidos.
- Autosave V3 omite `activePatternId` quando a bancada está vazia e restaura `activePieceId` como string vazia.
- Store carrega e restaura zero peças, limpa referências e permite excluir a última peça.
- Undo e redo atravessam corretamente o estado vazio.
- O Canvas permanece montado para permitir desenhar do zero.
- O snapshot antigo não é desenhado como peça fantasma.
- A interface apresenta estado vazio e ações para abrir moldes ou desenhar.
- O inspetor não exibe propriedades de uma peça inexistente.

### Testes

- `emptyWorkspace.test.ts`: carregamento vazio, seleção, exclusão da última peça, undo/redo, criação da primeira peça e remoção de referências.
- `emptyAutosave.test.ts`: round-trip do Documento V3 vazio e restauração de autosave sem peça ativa.
- `recovery-empty-workspace-visual.mjs`: desktop 1366×768 e mobile 390×844, criação vazia, desenho, exclusão, undo e redo.
- Typecheck, suíte completa e build de produção executados na branch.

### Evidência visual

Os screenshots são publicados como artifact do workflow `Recovery 9.5 Empty Workspace`. Eles apoiam a inspeção técnica, mas não substituem o teste manual do usuário.

### Preview e validação manual

- URL de preview: pendente após o commit validado da branch.
- Status: aguardando conclusão do workflow, inspeção visual e teste manual do usuário.

## Manequim visual — decisão já registrada para etapa futura

A etapa do manequim não será iniciada antes das etapas anteriores serem aprovadas. O visual usará modelos humanos prontos masculino e feminino, GLB ou glTF, com rig e licença fornecida pelo usuário. Cápsulas e elipsoides permanecerão apenas como colisores invisíveis. A arquitetura futura deverá separar malha visual e colisores e preparar `GLTFLoader`, escala, posicionamento, pose e fallback. Nenhum asset será escolhido, baixado ou incorporado sem aprovação explícita.
