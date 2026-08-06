# Auditoria de dependências

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
