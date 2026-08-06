from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    source = target.read_text(encoding="utf-8")
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one replacement, found {count}: {old[:90]!r}")
    target.write_text(source.replace(old, new, 1), encoding="utf-8")


arrangement = "apps/web/src/garment3d/SemanticAvatarArrangement.ts"
replace_once(
    arrangement,
    '''  diagnostics: ArrangementDiagnostic[];
  visibleInstanceIds: Set<string>;
}''',
    '''  diagnostics: ArrangementDiagnostic[];
  visibleInstanceIds: Set<string>;
  coveredAvatarPartNames: Set<string>;
}''',
)
replace_once(
    arrangement,
    '''  state.initialPositions.set(state.positions);
  state.previousPositions.set(state.positions);

  return {
    garment: resolvedGarment,
    state,
    avatar,
    collision: buildAvatarCollisionModel(avatar),
    diagnostics: uniqueDiagnostics(diagnostics),
    visibleInstanceIds,
  };''',
    '''  state.initialPositions.set(state.positions);
  state.previousPositions.set(state.positions);
  const coveredAvatarPartNames = resolveCoveredAvatarParts(state, visibleInstanceIds, avatar);

  return {
    garment: resolvedGarment,
    state,
    avatar,
    collision: buildAvatarCollisionModel(avatar),
    diagnostics: uniqueDiagnostics(diagnostics),
    visibleInstanceIds,
    coveredAvatarPartNames,
  };''',
)
insert_marker = '''function arrangeInstance(
  state: GarmentAssemblyState,'''
coverage_function = r'''function resolveCoveredAvatarParts(
  state: GarmentAssemblyState,
  visibleInstanceIds: ReadonlySet<string>,
  avatar: AvatarParametricModel,
): Set<string> {
  const covered = new Set<string>();
  const upperArmLength = Math.hypot(
    avatar.joints.elbowLeft[0] - avatar.joints.shoulderLeft[0],
    avatar.joints.elbowLeft[1] - avatar.joints.shoulderLeft[1],
    avatar.joints.elbowLeft[2] - avatar.joints.shoulderLeft[2],
  );
  const thighLength = Math.max(0.1, avatar.landmarks.crotchY - avatar.landmarks.kneeY);

  for (const instance of state.instances) {
    if (!visibleInstanceIds.has(instance.id)) continue;
    const region = instance.placement.region;
    const side = instance.placement.bodySide;
    const panelLength = instance.topology.boundsMm.height * validScale(instance.placement.scale) * METERS_PER_MM;

    if (region === "torso") {
      covered.add("avatar:chest");
      covered.add("avatar:abdomen");
      continue;
    }

    if (region === "waist" || region === "hip") {
      covered.add("avatar:abdomen");
      covered.add("avatar:pelvis");
      const bodySides = side === "center" ? (["left", "right"] as const) : ([side] as const);
      for (const bodySide of bodySides) {
        if (bodySide !== "left" && bodySide !== "right") continue;
        covered.add(`avatar:hip-${bodySide}`);
        covered.add(`avatar:thigh-${bodySide}`);
        if (panelLength >= thighLength * 0.82) covered.add(`avatar:knee-${bodySide}`);
        if (panelLength >= thighLength * 1.55) covered.add(`avatar:calf-${bodySide}`);
      }
      continue;
    }

    if (region === "arm" && (side === "left" || side === "right")) {
      covered.add(`avatar:shoulder-${side}`);
      covered.add(`avatar:upper-arm-${side}`);
      if (panelLength >= upperArmLength * 0.78) {
        covered.add(`avatar:elbow-${side}`);
        covered.add(`avatar:forearm-${side}`);
      }
      continue;
    }

    if (region === "leg" && (side === "left" || side === "right")) {
      covered.add("avatar:pelvis");
      covered.add(`avatar:hip-${side}`);
      covered.add(`avatar:thigh-${side}`);
      covered.add(`avatar:knee-${side}`);
      covered.add(`avatar:calf-${side}`);
    }
  }

  return covered;
}

'''
target = ROOT / arrangement
source = target.read_text(encoding="utf-8")
if coverage_function.strip() not in source:
    index = source.find(insert_marker)
    if index < 0:
        raise SystemExit("SemanticAvatarArrangement.ts: arrangeInstance marker not found")
    source = source[:index] + coverage_function + source[index:]
    target.write_text(source, encoding="utf-8")

visual = "apps/web/src/viewport/AvatarVisual.ts"
replace_once(
    visual,
    '''  receiveShadow: boolean;
}''',
    '''  receiveShadow: boolean;
  hiddenPartNames?: ReadonlySet<string>;
}''',
)
replace_once(
    visual,
    '''  options: AvatarVisualOptions,
): void {
  const geometry = new THREE.SphereGeometry''',
    '''  options: AvatarVisualOptions,
): void {
  if (options.hiddenPartNames?.has(name)) return;
  const geometry = new THREE.SphereGeometry''',
)
replace_once(
    visual,
    '''  options: AvatarVisualOptions,
): void {
  const direction = new THREE.Vector3''',
    '''  options: AvatarVisualOptions,
): void {
  if (options.hiddenPartNames?.has(name)) return;
  const direction = new THREE.Vector3''',
)

