import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { View } from 'react-native';
import { getSettings } from '../../db/repo';
import { useLive } from '../../db/live';
import { daysSince, timeAgo } from '../../lib/dates';
import { Card, Divider, Row, Screen, Section, Text } from '../../ui/kit';
import { useTheme } from '../../ui/theme';

function Icon({ name, tone }: { name: React.ComponentProps<typeof Ionicons>['name']; tone?: 'warn' }) {
  const { c } = useTheme();
  return (
    <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: tone === 'warn' ? c.warnSoft : c.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name={name} size={19} color={tone === 'warn' ? c.warn : c.accent} />
    </View>
  );
}

export default function MoreScreen() {
  const settings = useLive(getSettings);
  const s = settings.data;
  const stale = !s?.last_backup_at || daysSince(s.last_backup_at) > 7;

  return (
    <Screen title="More">
      <Section title="Reports">
        <Card padded={false}>
          <Row left={<Icon name="document-text-outline" />} title="Reports" subtitle="Attendance, fees and student-wise, as PDF or Excel" onPress={() => router.push('/reports')} />
        </Card>
      </Section>

      <Section title="Data">
        <Card padded={false}>
          <Row left={<Icon name="people-outline" />} title="Upload student data" subtitle="Add many students from a photo, PDF, Excel or other file" onPress={() => router.push('/import')} />
          <Divider inset={64} />
          <Row
            left={<Icon name="cloud-upload-outline" tone={stale ? 'warn' : undefined} />}
            title="Backup & restore"
            subtitle={s?.last_backup_at ? `Last backup ${timeAgo(s.last_backup_at)}${s.last_backup_where ? ` · ${s.last_backup_where}` : ''}` : 'Never backed up'}
            onPress={() => router.push('/backup')}
          />
          <Divider inset={64} />
          <Row left={<Icon name="settings-outline" />} title="Settings" subtitle="Your name, default fee, fee due day, sample data" onPress={() => router.push('/settings')} />
        </Card>
      </Section>

      <View style={{ alignItems: 'center', gap: 4, marginTop: 8 }}>
        <Text v="caption" tone="faint">TuitionBook {Constants.expoConfig?.version ?? ''}</Text>
        <Text v="caption" tone="faint">All data stays on this phone unless you back it up.</Text>
      </View>
    </Screen>
  );
}
