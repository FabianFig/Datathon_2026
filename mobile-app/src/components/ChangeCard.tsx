import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import changeRaw from '../data/changeScores.json';
import floodRaw from '../data/floodScores.json';
import waterRaw from '../data/waterScores.json';

type Entry = { score: number; percentile: number; rank: number; grid: string };
type Scores = { model: { trained?: boolean; pairs?: number; name?: string }; pairs: Record<string, Entry> };
const change = changeRaw as unknown as Scores;
const water = waterRaw as unknown as Scores;

/** Self-supervised change detector (trained on Colab). */
export function changeFor(afterId: string): Entry | undefined {
  return change.pairs[afterId];
}

type Flood = {
  model: { trained: boolean; labels?: number; cv_auc?: number };
  pairs: Record<string, { prob: number; rank: number }>;
};
const flood = floodRaw as unknown as Flood;

/** Classifier trained on the team's labels (ml/train_flood_classifier.py), once available. */
export function floodFor(afterId: string) {
  return flood.model.trained ? flood.pairs[afterId] : undefined;
}

/** Rule-based floodwater colour index (ml/water_color_index.py). */
export function waterFor(afterId: string): Entry | undefined {
  return water.pairs[afterId];
}

type Layer = 'water' | 'change';

const LAYERS: Record<Layer, { label: string; color: string; about: string }> = {
  water: {
    label: 'Floodwater',
    color: '146, 64, 14', // brown-amber
    about:
      'Shaded areas turned muddy-brown between 2016 and 2017, or lost vegetation to brown water. A colour rule, checked by eye on 48 random photos: it ranked flooded photos above dry ones 80% of the time. Grey or dark water can be missed.',
  },
  change: {
    label: 'Any change',
    color: '220, 38, 38', // red
    about:
      'Areas the self-supervised model could not explain as a camera difference: buildings, cleared land, water or debris. Change alone does not show flooding.',
  },
};

const shade = (rgb: string, v: number) => (v < 2 ? 'transparent' : `rgba(${rgb}, ${Math.min(0.72, 0.12 + v * 0.07)})`);

export function ChangeCard({ afterId, afterUrl }: { afterId: string; afterUrl: string }) {
  const available: Layer[] = (['water', 'change'] as Layer[]).filter(l => (l === 'water' ? waterFor(afterId) : changeFor(afterId)));
  const [layer, setLayer] = useState<Layer>('water');
  const [show, setShow] = useState(true);
  const active: Layer | undefined = available.includes(layer) ? layer : available[0];
  if (!active) return null;

  const entry = (active === 'water' ? waterFor(afterId) : changeFor(afterId)) as Entry;
  const total = (active === 'water' ? water : change).model.pairs ?? 575;
  const n = Math.round(Math.sqrt(entry.grid.length));
  const meta = LAYERS[active];
  const verdict =
    active === 'water'
      ? entry.percentile >= 70
        ? 'Lots of new floodwater colour'
        : entry.percentile >= 35
          ? 'Some new floodwater colour'
          : 'Little new floodwater colour'
      : entry.percentile >= 90
        ? 'Among the most changed locations'
        : entry.percentile >= 60
          ? 'More change than most'
          : 'Little unexplained change';

  return (
    <View style={st.card}>
      <View style={st.headRow}>
        <Text style={st.title}>Heatmap</Text>
        {available.length > 1 && (
          <View style={st.segment} accessibilityRole="radiogroup">
            {available.map(l => (
              <Pressable
                key={l}
                onPress={() => setLayer(l)}
                accessibilityRole="radio"
                accessibilityState={{ checked: active === l }}
                style={[st.seg, active === l && st.segActive]}
              >
                <Text style={[st.segText, active === l && st.segTextActive]}>{LAYERS[l].label}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>
      {floodFor(afterId) && (
        <Text style={st.classifier}>
          Flood classifier: {Math.round((floodFor(afterId)?.prob ?? 0) * 100)}% likely flooded
          <Text style={st.bigSub}>
            {'  '}(trained on {flood.model.labels} team labels, AUC {flood.model.cv_auc})
          </Text>
        </Text>
      )}
      <Text style={st.big} accessibilityLabel={`Rank ${entry.rank} of ${total}. ${verdict}.`}>
        #{entry.rank} <Text style={st.bigSub}>of {total} · {verdict}</Text>
      </Text>
      <Pressable
        onPress={() => setShow(v => !v)}
        accessibilityRole="button"
        accessibilityLabel={show ? 'Hide heatmap' : 'Show heatmap'}
        style={st.frame}
      >
        <Image source={{ uri: afterUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        {show && (
          <View style={st.grid} pointerEvents="none">
            {Array.from({ length: n }).map((_, r) => (
              <View key={r} style={st.row}>
                {Array.from({ length: n }).map((__, c) => (
                  <View key={c} style={[st.cell, { backgroundColor: shade(meta.color, Number(entry.grid[r * n + c])) }]} />
                ))}
              </View>
            ))}
          </View>
        )}
      </Pressable>
      <Text style={st.small}>{meta.about} Tap the photo to {show ? 'hide' : 'show'} the shading.</Text>
    </View>
  );
}

const st = StyleSheet.create({
  card: { borderWidth: 1, borderColor: '#D8E2DC', borderRadius: 12, backgroundColor: '#FFFFFF', padding: 16, gap: 10 },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { fontSize: 13, fontWeight: '700', color: '#1B4D34' },
  segment: { flexDirection: 'row', borderWidth: 1, borderColor: '#B0C2B6', borderRadius: 8, overflow: 'hidden' },
  seg: { minHeight: 36, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  segActive: { backgroundColor: '#1B4D34' },
  segText: { fontSize: 13, fontWeight: '600', color: '#111815' },
  segTextActive: { color: '#FFFFFF' },
  big: { fontSize: 22, fontWeight: '700', color: '#111815' },
  classifier: { fontSize: 15, fontWeight: '700', color: '#7C3A0E' },
  bigSub: { fontSize: 14, fontWeight: '500', color: '#526357' },
  small: { fontSize: 12, lineHeight: 17, color: '#526357' },
  frame: { width: '100%', aspectRatio: 1, borderRadius: 8, overflow: 'hidden', backgroundColor: '#D8E2DC' },
  grid: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  row: { flex: 1, flexDirection: 'row' },
  cell: { flex: 1 },
});
