# Baseline técnico do Moldeon em 2026

> Estado auditado antes das refatorações estruturais previstas no `MOLDEON_MASTER_PLAN.md`.

## 1. Resumo executivo

O Moldeon possui um editor 2D funcional em desktop, modelo de documento relativamente amplo, geradores paramétricos iniciais, persistência local, exportação SVG, fallback TypeScript, núcleo Rust/WASM executável e um pipeline 3D real em Three.js. O produto, porém, ainda não entrega montagem de roupa tecnicamente confiável nem simulação física conectada. O 3D atual constrói uma malha global e resolve restrições geométricas síncronas, mas os resultados visuais de camiseta, saia e calça não representam peças vestíveis. O avatar anatômico existe como gerador isolado, mas não é adicionado ao viewport global. O Worker XPBD também existe apenas como demonstração isolada.

O baseline reproduziu defeitos prioritários: inserção de ponto não foi acionável nos cenários automatizados; menu de peça não fecha por clique externo, Escape ou ação; o editor mobile deixa a área de canvas com largura efetiva zero; não existe fechamento real do 3D; a troca para Modelagem mantém canvas e renderizador montados; a camiseta implode no topo, a saia deforma e a calça aparece sem costuras semânticas; o 3D produz long tasks superiores a 150 ms; e a documentação de bundle está abaixo dos números medidos.

Nesta Fase 0 foram adicionados somente fixtures, instrumentação de desenvolvimento, comandos de diagnóstico, workflow de baseline e correções mínimas que bloqueavam a auditoria. Nenhum novo domínio, solver profissional, sistema de mangas, template ou redesign foi implementado.

## 2. Escopo da auditoria

A auditoria cobriu instalação, TypeScript, Vitest, build fallback, build WASM, Cargo, rustfmt, Clippy, execução dos dois modos, Chromium headless em quatro viewports, criação e carregamento de fixtures, pipeline 2D → 3D, lifecycle do viewport, bundle, arquitetura, persistência, ferramentas do editor e reclamações registradas no plano mestre.

Não foram executados testes em celular físico. Os cenários mobile são emulação de Chromium headless. WebGPU foi anunciado pelo navegador de CI, mas a criação do contexto falhou e o Three.js utilizou WebGL 2. Não houve medição confiável de memória de GPU nem autocolisão porque esses recursos não estão implementados.

## 3. Commits e período

- Branch: `main`.
- Commit inicial: `3c1f35525dc6e11fa2f92a748e014d244bc610b8`.
- Commit de execução reproduzível antes deste relatório: `8d9e44e6f5d5667f5e465288930fe98544c384aa`.
- Execução de referência: GitHub Actions #11, run `31039677458`.
- Artefato de referência: `phase0-baseline-8d9e44e6f5d5667f5e465288930fe98544c384aa`, artifact `8944165402`.
- Início da auditoria: 2026-08-05 15:37 BRT.
- Ambiente local do agente: indisponível para clone por falha de resolução DNS para `github.com`; execução integral transferida para GitHub Actions e documentada como limitação.

## 4. Ambiente auditado

| Item | Valor |
|---|---|
| Sistema | Ubuntu 24.04 em GitHub Actions, kernel Linux 6.17 Azure |
| CPU | 4 vCPU, AMD EPYC 9V74 virtualizado em Microsoft Azure |
| Memória | 15 GiB, 3 GiB de swap |
| Node.js | 22.12.0 |
| npm | 10.9.0 |
| Rust | 1.97.1 |
| Cargo | 1.97.1 |
| rustup | 1.29.0 |
| wasm-pack | 0.13.1 |
| Navegador | Chromium 140.0.7339.16 headless |
| WebAssembly | disponível |
| WebGL 2 | disponível |
| WebGPU | API exposta, contexto Three.js indisponível no runner |
| SharedArrayBuffer | disponível |
| crossOriginIsolated | `true` |
| DPR desktop | 1 |
| DPR mobile emulado | 2 |
| hardwareConcurrency no navegador | 4 |
| deviceMemory no navegador | 8 GiB informados |

## 5. Comandos executados

