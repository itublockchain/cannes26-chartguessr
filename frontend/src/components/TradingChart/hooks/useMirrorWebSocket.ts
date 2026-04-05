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
import { applyDualPaneChartChrome } from "../utils/chartTimeScale";
import {
  applyLockedViewport,
  brushZoneOnlyLogicalRange,
  refreshLockedPriceRangeFromLiveSeries,
  scheduleReassertLockedViewport,
} from "./useWebSocket";

export interface MirrorGameWindow {
  startTime: number;
  endTime: number;
}

/** Ana oyun grafiği kilitlenince sağ panel ile birebir hizalama. */
export interface ChartDualSync {
  anchorLogical: number;
  priceRange: { from: number; to: number };
  visibleLogical?: { from: number; to: number };
  barSpacing?: number;
}

function logicalRangeForDual(
  dual: ChartDualSync,
  gameConfig: ResolvedTradingChartGameConfig,
): { from: number; to: number } {
  return (
    dual.visibleLogical ??
    brushZoneOnlyLogicalRange(dual.anchorLogical, gameConfig)
  );
}

interface Params {
  wsUrl: string;
  coin: string;
  chartRef: React.RefObject<IChartApi | null>;
  seriesRef: React.RefObject<ISeriesApi<"Area"> | null>;
  gameConfig: ResolvedTradingChartGameConfig;
  /** Ana `TradingChart` ile aynı tur [T0, tur sonu]; yoksa snapshot “son mum = T0” hatası oluşur. */
  gameWindow?: MirrorGameWindow | null;
  dualSyncRef?: React.MutableRefObject<ChartDualSync | null>;
  dualSync?: ChartDualSync | null;
  /**
   * Ana grafik `fixedPriceRangeRef` — çift panelde salt okunur; sağdaki seri min/max’i
   * yerine her karede sol ile aynı görünür fiyat bandını kullanır (piksel dikey hiza).
   */
  mainChartPriceRangeRef?: React.MutableRefObject<{
    from: number;
    to: number;
  } | null> | null;
}

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

