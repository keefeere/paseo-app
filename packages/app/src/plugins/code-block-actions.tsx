import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import { View } from "react-native";
import { fromMarkdown } from "mdast-util-from-markdown";
import type { RootContent } from "mdast";
import type {
  PluginCodeBlockActionsProps,
  PluginCodeBlockActionsContribution,
} from "@getpaseo/plugin/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { PluginClientStateProvider } from "@getpaseo/plugin/client/host";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { markdownCopyDataSet } from "@/assistant-selection-copy/markup";
import { normalizeMarkdownHtml } from "@/components/markdown/html";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useHosts } from "@/runtime/host-runtime";
import type { Theme } from "@/styles/theme";
import { useInstalledPlugins } from "./registry";
import type { InstalledPlugin } from "./types";
import { PluginInstallationProvider } from "./installation-provider";
import { createPluginClientStateSource } from "./client-state/source";
import { SurfaceErrorBoundary } from "./surface-error-boundary";
import { usePluginHostNavigation } from "./host-navigation";
import { resolvePluginPlatform } from "./platform";
import { toPluginTheme } from "./theme";

export function getMarkdownFenceLanguage(info: string | null | undefined): string | null {
  return info?.trim().split(/\s+/)[0]?.toLowerCase() || null;
}

function normalizeFenceCode(code: string): string {
  return code.endsWith("\n") ? code.slice(0, -1) : code;
}

export interface IndexedFence {
  index: number;
  language: string | null;
  code: string;
  truncatedByCap: boolean;
}

