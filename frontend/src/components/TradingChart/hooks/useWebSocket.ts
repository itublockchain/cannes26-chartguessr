import { useEffect, useRef } from "react";
import type {
  ISeriesApi,
  IChartApi,
  LineData,
  Time,
  UTCTimestamp,
  WhitespaceData,
} from "lightweight-charts";
import type { Candle1s, ResolvedTradingChartGameConfig } from "../types";
import { toLW, fillCandleGaps, candlesToLine } from "../utils/candles";
import { SeriesAnimator } from "../utils/seriesAnimator";

interface UseWebSocketParams {
  wsUrl: string;
  coin: string;
  chartRef: React.RefObject<IChartApi | null>;
  seriesRef: React.RefObject<ISeriesApi<"Area"> | null>;
  lastTimeRef: React.MutableRefObject<number | null>;
  gameStartTimeRef: React.MutableRefObject<number | null>;
  gameStartPriceRef: React.MutableRefObject<number | null>;
  gameObservationEndTimeRef: React.MutableRefObject<number | null>;
  gameTahminEndTimeRef: React.MutableRefObject<number | null>;
  gameBrushZoneEndTimeRef: React.MutableRefObject<number | null>;
  roundAnchorLogicalRef: React.MutableRefObject<number | null>;
  fixedLogicalRangeRef: React.MutableRefObject<{
    from: number;
    to: number;
  } | null>;
  /** Dikey eksen snapshot ile kilitlenince doldurulur; plugin/layout sonrası yeniden uygulamak için */
  fixedPriceRangeRef: React.MutableRefObject<{
    from: number;
    to: number;
  } | null>;
  gameConfig: ResolvedTradingChartGameConfig;
  onSnapshotLoaded: () => void;
  onCandleTick: () => void;
  /** Çizim sırasında true: fiyat bandı canlı mumlarla güncellenmez. */
  pauseLivePriceRangeRef: React.MutableRefObject<boolean>;
  /** Gecikmeli yeniden ölçekleme; hook içinde atanır. */
  flushLivePriceRangeRef: React.MutableRefObject<(() => void) | null>;
  /** Fırça görünümü animate edilirken zaman eksenini WS ile ezmeyi kes */
  viewportAnimationActiveRef: React.MutableRefObject<boolean>;
  /** Bir kez: gerçek tur başlangıcı ve bitişi (rakip/ayna grafik senkronu için). */
  onGameRoundWindowKnown?: (start: number, end: number) => void;
}

/** Zaman + fiyat görünümünü tek seferde sabitler (mum güncellemesi sonrası kütüphane kaydırmasını geri alır). */
export function applyLockedViewport(
  chart: IChartApi,
  series: ISeriesApi<"Area">,
  logical: { from: number; to: number },
  price: { from: number; to: number } | null,
) {
  try {
    chart.timeScale().setVisibleLogicalRange(logical);
    const ps = series.priceScale();
    ps.setAutoScale(false);
    if (price) {
      ps.setVisibleRange(price);
    }
  } catch {
    /* series/chart already detached during teardown */
  }
}

const WIDTH_MATCH_EPS = 0.08;

/**
 * Zaman ekseni: tur sonu (game.to) sağ sınır — ötesine kaydırma yok.
 * Sola geçmiş; oyun süresi kadar genişlikte görünümde saga en fazla [game.from, game.to] odak.
 */
export function clampVisibleLogicalToGamePan(
  cur: { from: number; to: number },
  gameWindow: { from: number; to: number },
): { from: number; to: number } {
  const rightLimit = gameWindow.to;
  const leftLimit = gameWindow.from;
  const W = rightLimit - leftLimit;

  const wv = cur.to - cur.from;
  if (!Number.isFinite(wv) || wv <= 1e-9) {
    return { from: leftLimit, to: rightLimit };
  }

  let to = Math.min(cur.to, rightLimit);
  let from = to - wv;

  if (from < leftLimit) {
    from = leftLimit;
    to = from + wv;
    if (to > rightLimit) {
      to = rightLimit;
      from = to - wv;
      if (from < leftLimit) from = leftLimit;
    }
  }

  if (Math.abs(wv - W) < WIDTH_MATCH_EPS && from > leftLimit) {
    from = leftLimit;
    to = from + wv;
    if (to > rightLimit) {
      to = rightLimit;
      from = to - wv;
    }
  }

  return { from, to };
}

