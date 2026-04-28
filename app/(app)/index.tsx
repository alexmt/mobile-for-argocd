import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { colors } from "../../lib/theme";
import { appKey, appSource, type Application } from "../../lib/api";
import { favoritesStorage } from "../../lib/storage";
import { useArgoClient } from "../../lib/client";
import { queryKeys } from "../../lib/query-keys";
import { getHealth, getSync, healthSeverity } from "../../lib/status";

// ── Helpers ───────────────────────────────────────────────────

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
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

function shortRepo(url: string): string {
  try {
    const u = new URL(url.includes("://") ? url : `https://${url}`);
    return u.pathname.replace(/^\//, "").replace(/\.git$/, "") || u.hostname;
  } catch {
    return url;
  }
}

function destLabel(app: Application): string {
  const d = app.spec.destination;
  if (d.name) return d.name;
  if (d.server) {
    try {
      return new URL(d.server).hostname;
    } catch {
      return d.server;
    }
  }
  return "—";
}

function isAutoSync(app: Application): boolean {
  return !!app.spec.syncPolicy?.automated;
}

// ── Status pill ────────────────────────────────────────────────
function StatusPill({
  kind,
  status,
}: {
  kind: "health" | "sync";
  status: string;
}) {
  const t = kind === "health" ? getHealth(status) : getSync(status);
  return (
    <View
      style={[styles.pill, { backgroundColor: t.bg, borderColor: t.border }]}
    >
      <Ionicons name={t.icon} size={11} color={t.color} />
      <Text style={[styles.pillText, { color: t.color }]}>{status}</Text>
    </View>
  );
}

// ── App card ──────────────────────────────────────────────────
interface AppCardProps {
  app: Application;
  isFav: boolean;
  onPress: () => void;
  onToggleFav: (key: string) => void;
}

function AppCard({ app, isFav, onPress, onToggleFav }: AppCardProps) {
  const src = appSource(app);
  const key = appKey(app);
  const auto = isAutoSync(app);

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8} style={styles.card}>
      {/* Row 1: icon + name + fav */}
      <View style={styles.cardRow}>
        <View style={styles.appIcon}>
          <Ionicons name="cube-outline" size={14} color={colors.orange} />
        </View>
        <View style={styles.cardNameBlock}>
          <Text style={styles.cardName} numberOfLines={2}>
            {app.metadata.name}
          </Text>
          <Text style={styles.cardProject}>{app.spec.project}</Text>
        </View>
        <TouchableOpacity
          onPress={() => onToggleFav(key)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons
            name={isFav ? "star" : "star-outline"}
            size={18}
            color={isFav ? "#F2C94C" : colors.faint}
          />
        </TouchableOpacity>
      </View>

      {/* Row 2: pills */}
      <View style={styles.cardPills}>
        <StatusPill
          kind="health"
          status={app.status?.health?.status ?? "Unknown"}
        />
        <StatusPill
          kind="sync"
          status={app.status?.sync?.status ?? "Unknown"}
        />
        {auto && (
          <View
            style={[
              styles.pill,
              {
                backgroundColor: "rgba(59,150,226,0.14)",
                borderColor: "rgba(59,150,226,0.40)",
              },
            ]}
          >
            <Ionicons name="flash" size={11} color="#3B96E2" />
            <Text style={[styles.pillText, { color: "#3B96E2" }]}>Auto</Text>
          </View>
        )}
      </View>

      {/* Row 3: meta */}
      <View style={styles.cardMeta}>
        <MetaRow label="Repo" value={src ? shortRepo(src.repoURL) : "—"} mono />
        <MetaRow label="Target" value={src?.targetRevision ?? "—"} mono />
        <MetaRow label="Cluster" value={destLabel(app)} mono />
        <MetaRow
          label="Last sync"
          value={timeAgo(app.status?.operationState?.finishedAt)}
        />
      </View>
    </TouchableOpacity>
  );
}

function MetaRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text
        style={[styles.metaValue, mono && styles.metaMono]}
        numberOfLines={1}
      >
        {value}
      </Text>
    </>
  );
}