viewport = "apps/web/src/viewport/GlobalThreeViewport.ts"
replace_once(
    viewport,
    '''    const avatar = buildAvatarParametricModel(garment.measurements, garment.bodyType);
    const visual = createAvatarVisual(avatar, {
      radialSegments: this.profile.avatarRadialSegments,
      castShadow: this.profile.shadows,
      receiveShadow: this.profile.shadows,
    });
    this.avatarGroup.add(visual);

    const arrangement = buildSemanticAvatarArrangement(snapshots, garment, avatar);''',
    '''    const avatar = buildAvatarParametricModel(garment.measurements, garment.bodyType);
    const arrangement = buildSemanticAvatarArrangement(snapshots, garment, avatar);
    const visual = createAvatarVisual(avatar, {
      radialSegments: this.profile.avatarRadialSegments,
      castShadow: this.profile.shadows,
      receiveShadow: this.profile.shadows,
      hiddenPartNames: arrangement.coveredAvatarPartNames,
    });
    this.avatarGroup.add(visual);''',
)
replace_once(
    viewport,
    '''    this.host.dataset.garmentInstanceCount = String(this.garmentMeshes.length);
    this.host.dataset.arrangementDiagnosticCount''',
    '''    this.host.dataset.garmentInstanceCount = String(this.garmentMeshes.length);
    this.host.dataset.coveredAvatarPartCount = String(arrangement.coveredAvatarPartNames.size);
    this.host.dataset.arrangementDiagnosticCount''',
)

test_path = ROOT / "apps/web/src/garment3d/SemanticAvatarArrangement.test.ts"
test_source = test_path.read_text(encoding="utf-8")
insert = r'''

  it("masks only mannequin shells covered by each semantic garment", () => {
    const shirt = arrange("tshirt");
    expect([...shirt.coveredAvatarPartNames]).toEqual(expect.arrayContaining([
      "avatar:chest",
      "avatar:abdomen",
      "avatar:upper-arm-left",
      "avatar:upper-arm-right",
    ]));
    expect(shirt.coveredAvatarPartNames.has("avatar:head")).toBe(false);
    expect(shirt.coveredAvatarPartNames.has("avatar:hand-left")).toBe(false);

    const skirt = arrange("straight-skirt");
    expect([...skirt.coveredAvatarPartNames]).toEqual(expect.arrayContaining([
      "avatar:pelvis",
      "avatar:thigh-left",
      "avatar:thigh-right",
    ]));
    expect(skirt.coveredAvatarPartNames.has("avatar:calf-left")).toBe(false);

    const trousers = arrange("straight-pants");
    expect([...trousers.coveredAvatarPartNames]).toEqual(expect.arrayContaining([
      "avatar:pelvis",
      "avatar:thigh-left",
      "avatar:thigh-right",
      "avatar:calf-left",
      "avatar:calf-right",
    ]));
    expect(trousers.coveredAvatarPartNames.has("avatar:foot-left")).toBe(false);
  });
'''
marker = '\n});\n'
if insert.strip() not in test_source:
    index = test_source.rfind(marker)
    if index < 0:
        raise SystemExit("SemanticAvatarArrangement.test.ts: describe ending not found")
    test_source = test_source[:index] + insert + test_source[index:]
test_path.write_text(test_source, encoding="utf-8")

avatar_visual_test = ROOT / "apps/web/src/viewport/AvatarVisual.test.ts"
avatar_visual_test.write_text(r'''import { describe, expect, it } from "vitest";
import { buildAvatarParametricModel } from "../avatar/AvatarParametricModel";
import { DEFAULT_BODY_MEASUREMENTS } from "../patterns/templateCatalog";
import { createAvatarVisual } from "./AvatarVisual";

describe("AvatarVisual coverage", () => {
  it("omits covered internal shells while preserving visible human extremities", () => {
    const avatar = buildAvatarParametricModel(DEFAULT_BODY_MEASUREMENTS, "feminine");
    const visual = createAvatarVisual(avatar, {
      radialSegments: 10,
      castShadow: false,
      receiveShadow: false,
      hiddenPartNames: new Set(["avatar:chest", "avatar:pelvis", "avatar:thigh-left"]),
    });
    const names = new Set<string>();
    visual.traverse((object) => names.add(object.name));
    expect(names.has("avatar:chest")).toBe(false);
    expect(names.has("avatar:pelvis")).toBe(false);
    expect(names.has("avatar:thigh-left")).toBe(false);
    expect(names.has("avatar:head")).toBe(true);
    expect(names.has("avatar:hand-left")).toBe(true);
    expect(names.has("avatar:foot-left")).toBe(true);
  });
});
''', encoding="utf-8")

print("Prompt 9 semantic avatar coverage mask applied")
