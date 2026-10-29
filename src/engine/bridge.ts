import type {
  EngineErrorCode,
  EngineMessage,
  EngineOpName,
  EnginePayload,
  EngineResult,
} from './types';

export const DEFAULT_TIMEOUT_MS = 30_000;

const FRIENDLY: Record<EngineErrorCode, string> = {
  NOT_READY: 'The scan engine is still warming up. Please try again in a moment.',
  TIMEOUT: 'That took too long. Try a smaller image or try again.',
  ENGINE_FAILED: 'The scan engine stopped unexpectedly. It is restarting, please try again.',
  BAD_RESPONSE: 'The scan engine sent something unexpected. Please try again.',
  UNKNOWN_OP: 'This action is not supported by the scan engine.',
  IMAGE_DECODE: 'This image could not be read. Try a different photo.',
  IMAGE_TOO_LARGE: 'This image is too large to process. Try a smaller one.',
  OP_FAILED: 'Something went wrong while processing the image. Please try again.',
};

export class EngineError extends Error {
  readonly code: EngineErrorCode;
  /** Safe to show to the user as-is. */
  readonly userMessage: string;

  constructor(code: EngineErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'EngineError';
    this.code = code;
    // A code this build does not know (a newer engine page, a bug) must still produce readable text.
    this.userMessage = FRIENDLY[code] ?? FRIENDLY.OP_FAILED;
  }
}

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: EngineError) => void;
  timer: ReturnType<typeof setTimeout>;
  js: string;
  sent: boolean;
};

/**
 * Request/response layer over the WebView. Requests carry an id; the engine page
 * answers with a message of the same id. Requests made before the engine is
 * ready are queued and sent when it is.
 */
export class EngineBridge {
  private pending = new Map<string, Pending>();
  private sender: ((js: string) => void) | null = null;
  private ready = false;
  private seq = 0;

  setSender(sender: ((js: string) => void) | null) {
    this.sender = sender;
  }

  markReady() {
    this.ready = true;
    this.pending.forEach((p) => this.flush(p));
  }

  /** The page went away (reload / fallback): in-flight requests can never be answered. */
  markNotReady() {
    this.ready = false;
    this.pending.forEach((p, id) => {
      if (p.sent) this.settle(id, (q) => q.reject(new EngineError('ENGINE_FAILED', 'page reloaded')));
    });
  }

  /** Feed a raw onMessage payload. Returns non-response events for the provider. */
  handleMessage(raw: string): Exclude<EngineMessage, { type: 'res' }> | null {
    let msg: EngineMessage;
    try {
      msg = JSON.parse(raw) as EngineMessage;
    } catch {
      return null;
    }
    // Anything that is not an object with a string `type` (null, numbers, arrays, stray pages) is ignored.
    if (!msg || typeof msg !== 'object' || typeof (msg as { type?: unknown }).type !== 'string') return null;
    if (msg.type !== 'res') return msg;
    if (typeof msg.id !== 'string') return null;

    if (msg.ok) {
      this.settle(msg.id, (p) => p.resolve(msg.result));
    } else {
      const code = msg.error?.code ?? 'OP_FAILED';
      this.settle(msg.id, (p) => p.reject(new EngineError(code, msg.error?.message)));
    }
    return null;
  }

  run<K extends EngineOpName>(
    op: K,
    payload: EnginePayload<K>,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<EngineResult<K>> {
    return new Promise<EngineResult<K>>((resolve, reject) => {
      const id = `r${++this.seq}`;
      const request = JSON.stringify({ id, op, payload });
      const entry: Pending = {
        resolve: resolve as (value: unknown) => void,
        reject,
        js: `window.__kiteReceive(${JSON.stringify(request)}); true;`,
        sent: false,
        timer: setTimeout(
          () => this.settle(id, (p) => p.reject(new EngineError('TIMEOUT', `${op} after ${timeoutMs}ms`))),
          timeoutMs,
        ),
      };
      this.pending.set(id, entry);
      if (this.ready) this.flush(entry);
    });
  }

  private flush(entry: Pending) {
    if (entry.sent || !this.sender) return;
    entry.sent = true;
    this.sender(entry.js);
  }

  private settle(id: string, fn: (p: Pending) => void) {
    const entry = this.pending.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(id);
    fn(entry);
  }
}
