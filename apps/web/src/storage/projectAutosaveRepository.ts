import { parsePatternDocumentV3 } from "../domain/patternDocumentV3";
import type { PatternDocumentV3 } from "../domain/patternDocumentV3.types";
import {
  parseCanonicalAutosave,
  serializeCanonicalAutosave,
  type CanonicalAutosaveRecord,
} from "./canonicalAutosave";
import {
  LatestRevisionWriteQueue,
  type RevisionedPayload,
} from "./projectPersistenceCore";

/**
 * Platform boundary. Browser OPFS/localStorage and a future desktop filesystem
 * can implement the same tiny contract without leaking storage APIs into React.
 */
export interface ProjectAutosaveStoragePort {
  read(): Promise<string | null>;
  write(serialized: string): Promise<void>;
  clear(): Promise<void>;
}

export class ProjectAutosaveRepository {
  private readonly writes: LatestRevisionWriteQueue<PatternDocumentV3>;

  constructor(
    private readonly storage: ProjectAutosaveStoragePort,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    this.writes = new LatestRevisionWriteQueue(
      async (entry: RevisionedPayload<PatternDocumentV3>) => {
        const serialized = serializeCanonicalAutosave(entry.payload, {
          revision: entry.revision,
          savedAt: this.now(),
        });
        await this.storage.write(serialized);
      },
    );
  }

  get lastPersistedRevision(): number {
    return this.writes.lastPersistedRevision;
  }

  async load(): Promise<CanonicalAutosaveRecord | null> {
    const serialized = await this.storage.read();
    if (serialized === null) return null;

    const record = parseCanonicalAutosave(serialized);
    this.writes.reset(record.revision);
    return record;
  }

  save(document: PatternDocumentV3, revision: number): Promise<number> {
    // Clone/validate at enqueue time so a mutable editor object cannot change
    // underneath an already scheduled write.
    const canonical = parsePatternDocumentV3(document);
    return this.writes.enqueue({ revision, payload: canonical });
  }

  flush(): Promise<number> {
    return this.writes.flush();
  }

  async clear(): Promise<void> {
    await this.flush();
    await this.storage.clear();
    this.writes.reset(-1);
  }
}
