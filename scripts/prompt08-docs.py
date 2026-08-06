from pathlib import Path
import os
import subprocess

ROOT = Path(".")

sleeve_doc = r'''# Sistema guiado de mangas

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
- fluxo real em Chrome desktop e mobile;
- ausência de overflow horizontal e erros de console no assistente.

As evidências ficam em `docs/evidence/prompt08-sleeves/`.

## Limitações

- Não houve toile, impressão 1:1 ou revisão presencial por modelista.
- O teste mobile usa emulação de viewport e toque no Chrome, não aparelho físico ou Safari.
- O sistema não implementa manga bufante, capa, raglan, duas folhas, punho estruturado, carcela, franzido ou elástico.
- A rotação influencia distribuição de folga e placement, mas não substitui análise de postura real.
- Gravidade, colisão, autocolisão, enrugamento e caimento pertencem ao solver XPBD.
- Alterações posteriores nas cavas não regeneram automaticamente uma manga já confirmada. O usuário abre novamente o assistente para recalcular e substituir de forma explícita.
'''
(ROOT / "docs/SLEEVE_SYSTEM.md").write_text(sleeve_doc, encoding="utf-8")

progress = f'''# Prompt 8: sistema guiado de mangas e compatibilidade com cavas

## Estado

Entrega concluída em 6 de agosto de 2026 na branch `main`.

- versão do domínio: `guided-sleeve@1`;
- commit anterior à documentação: `{subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()}`;
- workflow de entrega: `{os.environ.get("GITHUB_RUN_ID", "não disponível")}`.

## Implementação

O gerador antigo continua preservado em projetos existentes, mas a criação guiada usa `domain/sleeveSystem.ts`. Frente e costas são detectadas pelos conectores `frontArmhole` e `backArmhole`. Ombros e axilas são confirmados por `shoulder` e `sideSeam`.

A cabeça frontal e a traseira são curvas independentes resolvidas por comprimento de arco. A manga contém ápice, marca de ombro, pique frontal, dois piques traseiros, axilas, bíceps, cotovelo quando longa, abertura/punho e fio.

## Assistente

`components/SleeveWizardDialog.tsx` implementa quatro etapas: corpo, tipo, medidas e encaixe. O usuário vê IDs dos conectores, arcos, métricas de compatibilidade, tolerâncias, landmarks e um mini diagrama. A ação fica disponível em desktop e mobile.

Uma definição gera duas instâncias. A direita é espelhada e associada ao braço direito. A criação completa é transacional e coberta por undo/redo.

## Costuras

Os grupos explícitos são:

- `guided-sleeve:front-armhole`;
- `guided-sleeve:back-armhole`;
- `guided-sleeve:underarm`;
- `guided-sleeve:body-shoulder`;
- `guided-sleeve:body-side`.

O pareamento é dividido nos landmarks. Testes de cobertura provam que todos os intervalos das cavas e da cabeça são consumidos exatamente uma vez.

## Validação

A execução final realizou typecheck, golden snapshot, suíte completa imutável, build e fluxo de navegador. A auditoria abriu a biblioteca, escolheu corpo básico, percorreu as quatro etapas, alterou o bíceps, abriu o encaixe e confirmou mangas curta e longa.

Capturas desktop e mobile, relatório JSON e resumo Markdown ficam em `docs/evidence/prompt08-sleeves/`.

## Pesquisa

A documentação compara GarmentCode, OpenPattern e referências públicas de construção por cava. A implementação Moldeon é original e não copia fórmulas proprietárias.

## Limitações

Não houve toile, dispositivo móvel físico, Safari ou prova de caimento. Manga bufante, capa, raglan, duas folhas, punhos complexos e XPBD permanecem em etapas futuras.
'''
progress_path = ROOT / "docs/progress/PROMPT_08_SLEEVES.md"
progress_path.parent.mkdir(parents=True, exist_ok=True)
progress_path.write_text(progress, encoding="utf-8")

