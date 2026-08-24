# Merge controlado da UI responsiva na Recovery 11.0.4

Status da integração de UI: **PASS — pronto para validação manual**

Status técnico global herdado: o blocker já registrado no 11.0.4C permanece; este merge não autoriza iniciar o Prompt 11.0.5.

## Referências Git

- target branch: `recovery/11.0.4c-garment-orientation-floor-collision`;
- HEAD encontrado no início: `88074caeaa1d96f14e525d61f7e3e33f227518bd`, sem upstream e com o trabalho do 11.0.4C ainda não commitado;
- checkpoint técnico criado por autorização posterior do usuário: `5661d32c7645004b6f05bd958a6496cbbe7f9b64`;
- target SHA imediatamente antes do merge: `5661d32c7645004b6f05bd958a6496cbbe7f9b64`;
- source: `origin/feat/ui-responsive-cleanup`;
- source SHA: `2cfb400839d20a9eb20fa4173b32b340fcfe98d2`;
- merge-base: `2221c35ed41efae56a09a52b6a6e9c6e82103edd`.

`main` não foi usada como base, não houve rebase e a branch de UI não foi removida.

## Auditoria da source branch

Mudanças de UI/layout/styles:

- `apps/web/src/components/FittingRoomDialog.tsx`;
- `apps/web/src/components/Toolbar.tsx`;
- `apps/web/src/main.tsx`;
- `apps/web/src/responsive-workspace.css`;
- `apps/web/src/responsive-workspace-polish.css`.

Viewport/renderização visual:

- `apps/web/src/viewport/GarmentViewport.tsx`.

Testes/config/build:

- `.github/workflows/ui-responsive-validation.yml`;
- `apps/web/src/responsiveWorkspace.test.ts`;
- `scripts/ui-responsive-audit.mjs`.

A source branch não modificava `physics/**`, `garment3d/**`, assembly, HumanBodyModel, AvatarParametricModel, collision, PatternDocumentV3, seams, material physics, XPBD ou Workers.

## Conflito e resolução

Houve um conflito de conteúdo em `GarmentViewport.tsx`, o único arquivo alterado pelos dois lados.

A resolução manteve integralmente a versão técnica da recovery — lifecycle, simulation state, body collision, floor collision, registration, telemetria, Worker e renderer — e aplicou somente a apresentação da UI: painel DEV em `<details>`, fechado por padrão, com corpo rolável.

Durante o smoke foi detectado que o CSS responsivo posicionava o painel DEV nas mesmas coordenadas dos controles de simulação. A integração corrigiu isso para:

- desktop: painel DEV abaixo dos controles (`top: 98px`);
- telas estreitas/baixas: painel DEV acima dos controles (`bottom: 52px`).

O script técnico do 11.0.4C foi adaptado para abrir o painel somente durante operações DEV e fechá-lo antes das capturas. Nenhuma API antiga foi restaurada.

## Código técnico deliberadamente preservado

O diff do merge contra o checkpoint `5661d32` é vazio em:

- `apps/web/src/physics/**`;
- `apps/web/src/garment3d/**`;
- `apps/web/src/avatar/**`;
- `apps/web/src/domain/**`;
- `apps/web/src/workers/**`.

Assim permanecem intactos HumanBodyModel, body registration, `groundY`, garment orientation/placement, assembly, collision, XPBD, PatternDocumentV3 e source mapping.

## Testes

- `npm run typecheck`: PASS;
- `responsiveWorkspace.test.ts`: 5/5 PASS;
- suítes de HumanBodyModel, AvatarParametricModel, AvatarVisual, AvatarGroundPlane, body registration, GarmentBodyRegistration, domain assembly, SemanticAvatarArrangement, AssemblyWorkerClient, XpbdWorkerClient e floor collision: 90/91 PASS;
- `npm run build`: PASS;
- bundle produzido em fallback; somente o warning histórico de chunks grandes permaneceu.

A única falha foi `bodyRegistrationReferenceAudit.test.ts`: a expectativa antiga exige que o candidato `waistTop.max` (`0,0898014 m`) seja menor que `centroid.max` (`0,0605937 m`). O merge não alterou o teste nem qualquer arquivo técnico importado por ele. É uma falha herdada do checkpoint, não uma regressão da UI.

## Browser e responsividade

A aplicação real foi exercitada no Chrome em:

- `360×640`;
- `390×844`;
- `768×1024`;
- `1024×600`;
- `1024×768`;
- `1280×720`;
- `1366×768`;
- `1440×900`;
- `1920×1080`;
- `2560×1440`;
- `3840×2160`.

Também foram validados equivalentes de browser zoom em `80%`, `100%`, `125%` e `150%`.

Resultados:

- nenhuma largura horizontal excedente;
- seis ferramentas essenciais visíveis e acionáveis;
- editor, diálogo, drawer mobile e Provar funcionais;
- canvas sempre com área útil;
- painel DEV fechado por padrão;
- nenhum erro de console ou resposta HTTP >= 400;
- fixtures T-shirt, blouse, straight skirt e multipanel carregaram com todas as meshes;
- body/garment permaneceram no mesmo frame;
- determinante de registration permaneceu aproximadamente `+1`;
- floor físico e visual permaneceram em `-0,002 m`, sem penetração registrada.

## Lifecycle e performance estrutural

Uma sessão instrumentada alternou repetidamente entre desktop, notebook, tablet e mobile, incluindo troca entre as abas 2D/3D.

Baseline e estado final foram idênticos:

- Workers: 2 criados / 2 ativos;
- ResizeObservers: 8 criados / 3 ativos;
- RAF pendente: 1;
- canvas do viewport 3D: 1;
- canvases totais: 2;
- erros de console: 0.

Não houve remount do renderer, Worker duplicado, RAF acumulado, ResizeObserver acumulado ou canvas órfão.

## Problemas restantes

O merge de UI passou, mas não corrige os blockers físicos herdados e já documentados em `RECOVERY_11_0_4C_GARMENT_ORIENTATION_FLOOR_COLLISION.md`, incluindo distorção inicial de tops/pences e o teste antigo de referência corporal. A publicação foi solicitada explicitamente pelo usuário mesmo com esses blockers conhecidos.

Após o push, parar e aguardar validação manual. Não iniciar o Prompt 11.0.5.