/** Fırça bandı başlar (T0 + obs + tahmin) — mantıksal indeks */
export function brushZoneLogicalFrom(
  anchorLogical: number,
  gameConfig: ResolvedTradingChartGameConfig,
): number {
  return anchorLogical + gameConfig.tahminEndOffsetBars;
}

/** Fırça bandı biter (tur sonu) — mantıksal indeks */
export function brushZoneLogicalTo(
  anchorLogical: number,
  gameConfig: ResolvedTradingChartGameConfig,
): number {
  return anchorLogical + gameConfig.brushZoneEndOffsetBars;
}

/** Yalnızca fırça / çizilebilir bant (varsayılan 60 mum) — kilit ekranı sol chart */
export function brushZoneOnlyLogicalRange(
  anchorLogical: number,
  gameConfig: ResolvedTradingChartGameConfig,
): { from: number; to: number } {
  return {
    from: brushZoneLogicalFrom(anchorLogical, gameConfig),
    to: brushZoneLogicalTo(anchorLogical, gameConfig),
  };
}

/** T0 → tur sonu: tüm oyun penceresi (gözlem + tahmin + fırça) */
export function fullRoundLogicalRange(
  anchorLogical: number,
  gameConfig: ResolvedTradingChartGameConfig,
): { from: number; to: number } {
  return {
    from: anchorLogical,
    to: anchorLogical + gameConfig.totalRoundSeconds,
  };
}

const BRUSH_VIEWPORT_ANIM_MS = 560;

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Çizilebilir bant tam olarak plot genişliğinin yarısı; sağ yarı boş (mantıksal olarak 2× bant genişliği).
 */
export function computeBrushZoneHalfScreenPanWindow(
  anchorLogical: number,
  gameConfig: ResolvedTradingChartGameConfig,
): { from: number; to: number } {
  const brushFrom = brushZoneLogicalFrom(anchorLogical, gameConfig);
  const brushTo = brushZoneLogicalTo(anchorLogical, gameConfig);
  const brushLen = Math.max(1e-6, brushTo - brushFrom);
  return { from: brushFrom, to: brushFrom + 2 * brushLen };
}

/**
 * Faz 3+ / kilit: çizim alanı solda ~%50, sağ ~%50 boşluk (anında).
 */
export function applyBrushZoneHalfScreenViewport(
  chart: IChartApi,
  series: ISeriesApi<"Area">,
  fixedLogicalRangeRef: React.MutableRefObject<{
    from: number;
    to: number;
  } | null>,
  anchorLogical: number | null,
  gameConfig: ResolvedTradingChartGameConfig,
  price: { from: number; to: number } | null,
): boolean {
  if (anchorLogical == null) return false;
  const panWindow = computeBrushZoneHalfScreenPanWindow(
    anchorLogical,
    gameConfig,
  );
  fixedLogicalRangeRef.current = panWindow;
  applyLockedViewport(chart, series, panWindow, price);
  scheduleReassertLockedViewport(chart, series, panWindow, price);
  return true;
}

/** @deprecated İsim geriye uyumluluk — `applyBrushZoneHalfScreenViewport` kullan */
export function applyBrushZoneViewportWithRightWhitespace(
  chart: IChartApi,
  series: ISeriesApi<"Area">,
  fixedLogicalRangeRef: React.MutableRefObject<{
    from: number;
    to: number;
  } | null>,
  anchorLogical: number | null,
  gameConfig: ResolvedTradingChartGameConfig,
  _chartContainerElement: HTMLElement | null,
  price: { from: number; to: number } | null,
): boolean {
  void _chartContainerElement;
  return applyBrushZoneHalfScreenViewport(
    chart,
    series,
    fixedLogicalRangeRef,
    anchorLogical,
    gameConfig,
    price,
  );
}

/**
 * Tam pencereden yarım ekran fırça görünümüne ease-out ile kaydır.
 */
