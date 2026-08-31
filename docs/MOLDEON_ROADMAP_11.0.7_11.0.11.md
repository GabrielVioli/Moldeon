

MOLDEON - ROADMAP SUBSTITUTO 11.0.7 A 11.0.11
Modelagem 2D + Montagem 3D + Sewing 2D/3D + Performance-first Browser Runtime
Data da revisão: 31/08/2026
Repositório: GabrielVioli/Moldeon
Branch auditada: recovery/11.0.6-canonical-arrangement-2d-body
HEAD remoto observado durante a auditoria: 144b9208503a88ef76b9807ef57b8eb783d4b32b
O SHA acima registra o estado analisado para escrever este roadmap. O Prompt 11.0.7 deve partir do HEAD FINAL, 
publicado e manualmente aceito da 11.0.6 no momento da execução, mesmo que a branch avance legitimamente 
depois desta auditoria.
1. Decisão de produto que substitui o roadmap anterior
O fluxo principal do Moldeon passa a ser:
MODELAR - 2D
criar e editar a geometria técnica do molde
        ↓
MONTAR - 3D
ver todas as PanelInstances
arrastar / girar / virar / posicionar no corpo
ajustar ao corpo sem física completa
        ↓
COSTURAR - 2D ↔ 3D
criar SeamGroups explicitamente
selecionar EdgeRanges em qualquer uma das duas vistas
        ↓
PROVAR - 3D DINÂMICO
XPBD + seams + material + gravidade + body/floor collision
O 2D deixa de ser a autoridade principal de posição corporal. Ele vira a bancada técnica de modelagem: pontos, curvas, 
medidas, pences, fold, mirror, grainline e outras semânticas do molde. A montagem espacial ocorre primariamente no 3D por 
manipulação direta das PanelInstanceV3.
A camada Corpo 2D pode continuar existindo como referência opcional e como atalho legado de arrangement. Ela não deve ser 
necessária para montar um garment completo, nem deve decidir sozinha frente/costas/esquerda/direita por nome, template ou 
proximidade a uma lista pequena de anchors.
CLO3D é apenas uma referência de modelo mental e de responsabilidade entre 2D e 3D. Não copiar interface, assets, código 
ou detalhes proprietários.
2. Avaliação do estado atual do repositório
A auditoria do estado atual mostra que a base necessária já existe, mas o caminho de atualização ainda está organizado em 
torno do assembly completo e do body-placement discreto.
2.1 Domínio canônico existente
PatternDocumentV3 já separa corretamente:
PatternDefinitionV3: geometria técnica 2D;
PanelInstanceV3: identidade física;
PanelArrangementAnchorV3: placement por instância;
SeamGroupV3: relação semântica de sewing;
WorkspaceStateV3: layout da bancada 2D, explicitamente diferente da posição física da simulação.
O contrato de escala continua absoluto:
100 mm no molde = 0.100 m de material físico no 3D
PanelInstanceV3 já possui includedIn3D, simulationEnabled, placementStatus e arrangementAnchor. Não criar um modelo 
paralelo de placement.
Moldeon - Roadmap 11.0.7 a 11.0.11  |  1
2.2 O body map 2D atual ainda é quantizado
BodyReference2D.tsx usa a projeção do HumanBodyModel, mas o authoring espacial atual procura o anchor projetado mais 
próximo em projection.anchors, aplica um raio de captura e somente então confirma placement. Isso explica o comportamento 
observado de precisar "mexer" a peça até ela pegar uma região.
Esse mecanismo pode permanecer como compatibilidade/atalho, mas deixa de ser o fluxo principal.
2.3 Painéis sem anchor ainda são omitidos do 3D
No caminho atual:
GarmentAssembly.buildGarmentAssembly() chama resolvePiecePlacements();
se não houver placement, a peça recebe warning e é omitida;
SemanticAvatarArrangement.buildSemanticAvatarArrangement() também ignora uma instância quando resolveAvatarAnchor() 
não encontra anchor;
portanto existência 3D ainda depende demais de placement confirmado.
O novo contrato é o oposto:
PanelInstanceV3.includedIn3D === true
→ existe visualmente no workspace 3D
Sem arrangement confirmado, a instância deve aparecer em staging, não desaparecer.
2.4 Render e simulação ainda estão acoplados demais no update
App.tsx deriva buildResolvedAssemblyInput(garment) a partir do garment inteiro. GarmentViewport reage à mudança de 
assemblyInput.signature chamando ThreeViewport.updateGarment().
Hoje ThreeViewport.updateGarment() pode:
reconstruir AvatarParametricModel;
pausar simulação;
iniciar AssemblyWorkerClient.solve();
reconciliar/recriar meshes;
refazer body registration;
empacotar exact body mesh;
construir buildXpbdInitialization().
Esse caminho é aceitável para uma alteração estrutural ou para entrar em Provar, mas é proibitivo para um pointermove de 
arrangement. O novo runtime precisa separar alteração de topologia, alteração de arrangement, alteração de seam, alteração 
de body e alteração de parâmetros de simulação.
2.5 Há infraestrutura de lifecycle que deve ser preservada
ThreeViewport.dispose() já desconecta ResizeObserver, remove visibilitychange, cancela RAF, descarta controles, workers, 
geometries/materials e renderer. AssemblyWorkerClient também termina o worker anterior ao substituir um solve.
Essas práticas devem continuar e virar gate de regressão. Não reescrever lifecycle apenas por estética.
2.6 Existe risco real de cache sem limite
HumanBodyModel.ts mantém um modelCache = new Map<string, HumanBodyModel>() indexado pelas medidas. Alterações 
repetidas de medidas podem acumular modelos grandes se o cache permanecer sem política de limite/evicção. Auditar com 
heap profile e tornar qualquer cache grande explicitamente limitado.
2.7 A matemática isométrica existente é útil
IsometricSurfaceAssembly já se declara um STEP-0 geométrico, sem massa, velocidade, gravidade ou timestep, e tenta 
preservar métrica material. Ele é candidato para reutilização em operações de conform/ajuste geométrico, desde que não seja 
chamado no hot path de drag e respeite orçamento de latência.
3. Contratos globais obrigatórios para 11.0.7 a 11.0.11
PatternDocumentV3 continua sendo a fonte canônica.
PatternDefinitionV3 continua dono da geometria 2D.
PanelInstanceV3 continua identidade física. Não duplicar geometria canônica por instância.
arrangementAnchor continua sendo a única semântica persistida de montagem. Extensões mínimas são permitidas; um 
segundo BodyArrangementMap, PanelPlacementV4, FreeTransformStore ou equivalente não é permitido.
Toda instância includedIn3D: true deve ser visível no workspace 3D, com ou sem seam e com ou sem arrangement confirmado.
simulationEnabled controla participação na simulação, não existência visual no modo Montar.
Moldeon - Roadmap 11.0.7 a 11.0.11  |  2
SeamGroupV3 nunca controla visibilidade. Sewing relaciona painéis existentes; não cria nem destrói instâncias.
Sem arrangement confirmado, a instância aparece em staging determinístico e não recebe body placement inventado.
Nenhum nome, template ID, semanticRole ou formato geométrico pode ser necessário para decidir onde uma instância manual 
deve ficar no corpo.
100 mm no 2D continuam 0.100 m no 3D. scale no caminho canônico deve permanecer 1; nunca autoscale garment→avatar.
Alterar a geometria 2D nunca apaga o arrangement já escolhido para suas instâncias.
Modelar, Montar e Costurar operam com cloth physics OFF. Provar é a fronteira explícita que ativa XPBD.
Ajustar ao corpo é geométrico e limitado, nunca uma simulação XPBD escondida.
O runtime deve funcionar por informação explícita e interação do usuário, não por adivinhação de garment role.
Desktop, mobile e browser lifecycle fazem parte do produto. Performance, memória e UI/UX são critérios de correção, não 
polish opcional.
4. Regras globais de performance e memória
Todos os cinco prompts abaixo devem medir antes e depois.
Hot path interativo
Durante drag/pan/rotate/flip em Montar:
pointer event
→ cálculo de interação / surface query quando necessário
→ atualização imperativa da transformação da mesh
→ requestAnimationFrame / render
Não permitido no pointermove:
buildResolvedAssemblyInput() do garment inteiro;
AssemblyWorkerClient.solve();
CoarseAssemblyPipeline completo;
remesh da roupa inteira;
buildXpbdInitialization();
criação/reinício de XpbdWorkerClient;
packHumanBodyMesh();
body registration completo;
autosave síncrono;
structuredClone do documento inteiro;
criação de materials/geometries temporários por frame.
Metas mínimas
desktop alvo: 60 FPS durante manipulação;
desktop mínimo para PASS: 30 FPS sustentados no cenário de gate;
mobile alvo/mínimo de produto para manipulação: 30 FPS em dispositivo representativo;
frame principal de desktop preferencialmente <= 16.7 ms, sem long tasks recorrentes;
mobile preferencialmente <= 33.3 ms durante drag;
operações one-shot como Ajustar ao corpo podem exceder um frame, mas não podem bloquear a UI por longos períodos. Se 
passarem do orçamento documentado, devem rodar de forma cancelável/assíncrona e informar estado sem congelar a 
interação.
Profiling obrigatório
Registrar, por cenário:
FPS/p95 frame time;
main-thread scripting time;
render time;
surface query/raycast time;
quantidade de assembly solves;
quantidade de XPBD initializations;
quantidade de remeshes;
React commits/rerenders dos componentes críticos;
Moldeon - Roadmap 11.0.7 a 11.0.11  |  3
quantidade de Workers criados/terminados;
GPU geometries/textures quando disponível;
heap antes/depois de soak test.
Memory leak gate
Em Chromium com CDP/Playwright quando possível:
repetir abrir/fechar workspace 3D;
alternar Modelar↔Montar↔Provar;
criar/apagar painéis;
alterar medidas;
criar/remover seams;
executar Provar e resetar;
coletar garbage entre ciclos quando a ferramenta permitir.
O heap deve estabilizar. Não aceitar crescimento monotônico sem explicação. Verificar especialmente:
listeners;
ResizeObserver;
RAF/timers;
Workers;
Three.js BufferGeometry, Material, Texture, render targets e WebGL contexts;
caches por measurement/body/topology;
arrays/typed arrays retidos por revisões antigas;
undo history sem limite;
promises/closures de workers cancelados.
Browser UX
Chromium desktop obrigatório;
Chromium mobile emulation obrigatório;
WebKit smoke quando o ambiente permitir;
gate manual em iPhone/Safari para 11.0.7 e 11.0.8 antes de declarar a UX aprovada;
controles touch >= 44 px onde forem acionáveis;
pinch/orbit/drag não podem disputar o mesmo gesto sem ownership explícito;
não cobrir a maior parte do viewport com painéis permanentes.
5. Sequência nova
11.0.7  Canonical 3D Arrangement Workspace + Direct Manipulation
        + Continuous Body Surface + Interactive Performance
