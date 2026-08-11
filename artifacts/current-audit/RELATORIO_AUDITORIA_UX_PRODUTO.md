# Auditoria de qualidade, UX e produto — Moldeon

Data: 10/08/2026  
Escopo auditado: estado local da branch `recovery/9.5-05-modeling-operations`, até o compromisso `0b25869` observado ao final da auditoria.  
Regra respeitada: nenhum arquivo de produto foi alterado e a Etapa 10 não foi iniciada. Os únicos arquivos criados são artefatos desta auditoria.

## Veredito direto

O Moldeon já contém um editor 2D real, persistência local, histórico funcional, biblioteca de moldes, edição paramétrica e uma ligação funcional entre o molde 2D e a cena 3D. Isso é uma fundação relevante.

Como produto, porém, ainda transmite **protótipo técnico**, não uma ferramenta pronta para uso público. O motivo principal não é falta de botões funcionando: é a combinação de resultado 3D visualmente quebrado, primeira experiência sem orientação, linguagem interna exposta, excesso de controles simultâneos, workspace móvel apertado e acessibilidade de diálogos inadequada.

- Conclusão estimada do que deveria existir até 9.5-06: **72% (±8 p.p.; confiança média)**.
- Nota UX atual: **4,4/10**.
- Nota possível corrigindo apenas o que já existe, sem iniciar a Etapa 10: **7,2/10**.
- Condição para iniciar a Etapa 10: **NÃO**.
- Se publicado hoje: **protótipo funcional**, não produto final.
- Se eu fosse o público-alvo, continuaria usando? **PROVAVELMENTE NÃO**. Eu exploraria o 2D, mas o 3D e a complexidade exposta reduziriam rapidamente a confiança no resultado.

## Método e evidências

A avaliação combinou:

- leitura integral do Plano Mestre e dos gates de recuperação;
- exploração em Chrome real automatizado por Playwright e inspeção visual das capturas;
- desktop 1440×900, notebook 1366×768, janela 900×700, mobile 390×844 e mobile horizontal 844×390;
- toque simulado, teclado, tabulação, clique fora, `Esc`, fechamento, cancelamento, zoom, pan, órbita 3D, arraste 2D, undo/redo, exportação SVG, autosave e recarga;
- testes unitários, type-check, build, regressões de canvas e análise de bundle;
- inspeção de arquitetura apenas para explicar os sintomas percebidos.

Artefatos principais:

- `artifacts/current-audit/product-ux/product-ux-audit.json`: inventário bruto de estados, controles, performance e interações;
- `artifacts/current-audit/product-ux/*.png`: 21 capturas dos viewports e fluxos;
- `artifacts/current-audit/verify-2d-3d.mjs`: verificação reprodutível de arraste 2D → mudança 3D → desfazer;
- `artifacts/current-audit/verify-modes-persistence.mjs`: modos e persistência;
- `artifacts/current-audit/bundle/bundle-fallback-current.md`: bundle;
- `artifacts/current-audit/architecture/source-inventory.md`: inventário do código.

Limites: não houve teste com leitor de tela real, dispositivo físico, usuário externo, Lighthouse ou backend WASM, pois a ferramenta `wasm-pack`/Rust não está disponível neste ambiente. Métricas de interação são sintéticas e servem como sinal, não como telemetria de produção.

## Critérios externos usados

- As heurísticas de Nielsen exigem visibilidade do estado, controle e liberdade, prevenção/recuperação de erros, consistência, reconhecimento em vez de memorização e design minimalista: https://www.nngroup.com/articles/ten-usability-heuristics/
- Progressive disclosure recomenda manter recursos primários visíveis e adiar opções secundárias até elas serem necessárias: https://www.nngroup.com/articles/progressive-disclosure/
- WCAG 2.2 orienta foco, alternativa a gestos de arrastar e targets de tamanho mínimo: https://www.w3.org/WAI/WCAG22/Understanding/ e https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/
- Apple HIG reforça undo/redo, feedback imediato e acessibilidade: https://developer.apple.com/design/human-interface-guidelines/undo-and-redo, https://developer.apple.com/design/human-interface-guidelines/feedback e https://developer.apple.com/design/human-interface-guidelines/accessibility
- Material Design descreve estados de interação coerentes: https://m3.material.io/foundations/interaction/states/overview
- A referência de INP considera até 200 ms bom, 201–500 ms melhorável e acima de 500 ms ruim: https://web.dev/articles/optimize-inp

# A. Resumo executivo

O melhor do Moldeon é que há um núcleo de edição que responde: pontos arrastam, ferramentas de modelagem mudam de estado, zoom/pan funcionam, o 3D reage a mudanças, undo restaura a geometria, SVG baixa e o trabalho reaparece após recarga. O editor 2D passa a sensação de uma ferramenta real.

O que derruba a vontade de continuar é o que o usuário vê antes de descobrir essa base:

1. a aplicação abre com uma saia já carregada, sem boas-vindas nem explicação de objetivo;
2. três modos, seis ferramentas, ações globais, lista de peças, canvas, painel 3D vazio, inspector e status técnico aparecem cedo demais;
3. o texto “Manequim 3D ainda indisponível” significa apenas “a prévia ainda não foi solicitada”, gerando falso diagnóstico;
4. ao abrir a camiseta no 3D, a roupa apresenta rasgos, buracos, sobreposições e caimento que não parece uma camiseta;
5. no mobile, a toolbar domina a tela e o canvas 2D fica com apenas 195 px de altura;
6. conceitos como anchors, grupos, bordas, `front/back/side`, fallback TypeScript e isolamento vazam para a experiência principal;
7. modais visualmente bons falham na experiência por teclado.

O produto tem mais capacidade do que qualidade percebida. A prioridade correta agora é tornar compreensível e confiável o que já existe.

# B. Estado do projeto até 9.5-06

Há uma divergência de governança que impede certificar a etapa declarada:

- o arquivo `docs/progress/RECOVERY_9_5_05_MODELING_OPERATIONS.md` declara 9.5-05 “aguardando aprovação manual” e 9.5-06 fora do escopo;
- o mesmo arquivo diz explicitamente para não avançar a 9.5-06 sem aprovação manual;
- a branch observada é `recovery/9.5-05-modeling-operations`, não uma branch/gate 9.5-06;
- `docs/progress/RECOVERY_GATE_BEFORE_PROMPT_10.md` mantém o Prompt/Etapa 10 bloqueado.