export function animateBrushZoneHalfScreenViewport(
  chartRef: React.RefObject<IChartApi | null>,
  seriesRef: React.RefObject<ISeriesApi<"Area"> | null>,
  fixedLogicalRangeRef: React.MutableRefObject<{
    from: number;
    to: number;
  } | null>,
  fixedPriceRangeRef: React.MutableRefObject<{
    from: number;
    to: number;
  } | null>,
  anchorLogical: number | null,
  gameConfig: ResolvedTradingChartGameConfig,
  viewportAnimationActiveRef: React.MutableRefObject<boolean>,
  animRafRef: React.MutableRefObject<number | null>,
): boolean {
  const chart = chartRef.current;
  const series = seriesRef.current;
  if (!chart || !series || anchorLogical == null) return false;

  const target = computeBrushZoneHalfScreenPanWindow(anchorLogical, gameConfig);
  const start =
    chart.timeScale().getVisibleLogicalRange() ??
    fixedLogicalRangeRef.current ??
    target;

  if (animRafRef.current != null) {
    cancelAnimationFrame(animRafRef.current);
    animRafRef.current = null;
  }

  viewportAnimationActiveRef.current = true;
  const t0 = performance.now();

  const step = (now: number) => {
    const c = chartRef.current;
    const s = seriesRef.current;
    if (!c || !s) {
      viewportAnimationActiveRef.current = false;
      animRafRef.current = null;
      return;
    }
    const u = Math.min(1, (now - t0) / BRUSH_VIEWPORT_ANIM_MS);
    const e = easeOutCubic(u);
    const from = start.from + (target.from - start.from) * e;
    const to = start.to + (target.to - start.to) * e;
    c.timeScale().setVisibleLogicalRange({ from, to });

    if (u < 1) {
      animRafRef.current = requestAnimationFrame(step);
    } else {
      animRafRef.current = null;
      viewportAnimationActiveRef.current = false;
      const price = fixedPriceRangeRef.current;
      fixedLogicalRangeRef.current = target;
      applyLockedViewport(c, s, target, price);
      scheduleReassertLockedViewport(c, s, target, price);
    }
  };

  animRafRef.current = requestAnimationFrame(step);
  return true;
}

export function visibleLogicalForChartAfterTool(
  chart: IChartApi,
  gameWindow: { from: number; to: number } | null,
): { from: number; to: number } | null {
  if (!gameWindow) return null;
  const cur = chart.timeScale().getVisibleLogicalRange();
  if (!cur) return { from: gameWindow.from, to: gameWindow.to };
  return clampVisibleLogicalToGamePan(cur, gameWindow);
}

/** Veri span’ı çok dar ise mid etrafında simetrik genişlet (düşük volatilitede UX). */
function expandPriceRangeToMinSpan(
  minP: number,
  maxP: number,
  gameConfig: ResolvedTradingChartGameConfig,
): { minP: number; maxP: number } {
  const mid = (minP + maxP) / 2;
  let span = maxP - minP;
  const pct = gameConfig.priceScaleMinSpanPercent;
  const minSpanRel = Number.isFinite(pct) ? Math.abs(mid) * (pct / 100) : 0;
  const minSpanAbs = Math.max(0, gameConfig.priceScaleMinSpanAbsolute);
  const floorSpan = Math.max(minSpanRel, minSpanAbs);
  if (floorSpan <= 0) {
    return { minP, maxP };
  }
  if (!Number.isFinite(span) || span < floorSpan) {
    span = floorSpan;
    return { minP: mid - span / 2, maxP: mid + span / 2 };
  }
  return { minP, maxP };
}

/**
 * Dikey eksen: tüm geçmiş min/max mumları çok geniş aralık verir (mumlar çizgi gibi kalır).
 * Sadece T0 civarı oyun penceresi kadar son mumların OHLC’si ile sıkı aralık.
 */
