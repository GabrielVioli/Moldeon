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
    '''8. orientação da face externa por instância;
9. resolução das partes visuais do manequim totalmente cobertas por cada instância semântica;
10. uma passagem limitada de relaxamento de costura, com correção máxima de 1,5 mm;
11. renderização apenas das instâncias válidas, mantendo cabeça, mãos, pés e demais regiões expostas do avatar.''',
)
replace_once(
    "docs/AVATAR_ARRANGEMENT.md",
    '''A estabilização não possui massa, velocidade, gravidade, integração temporal, colisão ou autocolisão. Ela existe somente para reduzir pequenas aberturas geométricas entre bordas já posicionadas semanticamente.''',
    '''Partes internas do manequim que ficam integralmente sob uma roupa são omitidas do avatar visual, prática equivalente à ocultação de superfícies cobertas em personagens vestidos. Essa máscara é derivada de região, lado e comprimento da instância, nunca do nome da peça. Cabeça, mãos, pés e regiões expostas permanecem visíveis. A estabilização não possui massa, velocidade, gravidade, integração temporal, colisão ou autocolisão. Ela existe somente para reduzir pequenas aberturas geométricas entre bordas já posicionadas semanticamente.''',
)
replace_once(
    "docs/progress/PROMPT_09_AVATAR_ASSEMBLY.md",
    '''- câmera enquadrando avatar e roupa em conjunto.''',
    '''- câmera enquadrando avatar e roupa em conjunto;
- máscara semântica das superfícies do manequim totalmente cobertas, evitando que o corpo recorte visualmente painéis posicionados sobre superfícies curvas.''',
)

print("Prompt 9 semantic coverage documentation updated")
