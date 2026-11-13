import { useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export type Photo = { image_id: string; url: string; date: string; locality: string; source: string };

/** Full-screen photo viewer. Pinch to zoom on iOS; previous/next buttons on both platforms. */
export function PhotoViewer({
  photos,
  index,
  onIndex,
  onClose,
}: {
  photos: Photo[];
  index: number | null;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const open = index != null && index >= 0 && index < photos.length;
  const photo = open ? photos[index] : null;
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const go = (i: number) => {
    setLoading(true);
    setFailed(false);
    onIndex(i);
  };

  return (
    <Modal visible={open} animationType="fade" onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']}>
      <SafeAreaView style={st.root} edges={['top', 'bottom']}>
        {photo && (
          <View style={st.root} accessibilityViewIsModal>
            <View style={st.top}>
              <Text style={st.count}>
                {index! + 1} of {photos.length}
              </Text>
              <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close photo" style={st.close} hitSlop={8}>
                <Text style={st.closeText}>Close</Text>
              </Pressable>
            </View>

            <ScrollView
              style={st.zoom}
              contentContainerStyle={st.zoomContent}
              maximumZoomScale={4}
              minimumZoomScale={1}
              centerContent
              showsHorizontalScrollIndicator={false}
              showsVerticalScrollIndicator={false}
            >
              <Image
                key={photo.url}
                source={{ uri: photo.url }}
                style={st.image}
                resizeMode="contain"
                onLoadStart={() => {
                  setLoading(true);
                  setFailed(false);
                }}
                onLoadEnd={() => setLoading(false)}
                onError={() => {
                  setLoading(false);
                  setFailed(true);
                }}
                accessibilityLabel={`${photo.source} aerial photo of ${photo.locality}, taken ${photo.date}`}
              />
              {loading && !failed && <ActivityIndicator style={st.spinner} color="#FFFFFF" size="large" />}
              {failed && <Text style={st.error}>This photo could not load. Check your internet connection.</Text>}
            </ScrollView>

            <View style={st.bottom}>
              <Text style={st.title}>{photo.locality}</Text>
              <Text style={st.meta}>
                {photo.source} · {photo.date} · {photo.image_id}
              </Text>
              <View style={st.navRow}>
                <Pressable
                  onPress={() => go(index! - 1)}
                  disabled={index === 0}
                  accessibilityRole="button"
                  accessibilityLabel="Previous photo"
                  style={[st.navBtn, index === 0 && st.navDisabled]}
                >
                  <Text style={st.navText}>Previous</Text>
                </Pressable>
                <Pressable
                  onPress={() => go(index! + 1)}
                  disabled={index === photos.length - 1}
                  accessibilityRole="button"
                  accessibilityLabel="Next photo"
                  style={[st.navBtn, index === photos.length - 1 && st.navDisabled]}
                >
                  <Text style={st.navText}>Next</Text>
                </Pressable>
              </View>
            </View>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0C120F' },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8 },
  count: { color: '#B8C4BC', fontSize: 14, fontWeight: '600' },
  close: { minHeight: 44, minWidth: 72, alignItems: 'center', justifyContent: 'center', borderRadius: 8, borderWidth: 1, borderColor: '#3A4A41' },
  closeText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  zoom: { flex: 1 },
  zoomContent: { flexGrow: 1, justifyContent: 'center', alignItems: 'center' },
  image: { width: '100%', aspectRatio: 1 },
  spinner: { position: 'absolute' },
  error: { position: 'absolute', color: '#FFFFFF', fontSize: 14, textAlign: 'center', paddingHorizontal: 24 },
  bottom: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8, gap: 4 },
  title: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  meta: { color: '#B8C4BC', fontSize: 13 },
  navRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  navBtn: { flex: 1, minHeight: 48, borderRadius: 8, backgroundColor: '#1B4D34', alignItems: 'center', justifyContent: 'center' },
  navDisabled: { opacity: 0.35 },
  navText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
});
