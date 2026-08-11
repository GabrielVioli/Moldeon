import type { ProjectAutosaveStoragePort } from "./projectAutosaveRepository";

const AUTOSAVE_FILENAME = "moldeon-autosave.json";
const AUTOSAVE_STORAGE_KEY = "moldeon-autosave";

type StorageManagerWithDirectory = StorageManager & {
  getDirectory(): Promise<FileSystemDirectoryHandle>;
};

export class ProjectStorageUnavailableError extends Error {
  readonly causeValue: unknown;

  constructor(message: string, causeValue?: unknown) {
    super(message);
    this.name = "ProjectStorageUnavailableError";
    this.causeValue = causeValue;
  }
}

/** Browser implementation of the storage port used by canonical autosave. */
export class BrowserProjectAutosaveStorage
  implements ProjectAutosaveStoragePort
{
  async read(): Promise<string | null> {
    const opfs = await tryGetOpfsRoot();
    if (opfs) {
      try {
        const handle = await opfs.getFileHandle(AUTOSAVE_FILENAME);
        return await (await handle.getFile()).text();
      } catch (error) {
        if (!isMissingFile(error)) {
          throw new ProjectStorageUnavailableError(
            "Não foi possível ler o autosave no armazenamento do navegador.",
            error,
          );
        }
      }
    }

    if (typeof localStorage !== "undefined") {
      try {
        return localStorage.getItem(AUTOSAVE_STORAGE_KEY);
      } catch (error) {
        throw new ProjectStorageUnavailableError(
          "Não foi possível ler o fallback local do autosave.",
          error,
        );
      }
    }

    return null;
  }

  async write(serialized: string): Promise<void> {
    const opfs = await tryGetOpfsRoot();
    if (opfs) {
      try {
        const handle = await opfs.getFileHandle(AUTOSAVE_FILENAME, {
          create: true,
        });
        const writable = await handle.createWritable();
        try {
          await writable.write(serialized);
        } finally {
          await writable.close();
        }
        return;
      } catch (error) {
        // OPFS can be unavailable because of browser/privacy/quota policy. The
        // localStorage fallback below keeps editing independent from that API.
        if (typeof localStorage === "undefined") {
          throw new ProjectStorageUnavailableError(
            "Não foi possível gravar o autosave no navegador.",
            error,
          );
        }
      }
    }

    if (typeof localStorage !== "undefined") {
      try {
        localStorage.setItem(AUTOSAVE_STORAGE_KEY, serialized);
        return;
      } catch (error) {
        throw new ProjectStorageUnavailableError(
          "Não foi possível gravar o autosave local. Verifique a quota do navegador.",
          error,
        );
      }
    }

    throw new ProjectStorageUnavailableError(
      "Este ambiente não oferece armazenamento local para autosave.",
    );
  }

  async clear(): Promise<void> {
    const opfs = await tryGetOpfsRoot();
    if (opfs) {
      try {
        await opfs.removeEntry(AUTOSAVE_FILENAME);
      } catch (error) {
        if (!isMissingFile(error)) {
          throw new ProjectStorageUnavailableError(
            "Não foi possível remover o autosave do navegador.",
            error,
          );
        }
      }
    }

    if (typeof localStorage !== "undefined") {
      try {
        localStorage.removeItem(AUTOSAVE_STORAGE_KEY);
      } catch (error) {
        throw new ProjectStorageUnavailableError(
          "Não foi possível remover o fallback local do autosave.",
          error,
        );
      }
    }
  }
}

async function tryGetOpfsRoot(): Promise<FileSystemDirectoryHandle | null> {
  if (typeof navigator === "undefined" || !navigator.storage) return null;
  const storage = navigator.storage as StorageManagerWithDirectory;
  if (typeof storage.getDirectory !== "function") return null;

  try {
    return await storage.getDirectory();
  } catch {
    return null;
  }
}

function isMissingFile(error: unknown): boolean {
  return error instanceof DOMException && error.name === "NotFoundError";
}
