import React, { useMemo, useState } from 'react';
import { Alert, ScrollView, Share, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  canManageClub,
  clubRoleLabel,
  describeRecurrence,
  memberHistoryText,
  nextUnplannedDate,
  type ClubMemberRow,
} from '@ridentrack/shared';
import { useClub } from '../../src/hooks/useClubs';
import { useAuth } from '../../src/hooks/useAuth';
import { useRideTheme, radius, spacing, type RidePalette } from '../../src/theme';
import { Button, Icon, Skeleton } from '../../src/components/ui';
import { SeriesSheet } from '../../src/components/club/SeriesSheet';

const WEB_BASE = process.env.EXPO_PUBLIC_WEB_URL || 'https://ridentrack.app';

function shortDate(iso: string | null) {
  if (!iso) return 'Date to be set';
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** F15: one club. Visitors see what the club rides and can join; members see the roster and its history. */
export default function ClubScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useRideTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const { user } = useAuth();
  const club = useClub(slug);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seriesOpen, setSeriesOpen] = useState(false);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.'); } finally { setBusy(false); }
  };

  const today = new Date().toISOString().slice(0, 10);
  const view = club.view;
  const manage = canManageClub(view?.my_role);
  const upcoming = (view?.rides ?? []).filter(r => r.status !== 'completed' && r.status !== 'cancelled' && (!r.start_date || r.start_date >= today));
  const past = (view?.rides ?? []).filter(r => r.status === 'completed');

  const memberActions = (m: ClubMemberRow) => {
    if (!manage || m.user_id === user?.id) return;
    const owner = view?.my_role === 'owner';
    const buttons: Array<{ text: string; style?: 'destructive' | 'cancel'; onPress?: () => void }> = [];
    if (owner && m.role === 'member') buttons.push({ text: 'Make admin', onPress: () => void run(() => club.setRole(m.user_id, 'admin')) });
    if (owner && m.role === 'admin') buttons.push({ text: 'Make member', onPress: () => void run(() => club.setRole(m.user_id, 'member')) });
    if (owner && m.role !== 'owner') buttons.push({ text: 'Make owner', onPress: () => void run(() => club.setRole(m.user_id, 'owner')) });
    if (owner || m.role === 'member') buttons.push({ text: 'Remove from club', style: 'destructive', onPress: () => void run(() => club.setRole(m.user_id, 'removed')) });
    buttons.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert(m.display_name, memberHistoryText(m), buttons);
  };

  const invite = () => {
    if (!view) return;
    const link = `${WEB_BASE}/club/${view.club.slug}`;
    const codeLine = view.club.join_policy === 'code' && club.joinCode ? ` Join code: ${club.joinCode}.` : '';
    void Share.share({ message: `Ride with ${view.club.name} on RideNTrack: ${link}${codeLine}` });
  };

  return (
    <View style={[s.screen, { paddingTop: insets.top }]}>
      <View style={s.topBar}>
        <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))} style={s.iconBtn} accessibilityLabel="Back">
          <Icon name="chevron-back" size="md" color={theme.text} />
        </TouchableOpacity>
        {view && manage ? (
          <TouchableOpacity onPress={invite} style={s.iconBtn} accessibilityLabel="Invite riders to the club">
            <Icon name="person-add-outline" size="md" color={theme.text} />
          </TouchableOpacity>
        ) : <View style={s.iconBtn} />}
      </View>

      {club.state === 'loading' && (
        <View style={{ padding: spacing.screen, gap: spacing.md }}>
          <Skeleton width="70%" height={28} />
          <Skeleton width="40%" height={16} />
          <Skeleton width="100%" height={120} />
        </View>
      )}
      {(club.state === 'missing' || club.state === 'error') && (
        <View style={s.empty}>
          <Text style={s.h1}>{club.state === 'missing' ? 'Club not found' : 'Could not load the club'}</Text>
          <Text style={s.muted}>{club.state === 'missing' ? 'The link may be mistyped, or the club was closed.' : 'Check your connection and try again.'}</Text>
          {club.state === 'error' && <Button title="Try again" variant="outline" onPress={() => void club.refresh()} />}
        </View>
      )}

      {view && (
        <ScrollView contentContainerStyle={{ padding: spacing.screen, paddingBottom: insets.bottom + 40, gap: spacing.xl }}>
          <View style={{ gap: 6 }}>
            <Text style={s.kicker}>{[view.club.city?.toUpperCase(), `${view.member_count} RIDER${view.member_count === 1 ? '' : 'S'}`].filter(Boolean).join(' · ')}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Text style={s.h1}>{view.club.name}</Text>
              {view.club.verified && (
                <View style={s.verified} accessibilityLabel="Verified club">
                  <Icon name="checkmark-circle" size="sm" color={theme.green} />
                  <Text style={[s.verifiedText, { color: theme.green }]}>Verified</Text>
                </View>
              )}
            </View>
            {view.club.description ? <Text style={s.body}>{view.club.description}</Text> : null}
            {view.my_role ? <Text style={s.muted}>You are {view.my_role === 'member' ? 'a member' : `an ${clubRoleLabel(view.my_role).toLowerCase()}`}.</Text> : null}
          </View>

          {!view.my_role && (
            <View style={s.joinBox}>
              {view.club.join_policy === 'code' ? (
                <>
                  <Text style={s.body}>This club joins by code. Ask a club admin for it.</Text>
                  <TextInput
                    style={s.input}
                    value={code}
                    onChangeText={setCode}
                    placeholder="Join code"
                    placeholderTextColor={theme.subtle}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    maxLength={8}
                  />
                </>
              ) : null}
              <Button title={`Join ${view.club.name}`} loading={busy} disabled={view.club.join_policy === 'code' && code.trim().length < 6} onPress={() => void run(() => club.join(code))} />
            </View>
          )}
          {error ? <Text style={[s.body, { color: theme.danger }]}>{error}</Text> : null}

          <View style={{ gap: spacing.sm }}>
            <Text style={s.section}>Next rides</Text>
            {upcoming.length === 0 && <Text style={s.muted}>Nothing planned yet.{manage ? ' Plan one from a series below, or add a trip to the club from its trip screen.' : ''}</Text>}
            {upcoming.slice(0, 6).map(r => (
              <TouchableOpacity key={r.id} style={s.rideRow} onPress={() => view.my_role && router.push(`/trip/${r.id}`)} disabled={!view.my_role}>
                <View style={s.dateChip}><Text style={s.dateChipText}>{shortDate(r.start_date)}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={s.rowTitle} numberOfLines={1}>{r.name}</Text>
                  <Text style={s.muted}>{r.distance_km ? `${r.distance_km} km` : 'Route to be set'}{r.status === 'active' ? ' · Riding now' : ''}</Text>
                </View>
                {view.my_role ? <Icon name="chevron-forward" size="sm" color={theme.subtle} /> : null}
              </TouchableOpacity>
            ))}
          </View>

          {view.my_role && (
            <View style={{ gap: spacing.sm }}>
              <View style={s.sectionRow}>
                <Text style={s.section}>Regular rides</Text>
                {manage && <TouchableOpacity onPress={() => setSeriesOpen(true)}><Text style={s.link}>New series</Text></TouchableOpacity>}
              </View>
              {view.series.length === 0 && <Text style={s.muted}>{manage ? 'Set up a weekly or monthly ride once, then plan each date in one tap.' : 'No regular rides yet.'}</Text>}
              {view.series.map(series => {
                const next = nextUnplannedDate(series, today);
                return (
                  <View key={series.id} style={s.seriesCard}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={s.rowTitle}>{series.name}</Text>
                      <Text style={s.muted}>{describeRecurrence(series.recurrence_rule)}{series.planned_dates.length ? ` · ${series.planned_dates.length} planned` : ''}</Text>
                    </View>
                    {manage && next && series.template_ride_id && (
                      <Button
                        size="sm"
                        variant="outline"
                        title={`Plan ${shortDate(next)}`}
                        loading={busy}
                        onPress={() => void run(async () => {
                          const id = await club.scheduleNext(series.id, next);
                          if (id) router.push(`/trip/${id}`);
                        })}
                      />
                    )}
                  </View>
                );
              })}
            </View>
          )}

          {view.my_role && (
            <View style={{ gap: spacing.sm }}>
              <View style={s.sectionRow}>
                <Text style={s.section}>Roster</Text>
                {manage && club.joinCode && view.club.join_policy === 'code' ? <Text style={s.muted}>Join code {club.joinCode}</Text> : null}
              </View>
              {view.members.map(m => (
                <TouchableOpacity key={m.user_id} style={s.memberRow} onPress={() => memberActions(m)} disabled={!manage || m.user_id === user?.id}>
                  <View style={s.avatar}><Text style={s.avatarText}>{m.display_name.slice(0, 2).toUpperCase()}</Text></View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.rowTitle}>{m.display_name}{m.user_id === user?.id ? ' (you)' : ''}</Text>
                    <Text style={s.muted}>{memberHistoryText(m)}</Text>
                  </View>
                  {m.role !== 'member' && <Text style={s.role}>{clubRoleLabel(m.role).toUpperCase()}</Text>}
                </TouchableOpacity>
              ))}
            </View>
          )}

          {view.my_role && past.length > 0 && (
            <Text style={s.muted}>{past.length} ride{past.length === 1 ? '' : 's'} finished together · {past.reduce((n, r) => n + (r.distance_km || 0), 0).toLocaleString('en-IN')} km</Text>
          )}

          {view.my_role && (
            <TouchableOpacity
              onPress={() => Alert.alert(`Leave ${view.club.name}?`, 'Your past club rides stay in your history.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Leave', style: 'destructive', onPress: () => void run(() => club.leave()) },
              ])}
            >
              <Text style={[s.link, { color: theme.textMuted, textAlign: 'center' }]}>Leave club</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      )}

      {view && manage && (
        <SeriesSheet
          visible={seriesOpen}
          onClose={() => setSeriesOpen(false)}
          bottomInset={insets.bottom}
          rides={view.rides}
          onCreate={(name, rule, templateId) => club.createSeries(name, rule, templateId)}
        />
      )}
    </View>
  );
}