11.0.8  Bidirectional Sewing Authoring 2D↔3D
        + Incremental Conform of Sewn Components
11.0.9  Pattern Construction Semantics
        + Stable Arrangement Across 2D Geometry Edits
11.0.10 Generic Complex Garments via Manual 3D Assembly
        + Generator Migration
11.0.11 Explicit Runtime Cleanup + Legacy Heuristic Removal
        + Browser Performance & Memory Hardening
Cada prompt parte do HEAD FINAL e manualmente aceito do anterior. Não criar todas as branches de uma vez.
Moldeon - Roadmap 11.0.7 a 11.0.11  |  4
PROMPT 11.0.7 - Canonical 3D Arrangement Workspace + Direct 
Manipulation + Continuous Body Surface
Branch nova: recovery/11.0.7-canonical-3d-arrangement-workspace
CONTEXTO E BASE
Você está trabalhando no Moldeon.
Parta exclusivamente do HEAD FINAL, publicado e manualmente aceito de:
recovery/11.0.6-canonical-arrangement-2d-body
Durante a geração deste prompt, a branch auditada estava em 144b9208503a88ef76b9807ef57b8eb783d4b32b, mas esse SHA 
é apenas evidência da auditoria. Se a 11.0.6 tiver sido legitimamente finalizada em outro SHA, use o HEAD aceito mais recente 
e registre-o no relatório.
Antes de editar:
confirme branch/base/HEAD remoto e local;
confirme worktree;
crie recovery/11.0.7-canonical-3d-arrangement-workspace a partir da base aceita;
não modifique a branch 11.0.6;
não inicie 11.0.8.
CAUSAS RAIZ JÁ OBSERVADAS
Não reaudite o repositório inteiro. Comece pelos caminhos já identificados.
O estado atual possui estes problemas arquiteturais concretos:
BodyReference2D.tsx usa anchors projetados discretos e nearest-anchor/radius para confirmar placement. Isso é útil como 
atalho, mas quantizado demais para ser a autoridade principal.
GarmentAssembly.buildGarmentAssembly() omite peças quando resolvePiecePlacements() não produz placement.
SemanticAvatarArrangement.buildSemanticAvatarArrangement() também omite instâncias quando resolveAvatarAnchor() não 
encontra anchor.
ResolvedAssemblyInput filtra includedIn3D && simulationEnabled, o que mistura existência visual com participação na 
simulação.
App.tsx deriva buildResolvedAssemblyInput(garment) do garment inteiro e GarmentViewport chama 
ThreeViewport.updateGarment() quando a signature muda.
ThreeViewport.updateGarment() executa trabalho pesado: avatar, assembly worker, meshes, body registration, exact body 
packing e XPBD initialization. Esse caminho não pode ser o hot path de drag.
HumanBodyModel possui visualMesh, surfaceRegions, landmarks e topologia estável. Portanto é possível fazer placement 
contínuo na superfície sem criar outro modelo corporal.
O cache atual de HumanBodyModel é um Map sem limite aparente. Audite crescimento real e limite/evite retenção se 
confirmado.
OBJETIVO DE PRODUTO
Transformar Montar em um workspace 3D de montagem direta.
Fluxo alvo:
MODELAR
usuário cria PatternDefinitions no 2D
        ↓
MONTAR
TODAS as PanelInstances includedIn3D aparecem no 3D
sem exigir seam
sem exigir body anchor
        ↓
usuário seleciona uma PanelInstance
arrasta / gira / vira / move em grupo
        ↓
aproxima do corpo
Moldeon - Roadmap 11.0.7 a 11.0.11  |  5
surface query contínua encontra a superfície real
        ↓
solta
arrangementAnchor é persistido
painel pode ser AJUSTADO AO CORPO
        ↓
