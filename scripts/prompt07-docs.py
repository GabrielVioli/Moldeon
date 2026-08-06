from pathlib import Path
import os
import subprocess

ROOT = Path(".")

library_path = ROOT / "docs/PATTERN_LIBRARY.md"
library = library_path.read_text(encoding="utf-8")
library = library.replace(
    '| Calça reta | `straight-pants@1` | gerador legado | experimental e fora do escopo desta etapa | pendente |',
    '| Calça reta | `straight-pants@2` | Moldeon Reference Trouser Block 2026 | validado geometricamente; montagem lógica validada | pendente |',
)
start = "<!-- PROMPT07_TROUSERS_START -->"
end = "<!-- PROMPT07_TROUSERS_END -->"
section = r'''<!-- PROMPT07_TROUSERS_START -->

## Calça reta paramétrica `straight-pants@2`

### Estado e escopo

A calça usa duas definições 2D autoritativas, `straight-pants-front` e `straight-pants-back`. Cada definição declara `cutQuantity: 2` e placements explícitos para esquerda e direita. A expansão física resulta em quatro instâncias determinísticas, sem duplicar a geometria:

```text
straight-pants-front:panel:1  → frente esquerda
straight-pants-front:panel:2  → frente direita espelhada
straight-pants-back:panel:1   → costas esquerda
straight-pants-back:panel:2   → costas direita espelhada
```

O status **validado geometricamente** significa que frente e costas passaram por invariantes de contorno, área, perímetro, dimensões, conectores, pences, golden datasets e continuidade paramétrica. A montagem lógica prova duas pernas tubulares e a continuidade do gancho. Não significa validação de vestibilidade, gradação ou produção industrial.

### Referências comparadas

1. FreeSewing Paco, Charlie, Titan e Crux: esses projetos separam medidas verticais e circunferências, incluindo cintura, assento/quadril, entreperna, joelho, alturas até níveis corporais e medidas traseiras. Paco e Charlie são derivados do bloco Titan, reforçando a separação entre bloco e derivação de estilo. Fontes: <https://freesewing.org/designs/paco/> <https://freesewing.org/designs/charlie/> <https://freesewing.org/designs/crux/> <https://freesewing.dev/blog/2024/05/15/beta-titan>
2. Threads, *How to Draft a Basic Pants Pattern*: referência conceitual para usar profundidade de gancho, comprimentos frontal e traseiro distintos, linha de vinco e níveis de joelho e barra. Fonte: <https://www.threadsmagazine.com/project-guides/fit-and-sew-pants/how-to-draft-a-basic-pants-pattern>
3. NuriaMo, *Trouser Foundation*: exemplo público acessível de construção com linhas de cintura, quadril, gancho, joelho e extensões frontal/traseira diferentes. Foi usado apenas para comparação visual e terminologia, não para copiar coordenadas ou fórmulas. Fonte: <https://nuriamo.com/trouser-foundation-pattern-drafting/>

A abordagem adotada é original e conservadora. Ela combina a riqueza de medidas diretas vista nos sistemas paramétricos com uma construção própria, auditável e versionada. Nenhum código, AST ou fórmula de FreeSewing foi incorporado. Valores ausentes continuam sendo estimativas identificadas pelo perfil corporal do Moldeon.

### Medidas

Medidas principais: cintura, quadril, altura do quadril, altura de gancho sentado, profundidade do gancho, profundidade do assento, queda de cintura, coxa, joelho, tornozelo, gancho ao joelho, comprimento lateral e entrepernas.

Altura de quadril, gancho sentado, profundidades, coxa, joelho, tornozelo e comprimentos podem ser estimados pelo perfil versionado quando não forem informados. A origem de cada valor é persistida e pode ser substituída pelo usuário.

### Fórmulas estruturais principais

| Variável | Fórmula resumida | Natureza |
|---|---|---|
| meio quadril vestido | `(quadril + 55 mm) / 2` | construção |
| distribuição frontal de quadril | `meioQuadril × 0,48` | construção versionada |
| distribuição traseira de quadril | restante do meio quadril | construção versionada |
| meio cintura vestido | `(cintura + 30 mm) / 2` | construção |
| distribuição frontal de cintura | `meioCintura × 0,47` | construção versionada |
| linha de gancho | altura sentada limitada entre quadril + margem e 430 mm | construção |
| extensão frontal | parcela menor de profundidade de gancho e assento | construção |
| extensão traseira | parcela maior de profundidade de gancho e assento | construção |
| elevação traseira | queda de cintura + participação da profundidade do assento | construção |
| linha de joelho | gancho + distância gancho-joelho limitada pela entreperna | construção |
| largura de coxa | circunferência da coxa + 40 mm, distribuída entre frente/costas | construção/folga |
| largura de joelho | joelho + 50 mm, distribuído entre frente/costas | construção/folga |
| barra reta | `max(380 mm, tornozelo + 120 mm)` | regra estética versionada |

A extensão frontal e traseira não é classificada como entreperna. Ela pertence ao conector de gancho. A entreperna cobre apenas a linha que une frente e costas de cada perna.

### Geometria e landmarks

A frente contém cintura inclinada, pence opcional, quadril, gancho frontal, lateral, entreperna, joelho, barra, centro da perna e fio. As costas possuem cintura elevada, pence traseira, maior distribuição de quadril, extensão e curva de gancho próprias, lateral e entreperna diferentes.

As linhas internas persistidas são:

- linha do quadril;
- linha do gancho;
- linha do joelho;
- centro/vinco da perna.

Anotações identificam quadril, joelho, gancho, fio e quantidade de corte. Os conectores V3 são derivados dos papéis semânticos `waist`, `outseam`, `inseam`, `frontCrotch`, `backCrotch` e `hem`, sem consultar o nome da peça.

### Montagem lógica das quatro instâncias

O módulo `domain/trouserLogicalAssembly.ts` expande as duas definições e cria seis relações lógicas:

- lateral esquerda e lateral direita;
- entreperna esquerda e entreperna direita;
- gancho frontal entre as duas frentes;
- gancho traseiro entre as duas costas.

Cada perna é tubular quando sua frente e costas estão ligadas simultaneamente por lateral e entreperna. O caminho do gancho é contínuo quando os ganchos frontal e traseiro ligam os lados e as duas entrepernas formam as junções inferiores. As quatro cinturas e quatro barras permanecem abertas.

O runtime legado de `Seam` recebe somente os intervalos de lateral e entreperna que consegue representar sem perda. Os ganchos entre cópias ficam no grafo de instâncias até a montagem e o solver consumirem relações diretamente por `PanelInstanceV3`. Isso evita a autocostura incorreta de cada cópia consigo mesma.

### Diagnósticos

A validação informa IDs de instância e conectores ao detectar:

- quatro painéis no mesmo lado;
- espelhamento igual nas cópias esquerda e direita;
- conector ausente;
- lateral ou entreperna cruzando lados;
- gancho frontal/traseiro torcido;
- perna incompleta;
- continuidade de gancho incompleta;
- ID de instância duplicado.

Selecionar uma instância lógica permite localizar sua definição 2D por `sourcePatternId`. A assinatura da geometria confirma que editar a frente atualiza somente as duas frentes e editar as costas atualiza somente as duas costas.

### Tolerâncias e validação

| Verificação | Regra |
|---|---|
| área mínima por definição | 30.000 mm² |
| diferença de lateral frente/costas | até 18 mm |
| diferença de entreperna frente/costas | até 22 mm |
| contorno | sem degeneração ou autointerseção detectada |
| instâncias | quatro IDs determinísticos e únicos |
| pernas | dois componentes tubulares |
| gancho | frontal e traseiro contínuos no grafo |
| aberturas | cintura e barras não costuradas |
| atualização paramétrica | crescimento contínuo, sem inversões |

Golden datasets cobrem corpos pequeno, médio, grande, alto-estreito e baixo-largo. A evidência visual mostra frente/costas lado a lado, comparação dos cinco corpos e o grafo das quatro instâncias.

### Limitações

- Nenhuma toile foi confeccionada.
- Não houve revisão presencial por modelista, comparação com bloco industrial ou impressão 1:1.
- Braguilha, zíper, cós, bolsos, vistas, forro, pregas, modelagem jeans e gradação permanecem fora do escopo.
- A montagem validada é topológica e semântica. Gravidade, colisão, autocolisão, distribuição de folga e caimento ficam para XPBD.
- A auditoria visual usa Chromium automatizado, não aparelho físico ou Safari.

<!-- PROMPT07_TROUSERS_END -->'''
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
    "- Biblioteca versionada com corpo básico, camiseta, blusa, saia reta e minissaia reconstruídos por fórmulas; calça permanece experimental e jaqueta indisponível.",
    "- Biblioteca versionada com corpo básico, camiseta, blusa, saia reta, minissaia e calça reta reconstruídos por fórmulas; jaqueta permanece indisponível.",
)
readme = readme.replace(
    "- As mangas de camiseta/blusa, a calça `@1` e qualquer jaqueta permanecem experimentais ou indisponíveis.",
    "- As mangas de camiseta/blusa permanecem experimentais. A calça `@2` foi validada geometricamente e no grafo de quatro instâncias, mas ainda exige toile e revisão humana; qualquer jaqueta permanece indisponível.",
)
readme = readme.replace(
    "Validar manualmente os blocos `@2` em toile e executar as fases próprias de manga e calça antes de ampliar alegações de vestibilidade ou conectar física XPBD.",
    "Validar manualmente os blocos `@2` em toile e executar a fase própria de manga antes de ampliar alegações de vestibilidade. A próxima evolução da calça é conectar o grafo de quatro instâncias ao XPBD sem perder a autoridade do molde 2D.",
)
readme_path.write_text(readme, encoding="utf-8")