| Comando | Resultado | Tempo aproximado | Observações |
|---|---:|---:|---|
| `npm install` | aprovado | 1,91 s | instalação sem alteração intencional do lockfile |
| `npm run typecheck` | aprovado | 4,45 s | TypeScript estrito |
| `npm test` | aprovado | 2,80 s | 27 arquivos, 158 testes |
| `npm run build` | aprovado | 5,00 s | produção fallback |
| relatório de bundle fallback | aprovado | 2,84 s | bruto, gzip e Brotli |
| `cargo test --workspace` | aprovado | 14,53 s | núcleo Rust |
| `cargo fmt --all -- --check` | aprovado | 0,36 s | sem alteração automática |
| `cargo clippy --workspace --all-targets -- -D warnings` | aprovado | 11,50 s | warnings tratados como erro |
| instalação `wasm-pack 0.13.1` | aprovado | 64,57 s | instalação no runner |
| `npm run build:wasm` | aprovado | 23,78 s | Rust/WASM + frontend |
| relatório de bundle WASM | aprovado | 3,03 s | inclui `.wasm` |
| `npm run dev:fallback` + Chromium | aprovado | 63,47 s | quatro viewports e interações |
| `npm run dev` + Chromium | aprovado | 36,17 s | status visual `Rust/WASM` |

O primeiro ciclo da auditoria encontrou dois bloqueios de baseline. O modo WASM era compilado, mas o Vite 8 recusava o módulo JavaScript gerado em `public/wasm`; o middleware de desenvolvimento em `vite.config.ts` passou a servir apenas os arquivos gerados. A primeira versão do workflow também deixava processo filho do Vite ativo; `phase0-run-browser-server.mjs` passou a controlar e encerrar a árvore de processos. Essas correções são de ambiente e lifecycle do diagnóstico, não de funcionalidade de produto.

### Warnings relevantes

- `wasm-pack 0.13.1` informa que há versão mais nova, mas o projeto fixa 0.13.1.
- O crate informa ausência opcional de `repository` e de um arquivo de licença dentro do diretório do crate.
- O Chromium de CI expõe `navigator.gpu`, mas o Three.js não cria o provider WebGPU e recua para WebGL 2.
- O backend WebGL em software emite avisos de fallback SwiftShader e stalls em `ReadPixels` durante screenshots.

## 6. Resultado de testes e build

A suíte frontend executou 27 arquivos e 158 testes, sem falhas e sem testes ignorados observados na saída. Isso comprova funções unitárias, parsers, templates, persistência, edição de segmentos, histórico, exportação, solver geométrico e fixtures. Não comprova qualidade visual ou usabilidade. Alguns testes validam módulos que não são o caminho de runtime atual, especialmente `viewport/ThreeViewport.test.ts`, enquanto o aplicativo importa `GlobalThreeViewport.ts`.

O núcleo Rust passou em testes, rustfmt e Clippy. A equivalência entre backends é parcial: o Rust conserva o formato legado centrado em pontos e não representa toda a semântica atual de nós, segmentos, contornos, placements, pences e metadados.

## 7. Arquitetura real

### 7.1 Inventário

O inventário registrou 100 arquivos relevantes e 24,3 mil linhas de texto. Os maiores pontos de concentração são:

| Arquivo | Linhas aproximadas | Responsabilidade real |
|---|---:|---|
| `editor/PatternCanvas.tsx` | 2.114 | render 2D, hit testing, câmera, mouse/touch e todas as ferramentas |
| `styles.css` | 1.611 | toda a apresentação desktop/mobile |
| `domain/pattern.ts` | 1.182 | tipos, parsers, migração e helpers do documento |
| `viewport/ThreeViewport.ts` | 1.155 | viewport antigo, ainda testado, não usado pelo app |
| `state/editorStore.ts` | 1.124 | fonte de verdade, comandos e quase todas as mutações |
| `garment3d/GarmentAssembly.ts` | 828 | partículas, restrições e placements globais |
| `garment3d/PanelTopology.ts` | 696 | triangulação intermediária e compatibilidade temporária |
| `App.tsx` | 693 | composição, carregamento lazy, modos e autosave |
| `patterns/templateCatalog.ts` | 688 | fórmulas e metadados dos moldes-base |
| `garment3d/PhysicalGarmentAssembly.ts` | 654 | instâncias físicas, corte na dobra e remapeamento |
| `crates/pattern-core/src/lib.rs` | 644 | engine geométrica Rust/WASM |
| `garment3d/StitchConstraintBuilder.ts` | 593 | costuras próprias e compatibilidade legada |

### 7.2 Fronteiras