Por capacidade observada:

| Área esperada | Estado real | Conclusão estimada |
|---|---|---:|
| Bancada/editor 2D | Funcional, rico e testado; ainda denso e monolítico | 85% |
| Operações de modelagem | Recorte, pence, medidas e costura respondem; ergonomia ainda exige conhecimento | 80% |
| Biblioteca/moldes-base | Boa seleção e criação, mas linguagem técnica e primeiro uso sem guia | 82% |
| Manga guiada | Wizard existe e abre; conteúdo expõe IDs internos; confirmação final não foi certificada nesta rodada | 68% |
| Montagem semântica | Presente, mas conceitos internos e painel sobrecarregado | 65% |
| Prova/3D | Integração e câmera funcionam; resultado visual não é confiável como roupa | 42% |
| Persistência/exportação | Autosave e restauração passaram; SVG passou | 85% |
| Mobile | Sem overflow global e com gestos, mas workspace real é inadequado | 45% |
| Acessibilidade | Semântica parcial; foco/modal e targets falham | 35% |
| Gate/documentação | Branch e documento não comprovam 9.5-06 aprovada | 35% |

Estimativa ponderada: **72%**, com incerteza de ±8 pontos por não existir uma definição local aprovada de 9.5-06 neste checkout.

# C. Nota geral de UX

| Dimensão | Nota /10 | Justificativa curta |
|---|---:|---|
| Aparência | 5,8 | Base visual sóbria e organizada; 3D e painéis densos parecem protótipo |
| Clareza | 4,0 | Propósito existe, caminho inicial e terminologia não são claros |
| Facilidade de aprendizado | 3,5 | Exige conhecer modelagem, costura e conceitos internos cedo |
| Facilidade de uso | 4,4 | Fluxos centrais funcionam, mas há muitas decisões e mudanças de contexto |
| Velocidade percebida | 5,3 | 2D geralmente responde; 3D abre em ~1,6 s e houve eventos de até 336 ms |
| Fluidez | 5,2 | Zoom, pan e órbita funcionam; long tasks e reconstruções aparecem |
| Consistência | 4,6 | Mistura modais próprios, prompts nativos, textos técnicos e estados ARIA inconsistentes |
| Confiabilidade | 5,8 | Testes, build, undo e autosave passam; visual 3D reduz confiança |
| Desktop | 5,4 | Usável, mas denso e com painel 3D/assembly apertado |
| Mobile | 2,8 | Acessível em largura, mas pouco espaço de trabalho e toolbar cortada |
| Editor 2D | 6,4 | Parte mais forte e funcional do produto |
| Sistema 3D | 2,4 | Câmera funciona, representação da roupa não é aceitável |
| Integração 2D/3D | 4,7 | Tecnicamente funciona; feedback e qualidade visual não dão segurança |
| Acessibilidade | 3,0 | Modal/foco e targets são falhas significativas |
| Eficiência avançada | 5,2 | Undo/redo e manipulação direta ajudam; excesso de cliques e campos repetidos cansam |
| Qualidade percebida | 3,8 | O 3D e a linguagem interna dominam a impressão final |

**Nota UX geral ponderada: 4,4/10.**

# D. O que está muito bom

- Arraste real de ponto no 2D alterou a geometria; o 3D mudou e Undo restaurou exatamente `{x:0, y:88}`.
- Autosave em OPFS restaurou Frente, Costas e Manga após recarregar.
- Exportação SVG gerou `camiseta-basica.svg`.
- Biblioteca de moldes tem cartões claros, estados indisponíveis e segundo nível de configuração.
- Canvas oferece zoom, enquadramento, mão/pan e instruções contextuais.
- Testes automatizados cobrem bastante domínio: 59 arquivos e 344 testes passaram.
- O 3D é carregado sob demanda, reduzindo o peso da entrada inicial.

# E. O que está aceitável

- Visual geral desktop é neutro, legível e coerente.
- Modos Modelagem, Montagem e Prova respondem ao clique.
- Fechar por X e clique fora funcionou na biblioteca; X/voltar do painel direito ocultam o painel.
- Ferramentas Costurar, Recortar, Pence e Medir mostram instruções contextuais e Cancelar.
- Controles inválidos costumam estar desabilitados, como Redo antes de haver histórico e − Ponto sem seleção.
- Mobile evita overflow horizontal da página como um todo e separa 2D, 3D e Medidas em abas.

# F. O que está ruim

- Primeira tela não ensina o que é Moldeon nem qual primeiro resultado o usuário obterá.
- A saia preexistente parece um projeto desconhecido, não um exemplo intencional.
- 77 controles foram encontrados no estado inicial desktop; após criar camiseta, 98; no fitting, 117.
- O painel 3D vazio ocupa espaço antes de ter valor.
- Os modos não são espacialmente claros: voltar a Modelagem mantém o 3D montado e visível.
- Mensagens de domínio e infraestrutura competem com ações do usuário.
- A lista de costuras comprime input, select e três ações por linha.

# G. O que está muito ruim

- O 3D da camiseta parece tecido rasgado e atravessando/contornando incorretamente o manequim.
- No mobile, a roupa ampliada evidencia buracos e painéis longos; não se reconhece uma camiseta confiável.
- Diálogos abrem sem mover o foco; Tab percorre controles atrás do modal; `Esc` não fechou biblioteca, manga ou fitting nos ensaios.
- Em 390×844, o canvas 2D mede só 390×195; a toolbar esconde parte de “Pence” e não comunica que há mais ferramentas lateralmente.
- A branch/gate atual não comprova conclusão de 9.5-06.

# H. Funcionalidades faltando no escopo de qualidade atual

Não recomendo adicionar novos recursos. Faltam propriedades básicas de produto às capacidades existentes:

