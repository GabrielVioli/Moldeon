import { parsePatternDocumentV3 } from "../domain/patternDocumentV3";
import type { PatternDocumentV3 } from "../domain/patternDocumentV3.types";
import { exportPatternProject } from "./patternProjectIO";

export type ProjectDirtyState = "saved" | "dirty";

export interface ProjectRevisionState {
  revision: number;
  signature: string;
  dirtyState: ProjectDirtyState;
}

export interface RevisionedPayload<T> {
  revision: number;
  payload: T;
}

/**
 * Produces a stable, non-cryptographic signature for dirty-state and
 * autosave ordering. `updatedAt` is intentionally ignored so undoing back
 * to the last saved semantic document can become clean again.
 */
export function createProjectDocumentSignature(
  document: PatternDocumentV3,
): string {
  const canonical = parsePatternDocumentV3(document);
  const { updatedAt: _updatedAt, ...stableMetadata } = canonical.metadata;
  return checksumSerializedProject(
    exportPatternProject({
      ...canonical,
      metadata: stableMetadata,
    }),
  );
}

/** Full payload checksum. Unlike the dirty-state signature, this includes updatedAt. */
export function createProjectPayloadChecksum(
  document: PatternDocumentV3,
): string {
  return checksumSerializedProject(exportPatternProject(document));
}

export class ProjectDirtyTracker {
  private revisionValue = 0;
  private currentSignatureValue: string;
  private savedSignatureValue: string | null;

  constructor(
    document: PatternDocumentV3,
    options: { initiallySaved?: boolean } = {},
  ) {
    this.currentSignatureValue = createProjectDocumentSignature(document);
    this.savedSignatureValue =
      options.initiallySaved === false ? null : this.currentSignatureValue;
  }

  get revision(): number {
    return this.revisionValue;
  }

  get signature(): string {
    return this.currentSignatureValue;
  }

  get dirtyState(): ProjectDirtyState {
    return this.savedSignatureValue === this.currentSignatureValue
      ? "saved"
      : "dirty";
  }

  get isDirty(): boolean {
    return this.dirtyState === "dirty";
  }

  update(document: PatternDocumentV3): ProjectRevisionState {
    const nextSignature = createProjectDocumentSignature(document);
    if (nextSignature !== this.currentSignatureValue) {
      this.currentSignatureValue = nextSignature;
      this.revisionValue += 1;
    }
    return this.snapshot();
  }

  markSaved(document?: PatternDocumentV3): ProjectRevisionState {
    if (document) this.update(document);
    this.savedSignatureValue = this.currentSignatureValue;
    return this.snapshot();
  }

  reset(
    document: PatternDocumentV3,
    options: { initiallySaved?: boolean } = {},
  ): ProjectRevisionState {
    this.revisionValue = 0;
    this.currentSignatureValue = createProjectDocumentSignature(document);
    this.savedSignatureValue =
      options.initiallySaved === false ? null : this.currentSignatureValue;
    return this.snapshot();
  }

  snapshot(): ProjectRevisionState {
    return {
      revision: this.revisionValue,
      signature: this.currentSignatureValue,
      dirtyState: this.dirtyState,
    };
  }
}

/**
 * Serializes writes and collapses pending work to the newest revision.
 * This prevents a slow older autosave from becoming the final persisted
 * state after a newer edit.
 */
export class LatestRevisionWriteQueue<T> {
  private pending: RevisionedPayload<T> | null = null;
  private running: Promise<void> | null = null;
  private waiters: Array<{
    revision: number;
    resolve: (persistedRevision: number) => void;
    reject: (reason?: unknown) => void;
  }> = [];
  private lastPersistedRevisionValue = -1;

  constructor(
    private readonly writer: (entry: RevisionedPayload<T>) => Promise<void>,
  ) {}

  get lastPersistedRevision(): number {
    return this.lastPersistedRevisionValue;
  }

  get isIdle(): boolean {
    return this.running === null && this.pending === null;
  }

  enqueue(entry: RevisionedPayload<T>): Promise<number> {
    assertRevision(entry.revision);

    if (entry.revision <= this.lastPersistedRevisionValue) {
      return Promise.resolve(this.lastPersistedRevisionValue);
    }

    if (this.pending === null || entry.revision >= this.pending.revision) {
      this.pending = entry;
    }

    const completion = new Promise<number>((resolve, reject) => {
      this.waiters.push({ revision: entry.revision, resolve, reject });
    });
    this.ensureRunning();
    return completion;
  }

  async flush(): Promise<number> {
    while (this.running !== null || this.pending !== null) {
      this.ensureRunning();
      const currentRun = this.running;
      if (currentRun) await currentRun;
    }
    return this.lastPersistedRevisionValue;
  }

  private ensureRunning(): void {
    if (this.running !== null || this.pending === null) return;

    this.running = this.drain()
      .catch((error: unknown) => {
        this.pending = null;
        const waiters = this.waiters.splice(0);
        for (const waiter of waiters) waiter.reject(error);
      })
      .finally(() => {
        this.running = null;
        if (this.pending !== null) this.ensureRunning();
      });
  }

  private async drain(): Promise<void> {
    while (this.pending !== null) {
      const next = this.pending;
      this.pending = null;

      if (next.revision <= this.lastPersistedRevisionValue) {
        this.resolvePersistedWaiters();
        continue;
      }

      await this.writer(next);
      this.lastPersistedRevisionValue = next.revision;
      this.resolvePersistedWaiters();
    }
  }

  private resolvePersistedWaiters(): void {
    const unresolved = [] as typeof this.waiters;
    for (const waiter of this.waiters) {
      if (waiter.revision <= this.lastPersistedRevisionValue) {
        waiter.resolve(this.lastPersistedRevisionValue);
      } else {
        unresolved.push(waiter);
      }
    }
    this.waiters = unresolved;
  }
}

function checksumSerializedProject(value: string): string {
  return `fnv1a32:${value.length}:${fnv1a32(value)}`;
}

function fnv1a32(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function assertRevision(revision: number): void {
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new TypeError("A revisão do projeto precisa ser um inteiro não negativo.");
  }
}
