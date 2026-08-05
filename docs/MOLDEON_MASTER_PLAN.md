PROMPT MESTRE DE ENGENHARIA E EVOLUÇÃO DO MOLDEON

Você é o engenheiro principal responsável por continuar e transformar o projeto Moldeon em uma aplicação web de modelagem de roupas tecnicamente correta, intuitiva, responsiva e minimamente utilizável em computadores e celulares.

Não responda apenas com sugestões, planos ou explicações. Inspecione o repositório, execute o projeto, investigue o comportamento atual, altere o código, escreva migrações, implemente as funcionalidades, crie testes, rode os testes, inspecione visualmente e continue corrigindo até atingir os critérios definidos neste documento.

Refatorações grandes estão autorizadas. Preserve somente aquilo que continua correto, compreensível e sustentável. Não mantenha uma arquitetura inadequada apenas para reduzir o tamanho do diff.

1. REPOSITÓRIO E PONTO DE PARTIDA

Repositório principal:

GabrielVioli/Moldeon

Branch principal:

main

O commit observado durante a elaboração deste prompt foi:

062180a12a499c46f0972b6c5d935a40f6e24d1b

Antes de começar:

Busque a versão mais recente de main.
Confirme que o histórico local está atualizado.
Use o estado atual de main como fonte de verdade.
Não force push.
Não apague trabalho recente sem compreender por que ele existe.
Preserve os avanços recentes de costuras semânticas, montagem resolvida, pareamento de manga e corpo e testes relacionados.
Reproduza os comportamentos visualmente. A existência de commits ou testes não prova que o produto esteja funcionando.

Commits recentes incluem trabalho sobre:

inferência de costuras por papéis semânticos;
resolução de costuras antes da simulação;
inicialização de templates com costuras semânticas;
pareamento de manga e lateral do corpo;
descarte de costuras genéricas conflitantes;
exportação da montagem resolvida.

Essas mudanças devem ser auditadas e aproveitadas quando estiverem corretas, mas não devem ser tratadas como conclusão do problema.

2. ESTADO TÉCNICO ATUAL

O projeto já possui uma base razoável e não deve ser reescrito cegamente.

A stack atual observada inclui:

React 19;
TypeScript 6;
Vite 8;
Three.js;
Zustand;
Vitest;
Rust;
WebAssembly;
Canvas 2D;
Web Workers;
OPFS;
WebGPU opcional;
fallback WebGL 2;
backend Laravel opcional.

O projeto já estabelece uma arquitetura em que:

React + Zustand
    ↓ comandos e snapshots
Núcleo de geometria Rust/WASM
    ↓ contornos, operações e malhas
Worker de física XPBD
    ↓ buffers numéricos
Three.js
    ↓
WebGPU ou WebGL 2

Essa separação é conceitualmente correta. React não deve armazenar nem atualizar cada partícula do tecido a cada frame. A física e a renderização devem operar sobre buffers compactos fora do ciclo normal de renderização da interface.

A stack está atual e não deve ser trocada por moda tecnológica. Mantenha React, Zustand, Three.js e Rust/WASM, a menos que benchmarks reproduzíveis demonstrem que uma mudança específica resolve um gargalo material.

O Moldeon já declara suporte a:

moldes em milímetros;
pontos e curvas Bézier editáveis;
múltiplas peças;
costuras;
recortes;
pences;
margens de costura;
triangulação;
biblioteca paramétrica;
avatar procedural;
tecidos;
exportação SVG;
lazy loading do 3D;
undo e redo;
autosave;
estrutura inicial de XPBD.

Porém, a própria documentação reconhece que o 3D ainda é uma prévia geométrica, o corte aceita apenas uma linha reta com duas interseções e o Worker XPBD ainda não alimenta a malha do Three.js.

A implementação atual da física é apenas uma demonstração de restrições de distância. Ela não possui um ciclo físico completo com gravidade, velocidades, amortecimento, flexão, colisões ou tecido real.

A inicialização atual do painel 3D enrola as coordenadas do molde ao redor de um cilindro. Esse comportamento produz a aparência de peça flutuando e deve ser removido.

3. VISÃO DO PRODUTO

O Moldeon deve ser um editor web de modelagem de roupas que permita:

Criar e editar moldes técnicos em uma bancada 2D.
Trabalhar em milímetros e medidas reais.
Criar peças livres ou partir de moldes-base confiáveis.
Ajustar moldes às medidas de uma pessoa.
Definir pences, linhas internas, margens, piques, fio, dobras e costuras.
Montar virtualmente as peças.
Visualizar imediatamente um manequim humano vestindo a roupa.
Simular o comportamento do tecido sobre o corpo.
Entender onde a roupa está apertada, folgada ou deformada.
Usar o sistema em desktop e, de maneira simplificada mas funcional, em celular.
Trabalhar com tecidos diferentes, inclusive retalhos e peças upcycled.
Exportar moldes utilizáveis na produção física.

O objetivo não é reproduzir toda a complexidade do CLO ou do Audaces de uma vez.

O objetivo é criar um produto menor, porém coerente, intuitivo e confiável.

O diferencial deve ser:

menos menus;
menos termos obscuros;
fluxo guiado;
feedback visual claro;
modelagem 2D tecnicamente correta;
ligação transparente entre molde 2D e roupa 3D;
funcionamento razoável em hardware comum;
acesso pelo navegador;
suporte progressivo a celular.
4. DECISÃO DEFINITIVA SOBRE O 3D
4.1 Não haverá mais peça flutuando

Remova do produto todo modo visual em que a roupa apareça:

flutuando sozinha;
enrolada num cilindro;
explodida;
suspensa sem corpo;
espalhada ao redor do espaço;
separada do manequim como visualização principal;
projetada geometricamente sem relação física com o corpo.

O único modo 3D visível ao usuário deve ser:

Um manequim humano vestindo a peça.

Enquanto o 3D estiver aberto:

o manequim deve estar visível;
a roupa deve estar posicionada sobre o manequim;
a câmera deve enquadrar manequim e roupa;
alterações da bancada devem atualizar a roupa no corpo;
estados inválidos devem aparecer como diagnóstico, não como painéis flutuantes.

Remova ou substitua:

showBody como opção pública;
botão para esconder o corpo;
modo exploded;
botão “Explodida”;
visualização “Montada” versus “Explodida”;
inicialização cilíndrica;
qualquer fluxo em que o usuário precise interpretar pedaços soltos no espaço 3D.

O arquivo atual GarmentViewport.tsx possui opção de corpo e modo de inspeção mounted | exploded. Refatore esse fluxo para cumprir a decisão acima.

4.2 A montagem interna ainda pode usar posicionamento técnico

Internamente, antes de iniciar a física, o sistema pode:

criar instâncias físicas dos painéis;
posicioná-las ao redor das regiões corporais;
aplicar âncoras de arranjo;
aproximar bordas;
resolver interpenetrações iniciais;
iniciar restrições de costura;
estabilizar a roupa por alguns subpassos.

Esse processo deve ocorrer:

antes de exibir o estado final;
em um Worker;
com tela de preparação;
com manequim visível;
com indicador de progresso;
sem mostrar painéis livres flutuando.

Exemplo de feedback:

Preparando a roupa
✓ Criando painéis
✓ Posicionando no corpo
✓ Ligando costuras
• Estabilizando tecido

Se a montagem falhar, mostre algo como:

A manga direita não pôde ser conectada.
A cabeça da manga está 46 mm maior que a cava permitida.

Não mostre uma manga perdida no espaço.

4.3 O 3D precisa poder ser fechado

Adicione um controle explícito para fechar o 3D.

Fechar o 3D deve:

desmontar o componente;
cancelar requestAnimationFrame;
parar a simulação;
encerrar ou suspender Workers;
remover listeners;
liberar controles;
liberar geometrias;
liberar materiais;
liberar texturas;
liberar render targets;
liberar buffers;
chamar renderer.dispose();
limpar caches locais específicos da sessão 3D;
retirar o canvas do DOM;
deixar uso de CPU próximo de zero;
não manter um solver duplicado em segundo plano.

Reabrir deve restaurar o estado de maneira previsível, sem acumular:

canvases;
Workers;
loops;
listeners;
renderers;
geometrias antigas;
referências retidas.

Crie um teste de abertura e fechamento repetido e monitore:

quantidade de Workers;
listeners;
canvases;
memória;
contextos WebGL ou WebGPU;
atividade de CPU após fechamento.
5. REFERÊNCIAS DE PRODUTO E O QUE EXTRAIR DE CADA UMA

Não copie interfaces ou código literalmente. Extraia princípios, fluxos e modelos mentais.

5.1 Audaces Moldes e Audaces Encaixe

Aproveitar:

precisão de CAD;
construção técnica de moldes;
medidas reais;
gradação;
margens de costura;
piques;
linhas internas;
preparação para produção;
padronização;
encaixe e aproveitamento de tecido;
separação clara entre criação do molde e planejamento de corte.

O Audaces combina modelagem digital com ferramentas de gradação e produção, enquanto o módulo de encaixe trata otimização de aproveitamento do tecido.

Aplicação no Moldeon:

priorizar exatidão geométrica;
introduzir estrutura para tabelas de tamanho;
modelar margem e linha de costura separadamente;
preparar exportação industrial;
criar fundação futura para encaixe de moldes no tecido;
nunca misturar encaixe de corte com a física do 3D.

Não implementar agora um encaixe industrial completo antes de estabilizar o editor e o 3D.

5.2 Molde.me

Aproveitar:

acesso pelo navegador;
fluxo utilizável em diferentes dispositivos;
digitalização assistida de moldes físicos;
planejamento de camadas;
produtividade;
cálculo de consumo;
custos;
integração futura com plotters e máquinas.

O Molde.me apresenta digitalização por imagem, operação em nuvem, planejamento de corte e relatórios de custo e produtividade.

