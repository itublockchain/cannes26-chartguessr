import { useRef, useCallback, useEffect } from "react";
import type { DrawingPoint } from "../types";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import {
  createLineToolsPlugin,
  LineCap,
  LineJoin,
} from "lightweight-charts-line-tools-core";
import { registerLinesPlugin } from "lightweight-charts-line-tools-lines";
import { registerFreehandPlugin } from "lightweight-charts-line-tools-freehand";
import { registerFibRetracementPlugin } from "lightweight-charts-line-tools-fib-retracement";
import { ensurePolygonRendererClippedToPane } from "../utils/polygonRendererPaneClip";
import {
  ensureFreehandPaneViewsClamped,
  ensureFreehandPointToScreenClamped,
} from "../utils/freehandPaneViewClamp";
import { ensureSafeLineToolGetChart } from "../utils/safeLineToolGetChart";

ensurePolygonRendererClippedToPane();
ensureFreehandPointToScreenClamped();
ensureSafeLineToolGetChart();

/* Suppress noisy "[BaseLineTool] _requestUpdate is not set" warnings from line-tools-core.
   These fire harmlessly during HMR/teardown when a tool briefly outlives its chart binding. */
{
  const _origWarn = console.warn;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  console.warn = (...args: any[]) => {
    if (typeof args[0] === "string" && args[0].includes("_requestUpdate is not set")) return;
    if (typeof args[0] === "string" && args[0].includes("Chart API not available")) return;
    _origWarn.apply(console, args);
  };

  const _origError = console.error;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  console.error = (...args: any[]) => {
    if (typeof args[0] === "string" && args[0].includes("[InteractionManager] Error detaching primitive")) return;
    _origError.apply(console, args);
  };
}
import {
  applyLockedViewport,
  reassertViewportAfterLineToolsPlugin,
  visibleLogicalForChartAfterTool,
} from "./useWebSocket";

const LINE_TOOL_BRUSH_STROKE = "#f97316"; // orange-500
const LINE_TOOL_TREND_GRAY = "#94a3b8";

const LIVE_PRICE_RANGE_RESUME_MS = 1000;

/** Fırça: araç seçilir seçilmez değil — ilk pointerdown ile (otomatik arm’da fiyat takibi kilitlenmez). */
const PAUSE_PRICE_FOLLOW_ON_TOOL_ADD = new Set([
  "TrendLine",
  "Ray",
  "HorizontalLine",
  "FibRetracement",
]);

/** Toolbar: önceki aynı tür çizimi sil (varsayılan). Stroke bitince yeniden arm: false. */
export type AddToolOptions = {
  replacePreviousOfSameKind?: boolean;
};

/** Trend ↔ Yatay vb. geçişte yarım kalmış araç + applyOptions iki kez → rescale; önce creating sil. */
export function removeCreatingLineTools(
  lineTools: {
    removeLineToolsById: (ids: string[]) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _tools?: Map<string, any>;
  } | null,
): number {
  if (!lineTools?._tools) return 0;
  const ids: string[] = [];
  for (const [id, tool] of lineTools._tools) {
    if (typeof tool?.isCreating === "function" && tool.isCreating()) {
      ids.push(id);
    }
  }
  if (ids.length > 0) lineTools.removeLineToolsById(ids);
  return ids.length;
}

function removeFinishedToolsOfType(
  lineTools: {
    removeLineToolsById: (ids: string[]) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _tools?: Map<string, any>;
  },
  toolType: string,
) {
  if (!lineTools._tools) return;
  const ids: string[] = [];
  for (const [id, tool] of lineTools._tools) {
    if (tool?.toolType !== toolType) continue;
    const creating =
      typeof tool?.isCreating === "function" && tool.isCreating();
    if (!creating) ids.push(id);
  }
  if (ids.length > 0) lineTools.removeLineToolsById(ids);
}

/**
 * Çizim modundan çık / toolbar kapat: seçili tamamlanmış çizgileri silmez
 * (`removeSelectedLineTools` seçili olanı siler; toggle’da trend kayboluyordu).
 */
