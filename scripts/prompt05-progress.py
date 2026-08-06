from pathlib import Path
import json
import os

artifact = Path("artifacts/prompt05-parametric")
audit = json.loads((artifact / "prompt05-visual-audit.json").read_text(encoding="utf-8"))
implementation = os.environ["IMPLEMENTATION_COMMIT"]
run_id = os.environ.get("GITHUB_RUN_ID", "indisponível")

contract = Path("docs/PATTERN_DOCUMENT_V3.md")
text = contract.read_text(encoding="utf-8").rstrip()
section = r'''

## Medidas, fórmulas e construção paramétrica

O formato do documento continua sendo `formatVersion: 3`. As extensões desta seção são opcionais para preservar documentos V3 anteriores. A ausência dos novos campos não aciona atualização silenciosa de fórmulas.

### Conjunto de medidas

`measurements.values` mantém os valores resolvidos usados pelo runtime. `measurements.profile`, quando presente, usa `schemaVersion: 1` e registra para cada medida:

- valor e unidade;
- origem `supplied`, `estimated` ou `derived`;
- fórmula e dependências, quando aplicável;
- versão da fórmula;
- estado de substituição manual.

`supplied` é autoritativo. Uma estimativa substituída continua guardando sua fórmula de origem para que o usuário possa restaurá-la explicitamente. O tipo corporal seleciona apenas o conjunto inicial de defaults.

### Sintaxe de fórmulas V1

O parser é próprio, determinístico e não usa `eval` nem o construtor `Function`.

Operadores, em ordem de precedência: parênteses, unário `+`/`-`, potência `^`, multiplicação/divisão e adição/subtração. Potência é associativa à direita.

Literais suportados:

| Sufixo | Dimensão | Conversão interna |
|---|---|---|
| sem sufixo | escalar | valor original |
| `%` | escalar | divide por 100 |
| `mm` | comprimento | milímetros |
| `cm` | comprimento | multiplica por 10 |
| `m` | comprimento | multiplica por 1000 |
| `deg` | ângulo | graus |
| `rad` | ângulo | converte para graus |

Funções permitidas: `min`, `max`, `abs`, `sqrt`, `clamp`, `round`, `floor`, `ceil`, `sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `atan2` e `hypot`.

O motor rejeita unidades incompatíveis, dependências ausentes, ciclos, divisão por zero, resultados não finitos e entradas fora do domínio das funções. Fórmulas serializadas usam `version: 1`, fonte normalizada, unidade esperada e AST.

### Variáveis e grafo

`variables` pode registrar `formulaVersion` e a lista estável de `dependencies`. `constructionGraph.version` aceita `1` para documentos anteriores e `2` para os nós tipados iniciais:

- `measurement` e `variable`;
- `free-point` e `computed-point`;
- `line`, `arc` e `curve`;
- `transform` e `operation`.

A avaliação é independente de DOM e segue dependências explícitas. Pontos calculados expõem `<id>.x` e `<id>.y`; linhas expõem `<id>.length` ao escopo de fórmulas.

### Versionamento de templates

Cada definição pode carregar `generation`, com versão do template, versão do motor, conjunto de medidas, origens, defaults e valores exatos usados na geração. Um projeto existente conserva essas versões. Adotar fórmulas novas exige migração ou regeneração explícita.
'''
if "## Medidas, fórmulas e construção paramétrica" not in text:
    contract.write_text(text + section + "\n", encoding="utf-8")

Path("docs/DEPENDENCY_AUDIT.md").write_text(r'''# Auditoria de dependências

## Prompt 5: motor paramétrico

Nenhuma dependência de runtime foi adicionada.

O parser, a AST, a avaliação com unidades, o grafo incremental e o grafo de construção foram implementados no próprio repositório. Não foi copiado código de Seamly2D, Valentina ou outros projetos GPL.

A validação visual usa Playwright somente no workflow temporário de auditoria, instalado com `--no-save --package-lock=false`. Ele não integra o bundle, o `package.json` ou o lockfile do produto.

| Componente | Origem | Licença incorporada | Estado |
|---|---|---|---|
| Parser e AST de fórmulas | implementação própria | código do Moldeon | aprovado |
| Motor incremental | implementação própria | código do Moldeon | aprovado |
| Grafo de construção | implementação própria | código do Moldeon | aprovado |
| Playwright da auditoria | ferramenta temporária | Apache-2.0 | não persistido |
''', encoding="utf-8")