Aplicação no Moldeon:

manter o produto instalável como PWA;
criar formato de projeto portátil;
preparar sincronização em nuvem;
manter arquitetura adequada a celular;
futuramente permitir fotografar um molde de papel com um marcador de escala;
corrigir perspectiva;
detectar o contorno;
permitir correção manual;
calcular tecido e custo.

Não vender futura digitalização como “IA perfeita”. Ela deverá exigir:

referência de escala;
boa iluminação;
correção de perspectiva;
confirmação manual;
validação das medidas.
5.3 CLO 3D

Aproveitar:

fluxo molde → costura → arranjo → simulação → diagnóstico;
pontos e volumes de arranjo ligados ao corpo;
costuras com direção;
costuras 1 e M;
comparação de comprimentos;
simulação progressiva;
resolução de malha configurável;
mapa de tensão;
mapa de deformação;
pressão sobre o corpo;
propriedades de tecido;
ferramentas temporárias para estabilização.

Os Arrangement Points do CLO posicionam peças em regiões associadas ao avatar. O sistema de costura possui direção, comparação de comprimentos e modalidades para múltiplos segmentos.

A resolução da malha influencia diretamente desempenho e fidelidade, e o CLO oferece mapas técnicos de tensão, deformação e ajuste.

Aplicação no Moldeon:

usar âncoras corporais internas;
tratar costuras como entidades editáveis;
usar piques e papéis semânticos;
oferecer qualidade progressiva;
implementar mapas técnicos após a física básica;
permitir congelar temporariamente partes durante montagem;
permitir simular somente uma região durante diagnóstico.

Não reproduzir a complexidade visual do CLO. Crie um fluxo mais guiado.

5.4 Seamly2D e Valentina

Aproveitar:

modelagem paramétrica;
medidas pessoais;
medidas padronizadas;
fórmulas;
variáveis;
construção por dependências;
formato de documento versionado;
histórico de operações;
gradação;
peças geradas a partir de regras.

O esquema do Seamly2D representa versões, unidades, medidas, variáveis com fórmulas, pontos calculados, linhas, curvas, operações e dados de gradação.

Seamly2D e Valentina são referências importantes para moldes paramétricos baseados em medidas e fórmulas.

Aplicação no Moldeon:

criar grafo paramétrico;
diferenciar ponto livre de ponto calculado;
armazenar fórmulas;
atualizar dependentes;
detectar ciclos;
indicar medidas ausentes;
permitir tabela de medidas;
permitir moldes reutilizáveis;
separar construção geométrica de peça final.
5.5 Blender

Aproveitar:

separação entre dados, simulação, colisão, cache e renderização;
estruturas de aceleração espacial;
pipeline não destrutivo;
parâmetros físicos claros;
qualidade configurável;
ferramentas de depuração;
materiais e iluminação eficientes;
atualização incremental.

O código do Blender mantém módulos distintos para o motor de tecido e colisões, incluindo atualização de BVHs para reduzir o custo de consultas espaciais.

A documentação de tecido do Blender separa tensão, compressão, cisalhamento, flexão, amortecimento, costura e colisão.

Aplicação no Moldeon:

solver separado do renderer;
cache e invalidação explícitos;
broad phase espacial;
narrow phase de colisão;
parâmetros físicos separados;
perfis de qualidade;
ferramentas técnicas opcionais;
atualização da malha sem reconstruir a cena inteira.

Não copie código do Blender.

O Moldeon usa licença MIT, enquanto arquivos do Blender declaram GPL-2.0-or-later.

Use Blender e Seamly2D como referências de arquitetura e comportamento. Não transplante implementações incompatíveis com a licença do Moldeon.

5.6 Pacdora

Aproveitar:

entrada rápida no 3D;
troca simples de material;
mudança de cor;
câmera previsível;
iluminação agradável;
presets de apresentação;
exportação visual;
interface amigável para iniciantes.

Pacdora é orientado a personalização e apresentação 3D rápida, com configuração simplificada de materiais, cores e cenas.

Aplicação no Moldeon:

presets de câmera;
seleção simples de tecido;
boa aparência sem exigir configuração técnica;
controles de cor e textura fáceis;
modo de captura de imagem;
iluminação leve e consistente.

Não usar Pacdora como referência para CAD ou física.

5.7 FreeSewing

Considere FreeSewing como referência para:

padrões definidos por código;
medidas;
opções;
componentes reutilizáveis;
fórmulas;
documentação de padrões;
arquitetura paramétrica em JavaScript.

FreeSewing é uma biblioteca aberta de padrões paramétricos e componentes reutilizáveis.

Avalie:

reutilização conceitual;
compatibilidade de medidas;
compatibilidade de licença;
diferença entre o modelo de dados do FreeSewing e o Moldeon.

Não importe grandes dependências sem benchmark e justificativa.

5.8 GarmentCode

Considere GarmentCode como referência para:

peças hierárquicas;
componentes intercambiáveis;
conectores semânticos;
painéis;
interfaces entre componentes;
mangas;
golas;
cós;
composição modular de roupas.

GarmentCode apresenta um modelo modular com painéis, componentes e interfaces semânticas para construir roupas programaticamente.

Use esse princípio para resolver mangas e componentes, sem copiar código indiscriminadamente.

6. REGRAS DE LICENÇA E DEPENDÊNCIAS

Antes de adicionar qualquer biblioteca:

Verifique a licença.
Registre a licença em docs/DEPENDENCY_AUDIT.md.
Prefira:
MIT;
Apache-2.0;
BSD-2-Clause;
BSD-3-Clause;
ISC;
domínio público claramente documentado.
Não copie código GPL para o núcleo MIT do Moldeon.
Não copie trechos do Blender ou Seamly2D.
Não reproduza algoritmos proprietários obtidos por engenharia reversa.
Implemente algoritmos a partir de artigos, especificações públicas e referências permissivas.
Registre:
nome;
versão;
finalidade;
licença;
tamanho;
impacto no bundle;
alternativa considerada;
justificativa.

Toda dependência de geometria ou física deve passar por:

teste de correção;
benchmark;
teste em mobile;
análise de bundle;
análise de manutenção.
7. RECLAMAÇÕES DO USUÁRIO QUE DEVEM SER CORRIGIDAS

Não descarte nenhuma destas reclamações.

7.1 Não é possível criar novos pontos

Investigue por que a ferramenta de ponto parou de funcionar.

Corrija:

inserção de ponto em segmento;
inserção em linha;
inserção em curva;
criação de ponto durante desenho;
hit testing;
transformação entre tela, bancada e milímetros;
captura de ponteiro;
conflito com seleção;
conflito com pan;
conflito com zoom;
conflito com drag;
undo e redo;
touch.

Ao inserir ponto em curva Bézier:

preserve a curva visual;
divida matematicamente a curva;
use De Casteljau;
preserve continuidade;
crie dois novos segmentos equivalentes;
preserve papéis semânticos;
preserve costuras ou atualize seus intervalos;
preserve referências ao contorno.

Teste com:

zoom diferente de 100%;
peça rotacionada na bancada;
celular;
mouse;
caneta;
curva;
reta;
segmentos muito pequenos;
undo;
redo.
7.2 A ferramenta de corte é ruim e só corta reto

Substitua o corte simples por um sistema de linhas internas manipuláveis.

Uma linha interna deve poder ter:

múltiplos nós;
segmentos retos;
segmentos curvos;
alças Bézier;
snapping opcional;
edição posterior;
confirmação;
cancelamento;
visualização de interseções;
indicação da região que será dividida.

A mesma entidade deve poder ser convertida em:

corte;
corte e manter costurado;
pence;
dobra;
linha de referência;
bolso;
pesponto;
marcação.

Fluxo desejado:

Usuário cria uma linha interna.
Usuário move pontos e alças.
Sistema mostra interseções.
Usuário escolhe a operação.
Sistema mostra prévia.
Usuário confirma.
Operação vira uma transação reversível.

O corte deve:

aceitar linhas curvas;
aceitar múltiplos segmentos;
lidar com curvas do contorno;
criar peças válidas;
preservar unidades;
preservar papéis semânticos;
preservar fio;
preservar anotações pertinentes;
atualizar ou invalidar costuras afetadas;
atualizar a triangulação;
ser totalmente reversível.

Quando o caminho:

não atravessar a peça;
tocar tangencialmente;
cruzar mais vezes do que o suportado;
produzir uma região degenerada;
passar por uma pence;
cortar uma costura;

mostre diagnóstico claro em vez de falhar silenciosamente.

As operações geométricas robustas devem preferencialmente ficar no núcleo Rust/WASM.

7.3 O sistema não entende mangas

Mangas são prioridade crítica.

Não resolva mangas com:

offset visual;
rotação fixa;
nome da peça;
posição hardcoded;
projeção cilíndrica;
uma curva simétrica genérica;
tentativa de encaixar toda cabeça da manga em qualquer cava;
heurística baseada em “sleeve” no nome.

Implemente o fluxo guiado detalhado na seção de mangas deste documento.

7.4 A calça mostra dois moldes e quatro painéis

O sistema precisa explicar corretamente a diferença entre:

definição do molde;
quantidade de corte;
instância física.

Uma calça convencional pode ter:

Definições editáveis na bancada:
1. Frente
2. Costas

Quantidade de corte:
Frente: cortar 2x
Costas: cortar 2x

Instâncias físicas:
1. Frente esquerda
2. Frente direita
3. Costas esquerda
4. Costas direita

Não reduza a simulação a dois painéis.

O erro é a ausência de explicação, identificação, mapeamento e montagem correta.

Mostre na interface:

Frente da calça
Cortar 2x
Gera:
• Frente esquerda
• Frente direita

E:

Costas da calça
Cortar 2x
Gera:
• Costas esquerda
• Costas direita

Cada painel 3D deve guardar:

sourcePatternId;
instanceId;
copyIndex;
lado corporal;
espelhamento;
material;
transform de arranjo;
costuras resolvidas;
estado físico.

Inclua ferramenta técnica para selecionar uma região da roupa no 3D e destacar o molde de origem na bancada, sem ocultar o manequim.

7.5 Todos os moldes-base estão errados

Não ajuste apenas visualmente.

Pesquise modelagem real e reconstrua os moldes-base com:

fórmulas documentadas;
medidas suficientes;
folgas explícitas;
validade conhecida;
testes;
referências;
versões.

A calça é a maior prioridade.

7.6 Não é possível fechar o 3D sem manter o peso

Implemente fechamento completo e liberação de recursos, conforme seção 4.

7.7 Não é possível desfazer ou remover costuras adequadamente

Costura deve ser uma entidade de primeira classe.

Permita:

criar;
editar;
inverter direção;
desativar;
reativar;
remover;
renomear;
trocar tratamento;
alterar intervalos;
desfazer;
refazer;
selecionar pela bancada;
selecionar pela lista;
destacar os dois lados.

Ações de costura devem entrar no mesmo sistema transacional de undo e redo.

7.8 Campos de medidas ocupam espaço demais

Redesenhe o painel de medidas.

Desktop:

painel lateral redimensionável;
grupos recolhíveis;
resumo compacto;
busca;
campos densos, porém legíveis;
unidade ao lado;
valores derivados identificados;
favoritos ou medidas principais no topo.

Mobile:

bottom sheet;
seções;
busca;
teclado numérico;
botões grandes;
não bloquear toda a bancada;
salvar ao confirmar ou ao sair de maneira segura.

Agrupe medidas em:

gerais;
torso;
ombros e pescoço;
braços;
cintura e quadril;
pernas;
medidas específicas da peça;
medidas derivadas.
7.9 Menu de três pontos não fecha

Todo popover deve fechar ao:

clicar novamente no botão;
clicar fora;
escolher uma ação;
pressionar Escape;
trocar de peça;
trocar de ferramenta;
fechar o painel;
mudar de modo.

Implemente:

foco correto;
retorno de foco;
aria-expanded;
aria-controls;
navegação por teclado;
posicionamento que não saia da viewport;
prevenção de propagação somente onde necessário.

Não crie um listener global novo por item.

7.10 Seleção não é limpa ao clicar fora

Ao clicar em área vazia:

limpe a seleção;
feche menus contextuais apropriados;
preserve a ferramenta ativa;
não crie ponto acidental;
não desative pan;
não quebre pinch zoom;
não quebre seleção por caixa;
não quebre seleção múltipla com Shift;
não limpe ao clicar em toolbar ou painel relacionado.

Defina claramente:

clique em vazio;
clique em painel;
clique em item selecionado;
drag iniciado em vazio;
drag de pan;
drag de seleção;
toque;
gesto de pinça.
7.11 A simulação atual é falsa e ruim

Remova qualquer alegação de tecido físico enquanto o sistema estiver apenas aplicando ondulação ou projeção geométrica.

Implemente uma simulação física real mínima, seguindo as seções de física deste documento.

8. MODELO DE DADOS ALVO

Crie um formato de documento versionado, com migração para projetos antigos.

Sugestão conceitual:

interface PatternDocumentV3 {
  formatVersion: 3;
  metadata: ProjectMetadata;
  units: "mm";
  measurements: MeasurementSet;
  variables: FormulaVariable[];
  constructionGraph: ConstructionGraph;
  patternDefinitions: PatternDefinition[];
  seamGroups: SeamGroup[];
  fabrics: FabricDefinition[];
  body: BodyDefinition;
  workspace: WorkspaceState;
  simulationSettings: SimulationSettings;
}
8.1 Definição do molde
interface PatternDefinition {
  id: string;
  name: string;
  sourceTemplateId?: string;
  sourceTemplateVersion?: string;

  construction: ConstructionGraphReference;
  productionContours: PatternContour[];

  internalLines: InternalLine[];
  darts: DartDefinition[];
  notches: Notch[];
  grainline: Grainline;
  seamAllowances: SeamAllowanceDefinition[];

  cutQuantity: number;
  cutOnFold: boolean;
  mirrorRule?: MirrorRule;
  fabricId: string;

  semanticRole: PatternRole;
  connectors: PatternConnector[];
}
8.2 Instância física
interface PanelInstance {
  id: string;
  sourcePatternId: string;
  copyIndex: number;

  bodySide: "left" | "right" | "center";
  surface: "front" | "back" | "side";
  mirrored: boolean;

  fabricId: string;
  arrangementAnchor: ArrangementAnchor;
  simulationEnabled: boolean;
}
8.3 Conector semântico
interface PatternConnector {
  id: string;
  role:
    | "front-armhole"
    | "back-armhole"
    | "sleeve-cap-front"
    | "sleeve-cap-back"
    | "shoulder"
    | "side-seam"
    | "underarm"
    | "neckline"
    | "waist"
    | "waistband"
    | "inseam"
    | "outseam"
    | "front-rise"
    | "back-rise"
    | "hem"
    | "custom";

  ranges: EdgeRange[];
  landmarks: ConnectorLandmark[];
  direction: "forward" | "reverse";
}
8.4 Grupo de costura
interface SeamGroup {
  id: string;
  name: string;

  first: EdgeRange[];
  second: EdgeRange[];

  direction: "same" | "opposite";
  treatment:
    | "standard"
    | "ease"
    | "gather"
    | "elastic"
    | "zipper"
    | "intentional-mismatch";

  distribution:
    | "uniform"
    | "proportional"
    | "center-biased"
    | "custom";

  targetRatio: number;
  slackMm: number;
  active: boolean;
}
8.5 Malha de simulação
interface SimulationMesh {
  panelInstanceId: string;

  positions: Float32Array;
  previousPositions: Float32Array;
  velocities: Float32Array;
  inverseMasses: Float32Array;

  restPositions2D: Float32Array;
  triangles: Uint32Array;

  boundaryVertices: Uint32Array;
  sourceMappings: VertexSourceMapping[];
  edgeSamples: EdgeSampleMap[];
  materialCoordinates: Float32Array;
}

Cada vértice precisa conhecer sua origem no molde por:

ponto original;
segmento original;
parâmetro t;
interpolação;
coordenada 2D de repouso.

A malha 3D não pode perder a relação com a bancada.

9. GRAFO PARAMÉTRICO DE CONSTRUÇÃO

Inspire-se nos princípios de Seamly2D, Valentina e FreeSewing.

Implemente gradualmente um grafo de construção.

Tipos de entidade:

medida corporal;
variável;
fórmula;
ponto livre;
ponto por coordenada;
ponto a distância e ângulo;
ponto médio;
projeção;
interseção linha-linha;
interseção linha-círculo;
interseção círculo-círculo;
ponto sobre curva;
reta;
arco;
curva;
spline;
operação de transformação;
pence;
espelhamento;
contorno de produção.

Requisitos do motor de fórmulas:

determinístico;
consciente de unidades;
sem eval;
AST segura;
precedência explícita;
funções documentadas;
detecção de ciclo;
erro de variável ausente;
erro de divisão por zero;
erro de domínio;
cache de dependências;
recalcular apenas dependentes;
serialização estável;
migração de fórmulas;
testes.

Exemplo:

largura_quadril = quadril / 4 + folga_quadril / 4
profundidade_cava = busto / 6 + ajuste_cava
comprimento_manga = medida_braco - ajuste_punho

A interface deve mostrar:

valor;
fórmula;
origem;
se é medida direta;
se é derivada;
dependências;
erro de cálculo;
unidade.

Não obrigue iniciantes a editar fórmulas para usar um molde-base. O modo avançado pode revelar essa camada.

10. MEDIDAS CORPORAIS

O conjunto atual é insuficiente para moldes-base confiáveis.

Amplie o modelo, sem exigir todas as medidas para todos os casos.

Medidas gerais:

altura;
busto ou tórax;
cintura;
quadril;
largura de ombros;
comprimento de torso;
comprimento de braço;
entrepernas.

Medidas adicionais recomendadas:

contorno do pescoço;
largura do pescoço;
inclinação do ombro;
comprimento do ombro;
altura do busto;
distância entre bustos;
alto busto;
comprimento frontal de cintura;
comprimento traseiro de cintura;
profundidade de cava;
largura das costas;
largura frontal;
contorno de bíceps;
contorno de cotovelo;
contorno de punho;
comprimento até cotovelo;
altura de quadril;
altura de gancho sentada;
profundidade de gancho;
contorno de coxa;
contorno de joelho;
contorno de panturrilha;
contorno de tornozelo;
altura de joelho;
comprimento lateral da calça;
comprimento interno;
profundidade do assento;
queda de cintura;
circunferência de cabeça quando necessária;
medidas específicas de peças.

Regras:

Medidas estimadas devem ser claramente marcadas.
Toda estimativa deve poder ser substituída.
Fórmulas de estimativa devem ter versão.
Não invente precisão inexistente.
Valide combinações corporais plausíveis sem bloquear corpos fora de padrões comerciais.
Mostre alertas, não julgamentos.
Não use apenas “feminino” e “masculino” para decidir fórmulas. O tipo corporal pode selecionar um conjunto inicial, mas as medidas reais devem ser a fonte de verdade.
11. MOLDES-BASE CORRETOS

A biblioteca atual deve ser considerada experimental até passar por validação geométrica e de modelagem.

Não marque um template como pronto apenas porque:

triangula;
compila;
possui papéis semânticos;
aparece no 3D;
não gera exceção.

Cada template deve ter:

versão;
sistema de modelagem identificado;
fórmulas;
medidas exigidas;
medidas estimadas;
folgas;
limites conhecidos;
casos de teste;
desenhos técnicos;
landmarks;
costuras esperadas;
tolerâncias;
revisão manual.
11.1 Corpo básico, camiseta e blusa

