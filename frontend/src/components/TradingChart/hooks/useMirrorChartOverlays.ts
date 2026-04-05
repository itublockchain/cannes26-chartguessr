import { useEffect, type RefObject } from "react";
import type { IChartApi } from "lightweight-charts";
import type { ResolvedTradingChartGameConfig } from "../types";
import { layoutGamePhaseOverlays } from "../utils/layoutGamePhaseOverlays";

/**
 * Keeps opponent mirror phase lines / tinted regions aligned with the chart time scale.
 */
export function useMirrorChartOverlays(
  chartRef: RefObject<IChartApi | null>,
  chartAreaRef: RefObject<HTMLDivElement | null>,
  lineT0Ref: RefObject<HTMLDivElement | null>,
  lineObsEndRef: RefObject<HTMLDivElement | null>,
  lineTahminEndRef: RefObject<HTMLDivElement | null>,
  lineRoundEndRef: RefObject<HTMLDivElement | null>,
  gameTahminBgRef: RefObject<HTMLDivElement | null>,
  gameBgRef: RefObject<HTMLDivElement | null>,
  anchorLogical: number | null | undefined,
  gameConfig: ResolvedTradingChartGameConfig,
): void {
  useEffect(() => {
    const chart = chartRef.current;
    const area = chartAreaRef.current;
    if (!chart || !area || anchorLogical == null) return;

    const collectElements = () => ({
      lineT0: lineT0Ref.current,
      lineObsEnd: lineObsEndRef.current,
      lineTahminEnd: lineTahminEndRef.current,
      lineRoundEnd: lineRoundEndRef.current,
      gameTahminBgArea: gameTahminBgRef.current,
      gameBgArea: gameBgRef.current,
    });

    const run = () => {
      const c = chartRef.current;
      const a = chartAreaRef.current;
      if (!c || !a) return;
      layoutGamePhaseOverlays(c, a, collectElements(), anchorLogical, gameConfig);
    };

    run();
    chart.timeScale().subscribeVisibleLogicalRangeChange(run);
    chart.timeScale().subscribeVisibleTimeRangeChange(run);
    chart.timeScale().subscribeSizeChange(run);
    const ro = new ResizeObserver(run);
    ro.observe(area);
    return () => {
      ro.disconnect();
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(run);
      chart.timeScale().unsubscribeVisibleTimeRangeChange(run);
      chart.timeScale().unsubscribeSizeChange(run);
    };
  }, [chartRef, chartAreaRef, anchorLogical, gameConfig]); // eslint-disable-line react-hooks/exhaustive-deps -- overlay refs are stable useRef handles
}