scenarios = "\n".join(
    f"| `{item['name']}` | {item['status']} | {len(item.get('diagnostics', []))} |"
    for item in audit["scenarios"]
)
progress = f'''# Prompt 5: medidas, variáveis e motor paramétrico

## Estado

Implementação publicada em `main` em 5 de agosto de 2026.

- commit de implementação: `{implementation}`;
- workflow de validação: `{run_id}`;
- navegador da inspeção: Chromium `{audit['browserVersion']}`;
- formato persistido: `PatternDocumentV3`, sem alteração de `formatVersion`.

## Arquitetura entregue

O módulo `formulaEngine.ts` contém lexer, parser, AST V1, verificação de unidades, allowlist de funções, avaliação determinística, serialização estável e um grafo incremental com cache e dependências reversas. Não existe `eval`, `new Function` ou execução de código arbitrário.

`parametricMeasurements.ts` define o catálogo corporal expandido, perfis versionados e origem por medida. Valores informados são autoritativos; estimativas e derivadas carregam fórmula, dependências e versão. Estimativas podem ser substituídas e restauradas.

`constructionGraph.ts` avalia medidas, variáveis, pontos livres, pontos calculados, linhas, arcos, curvas, transformações e operações iniciais sem DOM. O desenho 2D continua sendo a geometria autoritativa persistida.

## Compatibilidade e versionamento

O `formatVersion` permanece 3. Campos paramétricos são opcionais. Documentos V3 existentes continuam aceitos sem receber automaticamente uma nova versão de fórmula. Projetos novos registram:

- versão do template;
- versão do motor;
- valores e origens das medidas;
- defaults calculados;
- conjunto de fórmulas usado para cada peça gerada.

A geometria já gerada não é reconstruída silenciosamente ao abrir um projeto antigo. Regeneração completa dos moldes-base fica para uma etapa explícita posterior.

## Interface

O formulário corporal possui modo simples e avançado. O modo simples mostra valor, unidade e origem. O avançado mostra fórmula, dependências, versão e erros. Uma fórmula inválida permanece como erro local e não substitui o último perfil válido.

Os campos foram agrupados em medidas gerais, pescoço e ombros, tronco, braços, quadril e gancho, pernas e outras medidas. A disposição é responsiva e mantém entradas com tamanho adequado no mobile.

## Arquivos principais

- `apps/web/src/domain/formulaEngine.ts`;
- `apps/web/src/domain/parametricMeasurements.ts`;
- `apps/web/src/domain/constructionGraph.ts`;
- `apps/web/src/components/BodyMeasurementsForm.tsx`;
- `apps/web/src/domain/pattern.ts`;
- `apps/web/src/domain/patternDocumentV3.types.ts`;
- `apps/web/src/domain/patternDocumentV3.ts`;
- `apps/web/src/state/editorStore.ts`;
- `apps/web/src/patterns/templateCatalog.ts`;
- testes e fixtures paramétricos;
- `docs/PATTERN_DOCUMENT_V3.md`;
- `docs/DEPENDENCY_AUDIT.md`.

## Testes e build

- `npm run typecheck`: aprovado;
- `npm test`: aprovado;
- `npm run build`: aprovado;
- precedência, funções permitidas e unidades: aprovados;
- ciclos, variável ausente, divisão por zero e domínio inválido: aprovados;
- recomputação incremental: aprovada;
- serialização e round trip: aprovados;
- cinco proporções corporais: aprovadas;
- override e restauração de estimativa: aprovados;
- busca por `eval` e construtor `Function`: aprovada;
- compatibilidade e round trip V3: aprovados.

## Inspeção visual

| Cenário | Resultado | Erros de console |
|---|---|---:|
{scenarios}

Capturas e relatório estão em `docs/evidence/prompt05-parametric/`.

## Limitações restantes

A inspeção visual foi executada em Chromium automatizado nas resoluções 1366×768, 1920×1080, 390×844 e 844×390. Não houve validação em aparelho físico, Safari ou leitor de tela real.

Os moldes-base legados continuam usando seus geradores geométricos existentes. Esta etapa registra versão e snapshot e entrega a infraestrutura segura; não converteu todos os geradores antigos para o novo grafo nem implementou gradação industrial.
'''
Path("docs/progress/PROMPT_05_PARAMETRIC_ENGINE.md").write_text(progress, encoding="utf-8")