Corrija:

diferença entre frente e costas;
decote frontal;
decote traseiro;
inclinação do ombro;
largura de ombro;
profundidade de cava;
curva da cava frontal;
curva da cava traseira;
linha lateral;
folga de busto;
folga de cintura;
folga de quadril;
comprimento;
fio;
piques;
relação com manga.

Não gere frente e costas alterando somente profundidade de decote.

A cava frontal e a traseira devem ser geometricamente diferentes.

11.2 Manga

Não use uma cabeça perfeitamente simétrica.

A manga deve ser gerada a partir das cavas do corpo correspondente.

Ela precisa ter:

cabeça frontal;
cabeça traseira;
ápice;
pique frontal;
dois piques traseiros;
marca de ombro;
axila frontal;
axila traseira;
linha de bíceps;
linha de cotovelo quando pertinente;
punho;
fio;
costura inferior;
folga de cabeça;
rotação adequada.
11.3 Saia reta e minissaia

Corrija:

diferença de frente e costas;
distribuição da cintura;
linha de quadril;
pence frontal;
pence traseira;
curva lateral;
centro frente;
centro costas;
folga;
equilíbrio da barra;
abertura quando necessária;
fio;
cós como componente opcional.

Pences devem afetar a topologia e a forma montada, não ser apenas desenhos sobre o molde.

11.4 Calça

A calça atual possui gancho simplificado e deve ser reconstruída.

A nova base precisa considerar:

frente e costas diferentes;
altura de gancho;
profundidade de gancho;
extensão frontal;
extensão traseira;
curva frontal;
curva traseira;
inclinação da cintura;
cintura traseira elevada quando a fórmula exigir;
pence traseira;
pence frontal opcional;
linha de quadril;
linha de gancho;
linha de joelho;
linha de barra;
centro da perna;
fio;
contorno de coxa;
contorno de joelho;
contorno de panturrilha;
contorno de barra;
equilíbrio da entreperna;
equilíbrio da lateral;
piques de joelho;
piques de quadril;
conexão correta do gancho;
formação de duas pernas tubulares;
união correta da curva de gancho.

A montagem física da calça deve ocorrer assim:

Instanciar frente esquerda.
Instanciar frente direita.
Instanciar costas esquerda.
Instanciar costas direita.
Costurar lateral esquerda.
Costurar entreperna esquerda.
Fechar perna esquerda.
Costurar lateral direita.
Costurar entreperna direita.
Fechar perna direita.
Conectar gancho frontal.
Conectar gancho traseiro.
Conectar a região inferior do gancho de maneira contínua.
Manter cintura e barras abertas.
Posicionar as pernas ao redor das pernas corretas do manequim.
Simular sem fundir as duas pernas.

Crie testes específicos para impedir:

quatro painéis sobrepostos no mesmo lado;
duas pernas fundidas;
frente costurada com frente errada;
costas invertidas;
gancho torcido;
perna virada do avesso;
costura cruzando o corpo.
11.5 Jaqueta

Mantenha como experimental até possuir:

bloco de corpo próprio;
folga estrutural;
frente aberta;
transpasse;
vista;
gola ou decote definido;
ombro adequado;
cava própria;
manga compatível;
barra;
modelagem de costas;
eventual recorte;
forro como etapa futura.

Não derive uma jaqueta apenas aumentando a folga de uma camiseta.

12. FLUXO GUIADO PARA ADICIONAR MANGA

Colocar uma manga em uma bancada 2D é confuso. Não exija que o usuário entenda manualmente todos os segmentos antes de começar.

Crie a ação:

Adicionar manga

Ela deve estar disponível quando houver um corpo com:

cava frontal válida;
cava traseira válida;
ombro;
lateral;
medidas suficientes.
12.1 Assistente de manga

Fluxo sugerido:

Etapa 1: selecionar o corpo

O sistema identifica:

frente;
costas;
cava frontal;
cava traseira;
ponto do ombro;
axilas;
lado esquerdo e direito.

Quando houver ambiguidade, destaque os segmentos e peça confirmação visual.

Etapa 2: escolher tipo de manga

Opções iniciais:

curta básica;
longa básica;
três quartos;
manga capa;
ampla;
bufante simples;
sem manga.

Comece implementando curta e longa de forma robusta.

Etapa 3: configurar medidas

Mostrar:

comprimento;
bíceps;
punho;
altura da cabeça;
folga da cabeça;
folga de bíceps;
rotação;
comprimento até cotovelo.
Etapa 4: gerar a manga

Calcule comprimentos por arco:

comprimento_cava_frontal
comprimento_cava_traseira
comprimento_total_cava

Gere:

cabeça frontal;
cabeça traseira;
ápice;
piques;
costura inferior;
punho;
fio.
Etapa 5: mostrar compatibilidade

Exemplo:

Cava total: 472 mm
Cabeça da manga: 486 mm
Folga da cabeça: 14 mm
Distribuição: adequada

Quando incompatível:

A cabeça da manga possui 38 mm de excesso.
O limite configurado para este tecido é 18 mm.
Etapa 6: criar conectores e costuras

Crie automaticamente:

cabeça frontal da manga → cava frontal
cabeça traseira da manga → cava traseira
axila frontal → axila frontal
axila traseira → axila traseira
costura inferior esquerda → costura inferior direita

A costura inferior da manga deve fechar o tubo.

Etapa 7: criar instâncias

Uma definição de manga com cutQuantity: 2 gera:

manga esquerda;
manga direita.

A manga direita precisa ser espelhada e receber o lado corporal correto.

12.2 Interface 2D para manga

Não dependa da proximidade física das peças na bancada.

Use:

cores correspondentes;
etiquetas F e C;
linha visual temporária entre conectores;
destaque da cava;
destaque da cabeça da manga;
piques visíveis;
mini diagrama;
painel focado;
botão “Ver encaixe”;
zoom automático opcional.

A manga pode continuar como molde separado na bancada, mas a relação com o corpo deve ser visualmente explícita.

12.3 Física da manga

Para vestir:

Posicione a manga ao redor do braço correto.
Oriente o fio ao longo do braço.
Feche a costura inferior.
Conecte a cabeça à cava.
Use piques como landmarks.
Distribua folga principalmente na região superior.
Não distribua todo o excesso uniformemente até a axila.
Evite que a manga atravesse o torso.
Permita estabilizar o corpo antes de liberar a manga.
Teste braços em posição neutra.
13. LINHAS INTERNAS COMO ENTIDADE CENTRAL

Unifique ferramentas relacionadas.

interface InternalPath {
  id: string;
  pieceId: string;
  nodes: PathNode[];
  segments: PathSegment[];

  purpose:
    | "construction"
    | "cut"
    | "cut-and-sew"
    | "dart"
    | "fold"
    | "pocket"
    | "topstitch"
    | "gather"
    | "elastic"
    | "reference";
}

Uma linha deve poder mudar de finalidade sem ser redesenhada.

Requisitos:

edição de nós;
curvas;
snapping;
comprimento;
distância a bordas;
duplicação;
espelhamento;
transformação;
bloqueio;
ocultação;
seleção;
exclusão;
undo e redo.
14. PENCES REAIS

Pence não deve ser apenas duas linhas visuais.

Implemente:

pernas da pence;
ápice;
linha central;
largura;
comprimento;
ângulo;
fechamento;
abertura equivalente;
consumo de comprimento;
alteração do contorno;
triangulação compatível;
simulação fechada;
transferência futura.

Ao fechar uma pence:

aproxime as pernas;
preserve o comprimento apropriado;
altere a topologia ou aplique restrições equivalentes;
atualize a forma 3D;
não deixe um buraco aberto;
não sobreponha triângulos de maneira instável.

Crie testes com pences de saia e corpo.

15. SISTEMA DE COSTURAS

A estrutura atual já possui intervalos de borda, direção e tratamentos. Preserve e evolua essa fundação.

A topologia atual também mantém caminhos de vértices por borda e suporte inicial a intervalos parciais.

O construtor atual já caminha em direção a pontos interpolados, mas o solver ainda reduz essas referências a vértices representativos. Elimine essa aproximação no solver final.

15.1 Costuras suportadas

Suportar:

borda para borda;
intervalo para intervalo;
uma borda para múltiplas;
múltiplas para uma;
múltiplas para múltiplas;
costura própria;
tubo;
manga;
perna;
cós;
pence;
franzido;
elástico;
diferenças intencionais de comprimento.
15.2 Correspondência por comprimento de arco

Quando lados têm quantidades diferentes de vértices:

não pareie por índice;
não duplique apenas os últimos vértices;
não use o vértice mais próximo como solução definitiva.

Use parametrização por comprimento de arco.

Cada amostra de costura pode referenciar:

vértice;
interpolação entre dois vértices;
coordenada baricêntrica;
parâmetro no caminho da borda.

As restrições devem atuar sobre os pesos interpolados reais.

15.3 Diagnóstico

Antes de confirmar uma costura, mostrar:

nome dos lados;
comprimento A;
comprimento B;
diferença;
percentual;
direção;
tratamento;
tolerância;
piques;
prévia.

Exemplo:

Cava frontal: 231 mm
Manga frontal: 237 mm
Diferença: +6 mm
Tratamento: distribuir folga
15.4 Edição

Uma lista de costuras deve permitir:

localizar;
destacar;
editar;
inverter;
desativar;
excluir;
desfazer;
renomear;
filtrar por peça;
indicar erro.
16. TOPOLOGIA 2D E TRIANGULAÇÃO

O 2D é a fonte de verdade.

A topologia de simulação deve preservar:

contorno externo;
contornos internos;
buracos;
nós;
segmentos;
curvas;
linhas internas relevantes;
pences;
bordas semânticas;
piques;
fio;
mapeamento para a origem.

