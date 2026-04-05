import {
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type MutableRefObject,
} from "react";
import { useChartSetup } from "./hooks/useChartSetup";
import { useMirrorWebSocket } from "./hooks/useMirrorWebSocket";
import { useMirrorChartOverlays } from "./hooks/useMirrorChartOverlays";
import {
  applyLockedViewport,
  scheduleReassertLockedViewport,
} from "./hooks/useWebSocket";
import { resolveGameConfig, type TradingChartGameConfig } from "./types";
import type {
  ChartDualSync,
  MirrorGameWindow,
} from "./hooks/useMirrorWebSocket";
import styles from "./TradingChart.module.css";

export interface OpponentMirrorChartProps {
  wsUrl: string;
  coin?: string;
  gameConfig?: TradingChartGameConfig;
  /** Ana `TradingChart` ile aynı tur [T0, tur sonu]; veri ve eksen sol ile hizalanır. */
  gameWindow?: MirrorGameWindow | null;
  /** Ana grafik kilitlendiğinde tam senkron (mantıksal görünüm, fiyat, barSpacing, zaman formatı). */
  dualSync?: ChartDualSync | null;
  /** `TradingChart` içinden: ana grafiğin `fixedPriceRangeRef` — dikey ölçek birebir aynı olur. */
  mainChartPriceRangeRef?: MutableRefObject<{
    from: number;
    to: number;
  } | null> | null;
  /** Sağ fiyat eksenini göster (slide animasyonundan sonra en sağda sabit kalır). */
  showRightPriceScale?: boolean;
}

/**
 * Sonuç ekranı sağ panel: sol ile aynı mum akışı ve faz overlay’leri — çizim araçları yok.
 */
export function OpponentMirrorChart({
  wsUrl,
  coin = "BTC",
  gameConfig: gameConfigProp,
  gameWindow,
  dualSync,
  mainChartPriceRangeRef,
  showRightPriceScale = false,
}: OpponentMirrorChartProps) {
  const gameConfig = useMemo(
    () => resolveGameConfig(gameConfigProp),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(gameConfigProp ?? null)],
  );
  const chartAreaRef = useRef<HTMLDivElement>(null);
  const chartShellRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const lineT0Ref = useRef<HTMLDivElement>(null);
  const lineObsEndRef = useRef<HTMLDivElement>(null);
  const lineTahminEndRef = useRef<HTMLDivElement>(null);
  const lineRoundEndRef = useRef<HTMLDivElement>(null);
  const gameTahminBgRef = useRef<HTMLDivElement>(null);
  const gameBgRef = useRef<HTMLDivElement>(null);

  const dualSyncRef = useRef<ChartDualSync | null>(dualSync ?? null);
  dualSyncRef.current = dualSync ?? null;

  const { chartRef, seriesRef } = useChartSetup(containerRef, undefined, {
    hideRightPriceScale: !showRightPriceScale,
    lastValueVisible: true,
    disableChartScroll: true,
  });
  const { fixedLogicalRangeRef, fixedPriceRangeRef } = useMirrorWebSocket({
    wsUrl,
    coin,
    chartRef,
    seriesRef,
    gameConfig,
    gameWindow: gameWindow ?? null,
    dualSyncRef,
    dualSync: dualSync ?? null,
    mainChartPriceRangeRef: mainChartPriceRangeRef ?? null,
  });

  /** Çift panelde ana grafik `lastValueVisible: false` — halka / etiket farkı olmasın */
  useEffect(() => {
    const s = seriesRef.current;
    if (!s) return;
    s.applyOptions({ lastValueVisible: dualSync == null });
  }, [dualSync, seriesRef]);

  /**
   * CSS flex transition sırasında container boyut değiştirirken
   * lightweight-charts viewport'u sıfırlayabiliyor.
   * ResizeObserver ile her resize'da viewport'u tekrar kilitle.
   */
  useEffect(() => {
    const shell = chartShellRef.current;
    if (!shell) return;
    const ro = new ResizeObserver(() => {
      const chart = chartRef.current;
      const series = seriesRef.current;
      const logical = fixedLogicalRangeRef.current;
      const price = fixedPriceRangeRef.current;
      if (!chart || !series || !logical) return;
      applyLockedViewport(chart, series, logical, price);
      scheduleReassertLockedViewport(chart, series, logical, price);
    });
    ro.observe(shell);
    return () => ro.disconnect();
  }, [chartRef, seriesRef, fixedLogicalRangeRef, fixedPriceRangeRef]);

  useMirrorChartOverlays(
    chartRef,
    chartAreaRef,
    lineT0Ref,
    lineObsEndRef,
    lineTahminEndRef,
    lineRoundEndRef,
    gameTahminBgRef,
    gameBgRef,
    dualSync?.anchorLogical ?? null,
    gameConfig,
  );

  return (
    <div className={styles.opponentMirrorRoot}>
      <div className={styles.chartInfoBar} aria-label="Trading pair">
        {coin}/USDC
      </div>
      <div
        ref={chartAreaRef}
        className={styles.chartArea}
        style={
          {
            ["--trading-chart-overlay-bottom" as string]: `${gameConfig.overlayBottomPx}px`,
          } as CSSProperties
        }
      >
        <div
          ref={gameTahminBgRef}
          className={styles.gameTahminBgArea}
          aria-hidden
        />
        <div ref={gameBgRef} className={styles.gameBgArea} aria-hidden />
        <div ref={lineT0Ref} className={styles.gameStartLine} aria-hidden />
        <div ref={lineObsEndRef} className={styles.gameEndLine} aria-hidden />
        <div
          ref={lineTahminEndRef}
          className={styles.gameRedLine}
          aria-hidden
        />
        <div
          ref={lineRoundEndRef}
          className={styles.gameRoundEndLine}
          aria-hidden
        />
        <div ref={chartShellRef} className={styles.chartShell}>
          <div
            ref={containerRef}
            className={`${styles.chart} ${styles.chartScrollLocked}`}
            tabIndex={-1}
            aria-label="Grafik — fırça çizimi yok"
          />
        </div>
      </div>
    </div>
  );
}
