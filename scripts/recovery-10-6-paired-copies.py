from pathlib import Path

root = Path('.')

# 1) Legacy/runtime Seam projection gains an explicit physical-copy pairing mode.
path = root / 'apps/web/src/domain/pattern.ts'
text = path.read_text()
old = '''  slackMm?: number;\n  active?: boolean;\n}'''
new = '''  slackMm?: number;\n  /**\n   * Costura a mesma faixa material entre cópias físicas distintas da mesma\n   * PatternDefinition. Necessário para gancho frontal/traseiro de calças e\n   * outros fechamentos de peças cortadas em pares.\n   */\n  physicalPairing?: "paired-copies";\n  active?: boolean;\n}'''
assert old in text
text = text.replace(old, new, 1)
old = '''      const slackMm = s.slackMm === undefined ? undefined : readFiniteNumber(s.slackMm, `A folga da costura ${i + 1}`);\n      if (!seamIds.has(id)) {'''
new = '''      const slackMm = s.slackMm === undefined ? undefined : readFiniteNumber(s.slackMm, `A folga da costura ${i + 1}`);\n      const physicalPairing = s.physicalPairing === undefined ? undefined : readEnum(\n        s.physicalPairing,\n        ["paired-copies"] as const,\n        `O pareamento físico da costura ${i + 1}`,\n      );\n      if (!seamIds.has(id)) {'''
assert old in text
text = text.replace(old, new, 1)
old = '''          ...(slackMm === undefined ? {} : { slackMm }),\n          active,'''
new = '''          ...(slackMm === undefined ? {} : { slackMm }),\n          ...(physicalPairing === undefined ? {} : { physicalPairing }),\n          active,'''
assert old in text
text = text.replace(old, new, 1)
path.write_text(text)

# 2) Canonical V3 keeps this physical relation instead of synthesizing it later.
path = root / 'apps/web/src/domain/patternDocumentV3.types.ts'
text = path.read_text()
old = '''  slackMm: number;\n  active: boolean;\n  compatibility?: SeamGroupCompatibilityV3;'''
new = '''  slackMm: number;\n  /** Resolve a relation between distinct PanelInstanceV3 copies of the same definition. */\n  physicalPairing?: "paired-copies";\n  active: boolean;\n  compatibility?: SeamGroupCompatibilityV3;'''
assert old in text
path.write_text(text.replace(old, new, 1))

path = root / 'apps/web/src/domain/patternDocumentV3.ts'
text = path.read_text()
# allow material overlap only when the relation explicitly targets distinct copies
old = '''    if (seamSidesMateriallyOverlap(group.first, group.second)) {\n      issues.push(issue("degenerate-self-seam", "error", `O grupo ${group.id} costura exatamente os mesmos intervalos.`, group.id));\n    }'''
new = '''    if (seamSidesMateriallyOverlap(group.first, group.second) && group.physicalPairing !== "paired-copies") {\n      issues.push(issue("degenerate-self-seam", "error", `O grupo ${group.id} costura exatamente os mesmos intervalos.`, group.id));\n    }\n    if (group.physicalPairing === "paired-copies") {\n      const sourceIds = new Set([...group.first, ...group.second].map((range) => range.pieceId));\n      const enoughCopies = sourceIds.size === 1 && [...sourceIds].every((patternId) =>\n        document.panelInstances.filter((instance) => instance.sourcePatternId === patternId).length >= 2,\n      );\n      if (!enoughCopies) {\n        issues.push(issue("invalid-panel-instance", "error", `O grupo ${group.id} exige pelo menos duas cópias físicas da mesma definição.`, group.id));\n      }\n    }'''
assert old in text
text = text.replace(old, new, 1)
# V3 -> legacy projection
old = '''    slackMm: group.slackMm,\n    active: group.active,'''
new = '''    slackMm: group.slackMm,\n    ...(group.physicalPairing === undefined ? {} : { physicalPairing: group.physicalPairing }),\n    active: group.active,'''
assert old in text
text = text.replace(old, new, 1)
# legacy -> V3
old = '''    slackMm: seam.slackMm ?? 0,\n    active: seam.active !== false,'''
new = '''    slackMm: seam.slackMm ?? 0,\n    ...(seam.physicalPairing === undefined ? {} : { physicalPairing: seam.physicalPairing }),\n    active: seam.active !== false,'''
assert old in text
text = text.replace(old, new, 1)
# parse V3
old = '''      slackMm: readNonNegativeNumber(candidate.slackMm, `A folga da costura ${index + 1}`),\n      active: readBoolean(candidate.active, `O estado da costura ${index + 1}`),'''
new = '''      slackMm: readNonNegativeNumber(candidate.slackMm, `A folga da costura ${index + 1}`),\n      ...(candidate.physicalPairing === undefined ? {} : {\n        physicalPairing: readEnum(candidate.physicalPairing, ["paired-copies"] as const, `O pareamento físico da costura ${index + 1}`),\n      }),\n      active: readBoolean(candidate.active, `O estado da costura ${index + 1}`),'''
assert old in text
text = text.replace(old, new, 1)
path.write_text(text)

