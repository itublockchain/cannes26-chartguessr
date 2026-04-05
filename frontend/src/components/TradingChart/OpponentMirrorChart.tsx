import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type MutableRefObject,
} from "react";
import type {
  IChartApiBase,
  ISeriesApi,
  SeriesType,
  UTCTimestamp,
} from "lightweight-charts";
import { useChartSetup } from "./hooks/useChartSetup";
import { useMirrorWebSocket } from "./hooks/useMirrorWebSocket";
import { useMirrorChartOverlays } from "./hooks/useMirrorChartOverlays";
import { resolveGameConfig, type TradingChartGameConfig, type DrawingPoint } from "./types";
import { drawingPointToPanePixel } from "./utils/devDrawingPointsCanvas";
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
  /** Opponent's drawing points to overlay on the chart */
  opponentDrawing?: DrawingPoint[] | null;
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
  opponentDrawing,
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
    hideRightPriceScale: true,
    lastValueVisible: true,
    disableChartScroll: true,
  });
  useMirrorWebSocket({
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

  // --- Opponent drawing overlay ---
  const drawingCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const redrawOpponentOverlay = useCallback(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    const shell = chartShellRef.current;
    const canvas = drawingCanvasRef.current;
    if (!chart || !series || !shell || !canvas || !opponentDrawing || opponentDrawing.length === 0) {
      if (canvas) {
        const ctx = canvas.getContext("2d");
        ctx?.clearRect(0, 0, canvas.width, canvas.height);
      }
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    const w = shell.clientWidth;
    const h = shell.clientHeight;
    if (w <= 0 || h <= 0) return;

    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const panes = (chart as IChartApiBase<UTCTimestamp>).panes();
    const paneEl = panes[0]?.getHTMLElement?.() ?? null;
    if (!paneEl) return;

    const shellRect = shell.getBoundingClientRect();
    const paneRect = paneEl.getBoundingClientRect();
    const ox = paneRect.left - shellRect.left;
    const oy = paneRect.top - shellRect.top;

    // Draw as a connected line
    const pixels: { x: number; y: number }[] = [];
    for (const p of opponentDrawing) {
      const c = drawingPointToPanePixel(
        chart as IChartApiBase<UTCTimestamp>,
        series as ISeriesApi<SeriesType, UTCTimestamp>,
        p.timestamp,
        p.price,
      );
      if (c) pixels.push({ x: ox + c.x, y: oy + c.y });
    }

    if (pixels.length < 2) return;

    ctx.strokeStyle = "rgba(239, 68, 68, 0.9)"; // red for opponent
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(pixels[0].x, pixels[0].y);
    for (let i = 1; i < pixels.length; i++) {
      ctx.lineTo(pixels[i].x, pixels[i].y);
    }
    ctx.stroke();
  }, [chartRef, seriesRef, opponentDrawing]);

  // Redraw on chart time scale changes & crosshair moves
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !opponentDrawing || opponentDrawing.length === 0) return;

    redrawOpponentOverlay();

    chart.timeScale().subscribeVisibleLogicalRangeChange(redrawOpponentOverlay);
    chart.subscribeCrosshairMove(redrawOpponentOverlay);
    return () => {
      try {
        chart.timeScale().unsubscribeVisibleLogicalRangeChange(redrawOpponentOverlay);
        chart.unsubscribeCrosshairMove(redrawOpponentOverlay);
      } catch {
        /* chart may be destroyed before cleanup (Strict Mode / error boundary) */
      }
    };
  }, [chartRef, opponentDrawing, redrawOpponentOverlay]);

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
          <canvas
            ref={drawingCanvasRef}
            className={styles.drawingDebugCanvas}
            aria-hidden
          />
        </div>
      </div>
    </div>
  );
}
