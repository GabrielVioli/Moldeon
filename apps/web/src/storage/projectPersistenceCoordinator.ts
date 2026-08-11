import { parsePatternDocumentV3 } from "../domain/patternDocumentV3";
import type { PatternDocumentV3 } from "../domain/patternDocumentV3.types";
import { ProjectAutosaveRepository } from "./projectAutosaveRepository";
import {
  ProjectDirtyTracker,
  type ProjectRevisionState,
} from "./projectPersistenceCore";

export interface ProjectPersistenceCoordinatorOptions {
  debounceMs?: number;
  initiallySaved?: boolean;
  onAutosaveError?: (error: unknown) => void;
}

interface PendingAutosave {
  document: PatternDocumentV3;
  revision: number;
}

/**
 * Editor-facing orchestration for dirty state + debounced recovery autosave.
 * Explicit .moldeon saves remain separate and call markExplicitlySaved only
 * after their own write succeeds.
 */
export class ProjectPersistenceCoordinator {
  private readonly dirtyTracker: ProjectDirtyTracker;
  private readonly debounceMs: number;
  private readonly onAutosaveError?: (error: unknown) => void;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: PendingAutosave | null = null;
  private lastAutosaveErrorValue: unknown | null = null;

  constructor(
    initialDocument: PatternDocumentV3,
    private readonly autosave: ProjectAutosaveRepository,
    options: ProjectPersistenceCoordinatorOptions = {},
  ) {
    this.debounceMs = options.debounceMs ?? 700;
    if (!Number.isFinite(this.debounceMs) || this.debounceMs < 0) {
      throw new TypeError("O debounce do autosave precisa ser não negativo.");
    }
    this.onAutosaveError = options.onAutosaveError;
    this.dirtyTracker = new ProjectDirtyTracker(initialDocument, {
      initiallySaved: options.initiallySaved,
    });
  }

  get state(): ProjectRevisionState {
    return this.dirtyTracker.snapshot();
  }

  get lastAutosaveError(): unknown | null {
    return this.lastAutosaveErrorValue;
  }

  get pendingRevision(): number | null {
    return this.pending?.revision ?? null;
  }

  update(document: PatternDocumentV3): ProjectRevisionState {
    const previousRevision = this.dirtyTracker.revision;
    const next = this.dirtyTracker.update(document);

    if (next.revision !== previousRevision) {
      this.scheduleAutosave(document, next.revision);
    }

    return next;
  }

  markExplicitlySaved(document?: PatternDocumentV3): ProjectRevisionState {
    return this.dirtyTracker.markSaved(document);
  }

  /** Use after opening a different project. Pending autosave from the old project is discarded. */
  resetDocument(
    document: PatternDocumentV3,
    options: { initiallySaved?: boolean } = {},
  ): ProjectRevisionState {
    this.cancelTimer();
    this.pending = null;
    this.lastAutosaveErrorValue = null;
    return this.dirtyTracker.reset(document, options);
  }

  async flushAutosave(): Promise<number> {
    this.cancelTimer();
    await this.persistPending();
    return this.autosave.flush();
  }

  cancelPendingAutosave(): void {
    this.cancelTimer();
    this.pending = null;
  }

  private scheduleAutosave(
    document: PatternDocumentV3,
    revision: number,
  ): void {
    this.pending = {
      document: parsePatternDocumentV3(document),
      revision,
    };
    this.cancelTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.persistPending().catch(() => {
        // Error is retained and reported through onAutosaveError. The editor
        // stays usable and a later edit/flush can retry.
      });
    }, this.debounceMs);
  }

  private async persistPending(): Promise<void> {
    const next = this.pending;
    if (!next) return;
    this.pending = null;

    try {
      await this.autosave.save(next.document, next.revision);
      this.lastAutosaveErrorValue = null;
    } catch (error) {
      this.lastAutosaveErrorValue = error;
      if (this.pending === null || this.pending.revision < next.revision) {
        this.pending = next;
      }
      this.onAutosaveError?.(error);
      throw error;
    }
  }

  private cancelTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
