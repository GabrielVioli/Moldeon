import { z } from "zod";
import { PatternSnapshot, PatternSnapshotSchema } from "../domain/pattern";

type StorageManagerWithDirectory = StorageManager & {
  getDirectory(): Promise<FileSystemDirectoryHandle>;
};

const AutosaveSchema = z.object({
  version: z.literal(1),
  snapshot: PatternSnapshotSchema,
  savedAt: z.string(),
});

export interface LoadedAutosave {
  snapshot: PatternSnapshot;
  method: "opfs" | "localStorage";
}

export async function loadAutosave(): Promise<LoadedAutosave | null> {
  const storage = navigator.storage as StorageManagerWithDirectory | undefined;

  if (storage && typeof storage.getDirectory === "function") {
    try {
      const root = await storage.getDirectory();
      const handle = await root.getFileHandle("moreoris-autosave.json");
      const file = await handle.getFile();
      const snapshot = parseAutosave(await file.text());
      if (snapshot) return { snapshot, method: "opfs" };
    } catch (error) {
      if (!isMissingFile(error)) {
        console.info("Não foi possível restaurar o autosave via OPFS.", error);
      }
    }
  }

  try {
    const serialized = localStorage.getItem("moreoris-autosave");
    const snapshot = serialized ? parseAutosave(serialized) : null;
    return snapshot ? { snapshot, method: "localStorage" } : null;
  } catch (error) {
    console.info("Não foi possível restaurar o autosave via localStorage.", error);
    return null;
  }
}

export async function saveAutosave(snapshot: PatternSnapshot): Promise<"opfs" | "localStorage"> {
  const serialized = JSON.stringify({ version: 1, snapshot, savedAt: new Date().toISOString() });
  const storage = navigator.storage as StorageManagerWithDirectory | undefined;

  if (storage && typeof storage.getDirectory === "function") {
    try {
      const root = await storage.getDirectory();
      const handle = await root.getFileHandle("moreoris-autosave.json", { create: true });
      const writable = await handle.createWritable();
      await writable.write(serialized);
      await writable.close();
      return "opfs";
    } catch (error) {
      console.info("OPFS indisponível; usando localStorage.", error);
    }
  }

  localStorage.setItem("moreoris-autosave", serialized);
  return "localStorage";
}

export function parseAutosave(serialized: string): PatternSnapshot | null {
  try {
    const result = AutosaveSchema.safeParse(JSON.parse(serialized));
    return result.success ? result.data.snapshot : null;
  } catch {
    return null;
  }
}

function isMissingFile(error: unknown): boolean {
  return error instanceof DOMException && error.name === "NotFoundError";
}
