import {
  useEffect,
  type MutableRefObject,
  type RefObject,
} from "react";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import type { ResolvedTradingChartGameConfig } from "../types";
import { applyChartTimeScaleStyle } from "../utils/chartTimeScale";
import {
  applyBrushZoneHalfScreenViewport,
  applyLockedViewport,
  brushZoneOnlyLogicalRange,
  clampVisibleLogicalToGamePan,
  scheduleReassertLockedViewport,
} from "./useWebSocket";

export interface UseTradingChartChartShellLayoutParams {
  chartRef: RefObject<IChartApi | null>;
  seriesRef: RefObject<ISeriesApi<"Area"> | null>;
  /** Chart mount target; effect bails early (subscriptions still attach) if null — matches prior TradingChart behavior. */
  chartContainerRef: RefObject<HTMLDivElement | null>;
  chartShellRef: RefObject<HTMLDivElement | null>;
  isLocked: boolean;
  hasResultSidePane: boolean;
  updateOverlays: () => void;
  redrawDevDrawingOverlay: () => void;
  fixedLogicalRangeRef: MutableRefObject<{ from: number; to: number } | null>;
  fixedPriceRangeRef: MutableRefObject<{ from: number; to: number } | null>;
  roundAnchorLogicalRef: MutableRefObject<number | null>;
  gameConfigRef: MutableRefObject<ResolvedTradingChartGameConfig>;
  isLockedRef: MutableRefObject<boolean>;
  hasResultSidePaneRef: MutableRefObject<boolean>;
  brushPanViewportAppliedRef: MutableRefObject<boolean>;
  viewportAnimationActiveRef: MutableRefObject<boolean>;
  brushViewportAnimRafRef: MutableRefObject<number | null>;
}

/**
 * Time-scale styling, right scale visibility, logical-range clamping, and shell resize
 * behavior for the main game chart.
 */
export function useTradingChartChartShellLayout(
  params: UseTradingChartChartShellLayoutParams,
): void {
  const {
    chartRef,
    seriesRef,
    chartContainerRef,
    chartShellRef,
    isLocked,
    hasResultSidePane,
    updateOverlays,
    redrawDevDrawingOverlay,
    fixedLogicalRangeRef,
    fixedPriceRangeRef,
    roundAnchorLogicalRef,
    gameConfigRef,
    isLockedRef,
    hasResultSidePaneRef,
    brushPanViewportAppliedRef,
    viewportAnimationActiveRef,
    brushViewportAnimRafRef,
  } = params;

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (isLocked && hasResultSidePane) {
      applyChartTimeScaleStyle(chart, "dualCompact");
    } else {
      applyChartTimeScaleStyle(chart, "full");
    }

    chart.applyOptions({
      rightPriceScale: {
        visible: !isLocked,
        autoScale: false,
        scaleMargins: { top: 0.2, bottom: 0.2 },
      },
    });

    /*
     * chart.applyOptions ile rightPriceScale değiştirildiğinde LW iç layout'u
     * yeniden hesaplar — bu mevcut setVisibleRange'i ezebilir.
     * Kilitli + çift panelde hemen fixedPriceRangeRef ile tekrar kilitle.
     */
    if (isLocked) {
      const ser = seriesRef.current;
      const logical = fixedLogicalRangeRef.current;
      const price = fixedPriceRangeRef.current;
      if (ser && logical && price) {
        applyLockedViewport(chart, ser, logical, price);
        scheduleReassertLockedViewport(chart, ser, logical, price);
      }
    }

    const rovId = requestAnimationFrame(() => {
      updateOverlays();
      requestAnimationFrame(() => redrawDevDrawingOverlay());
    });

    const container = chartContainerRef.current;
    if (!container) {
      return () => cancelAnimationFrame(rovId);
    }

    const bumpDevDrawingOverlay = () => {
      requestAnimationFrame(() => redrawDevDrawingOverlay());
    };

    const onLayout = () => {
      updateOverlays();
      bumpDevDrawingOverlay();
    };

    let applyingFixedRange = false;
    const EPS = 1e-4;
    const onLogicalRange = () => {
      updateOverlays();
      bumpDevDrawingOverlay();
      if (viewportAnimationActiveRef.current) return;
      const game = fixedLogicalRangeRef.current;
      if (!game || applyingFixedRange) return;
      const cur = chart.timeScale().getVisibleLogicalRange();
      if (!cur) return;
      const clamped = clampVisibleLogicalToGamePan(cur, game);
      const drift =
        Math.abs(clamped.from - cur.from) > EPS ||
        Math.abs(clamped.to - cur.to) > EPS;
      if (!drift) return;
      applyingFixedRange = true;
      const ser = seriesRef.current;
      if (ser) {
        applyLockedViewport(chart, ser, clamped, fixedPriceRangeRef.current);
      }
      applyingFixedRange = false;
    };

    chart.timeScale().subscribeVisibleLogicalRangeChange(onLogicalRange);
    chart.timeScale().subscribeVisibleTimeRangeChange(onLayout);
    chart.timeScale().subscribeSizeChange(onLayout);

    let shellResize: ResizeObserver | null = null;
    const shell = chartShellRef.current;
    if (shell) {
      shellResize = new ResizeObserver(() => {
        const cht = chartRef.current;
        const ser = seriesRef.current;
        const anchor = roundAnchorLogicalRef.current;
        const price = fixedPriceRangeRef.current;
        if (isLockedRef.current && cht && ser && anchor != null) {
          if (hasResultSidePaneRef.current) {
            const logical = fixedLogicalRangeRef.current;
            if (logical && price) {
              scheduleReassertLockedViewport(cht, ser, logical, price);
            }
          } else {
            const brushOnly = brushZoneOnlyLogicalRange(
              anchor,
              gameConfigRef.current,
            );
            fixedLogicalRangeRef.current = brushOnly;
            applyLockedViewport(cht, ser, brushOnly, price);
            scheduleReassertLockedViewport(cht, ser, brushOnly, price);
          }
        } else if (
          brushPanViewportAppliedRef.current &&
          cht &&
          ser &&
          anchor != null
        ) {
          applyBrushZoneHalfScreenViewport(
            cht,
            ser,
            fixedLogicalRangeRef,
            anchor,
            gameConfigRef.current,
            price,
          );
        } else if (cht && ser && fixedLogicalRangeRef.current && price) {
          scheduleReassertLockedViewport(
            cht,
            ser,
            fixedLogicalRangeRef.current,
            price,
          );
        }
        bumpDevDrawingOverlay();
      });
      shellResize.observe(shell);
    }

    return () => {
      shellResize?.disconnect();
      cancelAnimationFrame(rovId);
      if (brushViewportAnimRafRef.current != null) {
        cancelAnimationFrame(brushViewportAnimRafRef.current);
        brushViewportAnimRafRef.current = null;
      }
      viewportAnimationActiveRef.current = false;
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onLogicalRange);
      chart.timeScale().unsubscribeVisibleTimeRangeChange(onLayout);
      chart.timeScale().unsubscribeSizeChange(onLayout);
    };
  }, [
    isLocked,
    hasResultSidePane,
    chartRef,
    updateOverlays,
    seriesRef,
    chartContainerRef,
    chartShellRef,
    redrawDevDrawingOverlay,
    fixedLogicalRangeRef,
    fixedPriceRangeRef,
    roundAnchorLogicalRef,
    gameConfigRef,
    isLockedRef,
    hasResultSidePaneRef,
    brushPanViewportAppliedRef,
    viewportAnimationActiveRef,
    brushViewportAnimRafRef,
  ]);
}