- onboarding/primeiro uso e explicação do fluxo 2D→3D;
- tratamento correto de foco e teclado em todos os diálogos;
- indicação visível de overflow da toolbar móvel;
- feedback claro de “atualizando 3D” e “3D atualizado”;
- desmontagem/liberação real do 3D ao fechar;
- mensagem de estado vazio correta para prévia ainda não solicitada;
- alternativa organizada aos conceitos internos de montagem;
- validação E2E atualizada para o fluxo real da biblioteca;
- ambiente verificável do backend WASM/Rust.

# I. Funcionalidades incompletas

- Prova 3D: funcional como render, incompleta como representação confiável de roupa.
- Fechamento 3D: incompleto; oculta, mas mantém o canvas/componente montado.
- Modais: completos por mouse, incompletos por teclado e foco.
- Mobile: responsivo em largura, incompleto como ambiente de edição.
- Estados de ferramenta: ativos visualmente, mas `aria-pressed` só é consistente em Costurar e Desenhar.
- Sleeve wizard: visualmente estruturado, mas expõe IDs de conectores e linguagem de implementação.
- Modos: alteram painéis, mas não deixam claro o que será preservado ou encerrado.

# J. Botões que não funcionam

Não encontrei botão primário completamente morto nos fluxos amostrados. Isso não significa que todas as combinações dinâmicas foram certificadas.

Parcialmente funcionais ou com efeito divergente da expectativa:

| Controle | Evidência | Parecer |
|---|---|---|
| `Esc` em Biblioteca | modal permaneceu aberto | não funciona no ensaio real |
| `Esc` em Adicionar manga | modal permaneceu aberto | não funciona no ensaio real |
| `Esc` em Corpo e tecido | modal permaneceu aberto | não funciona no ensaio real |
| Recolher/Voltar do 3D | painel some, `canvas.three-canvas` continua no DOM | fechamento parcial |
| Modelagem após Prova | modo muda, 3D continua visível/montado | comportamento confuso |
| Script E2E Prompt 09 | espera diálogo desaparecer após clicar cartão; UX atual exige “Criar molde” | teste morto/desatualizado, não botão morto |

# K. Controles desnecessários, redundantes ou prematuros

- `Núcleo`, `Render` e `Isolamento` no status bar: diagnósticos de engenharia, não ações de produto; mover para modo diagnóstico.
- Mostrar painel 3D vazio desde o início: adiar até o usuário pedir Prova ou selecionar um molde elegível.
- Controles de anchor e termos de superfície/lado em primeiro nível de Prova: esconder em “Ajustes avançados”.
- Ações Desativar/Inverter/Excluir em cada costura: usar seleção + editor contextual ou menu por linha.
- Rótulos duplicados de fechamento (“Recolher painel”, “Recolher”, “Voltar à bancada”): unificar por contexto.
- `Restaurar`: visível apenas em desktop muito largo, não explica o que será restaurado e não pede confirmação.
- Modos + ferramentas + ações globais na mesma faixa superior: criar hierarquia sem remover capacidade.

# L. Problemas de layout

- Toolbar móvel ocupa cerca de 285 px antes das abas.
- Canvas móvel ocupa 23% da altura do viewport testado.
- Overflow horizontal da faixa de ferramentas é silencioso; “Pence” aparece cortado.
- Painel de costuras desktop trunca nomes e selects.
- Preview desktop 360×339 é pequeno para julgar caimento e defeitos.
- Janela 900×700 aumenta a competição entre painel, canvas e toolbar.
- Espaço vazio abaixo do canvas móvel não é convertido em área útil de edição.

# M. Problemas de fluidez

- Abertura do 3D: ~1,6 s no fluxo desktop.
- Long task máxima observada: 595 ms no cenário desktop; 391 ms no mobile.
- A órbita e zoom responderam e alteraram a imagem, mas a primeira montagem tem pausa perceptível.
- O gesto 2D→3D produziu atualização correta; a automação incluiu deslocamento deliberadamente lento, portanto os 2,969 s medidos não devem ser usados como latência pura. O que falta é um indicador confiável de atualização.
- Fechar painel não libera o renderer; isso pode acumular custo e irritação em sessões longas.

# N. Problemas de performance

- Pior Event Timing observado: 336 ms desktop — faixa “precisa melhorar”. Nos demais viewports, 112–128 ms.
- 11 long tasks no cenário desktop completo.
- Heap usado após fluxo desktop: ~56,2 MB; mobile: ~55,8 MB. Não prova vazamento isoladamente.
- Bundle total: 1,75 MiB bruto/490,1 KiB gzip; entrada inicial 159,7 KiB gzip.
- Chunks 3D somam peso relevante (`three.webgpu` 153,6 KiB gzip; viewport 100,6 KiB; core 52,8 KiB), mas estão adiados — decisão positiva.
- O componente 3D permanece montado escondido, reduzindo o benefício do carregamento sob demanda em sessões alternadas.

# O. Problemas mobile

- Área útil 2D insuficiente para precisão.
- Muitos targets têm 29–36 px; passam em vários casos pelo mínimo WCAG de 24 px, mas ficam abaixo de um alvo touch confortável próximo de 44–48 px.
- Ferramentas escondidas sem affordance de rolagem.
- “Vestir no manequim” ocupa linha própria e amplia o cabeçalho.
- Para comparar 2D e 3D é necessário trocar abas; não há sinal persistente de que a alteração 3D terminou.
- A visualização 3D fica grande e orbitável, mas evidencia mais os defeitos da malha.
- Status técnico ocupa pixels escassos.
- A experiência é a interface desktop reorganizada, não um fluxo móvel priorizado.

# P. Problemas desktop

- Três níveis de navegação/ação no topo competem por atenção.
- Painel 3D vazio rouba largura do canvas.
- Painel Assembly repete muitos controles pequenos.
- Atalhos são pouco descobríveis; somente Undo/Redo têm títulos claros de teclado.
- Não há uma ação “novo projeto”/“começar” evidente; Moldes é o caminho real, mas não domina a hierarquia.
- Foco visível padrão de 1 px preto em vários controles é fraco no cabeçalho escuro.

# Q. Problemas do editor 2D

Pontos fortes: manipulação direta real, seleção, zoom, pan, recorte, pence, medida, costura, histórico e propriedades.

Problemas:

