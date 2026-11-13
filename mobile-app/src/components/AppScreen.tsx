import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Image,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import catalogRaw from '../data/catalog.json';
import { samplePairs } from '../data/samplePairs';
import { RiseScreen } from './RiseScreen';
import { ChangeCard, waterFor } from './ChangeCard';

export type CueScore = {
  cue_score: number;
  threshold: number;
  above_threshold: boolean;
  confidence: 'high' | 'marginal';
  label: string;
  disclaimer?: string;
};

export type VisionDossier = {
  summary: string;
  visible_water_before: 'yes' | 'no' | 'uncertain';
  visible_water_after: 'yes' | 'no' | 'uncertain';
  evidence: string[];
  limitations: string[];
  review_priority: 'high' | 'medium' | 'low';
};

export type HumanReview = {
  before_id: string;
  after_id: string;
  agreement: string;
  notes?: string;
  reviewer?: string;
  timestamp?: string;
};

export type Pair = {
  index: number;
  before_id: string;
  after_id: string;
  locality: string;
  before_date: string;
  after_date: string;
  before_url: string;
  after_url: string;
  source?: string;
  latitude?: string;
  longitude?: string;
  dossier?: VisionDossier | null;
  before_cue?: CueScore | null;
  after_cue?: CueScore | null;
  review?: HumanReview | null;
};

type Tab = 'Rise' | 'Explore' | 'Compare' | 'Settings';
type FilterMode = 'all' | 'high_priority' | 'floodwater' | 'reviewed';

// Every UTSA before/after pair ships with the app (export_catalog.py), so
// Expo Go shows the whole dataset without a server. The original sample
// pairs keep their richer model notes.
const sampleByAfter = new Map((samplePairs as unknown as Pair[]).map(p => [p.after_id, p]));
const bundledPairs: Pair[] = (catalogRaw as unknown as Pair[]).map(p => ({ ...sampleByAfter.get(p.after_id), ...p }));
type Phase = 'before' | 'after';
type CompareMode = 'split' | 'toggle' | 'sideBySide';

// Design Palette: ByteRight-inspired restrained, high-contrast editorial design
export const C = {
  bg: '#F8FAF6',
  white: '#FFFFFF',
  ink: '#111815',
  inkSecondary: '#314238',
  muted: '#526357',
  border: '#D8E2DC',
  borderStrong: '#B0C2B6',
  green: '#1B4D34',
  greenLight: '#E8F2EC',
  greenDark: '#123524',
  amber: '#854D0E',
  amberLight: '#FEF9C3',
  amberBorder: '#FDE047',
  red: '#991B1B',
  redLight: '#FEE2E2',
  dark: '#0C120F',
};

const initialApi = (process.env.EXPO_PUBLIC_API_BASE_URL || '').replace(/\/$/, '');

function url(base: string, path: string): string {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  return `${base}${path.startsWith('/') ? '' : '/'}${path}`;
}

type AppData = {
  apiInput: string;
  setApiInput: (value: string) => void;
  apiBase: string;
  setApiBase: (value: string) => void;
  pairs: Pair[];
  selected: number;
  setSelected: (value: number) => void;
  phase: Phase;
  setPhase: (value: Phase) => void;
  compareMode: CompareMode;
  setCompareMode: (value: CompareMode) => void;
  query: string;
  setQuery: (value: string) => void;
  filterMode: FilterMode;
  setFilterMode: (value: FilterMode) => void;
  loading: boolean;
  error: string;
  filtered: Pair[];
  connect: () => void;
  submitReview: (agreement: string, notes?: string) => Promise<void>;
  currentPair?: Pair;
};

const DataContext = createContext<AppData | null>(null);