# 3) Assembly-domain validation understands that equal material ranges are valid across copies.
path = root / 'apps/web/src/domain/assembly.ts'
text = path.read_text()
old = '''export function validateSeamForAssembly(\n  seam: Seam,\n  garment: Pick<GarmentDraft, "pieces" | "seams">,\n) {\n  return validateSeam(seam, garment).filter(\n    (issue) =>\n      issue.code !== "length-mismatch" ||\n      (seam.treatment ?? "standard") === "standard",\n  );\n}'''
new = '''export function validateSeamForAssembly(\n  seam: Seam,\n  garment: Pick<GarmentDraft, "pieces" | "seams">,\n) {\n  return validateSeam(seam, garment).filter((issue) => {\n    if (issue.code === "invalid-self-seam" && seam.physicalPairing === "paired-copies") return false;\n    return issue.code !== "length-mismatch" || (seam.treatment ?? "standard") === "standard";\n  });\n}'''
assert old in text
text = text.replace(old, new, 1)
old = '''    if (seamSidesMateriallyOverlap(firstRanges, secondRanges)) {\n      issues.push(\n        `${seam.name ?? seam.id}: a mesma faixa não pode ser costurada sobre ela mesma.`,\n      );\n      continue;\n    }'''
new = '''    if (seamSidesMateriallyOverlap(firstRanges, secondRanges) && seam.physicalPairing !== "paired-copies") {\n      issues.push(\n        `${seam.name ?? seam.id}: a mesma faixa não pode ser costurada sobre ela mesma.`,\n      );\n      continue;\n    }'''
assert old in text
text = text.replace(old, new, 1)
path.write_text(text)