// ── Health bar ─────────────────────────────────────────────────
function HealthBar({ counts }: { counts: Record<string, number> }) {
  const order = [
    "Healthy",
    "Progressing",
    "Suspended",
    "Degraded",
    "Missing",
    "Unknown",
  ];
  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  return (
    <View style={styles.healthBar}>
      {order.map((k) => {
        const n = counts[k] ?? 0;
        if (!n) return null;
        return (
          <View
            key={k}
            style={{ flex: n / total, backgroundColor: getHealth(k).color }}
          />
        );
      })}
    </View>
  );
}

function HealthLegend({ counts }: { counts: Record<string, number> }) {
  const entries = Object.entries(counts).filter(([, n]) => n > 0);
  if (!entries.length) return null;
  return (
    <View style={styles.legendRow}>
      {entries.map(([k, n]) => (
        <View key={k} style={styles.legendItem}>
          <View
            style={[styles.legendDot, { backgroundColor: getHealth(k).color }]}
          />
          <Text style={styles.legendText}>{k}</Text>
          <Text style={styles.legendCount}>{n}</Text>
        </View>
      ))}
    </View>
  );
}

// ── Search field ───────────────────────────────────────────────
function SearchField({
  value,
  onChange,
}: {
  value: string;
  onChange: (s: string) => void;
}) {
  return (
    <View style={styles.searchBar}>
      <Ionicons name="search" size={14} color={colors.muted} />
      <TextInput
        style={styles.searchInput}
        value={value}
        onChangeText={onChange}
        placeholder="Search applications"
        placeholderTextColor={colors.faint}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardAppearance="dark"
        clearButtonMode="while-editing"
      />
      {!!value && Platform.OS !== "ios" && (
        <TouchableOpacity onPress={() => onChange("")}>
          <Ionicons name="close-circle" size={16} color={colors.muted} />
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── Chip rail ─────────────────────────────────────────────────
interface Chip {
  key: string;
  label: string;
  icon?: React.ReactNode;
  accent?: string;
}

function ChipRail({
  chips,
  active,
  onChange,
  counts,
}: {
  chips: Chip[];
  active: string;
  onChange: (k: string) => void;
  counts: Record<string, number>;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.chipRail}
      keyboardShouldPersistTaps="handled"
    >
      {chips.map((c) => {
        const on = active === c.key;
        const accent = c.accent ?? colors.orange;
        const count = counts[c.key];
        return (
          <TouchableOpacity
            key={c.key}
            onPress={() => onChange(c.key)}
            style={[
              styles.chip,
              {
                backgroundColor: on ? `${accent}26` : "rgba(255,255,255,0.05)",
                borderColor: on ? accent : colors.hairline,
              },
            ]}
            activeOpacity={0.7}
          >
            {c.icon}
            <Text
              style={[styles.chipText, { color: on ? accent : colors.text }]}
            >
              {c.label}
            </Text>
            {count != null && (
              <Text
                style={[
                  styles.chipCount,
                  { color: on ? accent : colors.muted },
                ]}
              >
                {count}
              </Text>
            )}
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

// ── Bottom sheet ───────────────────────────────────────────────
function BottomSheet({
  visible,
  onClose,
  title,
  height,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  height: number;
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.sheetContainer}>
        <TouchableOpacity
          style={[styles.sheetBackdrop]}
          onPress={onClose}
          activeOpacity={1}
        />
        <View
          style={[styles.sheet, { height, paddingBottom: insets.bottom + 16 }]}
        >
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <View style={{ width: 60 }} />
            <Text style={styles.sheetTitle}>{title}</Text>
            <TouchableOpacity
              onPress={onClose}
              style={{ width: 60, alignItems: "flex-end" }}
            >
              <Text style={styles.sheetDone}>Done</Text>
            </TouchableOpacity>
          </View>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: 16 }}
          >
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ── Sort sheet ─────────────────────────────────────────────────
type SortKey = "name" | "lastSync" | "health" | "project";

const SORT_OPTS: { key: SortKey; label: string; sub: string }[] = [
  { key: "name", label: "Name", sub: "A → Z" },
  { key: "lastSync", label: "Last sync", sub: "Most recent first" },
  { key: "health", label: "Health", sub: "Worst first" },
  { key: "project", label: "Project", sub: "Grouped" },
];

function SortSheet({
  visible,
  onClose,
  sortKey,
  setSortKey,
}: {
  visible: boolean;
  onClose: () => void;
  sortKey: SortKey;
  setSortKey: (k: SortKey) => void;
}) {
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Sort by"
      height={340}
    >
      <View style={styles.filterCard}>
        {SORT_OPTS.map((o, i) => (
          <TouchableOpacity
            key={o.key}
            onPress={() => {
              setSortKey(o.key);
              onClose();
            }}
            style={[
              styles.filterRow,
              i < SORT_OPTS.length - 1 && styles.filterRowBorder,
            ]}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.filterRowLabel}>{o.label}</Text>
              <Text style={styles.filterRowSub}>{o.sub}</Text>
            </View>
            {sortKey === o.key && (
              <Ionicons name="checkmark" size={20} color={colors.orange} />
            )}
          </TouchableOpacity>
        ))}
      </View>
    </BottomSheet>
  );
}

// ── Filter sheet ───────────────────────────────────────────────
export interface FilterState {
  health: string[];
  sync: string[];
  autoSync: string[];
}

function FilterSheet({
  visible,
  onClose,
  state,
  setState,
  counts,
}: {
  visible: boolean;
  onClose: () => void;
  state: FilterState;
  setState: React.Dispatch<React.SetStateAction<FilterState>>;
  counts: { health: Record<string, number>; sync: Record<string, number> };
}) {
  const toggle = (group: keyof FilterState, key: string) => {
    setState((s) => {
      const arr = s[group];
      const next = arr.includes(key)
        ? arr.filter((k) => k !== key)
        : [...arr, key];
      return { ...s, [group]: next };
    });
  };
  const on = (group: keyof FilterState, key: string) =>
    state[group].includes(key);
  const hasFilters =
    state.health.length > 0 ||
    state.sync.length > 0 ||
    state.autoSync.length > 0;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Filters"
      height={540}
    >
      <View style={styles.filterSection}>
        <Text style={styles.filterGroupLabel}>Health status</Text>
        <View style={styles.filterCard}>
          {(
            [
              "Healthy",
              "Progressing",
              "Suspended",
              "Degraded",
              "Missing",
              "Unknown",
            ] as const
          ).map((k, i, arr) => (
            <FilterRow
              key={k}
              icon={
                <Ionicons
                  name={getHealth(k).icon}
                  size={14}
                  color={getHealth(k).color}
                />
              }
              label={k}
              count={counts.health[k]}
              on={on("health", k)}
              onToggle={() => toggle("health", k)}
              last={i === arr.length - 1}
            />
          ))}
        </View>
      </View>

      <View style={styles.filterSection}>
        <Text style={styles.filterGroupLabel}>Sync status</Text>
        <View style={styles.filterCard}>
          {(["Synced", "OutOfSync", "Unknown"] as const).map((k, i, arr) => (
            <FilterRow
              key={k}
              icon={
                <Ionicons
                  name={getSync(k).icon}
                  size={14}
                  color={getSync(k).color}
                />
              }
              label={k}
              count={counts.sync[k]}
              on={on("sync", k)}
              onToggle={() => toggle("sync", k)}
              last={i === arr.length - 1}
            />
          ))}
        </View>
      </View>

      <View style={styles.filterSection}>
        <Text style={styles.filterGroupLabel}>Auto sync</Text>
        <View style={styles.filterCard}>
          <FilterRow
            icon={<Ionicons name="flash" size={14} color={colors.success} />}
            label="Enabled"
            on={on("autoSync", "enabled")}
            onToggle={() => toggle("autoSync", "enabled")}
          />
          <FilterRow
            icon={<Ionicons name="flash-off" size={14} color={colors.muted} />}
            label="Disabled"
            on={on("autoSync", "disabled")}
            onToggle={() => toggle("autoSync", "disabled")}
            last
          />
        </View>
      </View>

      {hasFilters && (
        <View style={{ paddingHorizontal: 16, marginTop: 8 }}>
          <TouchableOpacity
            onPress={() => setState({ health: [], sync: [], autoSync: [] })}
            style={styles.clearBtn}
          >
            <Text style={styles.clearBtnText}>Clear all filters</Text>
          </TouchableOpacity>
        </View>
      )}
    </BottomSheet>
  );
}

function FilterRow({
  icon,
  label,
  count,
  on,
  onToggle,
  last,
}: {
  icon: React.ReactNode;
  label: string;
  count?: number;
  on: boolean;
  onToggle: () => void;
  last?: boolean;
}) {
  return (
    <TouchableOpacity
      onPress={onToggle}
      style={[styles.filterRow, !last && styles.filterRowBorder]}
    >
      <View style={[styles.checkbox, on && styles.checkboxOn]}>
        {on && <Ionicons name="checkmark" size={12} color="#fff" />}
      </View>
      <View style={styles.filterIcon}>{icon}</View>
      <Text style={styles.filterRowLabel}>{label}</Text>
      {count != null && <Text style={styles.filterCount}>{count}</Text>}
    </TouchableOpacity>
  );
}

// ── Tab bar ───────────────────────────────────────────────────
function TabBar({ active }: { active: "apps" | "activity" | "settings" }) {
  const insets = useSafeAreaInsets();
  const tabs = [
    { key: "apps" as const, label: "Apps", icon: "grid" as const },
    { key: "activity" as const, label: "Activity", icon: "pulse" as const },
    {
      key: "settings" as const,
      label: "Settings",
      icon: "settings-outline" as const,
    },
  ];
  return (
    <View style={[styles.tabBar, { paddingBottom: insets.bottom + 4 }]}>
      {tabs.map((t) => {
        const on = active === t.key;
        return (
          <TouchableOpacity
            key={t.key}
            style={styles.tabItem}
            activeOpacity={0.7}
          >
            <Ionicons
              name={t.icon}
              size={22}
              color={on ? colors.orange : colors.faint}
            />
            <Text
              style={[
                styles.tabLabel,
                { color: on ? colors.orange : colors.faint },
              ]}
            >
              {t.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ── Empty state ────────────────────────────────────────────────
function EmptyState({
  hasFilters,
  onClear,
}: {
  hasFilters: boolean;
  onClear: () => void;
}) {
  return (
    <View style={styles.emptyState}>
      <View style={styles.emptyIcon}>
        <Ionicons name="search" size={22} color={colors.muted} />
      </View>
      <Text style={styles.emptyTitle}>No matching apps</Text>
      <Text style={styles.emptyBody}>
        Try a different search term or clear the active filter.
      </Text>
      {hasFilters && (
        <TouchableOpacity onPress={onClear} style={styles.clearBtn}>
          <Text style={styles.clearBtnText}>Clear filters</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const PAGE_SIZE = 20;

// ── Page footer ────────────────────────────────────────────────
function ListFooter({
  hasMore,
  total,
  shown,
}: {
  hasMore: boolean;
  total: number;
  shown: number;
}) {
  if (!hasMore) {
    if (total === 0) return null;
    return (
      <View style={styles.footer}>
        <Text style={styles.footerText}>
          {total} app{total !== 1 ? "s" : ""}
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.footer}>
      <ActivityIndicator size="small" color={colors.muted} />
      <Text style={styles.footerText}>
        {shown} of {total}
      </Text>
    </View>
  );
}

// ── Apps list screen ───────────────────────────────────────────
export default function AppsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const client = useArgoClient();
  const queryClient = useQueryClient();

  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [chip, setChip] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [filterState, setFilterState] = useState<FilterState>({
    health: [],
    sync: [],
    autoSync: [],
  });
  const [showSort, setShowSort] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const abortRef = useRef<AbortController | null>(null);

  // Load favorites on mount; abort watch on unmount
  useEffect(() => {
    favoritesStorage.get().then(setFavorites);
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // Initial list fetch — react-query owns loading/error/data
  const queryKey = queryKeys.applications(client.serverUrl);
  const {
    data,
    isLoading,
    error: queryError,
  } = useQuery({
    queryKey,
    queryFn: () => client.listApplications(),
  });

  const apps = useMemo(() => data?.items ?? [], [data]);

  // Live watch — starts once the initial list succeeds, updates the query cache
  useEffect(() => {
    const rv = data?.resourceVersion;
    if (!rv) return;

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const watch = async () => {
      try {
        await client.watchApplications(
          rv,
          (type, app) => {
            if (ctrl.signal.aborted) return;
            queryClient.setQueryData<{
              items: Application[];
              resourceVersion: string;
            }>(queryKey, (prev) => {
              if (!prev) return prev;
              const key = appKey(app);
              const idx = prev.items.findIndex((a) => appKey(a) === key);
              if (type === "DELETED") {
                return {
                  ...prev,
                  items:
                    idx >= 0
                      ? prev.items.filter((_, i) => i !== idx)
                      : prev.items,
                };
              }
              const items =
                idx >= 0
                  ? prev.items.map((a, i) => (i === idx ? app : a))
                  : [app, ...prev.items];
              return { ...prev, items };
            });
          },
          ctrl.signal,
        );
      } catch {
        if (ctrl.signal.aborted) return;
        // Invalidate so react-query re-fetches the list and restarts the watch
        void queryClient.invalidateQueries({ queryKey });
      }
    };

    void watch();
    return () => {
      ctrl.abort();
    };
  }, [data?.resourceVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  // Favorites toggle
  const toggleFav = useCallback((key: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      favoritesStorage.set(next);
      return next;
    });
  }, []);

  // Health/sync counts (for bar + chips + filter badges)
  const healthCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const a of apps) {
      const h = a.status?.health?.status ?? "Unknown";
      c[h] = (c[h] ?? 0) + 1;
    }
    return c;
  }, [apps]);

  const syncCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const a of apps) {
      const s = a.status?.sync?.status ?? "Unknown";
      c[s] = (c[s] ?? 0) + 1;
    }
    return c;
  }, [apps]);

  // Filter + sort — full list (used for counts and pagination source)
  const filteredSortedApps = useMemo(() => {
    let list = apps;

    // Search
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (a) =>
          a.metadata.name.toLowerCase().includes(q) ||
          a.spec.project.toLowerCase().includes(q) ||
          destLabel(a).toLowerCase().includes(q),
      );
    }

    // Quick chip
    if (chip === "fav") {
      list = list.filter((a) => favorites.has(appKey(a)));
    } else if (chip !== "all") {
      list = list.filter(
        (a) =>
          (a.status?.health?.status ?? "Unknown") === chip ||
          (a.status?.sync?.status ?? "Unknown") === chip,
      );
    }

    // Advanced filter
    if (filterState.health.length > 0) {
      list = list.filter((a) =>
        filterState.health.includes(a.status?.health?.status ?? "Unknown"),
      );
    }
    if (filterState.sync.length > 0) {
      list = list.filter((a) =>
        filterState.sync.includes(a.status?.sync?.status ?? "Unknown"),
      );
    }
    if (filterState.autoSync.length > 0) {
      const wantAuto = filterState.autoSync.includes("enabled");
      const wantManual = filterState.autoSync.includes("disabled");
      list = list.filter((a) => {
        const auto = isAutoSync(a);
        return (wantAuto && auto) || (wantManual && !auto);
      });
    }

    // Sort
    list = [...list].sort((a, b) => {
      switch (sortKey) {
        case "name":
          return a.metadata.name.localeCompare(b.metadata.name);
        case "project":
          return (
            a.spec.project.localeCompare(b.spec.project) ||
            a.metadata.name.localeCompare(b.metadata.name)
          );
        case "lastSync": {
          const ta = a.status?.operationState?.finishedAt ?? "";
          const tb = b.status?.operationState?.finishedAt ?? "";
          return tb.localeCompare(ta); // most recent first
        }
        case "health":
          return (
            healthSeverity(a.status?.health?.status ?? "Unknown") -
            healthSeverity(b.status?.health?.status ?? "Unknown")
          );
        default:
          return 0;
      }
    });

    return list;
  }, [apps, search, chip, favorites, filterState, sortKey]);

  // Reset to first page whenever the filtered set changes
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [search, chip, filterState, sortKey]);

  // Paginated slice passed to FlatList
  const visibleApps = useMemo(
    () => filteredSortedApps.slice(0, visibleCount),
    [filteredSortedApps, visibleCount],
  );
  const hasMore = visibleCount < filteredSortedApps.length;

  // Chip config
  const chips = useMemo<Chip[]>(
    () => [
      { key: "all", label: "All" },
      { key: "fav", label: "★ Favorites", accent: "#F2C94C" },
      {
        key: "Degraded",
        label: "Degraded",
        accent: "#F25D5D",
        icon: (
          <Ionicons
            name="heart-dislike"
            size={11}
            color="#F25D5D"
            style={{ marginRight: 2 }}
          />
        ),
      },
      {
        key: "OutOfSync",
        label: "OutOfSync",
        accent: "#F2C94C",
        icon: (
          <Ionicons
            name="time"
            size={11}
            color="#F2C94C"
            style={{ marginRight: 2 }}
          />
        ),
      },
      {
        key: "Missing",
        label: "Missing",
        accent: "#F2C94C",
        icon: (
          <Ionicons
            name="alert-circle"
            size={11}
            color="#F2C94C"
            style={{ marginRight: 2 }}
          />
        ),
      },
      {
        key: "Progressing",
        label: "Progressing",
        accent: "#3B96E2",
        icon: (
          <Ionicons
            name="refresh-circle"
            size={11}
            color="#3B96E2"
            style={{ marginRight: 2 }}
          />
        ),
      },
      {
        key: "Healthy",
        label: "Healthy",
        accent: "#5CD9B0",
        icon: (
          <Ionicons
            name="heart"
            size={11}
            color="#5CD9B0"
            style={{ marginRight: 2 }}
          />
        ),
      },
    ],
    [],
  );

  const chipCounts = useMemo<Record<string, number>>(() => {
    const c: Record<string, number> = {
      all: apps.length,
      fav: apps.filter((a) => favorites.has(appKey(a))).length,
    };
    for (const [k, n] of Object.entries(healthCounts)) {
      c[k] = (c[k] ?? 0) + n;
    }
    for (const [k, n] of Object.entries(syncCounts)) {
      c[k] = (c[k] ?? 0) + n;
    }
    return c;
  }, [apps, favorites, healthCounts, syncCounts]);

  const hasFilters =
    search !== "" ||
    chip !== "all" ||
    filterState.health.length > 0 ||
    filterState.sync.length > 0 ||
    filterState.autoSync.length > 0;

  const clearAll = useCallback(() => {
    setSearch("");
    setChip("all");
    setFilterState({ health: [], sync: [], autoSync: [] });
  }, []);

  const activeFilterCount =
    filterState.health.length +
    filterState.sync.length +
    filterState.autoSync.length;

  const serverName = client.hostname;

  // Header rendered as FlatList's ListHeaderComponent
  const ListHeader = useMemo(
    () => (
      <View style={[styles.header, { paddingTop: insets.top }]}>
        {/* Nav row */}
        <View style={styles.navRow}>
          <TouchableOpacity
            onPress={() => router.replace("/login")}
            style={styles.serverBtn}
            activeOpacity={0.7}
          >
            <Ionicons name="chevron-back" size={18} color={colors.orange} />
            <Text style={styles.serverName} numberOfLines={1}>
              {serverName}
            </Text>
          </TouchableOpacity>
          <View style={styles.headerActions}>
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={() => setShowSort(true)}
            >
              <Ionicons name="reorder-three" size={20} color={colors.text} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.iconBtn,
                activeFilterCount > 0 && styles.iconBtnActive,
              ]}
              onPress={() => setShowFilter(true)}
            >
              <Ionicons
                name="options"
                size={20}
                color={activeFilterCount > 0 ? colors.orange : colors.text}
              />
              {activeFilterCount > 0 && (
                <View style={styles.filterBadge}>
                  <Text style={styles.filterBadgeText}>
                    {activeFilterCount}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* Large title */}
        <View style={styles.titleRow}>
          <Text style={styles.largeTitle}>Applications</Text>
          {isLoading ? (
            <ActivityIndicator
              size="small"
              color={colors.muted}
              style={{ marginLeft: 8 }}
            />
          ) : (
            <Text style={styles.appCount}>{apps.length}</Text>
          )}
        </View>

        {/* Health bar + legend */}
        {apps.length > 0 && (
          <View style={{ paddingHorizontal: 20, paddingBottom: 12 }}>
            <HealthBar counts={healthCounts} />
            <HealthLegend counts={healthCounts} />
          </View>
        )}

        {/* Search */}
        <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>
          <SearchField value={search} onChange={setSearch} />
        </View>

        {/* Chips */}
        <ChipRail
          chips={chips}
          active={chip}
          onChange={setChip}
          counts={chipCounts}
        />

        <View style={styles.headerBorder} />
      </View>
    ),
    [
      insets.top,
      serverName,
      apps.length,
      isLoading,
      healthCounts,
      search,
      chips,
      chip,
      chipCounts,
      activeFilterCount,
      router,
    ],
  );

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      {queryError && !isLoading && (
        <View style={[styles.errorBanner, { paddingTop: insets.top + 8 }]}>
          <Ionicons name="alert-circle" size={14} color={colors.danger} />
          <Text style={styles.errorText}>
            {queryError instanceof Error
              ? queryError.message
              : "Failed to load"}{" "}
            — retrying…
          </Text>
        </View>
      )}

      <FlatList
        data={visibleApps}
        keyExtractor={(a) => appKey(a)}
        renderItem={({ item }) => (
          <AppCard
            app={item}
            isFav={favorites.has(appKey(item))}
            onPress={() => {}}
            onToggleFav={toggleFav}
          />
        )}
        contentContainerStyle={[
          styles.listContent,
          filteredSortedApps.length === 0 && { flexGrow: 1 },
        ]}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={
          isLoading ? null : (
            <EmptyState hasFilters={hasFilters} onClear={clearAll} />
          )
        }
        ListFooterComponent={
          <ListFooter
            hasMore={hasMore}
            total={filteredSortedApps.length}
            shown={visibleApps.length}
          />
        }
        onEndReached={() => {
          if (hasMore) setVisibleCount((c) => c + PAGE_SIZE);
        }}
        onEndReachedThreshold={0.4}
        initialNumToRender={PAGE_SIZE}
        maxToRenderPerBatch={10}
        windowSize={5}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      />

      <TabBar active="apps" />

      <SortSheet
        visible={showSort}
        onClose={() => setShowSort(false)}
        sortKey={sortKey}
        setSortKey={setSortKey}
      />
      <FilterSheet
        visible={showFilter}
        onClose={() => setShowFilter(false)}
        state={filterState}
        setState={setFilterState}
        counts={{ health: healthCounts, sync: syncCounts }}
      />
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#0E1226",
  },

  // Header
  header: {
    backgroundColor: "#171B33",
  },
  headerBorder: {
    height: 1,
    backgroundColor: colors.hairline,
  },
  navRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  serverBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    padding: 8,
  },
  serverName: {
    fontSize: 15,
    fontWeight: "500",
    color: colors.orange,
    letterSpacing: -0.2,
    maxWidth: 200,
  },
  headerActions: {
    flexDirection: "row",
    gap: 8,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: colors.hairline,
    alignItems: "center",
    justifyContent: "center",
  },
  iconBtnActive: {
    borderColor: colors.orange,
    backgroundColor: "rgba(239,123,77,0.1)",
  },
  filterBadge: {
    position: "absolute",
    top: -4,
    right: -4,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.orange,
    alignItems: "center",
    justifyContent: "center",
  },
  filterBadgeText: {
    fontSize: 9,
    fontWeight: "700",
    color: "#fff",
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "baseline",
    paddingHorizontal: 20,
    paddingBottom: 8,
    paddingTop: 4,
    gap: 10,
  },
  largeTitle: {
    fontSize: 32,
    fontWeight: "700",
    color: colors.text,
    letterSpacing: -0.6,
  },
  appCount: {
    fontSize: 14,
    color: colors.muted,
    fontWeight: "500",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },

  // Health bar
  healthBar: {
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
    flexDirection: "row",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  legendRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginTop: 8,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  legendDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  legendText: {
    fontSize: 11,
    color: colors.muted,
    fontWeight: "500",
  },
  legendCount: {
    fontSize: 11,
    color: colors.faint,
    fontWeight: "500",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },

  // Search
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 36,
    paddingHorizontal: 10,
    backgroundColor: "rgba(255,255,255,0.07)",
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: colors.text,
    letterSpacing: -0.2,
    padding: 0,
    margin: 0,
  },

  // Chip rail
  chipRail: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 8,
    flexDirection: "row",
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    gap: 4,
  },
  chipText: {
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: -0.1,
  },
  chipCount: {
    fontSize: 11,
    fontWeight: "500",
    marginLeft: 2,
  },

  // List
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 96,
    gap: 12,
  },

  // Card
  card: {
    backgroundColor: "#1C2140",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.hairline,
    padding: 16,
    gap: 12,
  },
  cardRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  appIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: "rgba(239,123,77,0.12)",
    borderWidth: 1,
    borderColor: "rgba(239,123,77,0.3)",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  cardNameBlock: {
    flex: 1,
    minWidth: 0,
  },
  cardName: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.text,
    letterSpacing: -0.2,
    lineHeight: 20,
  },
  cardProject: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  cardPills: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  pillText: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.1,
  },
  cardMeta: {
    display: "flex",
    flexDirection: "row",
    flexWrap: "wrap",
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    rowGap: 6,
    columnGap: 8,
  },
  metaLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: colors.faint,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    width: 52,
    paddingTop: 1,
  },
  metaValue: {
    fontSize: 12,
    color: colors.text,
    flex: 1,
    minWidth: 80,
  },
  metaMono: {
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: 11,
  },

  // Tab bar
  tabBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    backgroundColor: "rgba(14,18,38,0.92)",
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    paddingTop: 6,
  },
  tabItem: {
    flex: 1,
    alignItems: "center",
    gap: 3,
    paddingVertical: 4,
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 0.2,
  },

  // Error banner
  errorBanner: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingBottom: 8,
    backgroundColor: "rgba(242,93,93,0.15)",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(242,93,93,0.3)",
  },
  errorText: {
    fontSize: 12,
    color: colors.danger,
    flex: 1,
  },

  // Empty state
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 48,
    gap: 12,
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: colors.hairline,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.text,
  },
  emptyBody: {
    fontSize: 13,
    color: colors.muted,
    textAlign: "center",
    lineHeight: 20,
    maxWidth: 260,
  },

  // Bottom sheet
  sheetContainer: {
    flex: 1,
    justifyContent: "flex-end",
  },
  sheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  sheet: {
    backgroundColor: "#171B33",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderBottomWidth: 0,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.hairlineHi,
    alignSelf: "center",
    marginTop: 12,
    marginBottom: 4,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.text,
    letterSpacing: -0.2,
  },
  sheetDone: {
    fontSize: 15,
    fontWeight: "500",
    color: colors.orange,
  },

  // Filter
  filterSection: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  filterGroupLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    color: colors.faint,
    textTransform: "uppercase",
    paddingBottom: 6,
    paddingLeft: 4,
  },
  filterCard: {
    backgroundColor: "#1C2140",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.hairline,
    overflow: "hidden",
  },
  filterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    paddingHorizontal: 14,
  },
  filterRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  filterRowLabel: {
    flex: 1,
    fontSize: 15,
    color: colors.text,
    fontWeight: "500",
  },
  filterRowSub: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
  },
  filterCount: {
    fontSize: 13,
    color: colors.muted,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  filterIcon: {
    width: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.hairlineHi,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  checkboxOn: {
    backgroundColor: colors.orange,
    borderColor: colors.orange,
  },
  clearBtn: {
    alignSelf: "center",
    marginTop: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: "rgba(239,123,77,0.12)",
    borderWidth: 1,
    borderColor: "rgba(239,123,77,0.35)",
  },
  clearBtnText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.orange,
  },

  // Footer
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 16,
  },
  footerText: {
    fontSize: 12,
    color: colors.faint,
    fontWeight: "500",
  },
});
