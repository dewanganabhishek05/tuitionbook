import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { listStudents } from '../../db/repo';
import { useLive } from '../../db/live';
import { rupees } from '../../lib/format';
import { Avatar, Badge, Button, Card, Chip, ChipRow, Divider, Empty, Fab, Loading, Row, Text } from '../../ui/kit';
import { font, radius, useTheme } from '../../ui/theme';

type Filter = { kind: 'all' } | { kind: 'pending' } | { kind: 'archived' };

export default function StudentsScreen() {
  const { c } = useTheme();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>({ kind: 'all' });
  const students = useLive(
    (d) => listStudents(d, {
      search,
      status: filter.kind === 'archived' ? 'archived' : 'active',
    }),
    [search, filter],
  );
  const rows = (students.data ?? []).filter((s) => filter.kind !== 'pending' || s.outstanding > 0);
  const is = (f: Filter) => JSON.stringify(f) === JSON.stringify(filter);

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12, gap: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <Text v="display">Students</Text>
          {students.data && <Text v="label" tone="muted" style={{ marginBottom: 6 }}>{rows.length} shown</Text>}
        </View>
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: 8, height: 46, borderRadius: radius.pill,
          backgroundColor: c.surface, paddingHorizontal: 16, borderWidth: 1, borderColor: c.border,
        }}>
          <Ionicons name="search" size={18} color={c.faint} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search name, phone or class"
            placeholderTextColor={c.faint}
            style={{ flex: 1, color: c.text, fontFamily: font.regular, fontSize: 15, height: '100%' }}
          />
          {search ? <Ionicons name="close-circle" size={18} color={c.faint} onPress={() => setSearch('')} /> : null}
        </View>
      </View>
      <View style={{ marginBottom: 12 }}>
        <ChipRow>
          <Chip label="All" selected={is({ kind: 'all' })} onPress={() => setFilter({ kind: 'all' })} />
          <Chip label="Fee pending" selected={is({ kind: 'pending' })} onPress={() => setFilter({ kind: 'pending' })} />
          <Chip label="Archived" selected={is({ kind: 'archived' })} onPress={() => setFilter({ kind: 'archived' })} />
        </ChipRow>
      </View>

      {students.loading ? <Loading /> : (
        <FlatList
          data={rows}
          keyExtractor={(s) => String(s.id)}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 110 }}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <Card>
              <Empty
                icon="people-outline"
                title={search || filter.kind !== 'all' ? 'No matches' : 'No students yet'}
                body={search || filter.kind !== 'all' ? 'Try a different search or filter.' : 'Add your first student to start tracking attendance and fees.'}
                action={!search && filter.kind === 'all'
                  ? <Button label="Add student" icon="add" onPress={() => router.push('/student/form')} />
                  : undefined}
              />
            </Card>
          }
          renderItem={({ item: s, index }) => {
            const first = index === 0;
            const last = index === rows.length - 1;
            return (
              <View style={{
                backgroundColor: c.surface, borderColor: c.border, borderLeftWidth: 1, borderRightWidth: 1,
                borderTopWidth: first ? 1 : 0, borderBottomWidth: last ? 1 : 0,
                borderTopLeftRadius: first ? 20 : 0, borderTopRightRadius: first ? 20 : 0,
                borderBottomLeftRadius: last ? 20 : 0, borderBottomRightRadius: last ? 20 : 0, overflow: 'hidden',
              }}>
                {!first && <Divider inset={68} />}
                <Row
                  left={<Avatar name={s.name} />}
                  title={s.name}
                  subtitle={s.class_name || s.parent_phone}
                  right={s.outstanding > 0
                    ? <Badge label={`${rupees(s.outstanding)} due`} tone="bad" />
                    : s.monthly_fee > 0 ? <Badge label="Paid" tone="good" icon="checkmark" /> : null}
                  chevron={false}
                  onPress={() => router.push({ pathname: '/student/[id]', params: { id: String(s.id) } })}
                />
              </View>
            );
          }}
        />
      )}
      <Fab label="Student" onPress={() => router.push('/student/form')} />
    </SafeAreaView>
  );
}
