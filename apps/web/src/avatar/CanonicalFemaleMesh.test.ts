import { describe, expect, it } from "vitest";
import { canonicalFemaleMesh } from "./CanonicalFemaleMesh";

describe("canonical-female.glb audit and normalization", () => {
  it("loads the approved indexed body surface without mutating the source asset", () => {
    const canonical = canonicalFemaleMesh();
    const { audit } = canonical;

    expect(audit.assetId).toBe("canonical-female.glb");
    expect(audit.sha256).toBe("f308a288de3f4747072e8bd3b955baaf03cd0255dabdbe0f0b30cd225f059176");
    expect(audit.byteLength).toBe(1_003_000);
    expect(audit.selectedMeshName).toBe("Body__0");
    expect(audit.ignoredMeshNames).toEqual(expect.arrayContaining(["leye__0", "reye__0"]));
    expect(audit.meshCount).toBe(3);
    expect(audit.primitiveCount).toBe(3);
    expect(audit.materialCount).toBe(1);
    expect(audit.animationCount).toBe(0);
    expect(audit.skinCount).toBe(0);
    expect(audit.morphTargetCount).toBe(0);
    expect(audit.sourceIndexed).toBe(true);
    expect(audit.sourceHasNormals).toBe(true);
    expect(audit.sourceVertexCount).toBe(17_922);
    expect(audit.sourceTriangleCount).toBe(32_216);
  });

  it("normalizes once to meters, Y-up, +Z-front and a fixed manifold topology", () => {
    const canonical = canonicalFemaleMesh();
    const { audit } = canonical;

    expect(audit.normalization).toMatchObject({
      units: "m",
      up: "+Y",
      front: "+Z",
      right: "+X",
      origin: "ground-center-between-feet",
    });
    expect(audit.normalization.assetWorldMatrix).toHaveLength(16);
    expect(canonical.bounds.min[1]).toBeCloseTo(0, 6);
    expect(canonical.bounds.max[1] - canonical.bounds.min[1]).toBeCloseTo(1.79779, 3);
    expect(audit.weldedDuplicateVertexCount).toBe(1_590);
    expect(audit.cappedBoundaryLoopCount).toBe(32);
    expect(canonical.positions.length / 3).toBe(16_364);
    expect(canonical.indices.length / 3).toBe(32_508);
    expect(canonical.normals.length).toBe(canonical.positions.length);
    expect(canonical.topologySignature).toBe("canonical-female:16364:32508:e990129c");
  });

  it("keeps raw anatomy identical after removing the documented ground translation", () => {
    const canonical = canonicalFemaleMesh();
    const ground = canonical.audit.normalization.groundOffsetM;
    const byPosition = new Set<string>();
    const unique: number[] = [];
    for (let vertex = 0; vertex < canonical.raw.positions.length / 3; vertex += 1) {
      const point = [
        Math.fround(canonical.raw.positions[vertex * 3]),
        Math.fround(canonical.raw.positions[vertex * 3 + 1] + ground),
        Math.fround(canonical.raw.positions[vertex * 3 + 2]),
      ];
      const key = point.map((value) => Math.round(value / 1e-7)).join(":");
      if (byPosition.has(key)) continue;
      byPosition.add(key);
      unique.push(...point);
    }
    expect(unique.length / 3).toBe(
      canonical.positions.length / 3 - canonical.audit.cappedBoundaryLoopCount,
    );
    for (let offset = 0; offset < unique.length; offset += 1) {
      expect(canonical.positions[offset]).toBeCloseTo(unique[offset], 6);
    }
  });
});
