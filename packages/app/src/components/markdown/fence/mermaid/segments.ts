import { fromMarkdown } from "mdast-util-from-markdown";
import type { Code, Definition, RootContent } from "mdast";
import { getMarkdownFenceLanguage } from "@/plugins/code-block-actions";

type Segment =
  | {
      kind: "markdown" | "mermaid";
      id: string;
      source: string;
    }
  | {
      kind: "code-actions";
      id: string;
      source: string;
      info: string | null | undefined;
      localIndex: number;
    };

/** Native enriched-markdown has no fenced-block override. Only diagrams leave its engine. */
export function splitMermaidFences(
  markdown: string,
  actionableLanguages?: ReadonlySet<string>,
): Segment[] {
  const hasActionable = Boolean(actionableLanguages && actionableLanguages.size > 0);
  if (!/mermaid/i.test(markdown) && (!hasActionable || !/(?:`{3,}|~{3,})/.test(markdown))) {
    return [{ kind: "markdown", id: "0", source: markdown }];
  }
  const segments: Segment[] = [];
  const definitions = new Map<string, Definition>();
  let cursor = 0;
  let fenceIndex = 0;
  function pushCodeActions(node: Code, localIndex: number): void {
    segments.push({
      kind: "code-actions",
      id: String(segments.length),
      source: node.value,
      info: node.lang,
      localIndex,
    });
  }
  function visitCode(node: Code, topLevel: boolean): void {
    if (!node.position) return;
    const start = node.position.start.offset!;
    const end = node.position.end.offset!;
    const isFence = /^(`{3,}|~{3,})/.test(markdown.slice(start, start + 4));
    const currentFenceIndex = isFence ? fenceIndex++ : -1;
    const lang = getMarkdownFenceLanguage(node.lang);
    if (lang === "mermaid") {
      if (start > cursor)
        segments.push({
          kind: "markdown",
          id: String(segments.length),
          source: markdown.slice(cursor, start),
        });
      segments.push({ kind: "mermaid", id: String(segments.length), source: node.value });
      if (isFence && actionableLanguages?.has("mermaid")) pushCodeActions(node, currentFenceIndex);
      cursor = end;
    } else if (topLevel && isFence && lang && actionableLanguages?.has(lang)) {
      segments.push({
        kind: "markdown",
        id: String(segments.length),
        source: markdown.slice(cursor, end),
      });
      pushCodeActions(node, currentFenceIndex);
      cursor = end;
    }
  }
  function visit(node: RootContent, topLevel = false): void {
    if (node.type === "definition" && !definitions.has(node.identifier))
      definitions.set(node.identifier, node);
    if (node.type === "code") visitCode(node, topLevel);
    else if ("children" in node) node.children.forEach((child) => visit(child, false));
  }
  const tree = fromMarkdown(markdown);
  tree.children.forEach((child) => visit(child, true));
  if (cursor < markdown.length || segments.length === 0)
    segments.push({
      kind: "markdown",
      id: String(segments.length),
      source: markdown.slice(cursor),
    });
  // Prepend the document's first definitions after splitting, so fragment-local
  // duplicates cannot override them. Original source slices and fence offsets stay intact.
  if (segments.some((segment) => segment.kind !== "markdown") && segments.length > 1) {
    const referenceSource = [...definitions.values()]
      .map((node) => {
        const label = node.identifier.replace(/[\\[\]]/g, "\\$&");
        const url = node.url.replace(/[\\<>]/g, "\\$&");
        const title = node.title ? ` "${node.title.replace(/[\\"]/g, "\\$&")}"` : "";
        return `[${label}]: <${url}>${title}`;
      })
      .join("\n");
    if (referenceSource)
      for (const segment of segments) {
        if (segment.kind === "markdown") segment.source = `${referenceSource}\n\n${segment.source}`;
      }
  }
  return segments;
}