function computePaddedPriceRange(
  minP: number,
  maxP: number,
  gameConfig: ResolvedTradingChartGameConfig,
): { from: number; to: number } {
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

function applySyncedPriceRange(
  series: ISeriesApi<"Area">,
  dual: ChartDualSync,
  fixedPriceRangeRef: React.MutableRefObject<{
    from: number;
    to: number;
  } | null>,
) {
  const range = {
    from: dual.priceRange.from,
    to: dual.priceRange.to,
  };
  fixedPriceRangeRef.current = range;
  try {
    const ps = series.priceScale();
    ps.setAutoScale(false);
    ps.setVisibleRange(range);
  } catch {
    /* series detached */
  }
}

function resolveMirrorViewportPrice(
  mainChartPriceRangeRef: React.MutableRefObject<{
    from: number;
    to: number;
  } | null> | null | undefined,
  localPriceRangeRef: React.MutableRefObject<{
    from: number;
    to: number;
  } | null>,
): { from: number; to: number } | null {
  const fromMain = mainChartPriceRangeRef?.current;
  if (
    fromMain != null &&
    Number.isFinite(fromMain.from) &&
    Number.isFinite(fromMain.to) &&
    fromMain.to !== fromMain.from
  ) {
    return fromMain;
  }
  return localPriceRangeRef.current;
}

/**
 * Sonuç paneli: ana oyun grafiğiyle aynı WS protokolü; kilit fazında fırça bandı görünümü.
 */
export function useMirrorWebSocket({
  wsUrl,
  coin,
  chartRef,
  seriesRef,
  gameConfig,
  gameWindow,
  dualSyncRef,
  dualSync,
  mainChartPriceRangeRef,
}: Params) {
  const lastTimeRef = useRef<number | null>(null);
  const gameStartTimeRef = useRef<number | null>(null);
  const gameBrushZoneEndTimeRef = useRef<number | null>(null);
  const roundAnchorLogicalRef = useRef<number | null>(null);
  const fixedLogicalRangeRef = useRef<{ from: number; to: number } | null>(
    null,
  );
  const fixedPriceRangeRef = useRef<{ from: number; to: number } | null>(null);
  const snapshotLoadedRef = useRef(false);
  const wsRef = useRef<WebSocket | null>(null);

  const getDual = (): ChartDualSync | null =>
    dualSyncRef?.current ?? dualSync ?? null;

  const syncPriceFromMain = mainChartPriceRangeRef != null;

  /* Expose refs so the component can reassert viewport on container resize. */
  const viewportRefs = useRef({
    fixedLogicalRangeRef,
    fixedPriceRangeRef,
  });
  viewportRefs.current = {
    fixedLogicalRangeRef,
    fixedPriceRangeRef,
  };

  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    const dual = getDual();
    if (!chart || !series || !dual) return;

    roundAnchorLogicalRef.current = dual.anchorLogical;
    if (!snapshotLoadedRef.current) {
      const pm = resolveMirrorViewportPrice(
        mainChartPriceRangeRef,
        fixedPriceRangeRef,
      );
      if (!pm) {
        applySyncedPriceRange(series, dual, fixedPriceRangeRef);
      }
    }
    applyDualPaneChartChrome(chart, dual);
    const logical = logicalRangeForDual(dual, gameConfig);
    fixedLogicalRangeRef.current = logical;
    const price = resolveMirrorViewportPrice(
      mainChartPriceRangeRef,
      fixedPriceRangeRef,
    );
    applyLockedViewport(chart, series, logical, price);
    scheduleReassertLockedViewport(chart, series, logical, price);
  }, [
    chartRef,
    seriesRef,
    gameConfig,
    mainChartPriceRangeRef,
    syncPriceFromMain,
    dualSync?.anchorLogical,
    dualSync?.priceRange.from,
    dualSync?.priceRange.to,
    dualSync?.visibleLogical?.from,
    dualSync?.visibleLogical?.to,
    dualSync?.barSpacing,
  ]);

  useEffect(() => {
    if (!coin) return;
    if (!chartRef.current || !seriesRef.current) return;

    const ft0 = gameWindow?.startTime;
    const fEnd = gameWindow?.endTime;
    const useFixedRound =
      typeof ft0 === "number" &&
      Number.isFinite(ft0) &&
      typeof fEnd === "number" &&
      Number.isFinite(fEnd);

    lastTimeRef.current = null;
    roundAnchorLogicalRef.current = null;
    fixedLogicalRangeRef.current = null;
    fixedPriceRangeRef.current = null;
    snapshotLoadedRef.current = false;

    if (useFixedRound) {
      gameStartTimeRef.current = ft0;
      gameBrushZoneEndTimeRef.current = fEnd;
    } else {
      gameStartTimeRef.current = null;
      gameBrushZoneEndTimeRef.current = null;
    }

    const chart = chartRef.current;
    const series = seriesRef.current;
    const lastLiveWickRef: { current: { low: number; high: number } | null } =
      { current: null };

    let lastClose: number | null = null;

    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let pingTimer: ReturnType<typeof setInterval> | null = null;

    /** Smooth price transition for mirror chart. */
    const animator = new SeriesAnimator(series);

    const applyBrushViewport = () => {
      const c = chartRef.current;
      const s = seriesRef.current;
      if (!c || !s) return;

      const dual = getDual();
      if (dual) {
        roundAnchorLogicalRef.current = dual.anchorLogical;
        if (!snapshotLoadedRef.current) {
          const pm = resolveMirrorViewportPrice(
            mainChartPriceRangeRef,
            fixedPriceRangeRef,
          );
          if (!pm) {
            applySyncedPriceRange(s, dual, fixedPriceRangeRef);
          }
        }
        applyDualPaneChartChrome(c, dual);
      }

      const anchor = roundAnchorLogicalRef.current;
      if (anchor == null) return;
      const logical = dual
        ? logicalRangeForDual(dual, gameConfig)
        : brushZoneOnlyLogicalRange(anchor, gameConfig);
      fixedLogicalRangeRef.current = logical;
      const price = resolveMirrorViewportPrice(
        mainChartPriceRangeRef,
        fixedPriceRangeRef,
      );
      applyLockedViewport(c, s, logical, price);
      scheduleReassertLockedViewport(c, s, logical, price);
    };

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
            if (!useFixedRound) {
              if (
                gameStartTimeRef.current !== null &&
                lastTimeRef.current !== null
              ) {
                lastTimeRef.current = Math.max(
                  lastTimeRef.current,
                  snapshotLast,
                );
              } else {
                lastTimeRef.current = snapshotLast;
              }
              if (gameStartTimeRef.current === null) {
                const T0 = lastTimeRef.current;
                gameStartTimeRef.current = T0;
                gameBrushZoneEndTimeRef.current =
                  T0 + gameConfig.totalRoundSeconds;
              }
            }
          }

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
            animator.snapTo(lastCandle.time as number, lastCandle.close);
          }
          const barCount = dataForChart.length;
          const t0 = gameStartTimeRef.current;
          const dualOnSnap = getDual();
          const anchor =
            dualOnSnap != null
              ? dualOnSnap.anchorLogical
              : t0 !== null && barCount > 0
                ? logicalIndexAtOrBeforeTime(dataForChart, t0)
                : Math.max(0, barCount - 1);
          roundAnchorLogicalRef.current = anchor;
          if (dualOnSnap) {
            const pm = resolveMirrorViewportPrice(
              mainChartPriceRangeRef,
              fixedPriceRangeRef,
            );
            if (!pm) {
              applySyncedPriceRange(series, dualOnSnap, fixedPriceRangeRef);
            }
          } else {
            lockPriceScaleFromSnapshot(
              series,
              dataForChart,
              fixedPriceRangeRef,
              gameConfig,
            );
          }
          applyBrushViewport();
          const logical = fixedLogicalRangeRef.current;
          if (logical) {
            const price = resolveMirrorViewportPrice(
              mainChartPriceRangeRef,
              fixedPriceRangeRef,
            );
            scheduleStabilizeVisibleRange(chart, series, logical, price);
          }
          snapshotLoadedRef.current = true;
        }

        if (msg.type === "candle1s" && msg.data && !Array.isArray(msg.data)) {
          const data = toLW(msg.data);
          const currTime = data.time as number;
          const roundEnd = gameBrushZoneEndTimeRef.current;

          const tail = getLastLineDatum(series);
          const seriesLastT = tail?.time ?? null;

          const endStopAt = seriesLastT ?? lastTimeRef.current;
          if (roundEnd !== null && endStopAt !== null && endStopAt >= roundEnd) {
            return;
          }

          const targetTime =
            roundEnd !== null ? Math.min(currTime, roundEnd) : currTime;

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
              animator.snapTo(t, fromPrice + (data.open - fromPrice) * alpha);
            }
          }

          animator.setTarget(targetTime, data.close);
          lastClose = data.close;
          lastLiveWickRef.current = { low: data.low, high: data.high };
          lastTimeRef.current = targetTime;

          if (snapshotLoadedRef.current) {
            if (!syncPriceFromMain) {
              refreshLockedPriceRangeFromLiveSeries(
                series,
                fixedPriceRangeRef,
                gameConfig,
                lastLiveWickRef.current,
              );
            }
            applyBrushViewport();
          }

          if (!snapshotLoadedRef.current) {
            if (!useFixedRound && gameStartTimeRef.current === null) {
              const T0 = currTime;
              gameStartTimeRef.current = T0;
              gameBrushZoneEndTimeRef.current =
                T0 + gameConfig.totalRoundSeconds;
              roundAnchorLogicalRef.current = 0;
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
      if (pingTimer) clearInterval(pingTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (wsRef.current) wsRef.current.close();
    };
  }, [
    wsUrl,
    coin,
    chartRef,
    seriesRef,
    gameConfig,
    gameWindow?.startTime,
    gameWindow?.endTime,
    mainChartPriceRangeRef,
    syncPriceFromMain,
  ]);

  return { fixedLogicalRangeRef, fixedPriceRangeRef };
}
