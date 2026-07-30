# Biblioteca de moldes-base

## Objetivo desta entrega

Entregar um fluxo que já possa ser compreendido sem conhecer CAD:

1. tocar em **Moldes**;
2. informar medidas corporais;
3. escolher uma base;
4. alternar entre as peças do modelo;
5. arrastar pontos e curvas;
6. ver todos os painéis na prévia 3D;
7. exportar as peças em escala vetorial.

Esta biblioteca inicial é uma base de experimentação. Ela não substitui prova,
ajuste fino ou preparação industrial.

## Medidas iniciais

| Campo | Valor inicial | Limite de interface |
|---|---:|---:|
| Altura | 1680 mm | 1300–2100 mm |
| Busto/tórax | 920 mm | 600–1600 mm |
| Cintura | 760 mm | 500–1500 mm |
| Quadril | 1000 mm | 650–1700 mm |

Os valores são explícitos e editáveis. A interface não os chama de tamanho M.

## Regras dos geradores

- Todas as coordenadas ficam em milímetros.
- Identificadores de peça e ponto são únicos dentro do modelo.
- Cada gerador cria uma nova cópia; cartões nunca compartilham estado mutável.
- Curvas usam alças relativas ao ponto.
- Folga é declarada pelo modelo, não misturada com medidas corporais.
- Cada peça declara quantidade, dobra e posições de prévia.
- Toda saída passa pela mesma validação e triangulação do editor.
- A geração deve ser determinística para o mesmo conjunto de medidas.

## Limites conhecidos

- As fórmulas desta primeira biblioteca produzem bases geométricas simples.
- Pences, cós, vistas, revel, forro, gola estruturada e aviamentos ainda não
  são gerados.
- A prévia posiciona painéis ao redor do manequim, mas ainda não executa a
  costura física XPBD.
- Alterar medidas depois de editar livremente exigirá uma decisão futura entre
  regenerar, preservar deslocamentos ou criar uma nova versão.

## Evolução

1. Adicionar medidas específicas por categoria.
2. Introduzir parâmetros de estilo separados das medidas.
3. Criar bordas semânticas e relações de costura.
4. Adicionar fio, piques, pences e marcações.
5. Conferir comprimentos de costura.
6. Conectar a montagem à física.
7. Adicionar presets próprios do usuário.