- React → estado: componentes chamam ações do `editorStore` Zustand.
- Estado → 2D: `PatternCanvas` recebe snapshots e callbacks, desenha em Canvas 2D.
- Estado → WASM: `engineRuntime.ts` escolhe fallback ou `loadPatternEngine.ts`; o wrapper serializa objetos e parseia snapshots.
- Estado → 3D: `App.tsx` cria snapshots, carrega `GarmentViewport` sob demanda e passa o `GarmentDraft`.
- React → Three.js: `GarmentViewport.tsx` controla criação, atualização e dispose de `GlobalThreeViewport`.
- Three.js → montagem: `GlobalThreeViewport` chama `buildResolvedGarmentAssembly`, `solveGarmentAssembly` e `buildGarmentAssemblyMeshes`.
- Física Worker → produto: não há fronteira conectada; o Worker é isolado.

### 7.3 Código duplicado e legado

`viewport/ThreeViewport.ts` permanece com mais de mil linhas e testes próprios, mas `GarmentViewport.tsx` importa `GlobalThreeViewport.ts`. Há dois caminhos conceituais de 3D e compatibilidades temporárias em `PanelTopology.ts` e `StitchConstraintBuilder.ts`. Isso aumenta risco de corrigir ou testar o arquivo errado.

## 8. Fluxo atual 2D → 3D

1. `editorStore` mantém `GarmentDraft`, peça ativa, snapshots e transformações.
2. `App.tsx` converte cada peça com `createPatternSnapshot` quando o preview foi solicitado.
3. `GarmentViewport` cria `GlobalThreeViewport` de forma lazy.
4. `buildResolvedGarmentAssembly` repara costuras semânticas de alguns templates e filtra costuras cruzadas de lado.
5. `PhysicalGarmentAssembly` expande `cutOnFold`, duplica instâncias e remapeia índices.
6. `GarmentAssembly` triangula/refina painéis, cria partículas, restrições estruturais, stitches e âncoras.
7. `GarmentSolver` resolve tudo sincronamente no thread principal.
8. `GarmentThreeBridge` cria um `THREE.Mesh` por instância.
9. `dress()` não executa nova física: interpola a posição plana para o resultado já calculado.
10. Alterações 2D reconstroem toda a montagem e todo o conjunto de meshes.

O fluxo está conectado, mas a montagem visual não é confiável. A camiseta auditada gerou 4.590 partículas, 7.296 triângulos e 412 stitches; ainda assim, o resultado colapsou na região superior. A calça gerou quatro instâncias físicas corretas em quantidade, mas apenas dois stitches, nenhum conjunto semântico completo e dois grupos desconectados.

## 9. Estado real da física

| Elemento | Estado |
|---|---|
| Projeção geométrica | implementada e conectada |
| Constraints de distância estruturais | implementadas e conectadas no solver global |
| Constraints de costura | implementadas e conectadas, cobertura semântica incompleta |
| Âncoras | implementadas e conectadas |
| Gravity | ausente no solver do viewport |
| Velocity/integração temporal | ausente no solver do viewport |
| Damping físico | ausente no solver do viewport |
| Stretch calibrado por tecido | aproximação |
| Shear separado | ausente |
| Bend separado | ausente |
| Colisão com avatar | ausente |
| Autocolisão | ausente |
| Atrito físico | ausente; usado principalmente em material/heurísticas |
| Worker XPBD | implementado como demonstração isolada |
| Atualização Worker → Three.js | ausente |
| Propriedades de tecido | influenciam aparência e alguns parâmetros aproximados, não uma física calibrada |

`physics/xpbd.ts` resolve apenas distância. `simulation.worker.ts` inicializa duas partículas e uma constraint. Nenhum Worker foi criado nos testes de navegador do fluxo 3D. O solver atual criou long tasks de aproximadamente 148 a 239 ms ao montar a camiseta no runner. Logo, a aplicação não deve alegar simulação física profissional.

## 10. Estado real do avatar

O formulário aceita corpo feminino ou masculino e medidas de altura, busto/tórax, cintura, quadril, ombros, tronco, braço e entreperna. `domain/anatomicalBody.ts` consegue gerar um proxy low-poly e possui testes unitários. Contudo, não foi encontrado uso de `generateAnatomicalBodyMesh` fora do próprio arquivo e testes. `GlobalThreeViewport` cria `bodyGroup`, mas não adiciona geometria corporal. `setBodyVisible` altera apenas a visibilidade de um grupo vazio.

Classificação: **Somente estrutura** para o avatar do viewport atual. A interface de medidas está confirmada; a presença visual e a colisão do avatar não estão.

## 11. Estado real dos moldes-base

