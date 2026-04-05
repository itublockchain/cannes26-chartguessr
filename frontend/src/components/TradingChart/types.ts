import type { ReactNode } from "react";
import type { CandlestickData, UTCTimestamp } from "lightweight-charts";

export interface Candle1s {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  trades: number;
}

/** Oyun: gözlem (45) → tahmin penceresi (15, fırça zamanı) → çizilecek 60 sn bandı; eksen toplamı 120 sn. */
export interface TradingChartGameConfig {
  observationSeconds?: number;
  tahminPhaseSeconds?: number;
  brushTargetSeconds?: number;
  /** @deprecated — `observationSeconds` */
  predictionWindowSeconds?: number;
  /** @deprecated — yerine üçlü süre alanları */
  horizonSeconds?: number;
  predictionWindowBars?: number;
  horizonBars?: number;
  visibleBarsPast?: number;
  visibleBarsFuture?: number;
  fallbackVisibleFrom?: number;
  fallbackVisibleTo?: number;
  wsPingIntervalMs?: number;
  wsReconnectDelayMs?: number;
  brushRestartDelayMs?: number;
  brushInterpolationMaxGapExclusive?: number;
  overlayBottomPx?: number;
  timeframeLabel?: string;
  /**
   * Kilitli fiyat ekseninin minimum bant genişliği (mid fiyatın yüzdesi).
   * Düşük oynaklıkta span mikroskobik kalmasın; varsayılan ~BTC 1s için uygun.
   */
  priceScaleMinSpanPercent?: number;
  /** Opsiyonel mutlak minimum span (coin fiyatına göre); 0 = yalnızca yüzde kullan. */
  priceScaleMinSpanAbsolute?: number;
}

export interface ResolvedTradingChartGameConfig {
  observationSeconds: number;
  tahminPhaseSeconds: number;
  brushTargetSeconds: number;
  totalRoundSeconds: number;
  predictionWindowSeconds: number;
  horizonSeconds: number;
  predictionWindowBars: number;
  horizonBars: number;
  /** Gözlem + tahmin sonu bar ofseti (T0’dan), 1s = sn */
  tahminEndOffsetBars: number;
  /** Tur sonu bar ofseti */
  brushZoneEndOffsetBars: number;
  visibleBarsPast: number;
  visibleBarsFuture: number;
  fallbackVisibleFrom: number;
  fallbackVisibleTo: number;
  wsPingIntervalMs: number;
  wsReconnectDelayMs: number;
  brushRestartDelayMs: number;
  brushInterpolationMaxGapExclusive: number;
  overlayBottomPx: number;
  timeframeLabel: string;
  priceScaleMinSpanPercent: number;
  priceScaleMinSpanAbsolute: number;
}

const GAME_DEFAULTS: Omit<
  ResolvedTradingChartGameConfig,
  | "observationSeconds"
  | "tahminPhaseSeconds"
  | "brushTargetSeconds"
  | "totalRoundSeconds"
  | "predictionWindowSeconds"
  | "horizonSeconds"
  | "predictionWindowBars"
  | "horizonBars"
  | "tahminEndOffsetBars"
  | "brushZoneEndOffsetBars"
> = {
  visibleBarsPast: 0,
  visibleBarsFuture: 0,
  fallbackVisibleFrom: -10,
  fallbackVisibleTo: 80,
  wsPingIntervalMs: 30_000,
  wsReconnectDelayMs: 2000,
  brushRestartDelayMs: 50,
  brushInterpolationMaxGapExclusive: 1000,
  overlayBottomPx: 26,
  timeframeLabel: "1s",
  /** ~66k BTC için ~106 USD taban bant (önceki 0.08’in 2×); çizim için daha geniş minimum ölçek */
  priceScaleMinSpanPercent: 0.04,
  priceScaleMinSpanAbsolute: 0,
};

