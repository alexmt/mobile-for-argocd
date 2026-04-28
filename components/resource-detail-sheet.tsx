import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import * as jsYaml from "js-yaml";
import { diffLines as computeDiff } from "diff";
import type { ComponentProps } from "react";

import { colors } from "../lib/theme";
import { getHealth, getSync } from "../lib/status";
import { useArgoClient } from "../lib/client";
import { queryKeys } from "../lib/query-keys";
import type { ManagedResource } from "../lib/api";

const { height: SCREEN_H } = Dimensions.get("window");
const MONO = Platform.OS === "ios" ? "Menlo" : "monospace";
const CONTEXT_LINES = 3;
const ADD_COLOR = "#4ec46b";
const REMOVE_COLOR = "#f2766c";
const ADD_BG = "rgba(78,196,107,0.10)";
const REMOVE_BG = "rgba(242,118,108,0.10)";

type IoniconName = ComponentProps<typeof Ionicons>["name"];
type TabId = "summary" | "live" | "desired" | "diff";

// ── Public types ───────────────────────────────────────────────

export interface ResourceDetailRef {
  group?: string;
  version?: string;
  kind: string;
  namespace?: string;
  name: string;
  health?: { status: string; message?: string };
  syncStatus?: string;
  info?: { name: string; value: string }[];
  images?: string[];
  createdAt?: string;
}

export interface ResourceDetailSheetProps {
  visible: boolean;
  onClose: () => void;
  appName: string;
  appNamespace: string;
  resource: ResourceDetailRef | null;
}

// ── YAML tokenizer ─────────────────────────────────────────────

type TokType =
  | "key"
  | "string"
  | "number"
  | "boolean"
  | "null"
  | "comment"
  | "operator"
  | "plain";

interface Tok {
  type: TokType;
  text: string;
}

const TOK_COLOR: Record<TokType, string> = {
  key: "#7EC8E3",
  string: "#98C379",
  number: "#D19A66",
  boolean: "#C678DD",
  null: "#C678DD",
  comment: "#5C6370",
  operator: "rgba(245,246,250,0.42)",
  plain: "#ABB2BF",
};

function tokenizeValue(text: string): Tok[] {
  if (!text) return [];
  if (/^[|>][-+]?\s*$/.test(text) || /^[|>][-+]?\s*#/.test(text))
    return [{ type: "operator", text }];
  if (text.startsWith("&") || text.startsWith("*"))
    return [{ type: "operator", text }];

  if (text.startsWith('"')) {
    const m = text.match(/^("(?:[^"\\]|\\.)*")(.*)/s);
    if (m) return [{ type: "string", text: m[1] }, ...tokenizeValue(m[2])];
  }
  if (text.startsWith("'")) {
    const m = text.match(/^('(?:[^'\\]|\\.)*')(.*)/s);
    if (m) return [{ type: "string", text: m[1] }, ...tokenizeValue(m[2])];
  }

  const nullM = text.match(/^(null|~)(\s*)$/i);
  if (nullM)
    return [{ type: "null", text: nullM[1] }, { type: "plain", text: nullM[2] }];

  const boolM = text.match(/^(true|false|yes|no)(\s*)$/i);
  if (boolM)
    return [
      { type: "boolean", text: boolM[1] },
      { type: "plain", text: boolM[2] },
    ];

  const numM = text.match(/^(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(\s*)$/);
  if (numM)
    return [
      { type: "number", text: numM[1] },
      { type: "plain", text: numM[2] },
    ];

  const ci = text.indexOf(" #");
  if (ci > 0)
    return [
      ...tokenizeValue(text.slice(0, ci)),
      { type: "comment", text: text.slice(ci) },
    ];

  return [{ type: "plain", text }];
}

function tokenizeLine(line: string): Tok[] {
  if (!line.trim()) return [{ type: "plain", text: line || " " }];
  const out: Tok[] = [];
  let rest = line;

  const wsM = rest.match(/^(\s+)/);
  if (wsM) {
    out.push({ type: "plain", text: wsM[1] });
    rest = rest.slice(wsM[1].length);
  }

  if (rest.startsWith("---") || rest.startsWith("..."))
    return [...out, { type: "operator", text: rest }];
  if (rest.startsWith("#"))
    return [...out, { type: "comment", text: rest }];

  // list item marker
  const listM = rest.match(/^(-\s+)/);
  if (listM) {
    out.push({ type: "operator", text: listM[1] });
    rest = rest.slice(listM[1].length);
  }

  // key: value
  const keyM = rest.match(/^([a-zA-Z_$][a-zA-Z0-9_$.\-/]*)(\s*:\s*)/);
  if (keyM) {
    out.push({ type: "key", text: keyM[1] });
    out.push({ type: "operator", text: keyM[2] });
    rest = rest.slice(keyM[0].length);
  }

  out.push(...tokenizeValue(rest));
  return out;
}

// ── YAML render ────────────────────────────────────────────────

function HighlightedYaml({ yaml }: { yaml: string }) {
  const lines = useMemo(() => yaml.split("\n"), [yaml]);
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.yamlScroll}
    >
      <View style={styles.yamlLines}>
        {lines.map((line, i) => (
          <Text key={i} numberOfLines={1} style={styles.yamlLine}>
            {tokenizeLine(line).map((tok, j) => (
              <Text key={j} style={{ color: TOK_COLOR[tok.type] }}>
                {tok.text}
              </Text>
            ))}
          </Text>
        ))}
      </View>
    </ScrollView>
  );
}

