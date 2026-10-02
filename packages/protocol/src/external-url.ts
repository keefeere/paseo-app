/** Schemes dispatched to installed applications; file paths use the daemon's resource flow. */
const SYSTEM_URL_PROTOCOLS = new Set([
  "http:",
  "https:",
  "mailto:",
  "tel:",
  "sms:",
  "ftp:",
  "ftps:",
  "sftp:",
  "ssh:",
  "scp:",
  "telnet:",
  "smb:",
  "afp:",
  "nfs:",
  "webdav:",
  "webdavs:",
  "dav:",
  "davs:",
  "vnc:",
  "rdp:",
  "spice:",
  "git:",
  "svn:",
  "magnet:",
  "irc:",
  "ircs:",
  "xmpp:",
  "matrix:",
  "webcal:",
  "vscode:",
  "vscode-insiders:",
  "cursor:",
  "zed:",
  "jetbrains:",
]);

export function parseExternalUrl(input: unknown): URL | null {
  if (typeof input !== "string") return null;
  for (const character of input) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) return null;
  }
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  return SYSTEM_URL_PROTOCOLS.has(url.protocol) ? url : null;
}