export function resolveGameConfig(
  partial?: TradingChartGameConfig,
): ResolvedTradingChartGameConfig {
  const obs =
    partial?.observationSeconds ?? partial?.predictionWindowSeconds ?? 45;
  const tah = partial?.tahminPhaseSeconds ?? 15;
  const brush = partial?.brushTargetSeconds ?? 15;
  const total = obs + tah + brush;

  return {
    ...GAME_DEFAULTS,
    observationSeconds: obs,
    tahminPhaseSeconds: tah,
    brushTargetSeconds: brush,
    totalRoundSeconds: total,
    predictionWindowSeconds: obs,
    horizonSeconds: total,
    predictionWindowBars: partial?.predictionWindowBars ?? obs,
    horizonBars: partial?.horizonBars ?? total,
    tahminEndOffsetBars: obs + tah,
    brushZoneEndOffsetBars: total,
    visibleBarsPast: partial?.visibleBarsPast ?? GAME_DEFAULTS.visibleBarsPast,
    visibleBarsFuture:
      partial?.visibleBarsFuture ?? GAME_DEFAULTS.visibleBarsFuture,
    fallbackVisibleFrom:
      partial?.fallbackVisibleFrom ?? GAME_DEFAULTS.fallbackVisibleFrom,
    fallbackVisibleTo:
      partial?.fallbackVisibleTo ?? GAME_DEFAULTS.fallbackVisibleTo,
    wsPingIntervalMs:
      partial?.wsPingIntervalMs ?? GAME_DEFAULTS.wsPingIntervalMs,
    wsReconnectDelayMs:
      partial?.wsReconnectDelayMs ?? GAME_DEFAULTS.wsReconnectDelayMs,
    brushRestartDelayMs:
      partial?.brushRestartDelayMs ?? GAME_DEFAULTS.brushRestartDelayMs,
    brushInterpolationMaxGapExclusive:
      partial?.brushInterpolationMaxGapExclusive ??
      GAME_DEFAULTS.brushInterpolationMaxGapExclusive,
    overlayBottomPx: partial?.overlayBottomPx ?? GAME_DEFAULTS.overlayBottomPx,
    timeframeLabel: partial?.timeframeLabel ?? GAME_DEFAULTS.timeframeLabel,
    priceScaleMinSpanPercent:
      partial?.priceScaleMinSpanPercent ??
      GAME_DEFAULTS.priceScaleMinSpanPercent,
    priceScaleMinSpanAbsolute:
      partial?.priceScaleMinSpanAbsolute ??
      GAME_DEFAULTS.priceScaleMinSpanAbsolute,
  };
}

/** Fırça stroke bittiğinde: unix saniye (chart timezone) + fiyat — viewport’tan bağımsız */
export interface DrawingPoint {
  timestamp: number;
  price: number;
}

/** Toolbar çizim modu — `activeTool` ile senkron; dışarıdan koşul dinlemek için. */
export interface DrawingToolbarState {
  activeDrawingToolKey: string | null;
  /** Herhangi bir çizim aracı seçili / açık mı */
  isEngaged: boolean;
}

export interface TradingChartProps {
  wsUrl: string;
  coin?: string;
  gameConfig?: TradingChartGameConfig;
  /** SSE-driven phase override: 1=observing, 2=drawing, 3=resolution */
  externalPhase?: 1 | 2 | 3;
  /** Yalnızca fırça stroke tamamlandığında; trend/yatay çizimler tetiklemez. */
  onDrawingComplete?: (points: DrawingPoint[]) => void;
  onGameStateChange?: (state: "drawing" | "locked" | "scored") => void;
  /** Sol toolbar: hangi çizim aracı açık (`null` = kapalı). Aynı butona tekrar tıklanınca kapanır. */
  onDrawingToolbarChange?: (state: DrawingToolbarState) => void;
  className?: string;
  /**
   * Oyun kilitlendiğinde sağ yarım panelde gösterilir (ör. rakip özeti / ayna grafik).
   * Yalnızca `isLocked` iken mount edilir.
   */
  resultSidePane?: ReactNode;
  /**
   * İlk tur zaman penceresi netleşince (T0 + tur sonu unix sn). Sağ ayna grafik aynı aralığı kullanır.
   */
  onGameRoundWindowKnown?: (window: {
    startTime: number;
    endTime: number;
  }) => void;
}

export interface ToolDef {
  key: string;
  title: string;
  svg: string;
  /** Klavye kısayolu gösterimi ve `title` içine (n) eki */
  shortcutKey?: string;
}

/**
 * Çizim araçlarının “şu an çizebilir miyim?” özeti — debug / bug izleme için.
 * `TradingChart` içinde güncellenir ve `console.log` ile dökülür.
 */
export interface DrawingCapabilityState {
  isLocked: boolean;
  gamePhase: 1 | 2 | 3;
  activeTool: string | null;
  pendingTool: string | null;
  hasChart: boolean;
  hasSeries: boolean;
  hasLineToolsPlugin: boolean;
  hasGameLogicalRange: boolean;
  /** Chart + seri + line-tools plugin + oyun mantıksal aralığı hazır mı */
  chartReadyForLineTools: boolean;
  /** Faz 2 veya chart debug (Shift+B) — fırça butonu mantığı */
  brushAllowed: boolean;
  /** Shift+B: faz kilidi olmadan fırça + nokta overlay */
  chartDebugMode: boolean;
  /** Trend / yatay: kilit yok ve chart hazırsa çizim yapılabilir */
  canDrawTrendOrHorizontal: boolean;
  /** Fırça: faz izni + chart hazır + araç Brush (veya pending Brush) */
  canDrawBrush: boolean;
}

export type LWCandle = CandlestickData<UTCTimestamp>;
