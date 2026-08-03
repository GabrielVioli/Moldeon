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

## Medidas iniciais e estimativas

| Campo | Valor inicial | Limite de interface |
|---|---:|---:|
| Altura | 1680 mm | 1300–2100 mm |
| Busto/tórax | 920 mm | 600–1600 mm |
| Cintura | 760 mm | 500–1500 mm |
| Quadril | 1000 mm | 650–1700 mm |

Os valores são explícitos e editáveis. A interface não os chama de tamanho M.
Cada cartão declara quais medidas usa diretamente e quais medidas técnicas ainda
são estimadas por proporção (por exemplo, pescoço, inclinação do ombro, cava,
altura do quadril, gancho e joelho). Isso torna a incerteza visível, em vez de
apresentar uma geometria genérica como molde final.

## Regras dos geradores

- Todas as coordenadas ficam em milímetros.
- Identificadores de peça e ponto são únicos dentro do modelo.
- Cada gerador cria uma nova cópia; cartões nunca compartilham estado mutável.
- Curvas usam alças relativas ao ponto.
- Folga é declarada pelo modelo, não misturada com medidas corporais.
- Cada peça declara quantidade, dobra e posições de prévia.
- Toda saída passa pela mesma validação e triangulação do editor.
- A geração deve ser determinística para o mesmo conjunto de medidas.
- Contornos usam o formato versionado de nós, segmentos e papéis semânticos.
- Saia reta e minissaia incluem pences reais, linha do quadril e fio.
- Calça diferencia gancho dianteiro/traseiro, inclui pence traseira, quadril,
  joelho e fio.
- Corpos e mangas distinguem cava dianteira/traseira e as duas metades da cabeça
  da manga para permitir validação de costura.

## Limites conhecidos

- As fórmulas produzem blocos paramétricos iniciais e exigem prova em toile.
- A jaqueta está marcada como **Em desenvolvimento** e não pode ser gerada: um
  casaco não deve ser tratado como simples ampliação de camisa.
- Cós, vistas, revel, forro, gola estruturada e aviamentos ainda não são gerados.
- A prévia posiciona painéis ao redor do manequim, mas ainda não executa a
  costura física XPBD.
- Alterar medidas depois de editar livremente exigirá uma decisão futura entre
  regenerar, preservar deslocamentos ou criar uma nova versão.

## Evolução

1. Permitir informar, além de estimar, todas as medidas específicas por categoria.
2. Introduzir parâmetros de estilo separados das medidas.
3. Criar bordas semânticas e relações de costura.
4. Adicionar piques e marcações avançadas.
5. Ampliar a conferência numérica dos comprimentos de costura.
6. Conectar a montagem à física.
7. Adicionar presets próprios do usuário.

## Referências de modelagem

As fórmulas são próprias do Moldeon, mas a decomposição por medidas, folgas,
partes e opções foi adaptada de princípios públicos do ecossistema FreeSewing:

- [Brian — bloco de corpo](https://freesewing.org/designs/brian/)
- [Teagan — camiseta](https://freesewing.org/designs/teagan/)
- [Titan — bloco de calça](https://freesewing.org/designs/titan/)
- [Sarah — bloco de saia e opções de pence](https://freesewing.org/designs/sarah/)
- [Documentação de folga](https://freesewing.dev/reference/api/part/ease/)
- [Documentação de margem de costura](https://freesewing.dev/reference/api/part/seam-allowance/)

Não há cópia de código ou promessa de equivalência com esses projetos. A
atribuição registra as referências conceituais usadas para estruturar os nossos
geradores e deixa explícito onde ainda existem aproximações.