| Molde | Estado | Evidência técnica |
|---|---|---|
| Camiseta | simplificado e não validado | frente/costas de 6 pontos, manga de 5; papéis semânticos e placements existem |
| Blusa | simplificado e não validado | deriva do mesmo bloco básico com ajustes de folga/comprimento |
| Saia reta | plausível como rascunho, não validada | duas meias peças, pences persistentes e linha de quadril |
| Minissaia | plausível como rascunho, não validada | variação de comprimento da saia |
| Calça reta | incompleta | dois moldes editáveis, quatro instâncias físicas, sem costuras canônicas completas |
| Jaqueta | indisponível | cartão marcado como desenvolvimento e criação bloqueada |

As fórmulas usam medidas explícitas e proporções estimadas. Há fio, linhas construtivas, pences em saias e costas da calça, papéis semânticos e placements. Não foram encontrados piques de montagem robustos ou validação antropométrica/costureira suficiente para classificar os blocos como corretos.

## 12. Estado real de mangas

A manga é uma única peça editável com `cutQuantity=2` e placements esquerdo/direito. O modelo possui `sleeveCapFront`, `sleeveCapBack` e duas laterais. O resolvedor semântico cria costura inferior, cava frontal e cava traseira. A auditoria contou duas instâncias físicas da manga na camiseta.

O resultado visual continua incorreto. A cabeça de manga é simplificada, a orientação depende de papéis e placements, não existem piques, o solver deforma a região superior e não há avatar para orientar a cava. Classificação: **Parcial, visualmente quebrado**.

## 13. Estado real da calça

- Moldes editáveis: 2, frente e costas.
- Quantidade declarada: cada molde `cutQuantity=2`.
- Instâncias físicas: 4, frente esquerda/direita e costas esquerda/direita.
- Contagem auditada: 5.400 partículas e 8.608 triângulos.
- Stitches auditados: 2.
- Grupos: 2.
- Bordas requeridas abertas na interface: 10.

A quantidade de instâncias está conceitualmente correta, mas a montagem está incompleta. Não há conjunto canônico completo para gancho frontal/traseiro, entrepernas e laterais. O 3D mostra painéis sobrepostos e pendentes, não duas pernas fechadas. A diferença entre dois moldes e quatro instâncias já existe, porém a terceira situação problemática, quatro painéis incorretamente sobrepostos, é o comportamento atual.

## 14. Estado real do corte

O corte funciona com uma linha reta definida por dois pontos, estendida pelo contorno, e exige exatamente duas interseções. O cenário reto criou duas peças. O cenário aplicado a uma peça com Bézier também criou duas peças porque a curva é amostrada antes da interseção, não porque exista um caminho de corte curvo editável.

Não existem caminho com mais de dois pontos, edição da curva de corte, múltiplas interseções, booleanas curvas robustas ou preservação completa de toda a semântica. Undo/redo existe via histórico transacional. Classificação: **Parcial**. Fase responsável: Fase 3.

## 15. Estado real das costuras

Confirmado: criação em duas etapas, análise de comprimento, nome, tratamento, exclusão e undo/redo. O cenário de auditoria alterou nome/tratamento, excluiu a costura, desfez e refez.

Limitações observadas:

- Não existe controle de direção na lista após confirmação.
- Não existe desativação temporária.
- Costuras parciais existem no modelo, mas não receberam cobertura visual abrangente.
- Costura própria existe no domínio/fixture, mas a validação histórica é inconsistente entre módulos.
- A lista ocupa espaço e não mostra claramente as duas bordas envolvidas.
- Costuras semânticas cobrem tops e saia, mas não a calça completa.

## 16. Estado real do editor 2D

Desktop 1366×768 e 1920×1080 carregaram sem overflow global. A grade, milímetros, zoom, pan, pontos, seleção, peças múltiplas, medidas, fio, margens e toolbar são visíveis. `PatternCanvas.tsx` concentra aproximadamente 2.114 linhas, o que combina render, câmera, transformações, hit testing, ferramentas e eventos em uma única fronteira de alto risco.

A tentativa automatizada de inserir ponto percorreu 321 coordenadas por cenário e não aumentou a quantidade de pontos em reta, curva, zoom alterado, peça movida nem touch. Isso não prova que nenhuma coordenada manual funcione, mas reproduz a reclamação de que a ferramenta não é utilizável de forma confiável. O cenário deve ser classificado como **reproduzido por falha operacional**, com recomendação de teste E2E guiado por geometria na Fase 2.

Seleção foi limpa por clique em área vazia, painel e toolbar nos cenários auditados. Seleção múltipla, caixa e pinch possuem código/testes, mas não receberam cobertura E2E completa nesta fase.

## 17. Responsividade e mobile