const makeStyles = (c: RidePalette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.background },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.sm, paddingTop: spacing.xs },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  empty: { padding: spacing.screen, gap: spacing.md },
  kicker: { color: c.accent, fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  h1: { color: c.text, fontSize: 28, fontWeight: '800', letterSpacing: -0.5, lineHeight: 34 },
  body: { color: c.text, fontSize: 15, lineHeight: 22 },
  muted: { color: c.textMuted, fontSize: 13, lineHeight: 19 },
  verified: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.sm, borderWidth: 1, borderColor: c.green },
  verifiedText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.4 },
  joinBox: { gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface },
  input: { minHeight: 48, borderRadius: radius.sm, borderWidth: 1, borderColor: c.border, paddingHorizontal: spacing.md, color: c.text, fontSize: 18, letterSpacing: 3, fontWeight: '700' },
  section: { color: c.text, fontSize: 13, fontWeight: '900', letterSpacing: 0.6, textTransform: 'uppercase' },
  sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  link: { color: c.accent, fontSize: 14, fontWeight: '700' },
  rideRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
  dateChip: { width: 76, paddingVertical: 6, borderRadius: radius.sm, backgroundColor: c.accentSoft, alignItems: 'center' },
  dateChipText: { color: c.text, fontSize: 12, fontWeight: '800', textAlign: 'center' },
  rowTitle: { color: c.text, fontSize: 15, fontWeight: '700' },
  seriesCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  avatar: { width: 40, height: 40, borderRadius: radius.round, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: c.text, fontSize: 13, fontWeight: '800' },
  role: { color: c.accent, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
});
