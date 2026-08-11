import { describe, expect, it } from "vitest";
import { createPatternDocumentV3Fixture } from "../testFixtures/patternDocumentFixtures";
import { parseCanonicalAutosave } from "./canonicalAutosave";
import {
  ProjectAutosaveRepository,
  type ProjectAutosaveStoragePort,
} from "./projectAutosaveRepository";

class MemoryStorage implements ProjectAutosaveStoragePort {
  value: string | null = null;
  writes = 0;

  async read(): Promise<string | null> {
    return this.value;
  }

  async write(serialized: string): Promise<void> {
    this.writes += 1;
    this.value = serialized;
  }

  async clear(): Promise<void> {
    this.value = null;
  }
}

describe("ProjectAutosaveRepository", () => {
  it("persists and restores the canonical V3 document with its revision", async () => {
    const storage = new MemoryStorage();
    const repository = new ProjectAutosaveRepository(
      storage,
      () => "2026-08-11T16:00:00.000Z",
    );
    const source = createPatternDocumentV3Fixture();

    await expect(repository.save(source, 4)).resolves.toBe(4);
    await expect(repository.flush()).resolves.toBe(4);

    const raw = storage.value;
    expect(raw).not.toBeNull();
    if (!raw) return;
    expect(parseCanonicalAutosave(raw)).toMatchObject({
      revision: 4,
      savedAt: "2026-08-11T16:00:00.000Z",
    });

    const reopened = new ProjectAutosaveRepository(storage);
    const restored = await reopened.load();
    expect(restored?.revision).toBe(4);
    expect(restored?.document).toEqual(source);
  });

  it("does not let an older revision overwrite a recovered newer autosave", async () => {
    const storage = new MemoryStorage();
    const firstSession = new ProjectAutosaveRepository(storage);
    const source = createPatternDocumentV3Fixture();

    await firstSession.save(source, 9);
    await firstSession.flush();
    expect(storage.writes).toBe(1);

    const reopened = new ProjectAutosaveRepository(storage);
    await reopened.load();
    await expect(reopened.save(source, 3)).resolves.toBe(9);
    await reopened.flush();

    expect(storage.writes).toBe(1);
    expect(reopened.lastPersistedRevision).toBe(9);
  });

  it("captures a canonical document at enqueue time instead of retaining a mutable editor object", async () => {
    const storage = new MemoryStorage();
    const repository = new ProjectAutosaveRepository(storage);
    const source = createPatternDocumentV3Fixture();
    const originalName = source.metadata.name;

    const pendingSave = repository.save(source, 1);
    source.metadata.name = "Mutação posterior";
    await pendingSave;
    await repository.flush();

    const raw = storage.value;
    expect(raw).not.toBeNull();
    if (!raw) return;
    expect(parseCanonicalAutosave(raw).document.metadata.name).toBe(originalName);
  });

  it("clears recovery storage only after pending writes are flushed", async () => {
    const storage = new MemoryStorage();
    const repository = new ProjectAutosaveRepository(storage);
    const source = createPatternDocumentV3Fixture();

    void repository.save(source, 1);
    await repository.clear();

    expect(storage.value).toBeNull();
    expect(repository.lastPersistedRevision).toBe(-1);
  });
});
