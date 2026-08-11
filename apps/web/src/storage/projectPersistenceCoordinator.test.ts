import { afterEach, describe, expect, it, vi } from "vitest";
import { createPatternDocumentV3Fixture } from "../testFixtures/patternDocumentFixtures";
import { parseCanonicalAutosave } from "./canonicalAutosave";
import {
  ProjectAutosaveRepository,
  type ProjectAutosaveStoragePort,
} from "./projectAutosaveRepository";
import { ProjectPersistenceCoordinator } from "./projectPersistenceCoordinator";

class MemoryStorage implements ProjectAutosaveStoragePort {
  value: string | null = null;
  writes = 0;
  failNextWrite = false;

  async read(): Promise<string | null> {
    return this.value;
  }

  async write(serialized: string): Promise<void> {
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error("quota");
    }
    this.writes += 1;
    this.value = serialized;
  }

  async clear(): Promise<void> {
    this.value = null;
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe("ProjectPersistenceCoordinator", () => {
  it("debounces rapid edits and writes only the newest stable revision", async () => {
    vi.useFakeTimers();
    const source = createPatternDocumentV3Fixture();
    const storage = new MemoryStorage();
    const repository = new ProjectAutosaveRepository(
      storage,
      () => "2026-08-11T16:10:00.000Z",
    );
    const coordinator = new ProjectPersistenceCoordinator(source, repository, {
      debounceMs: 700,
    });

    const firstEdit = structuredClone(source);
    const firstPoint = firstEdit.patternDefinitions[0]?.geometry.points[0];
    expect(firstPoint).toBeDefined();
    if (!firstPoint) return;
    firstPoint.xMm += 10;
    expect(coordinator.update(firstEdit).revision).toBe(1);

    const secondEdit = structuredClone(firstEdit);
    const secondPoint = secondEdit.patternDefinitions[0]?.geometry.points[0];
    expect(secondPoint).toBeDefined();
    if (!secondPoint) return;
    secondPoint.xMm += 20;
    expect(coordinator.update(secondEdit).revision).toBe(2);

    await vi.advanceTimersByTimeAsync(699);
    expect(storage.writes).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    await coordinator.flushAutosave();

    expect(storage.writes).toBe(1);
    const raw = storage.value;
    expect(raw).not.toBeNull();
    if (!raw) return;
    const record = parseCanonicalAutosave(raw);
    expect(record.revision).toBe(2);
    expect(record.document.patternDefinitions[0]?.geometry.points[0]?.xMm).toBe(
      secondPoint.xMm,
    );
  });

  it("keeps explicit save state separate from recovery autosave", async () => {
    vi.useFakeTimers();
    const source = createPatternDocumentV3Fixture();
    const storage = new MemoryStorage();
    const repository = new ProjectAutosaveRepository(storage);
    const coordinator = new ProjectPersistenceCoordinator(source, repository);
    const edited = structuredClone(source);
    const point = edited.patternDefinitions[0]?.geometry.points[0];
    expect(point).toBeDefined();
    if (!point) return;
    point.yMm += 15;

    expect(coordinator.update(edited).dirtyState).toBe("dirty");
    await vi.runAllTimersAsync();
    await coordinator.flushAutosave();
    expect(coordinator.state.dirtyState).toBe("dirty");

    expect(coordinator.markExplicitlySaved(edited).dirtyState).toBe("saved");
  });

  it("retains a failed autosave for retry without blocking future editing", async () => {
    vi.useFakeTimers();
    const source = createPatternDocumentV3Fixture();
    const storage = new MemoryStorage();
    storage.failNextWrite = true;
    const errors: unknown[] = [];
    const repository = new ProjectAutosaveRepository(storage);
    const coordinator = new ProjectPersistenceCoordinator(source, repository, {
      debounceMs: 10,
      onAutosaveError: (error) => errors.push(error),
    });
    const edited = structuredClone(source);
    const point = edited.patternDefinitions[0]?.geometry.points[0];
    expect(point).toBeDefined();
    if (!point) return;
    point.xMm += 5;

    coordinator.update(edited);
    await vi.advanceTimersByTimeAsync(10);

    expect(errors).toHaveLength(1);
    expect(coordinator.lastAutosaveError).toBeInstanceOf(Error);
    expect(coordinator.pendingRevision).toBe(1);

    await coordinator.flushAutosave();
    expect(coordinator.lastAutosaveError).toBeNull();
    expect(storage.writes).toBe(1);
  });
});