// ── Diff helpers ───────────────────────────────────────────────

type DiffLineType = "add" | "remove" | "context" | "collapse";
interface DiffLine {
  type: DiffLineType;
  content: string;
  lineNoOld: number | null;
  lineNoNew: number | null;
  collapseCount?: number;
}

function buildDiffLines(oldY: string, newY: string): DiffLine[] {
  const changes = computeDiff(oldY, newY);
  const flat: { type: "add" | "remove" | "context"; content: string }[] = [];
  for (const ch of changes) {
    const type = ch.added ? "add" : ch.removed ? "remove" : "context";
    const lines = ch.value.split("\n");
    if (lines.at(-1) === "") lines.pop();
    for (const l of lines) flat.push({ type, content: l });
  }
  let lo = 1,
    ln = 1;
  const numbered: DiffLine[] = flat.map((l) => {
    const d: DiffLine = {
      type: l.type,
      content: l.content,
      lineNoOld: l.type !== "add" ? lo : null,
      lineNoNew: l.type !== "remove" ? ln : null,
    };
    if (l.type !== "add") lo++;
    if (l.type !== "remove") ln++;
    return d;
  });

  const result: DiffLine[] = [];
  let i = 0;
  while (i < numbered.length) {
    if (numbered[i].type !== "context") {
      result.push(numbered[i++]);
      continue;
    }
    let j = i;
    while (j < numbered.length && numbered[j].type === "context") j++;
    const run = numbered.slice(i, j);
    const isFirst = result.length === 0;
    const isLast = j === numbered.length;
    if (isFirst && isLast) {
      // skip all
    } else if (isFirst) {
      if (run.length > CONTEXT_LINES)
        result.push({ type: "collapse", content: "", lineNoOld: null, lineNoNew: null, collapseCount: run.length - CONTEXT_LINES });
      result.push(...run.slice(-CONTEXT_LINES));
    } else if (isLast) {
      result.push(...run.slice(0, CONTEXT_LINES));
      if (run.length > CONTEXT_LINES)
        result.push({ type: "collapse", content: "", lineNoOld: null, lineNoNew: null, collapseCount: run.length - CONTEXT_LINES });
    } else if (run.length > CONTEXT_LINES * 2) {
      result.push(...run.slice(0, CONTEXT_LINES));
      result.push({ type: "collapse", content: "", lineNoOld: null, lineNoNew: null, collapseCount: run.length - CONTEXT_LINES * 2 });
      result.push(...run.slice(-CONTEXT_LINES));
    } else {
      result.push(...run);
    }
    i = j;
  }
  return result;
}

