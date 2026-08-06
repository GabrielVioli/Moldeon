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
9. resolução das partes visuais do manequim totalmente cobertas por cada instância semântica;
10. uma passagem limitada de relaxamento de costura, com correção máxima de 1,5 mm;
11. renderização apenas das instâncias válidas, mantendo cabeça, mãos, pés e demais regiões expostas do avatar.

Partes internas do manequim que ficam integralmente sob uma roupa são omitidas do avatar visual, prática equivalente à ocultação de superfícies cobertas em personagens vestidos. Essa máscara é derivada de região, lado e comprimento da instância, nunca do nome da peça. Cabeça, mãos, pés e regiões expostas permanecem visíveis. A estabilização não possui massa, velocidade, gravidade, integração temporal, colisão ou autocolisão. Ela existe somente para reduzir pequenas aberturas geométricas entre bordas já posicionadas semanticamente.

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
