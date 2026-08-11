# Recovery 9.5-06 — moldes-base e assistente de manga

## Resultado

A biblioteca deixa de oferecer camiseta e blusa com manga genérica. `tshirt@3` e `blouse@3` usam o sistema `guided-sleeve@1`, calculado a partir dos arcos reais das cavas frontal e traseira. A jaqueta continua indisponível e explica o motivo; ela não é apresentada como solução pronta.

O trabalho parou na biblioteca e no fluxo guiado de manga. Montagem final, avatar e física não foram ampliados.

## Experiência do usuário

O percurso foi executado no Chrome como usuário novo, em desktop e viewport móvel:

1. abrir a biblioteca;
2. entender quais bases estão disponíveis e por quê;
3. selecionar camiseta, alterar o busto e criar;
4. abrir e cancelar o assistente sem alterar o corpo;
5. reabrir, confirmar frente/costas e a substituição da manga existente;
6. escolher manga longa, editar comprimento e bíceps;
7. voltar, avançar novamente e confirmar que os valores continuam presentes;
8. conferir o encaixe antes de criar;
9. substituir, desfazer e refazer;
10. aguardar o autosave, recarregar e confirmar a restauração.

O teste passou sem overflow horizontal ou erros de console em `1440 × 980` e `390 × 844`. Cancelar, voltar, fechar, undo e redo preservaram o estado esperado. A recarga restaurou busto de 980 mm, `tshirt@3`, metodologia e manga longa.

Na revisão visual, termos internos como “landmarks”, papéis semânticos e IDs de conectores foram removidos da jornada principal. O assistente fala em cava, ombro, axila e pontos de referência. No mobile, as quatro etapas voltaram a ter nomes legíveis e separação do conteúdo.

## Contrato dos templates

Cada item do catálogo declara:

- ID e versão de fórmula;
- estado `experimental`, `geometrically-validated` ou `manually-reviewed`;
- metodologia com ID, versão, nome, tipo de fonte, documentação e referências;
- medidas exigidas e estimadas;
- folgas, limites, revisão manual e estado dos componentes quando aplicável.

Esses dados são persistidos em `PatternGenerationRecord`; não dependem do nome visível da peça. A interface mostra confiança, versão e método após a seleção. Para a calça, mostra também a expansão das duas definições em quatro instâncias físicas e o espelhamento.

Metodologias documentadas:

| Família | ID | Versão | Documento |
|---|---|---|---|
| corpo, camiseta e blusa | `moldeon-upper-block` | `2026.2` | `docs/PATTERN_LIBRARY.md` |
| saia e minissaia | `moldeon-skirt-block` | `2026.2` | `docs/PATTERN_LIBRARY.md` |
| calça | `moldeon-trouser-block` | `2026.2` | `docs/PATTERN_LIBRARY.md` |
| jaqueta indisponível | `moldeon-jacket-pending` | `0` | método pendente |

## Geometria e manga

A camiseta e a blusa preservam frente e costas distintas, decotes diferentes, ombro inclinado, cavas próprias, laterais, cintura, quadril, barra, fio e centros na dobra. A manga nasce das duas cavas e fornece:

- cabeça frontal e traseira diferentes;
- ápice e marca de ombro;
- um pique frontal e dois traseiros;
- linha de bíceps e, na manga longa, linha de cotovelo;
- quantidade de corte 2;
- instância esquerda e direita espelhada;
- conectores e costuras de cava;
- diagnóstico de compatibilidade antes da confirmação.

O motor continua detectando a função pelos papéis geométricos dos segmentos. Renomear frente, costas ou manga não é usado para reconhecer o template.

## Defeitos encontrados pelo uso real

Dois problemas que não apareciam como falha visual imediata foram corrigidos:

- a bancada podia receber interação durante a inicialização; agora há um estado curto e explícito de “Preparando sua bancada”, e atalhos ficam suspensos até o restauro terminar;
- substituir uma manga mantinha as costuras estruturais de ombro/lateral e criava cópias nos grupos guiados. O documento V3 ficava inválido e o autosave falhava. A fusão agora reutiliza costuras com os mesmos intervalos, e as gravações são serializadas para a versão mais recente sempre vencer.

## Validação executada

- invariantes de geometria em cinco corpos paramétricos;
- golden snapshot atualizado para `tshirt@3` e `blouse@3`;
- cavas e cabeças medidas por arco;
- conectores, piques, fio, quantidade de corte e espelhamento;
- documento V3 sem grupos de costura duplicados;
- alteração de medidas;
- substituição explícita;
- cancelar, voltar, fechar, undo e redo;
- autosave e restauração após reload;
- browser desktop e mobile;
- typecheck, suíte completa e build de produção.

Script reproduzível: `scripts/recovery-patterns-sleeve-regression.mjs`.

## Limites de confiança

“Validado geometricamente” não significa pronto para produção. Não houve toile, impressão 1:1, prova em corpos reais ou revisão presencial por modelista. Nenhum template recebeu o estado `manually-reviewed`.

A jaqueta permanece bloqueada. Blazer, punho estruturado, carcela, manga raglan, manga de duas folhas, gradação, montagem final, avatar e física ficam fora desta entrega.

## Preview

URL: a preencher após a publicação desta branch.