library_path = ROOT / "docs/PATTERN_LIBRARY.md"
library = library_path.read_text(encoding="utf-8")
library = library.replace(
    '| Camiseta | `tshirt@2` | derivação da base superior | experimental no conjunto; corpo validado geometricamente; manga experimental | pendente |',
    '| Camiseta | `tshirt@2` | derivação da base superior | corpo validado; manga legada experimental; substituição guiada disponível | pendente |',
)
library = library.replace(
    '| Blusa | `blouse@2` | derivação da base superior | experimental no conjunto; corpo validado geometricamente; manga experimental | pendente |',
    '| Blusa | `blouse@2` | derivação da base superior | corpo validado; manga legada experimental; substituição guiada disponível | pendente |',
)
library = library.replace(
    'A camiseta e a blusa preservam uma manga compatível com o fluxo existente. A manga expõe cabeça frontal, cabeça traseira, pique frontal, dois piques traseiros, marca de ombro, bíceps e fio. Ela permanece **experimental** até a fase de manga derivada diretamente do comprimento das cavas e revisão manual.',
    'A camiseta e a blusa preservam suas mangas legadas para compatibilidade de projetos. O assistente `guided-sleeve@1` pode substituí-las explicitamente por uma manga derivada dos arcos reais das cavas, com cabeça frontal/traseira independente, ápice, piques, duas instâncias e diagnóstico de encaixe. Consulte `docs/SLEEVE_SYSTEM.md`.',
)
start = "<!-- PROMPT08_SLEEVES_START -->"
end = "<!-- PROMPT08_SLEEVES_END -->"
section = '''<!-- PROMPT08_SLEEVES_START -->

## Sistema guiado de mangas `guided-sleeve@1`

O sistema mede as cavas frontal e traseira da geometria atual, resolve uma cabeça assimétrica por comprimento de arco e cria uma definição com duas instâncias. Ele não depende do nome do template ou da posição das peças na bancada.

A compatibilidade é avaliada separadamente para frente e costas. A cabeça contém ápice, pique frontal, dois piques traseiros e axilas; a manga longa acrescenta linha de cotovelo. Costuras e landmarks são persistidos semanticamente e a criação completa participa de undo/redo.

O assistente foi validado em fluxo Chrome desktop e mobile emulado. A validação de vestibilidade continua pendente. Fórmulas, tolerâncias, pesquisa e limitações estão em `docs/SLEEVE_SYSTEM.md`.

<!-- PROMPT08_SLEEVES_END -->'''
if start in library and end in library:
    before = library.split(start, 1)[0]
    after = library.split(end, 1)[1]
    library = before + section + after
else:
    library = library.rstrip() + "\n\n" + section + "\n"
library_path.write_text(library, encoding="utf-8")

readme_path = ROOT / "README.md"
readme = readme_path.read_text(encoding="utf-8")
readme = readme.replace(
    '- Projetos com frente e costas distintas, quantidade de corte, dobra, fio, pences, conectores e landmarks; mangas atuais permanecem experimentais até sua fase dedicada.',
    '- Projetos com frente e costas distintas, quantidade de corte, dobra, fio, pences, conectores e landmarks; o assistente de manga mede as cavas reais, cria piques, costuras e instâncias esquerda/direita.',
)
readme = readme.replace(
    '- As mangas de camiseta/blusa permanecem experimentais. A calça `@2` foi validada geometricamente e no grafo de quatro instâncias, mas ainda exige toile e revisão humana; qualquer jaqueta permanece indisponível.',
    '- As mangas legadas de camiseta/blusa permanecem experimentais, mas podem ser substituídas explicitamente pelo sistema guiado validado geometricamente; tanto mangas quanto calça ainda exigem toile e revisão humana. Qualquer jaqueta permanece indisponível.',
)
readme = readme.replace(
    'Validar manualmente os blocos `@2` em toile e executar a fase própria de manga antes de ampliar alegações de vestibilidade. A próxima evolução da calça é conectar o grafo de quatro instâncias ao XPBD sem perder a autoridade do molde 2D.',
    'Validar manualmente blocos, mangas e calça em toile antes de ampliar alegações de vestibilidade. A próxima evolução é conectar costuras semânticas e instâncias ao XPBD sem perder a autoridade do molde 2D.',
)
readme = readme.replace(
    '- `docs/PATTERN_LIBRARY.md`\n',
    '- `docs/PATTERN_LIBRARY.md`\n- `docs/SLEEVE_SYSTEM.md`\n',
)
readme_path.write_text(readme, encoding="utf-8")

print("Prompt 8 documentation prepared")
