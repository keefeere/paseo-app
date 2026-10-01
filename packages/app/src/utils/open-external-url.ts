import { parseExternalUrl } from "@getpaseo/protocol/external-url";
import * as Linking from "expo-linking";
import { getDesktopHost } from "@/desktop/host";
import { isWeb } from "@/constants/platform";


export async function openExternalUrl(url: string): Promise<void> {
  // Support HTTP(S) as well as desktop/mobile deep link handlers (obsidian, slack, tg, etc.)
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return;
  }
  const allowed = new Set([
    "http:", "https:", "mailto:", "tel:", "sms:", "ssh:", "smb:", "vnc:", "rdp:",
    "vscode:", "vscode-insiders:", "cursor:", "zed:", "jetbrains:",
    "obsidian:", "logseq:", "notion:", "slack:", "tg:", "discord:"
  ]);
  if (!allowed.has(parsedUrl.protocol)) return;
  if (isWeb) {
    const opener = getDesktopHost()?.opener?.openUrl;
    if (typeof opener === "function") {
      await opener(url);
      return;
    }

    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }

  await Linking.openURL(url);
}

/** User-selected handoff to an OS handler. Unlike web navigation, refusal is visible to the caller. */
export async function openSystemUrl(input: string): Promise<void> {
  const url = parseExternalUrl(input);
  if (!url) throw new Error("This URL scheme cannot open externally.");
  const opener = getDesktopHost()?.opener?.openUrl;
  if (opener) {
    await opener(url.href);
    return;
  }
  if (isWeb) {
    window.location.assign(url.href);
    return;
  }
  await Linking.openURL(url.href);
}
