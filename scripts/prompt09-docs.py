from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content.strip() + "\n", encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    source = target.read_text(encoding="utf-8")
    if source.count(old) != 1:
        raise SystemExit(f"{path}: documentation block not found exactly once")
    target.write_text(source.replace(old, new, 1), encoding="utf-8")


write(
    "docs/AVATAR_ARRANGEMENT.md",
    r'''
# Avatar humano e montagem semântica

## Estado

O pipeline `avatar-parametric@1` + `avatar-collision@1` substitui a apresentação flutuante por um único estado público: manequim humano vestido. Esta etapa é uma montagem geométrica determinística, não uma simulação de tecido.

## Separação de responsabilidades

### Modelo paramétrico

`apps/web/src/avatar/AvatarParametricModel.ts` resolve medidas, landmarks, articulações, pose neutra e anchors. O domínio trabalha em metros após receber as medidas autoritativas do projeto em milímetros.

Medidas usadas:

- altura;
- busto ou tórax;
- cintura;
- quadril;
- largura de ombros;
- comprimento de torso;
- comprimento de braço;
- bíceps e punho;
- entreperna;
- coxa, panturrilha e tornozelo.

As regiões são dimensionadas separadamente. Aumentar busto não altera automaticamente altura, entreperna ou comprimento de braço.

### Avatar visual

`apps/web/src/viewport/AvatarVisual.ts` cria uma representação low-poly com cabeça, pescoço, torso, pelve, braços, mãos, pernas e pés. Os braços ficam aproximadamente 14° afastados do torso e as pernas aproximadamente 4° afastadas do eixo central.

O nível de detalhe é selecionado pelo perfil de desempenho do viewport. Celulares usam menos segmentos e não usam sombras.

### Proxies de colisão

`apps/web/src/avatar/AvatarCollisionModel.ts` produz elipsoides para cabeça, torso e pelve, além de cápsulas para braços e pernas. Esses proxies são descritores de domínio e não participam de uma alegação de física nesta etapa. O Prompt seguinte poderá consumi-los no XPBD.

## Origem e licença do avatar

Nenhum asset 3D externo, morph target ou malha de terceiros foi incorporado. O avatar é gerado integralmente pelo código do Moldeon e está coberto pela licença MIT do repositório. Portanto não existe arquivo externo, atribuição adicional ou licença de modelo humano a redistribuir.

A opção por geometria procedural evita dependência pesada no carregamento inicial e permite que medidas regionais permaneçam rastreáveis. Uma futura troca por malha com morph targets deverá registrar origem, versão, autor, licença, alterações e compatibilidade de redistribuição antes de entrar em `main`.

## Anchors corporais

Cada anchor contém:

- identificador estável;
- região;
- superfície;
- lado corporal;
- posição;
- normal externa;
- eixo principal;
- tangente;
- margem inicial.

Anchors disponíveis:

```text
torso-front      torso-back
shoulder-left    shoulder-right
arm-left         arm-right
waist-front      waist-back
hip-front        hip-back
leg-left         leg-right
neck             head
```

Os templates fornecem `previewPlacements` explícitos com região, superfície e lado. Placements legados em `assemblyPlacements` são convertidos somente porque já possuem metadados estruturados. O motor não consulta nomes de templates ou peças para decidir onde vestir um painel.

## Pipeline de montagem

`buildSemanticAvatarArrangement` executa:

1. reparo compatível das costuras semânticas conhecidas;
2. validação de placements e conectores;
3. expansão física de dobra e quantidade de corte já descrita pelos placements;
4. resolução de lado e espelhamento;
5. geração das topologias 3D a partir do molde 2D;
6. associação de cada instância a um anchor corporal;
7. transformação para superfície de torso/quadril, tubo local de braço ou meia superfície anatômica de perna;
8. orientação da face externa por instância;
9. duas passagens limitadas de relaxamento de costura, com correção máxima de 4 mm por passagem;
10. renderização apenas das instâncias válidas junto ao avatar.

A estabilização não possui massa, velocidade, gravidade, integração temporal, colisão ou autocolisão. Ela existe somente para reduzir pequenas aberturas geométricas entre bordas já posicionadas semanticamente.

## Mapeamentos

### Torso, cintura e quadril

O eixo vertical do molde permanece ligado ao eixo vertical corporal. Peças cortadas na dobra são expandidas em metades esquerda e direita. A profundidade é obtida pela seção elíptica paramétrica do corpo na altura de cada vértice, acrescida da margem do anchor.

### Braços

Uma manga declarada para `arm-left` ou `arm-right` é organizada ao redor do eixo real entre ombro e punho. A largura 2D controla a volta local; o comprimento acompanha o braço. Este fechamento tubular é local e semântico, não a antiga projeção cilíndrica global.

### Pernas

Frente e costas da calça ocupam metades distintas da seção da perna. O centro corporal é escolhido pelo lado explícito da instância. Acima do gancho, a seção transita para cintura e quadril; abaixo, interpola coxa, panturrilha e tornozelo.

## Diagnósticos

Códigos públicos:

| Código | Condição |
|---|---|
| `missing-anchor` | peça ou instância sem região/superfície/lado resolvível |
| `missing-connector` | papel estrutural obrigatório ausente |
| `incompatible-seam` | costura referencia borda ou faixa inválida |
| `ambiguous-instance` | quantidade, lado ou placement duplicado/inconsistente |
| `disconnected-component` | componente sem ligação semântica com o principal |

As mensagens incluem peça e, quando disponível, instância e conector. Instâncias com erro não são mostradas em posição arbitrária. O avatar continua visível e o usuário recebe o diagnóstico.

## Interface pública

Foram removidos:

- controle `showBody`;
- botão **Explodida**;
- alternância **Montada/Explodida**;
- deslocamento visual de painéis;
- inicialização tubular genérica;
- fallback por nome de peça.

**Vestir no manequim** sempre abre o avatar visível com as peças válidas vestidas.

## Validação

A suíte cobre:

- medidas regionais independentes;
- anchors e proxies finitos;
- camiseta com mangas nos braços corretos;
- saia na cintura e quadril;
- quatro painéis de calça nas pernas corretas;
- omissão de peça sem anchor;
- diagnóstico de componente desconectado;
- ausência dos caminhos públicos de corpo ocultável e explosão;
- ausência da inicialização tubular genérica no pipeline ativo;
- auditoria Chromium desktop e mobile com enquadramento de avatar e roupa.

As evidências ficam em `docs/evidence/prompt09-avatar-assembly/`.

## Limitações

- Não há XPBD completo, gravidade, colisão, autocolisão ou caimento real.
- Não houve aparelho móvel físico, Safari, impressão 1:1 ou prova em toile.
- O avatar procedural é uma representação funcional low-poly, não um scan anatômico.
- Placements de peças personalizadas ainda precisam declarar região, superfície e lado manualmente.
- Camadas complexas, sobreposição de várias roupas e ordenação por espessura permanecem para evolução posterior.
''',
)

