import {
  Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, useFonts,
} from '@expo-google-fonts/inter';
import { Stack } from 'expo-router';
import { SQLiteProvider, type SQLiteDatabase } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ensureDues } from '../db/repo';
import { DB_NAME, migrate } from '../db/schema';
import { AnimatedSplash } from '../ui/AnimatedSplash';
import { useTheme } from '../ui/theme';

// Keep the (plain white) native splash up until the animated one is on screen.
SplashScreen.preventAutoHideAsync().catch(() => {});

// The animated logo plays on every cold start of the phone app. In the browser it only plays with ?splash.
const SHOW_SPLASH = Platform.OS !== 'web' || (typeof location !== 'undefined' && location.search.includes('splash'));

async function init(db: SQLiteDatabase) {
  await migrate(db);
  await ensureDues(db); // roll this month's fees in on every launch
}

export default function RootLayout() {
  const { c, dark } = useTheme();
  const [fontsLoaded] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold });
  const [splashDone, setSplashDone] = useState(!SHOW_SPLASH);

  useEffect(() => {
    SystemUI.setBackgroundColorAsync(c.bg).catch(() => {});
  }, [c.bg]);

  useEffect(() => {
    if (!SHOW_SPLASH) SplashScreen.hideAsync().catch(() => {});
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      {fontsLoaded ? (
        <SafeAreaProvider>
          <StatusBar style={dark && splashDone ? 'light' : 'dark'} />
          <SQLiteProvider databaseName={DB_NAME} onInit={init} useSuspense={false}>
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg }, animation: 'slide_from_right' }}>
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="payment/[dueId]" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
            </Stack>
          </SQLiteProvider>
        </SafeAreaProvider>
      ) : null}
      {splashDone ? null : (
        <AnimatedSplash onShown={() => SplashScreen.hideAsync().catch(() => {})} onDone={() => setSplashDone(true)} />
      )}
    </View>
  );
}