function computePaddedPriceRange(
  minP: number,
  maxP: number,
  gameConfig: ResolvedTradingChartGameConfig,
): {
  from: number;
  to: number;
} {
  if (!Number.isFinite(minP) || !Number.isFinite(maxP)) {
    return { from: 0, to: 1 };
  }
  const expanded = expandPriceRangeToMinSpan(minP, maxP, gameConfig);
  const lo = expanded.minP;
  const hi = expanded.maxP;
  const span = hi - lo;
  const mid = (lo + hi) / 2;
  const pad =
    span > 0
      ? span * 0.15
      : Math.max(Math.abs(mid) * 0.002, Math.abs(lo) * 0.0001, 1);
  return { from: lo - pad, to: hi + pad };
}

function lockPriceScaleFromSnapshot(
  series: ISeriesApi<"Area">,
  candles: { high: number; low: number }[],
  fixedPriceRangeRef: React.MutableRefObject<{
    from: number;
    to: number;
  } | null>,
  gameConfig: ResolvedTradingChartGameConfig,
) {
  const n = candles.length;
  if (n === 0) return;
  const lookback = Math.min(
    n,
    gameConfig.totalRoundSeconds + gameConfig.observationSeconds + 30,
  );
  const slice = candles.slice(Math.max(0, n - lookback));
  let minP = Infinity;
  let maxP = -Infinity;
  for (const c of slice) {
    minP = Math.min(minP, c.low);
    maxP = Math.max(maxP, c.high);
  }
  const range = computePaddedPriceRange(minP, maxP, gameConfig);
  try {
    const ps = series.priceScale();
    ps.setAutoScale(false);
    ps.setVisibleRange(range);
  } catch {
    /* series detached */
  }
  fixedPriceRangeRef.current = range;
}

function isLineValuePoint(
  d: LineData<Time> | WhitespaceData<Time>,
): d is LineData<Time> {
  return (
    "value" in d && typeof d.value === "number" && Number.isFinite(d.value)
  );
}

function getLastLineDatum(
  series: ISeriesApi<"Area">,
): { time: number; value: number } | null {
  const raw = series.data();
  for (let i = raw.length - 1; i >= 0; i--) {
    const d = raw[i];
    if (isLineValuePoint(d)) {
      return { time: d.time as number, value: d.value };
    }
  }
  return null;
}

/**
 * Canlı mumlar: çizgi sadece kapanış; fitil (high/low) ekran dışına çıkmasın diye son OHLC ile genişletir.
 * Son N saniyelik pencereyi kullanır — fiyat uçunca ölçek otomatik uyum sağlar.
 */
/** Ana grafik ile aynı canlı mum bandı; ayna chart snapshot sonrası dual.priceRange ile kilitlememek için. */
export function refreshLockedPriceRangeFromLiveSeries(
  series: ISeriesApi<"Area">,
  fixedPriceRangeRef: React.MutableRefObject<{
    from: number;
    to: number;
  } | null>,
  gameConfig: ResolvedTradingChartGameConfig,
  liveBar?: { low: number; high: number } | null,
) {
  const raw = series.data();
  const points = raw.filter(isLineValuePoint);
  if (points.length === 0) return;

  const lookback = Math.min(
    points.length,
    gameConfig.totalRoundSeconds + gameConfig.observationSeconds + 30,
  );
  const slice = points.slice(-lookback);
  let minP = Infinity;
  let maxP = -Infinity;
  for (const p of slice) {
    minP = Math.min(minP, p.value);
    maxP = Math.max(maxP, p.value);
  }
  if (liveBar) {
    minP = Math.min(minP, liveBar.low);
    maxP = Math.max(maxP, liveBar.high);
  }
  if (!Number.isFinite(minP) || !Number.isFinite(maxP)) return;

  const range = computePaddedPriceRange(minP, maxP, gameConfig);
  try {
    const ps = series.priceScale();
    ps.setAutoScale(false);
    ps.setVisibleRange(range);
  } catch {
    /* series detached */
  }
  fixedPriceRangeRef.current = range;
}

/** Plugin (line-tools) chart.applyOptions sonrası zaman+fiyat görünümünü tekrar kilitle — mum takibi yok. */
export function scheduleReassertLockedViewport(
  chart: IChartApi,
  series: ISeriesApi<"Area">,
  logical: { from: number; to: number },
  price: { from: number; to: number } | null,
) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      applyLockedViewport(chart, series, logical, price);
    });
  });
}