física continua OFF
O usuário mostra ao sistema onde a peça pertence. O runtime não precisa descobrir que um polígono "parece frente de 
camiseta" ou "parece perna".
CONTRATO DE DADOS
1. Não criar nova fonte de verdade
Reutilize PanelInstanceV3.arrangementAnchor.
É permitido estender PanelArrangementAnchorV3 somente com a informação mínima necessária para persistir um ponto 
contínuo da superfície corporal.
A direção recomendada, após confirmar os tipos reais, é um attachment equivalente a:
surfaceAttachment?: {
  topologySignature: string;
  triangleIndex: number;
  barycentric: [number, number, number];
  normalOffsetMm: number;
}
O nome final pode seguir as convenções reais do projeto. Não crie outro root model.
Esse attachment deve permitir reconstruir deterministicamente:
posição na superfície;
normal externa;
frame tangente;
offset para fora da pele;
orientação da instância.
Como o HumanBodyModel mantém topologia canônica estável entre medidas, triangle+barycentric deve ser reavaliado na 
malha atual quando o corpo muda, em vez de persistir uma posição mundial obsoleta.
2. Named anchors continuam existindo
BodyAnchorId continua útil como:
label;
snap assistido;
preset/template;
migration compatibility.
Mas o usuário deve conseguir soltar uma peça em qualquer ponto válido da HumanBodyModel.visualMesh, inclusive entre 
anchors nomeados.
3. Três estados funcionais
Não adicione campo persistido só para exibir estado se ele puder ser derivado.
O UI precisa distinguir:
POSICIONAR
instância em staging ou sob manipulação;
mesh rígida;
physics OFF.
AJUSTADO AO CORPO
arrangement de superfície confirmado;
painel pré-conformado geometricamente à superfície;
métrica preservada;
physics OFF.
SIMULADO
Moldeon - Roadmap 11.0.7 a 11.0.11  |  6
somente quando Provar ativa XPBD.
O estado SIMULADO pertence ao lifecycle da simulação, não ao documento canônico.
4. includedIn3D ≠ simulationEnabled
Separar os significados:
includedIn3D = existe visualmente no workspace 3D
simulationEnabled = participa do Provar/XPBD
Em Montar, renderize todas as PanelInstanceV3 com includedIn3D: true.
Não filtre a existência visual por simulationEnabled.
5. Staging determinístico
Instâncias sem arrangement confirmado devem aparecer num staging previsível ao redor do avatar.
Requisitos:
nunca esconder;
nunca inventar body placement;
nunca gravar um fake torso-front;
não usar nome/template para escolher lado;
distribuição determinística por PanelInstance.id/ordem canônica;
evitar sobreposição entre painéis quando possível;
permitir focar/selecionar a partir da lista e do 3D.
O staging pode ser estado de apresentação derivado e não precisa ser persistido como body arrangement.
MANIPULAÇÃO 3D DIRETA
6. Seleção
Clicar/tocar numa mesh identifica a PanelInstanceV3 exata.
A seleção deve sincronizar com o editor 2D no nível da instância/definition sem mover câmeras automaticamente.
Nenhuma seleção deve forçar rebuild de assembly.
7. Drag
Durante drag:
update imperativo da transformação da mesh;
não atualizar o documento a cada pixel;
não disparar autosave a cada frame;
não criar uma entrada de undo por pointermove.
Use transação de gesture:
pointerdown → begin arrangement edit
pointermove → transient transform only
pointerup   → commit arrangement uma única vez
Uma ação de drag = um comando de undo.
8. Rotação
Permitir rotação legível no espaço 3D.
Não obrigar o usuário a editar três inputs numéricos para uma ação básica.
Desktop: gizmo/handles ou interação direta clara.
Mobile: touch targets amplos e painel contextual compacto.
9. Virar face
Adicionar ação explícita e barata Virar face.
Ela deve:
inverter a orientação/outward face da instância;
preservar material metric;
não duplicar a peça;
não alterar canonical 2D;
ser undoable.
Nunca usar scale negativo como atalho se isso quebrar winding/normais/material parity.
Moldeon - Roadmap 11.0.7 a 11.0.11  |  7
10. Multi-select
Permitir selecionar múltiplas PanelInstanceV3 e mover/rotacionar como grupo temporário.
Não fundir IDs, topologia ou geometria.
11. Pin temporário de montagem
Adicionar pin/lock de arrangement para impedir que uma instância seja movida acidentalmente durante a montagem.
É uma ferramenta de editor, não SeamGroupV3 e não modifica PatternDefinitionV3.
Deve ser undoable. Persistência entre sessões não é obrigatória nesta etapa se não houver um local canônico apropriado; não 
crie schema de domínio apenas por isso.
SURFACE QUERY CONTÍNUA
12. Não usar somente a lista de anchors
O fluxo primário de drop sobre o corpo deve ser:
pointer/ray do viewport
→ intersection/closest surface em HumanBodyModel.visualMesh
→ triangleIndex + barycentric
→ normal/frame
→ offset
→ arrangementAnchor
Use a malha canônica do corpo, não um segundo mannequin invisível.
13. Aceleração
32k triângulos não devem ser testados ingenuamente em toda atualização se o profiling mostrar custo alto.
Antes de adicionar dependência, audite o que já existe.
Se necessário, crie um acelerador de query de apresentação/arrangement, cacheado por body/topology signature. Isso é 
infraestrutura de consulta, não fonte de verdade de placement.
Não acople o editor diretamente ao narrowphase/solver de physics/** só para obter raycast.
14. Snap assistido
Named anchors e landmarks podem aparecer como pontos de snap quando o painel está próximo.
Snap deve ser:
assistido, não obrigatório;
visualmente previsível;
desligável se necessário;
incapaz de teleportar uma peça para uma região distante.
AJUSTAR AO CORPO
15. UX
Quando um painel é solto próximo ao corpo:
persistir surface arrangement;
aplicar offset padrão para fora da pele;
oferecer Ajustar ao corpo;
preferência Ajustar ao corpo ao soltar pode ser ON por padrão.
O usuário deve conseguir desligar o auto-adjust para placement livre.
16. Sem autoscale
O ajuste pode curvar/desenvolver a superfície, mas não pode alterar quanto tecido existe.
Obrigatório:
100 mm material antes = 100 mm material depois
Métricas de edge/area devem permanecer dentro da tolerância já usada pelo assembly isométrico.
17. Não é XPBD
Ajustar ao corpo não possui:
massa;
velocidade;
gravidade;
Moldeon - Roadmap 11.0.7 a 11.0.11  |  8
timestep;
cloth Worker;
body collision solve iterativo completo.
Reutilize geometria isométrica/coarse-fine já existente quando fizer sentido, mas somente em uma operação one-shot ou worker 
cancelável.
Não execute solveIsometricSurfaceAssembly() inteiro em pointermove.
18. Surface offset
Defina um offset padrão pequeno para fora da superfície corporal.
A origem deve vir da normal local da superfície. Não aplicar deslocamento global fixo em Z.
Objetivo: reduzir initial overlap antes de Provar sem mudar body/collision.
BODY 2D APÓS ESTA MUDANÇA
19. Rebaixar de autoridade para referência
BodyReference2D continua:
ligar/desligar;
front/back/left/right;
landmarks opcionais;
referência de escala/proporção;
shortcut de arrangement para quem preferir.
Mas:
não é obrigatório;
não bloqueia Montar;
não decide o lado de um painel criado manualmente;
não é necessário virar para Costas para poder montar as costas no 3D.
20. Visibilidade por vista
Quando Corpo 2D estiver ativo, mudar Front/Back/Side pode atenuar visualmente instâncias associadas à superfície oposta.
Isso é somente apresentação.
Não apagar, desativar nem alterar includedIn3D.
PERFORMANCE - BLOQUEADOR DE ACEITE
21. Criar fast path de arrangement
O hot path de drag 3D não pode passar por ThreeViewport.updateGarment() completo.
Separe conceitualmente revisões/cache keys para pelo menos:
body/measurements;
pattern geometry/topology;
instance arrangement;
seams;
fabrics/simulation settings.
Não é obrigatório criar exatamente cinco hashes públicos, mas uma mudança de transform não pode invalidar tudo.
22. Mesh cache por geometry signature
Uma PatternDefinitionV3 com geometria inalterada não deve ser retriangulada/remeshed porque uma instância foi movida.
Instâncias que compartilham definition devem reutilizar dados de geometria sempre que winding/material parity permitir.
23. Não usar React como loop de animação
Pointermove pode atualizar THREE.Object3D.matrix/position/quaternion de forma imperativa e solicitar render.
React/Zustand recebe o commit ao fim da gesture, não dezenas de updates por frame.
24. Render on demand
Com physics OFF e câmera parada, o viewport não precisa renderizar continuamente.
Renderizar quando:
Moldeon - Roadmap 11.0.7 a 11.0.11  |  9
câmera muda;
painel muda;
seleção/highlight muda;
body muda;
ajuste geométrico termina.
25. Worker discipline
Em Modelar/Montar:
XpbdWorkerClient não deve estar rodando;
não criar/recriar assembly worker por drag;
solve geométrico one-shot deve ser cancelável se nova operação o superseder.
26. Memory
Auditar:
HumanBodyModel cache sem limite;
caches de topology/body-surface query;
Three.js geometry/material disposal;
workers;
observers/listeners;
transient selection materials;
command history de gestures.
Caches grandes devem ter política de tamanho/evicção ou lifecycle explícito.
UI/UX
27. Montar precisa parecer um workspace 3D, não uma tela de diagnóstico
Prioridade visual:
corpo;
painéis;
seleção/manipulador;
ações contextuais.
Não exigir um formulário grande para fazer ações básicas.
Ações essenciais próximas à seleção:
Ajustar ao corpo;
Virar face;
Pin/soltar pin;
incluir/excluir da simulação;
resetar arrangement da instância;
focar seleção.
28. Mobile
Definir ownership de gesture.
Gate mínimo:
tap painel = selecionar;
drag painel selecionado = mover;
pinch = zoom;
gesto de orbit/pan não pode mover painel acidentalmente;
handles >= 44 px;
bottom sheet não pode cobrir permanentemente o corpo.
TESTES OBRIGATÓRIOS
includedIn3D=true, simulationEnabled=false, sem seam e sem arrangement → instância existe no workspace 3D.
Domínio
Moldeon - Roadmap 11.0.7 a 11.0.11  |  10
includedIn3D=false → não existe no workspace 3D.
instância sem arrangement permanece unclassified; staging não persiste fake anchor.
surface attachment roundtrip save/load.
mudança de medidas reavalia triangle+barycentric no mesmo topology signature.
rename invariance.
100 mm = 0.100 m.
scale !== 1 no canonical new path deve ser rejeitado/normalizado conforme política existente, nunca usado para fitting.
3D arrangement
2 painéis sem seams aparecem simultaneamente.
frente/costas de camiseta aparecem simultaneamente no staging e podem ser arrastadas para lados opostos manualmente.
4 painéis de calça aparecem simultaneamente e podem ser posicionados em front-L/front-R/back-L/back-R sem nomes 
significativos.
qualquer ponto válido da superfície aceita drop.
flip preserva geometry/metric.
multi-select preserva IDs.
pin impede drag e é undoable.
editar 2D após placement não apaga arrangement.
Performance
5 s de drag de um painel: AssemblyWorkerClient.solve count = 0 durante a gesture.
buildXpbdInitialization count = 0 durante Montar.
body packing count = 0 durante drag.
geometry/remesh count = 0 em transform-only drag.
um drag gera uma entrada de undo.
desktop >= 30 FPS sustentados no gate e target 60.
mobile >= 30 FPS no gate representativo.
Memory
30 ciclos abrir/fechar Montar sem crescimento monotônico significativo de heap/GPU resources.
30 mudanças de medidas não deixam 30 HumanBodyModels grandes retidos se não forem necessários.
workers antigos terminados.
canvas/WebGL context não acumula.
GATE VISUAL OBRIGATÓRIO
Capturar evidência desktop e mobile:
Cenário A - staging
criar 4 retângulos no 2D;
entrar em Montar;
ver os 4 no 3D sem costura.
Cenário B - camiseta
2 painéis com nomes aleatórios;
um manualmente na frente;
outro manualmente atrás;
ambos visíveis.
Cenário C - calça
4 painéis;
colocar manualmente em cada quadrante das pernas;
nenhuma cortina agrupada automaticamente.
Cenário D - superfície contínua
soltar em ponto entre named anchors;
placement confirmado no ponto real.
Moldeon - Roadmap 11.0.7 a 11.0.11  |  11
Cenário E - conform
painel rígido no peito;
Ajustar ao corpo;
superfície curva sem mudança mensurável de material metric.
Cenário F - edição 2D posterior
modificar geometry de uma peça já posicionada;
instância continua no mesmo arrangement.
ARQUIVOS/SÍMBOLOS PARA COMEÇAR
Confirme paths atuais antes de editar:
apps/web/src/domain/patternDocumentV3.types.ts
apps/web/src/domain/patternDocumentV3.ts
apps/web/src/state/editorStore.ts
apps/web/src/components/BodyReference2D.tsx
apps/web/src/avatar/HumanBodyModel.ts
apps/web/src/avatar/AvatarParametricModel.ts
apps/web/src/garment3d/ResolvedAssemblyInput.ts
apps/web/src/garment3d/GarmentAssembly.ts
apps/web/src/garment3d/SemanticAvatarArrangement.ts
apps/web/src/garment3d/IsometricSurfaceAssembly.ts
apps/web/src/garment3d/GarmentThreeBridge.ts
apps/web/src/viewport/GarmentViewport.tsx
apps/web/src/viewport/GlobalThreeViewport.ts
apps/web/src/App.tsx
Expanda apenas por dependência concreta.
NON-GOALS
NÃO:
reescrever XPBD;
alterar exact body collision para compensar placement;
alterar canonical female mesh;
criar BodyArrangementMap paralelo;
implementar Sewing Authoring completo;
implementar self-collision;
implementar layers físicos completos;
implementar zipper/buttons;
fazer cleanup global de legacy heuristics;
reconhecer camiseta/calça/manga por nome no novo fluxo;
iniciar 11.0.8.
CRITÉRIO DE ACEITE FINAL
PASS somente se:
☐
☐
☐
☐
☐
☐
☐
☐
 toda PanelInstanceV3.includedIn3D aparece no workspace 3D;
 seams não controlam visibilidade;
 unassigned aparece em staging e não recebe anchor inventado;
 drag/rotate/flip 3D funciona sem física;
 continuous body surface placement funciona fora de named anchors;
 surface offset local funciona;
 Ajustar ao corpo preserva métrica e não usa XPBD;
 multi-select funciona sem fundir instâncias;
 pin temporário funciona;
Moldeon - Roadmap 11.0.7 a 11.0.11  |  12
☐
☐
☐
☐
☐
☐
☐
☐
☐
☐
☐
☐
☐
 undo/redo inclui arrangement;
 editar 2D preserva arrangement;
 BodyReference2D virou auxílio, não requisito;
 transform-only drag não dispara assembly solve/remesh/XPBD init;
 desktop performance gate PASS;
 mobile performance gate PASS;
 memory soak PASS;
 typecheck PASS;
 focused tests PASS;
 build PASS;
 screenshots desktop/mobile anexados ao relatório;
 physics/** não foi alterado, salvo se houver regressão A/B comprovada e autorização explícita.
EXECUÇÃO / CHECKPOINT
Não faça commit FINAL/push antes da validação manual.
Se houver risco de timeout/quota/interrupção:
pare novas investigações;
preserve o melhor estado funcional;
git diff --check;
rode focused tests possíveis;
faça commit WIP/checkpoint coerente;
push na branch 11.0.7;
registre HEAD, arquivos, testes, métricas e próximo passo.
Se o ambiente cloud só consegue executar via GitHub Actions, use no máximo um workflow temporário reutilizável. Não criar 
carrossel de .yml por experimento.
Relatório final deve trazer causa raiz, antes/depois de performance, heap soak, arquivos alterados e blockers.
PARE PARA VALIDAÇÃO MANUAL. NÃO INICIE 11.0.8.
Moldeon - Roadmap 11.0.7 a 11.0.11  |  13
PROMPT 11.0.8 - Bidirectional Sewing Authoring 2D↔3D + Incremental 
Conform of Sewn Components
Branch nova: recovery/11.0.8-sewing-2d-3d-authoring
BASE
Parta exclusivamente do HEAD FINAL e manualmente aceito da 11.0.7.
Confirme antes de editar:
branch-base;
HEAD;
worktree;
gates da 11.0.7 ainda verdes.
Crie a branch 11.0.8 somente depois disso.
Não reabra o problema de arrangement 2D-first. A montagem primária agora é 3D.
OBJETIVO
Transformar o sewing em uma ferramenta bidirecional:
EdgeRange selecionado no 2D
        ↕ mesma identidade
EdgeRange destacado/selecionado no 3D
Side A + Side B
        ↓
SeamGroupV3
        ↓
mesmas cores/direções nos dois espaços
O usuário pode selecionar bordas no 2D, no 3D ou misturar os dois espaços durante a mesma criação de seam.
Ao confirmar uma seam:
nenhuma peça desaparece;
nenhuma peça é criada;
nenhuma peça é reposicionada por garment-role guessing;
physics continua OFF;
o componente afetado pode receber um ajuste geométrico incremental ao corpo, sem XPBD.
CONTRATO CANÔNICO
1. SeamGroupV3 continua sendo a fonte de verdade
Não criar:
SeamV4;
SewingConnection paralelo;
seam específica do viewport;
duplicação da relação em metadata de mesh.
Reutilizar os campos reais existentes de SeamGroupV3:
first: EdgeRange[];
second: EdgeRange[];
direction;
treatment;
distribution;
targetRatio;
slackMm;
physicalBindings;
active.
2. EdgeRange é a identidade de seleção
O 3D deve conseguir mapear hit de borda para o mesmo pieceId/edgeId/startT/endT usado no 2D.
Moldeon - Roadmap 11.0.7 a 11.0.11  |  14
Não gerar edge IDs visuais descartáveis que percam a ligação com PatternDefinitionV3.
3. Physical binding referencia PanelInstance
Uma seam é semanticamente entre ranges de definitions. Sua realização física deve apontar explicitamente para as 
PanelInstanceV3 relevantes através do modelo existente de bindings.
Não inferir binding pela ordem visual das meshes.
UX DE COSTURA
4. Workflow único
Reutilize seamDraft, addSeamDraftRange, finishSeamDraftSide, reviewSeamDraft e infraestrutura existente quando ainda 
forem válidos.
Fluxo:
ativar Costurar
→ selecionar 1..N EdgeRanges do Side A
→ concluir A
→ selecionar 1..N EdgeRanges do Side B
→ revisar
→ confirmar SeamGroupV3
A origem da seleção pode variar por range:
2D;
3D;
teclado/mouse;
touch.
5. Sincronização visual
Quando um range estiver selecionado:
highlight no 2D;
highlight no 3D;
cor determinística por SeamGroup;
direção visual coerente;
lado A/B evidente.
Hover não pode criar material novo a cada frame.
6. Seleção no 3D
Use as relações de PanelTopology/edge paths já disponíveis para construir um overlay/hit target eficiente.
Não refaça triangulação para saber qual borda foi clicada.
Para touch, aumente hit slop de seleção sem alterar a geometria real.
7. Painéis continuam independentes da seam
Teste como invariável:
N panelInstances antes da seam
= N panelInstances depois da seam
Remover seam também não muda visibilidade.
8. Costura não liga física
Confirmar SeamGroupV3 não chama dress(), não inicia XPBD e não faz body collision.
A seam aparece visualmente e fica pronta para Provar.
AJUSTAR MONTAGEM APÓS COSTURA
9. Objetivo
O usuário não deve ficar com várias chapas planas desconectadas visualmente depois de posicionar e costurar.
Após uma seam ser confirmada, o Moldeon pode ajustar geometricamente somente o componente afetado para uma pose de 
montagem legível.
10. Regra de energia zero
Esse ajuste continua sendo STEP-0 geométrico:
preservar comprimento material;
permitir curvatura/hinge;
Moldeon - Roadmap 11.0.7 a 11.0.11  |  15
respeitar arrangements de superfície já definidos;
aproximar ranges costurados;
aceitar residual se zerar seam exigiria distorcer tecido;
sem massa/velocidade/gravidade/timestep.
Reutilize IsometricSurfaceAssembly, coarse mesh, fine binding e constraint math onde fizer sentido.
Não criar solver especial para shirt/skirt/tube.
11. Escopo incremental
Ao criar/editar uma seam:
identificar apenas o connected component afetado;
não recalcular panels desconectados;
não reconstruir body;
não reinicializar XPBD;
não refazer garment inteiro se geometry/topology não mudou.
12. UX
Adicionar ação contextual equivalente a:
Ajustar montagem ao corpo
E permitir preferência:
Ajustar automaticamente após costurar: ON/OFF
Pode ficar ON por padrão se o gate de performance for atendido.
Se o solve ultrapassar orçamento de um frame, executar assíncrono/cancelável e mostrar feedback curto (Ajustando...) sem 
bloquear camera/selection.
REGRAS DE SEMÂNTICA
13. Comprimentos
Mostrar no review:
comprimento A;
comprimento B;
delta mm;
delta %;
targetRatio;
slack/ease;
direction.
Comprimento vem da geometria canônica, não do mesh deformado no 3D.
14. Ordered chains
Suportar:
1↔1;
1↔N;
N↔1;
N↔M.
Preservar a ordem dos EdgeRange[].
Não colapsar uma chain em uma edge fictícia.
15. Notches/balance
Reutilizar PatternConnectorV3/landmarks existentes.
O 3D pode mostrar notch/balance como overlay, mas não duplicar a semântica em outro model.
16. Direção e reverse
A UI precisa deixar claro quando a correspondência está same ou opposite.
Reverse não é somente cor/seta; precisa chegar ao compiler físico.
Moldeon - Roadmap 11.0.7 a 11.0.11  |  16
PERFORMANCE
17. Hover/seleção
Durante hover e seleção de edge:
0 assembly solve;
0 remesh;
0 XPBD init;
0 body packing;
preferir buffers/LineSegments reutilizados;
hit test acelerado/cacheado.
18. Commit de seam
Somente o commit pode invalidar seam/binding signatures.
O editor não deve serializar/clonar o documento inteiro a cada movimento do cursor.
19. Local conform
Medir separadamente:
build/lookup do component;
coarse solve;
fine transfer;
upload GPU.
Documentar p50/p95.
Se o componente pequeno típico não puder ser ajustado de forma responsiva, auto-adjust deve cair para execução explícita em 
vez de congelar a tela.
20. Memory
Garantir que criar/remover 100 seam highlights/proposals não aumente continuamente:
materials;
BufferGeometries;
listeners;
arrays de proposals;
workers.
Não manter snapshots completos por hover.
UI/UX DESKTOP E MOBILE
21. Desktop
Costurar deve ser possível sem abrir uma tabela gigante.
Mostrar contexto essencial próximo ao viewport/seleção e detalhes avançados em painel colapsável.
22. Mobile
edge tap hit target confortável;
zoom/orbit continuam disponíveis;
Side A/B claramente visível;
botão Concluir lado acessível;
sheet de review não cobre totalmente 2D/3D;
usuário consegue voltar/cancelar sem perder garment.
TESTES OBRIGATÓRIOS
criar seam 1:1 inteiramente no 2D;
criar seam 1:1 inteiramente no 3D;
Side A no 3D + Side B no 2D;
1:N;
N:M;
direction/reverse;
Moldeon - Roadmap 11.0.7 a 11.0.11  |  17
comprimento/delta correto;
save/reload;
editar/remover seam;
physicalBindings apontam para instâncias corretas;
2 painéis sem seam permanecem visíveis;
criar seam não altera visible instance count;
remover seam não altera visible instance count;
staged panel costurado não ganha body arrangement automaticamente;
rename invariance;
no name/template inference.
GATES DE AJUSTE GEOMÉTRICO
Camiseta frente/costas
posicionar manualmente frente e costas;
costurar ombros/laterais;
ambos permanecem visíveis;
Ajustar montagem aproxima costuras e acompanha torso sem autoscale.
Camisa + saia
ambas visíveis antes/depois da seam de cintura;
nenhuma desaparece;
componente é ajustado sem mover painel não relacionado.
2 painéis independentes
sem seam → continuam duas superfícies abertas;
nenhum tube automático.
PERFORMANCE GATE
☐
☐
☐
☐
☐
☐
☐
 hover edge >= 30 FPS mobile e >= 30 FPS desktop, target 60 desktop;
 edge selection não chama assembly worker;
 seam draft não chama XPBD;
 seam commit só invalida subset necessário;
 auto conform não bloqueia UI prolongadamente;
 50 create/remove seam cycles sem memory growth monotônico;
 renderer.info/resources estabilizam.
ARQUIVOS/SÍMBOLOS PARA COMEÇAR
apps/web/src/domain/patternDocumentV3.types.ts
normalizers/serialization de SeamGroupV3
apps/web/src/state/editorStore.ts (seamDraft, proposal/review)
apps/web/src/editor/PatternCanvas*
hit testing/edge overlays atuais
apps/web/src/garment3d/PanelTopology.ts
apps/web/src/garment3d/CoarseSeamConstraints.ts
apps/web/src/garment3d/CompositeEdgeRangeOrder.ts
apps/web/src/garment3d/IsometricSurfaceAssembly.ts
apps/web/src/garment3d/GarmentThreeBridge.ts
apps/web/src/viewport/GlobalThreeViewport.ts
UI atual de AssemblyPanel/ContextBar
Confirme paths reais e expanda somente por dependência.
NON-GOALS
Moldeon - Roadmap 11.0.7 a 11.0.11  |  18
NÃO:
refazer 11.0.7 arrangement;
criar novo seam schema;
ligar XPBD após cada seam;
modificar canonical 2D para fechar costura;
criar special solver para garment;
implementar dart/fold/grainline;
implementar self-collision;
fazer legacy cleanup global;
iniciar 11.0.9.
CRITÉRIO DE ACEITE FINAL
☐
PASS somente se:
 SeamGroupV3 é o único modelo de sewing;
☐
☐
☐
☐
☐
☐
☐
☐
☐
☐
☐
☐
☐
 seleção EdgeRange é bidirecional 2D↔3D;
 usuário pode misturar vistas na mesma seam;
 Side A/B chains e direction são claros;
 physicalBindings corretos;
 seam não altera existência 3D;
 seam não liga physics;
 ajuste de componente costurado preserva métrica;
 unrelated components não são recalculados;
 performance gates PASS;
 memory soak PASS;
 desktop + mobile browser gates PASS;
 typecheck/build/focused tests PASS;
 11.0.7 continua PASS.
Checkpoint/timeout segue as regras da 11.0.7: WIP commit/push somente para não perder trabalho; sem commit FINAL antes 
de validação manual.
PARE. NÃO INICIE 11.0.9.
Moldeon - Roadmap 11.0.7 a 11.0.11  |  19
PROMPT 11.0.9 - Pattern Construction Semantics + Stable 3D 
Arrangement Across 2D Geometry Edits
Branch nova: recovery/11.0.9-pattern-construction-stable-arrangement
BASE
Parta do HEAD FINAL e manualmente aceito da 11.0.8.
11.0.7 e 11.0.8 devem estar verdes antes de qualquer mudança.
OBJETIVO
Consolidar as semânticas técnicas que pertencem ao molde 2D:
Dart;
Fold / cut-on-fold;
Mirror;
Grainline;
E provar um contrato agora essencial ao produto:
editar PatternDefinitionV3 no 2D
NÃO desmonta PanelInstanceV3 no 3D
A bancada 2D vira definitivamente a área de construção do molde. A montagem 3D permanece estável enquanto a geometria 
evolui.
CONTEXTO ATUAL
O projeto já possui:
PatternDart[];
grainline;
cutOnFold;
mirrorRule;
internalPaths.ts com caminho de dart;
patternOperations.ts com outro caminho de dart;
GarmentAssembly/constraint path para fechamento físico de dart;
PhysicalGarmentAssembly com materialização de cut-on-fold;
inferência geométrica legada de fold edge em alguns caminhos.
Esta etapa é consolidação e incremental update, não criação de recursos do zero.
CONTRATO CENTRAL: GEOMETRIA ≠ ARRANGEMENT
1. PatternDefinition muda, PanelInstance permanece
Quando a geometria de uma definition muda:
manter PanelInstanceV3.id;
manter arrangementAnchor;
manter surface attachment;
manter flip/outward side;
manter layer/pin editor state quando aplicável;
manter selection quando ainda válida.
Não recriar instância só porque a triangulação mudou.
2. Rebuild somente da definition afetada
Uma edição em pattern-A não pode:
remesh pattern-B;
reconstruir body;
refazer all seams não relacionadas;
inicializar XPBD;
rodar full assembly.
Moldeon - Roadmap 11.0.7 a 11.0.11  |  20
Use patternDefinitionGeometrySignature()/equivalente como base para invalidation granular.
3. Durante pointer drag 2D
Não executar expensive remesh a cada pixel se isso quebrar frame budget.
Estratégia recomendada:
pointermove 2D
→ atualizar canvas 2D em rAF
→ preview 3D leve somente se puder ser atualizado incrementalmente
pointerup / commit edit
→ retriangular/remesh apenas definition afetada
→ atualizar meshes de suas PanelInstances
→ reaplicar arrangement frame
→ opcional local re-conform
Se topology permanecer compatível durante drag, uma atualização de buffer leve é permitida. Se não, espere o commit da 
gesture.
Um drag deve continuar sendo um único history command.
DART
4. Uma semântica canônica
Auditar os dois caminhos históricos:
internalPaths.ts;
patternOperations.ts.
Ambos devem produzir a mesma PatternDart normalizada.
Não manter duas verdades autoritativas.
5. Dados
Preservar campos reais equivalentes a:
apex;
leg A/B;
intake/width;
length;
closure semantics.
Não reconhecer dart porque o polígono "parece uma pence".
6. 3D
Dart modifica a geometria/semântica física da peça, mas não seu body arrangement.
Ao editar dart numa peça já colocada no busto:
mesh atualiza;
placement continua no busto;
ajuste local pode ser recalculado;
Provar recebe os novos constraints.
Não deformar canonical 2D para fechar fisicamente a dart no STEP-0.
FOLD / CUT-ON-FOLD
7. Fold edge explícita
Auditar o fallback atual de PhysicalGarmentAssembly.findFoldEdge().
Quando a intenção pode ser persistida explicitamente, runtime canônico não deve escolher a fold edge por "maior borda reta 
periférica".
Adicionar somente a menor referência V3 necessária caso ainda não exista.
8. Identidade e arrangement
Materializar a segunda metade física de cut-on-fold sem perder:
relation com source definition;
material parity;
arrangement do conjunto;
Moldeon - Roadmap 11.0.7 a 11.0.11  |  21
scale 1:1.
Abertura da dobra não pode deslocar a peça para outra região corporal.
MIRROR
9. Separar conceitos
Distinguir:
espelhamento de authoring no 2D;
cut-on-fold;
instância física mirrored;
flip/outward face no 3D.
Não usar uma flag para quatro coisas diferentes.
10. Arrangement mirrored
Duplicar/espelhar uma instância pode copiar/sugerir um arrangement relativo, mas nunca deve adivinhar front/back por nome.
Se o usuário já montou L/R e depois altera o geometry source, ambos os arrangements permanecem.
GRAINLINE
11. Fonte canônica
Traçar:
PatternDefinitionV3.grainline → triangulation/remesh → material frame → XPBD warp/weft.
Grainline não pode depender do eixo arbitrário da triangulação.
12. Testes de material
0°;
45°;
90°;
anisotrópico responde à rotação;
isotrópico aproximadamente invariável.
Mudanças estritamente necessárias no adapter/material frame são permitidas, mas não reescrever XPBD nem collision.
ARRANGEMENT PRESERVATION ALGORITHM
13. Pivot/frame persistente
Quando geometry muda, reaplicar a nova mesh no frame da PanelInstanceV3 já montada.
Para surface-attached panel:
reconstruir anchor point a partir da surface attachment atual;
manter orientation/outward side;
manter normal offset;
posicionar nova geometry em torno de um pivot material estável (centroid/reference origin definido deterministicamente);
não reusar world positions antigas como se fossem material coordinates.
14. Re-conform após geometry commit
Se a instância estava em estado ajustado ao corpo:
re-conform somente as instâncias da definition alterada;
preservar anchors/seams;
não movimentar outras definitions;
se local conform falhar, manter rigid placement e mostrar diagnóstico, não resetar arrangement.
PERFORMANCE
15. Cache granular
Separar cache de:
canonical contour/sample;
triangulation/topology;
Moldeon - Roadmap 11.0.7 a 11.0.11  |  22
coarse mesh/fine binding;
GPU geometry;
arrangement transform.
Um transform não invalida topology. Uma mudança de dart/fold pode invalidar topology, mas somente daquela definition.
16. Debounce/commit
Operações caras após edição contínua devem ser:
coalescidas;
canceláveis;
aplicadas à revisão mais recente;
stale result descartado por revision/generation.
17. History memory
Auditar DocumentCommandHistory.
Drags não podem guardar centenas de snapshots completos. Se a history não tiver bound/coalescing adequado, implementar 
política mensurável sem perder undo funcional.
18. Three resources
Ao substituir geometry:
atualizar/reusar BufferGeometry quando possível;
dispose da geometry antiga quando realmente substituída;
não recriar material idêntico;
não manter buffers de revisões obsoletas.
19. Body cache
Esta etapa não deve criar um novo HumanBodyModel para cada edição de molde. Body signature só muda quando 
medidas/body mudam.
UI/UX
20. 2D como bancada limpa
Dart/fold/grainline/mirror são ferramentas de Modelar.
O body 2D continua opcional.
Não misturar controles de 3D arrangement no meio das ferramentas de construção do molde.
21. Feedback 3D
Quando uma edição 2D for commitada:
atualizar a mesma instância 3D;
manter seleção sincronizada;
mostrar estado curto se houver rebuild/re-conform;
não teleportar câmera.
TESTES OBRIGATÓRIOS
Arrangement preservation
posicionar painel no peito → mover ponto no 2D → placement continua no peito.
posicionar painel atrás → alterar gola → continua atrás.
quatro painéis de calça montados → editar um front panel → outros três não se movem.
save/reload após geometry edit mantém arrangements.
duplicate/mirror mantém IDs/relations coerentes.
Dart
ambos entry points produzem mesma semântica.
save/reload.
rename invariance.
bust dart gera shape coerente no Provar sem mover anchor.
Moldeon - Roadmap 11.0.7 a 11.0.11  |  23
Fold
fold reference determinística.
cut-on-fold não cria falsa seam central.
geometry edit mantém fold reference ou invalida explicitamente se edge deixou de existir.
Grainline
0/45/90 material frame.
anisotropic response.
isotropic invariance.
Performance
point drag 5 s: full assembly solve count = 0 durante pointermove.
body rebuild count = 0.
XPBD init count = 0.
no unrelated pattern remesh.
geometry commit atualiza somente definition/instances afetadas.
desktop/mobile editor FPS gate.
50 edit/undo cycles sem heap growth monotônico.
GATE VISUAL
camiseta montada no corpo → editar cava/decote no 2D → continua montada;
saia montada → alterar cintura → continua no quadril;
calça 4 panels → editar apenas um front → os outros não resetam;
dart visible 2D + result 3D;
fold/mirror visible e coerente;
grainline overlay opcional e não poluente.
NON-GOALS
NÃO:
refazer 3D arrangement;
refazer SeamGroup;
implementar advanced dart rotation/slash-spread;
pleats/gathering completos;
layers físicos;
self-collision;
global legacy cleanup;
sleeve/trouser migration completa;
redesign geral.
CRITÉRIO DE ACEITE FINAL
☐
☐
☐
☐
☐
☐
☐
☐
☐
 construction semantics canônicas;
 nenhuma edição 2D perde arrangement 3D;
 rebuild granular comprovado por profiling;
 no body/XPBD rebuild em pointermove 2D;
 history coalescida/bounded;
 GPU/heap soak PASS;
 typecheck/build/tests PASS;
 11.0.7 e 11.0.8 continuam PASS;
 manual desktop/mobile gate PASS.
Checkpoint/timeout conforme regras anteriores.
PARE. NÃO INICIE 11.0.10.
Moldeon - Roadmap 11.0.7 a 11.0.11  |  24
PROMPT 11.0.10 - Generic Complex Garments via Manual 3D Assembly 
+ Generator Migration
Branch nova: recovery/11.0.10-generic-complex-garments-3d
BASE
Parta exclusivamente do HEAD FINAL e manualmente aceito da 11.0.9.
Não execute cleanup global ainda. Primeiro prove garments complexos no novo fluxo.
OBJETIVO
Demonstrar que garments reais e complexos podem ser construídos downstream usando apenas:
PatternDefinitionV3 geometry
+ PanelInstanceV3
+ manual/explicit 3D arrangement
+ SeamGroupV3
+ dart/fold/mirror/grainline
+ generic geometric STEP-0
+ XPBD no Provar
Geradores especializados podem continuar existindo como ferramentas de authoring. Depois que o documento canônico existe, 
o runtime não deve precisar descobrir novamente "isso é manga/calça/cós" para funcionar.
PRINCÍPIO DE PRODUTO
Um usuário deve conseguir:
desenhar quatro painéis sem nomes significativos;
entrar em Montar;
posicionar manualmente cada um em front-L/front-R/back-L/back-R das pernas;
costurar ranges explicitamente;
ajustar ao corpo;
Provar;
sem o runtime reconhecer a palavra calça, trouser, front ou back.
INVENTÁRIO FOCADO
Auditar somente:
sleeveSystem.ts;
templateAssemblySeams.ts;
trouserLogicalAssembly.ts;
domain/assembly.ts;
GarmentAssembly.ts;
SemanticAvatarArrangement.ts;
generator/template files diretamente chamados.
Classificar cada comportamento:
AUTHORING/GENERATOR LEGÍTIMO;
MIGRATION/IMPORT;
RUNTIME SEMANTIC INFERENCE.
Não apagar generator útil.
GERADORES
1. Arrangement inicial é opcional
Template/generator pode oferecer placement inicial conveniente.
Exemplo:
uma manga gerada pode sugerir braço L/R;
uma camiseta template pode abrir front/back aproximadamente em seus lados;
uma calça template pode sugerir quatro quadrantes.
Moldeon - Roadmap 11.0.7 a 11.0.11  |  25
Mas:
usuário pode mover tudo manualmente;
remover metadata de template não pode tornar o garment insolúvel se arrangements/seams explícitos existem;
manual arrangement deve vencer sugestão/template.
2. Generator termina em primitives comuns
Output deve materializar:
PatternDefinitionV3;
PanelInstanceV3 explícitas;
connectors/notches quando aplicável;
grainline;
SeamGroups quando a ferramenta realmente foi usada para gerar sewing explícito;
arrangement sugerido somente como metadata explícita, não hidden runtime branch.
SLEEVE
3. Preservar generator, remover dependência downstream
sleeveSystem pode continuar sabendo como desenhar uma manga.
Depois da criação, runtime deve enxergar apenas um painel comum com:
geometry;
instance;
arrangement escolhido/sugerido;
grainline;
sleeve-cap/armhole ranges/connectors;
SeamGroup.
4. Set-in sleeve P0
Fluxo manual obrigatório:
front/back torso já montados;
sleeve L/R em staging;
arrastar sleeve L para braço esquerdo e R para direito;
Ajustar ao corpo;
costurar sleeve-cap ↔ armhole via 2D ou 3D;
Provar.
Renomear as peças para IDs aleatórios antes do runtime gate.
Nenhum special sleeve solver.
TROUSERS
5. Caso principal de regressão
A imagem real de quatro "cortinas" ao redor do quadril deve virar um gate permanente.
Fixture/manual scenario:
4 panels;
names randomized;
template IDs removidos quando dispensáveis;
no pre-classification necessária para placement;
user arranges:
front-left;
front-right;
back-left;
back-right;
seams explícitas:
outseam;
Moldeon - Roadmap 11.0.7 a 11.0.11  |  26
inseam;
rise;
waist quando aplicável.
Resultado deve ser determinado pela montagem do usuário e pelas seams, não por trouserLogicalAssembly no runtime 
canônico.
6. trouserLogicalAssembly
Se ainda for necessário para template migration/generator, movê-lo/isolá-lo nessa fronteira.
Não permitir que canonical solve consulte shape/name para identificar front/back.
WAISTBAND / COLLAR / STRIPS
7. Painéis comuns
Cós, gola, faixa e strips devem ser tratados como panels comuns no runtime:
visible in staging;
arrangement manual;
SeamGroup attachment;
optional generator suggestion.
Não criar solver por role.
CAMISETA E CAMISA + SAIA
8. Frente e costas
Sleeveless shirt com duas definitions/instances:
ambas aparecem;
user coloca uma na frente e outra atrás;
nenhum front/back guessing;
costuras não fazem uma desaparecer.
9. Garments compostos
Camisa + saia:
todos panels existem simultaneamente;
seam de cintura conecta components sem apagar nenhum;
Ajustar montagem atualiza somente component relacionado;
Provar simula conjunto.
STAGING E UX PARA MUITOS PAINÉIS
10. Organização
Com 8-20 panels, staging precisa continuar utilizável.
Adicionar somente UX necessária:
contador Não posicionados;
foco/isolamento de selecionados;
show/hide explícito;
distribuição staging sem sobreposição excessiva;
filtro por estado de arrangement, se útil.
Não esconder automaticamente painéis só para reduzir bagunça.
11. Multi-select
Validar mover pares/grupos:
duas pernas front;
sleeves L/R;
waistband segments.
IDs permanecem independentes.
Moldeon - Roadmap 11.0.7 a 11.0.11  |  27
AJUSTAR AO CORPO EM GARMENTS COMPLEXOS
12. Connected component only
Após seams, o conform geométrico pode operar no component selecionado.
Preservar:
material metric;
user anchors;
surface offset;
free seam residual quando necessário.
Não comprar fechamento por scale/stretch.
13. Ordem de layers
Não implementar cloth-on-cloth/layers completos, mas remover qualquer hipótese de que somente um panel pode ocupar uma 
região do corpo.
A arquitetura de rendering/selection deve aceitar múltiplos panels próximos da mesma surface.
Documentar ponto de extensão para layerOrder futuro sem criar sistema físico incompleto nesta etapa.
PERFORMANCE EM COMPLEXIDADE REAL
14. Cenários
Medir Montar com:
4 panels;
8 panels;
16 panels;
32 panels simples.
Durante drag de um panel:
0 XPBD;
0 garment-wide assembly solve;
0 unrelated remesh;
render/update somente selecionado/grupo.
15. Geometry sharing
Instâncias da mesma definition devem compartilhar topology/static GPU data quando seguro.
Não duplicar buffers enormes só porque copyIndex mudou.
Mas não usar negative scale que quebre winding, material parity ou normals.
16. Surface query
Body query accelerator deve ser reutilizado entre todos os panels e não reconstruído por seleção.
17. Component conform
Profile por número de panels/constraints.
Se operação > orçamento interativo, worker/cancelable. Nunca bloquear pointer input por segundos.
18. Provar
Esta etapa não exige reescrever o exact collision solver, mas deve medir:
tempo de preparação para XPBD;
tempo até primeiro frame simulado;
FPS da simulação para fixtures principais.
Se houver regressão causada por esta branch, corrigir. Débito herdado de collision deve ser documentado separadamente, não 
mascarado.
19. Memory soak
Loop:
carregar garment matrix;
entrar Montar;
manipular;
Moldeon - Roadmap 11.0.7 a 11.0.11  |  28
Provar;
voltar Modelar;
descarregar;
Repetir e verificar heap/GPU/workers.
Caches de topology por definition precisam ser evictable quando projects são descarregados.
GARMENT MATRIX OBRIGATÓRIA
3-panel tube;
straight skirt;
skirt + waistband;
A-line skirt;
tank;
sleeveless shirt front/back;
shirt + bottom band;
shirt + set-in sleeves;
shorts;
trousers 4-panel manual;
bust dart garment;
asymmetric garment;
shirt + skirt como garment composto.
Para cada fixture relevante:
randomize names;
remover template IDs não necessários;
provar que explicit arrangement + seams são suficientes.
STATIC GUARD
Não adicionar branch runtime por:
sleeve;
waistband;
collar;
leg;
trouser;
skirt;
shirt.
A presença dessas palavras em generator/test/UI não é erro.
O erro é downstream decidir placement/solver com base nelas.
TESTES E GATES
Sleeve
☐
☐
☐
☐
☐
 L/R manual arrangements;
 sleeve cap ↔ armhole chains;
 notch/balance;
 rename invariance;
 no special solver.
Trousers
☐
☐
☐
☐
 4 panels manual front/back/left/right;
 no curtain failure;
 seams explícitas;
 no runtime role guessing.
Moldeon - Roadmap 11.0.7 a 11.0.11  |  29
Visibility
☐
☐
☐
 all panels visible before seams;
 all panels remain after seams;
 disconnected panels remain in staging/arrangement.
Performance
☐
☐
☐
☐
☐
☐
 16-panel drag >= 30 FPS desktop, target 60;
 representative mobile >= 30 FPS;
 no assembly worker during transform gesture;
 no XPBD during Montar/Costurar;
 conform async/cancelable when needed;
 memory soak stable.
Regression
☐
☐
☐
☐
☐
 11.0.7 PASS;
 11.0.8 PASS;
 11.0.9 PASS;
 body collision correctness baseline não regride;
 typecheck/build/focused tests PASS.
NON-GOALS
NÃO:
fazer limpeza global dos legacy helpers ainda;
eliminar generators úteis;
criar physics solver por garment;
implementar full layers/self-collision;
grading/DXF;
zipper/buttons;
reescrever XPBD/body collision.
RELATÓRIO FINAL
Mostrar:
tabela de generators que ficaram;
runtime inference removida/bypassada nesta etapa;
garment matrix;
names randomized results;
performance por panel count;
memory soak;
screenshots front/back/side/3/4 dos principais garments;
blockers herdados separados.
Sem commit FINAL antes da validação manual; checkpoint WIP permitido para não perder trabalho.
PARE. NÃO INICIE 11.0.11.
Moldeon - Roadmap 11.0.7 a 11.0.11  |  30
PROMPT 11.0.11 - Explicit Runtime Cleanup + Legacy Heuristic Removal 
+ Browser Performance & Memory Hardening
Branch nova: recovery/11.0.11-explicit-runtime-performance-hardening
BASE
Parta exclusivamente do HEAD FINAL e manualmente aceito da 11.0.10.
Somente agora é permitido fazer a remoção ampla de heurísticas legacy e o hardening global de performance/lifecycle.
Não comece removendo código. Primeiro prove os substitutos das 11.0.7-11.0.10.
OBJETIVO
Fechar a fronteira canônica do Moldeon:
PatternDocumentV3
→ PatternDefinitions
→ PanelInstances explicitamente montadas
→ SeamGroups explicitamente authoradas
→ Dart/Fold/Mirror/Grainline
→ generic geometric STEP-0 / conform
→ Provar
→ XPBD
→ exact body/floor contact
Runtime canônico deixa de responder:
"o que eu acho que esta peça representa?"
E passa a responder apenas:
"como executar a intenção explícita armazenada/authorada pelo usuário?"
Ao mesmo tempo, fechar performance e memória como qualidade de browser runtime.
FASE 1 - INVENTÁRIO ANTES DE APAGAR
Auditar especificamente:
domain/assembly.ts;
GarmentAssembly.ts;
SemanticAvatarArrangement.ts;
ResolvedAssemblyInput.ts;
templateAssemblySeams.ts;
trouserLogicalAssembly.ts;
sleeve integration;
body placement compatibility;
App.tsx viewport gating;
GarmentViewport.tsx;
GlobalThreeViewport.ts;
caches/body lifecycle;
worker lifecycle;
autosave/history hot paths.
Para cada path, classificar:
REMOVE
MIGRATION ONLY
COMPATIBILITY ONLY
KEEP - GENERIC GEOMETRY
KEEP - EXPLICIT DOMAIN CONSUMER
KEEP - PERFORMANCE INFRA
Produzir tabela antes de big cleanup.
FASE 2 - REMOVER GUESSING DO CANONICAL PATH
Quando já substituídos por interação/metadata explícita, remover ou bypassar do caminho canônico:
suggestBodyPlacement;
Moldeon - Roadmap 11.0.7 a 11.0.11  |  31
inferAssemblyPlacement;
inferFrontReference;
semanticRegionForDefinition;
front/back inference por nome/geometria;
body side inference por garment role;
auto duplication por sleeve/leg role;
template-specific sewing no runtime;
trouserLogicalAssembly downstream;
guided sleeve downstream;
default silencioso para torso-front;
any runtime scale != 1 para fitting;
seam graph usado para inventar body placement;
requirement de connected component para simplesmente abrir/visualizar 3D.
Se uma função já desapareceu nas branches anteriores, não recrie só para removê-la aqui.
FASE 3 - NOVA ELIGIBILITY/PREFLIGHT
1. Montar
Montar deve abrir quando houver pelo menos uma PanelInstanceV3.includedIn3D válida para render.
Não exigir:
seam;
connected garment;
front reference;
body region;
placement confirmado.
Unassigned fica em staging.
2. Costurar
Permitir disconnected components e staged panels.
Seam não muda eligibility visual.
3. Provar
Aqui sim validar requisitos físicos:
geometry válida;
simulation-enabled instances com arrangement suficiente;
SeamGroups válidas quando usadas;
physical bindings;
body registration;
settings.
Se um panel simulationEnabled=true ainda estiver unassigned, mostrar diagnóstico authorable claro.
Não adivinhar placement para destravar Provar.
FASE 4 - RESOLVED INPUT / INVALIDATION ARCHITECTURE
O estado atual usa uma signature ampla que pode invalidar muito trabalho.
Refatore sem criar um segundo documento para distinguir revisões de subsistemas.
No mínimo, o runtime deve conseguir saber separadamente se mudou:
body/measurements;
geometry/topology de definitions;
PanelInstance arrangement;
seams/bindings;
material/simulation settings.
Pode ser por hashes/revisions internas. Não precisa alterar PatternDocumentV3 se não for necessário.
Moldeon - Roadmap 11.0.7 a 11.0.11  |  32
Fast-path matrix obrigatória
drag arrangement: body = não; remesh = não; assembly solve = não; XPBD init = não.
rotate/flip arrangement: body = não; remesh = não; assembly solve = não; XPBD init = não.
select/highlight: body = não; remesh = não; assembly solve = não; XPBD init = não.
seam hover/draft: body = não; remesh = não; assembly solve = não; XPBD init = não.
seam commit: body = não; remesh = não salvo mudança real de topologia; assembly = somente componente afetado quando 
Ajustar ao corpo exigir; XPBD init = não.
2D geometry commit: body = não; remesh = somente a definição afetada; assembly = componente/local; XPBD init = não.
measurement change: body = sim; remesh = não; arrangement/conform = reavaliar somente dependências necessárias; 
XPBD init = não durante edição.
entrar em Provar: body = reutilizar/cache quando válido; remesh = reutilizar; assembly = STEP-0 final necessário; XPBD init = 
sim.
A implementação pode diferir internamente, mas o custo observado deve respeitar essa matriz.
FASE 5 - PRESERVAR MATEMÁTICA GENÉRICA
Não apagar:
IsometricSurfaceAssembly se ainda utilizado genericamente;
rigid transforms;
coarse/fine binding;
generic seam parameterization;
chirality math que consome metadata explícita;
constraint graph genérico;
body local frame math;
exact body contact.
O alvo é semantic guessing, não matemática.
FASE 6 - MIGRATION BOUNDARY
Legacy compatibility deve ocorrer antes do canonical runtime.
Migrável deterministicamente
legacy data
→ materializa explicit PanelInstances/arrangement/seams
→ salva V3 canônico
→ nunca precisa inferir novamente
Insuficiente
legacy data insuficiente
→ diagnóstico
→ usuário monta/costura explicitamente
Nunca:
legacy → infer forever dentro do solver
Migration pode usar nomes/templates somente se isso fizer parte explicitamente do formato legado e o resultado for 
materializado uma vez. O runtime canônico após migration não consulta esses nomes.
FASE 7 - PERFORMANCE HARDENING DO BROWSER
1. Perfil completo por modo
Medir:
Modelar
pointer edit;
zoom/pan;
geometry commit;
autosave.
Montar
selection;
drag;
Moldeon - Roadmap 11.0.7 a 11.0.11  |  33
rotate;
surface query;
conform.
Costurar
edge hover;
Side A/B selection;
seam commit;
component conform.
Provar
time-to-first-simulated-frame;
XPBD step;
body collision;
render FPS;
backpressure/frames discarded.
2. No work when hidden
Quando uma view não estiver ativa:
não manter render loop contínuo sem motivo;
pause physics quando apropriado;
não executar body query;
não rodar stale conform;
não manter observers/listeners duplicados.
3. React/Zustand
Auditar rerenders:
selectors específicos;
memoização apenas onde comprovadamente útil;
evitar objects novos no hot path;
transient pointer state fora de React quando apropriado;
commit store ao final da gesture.
Não fazer micro-otimização cega. Profile antes/depois.
4. Three.js
Auditar:
geometries;
materials;
textures;
render lists;
WebGPU/WebGL resources;
object removal/dispose;
hover overlays;
body visual;
staging meshes.
Preservar o cleanup já existente em ThreeViewport.dispose() e adicionar testes.
5. Workers
nenhuma multiplicação de XPBD workers;
assembly worker cancelado quando superseded;
worker não criado no hot path de Montar;
stale response nunca aplica geometry;
transferables/reuse quando existente;
Moldeon - Roadmap 11.0.7 a 11.0.11  |  34
evitar serializar documento gigante para operações que só mudam transform.
6. Cache policy
Todo cache grande precisa responder:
qual key?;
qual tamanho máximo?;
quando invalida?;
quem é dono?;
quando libera?
Auditar particularmente HumanBodyModel.modelCache.
Implementar limite/evicção mensurável para caches grandes sem limite.
7. Autosave
Arrangement drag e point drag não podem enfileirar centenas de autosaves.
Autosave deve observar revision commitada/debounced.
8. Undo history
History deve ser bounded/coalesced.
Uma gesture longa não pode consumir memória proporcional ao número de pointermoves.
FASE 8 - PROVAR PERFORMANCE SEM QUEBRAR CORREÇÃO
Performance é gate, mas não relaxe collision/metric tests.
Prioridades de otimização seguras antes de alterar algoritmo físico:
evitar init/rebuild redundante;
reutilizar body mesh/BVH quando body signature não mudou;
evitar truth audit fora da cadência necessária se já houver separação existente e testes de correção permitirem;
render desacoplado do cadence físico;
backpressure correto;
não copiar typed arrays desnecessariamente;
não atualizar UI React a cada physics frame se telemetry pode ser throttled.
Qualquer alteração em physics/** nesta etapa exige:
profiling provando hotspot;
A/B correctness;
exact contact regression suite;
nenhuma redução silenciosa de precisão para "ganhar FPS".
Se a otimização física profunda ainda for grande demais, registrar debt para a etapa 12, mas eliminar todo desperdício 
arquitetural ao redor dela agora.
FASE 9 - MEMORY SOAK OBRIGATÓRIO
Automatizar um soak Chromium, por exemplo 30-50 ciclos:
load project;
Modelar;
Montar;
mover 4 panels;
criar/remover seam;
Ajustar ao corpo;
Provar por alguns steps;
reset;
mudar medidas;
voltar Modelar;
unload/reload.
Coletar:
JS heap;
DOM node count;
Moldeon - Roadmap 11.0.7 a 11.0.11  |  35
canvas count;
worker count;
renderer.info.memory quando disponível;
WebGL context count;
cache sizes;
pending RAF/timers instrumentados em DEV.
Após GC, tendência deve estabilizar. Defina tolerância baseada no baseline medido; não aceite crescimento linear por ciclo.
FASE 10 - FINAL UI/UX JOURNEY
Testar como usuário, sem DEV panel:
Garment simples
Modelar saia
→ Montar
→ arrastar ao quadril
→ ajustar
→ Costurar
→ Provar
Camiseta
Modelar front/back
→ Montar ambos
→ um frente / outro costas
→ costurar
→ ajustar
→ Provar
Calça
Modelar 4 panels
→ Montar manualmente 4 quadrantes
→ costurar
→ ajustar
→ Provar
Nenhum passo pode exigir saber o nome interno de um anchor ou preencher formulário técnico para tarefa básica.
Advanced numeric controls podem existir, mas como override.
STATIC AUDIT FINAL
Procurar no canonical runtime decisões por:
sleeve;
waistband;
collar;
leg;
trouser;
skirt;
shirt;
name/displayName/template ID;
geometric "looks like front/back";
auto scale.
A presença em generator, UI label, test ou fixture é permitida.
A presença decidindo solver/placement canônico é FAIL.
GARMENT MATRIX FINAL
Rodar no mínimo:
3-panel tube;
straight skirt;
skirt + waistband;
A-line skirt;
tank;
sleeveless shirt;
Moldeon - Roadmap 11.0.7 a 11.0.11  |  36
shirt + bottom band;
shirt + set-in sleeves;
shorts;
4-panel trousers;
bust dart;
asymmetric garment;
shirt + skirt composite.
Com rename/template-ID invariance onde aplicável.
PERFORMANCE FINAL - CRITÉRIO
Interativo
desktop Montar/Modelar/Costurar: >= 30 FPS sustentados, target 60;
mobile: >= 30 FPS no cenário representativo;
no repeated long tasks durante drag;
no full assembly/XPBD init em gestures.
Provar
Documentar por fixture:
time to first frame;
approximate FPS;
physicsStepMs;
bodyCollisionMs;
particle/triangle count.
Não exigir 60 FPS do solver complexo nesta etapa se a física herdada não alcançar, mas não aceitar regressão e não aceitar 
que UI/render bloqueie esperando physics.
CRITÉRIO DE ACEITE FINAL
PASS somente se:
Arquitetura
☐
☐
☐
☐
☐
☐
☐
 runtime canônico explicit-driven;
 Montar não exige seams/placement prévio;
 unassigned = staging;
 Provar valida sem adivinhar;
 no runtime name/template placement guessing;
 no garment autoscale;
 generic isometric/constraint math preservada.
Performance
☐
☐
☐
☐
☐
☐
 invalidation matrix comprovada;
 no assembly solve no transform hot path;
 no XPBD init fora de Provar;
 body/query caches bounded;
 desktop/mobile gates PASS;
 hidden views não queimam CPU sem motivo.
Memory
☐
☐
☐
☐
☐
 heap soak estabiliza;
 GPU resources estabilizam;
 workers não acumulam;
 observers/listeners/RAF não acumulam;
 history/autosave bounded/coalesced.
Moldeon - Roadmap 11.0.7 a 11.0.11  |  37
Funcional
☐
☐
☐
☐
☐
☐
☐
☐
☐
☐
☐
☐
 garment matrix PASS;
 rename invariance PASS;
 template-ID invariance PASS;
 100 mm = 0.100 m;
 collision correctness baseline PASS;
 typecheck PASS;
 focused tests PASS;
 full suite PASS ou blockers herdados formalmente provados A/B;
 production build PASS;
 Chromium desktop + mobile gate PASS;
 WebKit smoke quando disponível;
 manual real-device mobile gate registrado.
RELATÓRIO FINAL OBRIGATÓRIO
Entregar:
tabela REMOVE / MIGRATION / COMPATIBILITY / KEEP;
heurísticas removidas;
generic geometry preservada;
invalidation/performance architecture final;
before/after profiles;
memory soak charts/tables;
garment matrix;
browser/device matrix;
blockers herdados;
debt explicitamente deixado para etapa 12, se houver;
confirmação de que nenhuma precisão física foi relaxada silenciosamente.
Não faça commit FINAL/push antes da validação manual. Checkpoint WIP é permitido apenas para preservar trabalho em 
cutoff.
PARE PARA VALIDAÇÃO MANUAL. NÃO INICIE A ETAPA 12.
Moldeon - Roadmap 11.0.7 a 11.0.11  |  38
CHECKLIST DE USO DOS PROMPTS
Finalize e aceite manualmente a 11.0.6 atual.
Execute somente a 11.0.7.
Faça gate manual real, principalmente mobile e manipulação 3D.
Só então use a 11.0.8.
Repita a disciplina até 11.0.11.
Não deixe um prompt "compensar" o anterior. Regressão herdada deve ser corrigida na etapa que a introduziu ou formalmente 
isolada por A/B.
Performance/memória são gates em todas as etapas, não tarefas para o final.
Se uma mudança simples de UI começar a alterar physics/**, parar e provar a necessidade antes de continuar.
DEFINIÇÃO DE PRONTO DO NOVO FLUXO
O roadmap 11.0.7-11.0.11 só cumpriu seu objetivo quando um usuário conseguir, de forma intuitiva:
abrir uma bancada vazia
→ desenhar moldes no 2D
→ entrar em Montar
→ ver todos os painéis no 3D
→ posicionar cada painel diretamente no corpo
→ ajustar ao corpo
→ costurar bordas pelo 2D ou pelo 3D
→ ver a montagem continuar estável
→ editar novamente o molde 2D sem perder o placement
→ clicar Provar
→ observar o cloth solver assumir somente então
Sem nomear manualmente "frente", "costas", "manga" ou "perna" para o solver entender. Sem painel desaparecer por não ter 
seam. Sem scale escondido. Sem travar o navegador a cada drag. Sem vazamento progressivo de memória ao trabalhar por 
uma sessão longa.
Moldeon - Roadmap 11.0.7 a 11.0.11  |  39