# AGENTS_RULES.md

Estas regras valem para qualquer agente trabalhando no Moldeon, salvo quando o prompt da etapa atual determinar explicitamente algo diferente.

## 1. Prioridade das instruções

A ordem de autoridade é:

1. prompt da etapa atual;
2. contratos canônicos já implementados e manualmente aceitos;
3. este AGENTS_RULES.md;
4. inferências do agente.

Não altere arquitetura validada apenas por preferência de implementação.

## 2. Economia de contexto

Não leia o repositório inteiro.

Antes de abrir arquivos, use busca direcionada por símbolo, referência ou string com `rg`, `git grep` ou equivalente.

Não leia arquivos completos quando apenas a região relevante for suficiente.

Expanda o escopo somente quando uma dependência concreta encontrada no código exigir isso.

Não leia `node_modules`, `.next`, `dist`, `build`, `coverage`, lockfiles, artefatos gerados ou outputs grandes salvo necessidade comprovada.

Não releia arquivos já compreendidos sem uma razão concreta.

Após alterações, prefira `git diff`, diff por arquivo ou busca direcionada em vez de reler arquivos completos.

Não faça auditorias amplas novamente quando o prompt já indicar causas, arquivos ou símbolos relevantes.

## 3. Disciplina de escopo

Implemente somente o que pertence à etapa atual.

Não investigue, refatore ou corrija problemas paralelos apenas porque foram encontrados.

Warnings, lint, dívida técnica e problemas preexistentes só devem ser tratados quando bloquearem diretamente a implementação ou um gate obrigatório.

Não introduza novas abstrações, schemas, stores, pipelines ou fontes de verdade quando o domínio canônico existente puder representar o requisito.

Se a solução exigir violar um `NON-GOAL` explícito, pare essa linha de implementação e reporte o blocker.

Não antecipe funcionalidades de etapas futuras.

## 4. Iteração

Não repita cegamente a mesma abordagem.

Se uma abordagem falhar três vezes, interrompa a iteração e reavalie a causa raiz antes de modificar mais código.

Prefira corrigir a causa comprovada a adicionar fallbacks ou patches sucessivos.

Não faça mudanças especulativas em vários subsistemas simultaneamente para descobrir qual resolve o problema.

## 5. Testes

Durante desenvolvimento, rode primeiro os testes focados no subsistema alterado.

Não execute full suite após cada pequena alteração.

Use typecheck, build e testes mais amplos apenas quando necessários para validar integração e no gate final da etapa.

Quando possível:

alteração local
→ teste focado
→ integração
→ gate final

Não transforme falhas preexistentes não relacionadas em trabalho da etapa atual. Registre-as separadamente quando necessário.

## 6. Logs e outputs

Não envie ao contexto logs completos quando somente a exceção, stack relevante ou resumo for suficiente.

Para profiling, benchmarks, soak tests ou traces grandes, salve os dados brutos em arquivo e trabalhe com métricas agregadas.

Evite despejar:
- traces completos;
- snapshots enormes;
- logs repetitivos;
- output de milhares de testes verdes;
- arquivos inteiros sem necessidade.

Extraia somente os dados necessários para tomar a próxima decisão.

## 7. Performance e memória

Não otimize por suposição. Meça antes e depois quando performance fizer parte da alteração.

Não coloque operações pesadas em hot paths interativos sem necessidade comprovada.

Evite rebuild, remesh, serialização, clone, worker restart, autosave ou store update global quando a alteração puder ser localizada.

Caches grandes precisam de lifecycle ou política de limite/evicção.

Workers, listeners, observers, RAFs, timers e resources GPU precisam ser encerrados/dispostos corretamente.

Não aceite ganho de performance obtido silenciosamente reduzindo correção ou precisão exigida pelos gates.

## 8. Git e checkpoints

Antes de modificar:
- confirme branch;
- confirme HEAD;
- confirme worktree.

Não altere a branch-base aceita quando o prompt exigir uma branch nova.

Não faça commit FINAL nem push FINAL antes da validação manual quando a etapa exigir essa validação.

Se houver risco real de quota, timeout ou interrupção:
- pare novas investigações;
- preserve o melhor estado funcional;
- revise o diff;
- rode os testes focados essenciais;
- faça checkpoint WIP coerente quando permitido;
- registre claramente o próximo passo.

## 9. Comunicação

Durante a execução, seja conciso.

Não produza narrativas longas de progresso, arquitetura ou raciocínio quando ações de terminal/ferramentas forem suficientes.

Não repita no output informações que já estão explícitas no prompt.

Ao finalizar, reporte somente o necessário:

- causa raiz;
- implementação realizada;
- arquivos alterados;
- testes e gates executados;
- métricas relevantes;
- blockers ou dívida explicitamente deixada para depois.

## 10. Regra de encerramento

Quando a etapa atual atingir seu critério de aceite ou chegar ao ponto de validação manual solicitado, pare.

Não use tempo ou contexto restante para começar a próxima etapa.

## 11. Arquivos de instrução

AGENTS_RULES.md, o HEAD global do roadmap e os prompts de etapas futuras
são documentação de execução.

Não os modifique durante a implementação de uma etapa, salvo quando o
usuário pedir explicitamente.

Não altere um prompt futuro para fazê-lo se adaptar à implementação atual.
Pare no gate da etapa atual e deixe a reavaliação da etapa seguinte para
depois da validação manual.

## 12. Fonte de verdade da etapa

Ao iniciar uma etapa, registre uma única vez:

- branch-base;
- HEAD-base;
- branch de trabalho;
- HEAD inicial da branch;
- worktree status.

Depois disso, não volte a procurar outra branch ou base salvo se houver
inconsistência concreta.

## 13. Hot paths

Antes de adicionar trabalho a pointermove, mousemove, touchmove,
requestAnimationFrame, render loop ou frame de física, assuma que o caminho
é crítico.

Qualquer nova operação não trivial nesses caminhos precisa justificar:
- frequência;
- custo medido;
- invalidação necessária;
- lifecycle;
- possibilidade de execução somente no commit da gesture.

Nenhum hot path deve serializar/clonar o documento completo.

## 14. Benchmarks

Não altere o cenário, quantidade de painéis, resolução, precisão, número de
iterações ou condições do benchmark entre BEFORE e AFTER sem declarar isso.

Uma otimização só conta como ganho quando comparação e workload forem
equivalentes.