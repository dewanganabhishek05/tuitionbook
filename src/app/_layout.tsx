import {
  Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, useFonts,
} from '@expo-google-fonts/inter';
import { Stack } from 'expo-router';
import { SQLiteProvider, type SQLiteDatabase } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ensureDues } from '../db/repo';
import { DB_NAME, migrate } from '../db/schema';
import { useTheme } from '../ui/theme';

async function init(db: SQLiteDatabase) {
  await migrate(db);
  await ensureDues(db); // roll this month's fees in on every launch
}

export default function RootLayout() {
  const { c, dark } = useTheme();
  const [fontsLoaded] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold });

  useEffect(() => {
    SystemUI.setBackgroundColorAsync(c.bg).catch(() => {});
  }, [c.bg]);

  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={c.muted} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <SQLiteProvider databaseName={DB_NAME} onInit={init} useSuspense={false}>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg }, animation: 'slide_from_right' }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="payment/[dueId]" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        </Stack>
      </SQLiteProvider>
    </SafeAreaProvider>
  );
}
