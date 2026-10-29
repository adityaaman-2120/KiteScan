import * as FileSystem from 'expo-file-system/legacy';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import {
  WebView as RNWebView,
  type WebViewMessageEvent,
} from 'react-native-webview';

import { EngineBridge, EngineError } from './bridge';
import { buildInlineEngineHtml } from './engineHtml';
import { prepareEngineFiles, type EngineFiles } from './prepareEngineFiles';
import type {
  EngineMode,
  EngineOpName,
  EnginePayload,
  EngineResult,
  EngineStatus,
} from './types';

/** Time the file:// page gets to report ready before we fall back to inlining. */
const FILE_BOOT_TIMEOUT_MS = 25_000;
const INLINE_BOOT_TIMEOUT_MS = 60_000;

/** The engine view is never shown. Raise to 1 if a device refuses to run a 0x0 WebView. */
const ENGINE_VIEW_SIZE = 0;

type EngineContextValue = {
  ready: boolean;
  status: EngineStatus;
  /** Which loading strategy worked (null until ready). */
  mode: EngineMode | null;
  /** Friendly message when status === 'error'. */
  errorMessage: string | null;
  run: <K extends EngineOpName>(
    op: K,
    payload: EnginePayload<K>,
    timeoutMs?: number,
  ) => Promise<EngineResult<K>>;
  retry: () => void;
  /** Times the hidden WebView has been mounted (1 in normal use). */
  webViewMounts: number;
};

const EngineContext = createContext<EngineContextValue | null>(null);

type Source = { uri: string } | { html: string; baseUrl: string };

// react-native-webview's published prop types intersect the iOS, Android and Windows
// props into `never` under strict TS, so we type just the props we use.
type EngineWebViewProps = {
  source: Source;
  originWhitelist: string[];
  javaScriptEnabled: boolean;
  allowFileAccess: boolean;
  allowFileAccessFromFileURLs: boolean;
  allowUniversalAccessFromFileURLs: boolean;
  domStorageEnabled: boolean;
  onMessage: (event: WebViewMessageEvent) => void;
  onError: (event: { nativeEvent: { description: string } }) => void;
  onHttpError: (event: { nativeEvent: { statusCode: number } }) => void;
  onRenderProcessGone: () => void;
  style: ViewStyle;
};
type EngineWebViewHandle = { injectJavaScript: (script: string) => void };
const WebView = RNWebView as unknown as React.ComponentType<
  EngineWebViewProps & { ref?: React.Ref<EngineWebViewHandle> }
>;

