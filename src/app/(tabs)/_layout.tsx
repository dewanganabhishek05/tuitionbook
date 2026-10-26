import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router/js-tabs';
import { StyleSheet, type ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { cardShadow, font, useTheme } from '../../ui/theme';
import type { IconName } from '../../ui/kit';

function TabIcon({ on, off, color, focused }: { on: IconName; off: IconName; color: ColorValue; focused: boolean }) {
  return <Ionicons name={focused ? on : off} size={23} color={color} />;
}

export default function TabsLayout() {
  const { c, dark } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.accent,
        tabBarInactiveTintColor: c.faint,
        tabBarLabelStyle: { fontFamily: font.medium, fontSize: 11 },
        tabBarStyle: {
          backgroundColor: c.surface, borderTopColor: c.border, borderTopWidth: dark ? StyleSheet.hairlineWidth : 0,
          borderTopLeftRadius: 24, borderTopRightRadius: 24,
          height: 64 + Math.max(insets.bottom, 8), paddingTop: 6, paddingBottom: Math.max(insets.bottom, 8),
          ...cardShadow(c, dark), shadowOffset: { width: 0, height: -6 }, elevation: 12,
        },
        sceneStyle: { backgroundColor: c.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Today', tabBarIcon: (p) => <TabIcon on="home" off="home-outline" {...p} /> }} />
      <Tabs.Screen name="calendar" options={{ title: 'Calendar', tabBarIcon: (p) => <TabIcon on="calendar" off="calendar-outline" {...p} /> }} />
      <Tabs.Screen name="students" options={{ title: 'Students', tabBarIcon: (p) => <TabIcon on="people" off="people-outline" {...p} /> }} />
      <Tabs.Screen name="fees" options={{ title: 'Fees', tabBarIcon: (p) => <TabIcon on="wallet" off="wallet-outline" {...p} /> }} />
      <Tabs.Screen name="more" options={{ title: 'More', tabBarIcon: (p) => <TabIcon on="grid" off="grid-outline" {...p} /> }} />
    </Tabs>
  );
}