function DiffLineRow({ line }: { line: DiffLine }) {
  if (line.type === "collapse")
    return (
      <View style={styles.collapseRow}>
        <Text style={styles.collapseText}>
          {"· · · "}
          {line.collapseCount} unchanged{" "}
          {line.collapseCount === 1 ? "line" : "lines"}
          {" · · ·"}
        </Text>
      </View>
    );
  const isAdd = line.type === "add";
  const isRemove = line.type === "remove";
  const bg = isAdd ? ADD_BG : isRemove ? REMOVE_BG : "transparent";
  const opColor = isAdd ? ADD_COLOR : isRemove ? REMOVE_COLOR : colors.faint;
  return (
    <View style={[styles.diffRow, { backgroundColor: bg }]}>
      <Text style={styles.lineNo}>{line.lineNoOld ?? ""}</Text>
      <Text style={styles.lineNo}>{line.lineNoNew ?? ""}</Text>
      <Text style={[styles.opCol, { color: opColor }]}>
        {isAdd ? "+" : isRemove ? "−" : " "}
      </Text>
      <Text style={styles.diffContent}>{line.content}</Text>
    </View>
  );
}

// ── Small helpers ──────────────────────────────────────────────

function kindIcon(kind: string): IoniconName {
  switch (kind.toLowerCase()) {
    case "pod": return "ellipse-outline";
    case "service": return "git-branch-outline";
    case "deployment": return "layers-outline";
    case "replicaset": return "copy-outline";
    case "statefulset": return "server-outline";
    case "daemonset": return "git-network-outline";
    case "job": return "time-outline";
    case "cronjob": return "calendar-outline";
    case "configmap": return "document-outline";
    case "secret": return "key-outline";
    case "ingress": return "globe-outline";
    case "serviceaccount": return "person-outline";
    case "persistentvolumeclaim": return "save-outline";
    default: return "cube-outline";
  }
}

function stateToYaml(raw: string | undefined | null): string {
  if (!raw) return "";
  try {
    return jsYaml.dump(JSON.parse(raw) as object, { indent: 2, lineWidth: -1, noRefs: true });
  } catch {
    return raw;
  }
}

function objectToYaml(obj: object | null | undefined): string {
  if (!obj) return "";
  try {
    return jsYaml.dump(obj, { indent: 2, lineWidth: -1, noRefs: true });
  } catch {
    return JSON.stringify(obj, null, 2);
  }
}

function removeManagedFields(obj: object): object {
  const copy = JSON.parse(JSON.stringify(obj)) as {
    metadata?: { managedFields?: unknown };
  };
  if (copy.metadata?.managedFields !== undefined) {
    delete copy.metadata.managedFields;
  }
  return copy;
}

function timeAgo(iso?: string): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "just now";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 30 ? `${d}d ago` : `${Math.floor(d / 30)}mo ago`;
}

// ── Sub-components ─────────────────────────────────────────────

function MetaRow({ label, value, mono, last }: { label: string; value: string; mono?: boolean; last?: boolean }) {
  return (
    <View style={[styles.metaRow, !last && styles.metaRowBorder]}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={[styles.metaValue, mono && styles.metaMono]} numberOfLines={2}>{value || "—"}</Text>
    </View>
  );
}

function SummaryContent({ resource }: { resource: ResourceDetailRef }) {
  const gv = [resource.group, resource.version].filter(Boolean).join("/");
  return (
    <View style={styles.summaryWrap}>
      <Text style={styles.sectionHeader}>METADATA</Text>
      <View style={styles.card}>
        <MetaRow label="Kind" value={resource.kind} />
        {!!gv && <MetaRow label="Group/Ver" value={gv} mono />}
        <MetaRow label="Namespace" value={resource.namespace ?? "—"} mono />
        <MetaRow label="Created" value={timeAgo(resource.createdAt)} last />
      </View>

      {resource.info && resource.info.length > 0 && (
        <>
          <Text style={styles.sectionHeader}>INFO</Text>
          <View style={styles.card}>
            {resource.info.map((f, i) => (
              <MetaRow key={f.name} label={f.name} value={f.value} last={i === resource.info!.length - 1} />
            ))}
          </View>
        </>
      )}

      {!!resource.health?.message && (
        <>
          <Text style={styles.sectionHeader}>HEALTH MESSAGE</Text>
          <View style={styles.card}>
            <View style={styles.metaRow}>
              <Text style={[styles.metaValue, styles.messageText]}>{resource.health.message}</Text>
            </View>
          </View>
        </>
      )}

      {resource.images && resource.images.length > 0 && (
        <>
          <Text style={styles.sectionHeader}>IMAGES</Text>
          <View style={styles.card}>
            {resource.images.map((img, i) => (
              <View key={img} style={[styles.metaRow, i < resource.images!.length - 1 && styles.metaRowBorder]}>
                <Text style={[styles.metaValue, styles.metaMono]} numberOfLines={2}>{img}</Text>
              </View>
            ))}
          </View>
        </>
      )}
    </View>
  );
}