run_id = os.environ.get("GITHUB_RUN_ID", "não disponível")
head = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
progress = f'''# Prompt 7: calça paramétrica e montagem lógica das quatro instâncias

## Estado

Implementação e evidências publicadas em `main` em 6 de agosto de 2026.

- versão: `straight-pants@2`;
- commit anterior à documentação: `{head}`;
- workflow final: `{run_id}`.

## Entrega

A base simplificada foi substituída por `patterns/trouserPatternDrafting.ts`, um gerador puro com fórmulas versionadas. Frente e costas possuem cintura, quadril, coxa, joelho, barra, lateral, entreperna e gancho próprios. A extensão traseira e a elevação da cintura traseira participam da construção e não são offsets visuais aplicados depois do contorno.

As duas definições continuam editáveis na bancada. `cutQuantity: 2` e placements explícitos geram quatro instâncias determinísticas:

- frente esquerda;
- frente direita espelhada;
- costas esquerda;
- costas direita espelhada.

A biblioteca explica essa expansão antes da criação do projeto.

## Montagem lógica

`domain/trouserLogicalAssembly.ts` trabalha apenas com domínio e geometria. O módulo não importa React, Three.js ou solver. Ele cria laterais, entrepernas, ganchos frontal/traseiro, duas pernas tubulares, continuidade de gancho e lista de cinturas/barras abertas.

O runtime simples recebe os intervalos de lateral e entreperna. O gancho entre cópias permanece no grafo lógico porque o modelo legado `Seam` não identifica instâncias físicas e autocosturaria cada cópia. Essa limitação é explícita e reservada para a integração por `PanelInstanceV3` e XPBD.

## Diagnósticos

Foram adicionadas mensagens com instância e conector para:

- quatro painéis no mesmo lado;
- espelhamento incorreto;
- conector ausente;
- lateral ou entreperna cruzada;
- gancho torcido;
- perna ou continuidade de gancho incompleta;
- ID duplicado.

A API localiza a definição 2D de origem a partir de um painel lógico. Testes de assinatura provam que uma alteração frontal só atualiza as frentes e uma alteração traseira só atualiza as costas.

## Testes

A execução final inclui:

- typecheck;
- golden datasets em cinco corpos;
- áreas, perímetros e dimensões-chave;
- frente e costas distintas;
- pences estruturais;
- quatro IDs estáveis;
- lados e espelhamentos;
- duas pernas tubulares;
- continuidade dos ganchos;
- cintura e barras abertas;
- ausência de costuras cruzadas;
- isolamento de atualização por definição;
- suíte completa e build de produção.

## Inspeção visual

As evidências permanentes ficam em `docs/evidence/prompt07-trousers/`:

- `trouser-front-back-medium.svg` e `.png`;
- `trouser-body-comparison.svg` e `.png`;
- `trouser-assembly-graph.svg` e `.png`;
- relatório JSON e Markdown da auditoria.

Chromium abriu os três SVGs, confirmou dimensões positivas, paths válidos e ausência de erros de console. O 3D não foi usado como prova.

## Pesquisa

`docs/PATTERN_LIBRARY.md` compara FreeSewing Paco/Charlie/Titan/Crux, a construção conceitual publicada pela Threads e a referência pública de NuriaMo. O método Moldeon é original; não incorpora código ou fórmulas licenciadas de forma incompatível.

## Confiança e limitações

`straight-pants@2` está validado geometricamente e topologicamente, com revisão manual pendente. Não houve toile, prova física, impressão 1:1, revisão presencial, dispositivo real ou Safari. Braguilha, cós, bolsos, zíper, jeans e física XPBD permanecem em fases próprias.
'''
progress_path = ROOT / "docs/progress/PROMPT_07_TROUSERS.md"
progress_path.parent.mkdir(parents=True, exist_ok=True)
progress_path.write_text(progress, encoding="utf-8")
print("Prompt 7 documentation prepared")