- densidade de pontos, linhas de construção, rótulos e margens pode cansar após 30 minutos;
- ferramenta ativa nem sempre é anunciada semanticamente;
- Desenhar e Renomear usam `window.prompt`, quebrando a continuidade visual e móvel;
- Delete usa confirmação nativa, enquanto outros fluxos usam UI própria;
- snapping não é explicitado ao usuário; previsibilidade depende de tentativa;
- múltiplos modos de seleção e peça ativa exigem compreensão prévia;
- componente legado de 2.507 linhas aumenta o risco de regressões de gesto e estado.

# R. Problemas do sistema 3D

- A roupa não tem aparência plausível em camiseta: buracos, painéis alongados, sobreposição e abertura de costuras.
- Manequim segmentado parece placeholder/proxy visível, não avatar final.
- Mensagens dizem “Manequim vestido” mesmo quando o resultado não parece vestido corretamente.
- O sistema informa oito bordas abertas, mas permite apresentar a cena como resultado principal.
- A câmera funciona, mas faltam controles explícitos de reset/enquadramento 3D.
- Fechamento não desmonta renderer e recursos.
- Warnings de WebGPU→WebGL2 chegam ao console; fallback funciona, mas status técnico não deve ser interface principal.

# S. Problemas na sincronização 2D/3D

- A integração técnica passou: mover ponto mudou pixels do 3D e Undo restaurou 2D.
- Não há feedback de processamento/conclusão; o usuário pode perguntar “atualizou?”.
- A qualidade visual ruim torna impossível julgar se a atualização é correta, ainda que tecnicamente tenha ocorrido.
- Mobile impede observação simultânea.
- `simulateVersion` não mudou durante o arraste testado; o renderer reagiu à geometria, mas não há contrato visual explícito entre edição e eventual recálculo físico.
- Alternar modos preserva cena sem explicar continuidade.

# T. Problemas de acessibilidade

- Foco inicial permanece no botão de fundo ao abrir modais.
- Tab escapa imediatamente e percorre controles atrás do diálogo.
- Não há focus trap nem retorno de foco explícito.
- `Esc` falhou nos três modais testados, apesar de listeners existirem.
- Estado ativo das ferramentas não usa `aria-pressed` de forma consistente.
- Muitos targets touch são menores que 44 px.
- Operações de mover ponto têm alternativa numérica no Inspector; outras operações complexas de canvas não têm fluxo completo de teclado demonstrado.
- Foco customizado forte existe em alguns componentes; vários controles dependem do outline padrão pouco contrastante.
- Não há evidência de teste automatizado com axe nem teste com leitor de tela.

# U. Problemas arquiteturais

- `PatternCanvasLegacy.tsx` (2.507 linhas), `styles.css` (2.305), `patternDocumentV3.ts` (1.739) e `editorStore.ts` (1.446) concentram muitas responsabilidades.
- Canvas moderno e legado coexistem, elevando risco de comportamento divergente.
- Estado de modo, preview solicitado, painel aberto e aba móvel são variáveis separadas; o caso “Modelagem com 3D ainda montado” é sintoma dessa máquina de estados implícita.
- Três implementações de modal não compartilham um primitive acessível único.
- Prompts/confirm/alert nativos contornam o design system.
- Renderer 3D recebe `active=false`, mas só é destruído no unmount.
- Documentação de recuperação e branch não representam o estágio declarado pelo briefing.

# V. Dívida técnica

- 47.405 linhas rastreadas no inventário; seis marcadores TODO/FIXME/HACK e cinco arquivos de compatibilidade temporária/depreciação.
- Um campo de domínio mantém `easeRatio` como placeholder futuro.
- Teste E2E do Prompt 09 está desalinhado do novo botão “Criar molde”.
- Ausência de script de lint no `package.json` raiz.
- Ferramentas Rust/wasm-pack não reproduzíveis neste ambiente.
- Três snapshots aparecem como modificados apenas por normalização LF→CRLF; `git diff` permanece vazio. É ruído operacional a corrigir na configuração, não mudança de conteúdo desta auditoria.

# W. Testes ausentes ou incompletos

- Acessibilidade automatizada e leitor de tela.
- E2E de foco, `Esc`, focus trap e retorno de foco.
- E2E de todos os modos após abrir/fechar 3D.
- Verificação de unmount/dispose WebGL/WebGPU.
- Regressão visual da roupa 3D com critérios de plausibilidade.
- Teste mobile que imponha área mínima útil de canvas e visibilidade/descoberta de ferramentas.
- Teste de produção servindo `dist` e Lighthouse.
- CI reproduzível para Rust/WASM neste ambiente.
- Teste E2E atualizado do catálogo após introdução do passo “Criar molde”.
- Sessão longa para memória/CPU e alternância repetida 2D↔3D.

# X. Riscos para as cinco etapas restantes

1. Construir recursos futuros sobre uma máquina de estados implícita ampliará inconsistências entre modo, painel e preview.
2. Evoluir gestos dentro do canvas legado monolítico aumentará regressões de seleção, zoom, touch e histórico.
3. Melhorar física sem primeiro definir um contrato visual de “roupa válida” pode produzir mais cálculo sem mais confiança.
4. Adicionar recursos ao toolbar móvel agravará a perda de espaço e discoverability.
5. Cada novo modal repetirá os defeitos de foco sem um primitive acessível comum.
6. A camada de documento/store grande torna migrações e undo transacional mais frágeis.
7. Falta de toolchain WASM reproduzível pode mascarar divergência entre fallback TypeScript e backend alvo.
8. Testes E2E desatualizados podem dar falsa segurança ou bloquear mudanças legítimas.
9. Manter diagnósticos técnicos na UI incentiva novas telas orientadas à implementação, não ao trabalho do usuário.
10. Um 3D visualmente ruim pode invalidar testes com usuários de todas as etapas seguintes, porque eles abandonarão antes de avaliar as novas capacidades.

## Mapa da interface real

