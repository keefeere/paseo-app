import { stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { parseExternalUrl } from "@getpaseo/protocol/external-url";
interface ExternalUrlOwner {
  open(url: string): Promise<void>;
}

export function createExternalUrlOpener(owner: ExternalUrlOwner) {
  return async (candidate: unknown): Promise<void> => {
    const url = parseExternalUrl(candidate);
    if (url === null) {
      throw new Error("This URL scheme cannot open externally.");
    }
    return owner.open(url.href);
  };
}

async function requireExistingLocalPath(input: unknown): Promise<string> {
  if (typeof input !== "string" || !isAbsolute(input) || input.includes("\0")) {
    throw new Error("An absolute local path is required.");
  }
  const entry = await stat(input);
  if (!entry.isFile() && !entry.isDirectory()) {
    throw new Error("Only regular files and directories can open in an application.");
  }
  return input;
}

export function createLocalPathOpener(owner: { open(path: string): Promise<string> }) {
  return async (input: unknown): Promise<void> => {
    const error = await owner.open(await requireExistingLocalPath(input));
    if (error) throw new Error(error);
  };
}

export function createLocalPathRevealer(owner: { reveal(path: string): void }) {
  return async (input: unknown): Promise<void> => {
    owner.reveal(await requireExistingLocalPath(input));
  };
}
