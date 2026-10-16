import { describe, expect, it } from "vitest";
import { parseExternalUrl } from "./external-url";

describe("parseExternalUrl", () => {
  it.each([
    "obsidian://open?vault=Obsidian-DevOps&file=%D0%98%D0%BD%D1%84%D0%B0%2FAnsible%2FAnsible%20Best%20practices",
    "logseq://graph/notes?page=Inbox",
    "smb://server/share",
    "ssh://user@example.com:2222/home/user",
    "https://paseo.sh",
  ])("accepts %s", (input) => {
    expect(parseExternalUrl(input)?.href).toBe(new URL(input).href);
  });

  it("keeps the encoded query of an app deep link intact", () => {
    const url = parseExternalUrl("obsidian://open?vault=My%20Vault&file=a%2Fb");
    expect(url?.protocol).toBe("obsidian:");
    expect(url?.searchParams.get("vault")).toBe("My Vault");
    expect(url?.searchParams.get("file")).toBe("a/b");
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,<b>hi</b>",
    "chrome://settings",
    "file:///etc/passwd",
    "foo://bar/baz",
    "obsidian://open?vault=x\nfile=y",
    "not a url",
    "",
  ])("rejects %s", (input) => {
    expect(parseExternalUrl(input)).toBeNull();
  });

  it("rejects non-string input", () => {
    expect(parseExternalUrl(null)).toBeNull();
    expect(parseExternalUrl(42)).toBeNull();
  });
});