export function EngineProvider({ children }: { children: ReactNode }) {
  const bridge = useRef(new EngineBridge()).current;
  const webRef = useRef<EngineWebViewHandle>(null);

  const [status, setStatus] = useState<EngineStatus>('preparing');
  const [mode, setMode] = useState<EngineMode | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [startCount, setStartCount] = useState(0); // bump to rerun the whole startup
  // How many times the WebView has been mounted. Normal use must keep this at 1; it only grows when the
  // engine has to recover (the renderer died, or the user retried after a failure).
  const [webViewMounts, setWebViewMounts] = useState(0);
  const countMount = useCallback(() => setWebViewMounts((n) => n + 1), []);

  const filesRef = useRef<EngineFiles | null>(null);
  const modeRef = useRef<EngineMode>('file');
  const phaseHandled = useRef(false); // a boot failure is acted on once per loading phase
  const bootTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearBootTimer = useCallback(() => {
    if (bootTimer.current) clearTimeout(bootTimer.current);
    bootTimer.current = null;
  }, []);

  const giveUp = useCallback(
    (reason: string) => {
      clearBootTimer();
      console.warn(`[engine] failed: ${reason}`);
      bridge.markNotReady();
      setSource(null);
      setErrorMessage('The scan engine could not start. Tap Try again, or restart the app.');
      setStatus('error');
    },
    [bridge, clearBootTimer],
  );

  const startInline = useCallback(async () => {
    const files = filesRef.current;
    if (!files) return giveUp('no engine files for inline fallback');
    try {
      console.log('[engine] file:// failed, falling back to inline script');
      const script = await FileSystem.readAsStringAsync(files.openCvUri);
      modeRef.current = 'inline';
      phaseHandled.current = false;
      bridge.markNotReady();
      // Same WebView instance: changing `source` reloads the page, no remount.
      setSource({ html: buildInlineEngineHtml(script), baseUrl: '' });
      clearBootTimer();
      bootTimer.current = setTimeout(() => onBootFailure('inline boot timeout'), INLINE_BOOT_TIMEOUT_MS);
    } catch (e) {
      giveUp(`inline fallback failed: ${String(e)}`);
    }
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
  }, [bridge, clearBootTimer, giveUp]);

  const onBootFailure = useCallback(
    (reason: string) => {
      if (phaseHandled.current) return;
      phaseHandled.current = true;
      console.warn(`[engine] ${modeRef.current} boot failed: ${reason}`);
      if (modeRef.current === 'file') void startInline();
      else giveUp(reason);
    },
    [giveUp, startInline],
  );

  // Startup: copy files (if needed), then point the WebView at file://.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStatus('preparing');
      setErrorMessage(null);
      setMode(null);
      modeRef.current = 'file';
      phaseHandled.current = false;
      try {
        const files = await prepareEngineFiles();
        if (cancelled) return;
        filesRef.current = files;
        setStatus('loading');
        setSource({ uri: files.htmlUri });
        clearBootTimer();
        bootTimer.current = setTimeout(
          () => onBootFailure('file:// boot timeout'),
          FILE_BOOT_TIMEOUT_MS,
        );
      } catch (e) {
        if (!cancelled) giveUp(`could not prepare engine files: ${String(e)}`);
      }
    })();
    return () => {
      cancelled = true;
      clearBootTimer();
    };
  }, [startCount, clearBootTimer, giveUp, onBootFailure]);

  useEffect(() => {
    bridge.setSender((js) => webRef.current?.injectJavaScript(js));
    return () => bridge.setSender(null);
  }, [bridge]);

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const msg = bridge.handleMessage(event.nativeEvent.data);
      if (!msg) return;
      if (msg.type === 'ready') {
        clearBootTimer();
        phaseHandled.current = true; // late errors after a good boot are ignored
        console.log(`[engine] ready via ${modeRef.current} (OpenCV ${msg.cvVersion})`);
        setMode(modeRef.current);
        setStatus('ready');
        bridge.markReady();
      } else if (msg.type === 'boot-error') {
        onBootFailure(msg.message);
      } else if (msg.type === 'log') {
        console.log(`[engine] ${msg.message}`);
      }
    },
    [bridge, clearBootTimer, onBootFailure],
  );

  const retry = useCallback(() => {
    bridge.markNotReady();
    setSource(null);
    setStartCount((n) => n + 1);
  }, [bridge]);

  const run = useCallback<EngineContextValue['run']>(
    (op, payload, timeoutMs) => {
      if (status === 'error') {
        return Promise.reject(new EngineError('ENGINE_FAILED', 'engine failed to start'));
      }
      return bridge.run(op, payload, timeoutMs);
    },
    [bridge, status],
  );

  const value = useMemo<EngineContextValue>(
    () => ({ ready: status === 'ready', status, mode, errorMessage, run, retry, webViewMounts }),
    [status, mode, errorMessage, run, retry, webViewMounts],
  );

  return (
    <EngineContext.Provider value={value}>
      {children}
      {source && (
        <View pointerEvents="none" style={styles.hidden}>
          <MountProbe onMount={countMount} />
          <WebView
            ref={webRef}
            source={source}
            originWhitelist={['*']}
            javaScriptEnabled
            allowFileAccess
            allowFileAccessFromFileURLs
            allowUniversalAccessFromFileURLs
            domStorageEnabled
            onMessage={onMessage}
            onError={(e) => onBootFailure(`webview error: ${e.nativeEvent.description}`)}
            onHttpError={(e) => onBootFailure(`webview http ${e.nativeEvent.statusCode}`)}
            onRenderProcessGone={() => {
              // The page (and its OpenCV heap) is gone and the WebView cannot be reused: drop it and rerun
              // startup, which mounts a fresh one. This is the only recovery path besides retry().
              bridge.markNotReady();
              setSource(null);
              setStartCount((n) => n + 1);
            }}
            style={styles.hidden}
          />
        </View>
      )}
    </EngineContext.Provider>
  );
}

/** Mounts and unmounts together with the WebView it sits next to, so the mount count is exact. */
function MountProbe({ onMount }: { onMount: () => void }) {
  useEffect(() => {
    onMount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

export function useEngine(): EngineContextValue {
  const ctx = useContext(EngineContext);
  if (!ctx) throw new Error('useEngine must be used inside <EngineProvider>');
  return ctx;
}

const styles = StyleSheet.create({
  hidden: {
    position: 'absolute',
    width: ENGINE_VIEW_SIZE,
    height: ENGINE_VIEW_SIZE,
    opacity: 0,
  },
});
