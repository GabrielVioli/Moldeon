from pathlib import Path

source_path = Path("apps/web/src/patterns/trouserVisualEvidence.ts")
source = source_path.read_text(encoding="utf-8")
old = '''  const seamLines = assembly.seams.map((seam) => {
    const first = positions[seam.first.instanceId];
    const second = positions[seam.second.instanceId];
    if (!first || !second) return "";
    const x1 = first.x + 150;
    const y1 = first.y + 70;
    const x2 = second.x + 150;
    const y2 = second.y + 70;
    return `<g>
      <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="seam"/>
      <text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 10}" text-anchor="middle" class="seam-label">${escapeXml(seam.role)}</text>
    </g>`;
  }).join("\\n");
'''
new = '''  const seamLines = assembly.seams.map((seam) => {
    const first = positions[seam.first.instanceId];
    const second = positions[seam.second.instanceId];
    if (!first || !second) return "";
    const firstAnchor = graphConnectorAnchor(first, seam.first.connectorRole);
    const secondAnchor = graphConnectorAnchor(second, seam.second.connectorRole);
    const labelOffsetX = seam.role.includes("outseam")
      ? -70
      : seam.role.includes("inseam")
        ? 70
        : 0;
    return `<g>
      <line x1="${firstAnchor.x}" y1="${firstAnchor.y}" x2="${secondAnchor.x}" y2="${secondAnchor.y}" class="seam"/>
      <text x="${(firstAnchor.x + secondAnchor.x) / 2 + labelOffsetX}" y="${(firstAnchor.y + secondAnchor.y) / 2 - 10}" text-anchor="middle" class="seam-label">${escapeXml(seam.role)}</text>
    </g>`;
  }).join("\\n");
'''
if source.count(old) != 1:
    raise SystemExit(f"expected one graph seam block, found {source.count(old)}")
source = source.replace(old, new, 1)
helper_marker = '''function renderPieceCard(
'''
helper = '''function graphConnectorAnchor(
  position: { x: number; y: number },
  connectorRole: string,
): { x: number; y: number } {
  if (connectorRole === "outseam") {
    return { x: position.x + 48, y: position.y + 70 };
  }
  if (connectorRole === "inseam") {
    return { x: position.x + 252, y: position.y + 70 };
  }
  return { x: position.x + 150, y: position.y + 70 };
}

'''
if source.count(helper_marker) != 1:
    raise SystemExit("renderPieceCard marker not found")
source = source.replace(helper_marker, helper + helper_marker, 1)
source_path.write_text(source, encoding="utf-8")

test_path = Path("apps/web/src/patterns/trouserVisualAudit.test.ts")
test = test_path.read_text(encoding="utf-8")
old_test = '''    expect(evidence.report).toMatchObject({
'''
new_test = '''    for (const seamRole of [
      "left-outseam",
      "left-inseam",
      "right-outseam",
      "right-inseam",
      "front-rise",
      "back-rise",
    ]) {
      expect(evidence.graphSvg).toContain(seamRole);
    }

    expect(evidence.report).toMatchObject({
'''
if test.count(old_test) != 1:
    raise SystemExit("visual test insertion marker not found")
test_path.write_text(test.replace(old_test, new_test, 1), encoding="utf-8")
print("Prompt 7 evidence graph anchors corrected")