export function useAppData() {
  const data = useContext(DataContext);
  if (!data) throw Error('App data provider missing');
  return data;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [apiInput, setApiInput] = useState(initialApi);
  const [apiBase, setApiBase] = useState(initialApi);
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [selected, setSelected] = useState(0);
  const [phase, setPhase] = useState<Phase>('after');
  const [compareMode, setCompareMode] = useState<CompareMode>('split');
  const [query, setQuery] = useState('');
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (base: string) => {
    if (!base) {
      setPairs(bundledPairs);
      setError('');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${base}/api/pairs`);
      if (!response.ok) throw Error(`Server returned ${response.status}`);
      const data: Pair[] = await response.json();
      if (!Array.isArray(data)) throw Error('Unexpected dataset response structure');
      setPairs(data);
      setSelected(0);
      if (!data.length) setError('No before/after image pairs were found in catalog.');
    } catch (cause) {
      setPairs(bundledPairs);
      setError(`Could not connect to ${base}. Showing the built-in catalog instead. (${cause instanceof Error ? cause.message : 'Check host'})`);
    } finally {
      setLoading(false);
    }
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    load(apiBase);
  }, [apiBase, load]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const filtered = useMemo(() => {
    return pairs.filter(p => {
      const searchTarget = `${p.locality} ${p.before_date} ${p.after_date} ${p.source || ''} ${p.before_id} ${p.after_id}`.toLowerCase();
      const matchesQuery = !query || searchTarget.includes(query.toLowerCase());
      if (!matchesQuery) return false;
      if (filterMode === 'high_priority') {
        return p.dossier?.review_priority === 'high' || (p.after_cue?.above_threshold ?? false);
      }
      if (filterMode === 'floodwater') {
        return (waterFor(p.after_id)?.percentile ?? 0) >= 70;
      }
      if (filterMode === 'reviewed') {
        return !!p.review;
      }
      return true;
    });
  }, [pairs, query, filterMode]);

  function connect() {
    const base = apiInput.trim().replace(/\/$/, '');
    if (!base) {
      setApiBase('');
      setError('');
      router.navigate('/explore');
      return;
    }
    if (!/^https?:\/\//i.test(base)) {
      setError('Enter an address starting with http:// or https://');
      return;
    }
    setApiBase(base);
    load(base);
    router.navigate('/explore');
  }

  const currentPair = pairs[selected] || filtered[0] || bundledPairs[0];

  const submitReview = useCallback(async (agreement: string, notes: string = '') => {
    if (!currentPair) return;
    const reviewData: HumanReview = {
      before_id: currentPair.before_id,
      after_id: currentPair.after_id,
      agreement,
      notes,
      reviewer: 'field_analyst',
      timestamp: new Date().toISOString(),
    };

    // Update local state immediately
    setPairs(prev =>
      prev.map(p =>
        p.before_id === currentPair.before_id && p.after_id === currentPair.after_id
          ? { ...p, review: reviewData }
          : p
      )
    );

    // If connected to server, persist to reviews.jsonl
    if (apiBase) {
      try {
        await fetch(`${apiBase}/api/review`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(reviewData),
        });
      } catch (err) {
        console.warn('Could not save review to server:', err);
      }
    }
  }, [currentPair, apiBase]);

  return (
    <DataContext.Provider
      value={{
        apiInput,
        setApiInput,
        apiBase,
        setApiBase,
        pairs,
        selected,
        setSelected,
        phase,
        setPhase,
        compareMode,
        setCompareMode,
        query,
        setQuery,
        filterMode,
        setFilterMode,
        loading,
        error,
        filtered,
        connect,
        submitReview,
        currentPair: currentPair as Pair,
      }}
    >
      {children}
    </DataContext.Provider>
  );
}

// -------------------------------------------------------------------------
// Interactive Split / Curtain Comparison Component
// -------------------------------------------------------------------------
function SplitCompareViewer({
  beforeUrl,
  afterUrl,
  locality,
}: {
  beforeUrl: string;
  afterUrl: string;
  locality: string;
}) {
  const containerWidth = Dimensions.get('window').width - 40;
  const [splitPos, setSplitPos] = useState(containerWidth / 2);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderMove: (_, gestureState) => {
          const newPos = Math.max(20, Math.min(containerWidth - 20, gestureState.moveX - 20));
          setSplitPos(newPos);
        },
      }),
    [containerWidth]
  );

  return (
    <View
      style={[s.splitFrame, { width: containerWidth }]}
      accessibilityRole="adjustable"
      accessibilityLabel={`Interactive split comparison for ${locality}. Drag handle horizontally to reveal before and after aerial views.`}
      accessibilityValue={{
        min: 0,
        max: 100,
        now: Math.round((splitPos / containerWidth) * 100),
      }}
    >
      {/* Background: After Image (Full width) */}
      <Image source={{ uri: afterUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />

      {/* Foreground: Before Image (Clipped by split position) */}
      <View style={[s.splitClip, { width: splitPos }]}>
        <Image
          source={{ uri: beforeUrl }}
          style={[s.splitInnerImage, { width: containerWidth }]}
          resizeMode="cover"
        />
      </View>

      {/* Split Divider & Handle */}
      <View
        style={[s.splitLine, { left: splitPos }]}
        {...panResponder.panHandlers}
        accessibilityElementsHidden
      >
        <View style={s.splitHandle}>
          <Text style={s.splitHandleText}>‹ ›</Text>
        </View>
      </View>

      {/* Badges for orientation */}
      <View style={s.splitBadgeLeft} pointerEvents="none">
        <Text style={s.splitBadgeText}>BEFORE</Text>
      </View>
      <View style={s.splitBadgeRight} pointerEvents="none">
        <Text style={s.splitBadgeText}>AFTER</Text>
      </View>
    </View>
  );
}

// -------------------------------------------------------------------------
// Main App Screen (All tabs with high-contrast ByteRight aesthetic)
// -------------------------------------------------------------------------
export function AppScreen({ tab }: { tab: Tab }) {
  const {
    apiInput,
    setApiInput,
    apiBase,
    setApiBase,
    pairs,
    selected,
    setSelected,
    phase,
    setPhase,
    compareMode,
    setCompareMode,
    query,
    setQuery,
    filterMode,
    setFilterMode,
    loading,
    error,
    filtered,
    connect,
    submitReview,
    currentPair,
  } = useAppData();

  const pair = currentPair || pairs[selected] || bundledPairs[0];
  const beforeImg = url(apiBase, pair?.before_url || '');
  const afterImg = url(apiBase, pair?.after_url || '');
  const displayedImage = phase === 'before' ? beforeImg : afterImg;

  // Page the list 30 at a time; a new search or filter starts from the top
  const PAGE = 30;
  const listKey = `${query}|${filterMode}`;
  const [visible, setVisible] = useState({ key: listKey, n: PAGE });
  const visibleCount = visible.key === listKey ? visible.n : PAGE;

  const setTab = (target: Tab) => {
    router.navigate(
      ({
        Rise: '/',
        Explore: '/explore',
        Compare: '/compare',
        Settings: '/settings',
      } as const)[target]
    );
  };

  return (
    <SafeAreaView style={s.app} edges={['top']}>
      <StatusBar style="dark" />

      {/* Top Brand Bar */}
      <View style={s.topbar}>
        <View style={s.brandGroup}>
          <View style={s.mark}>
            <View style={s.markLine} />
            <View style={s.markLineShort} />
          </View>
          <View>
            <Text style={s.brand}>Flood Time Machine</Text>
            <Text style={s.brandSub}>Texas Historical Flood Evidence</Text>
          </View>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Connection settings"
          onPress={() => setTab('Settings')}
          style={s.statusPill}
        >
          <View style={[s.statusDot, { backgroundColor: apiBase ? '#15803D' : '#D97706' }]} />
          <Text style={s.statusText}>{apiBase ? 'Live catalog' : `${bundledPairs.length} pairs`}</Text>
        </Pressable>
      </View>

      {tab === 'Rise' && <RiseScreen apiBase={apiBase} />}

      {/* ---------------------------------------------------------------- */}
      {/* EXPLORE TAB */}
      {/* ---------------------------------------------------------------- */}
      {tab === 'Explore' && (
        <ScrollView style={s.screen} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
          <View style={s.headerBlock}>
            <Text style={s.eyebrow}>DATASET CATALOG</Text>
            <Text style={s.heading} accessibilityRole="header">
              Explore Paired Views
            </Text>
            <Text style={s.subheading}>
              Select a location to compare reciprocal aerial views captured before and after major events.
            </Text>
          </View>

          {/* Featured Selected Location Card */}
          {pair && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open comparison for ${pair.locality}`}
              onPress={() => setTab('Compare')}
              style={({ pressed }) => [s.featureCard, pressed && s.pressed]}
            >
              <View style={s.featureHeader}>
                <View style={s.badge}>
                  <Text style={s.badgeText}>SELECTED LOCATION</Text>
                </View>
                <Text style={s.featureMeta}>
                  {pair.source || 'Aerial'} · Pair #{pair.index + 1}
                </Text>
              </View>
              <Text style={s.featureTitle}>{pair.locality}</Text>
              <View style={s.dateRangeRow}>
                <Text style={s.dateText}>Pre: {pair.before_date}</Text>
                <Text style={s.dateArrow}>→</Text>
                <Text style={[s.dateText, { fontWeight: '700' }]}>Post: {pair.after_date}</Text>
              </View>

              {/* Side-by-side preview thumbs */}
              <View style={s.previewThumbRow}>
                <View style={s.previewThumbCol}>
                  <Image source={{ uri: beforeImg }} style={s.thumbPreview} />
                  <Text style={s.thumbLabel}>Before Flood</Text>
                </View>
                <View style={s.previewThumbCol}>
                  <Image source={{ uri: afterImg }} style={s.thumbPreview} />
                  <Text style={s.thumbLabel}>After Flood</Text>
                </View>
              </View>

              <View style={s.featureFooter}>
                <Text style={s.actionLink}>Open Time Machine Comparison →</Text>
              </View>
            </Pressable>
          )}

          {/* Labelling entry point */}
          <Pressable
            accessibilityRole="button"
            accessibilityHint="Opens a screen to mark photos as flooded or not"
            onPress={() => router.push('/label')}
            style={({ pressed }) => [s.labelCta, pressed && s.pressed]}
          >
            <View style={{ flex: 1 }}>
              <Text style={s.labelCtaTitle}>Label photos</Text>
              <Text style={s.labelCtaSub}>Mark 150 photos as flooded or not, to train and score the flood model.</Text>
            </View>
            <Text style={s.chevron}>›</Text>
          </Pressable>

          {/* Search & Filter Bar */}
          <View style={s.searchSection}>
            <TextInput
              style={s.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Search by city, bayou, or date (e.g. Houston, 2017)"
              placeholderTextColor={C.muted}
              accessibilityLabel="Search catalog by locality or date"
              returnKeyType="search"
              clearButtonMode="while-editing"
            />

            {/* Filter Chips */}
            <View style={s.filterRow} accessibilityRole="radiogroup" accessibilityLabel="Filter catalog">
              {(
                [
                  { key: 'all', label: `All Pairs (${pairs.length})` },
                  { key: 'high_priority', label: 'Flagged Evidence' },
                  { key: 'floodwater', label: 'Most floodwater' },
                  { key: 'reviewed', label: 'Human Reviewed' },
                ] as const
              ).map(item => (
                <Pressable
                  key={item.key}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: filterMode === item.key }}
                  onPress={() => setFilterMode(item.key)}
                  style={[s.filterChip, filterMode === item.key && s.filterChipActive]}
                >
                  <Text style={[s.filterChipText, filterMode === item.key && s.filterChipTextActive]}>
                    {item.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {loading && (
            <View style={s.loadingBox}>
              <ActivityIndicator color={C.green} size="small" />
              <Text style={s.metaText}>Loading catalog imagery...</Text>
            </View>
          )}

          {error ? (
            <View style={s.noticeCard}>
              <Text style={s.noticeTitle}>Connection Notice</Text>
              <Text style={s.noticeBody}>{error}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => setTab('Settings')}
                style={s.buttonSecondary}
              >
                <Text style={s.buttonSecondaryText}>Check Connection Settings</Text>
              </Pressable>
            </View>
          ) : null}

          {/* Pair List */}
          <View style={s.listContainer}>
            <Text style={s.listCountHeader}>
              {filtered.length} {filtered.length === 1 ? 'pair' : 'pairs'}
            </Text>
            {filtered.slice(0, visibleCount).map(item => {
              const isCurrent = item.before_id === pair?.before_id && item.after_id === pair?.after_id;
              const hasHighCue = item.after_cue?.above_threshold;
              const isReviewed = !!item.review;

              return (
                <Pressable
                  key={`${item.before_id}-${item.after_id}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.locality}, pre-event ${item.before_date}, post-event ${item.after_date}`}
                  accessibilityHint="Select this pair to inspect in Compare view"
                  onPress={() => {
                    const originalIdx = pairs.indexOf(item);
                    setSelected(originalIdx >= 0 ? originalIdx : 0);
                    setTab('Compare');
                  }}
                  style={({ pressed }) => [
                    s.listRow,
                    isCurrent && s.listRowSelected,
                    pressed && s.pressed,
                  ]}
                >
                  <Image source={{ uri: url(apiBase, item.after_url) }} style={s.rowThumb} />
                  <View style={s.rowDetails}>
                    <View style={s.rowTitleLine}>
                      <Text style={s.rowTitle} numberOfLines={1}>
                        {item.locality}
                      </Text>
                    </View>
                    <Text style={s.rowDates}>
                      {item.before_date} → {item.after_date}
                    </Text>
                    <View style={s.tagRow}>
                      <Text style={s.rowSourceTag}>{item.source || 'NAIP/NOAA'}</Text>
                      {hasHighCue && (
                        <View style={s.cueAlertPill}>
                          <Text style={s.cueAlertText}>Flood Cue Flag</Text>
                        </View>
                      )}
                      {(waterFor(item.after_id)?.percentile ?? 0) >= 70 && (
                        <Text style={s.rowSourceTag}>Floodwater</Text>
                      )}
                      {isReviewed && (
                        <View style={s.reviewedPill}>
                          <Text style={s.reviewedText}>Reviewed</Text>
                        </View>
                      )}
                    </View>
                  </View>
                  <Text style={s.chevron} accessibilityElementsHidden>
                    ›
                  </Text>
                </Pressable>
              );
            })}
            {filtered.length > visibleCount && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Show more pairs. ${filtered.length - visibleCount} more`}
                onPress={() => setVisible({ key: listKey, n: visibleCount + PAGE })}
                style={s.buttonSecondary}
              >
                <Text style={s.buttonSecondaryText}>
                  Show more ({filtered.length - visibleCount} left)
                </Text>
              </Pressable>
            )}
          </View>
        </ScrollView>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* COMPARE TAB (Core Time Machine Experience) */}
      {/* ---------------------------------------------------------------- */}
      {tab === 'Compare' && (
        <ScrollView style={s.screen} contentContainerStyle={s.content}>
          <View style={s.headerBlock}>
            <View style={s.locationTag}>
              <Text style={s.locationTagText}>PAIR #{pair.index + 1}</Text>
            </View>
            <Text style={s.heading} accessibilityRole="header">
              {pair.locality}
            </Text>
            <Text style={s.subheading}>
              Inspect visible ground and hydrological change across reciprocal aerial surveys.
            </Text>
          </View>

          {/* Mode Switcher: Split Wipe | A/B Toggle | Side by Side */}
          <View style={s.modeSelector} accessibilityRole="radiogroup" accessibilityLabel="Comparison view mode">
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ selected: compareMode === 'split' }}
              onPress={() => setCompareMode('split')}
              style={[s.modeOption, compareMode === 'split' && s.modeOptionActive]}
            >
              <Text style={[s.modeOptionText, compareMode === 'split' && s.modeOptionTextActive]}>
                Split Curtain
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ selected: compareMode === 'toggle' }}
              onPress={() => setCompareMode('toggle')}
              style={[s.modeOption, compareMode === 'toggle' && s.modeOptionActive]}
            >
              <Text style={[s.modeOptionText, compareMode === 'toggle' && s.modeOptionTextActive]}>
                A/B Blink
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ selected: compareMode === 'sideBySide' }}
              onPress={() => setCompareMode('sideBySide')}
              style={[s.modeOption, compareMode === 'sideBySide' && s.modeOptionActive]}
            >
              <Text style={[s.modeOptionText, compareMode === 'sideBySide' && s.modeOptionTextActive]}>
                Side-by-Side
              </Text>
            </Pressable>
          </View>

          {/* Comparison View Area */}
          {compareMode === 'split' && (
            <View style={s.viewerContainer}>
              <SplitCompareViewer beforeUrl={beforeImg} afterUrl={afterImg} locality={pair.locality} />
              <Text style={s.helperCaption}>
                Drag the vertical divider left or right to reveal before vs after.
              </Text>
            </View>
          )}

          {compareMode === 'toggle' && (
            <View style={s.viewerContainer}>
              <View style={s.toggleControlsRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Show pre-flood image"
                  accessibilityState={{ selected: phase === 'before' }}
                  onPress={() => setPhase('before')}
                  style={[s.phaseBtn, phase === 'before' && s.phaseBtnActive]}
                >
                  <Text style={[s.phaseBtnText, phase === 'before' && s.phaseBtnTextActive]}>
                    Pre: {pair.before_date}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Show post-flood image"
                  accessibilityState={{ selected: phase === 'after' }}
                  onPress={() => setPhase('after')}
                  style={[s.phaseBtn, phase === 'after' && s.phaseBtnActive]}
                >
                  <Text style={[s.phaseBtnText, phase === 'after' && s.phaseBtnTextActive]}>
                    Post: {pair.after_date}
                  </Text>
                </Pressable>
              </View>

              <Pressable
                accessibilityRole="image"
                accessibilityLabel={`Viewing ${phase} flood aerial imagery for ${pair.locality}. Tap to toggle.`}
                accessibilityHint="Tap image to quickly toggle between before and after"
                onPress={() => setPhase(phase === 'before' ? 'after' : 'before')}
                style={s.singleImageFrame}
              >
                <Image source={{ uri: displayedImage }} style={s.fullImage} resizeMode="cover" />
                <View style={s.phaseBadgeFloating}>
                  <Text style={s.phaseBadgeFloatingText}>
                    {phase === 'before' ? `BEFORE · ${pair.before_date}` : `AFTER · ${pair.after_date}`}
                  </Text>
                </View>
              </Pressable>
              <Text style={s.helperCaption}>
                Tap the image or buttons above to rapid-blink between dates.
              </Text>
            </View>
          )}

          {compareMode === 'sideBySide' && (
            <View style={s.viewerContainer}>
              <View style={s.sideBySideStack}>
                <View style={s.sideItem}>
                  <View style={s.sideHeader}>
                    <Text style={s.sideTitle}>BEFORE ({pair.before_date})</Text>
                    <Text style={s.sideSource}>{pair.source || 'NAIP'}</Text>
                  </View>
                  <Image source={{ uri: beforeImg }} style={s.sideImage} resizeMode="cover" />
                </View>
                <View style={s.sideItem}>
                  <View style={s.sideHeader}>
                    <Text style={s.sideTitle}>AFTER ({pair.after_date})</Text>
                    <Text style={s.sideSource}>NOAA Post-Event</Text>
                  </View>
                  <Image source={{ uri: afterImg }} style={s.sideImage} resizeMode="cover" />
                </View>
              </View>
            </View>
          )}

          <ChangeCard afterId={pair.after_id} afterUrl={afterImg} />

          {/* ------------------------------------------------------------ */}
          {/* EVIDENCE SECTION: Visual Cue vs Vision VLM Dossier */}
          {/* ------------------------------------------------------------ */}
          <View style={s.evidenceContainer}>
            <Text style={s.sectionHeader}>Evidence & Model Observations</Text>

            {/* Model 1: FloodNet Visual Cue Detector */}
            <View style={s.card}>
              <View style={s.cardHeader}>
                <View style={s.cardTag}>
                  <Text style={s.cardTagText}>DETECTOR MODEL</Text>
                </View>
                <Text style={s.cardTitle}>FloodNet Visual Cue</Text>
              </View>
              <Text style={s.cardDescription}>
                Lightweight MobileNetV3 cue trained on FloodNet UAV flooded road/structure annotations.
              </Text>

              <View style={s.cueCompareRow}>
                <View style={s.cueBox}>
                  <Text style={s.cueBoxLabel}>Pre-Event Cue</Text>
                  <Text style={s.cueBoxScore}>
                    {pair.before_cue ? `${Math.round(pair.before_cue.cue_score * 100)}%` : '—'}
                  </Text>
                  <Text style={s.cueBoxStatus}>
                    {pair.before_cue
                      ? pair.before_cue.above_threshold
                        ? 'Flagged'
                        : 'Baseline'
                      : 'Not computed'}
                  </Text>
                </View>
                <View style={s.cueDivider} />
                <View style={s.cueBox}>
                  <Text style={s.cueBoxLabel}>Post-Event Cue</Text>
                  <Text style={[s.cueBoxScore, { color: C.green }]}>
                    {pair.after_cue ? `${Math.round(pair.after_cue.cue_score * 100)}%` : '—'}
                  </Text>
                  <Text
                    style={[
                      s.cueBoxStatus,
                      pair.after_cue?.above_threshold && { color: '#B91C1C', fontWeight: '700' },
                    ]}
                  >
                    {pair.after_cue
                      ? pair.after_cue.above_threshold
                        ? 'Elevated Cue'
                        : 'Below Cutoff'
                      : 'Not computed'}
                  </Text>
                </View>
              </View>

              <Text style={s.modelDisclaimer}>
                Note: Evaluated on UAV imagery. Visual cue only; not calibrated water depth or safe routing.
              </Text>
            </View>

            {/* Model 2: Multimodal VLM Change Dossier */}
            <View style={s.card}>
              <View style={s.cardHeader}>
                <View style={[s.cardTag, { backgroundColor: '#E0E7FF' }]}>
                  <Text style={[s.cardTagText, { color: '#3730A3' }]}>VISION DOSSIER</Text>
                </View>
                <Text style={s.cardTitle}>VLM Visual Comparison</Text>
              </View>

              {pair.dossier ? (
                <View style={s.dossierContent}>
                  <View style={s.dossierSummaryBox}>
                    <Text style={s.dossierSummaryText}>{pair.dossier.summary}</Text>
                  </View>

                  <View style={s.waterStatusRow}>
                    <View style={s.waterStatusItem}>
                      <Text style={s.waterStatusLabel}>Water in Image 1:</Text>
                      <Text style={s.waterStatusValue}>{pair.dossier.visible_water_before}</Text>
                    </View>
                    <View style={s.waterStatusItem}>
                      <Text style={s.waterStatusLabel}>Water in Image 2:</Text>
                      <Text style={[s.waterStatusValue, { fontWeight: '700', color: C.green }]}>
                        {pair.dossier.visible_water_after}
                      </Text>
                    </View>
                    <View style={s.waterStatusItem}>
                      <Text style={s.waterStatusLabel}>Review Priority:</Text>
                      <Text style={[s.waterStatusValue, { textTransform: 'uppercase' }]}>
                        {pair.dossier.review_priority}
                      </Text>
                    </View>
                  </View>

                  {pair.dossier.evidence?.length > 0 && (
                    <View style={s.dossierListSection}>
                      <Text style={s.dossierSubhead}>Visible Evidence:</Text>
                      {pair.dossier.evidence.map((point, idx) => (
                        <Text key={idx} style={s.bulletPoint}>
                          • {point}
                        </Text>
                      ))}
                    </View>
                  )}

                  {pair.dossier.limitations?.length > 0 && (
                    <View style={s.dossierListSection}>
                      <Text style={s.dossierSubhead}>Limitations & Uncertainties:</Text>
                      {pair.dossier.limitations.map((lim, idx) => (
                        <Text key={idx} style={[s.bulletPoint, { color: C.muted }]}>
                          • {lim}
                        </Text>
                      ))}
                    </View>
                  )}
                </View>
              ) : (
                <View style={s.noDossierBox}>
                  <Text style={s.noDossierText}>
                    Direct image inspection mode: No automated VLM dossier cached for this pair. Review the before/after views directly.
                  </Text>
                </View>
              )}
            </View>

            {/* Human-in-the-Loop Review Box */}
            <View style={s.reviewCard}>
              <Text style={s.reviewCardTitle}>Human Reviewer Verification</Text>
              <Text style={s.reviewCardBody}>
                {pair.review
                  ? `Current verification: "${pair.review.agreement}" (Logged ${pair.review.timestamp?.slice(0, 10)})`
                  : 'Does this pair show clear evidence of ground inundation or road submersion?'}
              </Text>

              <View style={s.reviewActionsRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Confirm visible inundation"
                  onPress={() => submitReview('confirmed_inundation', 'Visible standing water over surfaces')}
                  style={[s.reviewBtn, pair.review?.agreement === 'confirmed_inundation' && s.reviewBtnActive]}
                >
                  <Text
                    style={[
                      s.reviewBtnText,
                      pair.review?.agreement === 'confirmed_inundation' && s.reviewBtnTextActive,
                    ]}
                  >
                    Confirm Inundation
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Mark as no flood or minimal change"
                  onPress={() => submitReview('no_significant_flood', 'Surfaces appear passable/dry')}
                  style={[s.reviewBtn, pair.review?.agreement === 'no_significant_flood' && s.reviewBtnActive]}
                >
                  <Text
                    style={[
                      s.reviewBtnText,
                      pair.review?.agreement === 'no_significant_flood' && s.reviewBtnTextActive,
                    ]}
                  >
                    No Evident Flood
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Mark as uncertain or obscured"
                  onPress={() => submitReview('uncertain_or_shadow', 'Obscured by shadow or resolution')}
                  style={[s.reviewBtn, pair.review?.agreement === 'uncertain_or_shadow' && s.reviewBtnActive]}
                >
                  <Text
                    style={[
                      s.reviewBtnText,
                      pair.review?.agreement === 'uncertain_or_shadow' && s.reviewBtnTextActive,
                    ]}
                  >
                    Uncertain / Shadow
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        </ScrollView>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* SETTINGS TAB */}
      {/* ---------------------------------------------------------------- */}
      {tab === 'Settings' && (
        <ScrollView style={s.screen} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
          <View style={s.headerBlock}>
            <Text style={s.eyebrow}>DATASET CONNECTION</Text>
            <Text style={s.heading} accessibilityRole="header">
              Backend Configuration
            </Text>
            <Text style={s.subheading}>
              Connect this app to your local machine or datathon host running `mobile_server.py`.
            </Text>
          </View>

          <View style={s.card}>
            <Text style={s.fieldLabel}>Service API Address</Text>
            <TextInput
              style={s.textInput}
              value={apiInput}
              onChangeText={setApiInput}
              placeholder="http://192.168.1.50:8765"
              placeholderTextColor={C.muted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              accessibilityLabel="Enter dataset backend URL"
            />
            <Text style={s.fieldHelp}>
              Enter your computer&apos;s LAN IP (printed in the terminal when starting mobile_server.py). Leave blank to use the built-in catalog of all 575 pairs.
            </Text>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Connect to server"
              onPress={connect}
              style={s.buttonPrimary}
            >
              <Text style={s.buttonPrimaryText}>Save & Connect</Text>
            </Pressable>

            {apiBase ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Disconnect and use the built-in catalog"
                onPress={() => {
                  setApiInput('');
                  setApiBase('');
                  router.navigate('/explore');
                }}
                style={[s.buttonSecondary, { marginTop: 10 }]}
              >
                <Text style={s.buttonSecondaryText}>Disconnect (use built-in catalog)</Text>
              </Pressable>
            ) : null}
          </View>

          {/* System Diagnostics & Datathon Info */}
          <View style={s.card}>
            <Text style={s.cardTitle}>System & Model Diagnostics</Text>
            <View style={s.diagRow}>
              <Text style={s.diagLabel}>Dataset Repository:</Text>
              <Text style={s.diagValue}>UTSA Flood Images (1,204 images / 575 pairs)</Text>
            </View>
            <View style={s.diagRow}>
              <Text style={s.diagLabel}>Detector Cue Model:</Text>
              <Text style={s.diagValue}>MobileNetV3 (FloodNet Supervised)</Text>
            </View>
            <View style={s.diagRow}>
              <Text style={s.diagLabel}>Multimodal VLM:</Text>
              <Text style={s.diagValue}>Qwen3-VL 2B (Local Ollama Engine)</Text>
            </View>
            <View style={s.diagRow}>
              <Text style={s.diagLabel}>Host Environment:</Text>
              <Text style={s.diagValue}>Expo SDK 58 / React Native 0.88</Text>
            </View>
          </View>

          {/* Safety Notice */}
          <View style={s.noticeCard}>
            <Text style={s.noticeTitle}>Ethical & Safety Notice</Text>
            <Text style={s.noticeBody}>
              The UTSA metadata contains unverified flood labels. Automated model outputs and the flood simulation are designed as research aids for human image analysts. Never treat historical imagery or model cues as real-time flood warnings, depth measurements, or evacuation guidance.
            </Text>
          </View>
        </ScrollView>
      )}

    </SafeAreaView>
  );
}

// -------------------------------------------------------------------------
// Bottom tab bar, rendered once by the Tabs layout so it never re-animates
// -------------------------------------------------------------------------
const TAB_LABELS: Record<string, string> = { index: 'Rise', explore: 'Explore', compare: 'Compare', settings: 'Settings' };

export function AppTabBar({ state, navigateToTab, insets }: BottomTabBarProps) {
  // Full-screen tasks (like labelling) hide the tab bar
  if (!(state.routes[state.index]?.name in TAB_LABELS)) return null;
  return (
    <View style={[s.nav, { paddingBottom: Math.max(insets.bottom, 6) }]} accessibilityRole="tablist">
      {state.routes.map((route, i) => {
        if (!(route.name in TAB_LABELS)) return null; // e.g. the label screen
        const isActive = state.index === i;
        const label = TAB_LABELS[route.name] ?? route.name;
        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityLabel={label}
            accessibilityState={{ selected: isActive }}
            onPress={() => {
              if (!isActive) navigateToTab(route.key);
            }}
            style={[s.navItem, isActive && s.navItemActive]}
          >
            <Text style={[s.navText, isActive && s.navTextActive]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// -------------------------------------------------------------------------
// Styles (ByteRight restrained aesthetic: crisp lines, strong contrast, no gradients)
// -------------------------------------------------------------------------
const s = StyleSheet.create({
  app: { flex: 1, backgroundColor: C.bg },
  screen: { flex: 1 },
  content: { padding: 18, paddingBottom: 36, gap: 16 },

  // Top Bar
  topbar: {
    minHeight: 52,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    backgroundColor: C.white,
  },
  brandGroup: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  mark: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: C.green,
    justifyContent: 'center',
    paddingHorizontal: 6,
    gap: 4,
  },
  markLine: { height: 2.5, width: 16, borderRadius: 1, backgroundColor: C.white },
  markLineShort: { height: 2.5, width: 10, borderRadius: 1, backgroundColor: C.white },
  brand: { fontSize: 16, fontWeight: '700', color: C.ink, letterSpacing: -0.3 },
  brandSub: { fontSize: 11, color: C.muted },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.bg,
  },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { fontSize: 12, fontWeight: '600', color: C.inkSecondary },

  // Headers
  headerBlock: { gap: 4, marginTop: 4, marginBottom: 2 },
  eyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, color: C.green },
  heading: { fontSize: 26, lineHeight: 32, fontWeight: '700', color: C.ink, letterSpacing: -0.5 },
  subheading: { fontSize: 14, lineHeight: 20, color: C.muted },

  // Featured Card
  featureCard: {
    borderWidth: 1,
    borderColor: C.borderStrong,
    borderRadius: 12,
    backgroundColor: C.white,
    padding: 16,
    gap: 10,
  },
  featureHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  badge: {
    backgroundColor: C.greenLight,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5, color: C.green },
  featureMeta: { fontSize: 12, color: C.muted },
  featureTitle: { fontSize: 20, fontWeight: '700', color: C.ink },
  dateRangeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dateText: { fontSize: 13, color: C.inkSecondary },
  dateArrow: { fontSize: 14, color: C.green, fontWeight: '700' },
  previewThumbRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  previewThumbCol: { flex: 1, gap: 4 },
  thumbPreview: { width: '100%', height: 110, borderRadius: 8, backgroundColor: C.border },
  thumbLabel: { fontSize: 11, color: C.muted, textAlign: 'center' },
  featureFooter: { borderTopWidth: 1, borderTopColor: C.border, paddingTop: 10, marginTop: 4 },
  actionLink: { fontSize: 14, fontWeight: '700', color: C.green },

  // Search & Filters
  searchSection: { gap: 10 },
  labelCta: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: C.borderStrong, borderRadius: 10, backgroundColor: C.white, padding: 14 },
  labelCtaTitle: { fontSize: 15, fontWeight: '700', color: C.ink },
  labelCtaSub: { fontSize: 13, color: C.muted, marginTop: 2 },
  searchInput: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: C.borderStrong,
    borderRadius: 8,
    paddingHorizontal: 14,
    fontSize: 15,
    color: C.ink,
    backgroundColor: C.white,
  },
  filterRow: { flexDirection: 'row', gap: 8 },
  filterChip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.white,
  },
  filterChipActive: { backgroundColor: C.green, borderColor: C.green },
  filterChipText: { fontSize: 12, fontWeight: '600', color: C.muted },
  filterChipTextActive: { color: C.white },

  // List View
  listContainer: { gap: 8 },
  listCountHeader: { fontSize: 13, fontWeight: '600', color: C.muted, marginBottom: 2 },
  listRow: {
    minHeight: 72,
    backgroundColor: C.white,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    gap: 12,
  },
  listRowSelected: { borderColor: C.green, borderWidth: 1.5, backgroundColor: C.greenLight },
  rowThumb: { width: 56, height: 56, borderRadius: 6, backgroundColor: C.border },
  rowDetails: { flex: 1, gap: 2 },
  rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowTitle: { fontSize: 15, fontWeight: '700', color: C.ink },
  rowDates: { fontSize: 12, color: C.muted },
  tagRow: { flexDirection: 'row', gap: 6, marginTop: 2 },
  rowSourceTag: { fontSize: 11, color: C.muted },
  cueAlertPill: {
    backgroundColor: C.amberLight,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: C.amberBorder,
  },
  cueAlertText: { fontSize: 10, fontWeight: '700', color: C.amber },
  reviewedPill: {
    backgroundColor: C.greenLight,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  reviewedText: { fontSize: 10, fontWeight: '700', color: C.green },
  chevron: { fontSize: 24, color: C.muted, paddingRight: 4 },
  footerNotice: { textAlign: 'center', fontSize: 12, color: C.muted, paddingVertical: 10 },

  // Compare Tab Styles
  locationTag: {
    alignSelf: 'flex-start',
    backgroundColor: C.greenLight,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  locationTagText: { fontSize: 11, fontWeight: '700', color: C.green },
  modeSelector: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: C.borderStrong,
    borderRadius: 8,
    padding: 3,
    backgroundColor: C.white,
  },
  modeOption: {
    flex: 1,
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
  },
  modeOptionActive: { backgroundColor: C.green },
  modeOptionText: { fontSize: 13, fontWeight: '600', color: C.muted },
  modeOptionTextActive: { color: C.white, fontWeight: '700' },
  viewerContainer: { gap: 8 },

  // Split Wipe Viewer
  splitFrame: {
    height: 320,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: C.dark,
    borderWidth: 1,
    borderColor: C.borderStrong,
  },
  splitClip: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    overflow: 'hidden',
  },
  splitInnerImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    height: 320,
  },
  splitLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: C.white,
    marginLeft: -1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  splitHandle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: C.white,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: C.ink,
  },
  splitHandleText: { fontSize: 14, fontWeight: '700', color: C.ink },
  splitBadgeLeft: {
    position: 'absolute',
    bottom: 10,
    left: 10,
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  splitBadgeRight: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  splitBadgeText: { fontSize: 11, fontWeight: '700', color: C.white, letterSpacing: 0.5 },
  helperCaption: { fontSize: 12, color: C.muted, textAlign: 'center' },

  // Toggle & Blink Viewer
  toggleControlsRow: { flexDirection: 'row', gap: 10 },
  phaseBtn: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderColor: C.borderStrong,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.white,
  },
  phaseBtnActive: { backgroundColor: C.green, borderColor: C.green },
  phaseBtnText: { fontSize: 13, fontWeight: '600', color: C.inkSecondary },
  phaseBtnTextActive: { color: C.white, fontWeight: '700' },
  singleImageFrame: {
    height: 320,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: C.dark,
    borderWidth: 1,
    borderColor: C.borderStrong,
  },
  fullImage: { width: '100%', height: '100%' },
  phaseBadgeFloating: {
    position: 'absolute',
    top: 12,
    left: 12,
    backgroundColor: 'rgba(17,24,21,0.85)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  phaseBadgeFloatingText: { color: C.white, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },

  // Side-by-Side View
  sideBySideStack: { gap: 12 },
  sideItem: {
    backgroundColor: C.white,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    overflow: 'hidden',
  },
  sideHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  sideTitle: { fontSize: 12, fontWeight: '700', color: C.ink },
  sideSource: { fontSize: 12, color: C.muted },
  sideImage: { width: '100%', height: 210, backgroundColor: C.dark },

  // Camera Banner CTA

  // Evidence Cards
  evidenceContainer: { gap: 14, marginTop: 4 },
  sectionHeader: { fontSize: 18, fontWeight: '700', color: C.ink, letterSpacing: -0.3 },
  card: {
    backgroundColor: C.white,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTag: {
    backgroundColor: C.greenLight,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 4,
  },
  cardTagText: { fontSize: 10, fontWeight: '700', color: C.green, letterSpacing: 0.5 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: C.ink },
  cardDescription: { fontSize: 13, lineHeight: 18, color: C.muted },

  // Cue Compare Row
  cueCompareRow: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    padding: 12,
    backgroundColor: C.bg,
  },
  cueBox: { flex: 1, alignItems: 'center', gap: 3 },
  cueDivider: { width: 1, backgroundColor: C.border },
  cueBoxLabel: { fontSize: 11, fontWeight: '600', color: C.muted },
  cueBoxScore: { fontSize: 22, fontWeight: '700', color: C.ink },
  cueBoxStatus: { fontSize: 12, fontWeight: '600', color: C.inkSecondary },
  modelDisclaimer: { fontSize: 11, lineHeight: 16, color: C.muted },

  // Vision Dossier
  dossierContent: { gap: 10 },
  dossierSummaryBox: {
    backgroundColor: C.bg,
    borderLeftWidth: 3,
    borderLeftColor: C.green,
    padding: 10,
    borderRadius: 4,
  },
  dossierSummaryText: { fontSize: 14, lineHeight: 20, color: C.ink, fontWeight: '500' },
  waterStatusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: C.border,
    paddingVertical: 8,
  },
  waterStatusItem: { gap: 2 },
  waterStatusLabel: { fontSize: 11, color: C.muted },
  waterStatusValue: { fontSize: 13, fontWeight: '600', color: C.ink },
  dossierListSection: { gap: 4 },
  dossierSubhead: { fontSize: 12, fontWeight: '700', color: C.inkSecondary },
  bulletPoint: { fontSize: 13, lineHeight: 19, color: C.ink },
  noDossierBox: { paddingVertical: 10 },
  noDossierText: { fontSize: 13, lineHeight: 19, color: C.muted },

  // Human Review Card
  reviewCard: {
    backgroundColor: C.white,
    borderWidth: 1,
    borderColor: C.borderStrong,
    borderRadius: 12,
    padding: 16,
    gap: 10,
  },
  reviewCardTitle: { fontSize: 15, fontWeight: '700', color: C.ink },
  reviewCardBody: { fontSize: 13, color: C.muted },
  reviewActionsRow: { flexDirection: 'row', gap: 6 },
  reviewBtn: {
    flex: 1,
    minHeight: 40,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: C.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    backgroundColor: C.bg,
  },
  reviewBtnActive: { backgroundColor: C.green, borderColor: C.green },
  reviewBtnText: { fontSize: 11, fontWeight: '600', color: C.inkSecondary, textAlign: 'center' },
  reviewBtnTextActive: { color: C.white, fontWeight: '700' },

  // Camera Tab


  // Settings
  fieldLabel: { fontSize: 13, fontWeight: '700', color: C.ink },
  textInput: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: C.borderStrong,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 14,
    color: C.ink,
    backgroundColor: C.white,
  },
  fieldHelp: { fontSize: 12, lineHeight: 17, color: C.muted },
  diagRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  diagLabel: { fontSize: 12, color: C.muted },
  diagValue: { fontSize: 12, fontWeight: '600', color: C.ink },

  // Notices
  noticeCard: {
    backgroundColor: C.white,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    padding: 14,
    gap: 8,
  },
  noticeTitle: { fontSize: 14, fontWeight: '700', color: C.ink },
  noticeBody: { fontSize: 12, lineHeight: 18, color: C.muted },

  // Buttons
  buttonPrimary: {
    minHeight: 48,
    backgroundColor: C.green,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  buttonPrimaryText: { color: C.white, fontSize: 14, fontWeight: '700' },
  buttonSecondary: {
    minHeight: 44,
    backgroundColor: C.white,
    borderWidth: 1,
    borderColor: C.borderStrong,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  buttonSecondaryText: { color: C.green, fontSize: 13, fontWeight: '700' },
  pressed: { opacity: 0.75 },

  // Navigation Bar
  nav: {
    minHeight: 60,
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: C.border,
    backgroundColor: C.white,
    paddingHorizontal: 8,
  },
  navItem: {
    flex: 1,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: 3,
    borderTopColor: 'transparent',
  },
  navItemActive: { borderTopColor: C.green },
  navText: { color: C.muted, fontSize: 12, fontWeight: '600' },
  navTextActive: { color: C.green, fontWeight: '700' },
  loadingBox: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 12 },
  metaText: { fontSize: 12, color: C.muted },
});
