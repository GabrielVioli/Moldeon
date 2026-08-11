import { describe, expect, it } from "vitest";
import { createPatternDocumentV3Fixture } from "../testFixtures/patternDocumentFixtures";
import {
  LatestRevisionWriteQueue,
  ProjectDirtyTracker,
  createProjectDocumentSignature,
  createProjectPayloadChecksum,
} from "./projectPersistenceCore";

describe("project persistence core", () => {
  it("tracks semantic dirty state while ignoring updatedAt churn", () => {
    const source = createPatternDocumentV3Fixture();
    const tracker = new ProjectDirtyTracker(source);

    const metadataOnly = structuredClone(source);
    metadataOnly.metadata.updatedAt = "2026-08-11T15:00:00.000Z";

    expect(tracker.update(metadataOnly)).toMatchObject({
      revision: 0,
      dirtyState: "saved",
    });
    expect(createProjectDocumentSignature(metadataOnly)).toBe(
      createProjectDocumentSignature(source),
    );
    expect(createProjectPayloadChecksum(metadataOnly)).not.toBe(
      createProjectPayloadChecksum(source),
    );

    const edited = structuredClone(source);
    const point = edited.patternDefinitions[0]?.geometry.points[0];
    expect(point).toBeDefined();
    if (!point) return;
    point.xMm += 25;

    expect(tracker.update(edited)).toMatchObject({
      revision: 1,
      dirtyState: "dirty",
    });

    const undone = structuredClone(source);
    undone.metadata.updatedAt = "2026-08-11T15:05:00.000Z";
    expect(tracker.update(undone)).toMatchObject({
      revision: 2,
      dirtyState: "saved",
    });
  });

  it("can start a new project already dirty and mark it saved later", () => {
    const source = createPatternDocumentV3Fixture();
    const tracker = new ProjectDirtyTracker(source, { initiallySaved: false });

    expect(tracker.isDirty).toBe(true);
    expect(tracker.markSaved()).toMatchObject({
      revision: 0,
      dirtyState: "saved",
    });
  });

  it("serializes writes and collapses pending revisions to the newest one", async () => {
    let releaseFirstWrite: (() => void) | undefined;
    const firstWriteBlocked = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });
    const writes: number[] = [];

    const queue = new LatestRevisionWriteQueue<string>(async (entry) => {
      writes.push(entry.revision);
      if (entry.revision === 1) await firstWriteBlocked;
    });

    const first = queue.enqueue({ revision: 1, payload: "one" });
    const second = queue.enqueue({ revision: 2, payload: "two" });
    const third = queue.enqueue({ revision: 3, payload: "three" });

    expect(writes).toEqual([1]);
    releaseFirstWrite?.();

    await expect(first).resolves.toBe(1);
    await expect(second).resolves.toBe(3);
    await expect(third).resolves.toBe(3);
    await expect(queue.flush()).resolves.toBe(3);
    expect(writes).toEqual([1, 3]);
    expect(queue.isIdle).toBe(true);
  });

  it("rejects invalid revision numbers before scheduling storage work", () => {
    const queue = new LatestRevisionWriteQueue<string>(async () => undefined);

    expect(() => queue.enqueue({ revision: -1, payload: "invalid" })).toThrow(
      "inteiro não negativo",
    );
  });
});