| Área/tela | Status | Objetivo | Controles aprox. | Principais fricções |
|---|---|---|---:|---|
| Primeira bancada | ruim | editar molde existente | 77 | sem onboarding, saia inesperada, painel 3D falso-vazio |
| Toolbar/modos | ruim | alternar trabalho e ferramentas | 16–18 | hierarquia fraca, overflow mobile, termos especializados |
| Biblioteca de moldes | boa | escolher base e medidas | 15–35 | foco falho, descrições técnicas, passo Criar molde pouco destacado |
| Editor/canvas 2D | aceitável | editar geometria | 12 + pontos/peças | denso, aprendizado alto, bom núcleo funcional |
| Lista de peças | aceitável | selecionar, ocultar, bloquear e menu | 5 por peça | ícones compactos, muitos alvos pequenos |
| Inspector | aceitável | editar medidas/propriedades | 10–30 | muita informação permanente, linguagem de domínio |
| Montagem/costuras | ruim | unir bordas e preparar 3D | 5 por costura | linhas comprimidas, ações repetidas, termos internos |
| Wizard de manga | aceitável | gerar manga guiada | ~25 | visual bom, IDs internos e confirmação técnica |
| Corpo e tecido | boa | configurar corpo/tecido/posição | ~35 | grande quantidade de campos, modal sem foco correto |
| Preview 3D desktop | crítica | validar roupa no manequim | câmera por gesto + fechar | roupa visualmente quebrada, viewport pequeno |
| Preview 3D mobile | crítica | inspecionar roupa | câmera por gesto + voltar | roupa quebrada domina a tela, sem comparação simultânea |
| Status bar | ruim | mostrar backend/salvamento | 0 ações | diagnóstico técnico ocupa espaço; autosave é útil |
| Empty state real | boa | iniciar sem peças | 2 | clara, mas não é o estado inicial que o usuário vê |

## Matriz de controles

Controles repetidos por peça, costura, medida ou tecido são agrupados; o JSON bruto contém a listagem por instância e coordenada.

| Controle | Local | Função | Funciona? | Feedback | Mobile/Desktop | Redundante/confuso | Severidade | Ação recomendada |
|---|---|---|---|---|---|---|---|---|
| Modelagem | topo | modo de edição | sim | ativo visual | ambos | preserva 3D sem explicar | médio | definir contrato de modo |
| Montagem | topo | costuras/assembly | sim | ativo + painel | ambos | conceitos internos | alto | linguagem orientada à tarefa |
| Prova | topo | abrir vestir/3D | sim | ativo + 3D | ambos | sobrepõe “Vestir” | médio | clarificar diferença/combinar |
| Selecionar | ferramentas | seleção | sim | classe ativa, sem ARIA | ambos | não | médio | `aria-pressed` consistente |
| Costurar | ferramentas | unir bordas | sim | ativo + contexto | ambos | técnico | médio | fluxo guiado/contextual |
| Desenhar | ferramentas | nova peça | sim | prompt + banner | ambos | prompt nativo | médio | diálogo inline consistente |
| Recortar | ferramentas | corte interno | sim em regressão | ativo + contexto | ambos | instrução longa | médio | ajuda progressiva |
| Pence | ferramentas | criar pence | sim em regressão | ativo + contexto | ambos | cortado no mobile | alto | tornar acessível/visível |
| Medir | ferramentas | distância | sim | ativo + contexto | ambos | não | baixo | manter |
| Adicionar manga | ações | abrir wizard | abre | modal | ambos | status/contexto técnico | médio | simplificar termos |
| Moldes | ações | abrir biblioteca | sim | modal | ambos | ação inicial pouco dominante | alto | CTA primário inicial |
| Corpo e tecido | ações | abrir fitting | sim | modal | ambos | nome cobre muitas tarefas | médio | separar por progressive disclosure |
| Undo | ações | desfazer | sim | disabled/resultado | ambos | não | baixo | manter |
| Redo | ações | refazer | sim em regressão | disabled/resultado | ambos | não | baixo | manter |
| Exportar SVG | ações | baixar molde | sim | download do navegador | ambos | rótulo reduzido a SVG | baixo | confirmar exportação inline |
| Restaurar | ações | reset | handler direto | mudança | desktop largo | oculto e destrutivo | alto | explicar + confirmar + undo |
| Vestir no manequim | ações | montar/abrir 3D | sim | pausa + 3D | ambos | compete com Prova | alto | consolidar hierarquia |
| Recolher/Voltar | painel | ocultar painel | parcial | painel some | ambos | não desmonta 3D | alto | unmount/dispose real |
| Aba Molde 2D | mobile | mostrar editor | sim | selected | mobile | necessária | baixo | manter |
| Aba Manequim 3D | mobile | mostrar preview | sim | selected | mobile | sem feedback de atualização | médio | badge de estado |
| Aba Medidas/Montagem | mobile | mostrar inspector | sim | selected | mobile | rótulo muda por modo | médio | preservar localização e contexto |
| + peça | lista | criar peça | sim | prompt/draft | ambos | ícone pouco explicativo | médio | label/tooltip e diálogo próprio |
| selecionar peça | lista | ativar peça | sim | radio/active | ambos | seleção ativa vs multisseleção | médio | distinguir estados |
| mostrar/ocultar peça | lista | visibilidade | sim | ícone/pressed | ambos | alvo pequeno | médio | target maior |
| bloquear peça | lista | lock | sim | ícone/pressed | ambos | símbolo pouco claro | médio | tooltip/target maior |
| menu … por peça | lista | duplicar/espelhar/rotacionar/renomear/excluir | sim por implementação/regressões | popover | ambos | necessário, denso | baixo | manter contextual |
| + Ponto | canvas | inserir ponto | sim | modo ativo | ambos | sem ARIA ativo | médio | estado consistente |
| − Ponto | canvas | remover selecionado | sim | disabled contextual | ambos | risco acidental | médio | garantir undo/feedback |
| zoom −/%/+ | canvas | zoom | sim | percentual | ambos | targets pequenos | médio | ampliar touch |
| Enquadrar tudo/seleção | canvas | câmera 2D | sim | movimento | ambos | bons, rótulos longos | baixo | manter/ícones + tooltip |
| Mão | canvas | pan | sim | pressed | ambos | alterna com fundo-arrastar | baixo | explicar apenas uma vez |
| Cancelar contextual | barra | cancelar ferramenta | sim | volta seleção | ambos | bom | baixo | manter |
| campos do Inspector | direita | coordenadas/margem/medidas | sim | atualização 2D | ambos | muitos simultâneos | médio | mostrar por seleção |
| selecionar costura | Montagem | focar costura | sim | check/pressed | ambos | linha compacta | médio | linha mais clara |
| nome/tratamento costura | Montagem | editar metadados | sim | imediato | ambos | select truncado | alto | editor contextual |
| Desativar/Inverter/Excluir | Montagem | ações de costura | sim por implementação | texto muda/remoção | ambos | repetitivo e apertado | alto | menu secundário |
| Ajustes avançados | Montagem | placement/anchor | abre | disclosure nativo | ambos | correto esconder | baixo | manter, traduzir termos |
| X de modais | modais | fechar | sim por mouse | modal some | ambos | foco não retorna | alto | primitive acessível |
| clique fora | modais | fechar | sim | modal some | ambos | pode perder formulário | médio | só onde seguro |
| Esc de modais | modais | fechar | não no ensaio | nenhum | teclado | parece suportado, falha | alto | corrigir e testar |
| Cancelar/Criar molde | biblioteca | sair/confirmar | sim | fecha e carrega | ambos | Criar exige segundo passo | baixo | tornar progressão evidente |
| tabs Corpo/Tecidos/Posição | fitting | organizar configuração | sim | pressed | ambos | bom disclosure | baixo | manter |
| presets/inputs fitting | fitting | configurar | sim visualmente | seleção/campos | ambos | alta densidade | médio | resumo + avançado |
| câmera 3D por drag/wheel | 3D | orbitar/zoom | sim | visual | ambos | sem reset explícito | médio | adicionar reset já dentro do recurso existente |