Nos viewports 360×800 e 390×844 não houve overflow global do documento, mas isso mascara um problema interno grave. Em 390×844:

- toolbar: 143 px de altura;
- `editor-panel`: 109 px de largura e `scrollWidth` de 265 px;
- painel de peças: 178 px;
- `canvas-stack`: largura geométrica 0 px;
- tabs mobile: largura 109 px com `scrollWidth` de 181 px.

O screenshot mostra toolbar gigante, abas sobrepostas, painel de peças cobrindo a bancada e nenhuma área útil de molde. Classificação: **Quebrado** em mobile. A inspeção foi emulação Chromium, não dispositivo físico.

## 18. Performance

### 18.1 Bundle de produção

| Variante | Total bruto | Total gzip | JS bruto | JS gzip | Entrada inicial bruta | Entrada inicial gzip | WASM bruto |
|---|---:|---:|---:|---:|---:|---:|---:|
| Fallback | 1,51 MiB | 422,96 KiB | 1,47 MiB | 412,01 KiB | 362,28 KiB | 107,46 KiB | 0 |
| WASM | 1,62 MiB | 470,46 KiB | 1,49 MiB | 416,66 KiB | 363,0 KiB | 107,69 KiB | 90,81 KiB |

Os maiores chunks são WebGPU, `GarmentViewport`/Three.js e o chunk inicial. O 3D está separado do carregamento inicial de produção, mas a bridge de auditoria em desenvolvimento importa módulos 3D para diagnóstico e não deve ser usada como medida do bundle de produção.

O README cita aproximadamente 239 KB minificados e 76 KB comprimidos para o carregamento inicial. A medição real é maior e a afirmação deve ser atualizada após a arquitetura estabilizar.

### 18.2 Inicialização e runtime

No servidor de desenvolvimento do runner, `DOMContentLoaded` ocorreu em aproximadamente 234 a 260 ms. O script de auditoria adicionou uma espera de estabilização, por isso a duração externa de navegação registrada ficou próxima de 1,2 s e não deve ser confundida com FCP/LCP. FCP e LCP não foram coletados de forma confiável.

A montagem 3D levou aproximadamente 3,15 s no fluxo observado, incluindo espera fixa de 2 s. O FPS medido após montagem ficou próximo de 60, mas isso mede o loop do navegador, não a complexidade física. A montagem criou long tasks de 148 a 239 ms. Nenhum Worker foi criado.

### 18.3 Lifecycle

Depois de voltar para Modelagem, o canvas 3D permaneceu montado. Foram executados mais 48 callbacks de `requestAnimationFrame` no intervalo de 750 ms. Em cinco trocas Modelagem/Montagem, a contagem permaneceu em um canvas, sem duplicação, mas também sem dispose. Não existe botão de fechamento real.

## 19. README versus implementação

| Funcionalidade declarada | Classificação | Evidência/limitação |
|---|---|---|
| Editor em milímetros | Confirmado | régua, grade, labels e domínio em mm |
| Grade | Confirmado | visível em desktop |
| Zoom | Confirmado | câmera/testes e controle visual |
| Pan | Confirmado | código mouse/touch e testes de câmera |
| Pontos arrastáveis | Confirmado | código e testes unitários |
| Criação livre de pontos/peças | Parcial | desenho livre existe; fluxo não auditado integralmente |
| Inserção de pontos | Quebrado | nenhum dos cinco cenários inseriu ponto |
| Curvas Bézier | Parcial | modelo/alças/SVG existem; inserção em curva falhou |
| Múltiplas peças | Confirmado | camiseta, saia, calça e lista de peças |
| Seleção múltipla | Parcial | código/testes; E2E incompleto |
| Desenho livre | Parcial | ferramenta existe; não validada em touch |
| Corte | Parcial | linha reta com duas interseções |
| Pences | Parcial | persistentes no 2D; 3D aproximado |
| Costuras | Parcial | CRUD e constraints; direção/disable/cobertura incompletos |
| Comparação de comprimentos | Confirmado | análise e tratamentos |
| Costuras semânticas | Parcial | top e saia; calça incompleta |
| Undo e redo | Confirmado | histórico e cenário de costura |
| Tecidos | Confirmado | presets, cor e parâmetros |
| Múltiplos tecidos | Confirmado no documento | fixture e UI; não há material por região da mesma peça |
| Retalhos | Parcial | dimensões/quantidade/área; sem encaixe |
| Medidas corporais | Confirmado | formulário e persistência |
| Avatar feminino | Somente estrutura | gerador isolado, não renderizado no viewport global |
| Avatar masculino | Somente estrutura | idem |
| Montagem | Quebrado visualmente | malhas e constraints existem, roupa não fecha corretamente |
| Prova | Parcial | diálogo/configuração existe; avatar/colisão ausentes |
| 3D | Parcial | Three.js real, geometria visualmente incorreta |
| WebGPU | Parcial | módulo/chunk existe; runner recuou para WebGL 2 |
| Fallback WebGL 2 | Confirmado | contexto utilizado nos testes |
| Fechamento do 3D | Não encontrado | sem botão e sem unmount ao mudar modo |
| Atualização 2D → 3D | Parcial | reconstrução conectada, qualidade incorreta |
| Exportação SVG | Confirmado | testes e botão |
| Autosave | Confirmado | OPFS com fallback localStorage |
| OPFS | Confirmado no Chromium | status visual `opfs` |
| Rust/WASM | Confirmado após correção de dev server | interface mostra `Rust/WASM` |
| Fallback TypeScript | Confirmado | interface mostra fallback |
| Worker XPBD | Somente estrutura | demonstração isolada |
| Simulação física | Não implementada como alegada | solver geométrico síncrono sem integração temporal/colisão |
| Responsividade | Quebrado em mobile | canvas com largura 0 |
| Uso por toque | Parcial | pan/pinch possuem código; ponto touch falhou |
| Performance mobile | Não testável fisicamente | emulação mostra layout bloqueador |