/**
 * Line-tools `addLineTool` → `chart.applyOptions({})` tam invalidation; layout bazen 2 frame'den sonra oturuyor.
 * Anında + ardışık frame'lerde tekrar uygula (kaymayı keser).
 */
export function reassertViewportAfterLineToolsPlugin(
  chart: IChartApi,
  series: ISeriesApi<"Area">,
  logical: { from: number; to: number },
  price: { from: number; to: number } | null,
) {
  const snap = () => applyLockedViewport(chart, series, logical, price);
  snap();
  requestAnimationFrame(() => {
    snap();
    requestAnimationFrame(() => {
      snap();
      requestAnimationFrame(() => {
        snap();
        queueMicrotask(() => {
          requestAnimationFrame(snap);
        });
      });
    });
  });
}

/** T0 zamanına karşılık gelen mantıksal bar indeksi (setData sonrası yeniden hesap). */
function logicalIndexAtOrBeforeTime(
  filled: { time: UTCTimestamp }[],
  unixSeconds: number,
): number {
  if (filled.length === 0) return 0;
  let lo = 0;
  let hi = filled.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const mt = filled[mid].time as number;
    if (mt <= unixSeconds) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

/** setData / layout sonrası setVisible bazen kayar; zaman + fiyatı aynı anda tekrar kilitle (price null verme). */
function scheduleStabilizeVisibleRange(
  chart: IChartApi,
  series: ISeriesApi<"Area">,
  range: { from: number; to: number },
  price: { from: number; to: number } | null,
) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      applyLockedViewport(chart, series, range, price);
    });
  });
}