function deselectAllLineTools(lineTools: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _tools?: Map<string, any>;
  _interactionManager?: { deselectAllTools?: () => void };
}) {
  if (lineTools._tools) {
    for (const [, tool] of lineTools._tools) {
      if (
        typeof tool?.isSelected === "function" &&
        tool.isSelected() &&
        typeof tool.setSelected === "function"
      ) {
        tool.setSelected(false);
      }
    }
  }
  lineTools._interactionManager?.deselectAllTools?.();
}

/** Tamamlanmış fırça çizgileri taşınamaz; yeni `addLineTool('Brush')` yine `editable: true` ile başlar. */
export function freezeAllBrushStrokes(
  lineTools: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _tools?: Map<string, any>;
  } | null,
): void {
  if (!lineTools?._tools) return;
  for (const [, tool] of lineTools._tools) {
    if (tool?.toolType === "Brush" && typeof tool.applyOptions === "function") {
      tool.applyOptions({ editable: false });
    }
  }
}

/** Fırça (60 sn) alanı başlarken: trend, fib, yatay vb. silinir; fırça segmentleri kalır. */
export function removeNonBrushLineTools(
  lineTools: {
    removeLineToolsById: (ids: string[]) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _tools?: Map<string, any>;
  } | null,
): void {
  if (!lineTools?._tools) return;
  const ids: string[] = [];
  for (const [id, tool] of lineTools._tools) {
    if (tool?.toolType === "Brush") continue;
    ids.push(id);
  }
  if (ids.length > 0) lineTools.removeLineToolsById(ids);
}

interface UseLineToolsParams {
  chartRef: React.RefObject<IChartApi | null>;
  seriesRef: React.RefObject<ISeriesApi<"Area"> | null>;
  fixedLogicalRangeRef: React.MutableRefObject<{
    from: number;
    to: number;
  } | null>;
  /** Snapshot fiyat bandı; getVisibleRange geçici null iken oyun ölçeği korunur */
  fixedPriceRangeRef: React.MutableRefObject<{
    from: number;
    to: number;
  } | null>;
  /** Sadece fırça stroke bittiğinde çağrılır; trend/yatay oyunu etkilemez. */
  onDrawingComplete?: (points: DrawingPoint[]) => void;
  /** Fırça tamamlanınca (ör. araç seçimini sıfırlamak için). */
  onToolFinished?: (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    toolInfo: any,
  ) => void;
  /** Çizim değişince (debounce üst bileşende) localStorage senkronu */
  schedulePersistGameDrawingsRef?: React.MutableRefObject<(() => void) | null>;
  /** true iken canlı mumlar fiyat bandını genişletmez (çizim bitince + gecikme ile flush). */
  pauseLivePriceRangeRef: React.MutableRefObject<boolean>;
  flushLivePriceRangeRef: React.MutableRefObject<(() => void) | null>;
}