function LiveContent({
  state,
  isLoading,
  error,
}: {
  state: object | undefined;
  isLoading: boolean;
  error: Error | null;
}) {
  const [hideMgd, setHideMgd] = useState(true);
  const yaml = useMemo(() => {
    if (!state) return "";
    return objectToYaml(hideMgd ? removeManagedFields(state) : state);
  }, [state, hideMgd]);

  if (isLoading) return <StateBlock loading />;
  if (error) return <StateBlock message={error.message} />;
  if (!state) return <StateBlock message="No live state available" />;

  return (
    <View>
      <TouchableOpacity
        onPress={() => setHideMgd((v) => !v)}
        activeOpacity={0.75}
        style={styles.toggleRow}
      >
        <View style={[styles.check, hideMgd && styles.checkOn]}>
          {hideMgd && <Ionicons name="checkmark" size={10} color="#fff" />}
        </View>
        <Text style={styles.toggleLabel}>Hide managed fields</Text>
      </TouchableOpacity>
      <HighlightedYaml yaml={yaml} />
    </View>
  );
}

function DiffContent({ managed }: { managed: ManagedResource }) {
  const lines = useMemo(() => {
    const oldY = stateToYaml(managed.normalizedLiveState);
    const newY = stateToYaml(managed.predictedLiveState);
    return buildDiffLines(oldY, newY);
  }, [managed.normalizedLiveState, managed.predictedLiveState]);

  const adds = lines.filter((l) => l.type === "add").length;
  const removes = lines.filter((l) => l.type === "remove").length;
  return (
    <View>
      <View style={styles.diffStat}>
        <Text style={[styles.diffCount, { color: ADD_COLOR }]}>+{adds}</Text>
        <Text style={[styles.diffCount, { color: REMOVE_COLOR }]}>−{removes}</Text>
      </View>
      <View style={styles.diffBlock}>
        {lines.map((line, i) => (
          <DiffLineRow key={i} line={line} />
        ))}
      </View>
    </View>
  );
}

function StateBlock({ loading, message }: { loading?: boolean; message?: string }) {
  return (
    <View style={styles.stateBlock}>
      {loading ? (
        <ActivityIndicator color={colors.orange} />
      ) : (
        <>
          <Ionicons name="alert-circle-outline" size={24} color={colors.muted} />
          <Text style={styles.stateText}>{message}</Text>
        </>
      )}
    </View>
  );
}

// ── ResourceDetailContent ──────────────────────────────────────

export interface ResourceDetailContentProps {
  resource: ResourceDetailRef;
  appName: string;
  appNamespace: string;
  onClose: () => void;
}

