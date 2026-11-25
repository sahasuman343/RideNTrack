import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
  ActivityIndicator,
  Platform,
  StatusBar,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../src/lib/supabase';
import { useRideTheme, RidePalette, radius, spacing } from '../../src/theme';
import { useAuth } from '../../src/hooks/useAuth';
import { Icon, LiveDot } from '../../src/components/ui';

export default function JoinRideScreen() {
  const params = useLocalSearchParams<{ code?: string; token?: string; rideId?: string }>();
  const [activeTab, setActiveTab] = useState<'qr' | 'code' | 'link'>('code');
  const [code, setCode] = useState(params.code ? params.code.toUpperCase() : '');
  const [token, setToken] = useState(params.token || '');
  const [loading, setLoading] = useState(false);
  const [errorState, setErrorState] = useState<{ title: string; message: string; code: string } | null>(null);

  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useRideTheme();
  const { profile } = useAuth();
  const s = useMemo(() => makeStyles(theme), [theme]);

  // Handle deep link params on cold-start
  useEffect(() => {
    if (params.code) {
      setCode(params.code.toUpperCase());
      setActiveTab('code');
    } else if (params.token) {
      setToken(params.token);
      setActiveTab('link');
    }
  }, [params.code, params.token]);

  async function handleJoinCode(customCode?: string) {
    const targetCode = (customCode || code).trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(targetCode)) {
      Alert.alert('Invalid code', 'Enter the 6-character ride code.');
      return;
    }
    setLoading(true);
    setErrorState(null);
    try {
      const { data, error } = await supabase.rpc('join_ride_by_code', { p_code: targetCode });
      if (error) throw error;
      if (!data) throw new Error('Expedition code not found or expired.');

      Alert.alert('Joined ride', 'You joined using the ride code.', [
        { text: 'Open trip', onPress: () => router.push(`/trip/${data}`) },
      ]);
      setCode('');
    } catch (err: any) {
      const errMsg = err?.message || 'Check the ride code and try again.';
      setErrorState({
        title: errMsg.toLowerCase().includes('expired') ? 'Code Expired' : 'That code didn’t work',
        message: errMsg.toLowerCase().includes('expired')
          ? 'This expedition code has expired. Please check with your ride leader for a new invite code.'
          : errMsg,
        code: targetCode,
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleAcceptInvitation() {
    const clean = token.trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean)) {
      Alert.alert('Invalid invitation', 'Paste the invitation token shared by the trip leader.');
      return;
    }
    setLoading(true);
    setErrorState(null);
    try {
      const { data, error } = await supabase.rpc('accept_trip_invitation', { p_token: clean });
      if (error) throw error;
      if (!data) throw new Error('This invitation has expired.');
      setToken('');
      Alert.alert('Invitation accepted', 'You are now a member of this group ride.', [
        { text: 'Open trip', onPress: () => router.push(`/trip/${data}`) },
      ]);
    } catch (error: any) {
      Alert.alert('Could not accept invitation', error.message || 'The invitation may be expired or intended for another email.');
    } finally {
      setLoading(false);
    }
  }

  const topInset = Math.max(insets.top, Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0);
  const safeHeaderTop = Math.max(topInset, Platform.OS === 'android' ? 48 : 44) + 18;

  return (
    <View style={s.screen}>
      {/* Top Header Bar */}
      <View style={[s.topHeader, { paddingTop: safeHeaderTop }]}>
        <TouchableOpacity
          style={s.headerIconButton}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Cancel or Go Back"
        >
          <Icon name="close" size="lg" color={theme.text} />
        </TouchableOpacity>

        <Text style={s.headerTitle} numberOfLines={1}>JOIN A RIDE</Text>

        <View style={s.headerRight}>
          <TouchableOpacity
            style={s.headerIconButton}
            onPress={() => Alert.alert('Ride Pairing', 'Scan your pack leader’s expedition QR code or enter their 6-digit passcode to synchronize radar tracking.')}
            accessibilityRole="button"
            accessibilityLabel="Ride Pairing Help"
          >
            <Icon name="help-circle-outline" size="lg" color={theme.textMuted} />
          </TouchableOpacity>
          <View style={s.riderAvatarMini}>
            <Text style={s.riderAvatarText}>{profile?.display_name ? profile.display_name.charAt(0).toUpperCase() : 'R'}</Text>
          </View>
        </View>
      </View>

      <ScrollView
        style={s.scrollView}
        contentContainerStyle={[s.scrollContent, { paddingBottom: Math.max(insets.bottom + 100, 120) }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Error Diagnostic State Card if code lookup fails */}
        {errorState ? (
          <View style={s.errorContainer}>
            <View style={s.errorCard}>
              <View style={s.errorIconBadge}>
                <Icon name="time-outline" size="xl" color={theme.danger} />
              </View>
              <View style={s.errorPill}>
                <LiveDot color={theme.danger} size={6} />
                <Text style={s.errorPillText}>{errorState.title.toUpperCase()}</Text>
              </View>
              <Text style={s.errorTitle}>{errorState.title}</Text>
              <Text style={s.errorDescription}>{errorState.message}</Text>
            </View>

            {/* Tactile Error Code Cells */}
            <View style={s.errorCellsContainer}>
              <View style={s.errorCellsHeader}>
                <Text style={s.errorCellsLabel}>ENTERED EXPEDITION CODE</Text>
                <TouchableOpacity
                  onPress={() => {
                    setErrorState(null);
                    setCode('');
                  }}
                >
                  <View style={s.clearCodeRow}>
                    <Icon name="backspace-outline" size="sm" color={theme.accent} />
                    <Text style={s.clearCodeAction}>Clear and re-enter</Text>
                  </View>
                </TouchableOpacity>
              </View>
              <View style={s.codeCellsRow}>
                {Array.from({ length: 6 }).map((_, i) => (
                  <View key={i} style={[s.codeCell, s.codeCellError]}>
                    <Text style={[s.codeCellText, s.codeCellTextError]}>
                      {errorState.code[i] || '•'}
                    </Text>
                  </View>
                ))}
              </View>
              <View style={s.errorFeedbackBanner}>
                <Icon name="warning-outline" size="sm" color={theme.danger} />
                <Text style={s.errorFeedbackText}>{errorState.message}</Text>
              </View>
            </View>

            {/* Kinetic Thumb-Zone Recovery Actions (64dp+ Glove Operable) */}
            <View style={s.errorActionsDeck}>
              <TouchableOpacity
                style={[s.giantActionBtn, s.giantBtnPrimary]}
                onPress={() => {
                  setErrorState(null);
                  setActiveTab('code');
                }}
              >
                <Icon name="refresh" size="lg" color={theme.onAccent} />
                <Text style={s.giantBtnTextPrimary}>Try another code</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[s.giantActionBtn, s.giantBtnSecondary]}
                onPress={() => {
                  setErrorState(null);
                  setActiveTab('qr');
                }}
              >
                <Icon name="qr-code-outline" size="lg" color={theme.text} />
                <Text style={s.giantBtnTextSecondary}>Scan Pack QR Pass</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={s.dismissActionBtn}
                onPress={() => router.back()}
              >
                <Text style={s.dismissActionText}>Back to solo ride</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <>
            {/* Context & Kicker */}
            <View style={s.introHeader}>
              <View style={s.kickerRow}>
                <LiveDot pulse color={theme.accent} size={8} />
                <Text style={s.kickerText}>FORMATION LINK READY</Text>
              </View>
              <Text style={s.mainTitle}>Join an Expedition</Text>
              <Text style={s.subtitleText}>
                Connect to formation radar & synchronized GPX telemetry track.
              </Text>
            </View>

            {/* Method Switcher (Glove-friendly segmented control, min 48dp) */}
            <View style={s.segmentedMethodSwitcher}>
              <TouchableOpacity
                style={[s.segmentedTab, activeTab === 'qr' && s.segmentedTabActive]}
                onPress={() => setActiveTab('qr')}
                accessibilityRole="button"
                accessibilityLabel="Scan QR Method"
              >
                <Icon name="qr-code-outline" size={16} color={activeTab === 'qr' ? theme.accent : theme.textMuted} />
                <Text style={[s.segmentedTabText, activeTab === 'qr' && s.segmentedTabTextActive]}>Scan QR</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[s.segmentedTab, activeTab === 'code' && s.segmentedTabActive]}
                onPress={() => setActiveTab('code')}
                accessibilityRole="button"
                accessibilityLabel="Passcode Method"
              >
                <Icon name="keypad-outline" size={16} color={activeTab === 'code' ? theme.accent : theme.textMuted} />
                <Text style={[s.segmentedTabText, activeTab === 'code' && s.segmentedTabTextActive]}>Passcode</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[s.segmentedTab, activeTab === 'link' && s.segmentedTabActive]}
                onPress={() => setActiveTab('link')}
                accessibilityRole="button"
                accessibilityLabel="Link Method"
              >
                <Icon name="link-outline" size={16} color={activeTab === 'link' ? theme.accent : theme.textMuted} />
                <Text style={[s.segmentedTabText, activeTab === 'link' && s.segmentedTabTextActive]}>Link</Text>
              </TouchableOpacity>
            </View>

            {/* TAB 1: Scan QR Viewfinder */}
            {activeTab === 'qr' && (
              <View style={s.qrSection}>
                <View style={s.viewfinderBox}>
                  {/* Top Status Pill inside Viewfinder */}
                  <View style={s.viewfinderTopStatus}>
                    <Text style={s.fpsBadgeText}>USE YOUR PHONE CAMERA</Text>
                  </View>

                  {/* Target Reticle with Glowing Corner Brackets */}
                  <View style={s.reticleBox}>
                    {/* Corners */}
                    <View style={[s.reticleCorner, s.reticleTopLeft]} />
                    <View style={[s.reticleCorner, s.reticleTopRight]} />
                    <View style={[s.reticleCorner, s.reticleBottomLeft]} />
                    <View style={[s.reticleCorner, s.reticleBottomRight]} />

                    {/* Scanning Laser Beam */}

                    {/* Center Crosshairs */}
                    <View style={s.crosshairHoriz} />
                    <View style={s.crosshairVert} />
                  </View>

                  {/* Bottom Viewfinder Prompt */}
                  <View style={s.viewfinderBottomPrompt}>
                    <Text style={s.viewfinderPromptText}>
                      Open your phone’s camera and scan the invitation QR. Or ask your leader for the ride code.
                    </Text>
                  </View>
                </View>

                {/* Viewfinder Controls (64dp Oversized Glove Hit Targets) */}
                <View style={s.viewfinderControlsRow}>
                  <TouchableOpacity
                    style={s.viewfinderControlBtn}
                    onPress={() => setActiveTab('code')}
                    accessibilityRole="button"
                    accessibilityLabel="Enter ride code"
                  >
                    <View style={s.controlBtnIconBox}>
                      <Icon name="keypad-outline" size="md" color={theme.text} />
                    </View>
                    <View style={s.controlBtnCol}>
                      <Text style={s.controlBtnTitle}>Enter code</Text>
                    </View>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={s.viewfinderControlBtn}
                    onPress={() => setActiveTab('link')}
                    accessibilityRole="button"
                    accessibilityLabel="Paste invitation token"
                  >
                    <View style={s.controlBtnIconBox}>
                      <Icon name="link-outline" size="md" color={theme.text} />
                    </View>
                    <View style={s.controlBtnCol}>
                      <Text style={s.controlBtnTitle}>Use token</Text>
                    </View>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* TAB 2: Direct 6-Digit Passcode Mode */}
            {activeTab === 'code' && (
              <View style={s.passcodeSection}>
                <View style={s.passcodeHeader}>
                  <Text style={s.passcodeSectionLabel}>DIRECT EXPEDITION CODE</Text>
                  <Text style={s.passcodeSubPill}>6 CHARACTERS</Text>
                </View>

                {/* 6 Tactile PIN Digit Boxes */}
                <View style={s.codeCellsRow}>
                  {Array.from({ length: 6 }).map((_, i) => {
                    const char = code[i] || '';
                    const isFocus = code.length === i;
                    return (
                      <View
                        key={i}
                        style={[
                          s.codeCell,
                          char ? s.codeCellFilled : null,
                          isFocus && s.codeCellFocused,
                        ]}
                      >
                        <Text style={[s.codeCellText, char ? s.codeCellTextFilled : null]}>
                          {char || (isFocus ? '|' : '•')}
                        </Text>
                      </View>
                    );
                  })}
                </View>

                {/* Hidden Text Input handling input cleanly */}
                <TextInput
                  style={s.hiddenCodeInput}
                  value={code}
                  onChangeText={t => setCode(t.trim().toUpperCase())}
                  accessibilityLabel="Type or paste your six-character ride code"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  placeholder="Type or paste code"
                  placeholderTextColor={theme.textMuted}
                />

                <Text style={s.clipboardText}>{code && !/^[A-Z0-9]{1,6}$/.test(code)
                  ? 'Use the six letters or numbers from your ride leader, not the full message.'
                  : 'To paste, press and hold the code field and choose Paste.'}</Text>
              </View>
            )}

            {/* TAB 3: Invitation Token (Link) Mode */}
            {activeTab === 'link' && (
              <View style={s.linkSection}>
                <Text style={s.linkLabel}>PRIVATE EXPEDITION INVITATION LINK</Text>
                <Text style={s.linkSubtitle}>
                  Paste the private invitation token shared by the expedition leader.
                </Text>
                <TextInput
                  style={s.tokenInput}
                  placeholder="Paste invitation token (UUID)"
                  placeholderTextColor={theme.textMuted}
                  value={token}
                  onChangeText={setToken}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
            )}

            {/* Offline Mesh Pairing Pro-Tip Banner */}
            <View style={s.meshBanner}>
              <View style={s.meshIconBox}>
                <Icon name="cloud-offline-outline" size="lg" color={theme.textMuted} />
              </View>
              <View style={s.meshTextCol}>
                <View style={s.meshTitleRow}>
                  <Text style={s.meshTitle}>No phone signal?</Text>
                  <View style={s.meshDot} />
                </View>
                <Text style={s.meshBody}>
                  Joining a group requires an internet connection. Keep your invitation and try again when you are back online.
                </Text>
              </View>
            </View>
          </>
        )}
      </ScrollView>

      {/* Sticky Bottom Action Deck (64dp Glove Operable) */}
      <View style={[s.stickyBottomDeck, { paddingBottom: Math.max(insets.bottom + 12, 20) }]}>
        <TouchableOpacity
          style={[s.primaryVerifyBtn, loading && { opacity: 0.7 }]}
          disabled={loading}
          onPress={() => {
            if (activeTab === 'qr') {
              setActiveTab('code');
            } else if (activeTab === 'link') {
              void handleAcceptInvitation();
            } else {
              void handleJoinCode();
            }
          }}
          accessibilityRole="button"
          accessibilityLabel="Verify and join group ride"
        >
          {loading ? (
            <ActivityIndicator color={theme.onAccent} size="small" />
          ) : (
            <View style={s.primaryBtnRow}>
              <Text style={s.primaryBtnTitle}>{activeTab === 'qr' ? 'USE RIDE CODE' : 'VERIFY & JOIN RIDE'}</Text>
              <Icon name="arrow-forward" size="md" color={theme.onAccent} />
            </View>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={s.secondaryCancelBtn}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Cancel join"
        >
          <Text style={s.secondaryCancelText}>CANCEL</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const makeStyles = (c: RidePalette) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: c.background,
    },
    topHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingBottom: 12,
      backgroundColor: c.surface,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
      zIndex: 10,
    },
    headerIconButton: {
      width: 44,
      height: 44,
      borderRadius: 12,
      backgroundColor: c.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerTitle: {
      fontSize: 14,
      fontWeight: '800',
      color: c.text,
      letterSpacing: 1.5,
      textAlign: 'center',
      flex: 1,
    },
    headerRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    riderAvatarMini: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: c.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    riderAvatarText: {
      color: c.onAccent,
      fontSize: 14,
      fontWeight: '800',
    },
    scrollView: {
      flex: 1,
    },
    scrollContent: {
      padding: 16,
      gap: 16,
    },
    introHeader: {
      gap: 4,
    },
    kickerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    kickerText: {
      fontSize: 11,
      fontWeight: '800',
      color: c.accent,
      letterSpacing: 1.2,
    },
    mainTitle: {
      fontSize: 24,
      fontWeight: '900',
      color: c.text,
      letterSpacing: -0.5,
    },
    subtitleText: {
      fontSize: 13,
      color: c.textMuted,
      lineHeight: 18,
    },
    segmentedMethodSwitcher: {
      flexDirection: 'row',
      backgroundColor: c.surfaceRaised,
      borderRadius: 14,
      padding: 4,
      gap: 4,
    },
    segmentedTab: {
      flex: 1,
      minHeight: 48,
      borderRadius: 10,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
    },
    segmentedTabActive: {
      backgroundColor: c.surface,
    },
    segmentedTabText: {
      fontSize: 12,
      fontWeight: '700',
      color: c.textMuted,
      letterSpacing: 0.5,
      textTransform: 'uppercase',
    },
    segmentedTabTextActive: {
      color: c.text,
      fontWeight: '800',
    },
    qrSection: {
      gap: 12,
    },
    viewfinderBox: {
      width: '100%',
      aspectRatio: 4 / 3,
      borderRadius: radius.lg,
      backgroundColor: c.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
      position: 'relative',
      overflow: 'hidden',
    },
    viewfinderTopStatus: {
      position: 'absolute',
      top: 12,
      left: 12,
      right: 12,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      zIndex: 2,
    },
    fpsBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: 'rgba(12, 14, 17, 0.85)',
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: radius.xs,
    },
    fpsBadgeText: {
      fontSize: 10,
      fontWeight: '800',
      color: c.green,
      letterSpacing: 1,
    },
    isoBadge: {
      backgroundColor: 'rgba(12, 14, 17, 0.85)',
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: radius.xs,
    },
    isoBadgeText: {
      fontSize: 10,
      fontWeight: '700',
      color: c.textMuted,
    },
    reticleBox: {
      width: 200,
      height: 200,
      position: 'relative',
      alignItems: 'center',
      justifyContent: 'center',
    },
    reticleCorner: {
      position: 'absolute',
      width: 28,
      height: 28,
      borderColor: c.accent,
    },
    reticleTopLeft: {
      top: 0,
      left: 0,
      borderTopWidth: 3,
      borderLeftWidth: 3,
    },
    reticleTopRight: {
      top: 0,
      right: 0,
      borderTopWidth: 3,
      borderRightWidth: 3,
    },
    reticleBottomLeft: {
      bottom: 0,
      left: 0,
      borderBottomWidth: 3,
      borderLeftWidth: 3,
    },
    reticleBottomRight: {
      bottom: 0,
      right: 0,
      borderBottomWidth: 3,
      borderRightWidth: 3,
    },
    scanningLaserLine: {
      position: 'absolute',
      left: 4,
      right: 4,
      height: 2,
      backgroundColor: c.accent,
    },
    crosshairHoriz: {
      position: 'absolute',
      width: 16,
      height: 1,
      backgroundColor: 'rgba(255, 255, 255, 0.4)',
    },
    crosshairVert: {
      position: 'absolute',
      width: 1,
      height: 16,
      backgroundColor: 'rgba(255, 255, 255, 0.4)',
    },
    viewfinderBottomPrompt: {
      position: 'absolute',
      bottom: 12,
      backgroundColor: 'rgba(12, 14, 17, 0.85)',
      paddingHorizontal: 14,
      paddingVertical: 6,
      borderRadius: 10,
    },
    viewfinderPromptText: {
      color: '#FFFFFF',
      fontSize: 11,
      fontWeight: '600',
      textAlign: 'center',
    },
    viewfinderControlsRow: {
      flexDirection: 'row',
      gap: 12,
    },
    viewfinderControlBtn: {
      flex: 1,
      minHeight: 64,
      backgroundColor: c.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: c.border,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      gap: 10,
    },
    controlBtnIconBox: {
      width: 40,
      height: 40,
      borderRadius: 12,
      backgroundColor: c.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    controlBtnIconBoxActive: {
      backgroundColor: c.accentSoft,
    },
    controlBtnCol: {
      flex: 1,
    },
    controlBtnTitle: {
      fontSize: 12,
      fontWeight: '800',
      color: c.text,
      letterSpacing: 0.8,
    },
    controlBtnSubtitle: {
      fontSize: 9,
      fontWeight: '700',
      color: c.textMuted,
      letterSpacing: 0.5,
    },
    passcodeSection: {
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: c.border,
      padding: 16,
      gap: 12,
    },
    passcodeHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    passcodeSectionLabel: {
      fontSize: 11,
      fontWeight: '800',
      color: c.textMuted,
      letterSpacing: 1,
    },
    passcodeSubPill: {
      fontSize: 10,
      fontWeight: '700',
      color: c.green,
    },
    codeCellsRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 6,
    },
    codeCell: {
      flex: 1,
      height: 56,
      borderRadius: 12,
      backgroundColor: c.surfaceRaised,
      borderWidth: 1,
      borderColor: c.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    codeCellFilled: {
      borderColor: c.accent,
      backgroundColor: c.surface,
    },
    codeCellFocused: {
      borderColor: c.accent,
      borderWidth: 2,
    },
    codeCellText: {
      fontSize: 20,
      fontWeight: '800',
      color: c.textMuted,
      fontFamily: 'monospace',
    },
    codeCellTextFilled: {
      color: c.accent,
    },
    hiddenCodeInput: {
      height: 44,
      backgroundColor: c.surfaceRaised,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: c.border,
      paddingHorizontal: 12,
      color: c.text,
      fontSize: 14,
      fontWeight: '700',
      textAlign: 'center',
      letterSpacing: 4,
    },
    clipboardChip: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: c.surfaceRaised,
      borderRadius: 12,
      padding: 10,
      gap: 8,
    },
    clipboardLeftCol: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      flex: 1,
    },
    clipboardIcon: {
      fontSize: 16,
    },
    clipboardText: {
      fontSize: 11,
      color: c.textMuted,
      flex: 1,
    },
    clipboardTextBold: {
      color: c.text,
      fontWeight: '700',
    },
    clipboardApplyBtn: {
      backgroundColor: c.accent,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 8,
    },
    clipboardApplyText: {
      color: c.onAccent,
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 0.8,
    },
    linkSection: {
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: c.border,
      padding: 16,
      gap: 8,
    },
    linkLabel: {
      fontSize: 11,
      fontWeight: '800',
      color: c.textMuted,
      letterSpacing: 1,
    },
    linkSubtitle: {
      fontSize: 12,
      color: c.textMuted,
      lineHeight: 16,
    },
    tokenInput: {
      height: 48,
      backgroundColor: c.surfaceRaised,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: c.border,
      paddingHorizontal: 12,
      color: c.text,
      fontSize: 13,
      fontWeight: '600',
      marginTop: 4,
    },
    meshBanner: {
      flexDirection: 'row',
      backgroundColor: c.surfaceRaised,
      borderRadius: 16,
      padding: 14,
      gap: 12,
      alignItems: 'flex-start',
    },
    meshIconBox: {
      width: 40,
      height: 40,
      borderRadius: 10,
      backgroundColor: c.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    meshTextCol: {
      flex: 1,
      gap: 4,
    },
    meshTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    meshTitle: {
      fontSize: 13,
      fontWeight: '800',
      color: c.text,
    },
    meshDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: c.green,
    },
    meshBody: {
      fontSize: 11,
      color: c.textMuted,
      lineHeight: 16,
    },
    meshActionRow: {
      marginTop: 2,
    },
    meshActionText: {
      fontSize: 11,
      fontWeight: '800',
      color: c.accent,
      letterSpacing: 0.5,
    },
    errorContainer: {
      gap: 16,
    },
    errorCard: {
      backgroundColor: c.dangerSoft,
      borderColor: c.danger,
      borderWidth: 1,
      borderRadius: radius.lg,
      padding: 20,
      alignItems: 'center',
      textAlign: 'center',
      gap: 8,
    },
    errorIconBadge: {
      width: 54,
      height: 54,
      borderRadius: 27,
      backgroundColor: c.dangerSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    errorPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: c.dangerSoft,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: radius.sm,
    },
    errorPillText: {
      color: c.danger,
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 0.8,
    },
    errorTitle: {
      fontSize: 20,
      fontWeight: '900',
      color: c.text,
    },
    errorDescription: {
      fontSize: 13,
      color: c.textMuted,
      textAlign: 'center',
      lineHeight: 18,
    },
    errorCellsContainer: {
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: c.border,
      padding: 16,
      gap: 10,
    },
    errorCellsHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    errorCellsLabel: {
      fontSize: 11,
      fontWeight: '800',
      color: c.textMuted,
      letterSpacing: 1,
    },
    clearCodeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
    },
    clearCodeAction: {
      fontSize: 11,
      fontWeight: '700',
      color: c.accent,
    },
    codeCellError: {
      borderColor: c.danger,
      backgroundColor: c.dangerSoft,
    },
    codeCellTextError: {
      color: c.danger,
    },
    errorFeedbackBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: c.dangerSoft,
      padding: 10,
      borderRadius: radius.sm,
    },
    errorFeedbackText: {
      flex: 1,
      fontSize: 12,
      color: c.danger,
      fontWeight: '600',
    },
    errorActionsDeck: {
      gap: 10,
      paddingTop: 4,
    },
    giantActionBtn: {
      minHeight: 64,
      borderRadius: 16,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
    },
    giantBtnPrimary: {
      backgroundColor: c.accent,
    },
    giantBtnSecondary: {
      backgroundColor: c.surfaceRaised,
      borderWidth: 1,
      borderColor: c.border,
    },
    giantBtnTextPrimary: {
      color: c.onAccent,
      fontSize: 14,
      fontWeight: '800',
      letterSpacing: 0.8,
    },
    giantBtnTextSecondary: {
      color: c.text,
      fontSize: 14,
      fontWeight: '800',
      letterSpacing: 0.8,
    },
    dismissActionBtn: {
      minHeight: 48,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dismissActionText: {
      color: c.textMuted,
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 0.5,
    },
    stickyBottomDeck: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      backgroundColor: c.surface,
      borderTopWidth: 1,
      borderTopColor: c.border,
      paddingHorizontal: 16,
      paddingTop: 12,
      gap: 8,
    },
    primaryVerifyBtn: {
      minHeight: 60,
      backgroundColor: c.accent,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryBtnRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    primaryBtnTitle: {
      color: c.onAccent,
      fontSize: 15,
      fontWeight: '900',
      letterSpacing: 0.8,
    },
    secondaryCancelBtn: {
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    secondaryCancelText: {
      color: c.textMuted,
      fontSize: 12,
      fontWeight: '800',
      letterSpacing: 1.2,
    },
  });
