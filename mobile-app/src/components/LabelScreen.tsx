import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { hash, loadLabeler, loadLabels, postLabel, saveLabeler, saveLabels, type FloodLabel, type LabelRecord } from '../lib/labels';
import { useAppData, type Pair } from './AppScreen';
import { waterFor } from './ChangeCard';

const TARGET = 150;

/**
 * Pick the same 150 pairs on every phone, spread across the floodwater index
 * (15 per tenth) so the labels cover likely-wet and likely-dry photos alike.
 */
function labelQueue(pairs: Pair[]): Pair[] {
  const bins: Pair[][] = Array.from({ length: 10 }, () => []);
  for (const p of pairs) {
    const pct = waterFor(p.after_id)?.percentile ?? 50;
    bins[Math.min(9, Math.floor(pct / 10))].push(p);
  }
  const picked: Pair[] = [];
  for (const b of bins) picked.push(...b.sort((a, c) => hash(a.after_id) - hash(c.after_id)).slice(0, TARGET / 10));
  return picked.sort((a, c) => hash(a.after_id + 'q') - hash(c.after_id + 'q'));
}

export function LabelScreen() {
  const { pairs, apiBase } = useAppData();
  const queue = useMemo(() => labelQueue(pairs), [pairs]);
  const [labels, setLabels] = useState<Record<string, LabelRecord>>({});
  const [labeler, setLabeler] = useState('');
  const [nameDraft, setNameDraft] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [showBefore, setShowBefore] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [synced, setSynced] = useState<number>(0);

  useEffect(() => {
    Promise.all([loadLabels(), loadLabeler()]).then(([l, n]) => {
      setLabels(l);
      setLabeler(n);
      setNameDraft(n);
      setLoaded(true);
    });
  }, []);

  const done = queue.filter(p => labels[p.after_id]).length;
  const current = queue.find(p => !labels[p.after_id]);
  const counts = Object.values(labels).reduce(
    (acc, r) => ({ ...acc, [r.label]: (acc[r.label] ?? 0) + 1 }),
    {} as Record<FloodLabel, number>
  );

  function mark(label: FloodLabel) {
    if (!current) return;
    const rec: LabelRecord = {
      after_id: current.after_id,
      before_id: current.before_id,
      label,
      labeler,
      at: new Date().toISOString(),
    };
    const next = { ...labels, [current.after_id]: rec };
    setLabels(next);
    setHistory(h => [...h, current.after_id]);
    setShowBefore(false);
    saveLabels(next);
    Haptics.selectionAsync().catch(() => {});
    postLabel(apiBase, rec).then(ok => ok && setSynced(n => n + 1));
  }

  function undo() {
    const last = history[history.length - 1];
    if (!last) return;
    const next = { ...labels };
    delete next[last];
    setLabels(next);
    setHistory(h => h.slice(0, -1));
    saveLabels(next);
  }

  async function exportLabels() {
    const rows = Object.values(labels);
    await Share.share({
      title: 'Flood labels',
      message: JSON.stringify({ format: 'flood-labels-v1', count: rows.length, labels: rows }),
    }).catch(() => {});
  }

  if (!loaded) {
    return (
      <SafeAreaView style={st.root}>
        <ActivityIndicator style={{ marginTop: 40 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={st.root} edges={['top', 'bottom']}>
      <View style={st.top}>
        <Pressable onPress={() => router.navigate('/explore')} accessibilityRole="button" style={st.topBtn} hitSlop={8}>
          <Text style={st.topBtnText}>Done</Text>
        </Pressable>
        <Text style={st.progress} accessibilityLiveRegion="polite">
          {done} of {queue.length} labelled
        </Text>
        <Pressable onPress={undo} disabled={!history.length} accessibilityRole="button" style={[st.topBtn, !history.length && st.dim]} hitSlop={8}>
          <Text style={st.topBtnText}>Undo</Text>
        </Pressable>
      </View>
      <View style={st.bar}>
        <View style={[st.barFill, { width: `${(100 * done) / Math.max(1, queue.length)}%` }]} />
      </View>

      {!labeler ? (
        <View style={st.intro}>
          <Text style={st.h1}>Label flood photos</Text>
          <Text style={st.body}>
            You will see post-Harvey aerial photos. For each one, answer: is there visible floodwater? Brown or grey water
            over fields, streets or yards counts. A normal river, pond or pool does not. If you can’t tell, choose Unsure.
          </Text>
          <Text style={st.body}>Your labels train a model to find flooded photos and give it an accuracy score.</Text>
          <Text style={st.label}>Your initials</Text>
          <TextInput
            value={nameDraft}
            onChangeText={setNameDraft}
            placeholder="e.g. JP"
            autoCapitalize="characters"
            maxLength={8}
            style={st.input}
            accessibilityLabel="Your initials"
          />
          <Pressable
            onPress={() => {
              const n = nameDraft.trim();
              if (!n) return;
              setLabeler(n);
              saveLabeler(n);
            }}
            accessibilityRole="button"
            style={[st.primary, !nameDraft.trim() && st.dim]}
          >
            <Text style={st.primaryText}>Start labelling</Text>
          </Pressable>
        </View>
      ) : current ? (
        <>
          <Pressable
            onPressIn={() => setShowBefore(true)}
            onPressOut={() => setShowBefore(false)}
            accessibilityRole="image"
            accessibilityLabel={`${showBefore ? 'Before' : 'After'} photo of ${current.locality}`}
            accessibilityHint="Press and hold to see the photo from before the flood"
            style={st.photoWrap}
          >
            <Image
              key={showBefore ? current.before_url : current.after_url}
              source={{ uri: showBefore ? current.before_url : current.after_url }}
              style={st.photo}
              resizeMode="cover"
            />
            <View style={st.photoTag}>
              <Text style={st.photoTagText}>{showBefore ? `Before · ${current.before_date}` : `After · ${current.after_date}`}</Text>
            </View>
          </Pressable>
          <Text style={st.hint}>
            {current.locality} · press and hold the photo to compare with before
          </Text>
          <Text style={st.question}>Is there visible floodwater?</Text>
          <View style={st.answers}>
            <Pressable onPress={() => mark('flooded')} accessibilityRole="button" style={[st.answer, st.answerWet]}>
              <Text style={st.answerText}>Flooded</Text>
            </Pressable>
            <Pressable onPress={() => mark('dry')} accessibilityRole="button" style={[st.answer, st.answerDry]}>
              <Text style={st.answerText}>Not flooded</Text>
            </Pressable>
          </View>
          <Pressable onPress={() => mark('unsure')} accessibilityRole="button" style={st.unsure}>
            <Text style={st.unsureText}>Unsure</Text>
          </Pressable>
        </>
      ) : (
        <View style={st.intro}>
          <Text style={st.h1}>All {queue.length} photos labelled</Text>
          <Text style={st.body}>
            Flooded {counts.flooded ?? 0} · Not flooded {counts.dry ?? 0} · Unsure {counts.unsure ?? 0}
          </Text>
          <Text style={st.body}>
            {apiBase
              ? `${synced} sent to the server this session. They are saved in reviews/flood_labels.jsonl.`
              : 'Not connected to the server. Export the labels and send them to whoever runs the training.'}
          </Text>
        </View>
      )}

      {labeler ? (
        <View style={st.footer}>
          <Text style={st.footerText}>
            Labelling as {labeler} · {apiBase ? `${synced} synced` : 'saved on this phone'}
          </Text>
          <Pressable onPress={exportLabels} accessibilityRole="button" hitSlop={8}>
            <Text style={st.link}>Export</Text>
          </Pressable>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8FAF6' },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 6 },
  topBtn: { minHeight: 44, minWidth: 60, alignItems: 'center', justifyContent: 'center' },
  topBtnText: { fontSize: 16, fontWeight: '600', color: '#1B4D34' },
  progress: { fontSize: 15, fontWeight: '600', color: '#111815', fontVariant: ['tabular-nums'] },
  bar: { height: 4, backgroundColor: '#D8E2DC', marginHorizontal: 16, borderRadius: 2, overflow: 'hidden' },
  barFill: { height: 4, backgroundColor: '#1B4D34' },
  dim: { opacity: 0.4 },
  intro: { padding: 20, gap: 12 },
  h1: { fontSize: 24, fontWeight: '700', color: '#111815' },
  body: { fontSize: 15, lineHeight: 22, color: '#314238' },
  label: { fontSize: 13, fontWeight: '600', color: '#314238', marginTop: 6 },
  input: { minHeight: 48, borderWidth: 1, borderColor: '#B0C2B6', borderRadius: 8, paddingHorizontal: 12, fontSize: 17, backgroundColor: '#FFFFFF' },
  primary: { minHeight: 52, borderRadius: 10, backgroundColor: '#1B4D34', alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  photoWrap: { marginHorizontal: 16, marginTop: 12, aspectRatio: 1, borderRadius: 12, overflow: 'hidden', backgroundColor: '#D8E2DC' },
  photo: { width: '100%', height: '100%' },
  photoTag: { position: 'absolute', left: 10, top: 10, backgroundColor: 'rgba(17,24,21,0.75)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  photoTagText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  hint: { fontSize: 12, color: '#526357', textAlign: 'center', marginTop: 8, paddingHorizontal: 16 },
  question: { fontSize: 18, fontWeight: '700', color: '#111815', textAlign: 'center', marginTop: 14 },
  answers: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, marginTop: 12 },
  answer: { flex: 1, minHeight: 60, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  answerWet: { backgroundColor: '#7C3A0E' },
  answerDry: { backgroundColor: '#1B4D34' },
  answerText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  unsure: { alignSelf: 'center', minHeight: 44, paddingHorizontal: 24, justifyContent: 'center', marginTop: 6 },
  unsureText: { fontSize: 15, fontWeight: '600', color: '#526357' },
  footer: { marginTop: 'auto', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#D8E2DC' },
  footerText: { fontSize: 12, color: '#526357' },
  link: { fontSize: 15, fontWeight: '600', color: '#1B4D34' },
});