export function indexMarkdownFencesInSource(markdown: string, capped = false): IndexedFence[] {
  const normalized = normalizeMarkdownHtml(markdown);
  const fences: IndexedFence[] = [];
  const tree = fromMarkdown(normalized);
  function visit(node: RootContent): void {
    if (node.type === "code" && node.position?.start.offset !== undefined) {
      const start = node.position.start.offset;
      const end = node.position.end.offset ?? normalized.length;
      if (/^(`{3,}|~{3,})/.test(normalized.slice(start, start + 4))) {
        fences.push({
          index: fences.length,
          language: getMarkdownFenceLanguage(node.lang),
          code: normalizeFenceCode(node.value),
          truncatedByCap: capped && end >= normalized.length,
        });
      }
    } else if ("children" in node) {
      node.children.forEach(visit);
    }
  }
  tree.children.forEach(visit);
  return fences;
}

interface BlockContext {
  serverId: string;
  agentId: string;
  messageId: string;
  fenceOffset: number;
  phase: "streaming" | "complete";
  fences: readonly IndexedFence[] | null;
  actionableLanguages: ReadonlySet<string>;
  claimFence(instanceId: symbol, language: string, code: string): IndexedFence | null;
  releaseFence(instanceId: symbol): void;
}

const EMPTY_LANGUAGES: ReadonlySet<string> = new Set();
const CodeBlockActionsContext = createContext<BlockContext | null>(null);

export function useCodeBlockActionLanguages(): ReadonlySet<string> {
  return useContext(CodeBlockActionsContext)?.actionableLanguages ?? EMPTY_LANGUAGES;
}

export function CodeBlockActionsProvider({
  serverId,
  agentId,
  messageId,
  markdown,
  capped = false,
  fenceOffset = 0,
  phase,
  children,
}: {
  serverId?: string;
  agentId?: string;
  messageId?: string;
  markdown?: string;
  capped?: boolean;
  fenceOffset?: number;
  phase: BlockContext["phase"];
  children: ReactNode;
}) {
  const plugins = useInstalledPlugins();
  const actionableLanguages = useMemo<ReadonlySet<string>>(() => {
    if (!serverId) return EMPTY_LANGUAGES;
    const set = new Set<string>();
    for (const plugin of plugins) {
      if (plugin.serverId !== serverId) continue;
      for (const action of plugin.codeBlockActions) {
        for (const language of action.languages) set.add(language);
      }
    }
    return set.size > 0 ? set : EMPTY_LANGUAGES;
  }, [plugins, serverId]);

  const fences = useMemo(
    () =>
      markdown !== undefined && actionableLanguages.size > 0
        ? indexMarkdownFencesInSource(markdown, capped)
        : null,
    [actionableLanguages.size, capped, markdown],
  );

  const claimsRef = useRef(new Map<symbol, { key: string; occurrence: number }>());
  const fencesRef = useRef(fences);
  fencesRef.current = fences;

  const value = useMemo<BlockContext | null>(() => {
    if (!serverId || !agentId || !messageId) return null;
    return {
      serverId,
      agentId,
      messageId,
      fenceOffset,
      phase,
      fences,
      actionableLanguages,
      claimFence(instanceId, language, code) {
        const currentFences = fencesRef.current;
        if (!currentFences) return null;
        const normalizedCode = normalizeFenceCode(code);
        const matching = currentFences.filter(
          (fence) => fence.language === language && fence.code === normalizedCode,
        );
        if (matching.length === 0) return null;
        if (matching.length === 1) return matching[0];
        const key = `${language}\0${normalizedCode}`;
        const existing = claimsRef.current.get(instanceId);
        if (existing && existing.key === key && existing.occurrence < matching.length) {
          return matching[existing.occurrence];
        }
        const used = new Set<number>();
        for (const [otherId, claim] of claimsRef.current) {
          if (otherId !== instanceId && claim.key === key) used.add(claim.occurrence);
        }
        let occurrence = 0;
        while (used.has(occurrence) && occurrence < matching.length - 1) {
          occurrence += 1;
        }
        claimsRef.current.set(instanceId, { key, occurrence });
        return matching[occurrence];
      },
      releaseFence(instanceId) {
        claimsRef.current.delete(instanceId);
      },
    };
  }, [actionableLanguages, agentId, fenceOffset, fences, messageId, phase, serverId]);

  return (
    <CodeBlockActionsContext.Provider value={value}>{children}</CodeBlockActionsContext.Provider>
  );
}

function ActionSurface({
  plugin,
  contribution,
  block,
  theme,
}: {
  plugin: InstalledPlugin;
  contribution: PluginCodeBlockActionsContribution;
  block: Pick<
    PluginCodeBlockActionsProps,
    "agentId" | "messageId" | "blockIndex" | "code" | "language" | "phase"
  >;
  theme: PluginTheme;
}) {
  const compact = useIsCompactFormFactor();
  const hosts = useHosts();
  const navigation = usePluginHostNavigation(plugin.serverId);
  const stateSource = useMemo(
    () => createPluginClientStateSource(plugin.serverId),
    [plugin.serverId],
  );
  const hostLabel =
    hosts.find((host) => host.serverId === plugin.serverId)?.label ?? plugin.serverId;
  const host = useMemo(
    () => ({ id: plugin.serverId, label: hostLabel }),
    [plugin.serverId, hostLabel],
  );
  const layout = useMemo(() => ({ compact, platform: resolvePluginPlatform() }), [compact]);
  const Component = contribution.Component;
  return (
    <SurfaceErrorBoundary installation={plugin} Surface={Component}>
      <PluginInstallationProvider plugin={plugin}>
        <PluginClientStateProvider source={stateSource}>
          <Component {...block} host={host} theme={theme} layout={layout} navigation={navigation} />
        </PluginClientStateProvider>
      </PluginInstallationProvider>
    </SurfaceErrorBoundary>
  );
}

const ThemedActionSurface = withUnistyles(ActionSurface);
const pluginThemeMapping = (theme: Theme) => ({ theme: toPluginTheme(theme) });

export function PluginCodeBlockActions({
  code,
  info,
  localIndex,
  spaced = false,
}: {
  code: string;
  info: string | null | undefined;
  localIndex?: number;
  spaced?: boolean;
}) {
  const context = useContext(CodeBlockActionsContext);
  const plugins = useInstalledPlugins();
  const language = getMarkdownFenceLanguage(info);
  const instanceRef = useRef<symbol | null>(null);
  if (instanceRef.current === null) {
    instanceRef.current = Symbol("code-block-actions");
  }
  useEffect(() => {
    const id = instanceRef.current;
    return () => {
      if (id && context) context.releaseFence(id);
    };
  }, [context]);

  const block = useMemo(() => {
    if (!context || !language) return null;
    if (localIndex !== undefined) {
      if (!Number.isInteger(localIndex) || localIndex < 0) return null;
      const indexed = context.fences?.[localIndex];
      return {
        agentId: context.agentId,
        messageId: context.messageId,
        blockIndex: context.fenceOffset + localIndex,
        code,
        language,
        phase: indexed?.truncatedByCap ? ("streaming" as const) : context.phase,
      };
    }
    const claimed = context.claimFence(instanceRef.current!, language, code);
    if (!claimed) return null;
    return {
      agentId: context.agentId,
      messageId: context.messageId,
      blockIndex: context.fenceOffset + claimed.index,
      code,
      language,
      phase: claimed.truncatedByCap ? ("streaming" as const) : context.phase,
    };
  }, [context, language, localIndex, code]);

  if (!context || !block) return null;
  const surfaces = plugins
    .filter((plugin) => plugin.serverId === context.serverId)
    .flatMap((plugin) =>
      plugin.codeBlockActions
        .filter((action) => action.languages.includes(block.language))
        .map((contribution) => (
          <ThemedActionSurface
            key={`${plugin.id}/${contribution.id}`}
            plugin={plugin}
            contribution={contribution}
            block={block}
            uniProps={pluginThemeMapping}
          />
        )),
    );
  if (surfaces.length === 0) return null;
  if (!spaced) return surfaces;
  return (
    <View style={styles.spaced} dataSet={markdownCopyDataSet.ignore}>
      {surfaces}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  spaced: {
    marginTop: theme.spacing[2],
    gap: theme.spacing[2],
  },
}));
