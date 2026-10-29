export type Point = { x: number; y: number };
/** Page corners in image pixels, ordered TL, TR, BR, BL. */
export type Corners = [Point, Point, Point, Point];

export type BoardType = 'blackboard' | 'whiteboard' | 'paper';
export type EnhanceMode = 'original' | 'magic' | 'whiteboard' | 'document_bw' | 'blackboard';

/** Tunables shared by 'enhance' and 'pipeline'. All optional. */
export type EnhanceParams = {
  /** document_bw: adaptive threshold neighbourhood (odd, default 31). */
  blockSize?: number;
  /** document_bw: constant subtracted from the local mean (default 10). */
  C?: number;
  /** magic: CLAHE clip limit (default 2). */
  claheClip?: number;
  /** magic: sharpen / saturation amount; whiteboard: colour blend (default 1). */
  strength?: number;
};

export type ImageResult = {
  imageBase64: string;
  width: number;
  height: number;
  ms: number;
  /** Small preview (only when `thumbSide` was requested). */
  thumbBase64?: string;
  /** 256-bin grayscale histogram of the result (only when `wantHistogram` was requested). */
  histogram?: number[];
};

export type AnalyzeResult = {
  blurScore: number;
  isBlurry: boolean;
  boardType: BoardType;
  blurThreshold: number;
  brightness: number;
  /** Fraction of pixels crushed to black (<= 5 of 255) and blown to white (>= 250). */
  clipLow: number;
  clipHigh: number;
  medianBrightness: number;
  strokeFraction: number;
  colorFraction: number;
  backgroundSaturation: number;
  ms: number;
};

export type CannyThresholds = { low: number; high: number; /** true when derived from the median brightness */ auto: boolean };

export type DetectResult = {
  found: boolean;
  corners: Corners;
  imageWidth: number;
  imageHeight: number;
  /** Which source found the page, e.g. 'canny', 'canny-color', 'region-vs-frame', or 'none'. */
  strategy: string;
  /** How page-like the winning quad is (0..1). Below ~0.7 the corners deserve a second look. */
  score: number;
  /** Detected quad area as a fraction of the (500 px) frame. */
  areaFraction: number;
  /** Board type judged on the detected page (more reliable than analyze, which sees the whole frame). */
  boardType: BoardType;
  /** Canny thresholds that were actually used. */
  canny: CannyThresholds;
  /** Gaussian kernel size that was actually used. */
  blurKernel: number;
  ms: number;
};

/** Edge-detection tunables shared by 'detect' and 'pipeline'. */
export type DetectParams = {
  /** Canny hysteresis thresholds; give both to override the automatic ones. */
  cannyLow?: number;
  cannyHigh?: number;
  /** Gaussian blur kernel size (odd, 3 to 31, default 5). */
  blurKernel?: number;
};

/** Everything known about one scanned page, produced by a single 'autoScan' call. */
export type AutoScanResult = {
  analysis: Omit<AnalyzeResult, 'ms'>;
  /** Null when corners were supplied by the caller instead of being detected. */
  detection: Omit<DetectResult, 'ms' | 'imageWidth' | 'imageHeight'> | null;
  /** The corners that were used (detected or supplied), image pixels, TL,TR,BR,BL. */
  corners: Corners;
  /** The look that was actually applied ('auto' is resolved from the board type). */
  mode: EnhanceMode;
  warped: { imageBase64: string; width: number; height: number };
  final: { imageBase64: string; width: number; height: number };
  thumbBase64: string;
  /** 256-bit difference hash of the flattened page (64 hex characters). */
  fingerprint: string;
  histograms: { original: number[]; final: number[] };
  ms: number;
};

export type PipelineStep = {
  key: string;
  title: string;
  description: string;
  /** The OpenCV.js call(s) that produced this image, e.g. cv.Canny(blur, edges, 60, 120). */
  fn: string;
  imageBase64: string;
  width: number;
  height: number;
  ms: number;
};

export type PipelineResult = {
  mode: EnhanceMode;
  analysis: Omit<AnalyzeResult, 'ms'>;
  detection: { found: boolean; corners: Corners; strategy: string; canny: CannyThresholds; blurKernel: number };
  /** The parameter values the run actually used (automatic ones filled in). */
  params: { cannyLow: number; cannyHigh: number; cannyAuto: boolean; blurKernel: number; blockSize: number; C: number };
  steps: PipelineStep[];
  /** 256-bin grayscale histograms. */
  histograms: { original: number[]; final: number[] };
  timings: Record<string, number>;
  ms: number;
};

/** Every operation the engine understands: its payload and its result. */
export type EngineOps = {
  ping: {
    payload: Record<string, never>;
    result: { pong: true; cvVersion: string; ms: number };
  };
  grayscale: {
    payload: { imageBase64: string; quality?: number };
    result: ImageResult;
  };
  analyze: {
    payload: { imageBase64: string; blurThreshold?: number };
    result: AnalyzeResult;
  };
  detect: {
    payload: { imageBase64: string } & DetectParams;
    result: DetectResult;
  };
  warp: {
    payload: { imageBase64: string; corners: Corners; quality?: number };
    result: ImageResult;
  };
  enhance: {
    payload: { imageBase64: string; mode: EnhanceMode; quality?: number; thumbSide?: number; wantHistogram?: boolean } & EnhanceParams;
    result: ImageResult;
  };
  autoScan: {
    payload: {
      imageBase64: string;
      /** 'auto' (default) picks the look from the board type found on the flattened page. */
      mode?: EnhanceMode | 'auto';
      /** Skip detection and warp with these corners (used after a manual crop or a rotation). */
      corners?: Corners;
      quality?: number;
      /** Longest side of the thumbnail (default 240). */
      thumbSide?: number;
      blurThreshold?: number;
    } & EnhanceParams &
      DetectParams;
    result: AutoScanResult;
  };
  rotate: {
    /** degrees: multiples of 90, positive = clockwise */
    payload: { imageBase64: string; degrees: number; quality?: number };
    result: ImageResult;
  };
  pipeline: {
    payload: {
      imageBase64: string;
      /** 'auto' (default) picks from the analyzed board type. */
      mode?: EnhanceMode | 'auto';
      /** Skip detection and use these corners. */
      corners?: Corners;
      /** Longest side of intermediate step images (default 900). */
      stepMaxSide?: number;
      quality?: number;
      blurThreshold?: number;
    } & EnhanceParams &
      DetectParams;
    result: PipelineResult;
  };
};

export type EngineOpName = keyof EngineOps;
export type EnginePayload<K extends EngineOpName> = EngineOps[K]['payload'];
export type EngineResult<K extends EngineOpName> = EngineOps[K]['result'];

export type EngineErrorCode =
  | 'NOT_READY'
  | 'TIMEOUT'
  | 'ENGINE_FAILED'
  | 'BAD_RESPONSE'
  | 'UNKNOWN_OP'
  | 'IMAGE_DECODE'
  | 'IMAGE_TOO_LARGE'
  | 'OP_FAILED';

export type EngineStatus = 'preparing' | 'loading' | 'ready' | 'error';

/** How the engine page was loaded: from the copied file:// html, or with opencv.js inlined. */
export type EngineMode = 'file' | 'inline';

/** Messages the engine page posts back to React Native. */
export type EngineMessage =
  | { type: 'ready'; cvVersion: string }
  | { type: 'boot-error'; message: string }
  | { type: 'log'; message: string }
  | { type: 'res'; id: string; ok: true; result: unknown }
  | { type: 'res'; id: string; ok: false; error: { code: EngineErrorCode; message: string } };
