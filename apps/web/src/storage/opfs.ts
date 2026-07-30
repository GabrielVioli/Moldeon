import { PatternSnapshot } from "../domain/pattern";

type StorageManagerWithDirectory = StorageManager & {
  getDirectory(): Promise<FileSystemDirectoryHandle>;
};

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