## 20. Matriz de bugs

| ID | Título | Área | Sev. | Prior. | Reproduzido | Esperado | Observado | Arquivos prováveis | Cobertura | Fase | Risco |
|---|---|---|---|---|---|---|---|---|---|---|---|
| M0-001 | Inserção de ponto não acionável | Editor | alta | P1 | sim | clicar perto de reta/curva insere ponto | 321 tentativas por cenário sem alteração | `PatternCanvas.tsx`, `patternEditing.ts`, coordenadas | unitária insuficiente | 2 | alto |
| M0-002 | Canvas mobile com largura zero | UI mobile | bloqueador | P0 | sim | bancada utilizável em 390 px | peças/tabs ocupam toda a largura | `styles.css`, `App.tsx` | ausente | 10 | alto |
| M0-003 | Menu de peça não fecha | UI | média | P2 | sim | fechar fora, Escape e ação | permanece aberto | `PiecesPanel.tsx` | ausente | 10 | médio |
| M0-004 | Sem fechamento real do 3D | Viewport | alta | P1 | sim | desmontar renderer/canvas | canvas persiste em Modelagem | `App.tsx`, `GarmentViewport.tsx` | ausente | 6 | alto |
| M0-005 | RAF continua após sair do 3D | Performance | alta | P1 | sim | repouso após saída | 48 frames adicionais/750 ms | `GarmentViewport.tsx`, `GlobalThreeViewport.ts` | ausente | 9 | alto |
| M0-006 | Avatar não é adicionado à cena | Avatar | alta | P1 | por código | corpo visível/configurável | `bodyGroup` vazio | `GlobalThreeViewport.ts`, `anatomicalBody.ts` | teste isolado | 6 | alto |
| M0-007 | Camiseta implode no 3D | Montagem | crítica | P0 | sim | torso e mangas reconhecíveis | massa deformada no topo | `GarmentAssembly*`, solver, seams | testes não visuais | 6 | alto |
| M0-008 | Saia deforma no 3D | Montagem | alta | P1 | sim | tubo com cintura/barra | superfície colapsada | montagem física, solver, pences | testes não visuais | 6 | alto |
| M0-009 | Calça sem montagem semântica | Moldes/montagem | crítica | P0 | sim | duas pernas fechadas | 2 grupos, 10 bordas abertas, 2 stitches | templates, semantic seams, assembly | insuficiente | 4/6 | alto |
| M0-010 | Worker XPBD isolado | Física | alta | P1 | por código | Worker alimenta a malha | demo de duas partículas sem consumidor | `simulation.worker.ts`, `xpbd.ts` | unitária isolada | 7 | alto |
| M0-011 | Solver bloqueia thread principal | Performance | alta | P1 | sim | trabalho distribuído e frames estáveis | long tasks 148–239 ms | `GarmentSolver.ts`, viewport | ausente | 7/9 | alto |
| M0-012 | WebGPU exposto mas indisponível | Render | média | P2 | sim no CI | backend coerente e feedback claro | aviso e fallback WebGL2 | `GlobalThreeViewport.ts` | ausente | 9 | médio |
| M0-013 | Viewport antigo morto continua no repo/testes | Arquitetura | média | P2 | por código | uma implementação canônica | dois motores, teste do caminho morto | `viewport/ThreeViewport*` | enganosa | 1/6 | alto |
| M0-014 | Modelo WASM não cobre V2 completo | Domínio | alta | P1 | por código | equivalência de documento | fronteira legada baseada em pontos | Rust lib, wrapper WASM, parsers | parcial | 1 | alto |
| M0-015 | Corte limitado a reta | Corte | alta | P1 | sim | caminho editável e curvo | dois pontos e duas interseções | `patternOperations.ts`, canvas | parcial | 3 | médio |
| M0-016 | Direção de costura não editável | Costuras | média | P2 | sim | editar após criar | lista só nome/tratamento/excluir | `AssemblyPanel.tsx`, store | ausente | 6 | médio |
| M0-017 | Costura não pode ser desativada | Costuras | média | P2 | por código | toggle sem apagar | não existe propriedade/controle | domínio, store, painel | ausente | 1/6 | médio |
| M0-018 | README de performance desatualizado | Docs | média | P2 | sim | números medidos | promessa inferior ao bundle real | `README.md` | não aplicável | 0/10 | médio |
| M0-019 | Workflows CI duplicados | CI | baixa | P3 | por código | uma matriz coerente | `ci.yml` e `web-ci.yml` repetem frontend | `.github/workflows` | não aplicável | 10 | baixo |
| M0-020 | Testes 3D não validam aparência | Qualidade | alta | P1 | sim | screenshots/asserções visuais | apenas finitude/contagens | testes garment3d/viewport | inadequada | 11 | alto |
| M0-021 | Pences não alteram topologia real | Pence/3D | alta | P1 | por código | corte e fechamento da pence | aproximação por vértices/constraint | `GarmentAssembly.ts` | insuficiente | 6/7 | alto |
| M0-022 | Templates marcados prontos sem validação de modelagem | Moldes | alta | P1 | por inspeção | bloco plausível verificado | fórmulas simplificadas | `templateCatalog.ts` | geométrica apenas | 4 | alto |
| M0-023 | Painel de medidas e tabs inviáveis no mobile | UI mobile | alta | P1 | sim | navegação e teclado usáveis | sobreposição e 0 px de canvas | CSS/dialogs | ausente | 10 | alto |
| M0-024 | Seleção de backend gera warnings repetidos | Render | baixa | P3 | sim | fallback silencioso/controlado | warnings do WebGPU e driver | viewport | ausente | 9/10 | baixo |

