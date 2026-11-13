import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

export type Photo = { image_id: string; url: string; date: string; locality: string; source: string };

type Props = {
  photos: Photo[];
  index: number | null;
  onIndex: (i: number) => void;
  onClose: () => void;
};

/**
 * Full-screen photo viewer. Swipe left/right between photos; pinch to zoom on iOS.
 * The modal gets its own SafeAreaProvider so the close button clears the notch
 * and status bar (insets from the app's provider don't reach inside a Modal).
 */
export function PhotoViewer(props: Props) {
  const open = props.index != null && props.index >= 0 && props.index < props.photos.length;
  return (
    <Modal
      visible={open}
      animationType="fade"
      onRequestClose={props.onClose}
      statusBarTranslucent
      supportedOrientations={['portrait', 'landscape']}
    >
      <SafeAreaProvider>{open && <ViewerBody {...props} index={props.index as number} />}</SafeAreaProvider>
    </Modal>
  );
}

function ViewerBody({ photos, index, onIndex, onClose }: Props & { index: number }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const photo = photos[index];

  const onSwipeEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / Math.max(1, width));
    if (i !== index && i >= 0 && i < photos.length) onIndex(i);
  };

  return (
    <View style={st.root} accessibilityViewIsModal>
      <FlatList
        data={photos}
        keyExtractor={p => p.image_id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        initialScrollIndex={index}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        onMomentumScrollEnd={onSwipeEnd}
        renderItem={({ item }) => <Page photo={item} width={width} />}
        accessibilityLabel="Photos. Swipe left or right to change photo."
      />

      {/* Close button sits below the status bar / notch */}
      <View style={[st.top, { paddingTop: insets.top + 8, paddingLeft: insets.left + 16, paddingRight: insets.right + 16 }]} pointerEvents="box-none">
        <Text style={st.count}>
          {index + 1} of {photos.length}
        </Text>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close photo" style={st.close} hitSlop={12}>
          <Text style={st.closeText}>✕</Text>
        </Pressable>
      </View>

      <View style={[st.bottom, { paddingBottom: insets.bottom + 12, paddingLeft: insets.left + 16, paddingRight: insets.right + 16 }]} pointerEvents="none">
        <Text style={st.title}>{photo.locality}</Text>
        <Text style={st.meta}>
          {photo.source} · {photo.date} · {photo.image_id}
        </Text>
        {photos.length > 1 && (
          <View style={st.dots}>
            {photos.map((p, i) => (
              <View key={p.image_id} style={[st.dot, i === index && st.dotActive]} />
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

function Page({ photo, width }: { photo: Photo; width: number }) {
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  return (
    <ScrollView
      style={{ width }}
      contentContainerStyle={st.page}
      maximumZoomScale={4}
      minimumZoomScale={1}
      centerContent
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}
    >
      <Image
        source={{ uri: photo.url }}
        style={{ width, height: width }}
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
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0C120F' },
  page: { flexGrow: 1, justifyContent: 'center', alignItems: 'center' },
  top: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  count: { color: '#D3DCD6', fontSize: 14, fontWeight: '600' },
  close: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: { color: '#FFFFFF', fontSize: 20, fontWeight: '600' },
  spinner: { position: 'absolute' },
  error: { position: 'absolute', color: '#FFFFFF', fontSize: 14, textAlign: 'center', paddingHorizontal: 24 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, gap: 4, paddingTop: 12, backgroundColor: 'rgba(12,18,15,0.82)' },
  title: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  meta: { color: '#B8C4BC', fontSize: 13 },
  dots: { flexDirection: 'row', gap: 6, marginTop: 8 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.3)' },
  dotActive: { backgroundColor: '#FFFFFF' },
});
