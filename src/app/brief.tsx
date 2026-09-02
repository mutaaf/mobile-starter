import * as Haptics from 'expo-haptics';
import { Accelerometer } from 'expo-sensors';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Reveal } from '@/components/reveal';
import { Label, Panel, Readout, Rule, ScreenTitle, Status } from '@/components/telemetry';
import { BottomTabInset, MaxContentWidth, Palette, Radius, Space, Type } from '@/constants/theme';
import { useCache } from '@/lib/cache/provider';
import { CacheKeys } from '@/lib/cache';
import {
  fetchIss,
  fetchLaunches,
  fetchQuakes,
  fetchSpaceWeather,
  type IssPosition,
  type Launch,
  type Quake,
  type SpaceWeather,
} from '@/lib/api';
import { buildFusionPrompt, BRIEF_SYSTEM, type DeviceContext } from '@/lib/llm/brief';
import { deleteKey, loadKey, maskKey, saveKey } from '@/lib/llm/key-store';
import { PROVIDER_LIST, PROVIDERS } from '@/lib/llm/providers';
import { LlmError, type LlmResult, type ProviderId } from '@/lib/llm/types';

const LEVEL_THRESHOLD = 0.22;

type KeyState = 'checking' | 'absent' | 'stored';

export default function BriefScreen() {
  const insets = useSafeAreaInsets();
  const cache = useCache();

  const [providerId, setProviderId] = useState<ProviderId>('anthropic');
  const [keyState, setKeyState] = useState<KeyState>('checking');
  const [masked, setMasked] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<null | 'verify' | 'brief'>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  const [result, setResult] = useState<LlmResult | null>(null);
  const [tilt, setTilt] = useState<number | null>(null);
  // Bumped when any cache key changes, so the feed counter stays live.
  const [, setFeedTick] = useState(0);

  const provider = PROVIDERS[providerId];

  // --- sensors -------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    let sub: { remove: () => void } | undefined;

    (async () => {
      const ok = await Accelerometer.isAvailableAsync().catch(() => false);
      if (cancelled || !ok) return;
      Accelerometer.setUpdateInterval(400);
      sub = Accelerometer.addListener(({ x, y }) => setTilt(Math.hypot(x, y)));
    })();

    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, []);

  // --- feed warm-up --------------------------------------------------------
  // Reaching Brief directly would otherwise fuse a mostly-empty report. Reads go
  // through the shared cache, so anything another tab already fetched is a hit
  // and costs no request; only genuinely missing or stale feeds hit the network.
  useEffect(() => {
    const stale = { staleMs: 120_000 };
    void cache.read(CacheKeys.iss, fetchIss, stale);
    void cache.read(CacheKeys.quakes, fetchQuakes, stale);
    void cache.read(CacheKeys.spaceWeather, fetchSpaceWeather, stale);
    void cache.read(CacheKeys.launches, fetchLaunches, stale);

    return cache.subscribeAll(() => setFeedTick((n) => n + 1));
  }, [cache]);

  // --- stored key ----------------------------------------------------------
  // Sets state only after the keystore read resolves, so callers decide whether
  // to show a 'checking' state first.
  const refreshKey = useCallback(async (id: ProviderId) => {
    const stored = await loadKey(id);
    setMasked(stored ? maskKey(stored) : null);
    setKeyState(stored ? 'stored' : 'absent');
  }, []);

  // Switching provider clears everything tied to the old one. Done in the
  // handler rather than an effect: the reset is a consequence of the tap, not
  // of the render, and setState-in-effect cascades renders.
  const onSelectProvider = useCallback(
    (id: ProviderId) => {
      if (id === providerId) return;
      Haptics.selectionAsync().catch(() => {});
      setProviderId(id);
      setKeyState('checking');
      setResult(null);
      setNotice(null);
      setDraft('');
      void refreshKey(id);
    },
    [providerId, refreshKey],
  );

  // Mount-only: reads the keystore for the default provider. Every later change
  // goes through onSelectProvider, so providerId is deliberately not a dep, and
  // refreshKey only sets state after awaiting the read.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshKey(providerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- actions -------------------------------------------------------------
  const onSave = useCallback(async () => {
    const candidate = draft.trim();
    if (!provider.looksLikeKey(candidate)) {
      setNotice({ tone: 'bad', text: `That doesn't look like a ${provider.label} key (${provider.keyHint}).` });
      return;
    }

    setBusy('verify');
    setNotice(null);
    try {
      // Verify before storing: a key that never worked should never be saved.
      await provider.verify(candidate);
      await saveKey(providerId, candidate);
      setDraft('');
      await refreshKey(providerId);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setNotice({ tone: 'ok', text: 'Key verified and stored in the device keystore.' });
    } catch (error) {
      const message = error instanceof LlmError ? error.message : 'Verification failed.';
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      setNotice({ tone: 'bad', text: message });
    } finally {
      setBusy(null);
    }
  }, [draft, provider, providerId, refreshKey]);

  const onForget = useCallback(async () => {
    await deleteKey(providerId);
    setResult(null);
    setNotice({ tone: 'ok', text: 'Key removed from this device.' });
    await refreshKey(providerId);
  }, [providerId, refreshKey]);

  const onBrief = useCallback(async () => {
    const key = await loadKey(providerId);
    if (!key) {
      setNotice({ tone: 'bad', text: 'No key stored for this provider.' });
      return;
    }

    setBusy('brief');
    setNotice(null);
    try {
      // Read straight from the cache the other four screens already populated —
      // the briefing costs no extra network calls of its own.
      const device: DeviceContext = {
        platform: `${Platform.OS} ${Platform.Version}`,
        tiltG: tilt,
        level: tilt == null ? null : tilt < LEVEL_THRESHOLD,
        localTime: new Date().toLocaleTimeString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };

      const prompt = buildFusionPrompt({
        iss: cache.getState<IssPosition>(CacheKeys.iss).data,
        quakes: cache.getState<Quake[]>(CacheKeys.quakes).data,
        space: cache.getState<SpaceWeather>(CacheKeys.spaceWeather).data,
        launches: cache.getState<Launch[]>(CacheKeys.launches).data,
        device,
      });

      const completion = await provider.complete({ system: BRIEF_SYSTEM, user: prompt }, key);
      setResult(completion);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    } catch (error) {
      const message = error instanceof LlmError ? error.message : 'Briefing failed.';
      setNotice({ tone: 'bad', text: message });
    } finally {
      setBusy(null);
    }
  }, [cache, provider, providerId, tilt]);

  const feedsReady = [CacheKeys.iss, CacheKeys.quakes, CacheKeys.spaceWeather, CacheKeys.launches]
    .map((k) => cache.getState(k).data)
    .filter(Boolean).length;

  return (
    <ScrollView
      style={styles.screen}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + Space.lg, paddingBottom: BottomTabInset + Space.huge },
      ]}>
      <Reveal duration={380}>
        <ScreenTitle sub="Fuses every live feed and the handset's own sensors through a model you supply">
          Brief
        </ScreenTitle>
      </Reveal>

      <Reveal delay={60} duration={380}>
        <Panel
          title="Model provider"
          right={
            <Status
              state={keyState === 'stored' ? 'live' : keyState === 'checking' ? 'idle' : 'error'}
              label={keyState === 'stored' ? 'key stored' : keyState === 'checking' ? '…' : 'no key'}
            />
          }
          testID="brief-provider">
          <View style={styles.providerRow}>
            {PROVIDER_LIST.map((p) => (
              <Pressable
                key={p.id}
                testID={`provider-${p.id}`}
                onPress={() => onSelectProvider(p.id)}
                style={[styles.providerChip, providerId === p.id && styles.providerChipActive]}>
                <Text
                  style={[styles.providerText, providerId === p.id && styles.providerTextActive]}>
                  {p.label}
                </Text>
              </Pressable>
            ))}
          </View>

          <Label>{`Model: ${provider.model}`}</Label>

          {keyState === 'stored' ? (
            <View style={styles.storedRow}>
              <View style={styles.storedKey}>
                <Label tone="signal">Stored key</Label>
                <Text style={styles.masked}>{masked}</Text>
              </View>
              <Pressable onPress={onForget} testID="brief-forget" style={styles.dangerBtn}>
                <Text style={styles.dangerText}>FORGET</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <TextInput
                testID="brief-key-input"
                value={draft}
                onChangeText={setDraft}
                placeholder={`Paste your ${provider.label} key — ${provider.keyHint}`}
                placeholderTextColor={Palette.faint}
                // Every one of these matters for a secret: no autocorrect
                // dictionary capture, no autocapitalisation mangling the key,
                // no keyboard learning, and masked entry.
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                autoComplete="off"
                textContentType="password"
                style={styles.input}
              />
              <View style={styles.actionRow}>
                <Pressable
                  testID="brief-save-key"
                  onPress={onSave}
                  disabled={busy !== null || draft.trim().length === 0}
                  style={[
                    styles.primaryBtn,
                    (busy !== null || draft.trim().length === 0) && styles.btnDisabled,
                  ]}>
                  {busy === 'verify' ? (
                    <ActivityIndicator color={Palette.void} size="small" />
                  ) : (
                    <Text style={styles.primaryText}>VERIFY &amp; STORE</Text>
                  )}
                </Pressable>
                <Pressable onPress={() => Linking.openURL(provider.consoleUrl)}>
                  <Text style={styles.linkText}>Get a key ↗</Text>
                </Pressable>
              </View>
            </>
          )}

          {notice ? (
            <Text
              testID="brief-notice"
              style={[styles.notice, { color: notice.tone === 'ok' ? Palette.signal : Palette.alert }]}>
              {notice.text}
            </Text>
          ) : null}

          <Rule />
          <Text style={styles.privacy}>
            Your key is written to the iOS Keychain / Android EncryptedSharedPreferences, never to
            app storage and never to the cache the devtools panel can read. It is sent only to{' '}
            {provider.label}. Keys on a device are inherently less protected than on a server —
            prefer a scoped, revocable key.
          </Text>
        </Panel>
      </Reveal>

      <Reveal delay={120} duration={380}>
        <Panel
          title="Fusion briefing"
          right={<Label>{`${feedsReady}/4 feeds`}</Label>}
          testID="brief-output">
          <Text style={styles.explain}>
            Sends the current ISS fix, seismic survey, geomagnetic index, launch manifest and this
            handset&apos;s tilt and clock as one structured situation report. Feeds are read
            through the shared cache, so whatever another tab already loaded costs nothing.
          </Text>

          <Pressable
            testID="brief-run"
            onPress={onBrief}
            disabled={busy !== null || keyState !== 'stored'}
            style={[styles.primaryBtn, (busy !== null || keyState !== 'stored') && styles.btnDisabled]}>
            {busy === 'brief' ? (
              <ActivityIndicator color={Palette.void} size="small" />
            ) : (
              <Text style={styles.primaryText}>GENERATE BRIEFING</Text>
            )}
          </Pressable>

          {result ? (
            <>
              <Rule />
              <Text style={styles.briefText} testID="brief-text">
                {result.text}
              </Text>
              <Rule />
              <View style={styles.metaRow}>
                <Readout label="Latency" value={`${(result.latencyMs / 1000).toFixed(1)}`} unit="s" />
                <Readout label="In" value={result.inputTokens?.toString() ?? '—'} unit="tok" />
                <Readout
                  label="Out"
                  value={result.outputTokens?.toString() ?? '—'}
                  unit="tok"
                  tone="signal"
                />
              </View>
              <Label>{result.model}</Label>
            </>
          ) : null}
        </Panel>
      </Reveal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: {
    paddingHorizontal: Space.lg,
    gap: Space.lg,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  providerRow: { flexDirection: 'row', gap: Space.xs },
  providerChip: {
    flex: 1,
    paddingVertical: Space.sm,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Palette.rule,
    alignItems: 'center',
  },
  providerChipActive: { borderColor: Palette.signal, backgroundColor: '#C6F24E14' },
  providerText: { fontFamily: Type.mono, fontSize: 10, color: Palette.dim, letterSpacing: 0.6 },
  providerTextActive: { color: Palette.signal },
  input: {
    fontFamily: Type.mono,
    fontSize: 12,
    color: Palette.text,
    backgroundColor: Palette.panelHi,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Palette.rule,
    paddingHorizontal: Space.md,
    paddingVertical: Space.md,
  },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  primaryBtn: {
    flex: 1,
    backgroundColor: Palette.signal,
    borderRadius: Radius.sm,
    paddingVertical: Space.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 42,
  },
  btnDisabled: { opacity: 0.35 },
  primaryText: {
    fontFamily: Type.monoBold,
    fontSize: 11,
    letterSpacing: 1.4,
    color: Palette.void,
  },
  linkText: { fontFamily: Type.mono, fontSize: 10, color: Palette.cool },
  storedRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  storedKey: { flex: 1, gap: 2 },
  masked: { fontFamily: Type.monoMedium, fontSize: 14, color: Palette.text },
  dangerBtn: {
    borderWidth: 1,
    borderColor: Palette.alert,
    borderRadius: Radius.sm,
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
  },
  dangerText: { fontFamily: Type.mono, fontSize: 10, letterSpacing: 1.2, color: Palette.alert },
  notice: { fontFamily: Type.mono, fontSize: 11, lineHeight: 17 },
  privacy: { fontFamily: Type.mono, fontSize: 9, color: Palette.faint, lineHeight: 15 },
  explain: { fontFamily: Type.mono, fontSize: 11, color: Palette.dim, lineHeight: 17 },
  briefText: { fontFamily: Type.mono, fontSize: 13, color: Palette.text, lineHeight: 21 },
  metaRow: { flexDirection: 'row', gap: Space.lg },
});
