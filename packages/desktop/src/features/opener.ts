interface ExternalUrlOwner {
  open(url: string): Promise<void>;
}

const EXTERNAL_PROTOCOLS = new Set([
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
  "obsidian:",
  "logseq:",
  "notion:",
  "slack:",
  "tg:",
  "discord:",
]);

const asExternalUrl = (input: unknown): URL | undefined => {
  if (typeof input !== "string" || !URL.canParse(input)) return undefined;
  const candidate = new URL(input);
  return EXTERNAL_PROTOCOLS.has(candidate.protocol) ? candidate : undefined;
};

export function createExternalUrlOpener(owner: ExternalUrlOwner) {
  return async (candidate: unknown): Promise<void> => {
    const url = asExternalUrl(candidate);
    if (url === undefined) {
      throw new Error("This URL scheme cannot open externally.");
    }
    return owner.open(url.href);
  };
}