## Registro classificado de problemas

| ID | Problema/classificação | Evidência | Arquivo/componente | Plano | Impacto usuário/técnico | Causa provável | Correção recomendada |
|---|---|---|---|---|---|---|---|
| P01 | **CRÍTICO · incompleto/governança**: 9.5-06 não certificada | branch 9.5-05; gate aguarda aprovação | docs de recovery | gate pré-10 | avanço sem base aprovada | checkout/documentação divergentes | concluir/aprovar gates, sem iniciar 10 |
| P02 | **CRÍTICO · visual/UX**: roupa 3D quebrada | capturas desktop/mobile | GarmentViewport/assemblies | prova 3D | abandono e perda de confiança | montagem/costuras/placement incompletos | impedir “vestido” inválido e corrigir montagem existente |
| P03 | **ALTO · UX/mobile**: canvas 195 px | medição 390×844 | styles.css/layout | mobile | edição imprecisa/frustrante | toolbar desktop empilhada | priorizar canvas e ações contextuais |
| P04 | **ALTO · acessibilidade**: modal sem foco/escape | Tab atrás; Esc falhou 3× | três Dialogs | qualidade transversal | teclado inviável | primitive modal duplicado/incompleto | componente modal único com foco/trap/return |
| P05 | **ALTO · UX**: primeiro uso sem direção | saia inesperada + 77 controles | App/Toolbar | onboarding/qualidade | abandono nos primeiros minutos | estado inicial orientado a demo | entrada intencional com CTA Moldes/continuar exemplo |
| P06 | **ALTO · UX**: linguagem interna exposta | anchors, grupos, IDs, fallback | Assembly/Sleeve/Status | montagem | usuário precisa saber engenharia | UI espelha domínio | traduzir e esconder diagnóstico |
| P07 | **ALTO · UX**: excesso simultâneo | 98–117 controles | Toolbar/App/panels | progressive disclosure | fadiga/carga cognitiva | todas capacidades em primeiro nível | contexto e opções avançadas |
| P08 | **ALTO · performance/frágil**: 3D não desmonta | canvas permanece no DOM | App/GarmentViewport | performance | custo em sessão longa | ocultar via `active`/`hidden` | unmount/dispose no fechar |
| P09 | **ALTO · consistência**: modos não encerram contexto | Modelagem mantém 3D | App state | arquitetura UX | modelo mental quebrado | máquina de estados implícita | estado explícito e transições documentadas |
| P10 | **MÉDIO · UX**: prompts nativos | criar/renomear/delete | App.tsx | editor | experiência de protótipo | atalhos de implementação | diálogo/form inline consistente |
| P11 | **MÉDIO · acessibilidade**: estados/targets | ARIA parcial, 29–36 px | Toolbar/styles | WCAG/mobile | toque/teclado piores | estilos fragmentados | tokens mínimos e ARIA uniforme |
| P12 | **ALTO · UX**: painel costura comprimido | nomes/selects truncados | AssemblyPanel | montagem | erros e lentidão repetitiva | cinco controles por linha | seleção + detalhe contextual |
| P13 | **MÉDIO · feedback**: 2D→3D silencioso | pixels mudam, sem status | viewport/store | integração | dúvida “atualizou?” | sem estado visual de pipeline | updating/updated/error não intrusivo |
| P14 | **ALTO · dívida técnica**: canvas/store gigantes | 2.507/1.446 linhas | Legacy/store | próximas etapas | regressões e jank | responsabilidades concentradas | extrair máquina de gesto/seleção/histórico |
| P15 | **MÉDIO · testes**: E2E desatualizado | Prompt09 falha no passo novo | script browser | gate | falsa confiança | fluxo mudou sem teste | atualizar contrato E2E |
| P16 | **ALTO · toolchain**: WASM não verificável | wasm-pack/cargo ausentes | scripts/crate | backend | divergência de produção | setup não reproduzível | provisionar e validar CI/local |
| P17 | **ALTO · prevenção de erro**: Restaurar sem confirmação | handler direto | Toolbar/App | controle/liberdade | perda acidental | ação tratada como secundária | confirmação específica e undo |
| P18 | **MÉDIO · feedback**: estado 3D falso | “indisponível” antes de solicitar | ViewportPlaceholder | primeira impressão | usuário acredita haver falha | mensagens misturam estado e elegibilidade | “Prévia não aberta” + CTA |

## Teste dos cinco minutos — cronologia

