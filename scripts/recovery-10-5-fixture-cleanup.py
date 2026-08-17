from pathlib import Path

p = Path('apps/web/src/garment3d/generalGarmentSpatialAssembly.baseline.test.ts')
s = p.read_text()
s = s.replace(
    'import { getPatternEdges, migrateLegacyPieceToSegments, type GarmentDraft, type PatternPiece, type PatternPoint, type Seam, type SegmentRole } from "../domain/pattern";',
    'import type { GarmentDraft } from "../domain/pattern";'
)
s = s.replace('import { createBaselineFixture } from "../testFixtures/baselineGarments";\n', '')
s = s.replace(
    'import { measureIntrinsicDistortion, type GarmentAssemblyState } from "./GarmentAssembly";',
    'import { createGeneralGarmentShellFixture } from "../testFixtures/generalGarmentShell";\nimport { measureIntrinsicDistortion, type GarmentAssemblyState } from "./GarmentAssembly";'
)
s = s.replace('generalGarmentFixture(', 'createGeneralGarmentShellFixture(')
start = s.index('function createGeneralGarmentShellFixture(options:') if 'function createGeneralGarmentShellFixture(options:' in s else s.index('function generalGarmentFixture(options:')
end = s.index('function relationGroupsByPair(', start)
s = s[:start] + s[end:]
p.write_text(s)
print('Prompt 10.5 shared fixture cleanup applied')