A triangulação atual amostra curvas e mantém relação entre bordas e vértices. Evolua essa base em vez de descartá-la sem necessidade.

Avalie, com licença e benchmark:

triangulação restrita;
constrained Delaunay triangulation;
refinamento por tamanho de partícula;
predicados geométricos robustos;
operações booleanas robustas;
interseção de curvas.

Requisitos:

determinística;
sem triângulos invertidos;
sem áreas quase zero;
sem pontos duplicados;
sem bordas perdidas;
respeitar linhas de restrição;
permitir densidade variável;
manter mapeamento 2D;
resultados equivalentes em WASM e fallback quando ambos existirem.

Testes de propriedade:

área triangulada próxima da área do contorno;
soma de triângulos consistente;
orientação consistente;
toda borda externa representada;
nenhum índice inválido;
nenhuma coordenada não finita;
nenhuma autointerseção silenciosa.
17. AVATAR HUMANO

O avatar deve ser um manequim humano visual e um corpo de colisão confiável.

17.1 Separar três representações

Use representações distintas:

Avatar visual

Responsável por:

aparência;
proporções;
material;
iluminação;
silhueta;
experiência visual.
Avatar paramétrico

Responsável por:

medidas;
morph targets;
escalas regionais;
landmarks corporais;
regiões;
pose.
Avatar de colisão

Responsável por:

colisão rápida;
cápsulas;
elipsoides;
SDF;
BVH;
espessura;
superfícies simplificadas.

Não use necessariamente a malha visual de alta resolução para cada consulta de colisão.

17.2 Medidas e forma

O avatar deve responder a:

altura;
busto ou tórax;
cintura;
quadril;
ombros;
torso;
braços;
bíceps;
pernas;
coxa;
panturrilha;
entrepernas.

Evite deformações grotescas causadas por escala uniforme de regiões.

Avalie uma malha base com:

morph targets;
landmarks;
LODs;
topologia consistente;
licença permissiva;
tamanho reduzido.

glTF suporta morph targets e pode ser usado para variações de forma, mas as medidas reais e proxies de colisão devem continuar sendo a fonte autoritativa do encaixe.

17.3 Pose

Comece com pose neutra adequada à prova de roupa:

braços levemente afastados;
pernas separadas;
postura estável;
mãos longe do quadril;
sem interpenetrações iniciais.

Pose futura pode incluir:

braços levantados;
sentado;
caminhada;
flexão.

Não bloqueie a primeira versão física por animação avançada.

17.4 Regiões e âncoras

Defina anchors:

torso frontal;
torso traseiro;
ombro esquerdo;
ombro direito;
braço esquerdo;
braço direito;
cintura frontal;
cintura traseira;
quadril frontal;
quadril traseiro;
perna esquerda;
perna direita;
pescoço;
cabeça.

Cada anchor deve fornecer:

transform;
normal externa;
eixo principal;
superfície;
margem inicial;
lado corporal;
região de colisão.
18. MONTAGEM SOBRE O AVATAR

Substitua o cilindro por arranjo semântico no corpo.

Fluxo interno:

Resolver definições de molde.
Expandir quantidades de corte em instâncias físicas.
Resolver espelhamentos.
Resolver conectores.
Resolver costuras.
Validar componentes.
Criar malhas.
Posicionar painéis nos anchors corporais.
Afastar ligeiramente da superfície.
Orientar face externa.
Fechar tubos locais quando apropriado.
Ativar costuras gradualmente.
Ativar colisão.
Estabilizar.
Exibir a roupa vestida.

Não use:

nomes de templates;
índices fixos;
coordenadas específicas para cada peça;
offsets mágicos;
rotação por nome;
comportamento especial escondido para camiseta ou calça.

Templates podem fornecer metadados semânticos explícitos. O motor deve operar sobre os metadados, não sobre o nome do template.

19. SIMULAÇÃO FÍSICA XPBD REAL

Use XPBD como referência física inicial. O XPBD reduz a dependência da rigidez em relação ao passo de tempo e ao número de iterações por meio de compliance e multiplicadores de restrição.

O projeto PositionBasedDynamics é uma referência permissiva para restrições XPBD, flexão, contatos e técnicas de organização do solver.

Não integre uma biblioteca nativa pesada sem verificar portabilidade para navegador. Use artigos e implementações permissivas como base algorítmica.

19.1 Estado mínimo
interface ClothState {
  positions: Float32Array;
  previousPositions: Float32Array;
  predictedPositions: Float32Array;
  velocities: Float32Array;
  inverseMasses: Float32Array;

  triangles: Uint32Array;
  restPositions2D: Float32Array;

  stretchConstraints: StretchConstraintBuffer;
  shearConstraints: ShearConstraintBuffer;
  bendConstraints: BendConstraintBuffer;
  seamConstraints: SeamConstraintBuffer;

  collisionData: CollisionData;
}
19.2 Loop

Implemente passo semi-fixo:

1. Acumular tempo.
2. Limitar delta máximo.
3. Executar substeps fixos.
4. Aplicar forças.
5. Aplicar amortecimento.
6. Prever posições.
7. Resolver stretch.
8. Resolver shear.
9. Resolver bend.
10. Resolver costuras.
11. Resolver colisão com avatar.
12. Resolver autocolisão, quando habilitada.
13. Atualizar velocidades.
14. Aplicar atrito.
15. Atualizar posições finais.
16. Atualizar normais.
17. Publicar buffer para renderização.

Não atrele a estabilidade à taxa de renderização.

19.3 Forças

Implementar:

gravidade;
amortecimento;
força externa opcional de teste;
manipulação interativa;
pinos temporários;
resistência simplificada ao ar futuramente.
19.4 Stretch anisotrópico

O tecido não deve ser isotrópico por padrão.

Use o fio do molde para definir:

warp;
weft;
bias.

Propriedades:

rigidez no urdume;
rigidez na trama;
elasticidade no viés;
limite de alongamento;
compressão.

Mapeie as coordenadas 2D de repouso para calcular direções materiais.

19.5 Shear

Implemente resistência a cisalhamento separada.

Ela deve controlar deformação diagonal e não ser confundida com alongamento das arestas trianguladas.

19.6 Bend

Implemente flexão por:

ângulo diedral;
modelo isométrico;
outro modelo XPBD validado.

A rigidez de flexão deve influenciar:

jeans;
couro sintético;
algodão;
malha;
tecidos leves.
19.7 Costuras físicas

Costuras devem:

aproximar pontos interpolados;
respeitar direção;
respeitar intervalos;
respeitar folga;
permitir diferença de comprimento;
ativar gradualmente para evitar explosão;
funcionar entre painéis;
funcionar na mesma peça;
formar tubos;
não depender de vértices representativos.
19.8 Pences

Converter pences fechadas em:

topologia fechada;
restrições correspondentes;
costuras próprias adequadas.
19.9 Estabilidade

Adicionar:

detecção de NaN;
detecção de infinito;
limite de velocidade;
limite de correção por iteração;
reset seguro;
rollback para estado estável;
indicador de instabilidade;
log técnico opcional;
contagem de restrições inválidas.

Nunca continue publicando uma malha corrompida.

20. COLISÃO COM O CORPO

Implemente em etapas.

Etapa 1: proxies analíticos

Use:

cápsulas para braços e pernas;
elipsoides para torso e quadril;
esfera ou cápsula para cabeça;
cilindro ou cápsula para pescoço.

Vantagens:

rápidas;
estáveis;
adequadas ao primeiro solver;
fáceis de depurar.
Etapa 2: colisão refinada

Depois, adicione:

malha simplificada do avatar;
BVH;
ponto-triângulo;
segmento-triângulo;
edge-edge quando necessário;
normal consistente;
espessura;
atrito.

O Blender usa BVHs para acelerar consultas de colisão e atualizar estruturas conforme os objetos se movem. Use esse princípio, sem copiar código.

Avalie three-mesh-bvh, que possui licença permissiva, para:

picking;
consulta na malha do avatar;
raycast;
closest point;
broad phase.

Geometrias deformadas exigem estratégia de refit ou reconstrução. Faça benchmark antes de adotar.

20.1 Espessura

Separe:

espessura visual;
espessura de colisão;
distância mínima de autocolisão.

Não dependa somente de DoubleSide.

20.2 Atrito

O atrito deve depender de:

tecido;
corpo;
acabamento;
qualidade.

Implemente inicialmente um modelo estável e simples.

20.3 Colisão contínua

Para a primeira versão:

use substeps;
limite deslocamento;
evite tunneling evidente.

Colisão contínua completa pode vir depois.

21. AUTOCOLISÃO

Autocolisão é importante, mas não deve bloquear o primeiro resultado funcional.

Ordem:

Colisão estável com corpo.
Costuras estáveis.
Flexão.
Atrito.
Autocolisão básica.
Otimização.
Autocolisão avançada.

Implemente autocolisão com:

spatial hash;
grid uniforme;
BVH dinâmica;
outra broad phase medida.

Evite comparação O(n²).

Filtros:

ignorar triângulos adjacentes;
ignorar pares estruturalmente próximos;
separar regiões;
limitar pela qualidade;
desativar em dispositivos fracos;
permitir ativação manual.

No celular, autocolisão pode ser:

reduzida;
realizada em menor frequência;
limitada a regiões;
desativada no modo Rascunho.
22. TECIDOS

Um tecido deve possuir parâmetros físicos reais, não apenas um nome que altera ondulação visual.

interface FabricPhysics {
  densityKgM2: number;
  thicknessMm: number;

  warpStretchCompliance: number;
  weftStretchCompliance: number;
  biasStretchCompliance: number;

  shearCompliance: number;
  bendComplianceWarp: number;
  bendComplianceWeft: number;

  damping: number;
  friction: number;
  collisionThicknessMm: number;
}

Presets iniciais:

tecido leve;
algodão plano;
malha;
jeans;
couro sintético.

Cada preset deve ter:

descrição;
parâmetros;
intervalo;
fonte ou justificativa;
teste visual;
comparação.

Não chame os valores de fisicamente calibrados se forem apenas aproximações.

Use a interface:

“Mais rígido”;
“Mais elástico”;
“Mais pesado”;
“Mais escorregadio”.

Mantenha modo avançado com números técnicos.

22.1 Retalhos e upcycling

Preserve o conceito já existente de:

múltiplos tecidos;
dimensões disponíveis;
atribuição por peça;
cor;
estoque.

Evolução futura:

múltiplos materiais dentro de uma peça;
patchwork;
costuras entre retalhos;
aproveitamento de tecido;
orientação do fio;
rotação permitida;
custo.

Não deixe esse roadmap atrasar a física básica.

23. QUALIDADE PROGRESSIVA

Use densidade de malha e solver adaptativos.

Presets sugeridos:

Rascunho
partícula aproximada: 20 a 30 mm;
poucas iterações;
poucos substeps;
proxies simples;
sem autocolisão;
mobile padrão.
Normal
partícula aproximada: 10 a 18 mm;
equilíbrio entre qualidade e custo;
colisão corporal ativa;
autocolisão opcional.
Prova
partícula aproximada: 5 a 10 mm;
mais iterações;
mais substeps;
melhor colisão;
mapas técnicos.
Alta qualidade
partícula aproximada: 3 a 5 mm;
desktop;
ativação explícita;
limite de partículas;
aviso de custo.

O conceito de distância de partícula é usado no CLO para controlar resolução e custo da simulação.

Ao trocar a qualidade:

remalhe;
preserve o molde;
preserve costuras;
preserve landmarks;
preserve o mapeamento das bordas;
transfira a posição anterior quando seguro;
ou reinicie de forma previsível.
24. WORKER, BUFFERS E CONCORRÊNCIA

O Worker atual é apenas uma demonstração de uma restrição. Substitua por um protocolo de simulação real.

Sugestão:

type SimulationRequest =
  | InitializeSimulation
  | UpdatePanelGeometry
  | UpdateSeams
  | UpdateFabric
  | UpdateBody
  | StartSimulation
  | PauseSimulation
  | StepSimulation
  | ResetSimulation
  | DisposeSimulation;

type SimulationResponse =
  | SimulationReady
  | SimulationFrame
  | SimulationStats
  | SimulationWarning
  | SimulationError
  | SimulationDisposed;
24.1 Estratégia de buffers

Primeira opção:

ArrayBuffer transferível;
double ou triple buffering;
buffers reutilizáveis;
evitar alocação por frame.

Progressive enhancement:

SharedArrayBuffer;
índices atômicos;
triple buffer;
somente quando crossOriginIsolated.

SharedArrayBuffer exige isolamento por COOP e COEP no navegador. Mantenha fallback por transferência.

Não serialize posições em JSON.

24.2 Renderização em Worker

OffscreenCanvas pode mover parte da renderização para um Worker em navegadores compatíveis.

Não faça essa migração inicialmente sem benchmark.

Prioridade:

Física fora da main thread.
Editor fluido.
Renderer sob demanda.
Medir gargalos.
Considerar OffscreenCanvas apenas se necessário.
25. WEBGPU, WEBGL 2 E WASM
25.1 WebGPU

Three.js possui WebGPURenderer, TSL e recursos de compute, mas o caminho WebGPU ainda deve ser tratado como progressivo e não como requisito universal.

Regras:

não exigir WebGPU;
manter WebGL 2;
detectar capacidades;
não baixar chunk WebGPU sem necessidade;
não duplicar toda a aplicação;
manter contrato único de solver;
medir ganho real;
HTTPS obrigatório para o caminho WebGPU;
mensagens de fallback claras.
25.2 WebGPU Compute futuro

Após o solver CPU estar correto:

portar kernels caros;
manter testes comparando CPU e GPU;
tolerância numérica explícita;
mesma topologia;
mesmos parâmetros;
fallback automático;
não alterar o produto visualmente ao trocar backend.

Candidatos para GPU:

stretch;
shear;
bend;
colisões;
broad phase;
normais.

Não comece pela GPU antes de existir uma referência correta.

25.3 Rust/WASM

Use Rust/WASM para:

operações geométricas robustas;
interseções;
cortes;
offsets;
triangulação;
fórmulas críticas;
preparação de topologia;
eventualmente solver CPU, após benchmark.

WebAssembly com SIMD pode acelerar operações numéricas, mas threads na web possuem restrições de isolamento e integração. Trate isso como otimização medida.

Não atravesse a fronteira JS/WASM milhares de vezes por frame.

Prefira:

buffers grandes;
funções em lote;
memória linear;
poucas chamadas;
views tipadas;
ownership documentado.
26. 3D FIEL À BANCADA

Este é um requisito central.

Qualquer mudança no 2D deve refletir no 3D.

26.1 Fonte de verdade

As coordenadas 2D de repouso são imutáveis durante a simulação.

A física altera:

posição 3D;
velocidade;
deformação.

Ela não altera silenciosamente:

molde original;
comprimento original;
linha do fio;
curvas;
medidas.
26.2 Mapeamento

Cada vértice 3D deve mapear para:

peça;
instância;
triângulo;
posição de repouso;
segmento de origem;
parâmetro;
material.
26.3 Invalidação incremental

Ao mover um ponto:

recalcular somente a peça afetada;
revalidar costuras tocadas;
remalhar somente a instância correspondente;
reconstruir restrições afetadas;
preservar câmera;
preservar avatar;
preservar materiais;
preservar outras peças;
reiniciar somente o componente físico necessário quando seguro.

Não recrie toda a aplicação para cada pixel de movimento.

Durante o arraste:

usar prévia de baixa resolução;
limitar atualização por frame;
manter o 2D instantâneo;
atualizar o 3D com debounce curto ou frame budget;
ao soltar, realizar atualização completa.
26.4 Diagnóstico de fidelidade

Crie modo técnico opcional com:

wireframe sobre a roupa;
fio;
costuras;
triângulos;
nomes das instâncias;
mapa de deformação;
seleção 3D → destaque 2D;
seleção 2D → destaque 3D.

O manequim continua visível nesse modo.

27. INTERAÇÃO 3D

O 3D pode ser interativo quando isso ajudar.

Permitir:

orbitar;
zoom;
enquadrar peça;
enquadrar corpo inteiro;
frente;
costas;
lado esquerdo;
lado direito;
resetar câmera;
selecionar região da roupa;
destacar molde de origem;
pausar;
continuar;
resetar tecido;
ativar wireframe;
visualizar mapa técnico.

Opcional, após a base estável:

puxar o tecido com mouse ou toque;
criar pino temporário;
arrastar uma região;
soltar;
remover pinos;
simular somente seleção.

Ao puxar:

use raycast;
selecione partícula ou triângulo;
crie constraint temporária;
limite força;
não teletransporte a malha;
não altere o molde 2D.

No celular:

um dedo orbita ou seleciona conforme modo;
dois dedos fazem zoom;
controles não podem competir com scroll da página;
forneça botão explícito para “Manipular tecido”.
28. MAPAS TÉCNICOS

Depois da física básica:

28.1 Mapa de deformação

Calcule alongamento relativo por:

aresta;
triângulo;
direções warp e weft.

Mostrar escala:

baixa deformação;
adequada;
alta;
excessiva.

Não dependa apenas de cores. Inclua legenda e padrões acessíveis.

28.2 Mapa de pressão

Calcule pressão aproximada de contato com o avatar.

Mostrar:

áreas sem contato;
contato leve;
contato forte;
possível compressão.
28.3 Mapa de folga

Estime distância entre roupa e corpo.

28.4 Compatibilidade de costura

Mostrar:

diferença de comprimento;
concentração de folga;
tensão de costura;
costuras invertidas;
costuras abertas;
componentes desconectados.

Não chame os mapas de validação médica ou ergonômica.

29. INTERFACE E EXPERIÊNCIA

A interface final deve ser intuitiva e fácil de aprender.

29.1 Fluxo principal

Use etapas claras:

1. Modelar
2. Costurar
3. Provar

Ou:

Bancada
Montagem
Prova

O nome pode ser refinado após teste de usabilidade.

A bancada continua sendo o centro da aplicação.

O 3D pode aparecer:

em painel lateral;
em split view;
em tela cheia;
em aba no mobile.

Sempre com manequim vestido.

29.2 Barra de ferramentas

Ferramentas principais:

Selecionar;
Desenhar;
Ponto;
Curva;
Linha interna;
Recortar;
Pence;
Costurar;
Medir;
Mão.

Agrupe ferramentas avançadas em submenus, mas não esconda ações essenciais.

Cada ferramenta precisa de:

nome;
ícone;
tooltip;
atalho;
estado ativo;
instrução breve;
cancelamento com Escape.
29.3 Feedback contextual

Quando uma ferramenta estiver ativa, mostrar instrução próxima ao cursor ou em uma barra discreta:

Clique em uma borda para inserir um ponto.
Crie a linha de corte e pressione Enter para visualizar.
Selecione o primeiro lado da costura.

Não abra modais para cada microação.

29.4 Progressive disclosure

Modo inicial:

controles principais;
linguagem simples;
presets.

Modo avançado:

fórmulas;
compliance;
triangulação;
conectores;
propriedades físicas;
diagnóstico.
29.5 Mobile

Requisitos:

touch targets mínimos de aproximadamente 44 px;
nenhuma ação crítica baseada apenas em hover;
pinch zoom;
pan;
seleção;
bottom sheets;
painel 3D fechável;
controles compactos;
sem menus fora da tela;
teclado numérico para medidas;
safe areas;
orientação retrato e paisagem;
evitar canvas bloqueando scroll indevidamente.

No mobile, o fluxo pode usar abas:

Bancada | Peças | Medidas | Prova

