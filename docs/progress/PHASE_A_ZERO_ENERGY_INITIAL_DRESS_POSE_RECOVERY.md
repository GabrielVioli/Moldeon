# Phase A — recuperação da pose inicial real

Branch: `recovery/11.0.3-material-physics-integrity`

Status: **EM VALIDAÇÃO — NÃO PUBLICAR AINDA**

## Veredito da validação manual

O gate anterior cobria apenas superfícies sintéticas favoráveis. Ele não
provava o comportamento da saia canônica nem de um tubo fechado com três
painéis. A evidência manual mostrou corretamente que o XPBD ainda terminava a
montagem: o STEP 0 nascia com energia estrutural e só assumia uma forma legível
depois de centenas de passos.

## Causas confirmadas

1. **A lateral da saia estava incompleta.** A definição de template escolhia
   apenas o primeiro segmento `sideSeam`; o trecho quadril → barra não fazia
   parte da `SeamGroup`. Isso explica o caso em que a parte inferior caiu
   enquanto a região superior permaneceu presa.
2. **A pence da cintura inclinada era geometricamente incompatível.** A boca
   seguia a inclinação da cintura, mas o ápice continuava vertical. As duas
   pernas tinham comprimentos diferentes e não podiam coincidir preservando a
   métrica 2D.
3. **O seed de pence apagava o frame da instância.** Ao reconstruir a superfície
   desenvolvível, preservava apenas o centroide; rotação, lado e paridade da
   cópia espelhada eram perdidos.
4. **Topologia e compatibilidade métrica estavam misturadas.** Uma costura
   `ease` deixava de participar do grafo espacial, apesar de continuar sendo
   uma ligação física entre painéis. Isso desmontava componentes reais como
   mangas e pernas.
5. **A ordem do XPBD favorecia a seam.** Cada iteração terminava projetando a
   costura. Em sistemas ainda incompatíveis, o diagnóstico do frame via a seam
   fechada à custa de stretch/shear material — exatamente a deformação visual
   observada.
6. **A pence possuía trust region excepcional de 16×.** Um residual pequeno
   podia deslocar a região da pence muito mais rápido que as restrições
   materiais conseguiam reagir.
7. **O gate era sintético demais.** Não havia saia canônica nem cilindro
   fechado de três painéis no contrato estrito de STEP 0 / 500 passos.

O Three.js não é a origem deste defeito: as meshes continuam reconciliadas por
`PanelInstance.id`, com transforms de objeto neutros e material double-sided.
A geometria já chegava deformada ao renderer.

## Correções no worktree

- lateral da saia convertida em lado composto 2↔2, com comprimento de arco
  acumulado e os dois pares físicos `cut-on-fold`;
- eixo da pence construído pela normal interna da cintura; pernas iguais por
  construção;
- paridade material explícita por `AssemblyPanelInstance`, invertida apenas na
  cópia física refletida;
- seed de pence transportado por transformação O(3), preservando frame,
  reflexão, source mapping e métrica;
- `ease/gather/stretch` separados do papel topológico: participam da descoberta
  da casca, mas não são forçados a distância zero pelo projetor isométrico;
- pence removida da competição pelo ciclo global;
- trust region da pence normalizado para o mesmo limite material das demais
  seams;
- ordem seam/material alternada no XPBD, seguida por reconciliação da métrica
  2D, evitando que o último operador esconda fechamento por stretch;
- regressão estrita para cilindro fechado de três painéis;
- regressões de composição da lateral, geometria da pence, paridade O(3) e
  anti-colapso inicial da saia canônica.

## Referência de produto

O comportamento segue a separação usada pelo CLO: arrangement posiciona os
painéis antes da simulação; pences são entidades locais do molde; dobras têm
direção/ângulo próprios; e simetria preserva também as linhas de costura.

- [CLO — Arrangement Points / Wrap Direction](https://support.clo3d.com/hc/en-us/articles/115001999287-Arrange-Pattern-with-Arrangement-Points-Flip-Wrap-Direction)
- [CLO — Segment Darts](https://support.clo3d.com/hc/en-us/articles/115008753767-Segment-Darts)
- [CLO — Fold Arrangement](https://support.clo3d.com/hc/en-us/articles/115012226507-Fold-Arrangement)
- [CLO — Symmetry Pattern with Sewing](https://support.clo3d.com/hc/en-us/articles/115012377688-Apply-Linked-Editing-Symmetry-Pattern-with-Sewing)

Isso não significa copiar a interface do CLO. A referência é o contrato:
assembly decide a pose inicial; XPBD calcula movimento/drape; colisão impede a
interpenetração. Uma etapa não pode mascarar a falha da anterior.

## Gates antes de publicar

- `phase-a-three-panel-cylinder`: STEP 0 tubular e 500 passos sem mudança
  relativa relevante;
- `straight-skirt-standard`: lateral composta completa, quatro instâncias
  físicas presentes, sem painéis coincidentes e sem perda de volume;
- gravity 0 + collision OFF: sem colapso, flips ou crescimento material;
- gravity 100% + collision OFF: somente translação relativa de queda livre;
- reset ×10 determinístico;
- typecheck, testes direcionados, suíte completa, build fallback e navegador
  desktop.

## Validação executada nesta recuperação

- `npm run typecheck`: **PASS**;
- `git diff --check`: **PASS**;
- Vitest/build/browser: **PENDENTES**. O ambiente bloqueou o subprocesso nativo
  do Vite/Rolldown com `spawn EPERM`; nenhuma aprovação foi concedida para a
  execução fora do sandbox.

Não fazer commit/push enquanto os gates pendentes não forem executados.