## 21. Screenshots e evidências

Os screenshots e JSONs não foram adicionados ao Git para evitar arquivos grandes. Estão no artefato `phase0-baseline-8d9e44e6f5d5667f5e465288930fe98544c384aa` da execução `31039677458`, retido por 21 dias.

Estrutura principal:

```text
browser/fallback/
browser/wasm/
interactions/fallback/
bundle/
commands/
environment/
architecture/
```

Evidências prioritárias:

- `browser/fallback/desktop-1366x768-tshirt-editor.png`
- `browser/fallback/mobile-390x844-tshirt-editor.png`
- `interactions/fallback/tshirt-standard-mounted.png`
- `interactions/fallback/tshirt-standard-exploded.png`
- `interactions/fallback/straight-pants-standard-mounted.png`
- `interactions/fallback/straight-skirt-standard-mounted.png`
- `interactions/fallback/piece-menu.png`
- `interactions/fallback/interaction-audit.json`
- `browser/fallback/browser-audit.json`
- `browser/wasm/browser-audit.json`
- `architecture/source-inventory.json`
- `bundle/bundle-fallback.json`
- `bundle/bundle-wasm.json`

## 22. Riscos antes da refatoração

| Risco | Prob. | Impacto | Fase | Estratégia sugerida | Testes necessários |
|---|---|---|---|---|---|
| Quebrar projetos salvos | alta | crítica | 1 | versão explícita e migração pura | golden files e round-trip |
| Mistura de pontos legados e segmentos | alta | alta | 1 | fonte canônica única | invariantes e fuzzing |
| IDs aleatórios/instáveis | alta | alta | 1 | fábrica injetável/determinística | fixtures e migração |
| Estado duplicado peça/snapshot/WASM | alta | alta | 1/2 | eliminar espelhos e definir ownership | integração de edição |
| Compatibilidade temporária virar permanente | alta | alta | 1/6 | data de remoção e adapters isolados | testes de contrato |
| `PatternCanvas` monolítico | alta | alta | 2 | separar câmera, ferramentas, render e hit test | E2E por ferramenta |
| Regras de montagem dentro do renderer | média | alta | 6 | domínio semântico antes do Three.js | fixtures garment-level |
| Inferência baseada em nomes | alta | alta | 1/4/5 | papéis explícitos persistentes | migração de projetos |
| Costuras apontarem para bordas alteradas | alta | crítica | 1/3 | IDs topológicos estáveis/remapeamento | corte/split/undo |
| Triangulação remover colineares | média | alta | 6/7 | mapeamento explícito e refinamento controlado | malhas degeneradas |
| Divergência WASM/TypeScript | alta | alta | 1 | suíte de paridade automática | casos aleatórios/golden |
| Worker isolado da malha | alta | alta | 7 | protocolo único e buffers versionados | integração Worker |
| Vazamento de viewport | alta | alta | 6/9 | lifecycle explícito | abrir/fechar repetido |
| Dependência de WebGPU | média | média | 9 | WebGL2 como baseline real | matriz de navegadores |
| Falta de E2E | alta | alta | 11 | Playwright com fixtures | desktop/mobile/3D |
| Templates não validados | alta | alta | 4/5 | revisão de modelista e medições | landmarks e provas |
| Documentação prometer além do runtime | alta | média | 10/11 | números gerados pelo CI | verificação docs |

