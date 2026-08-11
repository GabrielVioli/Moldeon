# Sistema guiado de mangas

## Estado

O sistema `guided-sleeve@1` gera manga curta ou longa a partir dos conectores reais `frontArmhole` e `backArmhole` de um corpo existente. A geometria do corpo permanece autoritativa e nunca é alterada silenciosamente para fazer a manga caber.

O estado **validado geometricamente e funcionalmente** significa que o sistema passou por testes de arco, contorno, landmarks, conectores, instâncias, atualização, compatibilidade, undo/redo e fluxo real em navegador desktop e mobile. Não significa validação de vestibilidade, método industrial ou prova em toile.

## Pesquisa e abordagem

Foram comparadas três famílias de referência:

1. **GarmentCode**, sistema acadêmico de montagem paramétrica de roupas. O trabalho trata peças como componentes com interfaces e registra que mangas exigem compatibilidade entre curvas e orientação, em vez de simples proximidade espacial. Fontes: <https://igl.ethz.ch/projects/garmentcode/> e <https://github.com/maria-korosteleva/GarmentCode>.
2. **OpenPattern**, biblioteca aberta de modelagem que mede distâncias cumulativas sobre curvas e implementa métodos de construção de mangas. Foi usada para comparar conceitos de comprimento de arco, separação frente/costas e verificabilidade geométrica, sem copiar código ou fórmulas. Fontes: <https://openpattern.readthedocs.io/> e <https://github.com/fmetivier/OpenPattern>.
3. Referências públicas de construção de manga a partir da cava, incluindo material histórico em domínio público e tutoriais de modelagem que distinguem cabeça frontal, cabeça traseira, ápice e piques. Foram usadas apenas para terminologia e princípios de encaixe, não para transcrever tabelas ou métodos proprietários.

O método Moldeon é original. Ele mede os arcos existentes, resolve duas curvas Bézier cúbicas independentes por busca numérica e distribui folga explícita. Nenhum código, AST, coordenada ou fórmula proprietária foi incorporado.

## Fluxo guiado

O botão **Adicionar manga** fica disponível quando o documento contém pelo menos uma definição com `frontArmhole` e outra com `backArmhole`.

O assistente possui quatro etapas:

1. **Corpo**: detecta frente e costas por papel semântico. Quando há mais de uma candidata, o usuário confirma as definições, os ombros e as axilas. A posição das peças na bancada não participa da detecção.
2. **Tipo**: escolhe manga curta ou longa.
3. **Medidas**: configura comprimento, circunferência de bíceps, punho/abertura, altura da cabeça, folga total e rotação.
4. **Encaixe**: mostra cavas, cabeça frontal/traseira, diferenças, tolerâncias, landmarks e o mini diagrama normalizado antes da confirmação.

Projetos que já possuem manga não são alterados automaticamente. O assistente exige confirmação explícita para substituí-la. A criação ou substituição completa é um único comando de histórico.

## Fonte de verdade

O sistema identifica o corpo pelos papéis:

- `frontArmhole` para a cava frontal;
- `backArmhole` para a cava traseira;
- `shoulder` para as marcas superiores;
- `sideSeam` para as axilas.

Os comprimentos são calculados com `edgeRangeLength` sobre todos os segmentos que pertencem ao conector. Nomes de template, nomes de peças, offsets da bancada e distância visual não participam do cálculo.

A assinatura de origem contém somente a geometria relevante das duas cavas, suas alças e as configurações da manga. Alterar a cava ou o ombro invalida essa assinatura e produz uma nova manga. Alterar bíceps, comprimento, altura ou rotação atualiza apenas a definição da manga.

## Geometria

### Entradas

| Entrada | Unidade | Regra |
|---|---:|---|
| tipo | curta/longa | determina comprimento inicial e linha de cotovelo |
| comprimento | mm | mínimo maior que a altura da cabeça + 55 mm |
| bíceps da manga | mm | circunferência completa; largura 2D é a metade |
| punho/abertura | mm | circunferência completa; não altera o corpo |
| altura da cabeça | mm | limitada entre 55 e 260 mm |
| folga da cabeça | mm | intervalo configurável de -35 a 65 mm, sujeito às tolerâncias |
| rotação | graus | limitada entre -25° e 25°; redistribui frente/costas e placement |

Os valores iniciais usam medidas do perfil corporal e os arcos das cavas. A folga padrão é limitada entre 6 e 16 mm e nasce de 2,5% do arco total. Esses valores são regras versionadas do Moldeon, não um padrão industrial universal.

### Alvos de arco

```text
cavaTotal = cavaFrontal + cavaTraseira
participaçãoFrontal = clamp(0,42 - rotação × 0,002, 0,34, 0,50)
alvoFrontal = cavaFrontal + folgaTotal × participaçãoFrontal
alvoTraseiro = cavaTraseira + folgaTotal × (1 - participaçãoFrontal)
```

A cabeça é formada por duas curvas diferentes:

- curva frontal da axila frontal ao ápice;
- curva traseira do ápice à axila traseira.