export function ResourceDetailContent({
  resource,
  appName,
  appNamespace,
  onClose,
}: ResourceDetailContentProps) {
  const insets = useSafeAreaInsets();
  const client = useArgoClient();
  const [activeTab, setActiveTab] = useState<TabId>("summary");

  const resourceKey = `${resource.group}/${resource.kind}/${resource.namespace}/${resource.name}`;
  useEffect(() => {
    setActiveTab("summary");
  }, [resourceKey]);

  const enabled = true;

  const {
    data: liveState,
    isLoading: liveLoading,
    error: liveError,
  } = useQuery({
    queryKey: queryKeys.resource(
      client.serverUrl,
      appNamespace,
      appName,
      resource.group,
      resource.version,
      resource.kind,
      resource.namespace,
      resource.name,
    ),
    queryFn: () =>
      client.getResource(
        appName,
        appNamespace,
        resource.group,
        resource.version,
        resource.kind,
        resource.namespace,
        resource.name,
      ),
    enabled,
    staleTime: 0,
    gcTime: 0,
  });

  const { data: managed } = useQuery({
    queryKey: queryKeys.managedResource(
      client.serverUrl,
      appNamespace,
      appName,
      resource.group,
      resource.kind,
      resource.namespace,
      resource.name,
    ),
    queryFn: () =>
      client.getManagedResource(
        appName,
        appNamespace,
        resource.group,
        resource.kind,
        resource.namespace,
        resource.name,
      ),
    enabled,
    staleTime: 0,
    gcTime: 0,
  });

  const health = getHealth(resource.health?.status ?? "Unknown");
  const sync = resource.syncStatus ? getSync(resource.syncStatus) : null;
  const hasDesired = !!managed?.targetState;
  const hasDiff =
    !!managed?.normalizedLiveState &&
    !!managed?.predictedLiveState &&
    managed.normalizedLiveState !== managed.predictedLiveState;

  const tabs: { id: TabId; label: string }[] = [
    { id: "summary", label: "SUMMARY" },
    { id: "live", label: "LIVE" },
    ...(hasDesired ? [{ id: "desired" as TabId, label: "DESIRED" }] : []),
    ...(hasDiff ? [{ id: "diff" as TabId, label: "DIFF" }] : []),
  ];

  const kindGk = [resource.group, resource.kind].filter(Boolean).join("/");

  return (
    <View style={styles.overlay}>
      <TouchableOpacity
        style={StyleSheet.absoluteFillObject}
        onPress={onClose}
        activeOpacity={1}
      />
      <View style={[styles.sheet, { height: SCREEN_H * 0.88 }]}>
        {/* Handle */}
        <View style={styles.handleBar} />

        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <View style={styles.kindRow}>
              <Ionicons
                name={kindIcon(resource.kind)}
                size={14}
                color={colors.muted}
              />
              <Text style={styles.headerKind} numberOfLines={1}>
                {kindGk}
              </Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={{ top: 8, bottom: 8, left: 12, right: 8 }}
            >
              <Text style={styles.doneBtn}>Done</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.headerName} numberOfLines={1}>
            {resource.name}
          </Text>

          {!!resource.namespace && (
            <Text style={styles.headerNs} numberOfLines={1}>
              {resource.namespace}
            </Text>
          )}

          <View style={styles.pillRow}>
            <View
              style={[
                styles.pill,
                { backgroundColor: health.bg, borderColor: health.border },
              ]}
            >
              <Ionicons name={health.icon} size={11} color={health.color} />
              <Text style={[styles.pillText, { color: health.color }]}>
                {resource.health?.status ?? "Unknown"}
              </Text>
            </View>
            {sync && (
              <View
                style={[
                  styles.pill,
                  { backgroundColor: sync.bg, borderColor: sync.border },
                ]}
              >
                <Ionicons name={sync.icon} size={11} color={sync.color} />
                <Text style={[styles.pillText, { color: sync.color }]}>
                  {resource.syncStatus}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Tab bar */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.tabBar}
          contentContainerStyle={styles.tabBarInner}
        >
          {tabs.map((tab) => (
            <TouchableOpacity
              key={tab.id}
              onPress={() => setActiveTab(tab.id)}
              style={[styles.tab, activeTab === tab.id && styles.tabActive]}
            >
              <Text
                style={[
                  styles.tabText,
                  activeTab === tab.id && styles.tabTextActive,
                ]}
              >
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Content */}
        <ScrollView
          style={styles.contentScroll}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          showsVerticalScrollIndicator={false}
        >
          {activeTab === "summary" && <SummaryContent resource={resource} />}

          {activeTab === "live" && (
            <LiveContent
              state={liveState}
              isLoading={liveLoading}
              error={liveError instanceof Error ? liveError : null}
            />
          )}

          {activeTab === "desired" &&
            (hasDesired ? (
              <HighlightedYaml yaml={stateToYaml(managed!.targetState)} />
            ) : (
              <StateBlock message="Not managed by ArgoCD" />
            ))}

          {activeTab === "diff" &&
            (hasDiff ? (
              <DiffContent managed={managed!} />
            ) : (
              <StateBlock message="No diff available" />
            ))}
        </ScrollView>
      </View>
    </View>
  );
}

// ── ResourceDetailSheet (modal wrapper) ───────────────────────

export function ResourceDetailSheet({
  visible,
  onClose,
  appName,
  appNamespace,
  resource,
}: ResourceDetailSheetProps) {
  if (!resource) return null;
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <ResourceDetailContent
        resource={resource}
        appName={appName}
        appNamespace={appNamespace}
        onClose={onClose}
      />
    </Modal>
  );
}

// ── Styles ─────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  sheet: {
    backgroundColor: "#171B33",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colors.hairline,
  },
  handleBar: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.hairlineHi,
    alignSelf: "center",
    marginTop: 10,
    marginBottom: 4,
  },

  // Header
  header: {
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  headerTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 2,
  },
  kindRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    flex: 1,
  },
  headerKind: {
    fontSize: 12,
    color: colors.muted,
    fontFamily: MONO,
    flex: 1,
  },
  doneBtn: {
    fontSize: 15,
    fontWeight: "500",
    color: colors.orange,
  },
  headerName: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.text,
    letterSpacing: -0.3,
    marginTop: 2,
    marginBottom: 2,
  },
  headerNs: {
    fontSize: 12,
    color: colors.faint,
    fontFamily: MONO,
    marginBottom: 8,
  },
  pillRow: {
    flexDirection: "row",
    gap: 6,
    flexWrap: "wrap",
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
    borderWidth: 1,
  },
  pillText: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.1,
  },

  // Tab bar
  tabBar: {
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
    flexGrow: 0,
  },
  tabBarInner: {
    flexDirection: "row",
    paddingHorizontal: 16,
  },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabActive: {
    borderBottomColor: colors.orange,
  },
  tabText: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.5,
    color: colors.faint,
  },
  tabTextActive: {
    color: colors.orange,
  },

  // Content
  contentScroll: {
    flex: 1,
    backgroundColor: "#1C2140",
  },

  // Summary
  summaryWrap: {
    padding: 14,
    gap: 6,
  },
  sectionHeader: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.8,
    color: colors.faint,
    textTransform: "uppercase",
    paddingLeft: 4,
    marginTop: 4,
    marginBottom: 2,
  },
  card: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.hairline,
    overflow: "hidden",
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 14,
    paddingVertical: 9,
    gap: 8,
  },
  metaRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  metaLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.muted,
    width: 70,
    flexShrink: 0,
    paddingTop: 1,
  },
  metaValue: {
    flex: 1,
    fontSize: 13,
    color: colors.text,
    lineHeight: 18,
  },
  metaMono: {
    fontFamily: MONO,
    fontSize: 12,
  },
  messageText: {
    fontSize: 12,
    color: colors.muted,
  },

  // YAML
  yamlScroll: {
    backgroundColor: "#0d1119",
  },
  yamlLines: {
    padding: 14,
  },
  yamlLine: {
    fontFamily: MONO,
    fontSize: 12,
    lineHeight: 18,
  },

  // Managed fields toggle
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  check: {
    width: 16,
    height: 16,
    borderRadius: 3,
    borderWidth: 1.5,
    borderColor: colors.hairlineHi,
    alignItems: "center",
    justifyContent: "center",
  },
  checkOn: {
    backgroundColor: colors.orange,
    borderColor: colors.orange,
  },
  toggleLabel: {
    fontSize: 12,
    color: colors.muted,
    fontWeight: "500",
  },

  // Diff
  diffStat: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  diffCount: {
    fontSize: 13,
    fontFamily: MONO,
    fontWeight: "600",
  },
  diffBlock: {
    backgroundColor: "#0d1119",
  },
  diffRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 20,
  },
  lineNo: {
    width: 28,
    fontSize: 10,
    fontFamily: MONO,
    color: "rgba(245,246,250,0.25)",
    textAlign: "right",
    paddingRight: 4,
    alignSelf: "stretch",
    paddingTop: 2,
    paddingBottom: 2,
  },
  opCol: {
    width: 14,
    fontSize: 12,
    fontFamily: MONO,
    textAlign: "center",
    paddingTop: 2,
    paddingBottom: 2,
  },
  diffContent: {
    flex: 1,
    fontSize: 11,
    fontFamily: MONO,
    color: "#d6dae0",
    paddingRight: 8,
    paddingTop: 2,
    paddingBottom: 2,
  },
  collapseRow: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderStyle: "dashed",
    borderColor: "rgba(245,246,250,0.12)",
    backgroundColor: "rgba(255,255,255,0.02)",
    alignItems: "center",
  },
  collapseText: {
    fontSize: 11,
    fontFamily: MONO,
    color: "rgba(245,246,250,0.35)",
  },

  // State blocks
  stateBlock: {
    padding: 40,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  stateText: {
    fontSize: 13,
    color: colors.muted,
    textAlign: "center",
  },
});