1. Abri a aplicação. Vi uma saia, três modos, seis ferramentas, vários painéis e status técnico. Entendi que era modelagem, mas não soube se a saia era minha, exemplo ou estado restaurado.
2. Procurei por onde começar. “Moldes” pareceu provável, mas compete com Montagem, Prova e Vestir.
3. Abri Moldes. Os cartões foram a parte mais clara; escolhi Camiseta básica e precisei perceber o segundo botão “Criar molde”.
4. Voltei para uma bancada densa com Frente, Costas e Manga. O desenho 2D pareceu competente, mas pontos, linhas e painéis exigem familiaridade.
5. Testei Costurar, Recortar, Pence e Medir. Os estados contextuais ajudaram; Desenhar abriu prompt nativo e quebrou a sensação de produto integrado.
6. Abri Adicionar manga. O wizard parecia bem desenhado, até mostrar IDs extensos de conectores — momento claro de “ferramenta interna”.
7. Abri Corpo e tecido. As abas e presets foram positivos; a quantidade de campos é alta, mas há organização.
8. Cliquei Vestir no manequim. Esperei ~1,6 s. O manequim apareceu, porém a camiseta parecia rasgada/aberta. Este é o principal momento de abandono.
9. Orbitei e dei zoom; os gestos funcionaram. No zoom/mobile, os defeitos ficaram mais evidentes.
10. Arrastei um ponto no 2D. O 3D mudou e Undo restaurou — surpresa positiva, mas sem feedback explícito de conclusão.
11. Recolhi o 3D. Ele sumiu visualmente, mas permaneceu montado. Recarreguei e a camiseta foi restaurada — outra surpresa positiva.

Conclusão dos cinco minutos: há um “aha” técnico no 2D e na sincronização, mas ele acontece depois de duas fortes fontes de abandono: complexidade inicial e 3D sem credibilidade.

## Usuário experiente por várias horas

Atritos cumulativos:

- alternar ferramentas e painéis no topo repetidamente;
- percorrer muitas costuras com três ações por linha;
- prompts nativos para operações recorrentes;
- targets pequenos e toolbar horizontal;
- falta de atalhos descobríveis além de undo/redo;
- ruído visual de pontos/linhas sempre presentes;
- alternar 2D/3D móvel sem comparação;
- cenas 3D permanecendo montadas após recolher;
- ter de interpretar warnings/anchors em vez de receber orientação de correção;
- dúvida recorrente sobre quando o 3D terminou de atualizar.

No desktop, eu suportaria 30 minutos para avaliar o editor 2D. Para várias horas de trabalho profissional, os microatritos e a baixa confiança no 3D impediriam adoção. No mobile, eu abandonaria muito antes.

## Backlog executável, na ordem recomendada

### P0 — bloqueadores

| Ordem | Item | Arquivos prováveis | Dependências | Dificuldade | Impacto UX | Risco |
|---:|---|---|---|---|---|---|
| 1 | Reconciliar branch/gates e certificar 9.5-05/9.5-06 | docs/progress, CI | aprovação manual | baixa/média | confiança de release | baixo |
| 2 | Definir critério de “roupa apresentável” e não exibir como vestido quando montagem é inválida | GarmentViewport, AssemblyPanel, eligibility | fixtures/costuras | alta | remove maior motivo de abandono | alto |
| 3 | Corrigir montagem visual da camiseta existente, incluindo cavas, mangas e bordas abertas | garment3d, templateCatalog, assembly | P2 | alta | confiança no valor central | alto |
| 4 | Criar primitive modal acessível e migrar os três modais | Dialogs/ModalPortal/styles | nenhuma funcional nova | média | teclado, mobile, confiança | médio |
| 5 | Tornar toolchain Rust/WASM reproduzível e executar gate completo | scripts, crate, CI | cargo/wasm-pack | média | confiabilidade técnica | médio |

### P1 — UX crítica

| Ordem | Item | Arquivos prováveis | Dependências | Dificuldade | Impacto UX | Risco |
|---:|---|---|---|---|---|---|
| 6 | Redesenhar primeiro estado usando recursos existentes: CTA Moldes, exemplo claramente rotulado ou bancada vazia | App, Toolbar, empty state | decisão de produto | média | reduz abandono inicial | baixo |
| 7 | Priorizar canvas no mobile e mover ações secundárias para contexto/overflow visível | styles, Toolbar, App | tokens touch | média/alta | transforma mobile em ferramenta | médio |
| 8 | Remover diagnósticos técnicos da superfície principal e traduzir anchors/IDs | StatusBar, Assembly, SleeveWizard | modo diagnóstico opcional | média | clareza/aprendizado | baixo |
| 9 | Simplificar hierarquia Modelagem/Montagem/Prova/Vestir sem eliminar funções | Toolbar, App | máquina de estados | média | reduz decisões | médio |
| 10 | Tornar estados de preview explícitos: não aberto, carregando, atualizando, atualizado, inválido | App, Viewport | pipeline 3D | média | previsibilidade 2D→3D | médio |
| 11 | Desmontar/dispor renderer ao fechar e testar alternância repetida | App, GarmentViewport | lifecycle Three | média | fluidez e memória | médio/alto |
| 12 | Reorganizar editor de costuras em lista + detalhe/menu contextual | AssemblyPanel/styles | seleção de costura | média | eficiência e menos erro | médio |
| 13 | Substituir prompt/confirm/alert nativos por UI existente e undo onde aplicável | App/components | primitive modal | média | consistência | baixo |
| 14 | Proteger Restaurar com explicação, confirmação e recuperação | Toolbar/store | histórico/reset | baixa/média | prevenção de perda | baixo |

### P2 — qualidade

| Ordem | Item | Arquivos prováveis | Dependências | Dificuldade | Impacto UX | Risco |
|---:|---|---|---|---|---|---|
| 15 | Uniformizar `aria-pressed`, foco visível e targets de 44 px nas ações touch | Toolbar/Pieces/Canvas/styles | tokens | média | acessibilidade | baixo |
| 16 | Adicionar reset/enquadramento à câmera 3D usando o sistema existente | GarmentViewport | câmera | baixa | recuperação espacial | baixo |
| 17 | Atualizar E2E da biblioteca e cobrir modos/modal/lifecycle | scripts/tests | itens anteriores | média | evita regressão | baixo |
| 18 | Adicionar regressão visual 3D e critérios de erro de costura | tests/artifacts | fixtures estáveis | alta | confiança contínua | médio |
| 19 | Extrair estado explícito de workspace/preview e reduzir acoplamento de App | App/state | contrato de modo | alta | consistência futura | alto |
| 20 | Fatiar PatternCanvasLegacy por gesto, câmera, hit-test e desenho sem alterar comportamento | editor | testes fortes | alta | reduz regressão/jank | alto |
| 21 | Adicionar lint e normalização de line endings | configs/package | CI | baixa | higiene técnica | baixo |
| 22 | Executar teste de produção, axe, leitor de tela e sessão longa | test infra | builds estáveis | média | qualidade real | baixo |

