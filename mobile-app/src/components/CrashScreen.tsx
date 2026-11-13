import type { ErrorBoundaryProps } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

/**
 * Shown instead of a red screen if a tab hits an unexpected error. Each route
 * re-exports this, so one broken tab doesn't take down the others.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <View style={st.root} accessibilityRole="alert">
      <Text style={st.title}>Something went wrong on this screen</Text>
      <Text style={st.body}>The other tabs still work. Try again, and if it keeps happening, restart the app.</Text>
      <Text style={st.detail} numberOfLines={4}>
        {error?.message}
      </Text>
      <Pressable onPress={retry} accessibilityRole="button" style={st.button}>
        <Text style={st.buttonText}>Try again</Text>
      </Pressable>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8FAF6', padding: 24, justifyContent: 'center', gap: 12 },
  title: { fontSize: 20, fontWeight: '700', color: '#111815' },
  body: { fontSize: 15, lineHeight: 22, color: '#314238' },
  detail: { fontSize: 12, color: '#526357', fontFamily: 'Courier' },
  button: { minHeight: 48, borderRadius: 10, backgroundColor: '#1B4D34', alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  buttonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});
