from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    source = target.read_text(encoding="utf-8")
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one replacement, found {count}")
    target.write_text(source.replace(old, new, 1), encoding="utf-8")


replace_once(
    "docs/AVATAR_ARRANGEMENT.md",
    '''8. orientação da face externa por instância;
9. duas passagens limitadas de relaxamento de costura, com correção máxima de 4 mm por passagem;
10. renderização apenas das instâncias válidas junto ao avatar.''',
    '''8. refinamento adaptativo da topologia até que arestas de exibição fiquem próximas de 24 mm, respeitando um orçamento por painel;
9. orientação da face externa por instância;
10. uma passagem limitada de relaxamento de costura, com correção máxima de 1,5 mm;
11. renderização apenas das instâncias válidas junto ao avatar.''',
)
replace_once(
    "docs/AVATAR_ARRANGEMENT.md",
    '''A estabilização não possui massa, velocidade, gravidade, integração temporal, colisão ou autocolisão. Ela existe somente para reduzir pequenas aberturas geométricas entre bordas já posicionadas semanticamente.''',
    '''A tesselação adaptativa evita que triângulos grandes formem cordas por dentro das superfícies curvas do corpo. A estabilização não possui massa, velocidade, gravidade, integração temporal, colisão ou autocolisão. Ela existe somente para reduzir pequenas aberturas geométricas entre bordas já posicionadas semanticamente.''',
)
replace_once(
    "docs/progress/PROMPT_09_AVATAR_ASSEMBLY.md",
    '''- câmera enquadrando avatar e roupa em conjunto.''',
    '''- câmera enquadrando avatar e roupa em conjunto;
- tesselação adaptativa baseada no maior lado dos triângulos para preservar superfícies curvas sem atravessar o manequim.''',
)

print("Prompt 9 adaptive surface documentation updated")