Cada metade usa controles Bézier assimétricos. O solver aumenta ou reduz o deslocamento normal dos controles e executa busca binária por até 48 iterações, comparando o comprimento amostrado da curva com seu alvo. A tolerância declarada é 0,35 mm.

A altura e a largura definem o comprimento mínimo possível da corda. Quando a corda já é maior que o arco solicitado, o sistema explica que a altura precisa diminuir ou que largura/folga precisam aumentar.

### Landmarks

A definição inclui:

- axila frontal;
- pique frontal;
- ápice e marca de ombro;
- primeiro pique traseiro;
- segundo pique traseiro;
- axila traseira;
- linha de bíceps;
- linha de cotovelo para manga longa;
- punho ou abertura;
- fio.

Os landmarks participam do pareamento semântico. O conector frontal é dividido pelo pique frontal. O traseiro é dividido pelos dois piques traseiros. O ápice é pareado com as marcas de ombro frontal e traseira.

## Compatibilidade

O painel mostra:

- arco da cava frontal;
- arco da cava traseira;
- arco da cabeça frontal;
- arco da cabeça traseira;
- diferenças frontal, traseira e total;
- folga configurada e percentual;
- estado compatível, atenção ou incompatível.

### Tolerâncias versionadas

| Regra | Valor |
|---|---:|
| déficit mínimo permitido | -2 mm |
| aviso de excesso | `min(18 mm, cavaTotal × 4,5%)` |
| erro de excesso | `min(28 mm, cavaTotal × 7%)` |
| aviso de desequilíbrio frente/costas | `min(10 mm, cavaTotal × 2,2%)` |
| tolerância do solver de arco | 0,35 mm |

A confirmação é bloqueada em estado de erro. Avisos permanecem visíveis e exigem decisão consciente. O mini diagrama é uma visualização normalizada; os números medidos na geometria são autoritativos.

## Instâncias e costuras

Uma definição gera duas instâncias determinísticas:

```text
guided-sleeve:<frente>:<costas>:panel:1 → braço esquerdo, não espelhado
guided-sleeve:<frente>:<costas>:panel:2 → braço direito, espelhado
```

As costuras são explícitas:

- cabeça frontal ↔ cava frontal;
- cabeça traseira ↔ cava traseira;
- costura inferior ↔ costura inferior da própria instância;
- ombro frontal ↔ ombro traseiro;
- lateral frontal ↔ lateral traseira.

Quando ombros ou laterais já possuem uma costura estrutural do molde-base, o assistente a reutiliza em vez de criar um grupo duplicado. Essa deduplicação é necessária para que substituição, exportação V3 e autosave permaneçam válidos.

Os conectores que atravessam vários segmentos são particionados por comprimento acumulado. Testes somam todas as faixas e comprovam que cada milímetro das cavas e da cabeça participa exatamente uma vez, sem lacunas ou sobreposição lógica.

O runtime preserva os grupos `guided-sleeve:*` e não os substitui pelo auto-sewing genérico dos templates. O modelo 3D continua fora da aprovação desta etapa.

## Undo, atualização e compatibilidade de projetos

Adicionar ou substituir manga inclui, numa única transação:

- definição 2D;
- workspace state;
- placement de montagem;
- duas instâncias derivadas;
- costuras de cava, ombro, lateral e costura inferior;
- seleção da nova peça.

Undo restaura o documento completo anterior. Redo recria o conjunto. Geometria existente não é regenerada ao abrir projeto antigo. Mangas experimentais já salvas continuam preservadas até uma substituição explicitamente confirmada.

## Validação

A suíte cobre:

- manga curta e longa;
- cavas frontal e traseira diferentes;
- cabeça assimétrica;
- ápice, ombro, pique frontal e dois piques traseiros;
- linha de bíceps, cotovelo, punho e fio;
- duas instâncias e espelhamento direito;
- costura inferior tubular;
- cobertura integral dos conectores;
- atualização após cava, ombro, bíceps, comprimento, altura e rotação;
- cabeça excessivamente maior ou menor;
- documento V3 válido;
- criação, substituição, undo e redo;
- fluxo real em Chrome desktop e mobile, incluindo cancelar, voltar, fechar e substituição explícita;
- persistência da manga substituída, medidas, versão e metodologia após recarregar;
- ausência de overflow horizontal e erros de console no assistente.

As evidências ficam em `docs/evidence/prompt08-sleeves/`.

## Limitações

- Não houve toile, impressão 1:1 ou revisão presencial por modelista.
- O teste mobile usa emulação de viewport e toque no Chrome, não aparelho físico ou Safari.
- O sistema não implementa manga bufante, capa, raglan, duas folhas, punho estruturado, carcela, franzido ou elástico.
- A rotação influencia distribuição de folga e placement, mas não substitui análise de postura real.
- Gravidade, colisão, autocolisão, enrugamento e caimento pertencem ao solver XPBD.
- Alterações posteriores nas cavas não regeneram automaticamente uma manga já confirmada. O usuário abre novamente o assistente para recalcular e substituir de forma explícita.
