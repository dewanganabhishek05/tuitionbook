import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router/js-tabs';
import { StyleSheet, type ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { font, useTheme } from '../../ui/theme';
import type { IconName } from '../../ui/kit';

function TabIcon({ on, off, color, focused }: { on: IconName; off: IconName; color: ColorValue; focused: boolean }) {
  return <Ionicons name={focused ? on : off} size={23} color={color} />;
}

export default function TabsLayout() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.text,
        tabBarInactiveTintColor: c.faint,
        tabBarLabelStyle: { fontFamily: font.medium, fontSize: 11 },
        tabBarStyle: {
          backgroundColor: c.bg, borderTopColor: c.border, borderTopWidth: StyleSheet.hairlineWidth,
          height: 64 + Math.max(insets.bottom, 8), paddingTop: 6, paddingBottom: Math.max(insets.bottom, 8), elevation: 0,
        },
        sceneStyle: { backgroundColor: c.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Today', tabBarIcon: (p) => <TabIcon on="today" off="today-outline" {...p} /> }} />
      <Tabs.Screen name="students" options={{ title: 'Students', tabBarIcon: (p) => <TabIcon on="people" off="people-outline" {...p} /> }} />
      <Tabs.Screen name="fees" options={{ title: 'Fees', tabBarIcon: (p) => <TabIcon on="wallet" off="wallet-outline" {...p} /> }} />
      <Tabs.Screen name="more" options={{ title: 'More', tabBarIcon: (p) => <TabIcon on="grid" off="grid-outline" {...p} /> }} />
    </Tabs>
  );
}