export function useLineTools({
  chartRef,
  seriesRef,
  fixedLogicalRangeRef,
  fixedPriceRangeRef,
  onDrawingComplete,
  onToolFinished,
  schedulePersistGameDrawingsRef,
  pauseLivePriceRangeRef,
  flushLivePriceRangeRef,
}: UseLineToolsParams) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lineToolsRef = useRef<any>(null);
  const onDrawingCompleteRef = useRef(onDrawingComplete);
  onDrawingCompleteRef.current = onDrawingComplete;
  const onToolFinishedRef = useRef(onToolFinished);
  onToolFinishedRef.current = onToolFinished;
  const resumeLivePriceFollowTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);

  const scheduleResumeLivePriceFollow = useCallback(() => {
    if (resumeLivePriceFollowTimerRef.current) {
      clearTimeout(resumeLivePriceFollowTimerRef.current);
    }
    resumeLivePriceFollowTimerRef.current = setTimeout(() => {
      resumeLivePriceFollowTimerRef.current = null;
      pauseLivePriceRangeRef.current = false;
      flushLivePriceRangeRef.current?.();
    }, LIVE_PRICE_RANGE_RESUME_MS);
  }, [pauseLivePriceRangeRef, flushLivePriceRangeRef]);

  useEffect(
    () => () => {
      if (resumeLivePriceFollowTimerRef.current) {
        clearTimeout(resumeLivePriceFollowTimerRef.current);
        resumeLivePriceFollowTimerRef.current = null;
      }
    },
    [],
  );

  const initLineTools = useCallback(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return null;

    const lineTools = createLineToolsPlugin(chart, series);
    lineToolsRef.current = lineTools;

    const originalLog = console.log;
    const originalWarn = console.warn;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    console.log = (...args: any[]) => {
      if (typeof args[0] === "string" && /registered line tool/i.test(args[0]))
        return;
      originalLog.apply(console, args);
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    console.warn = (...args: any[]) => {
      if (typeof args[0] === "string" && args[0].includes("_requestUpdate is not set"))
        return;
      originalWarn.apply(console, args);
    };
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registerLinesPlugin(lineTools as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registerFreehandPlugin(lineTools as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registerFibRetracementPlugin(lineTools as any);
    } finally {
      console.log = originalLog;
      console.warn = originalWarn;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    lineTools.subscribeLineToolsAfterEdit((params: any) => {
      const stage = params.stage;
      const toolInfo = params.selectedLineTool;

      if (
        stage === "lineToolFinished" &&
        toolInfo?.toolType === "Brush" &&
        toolInfo?.points?.length > 0
      ) {
        const logicalPoints: DrawingPoint[] = toolInfo.points.map(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (p: any) => ({
            timestamp: Number(p.timestamp ?? p.time),
            price: Number(p.price),
          }),
        );
        onDrawingCompleteRef.current?.(logicalPoints);
      }

      if (
        stage === "lineToolFinished" &&
        toolInfo?.toolType === "Brush" &&
        toolInfo?.id
      ) {
        const inst = lineToolsRef.current?._tools?.get(toolInfo.id);
        if (inst?.applyOptions) {
          inst.applyOptions({ editable: false });
        }
      }

      if (
        stage === "lineToolFinished" &&
        toolInfo?.toolType &&
        (toolInfo.toolType === "Brush" ||
          toolInfo.toolType === "TrendLine" ||
          toolInfo.toolType === "Ray" ||
          toolInfo.toolType === "HorizontalLine" ||
          toolInfo.toolType === "FibRetracement")
      ) {
        onToolFinishedRef.current?.(toolInfo);
        scheduleResumeLivePriceFollow();
      }

      if (
        (stage === "lineToolFinished" || stage === "lineToolEdited") &&
        schedulePersistGameDrawingsRef
      ) {
        schedulePersistGameDrawingsRef.current?.();
      }
    });

    return lineTools;
  }, [
    chartRef,
    seriesRef,
    schedulePersistGameDrawingsRef,
    scheduleResumeLivePriceFollow,
  ]);

  const addTool = useCallback(
    (toolKey: string, opts?: AddToolOptions) => {
      const chart = chartRef.current;
      const series = seriesRef.current;
      const game = fixedLogicalRangeRef.current;
      const logical = chart
        ? visibleLogicalForChartAfterTool(chart, game)
        : game;
      const priceSnap =
        series?.priceScale().getVisibleRange() ??
        fixedPriceRangeRef.current ??
        null;
      const lt = lineToolsRef.current;
      if (!lt) return;

      if (PAUSE_PRICE_FOLLOW_ON_TOOL_ADD.has(toolKey)) {
        if (resumeLivePriceFollowTimerRef.current) {
          clearTimeout(resumeLivePriceFollowTimerRef.current);
          resumeLivePriceFollowTimerRef.current = null;
        }
        pauseLivePriceRangeRef.current = true;
      } else if (toolKey === "Brush") {
        if (resumeLivePriceFollowTimerRef.current) {
          clearTimeout(resumeLivePriceFollowTimerRef.current);
          resumeLivePriceFollowTimerRef.current = null;
        }
        const chartApi = chartRef.current;
        if (chartApi) {
          const surface = chartApi.chartElement();
          const onFirstStrokeDown = () => {
            pauseLivePriceRangeRef.current = true;
          };
          surface.addEventListener("pointerdown", onFirstStrokeDown, {
            once: true,
          });
        }
      }

      if (logical && chart && series) {
        removeCreatingLineTools(lt);
        applyLockedViewport(chart, series, logical, priceSnap);
      }

      const replace = opts?.replacePreviousOfSameKind !== false;
      if (
        replace &&
        (toolKey === "Brush" ||
          toolKey === "TrendLine" ||
          toolKey === "Ray" ||
          toolKey === "HorizontalLine" ||
          toolKey === "FibRetracement")
      ) {
        removeFinishedToolsOfType(lt, toolKey);
      }

      if (toolKey === "Brush") {
        lt.addLineTool("Brush", undefined, {
          line: {
            color: LINE_TOOL_BRUSH_STROKE,
            width: 4,
            join: LineJoin.Bevel,
            cap: LineCap.Butt,
          },
        });
      } else if (toolKey === "Highlighter") {
        lt.addLineTool("Highlighter", undefined, {
          line: { join: LineJoin.Bevel, cap: LineCap.Butt },
        });
      } else if (
        toolKey === "TrendLine" ||
        toolKey === "Ray" ||
        toolKey === "HorizontalLine"
      ) {
        lt.addLineTool(toolKey, undefined, {
          line: { color: LINE_TOOL_TREND_GRAY },
          text: { font: { color: LINE_TOOL_TREND_GRAY } },
        });
      } else if (toolKey === "FibRetracement") {
        lt.addLineTool("FibRetracement");
      } else {
        lt.addLineTool(toolKey);
      }
      ensureFreehandPaneViewsClamped(lt);

      if (chart && series && logical) {
        applyLockedViewport(chart, series, logical, priceSnap);
        reassertViewportAfterLineToolsPlugin(chart, series, logical, priceSnap);
      }
      // LWC özellikle pressedMouseMove: açıkken ilk mousemove ile panı başlatır; line-tools aynı
      // mousedown'da scroll kapatsa da sıra yüzünden ilk jest kayboluyordu. Çizim moduna girişte kapat.
      if (chart) {
        chart.applyOptions({
          handleScroll: { pressedMouseMove: false },
        });
      }

      schedulePersistGameDrawingsRef?.current?.();
    },
    [
      chartRef,
      seriesRef,
      fixedLogicalRangeRef,
      fixedPriceRangeRef,
      schedulePersistGameDrawingsRef,
      pauseLivePriceRangeRef,
    ],
  );

  const removeSelected = useCallback(() => {
    lineToolsRef.current?.removeSelectedLineTools();
  }, []);

  /** Toolbar’da araç kapat: yarım çizimi iptal, seçimi kaldır, yatay kaydırmayı aç. */
  const deactivateDrawingMode = useCallback(() => {
    const lt = lineToolsRef.current;
    const chart = chartRef.current;
    if (lt) {
      removeCreatingLineTools(lt);
      deselectAllLineTools(lt);
    }
    chart?.applyOptions({
      handleScroll: { pressedMouseMove: true },
    });
    if (pauseLivePriceRangeRef.current) {
      scheduleResumeLivePriceFollow();
    }
  }, [chartRef, pauseLivePriceRangeRef, scheduleResumeLivePriceFollow]);

  const lockAllTools = useCallback(() => {
    if (lineToolsRef.current?._tools) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const [, tool] of lineToolsRef.current._tools as Map<string, any>) {
        if (tool.applyOptions) tool.applyOptions({ editable: false });
      }
    }
  }, []);

  const cleanup = useCallback(() => {
    try {
      lineToolsRef.current?.removeAllLineTools();
    } catch {
      // Swallow — series/chart may already be detached during teardown / HMR
    }
    lineToolsRef.current = null;
  }, []);

  return {
    lineToolsRef,
    initLineTools,
    addTool,
    removeSelected,
    deactivateDrawingMode,
    lockAllTools,
    cleanup,
  };
}
