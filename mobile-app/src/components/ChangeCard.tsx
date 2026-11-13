import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import raw from '../data/changeScores.json';

type ChangeEntry = { score: number; percentile: number; rank: number; grid: string };
type ChangeData = {
  model: { trained: boolean; pairs?: number; contrast?: number; contrast_naive?: number; quick?: boolean };
  pairs: Record<string, ChangeEntry>;
};
const data = raw as unknown as ChangeData;

export function changeFor(afterId: string): ChangeEntry | undefined {
  return data.pairs[afterId];
}

// 0-9 heat levels; restrained single hue, transparent at low change
const heat = (v: number) => (v < 3 ? 'transparent' : `rgba(220, 38, 38, ${Math.min(0.75, 0.12 + v * 0.07)})`);

export function ChangeCard({ afterId, afterUrl }: { afterId: string; afterUrl: string }) {
  const [show, setShow] = useState(true);
  const entry = changeFor(afterId);

  if (!data.model.trained) {
    return (
      <View style={st.card}>
        <Text style={st.title}>Photo change model</Text>
        <Text style={st.body}>Not trained yet. Run Part A of ml/Train_Models_Colab.ipynb, then pull.</Text>
      </View>
    );
  }
  if (!entry) return null;

  const n = Math.round(Math.sqrt(entry.grid.length));
  const level = entry.percentile >= 90 ? 'Among the most changed locations' : entry.percentile >= 60 ? 'More change than most' : 'Little unexplained change';

  return (
    <View style={st.card}>
      <Text style={st.title}>Photo change model</Text>
      <Text style={st.big} accessibilityLabel={`Rank ${entry.rank} of ${data.model.pairs}. ${level}.`}>
        #{entry.rank} of {data.model.pairs}
      </Text>
      <Text style={st.body}>
        {level}. Red areas are changes the model could not explain as a camera difference between 2016 and 2017, such as
        standing water or debris.
      </Text>
      <Pressable
        onPress={() => setShow(v => !v)}
        accessibilityRole="button"
        accessibilityLabel={show ? 'Hide change heatmap' : 'Show change heatmap'}
        style={st.frame}
      >
        <Image source={{ uri: afterUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        {show && (
          <View style={st.grid} pointerEvents="none">
            {Array.from({ length: n }).map((_, r) => (
              <View key={r} style={st.row}>
                {Array.from({ length: n }).map((__, c) => (
                  <View key={c} style={[st.cell, { backgroundColor: heat(Number(entry.grid[r * n + c])) }]} />
                ))}
              </View>
            ))}
          </View>
        )}
      </Pressable>
      <Text style={st.small}>
        Tap to {show ? 'hide' : 'show'} the heatmap. Self-supervised: trained on all 575 pairs without flood labels, and each
        pair is scored by a model that never saw that area.
      </Text>
    </View>
  );
}

const st = StyleSheet.create({
  card: { borderWidth: 1, borderColor: '#D8E2DC', borderRadius: 12, backgroundColor: '#FFFFFF', padding: 16, gap: 8 },
  title: { fontSize: 13, fontWeight: '700', color: '#1B4D34' },
  big: { fontSize: 22, fontWeight: '700', color: '#111815' },
  body: { fontSize: 14, lineHeight: 20, color: '#314238' },
  small: { fontSize: 12, lineHeight: 17, color: '#526357' },
  frame: { width: '100%', aspectRatio: 1, borderRadius: 8, overflow: 'hidden', backgroundColor: '#D8E2DC' },
  grid: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  row: { flex: 1, flexDirection: 'row' },
  cell: { flex: 1 },
});