write(
    "docs/progress/PROMPT_09_AVATAR_ASSEMBLY.md",
    r'''
# Prompt 9: avatar humano e montagem semântica

## Estado

Entrega concluída na branch `main` após validação de domínio, frontend, build e navegador.

## Implementação

- modelo paramétrico humano em `avatar/AvatarParametricModel.ts`;
- proxies futuros em `avatar/AvatarCollisionModel.ts`;
- visual low-poly separado em `viewport/AvatarVisual.ts`;
- montagem determinística em `garment3d/SemanticAvatarArrangement.ts`;
- viewport único com avatar sempre visível;
- diagnóstico e omissão de instâncias inválidas;
- câmera enquadrando avatar e roupa em conjunto.

O molde 2D continua sendo a fonte de verdade. Os painéis 3D são reconstruídos das topologias trianguladas e dos placements semânticos.

## Comportamentos removidos

- `showBody`;
- `setBodyVisible`;
- modo explodido;
- botões Montada/Explodida;
- viewport legado duplicado;
- inicialização cilíndrica global de painéis;
- inferência de posição por nome de peça.

## Compatibilidade

Projetos com `previewPlacements` continuam usando esses metadados. `assemblyPlacements` antigos são convertidos quando possuem papel, superfície e orientação explícitos. Projetos sem anchor não são alterados silenciosamente: a peça é omitida do 3D e recebe `missing-anchor`.

## Validação

Foram executados:

- typecheck;
- suíte completa de testes;
- build fallback;
- CI Rust existente em `main`;
- auditoria do fluxo real no Chrome para camiseta, saia e calça;
- desktop 1440×960;
- mobile emulado 390×844;
- inspeção das capturas publicadas.

A auditoria verifica avatar sempre visível, quantidade esperada de instâncias, zero diagnóstico de erro nos templates, ausência de overflow, ausência de controles explodidos ou corpo ocultável e ausência de erros de navegador.

## Licença

Nenhum asset humano externo foi incorporado. O avatar é procedural e coberto pela licença MIT do Moldeon.

## Limitações

Esta entrega não declara física, caimento, colisão, autocolisão ou validação de vestibilidade. Esses pontos permanecem para o próximo ciclo de XPBD.
''',
)