# 4) Runtime constraint builder resolves paired copies into distinct PanelInstances.
path = root / 'apps/web/src/garment3d/GarmentAssembly.ts'
text = path.read_text()
old = '''    if (seamSidesMateriallyOverlap(firstRanges, secondRanges)) {\n      warnings.push(`${seam.name ?? seam.id}: a mesma faixa não pode ser costurada sobre ela mesma.`);\n      continue;\n    }'''
new = '''    if (seamSidesMateriallyOverlap(firstRanges, secondRanges) && seam.physicalPairing !== "paired-copies") {\n      warnings.push(`${seam.name ?? seam.id}: a mesma faixa não pode ser costurada sobre ela mesma.`);\n      continue;\n    }'''
assert old in text
text = text.replace(old, new, 1)
old = '''      const pairs = firstPoint.range.pieceId === secondPoint.range.pieceId\n        ? firstInstances.map((instance) => [instance, instance] as const)\n        : pairInstances(firstInstances, secondInstances);'''
new = '''      const pairs = firstPoint.range.pieceId === secondPoint.range.pieceId\n        ? seam.physicalPairing === "paired-copies"\n          ? pairDistinctPhysicalCopies(firstInstances)\n          : firstInstances.map((instance) => [instance, instance] as const)\n        : pairInstances(firstInstances, secondInstances);'''
assert old in text
text = text.replace(old, new, 1)
# insert helper before pairInstances
marker = '''function pairInstances(\n  first: readonly AssemblyPanelInstance[],'''
helper = '''function pairDistinctPhysicalCopies(\n  instances: readonly AssemblyPanelInstance[],\n): Array<readonly [AssemblyPanelInstance, AssemblyPanelInstance]> {\n  const ordered = [...instances].sort((left, right) => {\n    const leftSide = left.placement.bodySide === "left" ? 0 : left.placement.bodySide === "right" ? 1 : 2;\n    const rightSide = right.placement.bodySide === "left" ? 0 : right.placement.bodySide === "right" ? 1 : 2;\n    return leftSide - rightSide || left.id.localeCompare(right.id);\n  });\n  const result: Array<readonly [AssemblyPanelInstance, AssemblyPanelInstance]> = [];\n  for (let index = 0; index + 1 < ordered.length; index += 2) {\n    result.push([ordered[index], ordered[index + 1]] as const);\n  }\n  return result;\n}\n\n'''
assert marker in text
text = text.replace(marker, helper + marker, 1)
path.write_text(text)

# 5) The straight-pants template now persists front-rise and back-rise closures.
path = root / 'apps/web/src/domain/templateAssemblySeams.ts'
text = path.read_text()
old = '''  if (trouserDefinitions.length > 0) {\n    return trouserDefinitions.map(createSeam);\n  }'''
new = '''  if (trouserDefinitions.length > 0) {\n    return [\n      ...trouserDefinitions.map(createSeam),\n      ...buildTrouserPairedCopyClosures(garment.pieces),\n    ];\n  }'''
assert old in text
text = text.replace(old, new, 1)
marker = '''function buildSkirtDefinitions(\n  pieces: readonly PatternPiece[],'''
helper = '''function buildTrouserPairedCopyClosures(\n  pieces: readonly PatternPiece[],\n): Seam[] {\n  const result: Seam[] = [];\n  const definitions: Array<{ role: "frontCrotch" | "backCrotch"; key: string; name: string }> = [\n    { role: "frontCrotch", key: "trouser-front-rise", name: "Fechamento do gancho frontal" },\n    { role: "backCrotch", key: "trouser-back-rise", name: "Fechamento do gancho traseiro" },\n  ];\n  for (const definition of definitions) {\n    const piece = pieces.find((candidate) => hasRole(candidate, definition.role));\n    if (!piece || (piece.cutQuantity ?? 1) < 2) continue;\n    const edges = edgesWithRole(piece, definition.role);\n    if (edges.length === 0) continue;\n    const ranges = edges.map((edge) => ({\n      pieceId: piece.id,\n      edgeId: edge.id,\n      startT: 0,\n      endT: 1,\n    }));\n    const first = ranges[0];\n    const totalLength = edgeRangeSequenceLength([piece], ranges);\n    result.push({\n      id: `template-seam:${definition.key}`,\n      groupId: `template-seam:${definition.key}`,\n      name: definition.name,\n      first,\n      second: { ...first },\n      firstRanges: ranges.map((range) => ({ ...range })),\n      secondRanges: ranges.map((range) => ({ ...range })),\n      direction: "same",\n      easeRatio: 0,\n      type: "standard",\n      treatment: "standard",\n      canonicalTreatment: "standard",\n      distribution: "uniform",\n      targetRatio: 1,\n      slackMm: 0,\n      physicalPairing: "paired-copies",\n      active: true,\n    });\n    void totalLength;\n  }\n  return result;\n}\n\n'''
assert marker in text
text = text.replace(marker, helper + marker, 1)
path.write_text(text)

print('Prompt 10.6 paired-copy seam model applied')
