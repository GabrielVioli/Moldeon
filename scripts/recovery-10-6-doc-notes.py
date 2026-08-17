from pathlib import Path

notes = {
    'docs/AVATAR_ARRANGEMENT.md': '''> **Nota de arquitetura (Prompt 10.6):** este documento preserva o histórico do arranjo/avatar da Fase 9.5-07. A partir do 10.6, a solução final de pose relativa entre `PanelInstanceV3` é definida por `docs/ASSEMBLY_ARCHITECTURE.md`. Anchors anatômicos e mappings descritos abaixo podem fornecer contexto/seed, mas não substituem o `GarmentSpatialConstraintGraph` nem o global rigid-pose solve.\n\n''',
    'docs/ASSEMBLY_SYSTEM.md': '''> **Superseded para initial spatial assembly:** a arquitetura vigente de montagem espacial está em `docs/ASSEMBLY_ARCHITECTURE.md`. Este arquivo permanece como histórico/contrato de subsistemas anteriores e não deve ser interpretado como autorização para fallback planar, BFS first-visit ou heurísticas por garment.\n\n''',
    'docs/PATTERN_DOCUMENT_V3.md': '''> **Extensão 10.6:** `SeamGroupV3` pode declarar `physicalPairing: "paired-copies"` quando a mesma faixa material precisa unir cópias físicas distintas de uma única `PatternDefinitionV3`, como o fechamento de gancho entre metades esquerda/direita cortadas 2x. A validação exige pelo menos duas `PanelInstanceV3` da definição; isto não é uma self-seam material.\n\n''',
}
for filename, note in notes.items():
    path = Path(filename)
    if not path.exists():
        continue
    text = path.read_text()
    if note.strip() in text:
        continue
    lines = text.splitlines(keepends=True)
    if lines and lines[0].startswith('#'):
        text = lines[0] + '\n' + note + ''.join(lines[1:]).lstrip('\n')
    else:
        text = note + text
    path.write_text(text)
print('Prompt 10.6 documentation notes applied')