## 23. Bloqueios e correções mínimas da auditoria

Correções executadas nesta fase:

1. Fixtures determinísticas e testes.
2. Ponte de fixtures somente em desenvolvimento.
3. Gravador de comandos e durações.
4. Relatório de bundle bruto/gzip/Brotli.
5. Inventário de código.
6. Auditoria Chromium desktop/mobile.
7. Reprodução automatizada de ferramentas e 3D.
8. Controle de lifecycle dos servidores Vite da auditoria.
9. Middleware de desenvolvimento para o pacote wasm-pack em Vite 8.
10. Workflow `Phase 0 Baseline` com upload de artefato e assert final.

Nenhuma dessas mudanças tenta corrigir o 3D, o corte, os templates, as mangas ou a UI mobile.

## 24. Recomendação para a Fase 1

Prioridade absoluta: estabelecer um documento canônico versionado antes de tocar no editor ou na física.

- Definir `PatternDocumentV3` e entidades estáveis.
- Separar molde editável de instância física.
- Tornar nós, segmentos, contornos, pences, costuras e roles explícitos.
- Definir estratégia de IDs e remapeamento em split/corte.
- Criar migradores puros para documentos atuais/legados.
- Definir paridade entre TypeScript e Rust ou reduzir temporariamente a superfície WASM.
- Congelar golden fixtures para todos os formatos.
- Remover somente após migração as compatibilidades temporárias.

A Fase 1 não deve começar extraindo componentes visuais primeiro. A principal dívida é semântica.

## 25. Recomendação para a Fase 2

Depois do domínio canônico:

- Decompor `PatternCanvas` em câmera, render, hit test, seleção e máquinas de estado por ferramenta.
- Criar hit testing determinístico de segmento em coordenadas do documento.
- Cobrir inserção de ponto em reta, Bézier, zoom, peça movida e touch com Playwright.
- Padronizar limpeza de seleção e menus.
- Preservar um comando de histórico por gesto.
- Tratar mobile como layout próprio, não desktop comprimido.

## 26. Limitações da auditoria

- Nenhum celular físico foi usado.
- O Chromium foi executado em VM Linux e GPU virtual/software.
- WebGPU real não foi obtido; houve fallback WebGL 2.
- FCP/LCP e memória de GPU não foram medidos com precisão suficiente.
- A tentativa de inserção usa varredura de coordenadas e prova falta de acionabilidade automatizada, não impossibilidade matemática absoluta.
- A inspeção de qualidade dos moldes não substitui avaliação de modelista profissional nem protótipo em tecido.
- O ambiente do agente não conseguiu resolver `github.com`; os comandos foram executados no GitHub Actions.
- Os screenshots são artefatos temporários de CI, não arquivos permanentes do repositório.

## Conclusão

O Moldeon possui uma base técnica ampla, mas a fronteira entre promessa e runtime ainda é grande. O editor desktop e a infraestrutura são recuperáveis. O maior risco é continuar corrigindo sintomas no viewport antes de consolidar domínio, instâncias físicas, topologia e lifecycle. A Fase 0 encerra com um baseline reproduzível, fixtures e evidências. Ela não encerra com o produto pronto e não valida a montagem ou a física como corretas.