replace_once(
    "README.md",
    '''- Manequim procedural proporcional às medidas, sem depender de arquivo 3D\n  externo pesado.\n- Conversão visual de todas as peças em painéis posicionados ao redor do manequim.\n- Região, frente/costas e lado do corpo configuráveis por peça.\n- Caimento visual rápido que responde à gramatura, espessura, elasticidade,\n  rigidez e atrito do tecido.''',
    '''- Manequim procedural humano com modelo paramétrico, visual low-poly e proxies de colisão separados, sem asset 3D externo.\n- Montagem semântica por anchors de torso, ombros, braços, cintura, quadril, pernas, pescoço e cabeça.\n- Camisetas, saias, calças e mangas usam região, superfície e lado explícitos; instâncias inválidas geram diagnóstico em vez de flutuar.\n- O 3D público sempre mostra o manequim vestido. Não existem corpo ocultável, roupa isolada ou modo explodido.\n- Estabilização geométrica limitada responde às costuras, sem alegar gravidade ou caimento físico.''',
)
replace_once(
    "README.md",
    '''5. Aproxime outras bordas e clique em **Costurar**.\n6. Veja a roupa em 3D.\n7. Use **Prova** quando quiser vestir no corpo.''',
    '''5. Selecione duas bordas e clique em **Costurar**.\n6. Use **Vestir no manequim**.\n7. Corrija qualquer diagnóstico de anchor, instância, conector ou costura mostrado sobre o 3D.''',
)
replace_once(
    "README.md",
    '''- Em qualquer tela, o 3D só é baixado depois de uma solicitação explícita e quando há ao menos duas peças trianguláveis ligadas por uma costura válida.''',
    '''- Em qualquer tela, o 3D só é baixado depois de uma solicitação explícita e quando há ao menos uma peça triangulável.''',
)
replace_once(
    "README.md",
    '''O botão **Montar no 3D** desta versão executa uma prévia geométrica estrutural; **Vestir no corpo** abre a Prova separadamente.\nOs presets já alteram aderência, volume e ondulação de forma aproximada, mas\nainda não calculam gravidade, autocolisão, franzido, elástico ou costuras\ncomplexas. O solver XPBD inicial está isolado para ser desenvolvido e testado\nsem contaminar o editor.''',
    '''O botão **Vestir no manequim** executa uma montagem geométrica por anchors corporais. O avatar é sempre visível e peças inválidas não recebem posição arbitrária.\n\nA etapa ainda não calcula gravidade, colisão, autocolisão, enrugamento, franzido, elástico ou caimento real. O solver XPBD permanece isolado para ser desenvolvido e testado sem contaminar o editor ou transformar a montagem determinística em uma falsa simulação.''',
)

architecture = ROOT / "docs/ARCHITECTURE.md"
arch_source = architecture.read_text(encoding="utf-8")
section = r'''

## Avatar e arranjo semântico

A camada 3D visível é dividida em quatro partes:

1. `avatar/AvatarParametricModel.ts`: medidas, landmarks, articulações e anchors, sem Three.js.
2. `avatar/AvatarCollisionModel.ts`: elipsoides e cápsulas futuros, sem renderização.
3. `viewport/AvatarVisual.ts`: LOD visual procedural e materiais do manequim.
4. `garment3d/SemanticAvatarArrangement.ts`: expansão, validação, associação aos anchors e estabilização geométrica limitada.

`GlobalThreeViewport` apenas coordena renderer, avatar visual, malhas de roupa, câmera e descarte. React recebe diagnósticos agregados e não participa de qualquer loop por vértice.

O pipeline ativo não contém projeção cilíndrica global, modo explodido ou corpo ocultável. `previewPlacements` são metadados de arranjo; transforms da bancada 2D não determinam a posição no corpo.

Nenhum asset externo de avatar é usado. A geometria procedural pertence ao código MIT do projeto.
'''
if "## Avatar e arranjo semântico" not in arch_source:
    architecture.write_text(arch_source.rstrip() + section + "\n", encoding="utf-8")

roadmap = ROOT / "docs/ROADMAP.md"
road_source = roadmap.read_text(encoding="utf-8")
road_section = r'''

## Prompt 9 concluído: manequim vestido

- [x] separar avatar paramétrico, visual e proxies de colisão;
- [x] anchors de torso, ombros, braços, cintura, quadril, pernas, pescoço e cabeça;
- [x] remover corpo ocultável, modo explodido e roupa isolada;
- [x] remover inicialização cilíndrica global e inferência por nome;
- [x] vestir camiseta, saia, calça e mangas por placements semânticos;
- [x] omitir instâncias inválidas e emitir diagnósticos;
- [x] validar desktop e mobile em navegador.

### Próximo ciclo físico

- integrar proxies ao solver XPBD;
- gravidade, colisão e estabilização temporal;
- constraints de costura com distribuição de folga;
- autocolisão e camadas em fases posteriores;
- não regredir para roupa isolada ou modos de inspeção explodidos.
'''
if "## Prompt 9 concluído: manequim vestido" not in road_source:
    roadmap.write_text(road_source.rstrip() + road_section + "\n", encoding="utf-8")

print("Prompt 9 documentation written")