### P3 — polimento

| Ordem | Item | Arquivos prováveis | Dependências | Dificuldade | Impacto UX | Risco |
|---:|---|---|---|---|---|---|
| 23 | Reduzir ruído visual do canvas por zoom/seleção | Canvas/styles | nenhum | média | conforto prolongado | médio |
| 24 | Melhorar affordance de scroll horizontal móvel (fade/indicador) | styles/Toolbar | P7 | baixa | discoverability | baixo |
| 25 | Exibir confirmação discreta após exportar e restaurar | Toolbar/status/toast | feedback primitive | baixa | confiança | baixo |
| 26 | Revisar microcopy da biblioteca e wizard para iniciantes | Dialogs/catalog | glossário | baixa | aprendizado | baixo |
| 27 | Consolidar rótulos Recolher/Voltar/Mostrar | App/components | contrato de painel | baixa | consistência | baixo |

## Dez maiores problemas gerais

1. Roupa 3D não parece uma roupa válida.
2. Gate/branch não comprovam 9.5-06.
3. Mobile oferece área de edição 2D insuficiente.
4. Primeira experiência não explica propósito nem começo.
5. Modais são inadequados por teclado.
6. Linguagem interna/diagnóstica invade o produto.
7. Complexidade aparece toda ao mesmo tempo.
8. 3D é ocultado sem liberar recursos.
9. Estados Modelagem/Montagem/Prova não formam modelo mental consistente.
10. Toolchain WASM e cobertura E2E não são totalmente reproduzíveis/atuais.

## Dez maiores problemas especificamente de UX

1. O 3D reduz, em vez de aumentar, a confiança.
2. Não há caminho inicial inequívoco.
3. Toolbar móvel corta ferramentas e sufoca o canvas.
4. Usuário precisa entender anchors, grupos, bordas e IDs.
5. Foco permanece atrás do modal e `Esc` falha.
6. 98–117 controles podem coexistir sem hierarquia suficiente.
7. “Manequim indisponível” comunica erro quando a prévia só não foi aberta.
8. Prova e Vestir parecem duas formas concorrentes de fazer a mesma coisa.
9. Atualização 2D→3D não confirma estado/conclusão.
10. Prompts nativos e painel de costuras repetitivo irritam em uso prolongado.

## Problemas pequenos que escondem riscos maiores

- “Recolher” não desmontar → lifecycle 3D e máquina de estados incompletos.
- `Esc` falhar → ausência de um primitive modal acessível compartilhado.
- Pence cortada no mobile → toolbar sem priorização, não só um ajuste CSS.
- Status “fallback” → produto acoplado a diagnóstico de implementação.
- E2E falhar após “Criar molde” → contrato entre UX e testes não governado.
- Active state sem ARIA → estados visuais e semânticos implementados separadamente.
- Snapshot marcado sem diff → ambiente/line endings não determinísticos.
- `window.prompt` → falta de padrão transacional e de validação para ações de edição.

## Respostas obrigatórias

1. **Percentual de conclusão até 9.5-06:** **72% (±8 p.p.)**.
2. **Nota atual de UX:** **4,4/10**.
3. **Nota possível só corrigindo o existente:** **7,2/10**.
4. **10 maiores problemas gerais:** listados acima.
5. **10 maiores problemas de UX:** listados acima.
6. **Maiores riscos técnicos:** máquina de estados implícita, canvas/store monolíticos, lifecycle 3D, montagem visual sem critério, modais duplicados, toolchain WASM e E2E desatualizado.
7. **Problemas pequenos com raiz arquitetural:** listados acima.
8. **Está em condições técnicas de iniciar a Etapa 10?** **NÃO.** O próprio gate local bloqueia o avanço; 9.5-06 não está certificada neste checkout; 3D, mobile, modais e lifecycle ainda têm falhas que deveriam ser estabilizadas antes.
9. **Produto real ou protótipo se publicado hoje?** **Protótipo funcional.** O 2D demonstra competência real, mas a primeira impressão, a linguagem interna e principalmente a roupa 3D quebrada fazem o usuário perceber uma ferramenta em construção. Um produto real pode ter limitações; ele não pode apresentar seu resultado central como confiável quando a própria imagem o contradiz.

## Resultado dos testes técnicos

| Verificação | Resultado |
|---|---|
| `npm run typecheck` | passou |
| `npm test` | passou: 59 arquivos, 344 testes |
| `npm run build` | passou; Vite fallback em 808 ms |
| regressão live de operações | passou: recorte V, anchors, preview, undo/redo, pence e prega |
| regressão mobile de operações | passou: 390×844, toque, canvas único, zoom/pan e undo/redo |
| exploração UX Playwright | passou sem page errors; warnings de fallback WebGPU→WebGL2 |
| arraste real 2D→3D→Undo | passou |
| autosave/reload | restaurou peças e costuras |
| SVG | download passou |
| script Prompt 09 antigo | falhou por fluxo desatualizado |
| `npm run build:wasm` | não executável: `wasm-pack` ausente |
| Cargo test/fmt/clippy | não executáveis: Cargo ausente |
| lint | script inexistente |
| Lighthouse/axe/leitor de tela | não executados/ausentes |

## Parecer final

Não avance para a Etapa 10 ainda. Primeiro feche o gate de recuperação correto e trate os bloqueadores que distorcem a avaliação do produto existente: validade visual do 3D, experiência móvel, modais acessíveis, lifecycle do renderer, linguagem orientada ao usuário e primeiro uso. Depois dessas correções, o Moldeon pode subir de 4,4 para cerca de 7,2 sem adicionar uma única funcionalidade de etapa futura.
