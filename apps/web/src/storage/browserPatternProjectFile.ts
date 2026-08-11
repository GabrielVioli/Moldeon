import type { PatternDocumentV3 } from "../domain/patternDocumentV3.types";
import {
  MOLDEON_PROJECT_EXTENSION,
  MOLDEON_PROJECT_MIME_TYPE,
  createPatternProjectBlob,
  importPatternProject,
  type ImportedPatternProject,
} from "./patternProjectIO";

interface FilePickerType {
  description: string;
  accept: Record<string, string[]>;
}

interface WindowWithFileSystemAccess extends Window {
  showOpenFilePicker?: (options?: {
    multiple?: boolean;
    types?: FilePickerType[];
  }) => Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?: (options?: {
    suggestedName?: string;
    types?: FilePickerType[];
  }) => Promise<FileSystemFileHandle>;
}

export interface OpenedPatternProject {
  fileName: string;
  imported: ImportedPatternProject;
}

export interface SavedPatternProject {
  fileName: string;
  method: "file-system-access" | "download";
}

const MOLDEON_PICKER_TYPES: FilePickerType[] = [
  {
    description: "Projeto Moldeon",
    accept: {
      [MOLDEON_PROJECT_MIME_TYPE]: [MOLDEON_PROJECT_EXTENSION],
      "application/json": [MOLDEON_PROJECT_EXTENSION],
    },
  },
];

/**
 * Browser-only adapter. React only needs to call open/save; serialization stays
 * in patternProjectIO and can be reused unchanged by a future desktop adapter.
 */
export class BrowserPatternProjectFileSession {
  private currentHandle: FileSystemFileHandle | null = null;

  get canOverwriteCurrentFile(): boolean {
    return this.currentHandle !== null;
  }

  forgetCurrentFile(): void {
    this.currentHandle = null;
  }

  async openWithSystemPicker(): Promise<OpenedPatternProject | null> {
    const pickerWindow = getPickerWindow();
    if (!pickerWindow?.showOpenFilePicker) return null;

    try {
      const [handle] = await pickerWindow.showOpenFilePicker({
        multiple: false,
        types: MOLDEON_PICKER_TYPES,
      });
      if (!handle) return null;
      const file = await handle.getFile();
      const imported = await readPatternProjectFile(file);
      this.currentHandle = handle;
      return imported;
    } catch (error) {
      if (isAbortError(error)) return null;
      throw error;
    }
  }

  /** Used by the upload/input fallback on browsers without File System Access. */
  async openFile(file: File): Promise<OpenedPatternProject> {
    const imported = await readPatternProjectFile(file);
    this.currentHandle = null;
    return imported;
  }

  async save(
    projectDocument: PatternDocumentV3,
    projectName: string,
  ): Promise<SavedPatternProject> {
    if (this.currentHandle) {
      await writePatternProjectHandle(this.currentHandle, projectDocument);
      return {
        fileName: this.currentHandle.name,
        method: "file-system-access",
      };
    }
    return this.saveAs(projectDocument, projectName);
  }

  async saveAs(
    projectDocument: PatternDocumentV3,
    projectName: string,
  ): Promise<SavedPatternProject> {
    const fileName = normalizeMoldeonFileName(projectName);
    const pickerWindow = getPickerWindow();

    if (pickerWindow?.showSaveFilePicker) {
      const handle = await pickerWindow.showSaveFilePicker({
        suggestedName: fileName,
        types: MOLDEON_PICKER_TYPES,
      });
      await writePatternProjectHandle(handle, projectDocument);
      this.currentHandle = handle;
      return {
        fileName: handle.name,
        method: "file-system-access",
      };
    }

    downloadPatternProject(projectDocument, fileName);
    this.currentHandle = null;
    return { fileName, method: "download" };
  }
}

export async function readPatternProjectFile(
  file: File,
): Promise<OpenedPatternProject> {
  const serialized = await file.text();
  return {
    fileName: file.name,
    imported: importPatternProject(serialized),
  };
}

export function normalizeMoldeonFileName(projectName: string): string {
  const trimmed = projectName.trim() || "projeto";
  const withoutExtension = trimmed.toLowerCase().endsWith(MOLDEON_PROJECT_EXTENSION)
    ? trimmed.slice(0, -MOLDEON_PROJECT_EXTENSION.length)
    : trimmed;
  const safeBase = withoutExtension
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim() || "projeto";
  return `${safeBase}${MOLDEON_PROJECT_EXTENSION}`;
}

async function writePatternProjectHandle(
  handle: FileSystemFileHandle,
  projectDocument: PatternDocumentV3,
): Promise<void> {
  const writable = await handle.createWritable();
  try {
    await writable.write(createPatternProjectBlob(projectDocument));
  } finally {
    await writable.close();
  }
}

function downloadPatternProject(
  projectDocument: PatternDocumentV3,
  fileName: string,
): void {
  if (typeof window === "undefined") {
    throw new Error("Download de projeto só está disponível no navegador.");
  }

  const blobUrl = URL.createObjectURL(createPatternProjectBlob(projectDocument));
  const anchor = window.document.createElement("a");
  anchor.href = blobUrl;
  anchor.download = fileName;
  anchor.style.display = "none";
  window.document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 0);
}

function getPickerWindow(): WindowWithFileSystemAccess | null {
  return typeof window === "undefined"
    ? null
    : (window as WindowWithFileSystemAccess);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
