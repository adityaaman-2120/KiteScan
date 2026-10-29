import { Asset } from 'expo-asset';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { EngineError, useEngine } from '../engine';
import { createDoc } from '../store/docs';
import { useTheme } from '../theme';
import { prepareForEngine } from '../utils';

/* eslint-disable @typescript-eslint/no-require-imports */
const SAMPLE_DOC: number = require('../../assets/samples/sample-doc.jpg');
const SAMPLE_BOARD: number = require('../../assets/samples/sample-blackboard.jpg');

/** Hidden on Home: long-press the logo to show it. Smoke-tests the bridge end to end. */
export function EngineDebugPanel({ onLibraryChanged }: { onLibraryChanged?: () => void }) {
  const { colors, spacing, radius, typography } = useTheme();
  const engine = useEngine();
  const [log, setLog] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [before, setBefore] = useState<string | null>(null);
  const [after, setAfter] = useState<string | null>(null);

  const ping = async () => {
    try {
      const r = await engine.run('ping', {});
      setLog(`pong from OpenCV ${r.cvVersion} in ${r.ms} ms (loaded via ${engine.mode})`);
    } catch (e) {
      setLog(e instanceof EngineError ? e.userMessage : 'Something went wrong.');
    }
  };

  /** Seeds the library with two bundled samples so the grid can be tried before the scan flow exists. */
  const addSamples = async () => {
    setBusy(true);
    try {
      const load = async (module: number) => {
        const asset = Asset.fromModule(module);
        await asset.downloadAsync();
        return { uri: asset.localUri ?? asset.uri, width: asset.width ?? 1200, height: asset.height ?? 900 };
      };
      const [doc, board] = await Promise.all([load(SAMPLE_DOC), load(SAMPLE_BOARD)]);
      const a = await createDoc([doc], 'Sample document');
      const b = await createDoc([board, doc], 'Sample board and page');
      setLog(a.ok && b.ok ? 'Added 2 sample scans to the library.' : 'Could not add the samples.');
      onLibraryChanged?.();
    } catch {
      setLog('Could not add the samples.');
    } finally {
      setBusy(false);
    }
  };

  const grayscale = async () => {
    setBusy(true);
    setLog(null);
    try {
      const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
      if (picked.canceled) return;
      const asset = picked.assets[0];
      const prepared = await prepareForEngine(asset.uri, asset.width, asset.height);
      if (!prepared.ok) return setLog(prepared.message);
      setBefore(`data:image/jpeg;base64,${prepared.image.base64}`);
      setAfter(null);
      const result = await engine.run('grayscale', { imageBase64: prepared.image.base64 });
      setAfter(`data:image/jpeg;base64,${result.imageBase64}`);
      setLog(`grayscale ${result.width}x${result.height} in ${result.ms} ms (loaded via ${engine.mode})`);
    } catch (e) {
      setLog(e instanceof EngineError ? e.userMessage : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg }]}>
      <Text style={[typography.label, { color: colors.textMuted }]}>ENGINE DEBUG ({engine.status}{engine.mode ? `, ${engine.mode}` : ''})</Text>
      <Text style={[typography.caption, { color: colors.textMuted, marginTop: spacing.xs }]}>
        WebView mounts: {engine.webViewMounts} (stays at 1 in normal use; only a recovery adds one)
      </Text>
      <View style={styles.row}>
        <Pressable onPress={ping} style={[styles.btn, { backgroundColor: colors.surfaceAlt, borderRadius: radius.pill }]}>
          <Text style={[typography.caption, { color: colors.text }]}>Ping</Text>
        </Pressable>
        <Pressable
          onPress={grayscale}
          disabled={busy}
          style={[styles.btn, { backgroundColor: colors.primary, borderRadius: radius.pill, opacity: busy ? 0.6 : 1 }]}
        >
          <Text style={[typography.caption, { color: colors.onPrimary }]}>Pick image, grayscale</Text>
        </Pressable>
        <Pressable
          onPress={addSamples}
          disabled={busy}
          style={[styles.btn, { backgroundColor: colors.accent, borderRadius: radius.pill, opacity: busy ? 0.6 : 1 }]}
        >
          <Text style={[typography.caption, { color: '#0B1220' }]}>Add sample scans</Text>
        </Pressable>
      </View>
      {busy && <ActivityIndicator style={{ marginTop: spacing.md }} color={colors.primary} />}
      {log && <Text style={[typography.caption, { color: colors.text, marginTop: spacing.md }]}>{log}</Text>}
      <View style={styles.row}>
        {before && <Image source={{ uri: before }} style={[styles.preview, { borderRadius: radius.md }]} />}
        {after && <Image source={{ uri: after }} style={[styles.preview, { borderRadius: radius.md }]} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  btn: { paddingHorizontal: 18, paddingVertical: 11, alignItems: 'center' },
  preview: { flex: 1, aspectRatio: 0.75, resizeMode: 'contain', backgroundColor: '#00000020' },
});
