import { Tabs } from 'expo-router/js-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider, AppTabBar } from '../components/AppScreen';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AppProvider>
        <Tabs
          tabBar={props => <AppTabBar {...props} />}
          screenOptions={{ headerShown: false, animation: 'fade', lazy: true }}
        >
          <Tabs.Screen name="index" />
          <Tabs.Screen name="explore" />
          <Tabs.Screen name="compare" />
          <Tabs.Screen name="settings" />
        </Tabs>
      </AppProvider>
    </SafeAreaProvider>
  );
}

export { ErrorBoundary } from '../components/CrashScreen';