Não tente exibir todos os painéis simultaneamente em uma tela estreita.

29.6 Acessibilidade

Implementar:

foco visível;
navegação por teclado;
labels;
estados ARIA;
contraste;
não depender somente de cor;
redução de movimento;
mensagens de erro associadas aos campos;
Escape previsível;
leitura de valores e unidades.
30. PERFORMANCE

Performance é requisito de produto, não etapa final.

30.1 Princípios
carregar Three.js sob demanda;
não carregar WebGPU sem suporte;
não rodar simulação quando o 3D estiver fechado;
não usar React para cada frame;
não reconstruir cena inteira;
usar estruturas SoA;
reutilizar buffers;
evitar garbage collection por frame;
limitar DPR;
usar LOD;
pausar aba invisível;
pausar em modo de economia;
reduzir qualidade automaticamente;
manter fallback.
30.2 Orçamento de performance

Crie benchmarks reais e registre valores.

Metas iniciais, ajustáveis após medição:

interação 2D percebida como imediata;
arraste com frame consistente;
nenhuma tarefa longa recorrente na main thread;
3D utilizável em celular intermediário;
modo Rascunho próximo de 20 a 30 FPS em mobile suportado;
modo Normal próximo de 30 FPS em desktop comum;
abertura inicial sem baixar o pacote 3D;
zero CPU relevante com 3D fechado;
evitar crescimento de memória após abrir e fechar repetidamente.

Não declare metas cumpridas sem ambiente e resultados registrados.

30.3 Adaptação automática

Detecte de forma conservadora:

memória aproximada;
número de cores;
mobile;
DPR;
backend;
tamanho da viewport;
tempo médio do solver;
tempo de render.

Ajuste:

densidade;
iterações;
substeps;
sombras;
autocolisão;
pós-processamento;
atualização de normais;
frequência de mapas técnicos.

Permita override manual.

30.4 Render sob demanda

Quando a simulação estiver pausada e nada mudar:

não renderizar continuamente;
renderizar ao mover câmera;
renderizar ao alterar tecido;
renderizar ao alterar o molde;
renderizar ao redimensionar.

Quando a física estiver ativa:

renderizar conforme disponibilidade;
não bloquear o solver;
descartar frames intermediários se necessário.
31. ARQUITETURA DE COMPONENTES E RESPONSABILIDADES

Quebre arquivos excessivamente grandes.

PatternCanvas.tsx não deve concentrar:

todas as ferramentas;
todo o hit testing;
toda a renderização;
todos os gestos;
toda a seleção;
todos os comandos;
todos os estados temporários.

Estrutura sugerida:

editor/
  canvas/
    PatternCanvas.tsx
    CanvasRenderer.ts
    CanvasCamera.ts
    CanvasCoordinates.ts
    CanvasHitTest.ts
    CanvasGestureController.ts

  tools/
    ToolController.ts
    SelectTool.ts
    PointTool.ts
    DrawTool.ts
    InternalLineTool.ts
    CutTool.ts
    DartTool.ts
    SeamTool.ts
    MeasureTool.ts
    HandTool.ts

  commands/
    Command.ts
    CommandHistory.ts
    MovePointCommand.ts
    SplitSegmentCommand.ts
    CutPieceCommand.ts
    CreateSeamCommand.ts
    DeleteSeamCommand.ts

  selection/
    SelectionModel.ts
    SelectionController.ts

  overlays/
    PointOverlay.ts
    CurveHandleOverlay.ts
    SeamOverlay.ts
    MeasurementOverlay.ts

Para o 3D:

garment3d/
  domain/
  topology/
  assembly/
  arrangement/
  simulation/
  collision/
  worker/
  rendering/
  diagnostics/

O renderer não deve decidir:

qual manga liga em qual cava;
qual frente pertence à esquerda;
qual peça deve ser espelhada;
qual costura existe.

Essas decisões pertencem ao domínio e à montagem.

32. COMANDOS, TRANSAÇÕES E UNDO/REDO

Toda ação mutável relevante deve virar comando.

Inclua:

criar ponto;
mover ponto;
mover alça;
dividir segmento;
converter reta em curva;
criar peça;
duplicar;
espelhar;
excluir;
criar linha interna;
editar linha interna;
cortar;
criar pence;
fechar pence;
criar costura;
editar costura;
excluir costura;
alterar medidas;
trocar tecido;
alterar fio;
alterar margem;
mover peça na bancada;
alterar fórmula.

Um gesto contínuo deve gerar um único passo de undo.

Exemplo:

arrastar um ponto por 300 eventos;
ao soltar, uma transação;
undo retorna à posição inicial.

Não serialize um snapshot gigantesco por movimento.

Considere:

comandos;
patches;
structural sharing;
snapshots periódicos;
limite de memória;
compactação do histórico.
33. PERSISTÊNCIA E MIGRAÇÃO

O formato de projeto precisa ser versionado.

Requisitos:

formatVersion;
migrações sequenciais;
validação;
backup antes de migrar;
recuperação;
erro compreensível;
projetos legados;
testes de fixtures.

Não sobrescreva silenciosamente um projeto antigo sem possibilidade de recuperação.

Formato .moldeon:

JSON para metadados;
buffers binários quando necessário;
compactação opcional;
manifesto;
versão;
hashes;
assets referenciados;
texturas;
thumbnails;
sem credenciais.

OPFS:

autosave;
versões;
debounce;
recuperação após crash;
limpeza de versões antigas;
quota;
fallback quando indisponível.
34. EXPORTAÇÃO E PRODUÇÃO

Manter e melhorar:

SVG 1:1;
linhas de corte;
linhas de costura;
margem;
piques;
fio;
identificação;
quantidade;
dobra;
medidas.

Adicionar progressivamente:

PDF paginado 1:1;
divisão em folhas;
calibração;
quadrado de teste;
DXF quando tecnicamente validado;
formatos industriais após pesquisa;
plotter;
gradação;
marcador de corte;
consumo de tecido.

Não afirme compatibilidade industrial sem validar com softwares reais.

34.1 Encaixe futuro

Preparar dados para:

largura do tecido;
sentido do fio;
rotação permitida;
espelhamento permitido;
quantidade;
margem entre peças;
defeitos;
retalhos;
otimização.

O encaixe é um subsistema separado da bancada e da física.

35. DIGITALIZAÇÃO FUTURA DE MOLDE DE PAPEL

Criar apenas fundações e ADR, não deixar bloquear o escopo principal.

Fluxo futuro:

Usuário coloca marcador de escala.
Fotografa o molde.
Sistema corrige perspectiva.
Detecta bordas.
Vetoriza.
Usuário corrige pontos.
Define fio, piques e linhas.
Confirma medidas.
Importa para a bancada.

Requisitos futuros:

calibração;
distorção da lente;
múltiplas fotos;
marcador conhecido;
correção manual;
detecção de escala;
privacidade;
processamento local quando possível.
36. RECURSOS QUE NÃO DEVEM BLOQUEAR O CORE

Não priorizar antes da base funcionar:

render cinematográfico;
passarela;
animação corporal completa;
iluminação de estúdio avançada;
autocolisão perfeita;
física de botões;
zíper físico completo;
aviamentos complexos;
pelos;
transparência avançada;
editor UV completo;
marketplace;
colaboração simultânea;
treinamento de IA próprio;
encaixe industrial ótimo;
integração com todas as plotters;
render em nuvem.

Esses itens podem receber:

interfaces;
ADRs;
pontos de extensão;
backlog.

Não podem justificar atrasar:

pontos;
corte;
costuras;
mangas;
moldes;
avatar;
física;
performance;
UX.
37. FASES DE EXECUÇÃO

Execute em fatias verticais funcionais.

Não pare após produzir um plano.

Fase 0: auditoria e baseline
Rodar projeto.
Rodar testes.
Medir bundle.
Medir FPS.
Medir memória.
Registrar bugs.
Capturar screenshots atuais.
Criar cenas de teste.
Documentar arquitetura real.
Confirmar diferenças entre README e implementação.

Entregável:

docs/BASELINE_2026.md

Fase 1: estabilização do domínio
Definir PatternDocumentV3.
Separar PatternDefinition e PanelInstance.
Definir conectores.
Evoluir SeamGroup.
Criar migrações.
Preservar projetos existentes.
Atualizar parsers.
Criar testes de round trip.
Fase 2: consertar o editor
Restaurar criação de pontos.
Corrigir divisão de curva.
Corrigir seleção externa.
Corrigir menu de três pontos.
Implementar remoção de costura.
Integrar tudo ao undo e redo.
Refatorar estados de ferramentas.
Validar touch.

Esta fase precisa terminar com editor 2D confiável.

Fase 3: linhas internas e corte
Criar InternalPath.
Implementar múltiplos nós.
Implementar curvas.
Implementar preview.
Implementar corte robusto.
Implementar corte e costura.
Implementar diagnósticos.
Criar testes geométricos.
Fase 4: medidas e moldes-base
Expandir medidas.
Criar motor de fórmulas.
Recriar corpo básico.
Recriar saias.
Recriar calça.
Recriar manga.
Criar golden datasets.
Marcar templates não validados como experimentais.
Fase 5: assistente de manga
Detectar cavas.
Criar conectores.
Criar landmarks.
Gerar manga.
Comparar comprimentos.
Criar piques.
Criar instâncias esquerda e direita.
Criar costuras.
Criar interface guiada.
Criar testes E2E.
Fase 6: montagem semântica
Expandir quantidades de corte.
Resolver lados.
Resolver espelhamento.
Resolver costuras.
Posicionar por anchors.
Remover cilindro.
Remover peça flutuante.
Remover modo explodido.
Mostrar somente manequim vestido.
Criar diagnósticos.
Fase 7: XPBD CPU funcional
Ciclo físico.
Gravidade.
Velocidade.
Stretch.
Shear.
Bend.
Costura interpolada.
Worker real.
Buffering.
Atualização da malha.
Controles de simulação.
Testes determinísticos.
Fase 8: colisão corporal
Proxies.
Espessura.
Atrito.
Estabilidade.
Refinamento por malha ou BVH.
Testes de torso, braços e pernas.
Túnel e interpenetração.
Fase 9: qualidade e performance
Presets.
Remalhamento.
adaptação por dispositivo;
pausa por visibilidade;
fechamento completo do 3D;
benchmark;
otimização;
ausência de leaks.
Fase 10: diagnóstico e polimento
Mapa de deformação.
Wireframe.
relação 2D e 3D.
erros de costura.
câmera.
materiais.
interface mobile.
acessibilidade.
onboarding.
Fase 11: validação e deploy
Testes completos.
inspeção visual.
testes em mobile.
build.
CI.
deploy.
URL pública.
relatório final.
atualização de documentação.
38. TESTES OBRIGATÓRIOS
38.1 Editor