export function useWebSocket({
  wsUrl,
  coin,
  chartRef,
  seriesRef,
  lastTimeRef,
  gameStartTimeRef,
  gameStartPriceRef,
  gameObservationEndTimeRef,
  gameTahminEndTimeRef,
  gameBrushZoneEndTimeRef,
  roundAnchorLogicalRef,
  fixedLogicalRangeRef,
  fixedPriceRangeRef,
  gameConfig,
  onSnapshotLoaded,
  onCandleTick,
  pauseLivePriceRangeRef,
  flushLivePriceRangeRef,
  viewportAnimationActiveRef,
  onGameRoundWindowKnown,
}: UseWebSocketParams) {
  const wsRef = useRef<WebSocket | null>(null);
  const snapshotLoadedRef = useRef(false);
  const onRoundWindowCbRef = useRef(onGameRoundWindowKnown);
  useEffect(() => { onRoundWindowCbRef.current = onGameRoundWindowKnown; }, [onGameRoundWindowKnown]);

  useEffect(() => {
    if (!coin) return;

    if (!chartRef.current || !seriesRef.current) return;
    const chart: IChartApi = chartRef.current;
    const series: ISeriesApi<"Area"> = seriesRef.current;
    const lastLiveWickRef: { current: { low: number; high: number } | null } = {
      current: null,
    };

    /** Smooth price transition between ticks (300ms easeOutCubic). */
    const animator = new SeriesAnimator(series);

    /** Son kapanış; boş saniyelerde fiyatı open’a doğrusal köprüler. */
    let lastClose: number | null = null;

    const flushLivePriceRange = () => {
      const s = seriesRef.current;
      const c = chartRef.current;
      if (!s) return;
      refreshLockedPriceRangeFromLiveSeries(
        s,
        fixedPriceRangeRef,
        gameConfig,
        lastLiveWickRef.current,
      );
      const logicalLive = fixedLogicalRangeRef.current;
      if (c && logicalLive && !viewportAnimationActiveRef.current) {
        scheduleReassertLockedViewport(
          c,
          s,
          logicalLive,
          fixedPriceRangeRef.current,
        );
      }
    };
    flushLivePriceRangeRef.current = flushLivePriceRange;

    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let pingTimer: ReturnType<typeof setInterval> | null = null;

    function connectWs() {
      const socket = new WebSocket(wsUrl);
      wsRef.current = socket;

      socket.onopen = () => {
        socket.send(JSON.stringify({ method: "subscribe", coin }));
        pingTimer = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ method: "ping" }));
          }
        }, gameConfig.wsPingIntervalMs);
      };

      socket.onmessage = (event) => {
        const msg = JSON.parse(event.data);

        if (msg.type === "snapshot" && msg.data) {
          const arr = Array.isArray(msg.data) ? msg.data : [msg.data];
          const candles = (arr as Candle1s[])
            .map(toLW)
            .sort((a, b) => (a.time as number) - (b.time as number));

          const seen = new Set<number>();
          const unique = candles.filter((c) => {
            if (seen.has(c.time as number)) return false;
            seen.add(c.time as number);
            return true;
          });

          const filled = fillCandleGaps(unique);

          if (filled.length > 0) {
            const snapshotLast = filled[filled.length - 1].time as number;
            if (
              gameStartTimeRef.current !== null &&
              lastTimeRef.current !== null
            ) {
              lastTimeRef.current = Math.max(lastTimeRef.current, snapshotLast);
            } else {
              lastTimeRef.current = snapshotLast;
            }
            if (gameStartTimeRef.current === null) {
              const T0 = lastTimeRef.current;
              gameStartTimeRef.current = T0;
              gameStartPriceRef.current = filled[filled.length - 1].close;
              const cfg = gameConfig;
              gameObservationEndTimeRef.current = T0 + cfg.observationSeconds;
              gameTahminEndTimeRef.current =
                T0 + cfg.observationSeconds + cfg.tahminPhaseSeconds;
              const roundEnd = T0 + cfg.totalRoundSeconds;
              gameBrushZoneEndTimeRef.current = roundEnd;
              onRoundWindowCbRef.current?.(T0, roundEnd);
            }
          }

          /** T0 öncesi mumlar seride yok: oyun yalnızca başlangıç anındaki ve sonraki mumlarla çalışır. */
          const t0ForSeries = gameStartTimeRef.current;
          const roundEndSnap = gameBrushZoneEndTimeRef.current;
          const dataForChart =
            t0ForSeries !== null
              ? fillCandleGaps(
                  filled.filter((c) => {
                    const tm = c.time as number;
                    return (
                      tm >= t0ForSeries &&
                      (roundEndSnap === null || tm <= roundEndSnap)
                    );
                  }),
                )
              : filled;

          series.setData(candlesToLine(dataForChart));
          animator.reset();
          if (dataForChart.length > 0) {
            const lastCandle = dataForChart[dataForChart.length - 1];
            lastClose = lastCandle.close;
            lastTimeRef.current = lastCandle.time as number;
            // Seed the animator with the last snapshot value so the
            // first live tick animates smoothly from here.
            animator.snapTo(lastCandle.time as number, lastCandle.close);
          }
          const barCount = dataForChart.length;
          const t0 = gameStartTimeRef.current;
          const anchor =
            t0 !== null && barCount > 0
              ? logicalIndexAtOrBeforeTime(dataForChart, t0)
              : Math.max(0, barCount - 1);
          roundAnchorLogicalRef.current = anchor;
          const range = {
            from: anchor,
            to: anchor + gameConfig.totalRoundSeconds,
          };
          fixedLogicalRangeRef.current = range;
          lockPriceScaleFromSnapshot(
            series,
            dataForChart,
            fixedPriceRangeRef,
            gameConfig,
          );
          applyLockedViewport(chart, series, range, fixedPriceRangeRef.current);
          scheduleStabilizeVisibleRange(
            chart,
            series,
            range,
            fixedPriceRangeRef.current,
          );
          snapshotLoadedRef.current = true;
          onSnapshotLoaded();
        }

        if (msg.type === "candle1s" && msg.data && !Array.isArray(msg.data)) {
          const data = toLW(msg.data);
          const currTime = data.time as number;
          const roundEnd = gameBrushZoneEndTimeRef.current;

          const tail = getLastLineDatum(series);
          const seriesLastT = tail?.time ?? null;

          /** Tur bitti: seri veya ref zaten son mumda — ticaret yok */
          const endStopAt = seriesLastT ?? lastTimeRef.current;
          if (
            roundEnd !== null &&
            endStopAt !== null &&
            endStopAt >= roundEnd
          ) {
            return;
          }

          const targetTime =
            roundEnd !== null ? Math.min(currTime, roundEnd) : currTime;

          /** Geç veya sıra dışı WS tick: seriyi geri sarma / çift segment */
          if (seriesLastT !== null && targetTime < seriesLastT) {
            return;
          }

          const bridgeFrom = seriesLastT ?? lastTimeRef.current;
          if (bridgeFrom !== null && targetTime > bridgeFrom + 1) {
            const nMissing = targetTime - bridgeFrom - 1;
            const fromPrice =
              tail !== null && Number.isFinite(tail.value)
                ? tail.value
                : lastClose !== null && Number.isFinite(lastClose)
                  ? lastClose
                  : data.open;
            for (let j = 1; j <= nMissing; j++) {
              const t = bridgeFrom + j;
              const alpha = j / (nMissing + 1);
              // Gap-fill points snap instantly (no easing) to avoid visual lag
              animator.snapTo(t, fromPrice + (data.open - fromPrice) * alpha);
            }
          }

          /*
           * Perpetual animation loop: update the target value.
           * The always-running rAF loop will smoothly chase this via
           * exponential smoothing (low-pass filtered, ~60 FPS).
           */
          animator.setTarget(targetTime, data.close);
          lastClose = data.close;
          lastLiveWickRef.current = { low: data.low, high: data.high };
          lastTimeRef.current = targetTime;
          onCandleTick();

          if (snapshotLoadedRef.current) {
            // NOTE: Price scale is locked from snapshot.
            // Per-tick rescaling (refreshLockedPriceRangeFromLiveSeries)
            // and viewport reassertion (scheduleReassertLockedViewport)
            // are DISABLED here because they cause instant Y-axis jumps
            // that override the smooth price animation.
            // The price range is wide enough from snapshot to accommodate
            // the small live tick movements within the game round.
          }

          if (!snapshotLoadedRef.current) {
            if (gameStartTimeRef.current === null) {
              gameStartTimeRef.current = currTime;
              gameStartPriceRef.current = data.close;
              const T0 = currTime;
              gameObservationEndTimeRef.current =
                T0 + gameConfig.observationSeconds;
              gameTahminEndTimeRef.current =
                T0 +
                gameConfig.observationSeconds +
                gameConfig.tahminPhaseSeconds;
              const roundEnd = T0 + gameConfig.totalRoundSeconds;
              gameBrushZoneEndTimeRef.current = roundEnd;
              onRoundWindowCbRef.current?.(T0, roundEnd);
              const anchor = 0;
              roundAnchorLogicalRef.current = anchor;
              fixedLogicalRangeRef.current = {
                from: anchor,
                to: anchor + gameConfig.totalRoundSeconds,
              };
            }
            if (fixedLogicalRangeRef.current) {
              applyLockedViewport(
                chart,
                series,
                fixedLogicalRangeRef.current,
                null,
              );
            } else {
              chart.timeScale().setVisibleLogicalRange({
                from: gameConfig.fallbackVisibleFrom,
                to: gameConfig.fallbackVisibleTo,
              });
            }
            snapshotLoadedRef.current = true;
          }
        }
      };

      socket.onclose = () => {
        if (!cancelled) {
          reconnectTimer = setTimeout(connectWs, gameConfig.wsReconnectDelayMs);
        }
      };
    }

    connectWs();

    return () => {
      cancelled = true;
      animator.dispose();
      flushLivePriceRangeRef.current = null;
      if (pingTimer) clearInterval(pingTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (wsRef.current) wsRef.current.close();
    };
  }, [
    wsUrl,
    coin,
    chartRef,
    seriesRef,
    lastTimeRef,
    gameStartTimeRef,
    gameStartPriceRef,
    gameObservationEndTimeRef,
    gameTahminEndTimeRef,
    gameBrushZoneEndTimeRef,
    roundAnchorLogicalRef,
    fixedLogicalRangeRef,
    fixedPriceRangeRef,
    gameConfig,
    onSnapshotLoaded,
    onCandleTick,
    pauseLivePriceRangeRef,
    flushLivePriceRangeRef,
    viewportAnimationActiveRef,
  ]);
}