Testar:

criar ponto em reta;
criar ponto em curva;
preservar curva;
mover ponto;
mover alça;
undo;
redo;
zoom;
pan;
touch;
seleção múltipla;
limpar seleção;
menu;
teclado.
38.2 Corte

Testar:

corte reto;
corte curvo;
caminho de múltiplos nós;
contorno curvo;
corte tangente inválido;
múltiplas interseções;
corte e manter costurado;
undo;
redo;
atualização do 3D.
38.3 Costuras

Testar:

bordas iguais;
comprimentos diferentes;
direção oposta;
costura própria;
tubo;
1;
M;
remover;
desfazer remoção;
desativar;
intervalos parciais;
resampling;
landmarks.
38.4 Moldes

Golden tests com múltiplos corpos:

pequeno;
médio;
grande;
alto e estreito;
baixo e largo;
medidas personalizadas.

Verificar:

dimensões;
área;
perímetro;
comprimentos das costuras;
cavas;
manga;
gancho;
pences;
fio;
ausência de autointerseção.
38.5 Manga

Testar:

curta;
longa;
esquerda;
direita;
piques;
cabeça frontal;
cabeça traseira;
cava diferente;
folga;
underarm;
atualização após alterar ombro;
atualização após alterar cava.
38.6 Calça

Testar:

duas definições;
quatro instâncias;
lado esquerdo;
lado direito;
frente;
costas;
duas pernas tubulares;
gancho;
cintura aberta;
barras abertas;
sem cruzamento.
38.7 Física

Cenas canônicas:

tecido pendurado;
tecido sobre esfera;
tecido sobre cápsula;
tubo costurado;
saia sobre quadril;
manga sobre braço;
camiseta sobre torso;
calça sobre duas pernas;
pence fechada;
costura com folga.

Testar:

determinismo;
ausência de NaN;
ausência de infinito;
energia controlada;
estabilidade por milhares de passos;
comportamento com deltas grandes;
pause;
resume;
reset;
troca de tecido;
troca de qualidade.
38.8 Recursos

Testar:

abrir 3D;
fechar;
reabrir;
repetir 20 vezes;
contar Workers;
contar canvases;
verificar loops;
verificar memória;
verificar contextos.
38.9 E2E e visual

Use Playwright ou ferramenta equivalente.

Desktop:

1366×768;
1920×1080.

Mobile:

Android intermediário simulado;
largura aproximada de 360 a 430 px;
retrato;
paisagem.

Capturar regressões visuais de:

bancada;
medidas;
manga;
costuras;
calça;
manequim;
tecido;
menus;
erros.

Não use apenas snapshots de DOM para validar 3D. Inspecione screenshots.

39. COMANDOS DE VALIDAÇÃO

Execute, conforme disponibilidade:

npm install
npm run typecheck
npm test
npm run build
npm run build:wasm

cargo test --workspace
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings

Também:

rodar aplicação;
executar testes E2E;
executar benchmarks;
verificar bundle;
verificar console;
verificar warnings;
testar fallback sem WASM;
testar WebGL 2;
testar WebGPU quando disponível;
testar sem WebGPU;
testar mobile.

Não ignore falhas pré-existentes sem documentá-las e investigar se afetam o trabalho.

40. CRITÉRIOS DE ACEITAÇÃO

O trabalho não está concluído até que:

Pontos possam ser criados e inseridos novamente.
Curvas permaneçam equivalentes ao serem divididas.
Cortes possam ser manipulados e curvos.
Corte tenha undo e redo.
Costuras possam ser removidas e desfeitas.
Menus fechem corretamente.
Clique externo limpe seleção corretamente.
Medidas ocupem menos espaço.
Moldes-base deixem de usar formas grosseiras.
A calça possua frente e costas tecnicamente distintas.
Duas definições de calça gerem quatro instâncias claramente identificadas.
O sistema forme duas pernas.
Mangas possuam fluxo guiado.
Manga frontal e traseira sejam ligadas às cavas corretas.
O 3D nunca apresente peça flutuando.
O modo explodido seja removido.
O corpo não possa ser ocultado no modo 3D normal.
O manequim apareça vestindo a roupa.
A inicialização cilíndrica seja removida.
O solver tenha gravidade, velocidade, stretch, shear, bend e costuras.
A malha renderizada receba posições do Worker.
O tecido colida minimamente com o manequim.
O 3D possa ser fechado sem manter consumo.
Alterações 2D atualizem o 3D.
A interface seja utilizável em mobile.
O projeto compile.
Os testes passem.
A aplicação seja inspecionada visualmente.
Não existam vazamentos evidentes.
Uma URL de teste seja publicada quando as credenciais e integração permitirem.
41. POLÍTICA DE GIT E PUBLICAÇÃO

O usuário autorizou trabalho direto na branch main.

Regras:

Atualize main.
Não use force push.
Não reescreva histórico público.
Faça commits coerentes.
Não misture dezenas de temas sem necessidade em um único commit.
Rode testes antes de publicar.
Use atualização fast-forward.
Não publique segredos.
Não adicione .env real.
Não adicione tokens.
Não adicione arquivos locais.
Não quebre deploy deliberadamente.

Mensagens de commit devem descrever o resultado.

Exemplos:

fix: restore segment point insertion
feat: add editable internal cut paths
refactor: separate pattern definitions from panel instances
feat: add guided sleeve construction
feat: replace cylindrical preview with avatar arrangement
feat: connect xpbd worker to garment meshes
fix: dispose viewport and simulation resources on close

Após publicar:

verificar CI;
verificar build;
verificar deploy;
abrir a aplicação;
testar rota pública;
confirmar funcionamento no celular;
fornecer URL.
42. DOCUMENTAÇÃO OBRIGATÓRIA

Atualize:

README.md;
docs/ARCHITECTURE.md;
docs/PHYSICS_PLAN.md;
docs/PATTERN_LIBRARY.md;
docs/ROADMAP.md.

Criar:

docs/BASELINE_2026.md;
docs/PATTERN_DOCUMENT_V3.md;
docs/SLEEVE_SYSTEM.md;
docs/AVATAR_ARRANGEMENT.md;
docs/XPBD_IMPLEMENTATION.md;
docs/PERFORMANCE_BUDGET.md;
docs/DEPENDENCY_AUDIT.md;
docs/LICENSE_NOTES.md;
docs/BENCHMARKS.md.

Remova afirmações desatualizadas, especialmente:

prévia geométrica como produto final;
modo explodido;
peça flutuando;
corpo opcional no 3D;
simulação física onde ainda não existir;
template “pronto” sem validação.
43. RELATÓRIO FINAL

Ao terminar, informe:

Estado inicial encontrado.
Problemas reproduzidos.
Arquitetura adotada.
Refatorações realizadas.
Arquivos principais alterados.
Migrações criadas.
Moldes corrigidos.
Fluxo de manga implementado.
Mudanças na calça.
Mudanças no 3D.
Mudanças na física.
Mudanças de performance.
Resultados dos testes.
Resultados dos benchmarks.
Inspeção visual realizada.
Navegadores testados.
Dispositivos ou dimensões testados.
Commits publicados.
URL pública.
Limitações restantes.

Se alguma parte não puder ser concluída:

não afirme que foi concluída;
explique o bloqueio exato;
entregue o máximo funcional;
documente o próximo passo técnico;
não substitua implementação por uma interface falsa;
não esconda fallback visual sob o nome de simulação.
44. PRINCÍPIOS INEGOCIÁVEIS
O molde 2D é a fonte de verdade.
O 3D deve refletir o 2D.
O 3D sempre mostra um manequim humano vestindo a roupa.
Não existe mais peça flutuando.
Não existe mais modo explodido público.
O usuário pode fechar completamente o 3D.
Física e renderização são separadas.
React não atualiza partículas por frame.
CPU XPBD correta antes de GPU.
WebGPU é progressivo, não obrigatório.
WebGL 2 continua suportado.
Mobile é requisito.
Performance é medida.
Costuras são entidades editáveis.
Manga tem conectores e landmarks reais.
Calça possui quatro instâncias físicas quando frente e costas são cortadas duas vezes.
Nenhuma regra depende do nome de um template.
Nenhuma peça recebe offset mágico como correção definitiva.
Projetos antigos recebem migração.
Código GPL não é copiado para o projeto MIT.
Templates não são chamados de corretos sem validação.
Compilar não significa funcionar.
Testes não substituem inspeção visual.
Interface bonita não substitui geometria correta.
Um 3D realista não substitui um molde utilizável.
Nenhuma otimização deve destruir a fidelidade entre 2D e 3D.
Nenhuma funcionalidade avançada deve bloquear os fundamentos.
O produto final deve ser intuitivo, responsivo, eficiente e honesto sobre suas limitações.

Execute o trabalho diretamente a partir do estado atual do Moldeon e continue até que as funcionalidades centrais deste documento estejam implementadas, testadas e visualmente verificadas.