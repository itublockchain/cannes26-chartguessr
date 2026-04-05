import type { IChartApi } from "lightweight-charts";
import type { ResolvedTradingChartGameConfig } from "../types";

export type GamePhaseOverlayElements = {
  lineT0: HTMLElement | null;
  lineObsEnd: HTMLElement | null;
  lineTahminEnd: HTMLElement | null;
  lineRoundEnd: HTMLElement | null;
  gameTahminBgArea: HTMLElement | null;
  gameBgArea: HTMLElement | null;
};

/**
 * `useGameLogic` içindeki anchor seçili dal — sol / sağ panelde aynı faz çizgileri.
 */
export function layoutGamePhaseOverlays(
  chart: IChartApi,
  container: HTMLElement,
  elements: GamePhaseOverlayElements,
  anchorLogical: number,
  gameConfig: ResolvedTradingChartGameConfig,
): void {
  const rightScaleWidth = chart.priceScale("right").width();
  const maxVisibleX = container.clientWidth - rightScaleWidth;

  const updatePosition = (el: HTMLElement | null, x: number | null) => {
    if (!el) return;
    if (x === null || x < 0 || x > maxVisibleX) {
      el.style.display = "none";
    } else {
      el.style.display = "block";
      el.style.transform = `translateX(${x}px)`;
    }
  };

  const ts = chart.timeScale();
  const halfBar = ts.options().barSpacing / 2;
  const centerToBarLeft = (centerX: number | null): number | null => {
    if (centerX === null) return null;
    return centerX - halfBar;
  };

  const getXLogical = (offsetBars: number): number | null => {
    const cx = ts.logicalToCoordinate((anchorLogical + offsetBars) as never);
    return centerToBarLeft(cx);
  };

  updatePosition(elements.lineT0, getXLogical(0));
  updatePosition(
    elements.lineObsEnd,
    getXLogical(gameConfig.observationSeconds),
  );
  updatePosition(
    elements.lineTahminEnd,
    getXLogical(gameConfig.tahminEndOffsetBars),
  );
  updatePosition(
    elements.lineRoundEnd,
    getXLogical(gameConfig.brushZoneEndOffsetBars),
  );

  const xTahminBandStart = getXLogical(gameConfig.observationSeconds);
  const xTahminBandEnd = getXLogical(gameConfig.tahminEndOffsetBars);

  if (elements.gameTahminBgArea) {
    if (xTahminBandStart !== null && xTahminBandEnd !== null) {
      const clippedStartX = Math.max(
        0,
        Math.min(maxVisibleX, xTahminBandStart),
      );
      const clippedEndX = Math.max(0, Math.min(maxVisibleX, xTahminBandEnd));
      const bgWidth = clippedEndX - clippedStartX;
      if (bgWidth > 0) {
        elements.gameTahminBgArea.style.display = "block";
        elements.gameTahminBgArea.style.transform = `translateX(${clippedStartX}px)`;
        elements.gameTahminBgArea.style.width = `${bgWidth}px`;
      } else {
        elements.gameTahminBgArea.style.display = "none";
      }
    } else {
      elements.gameTahminBgArea.style.display = "none";
    }
  }

  if (elements.gameBgArea) {
    const xBrush = xTahminBandEnd;
    const xEnd = getXLogical(gameConfig.brushZoneEndOffsetBars);
    if (xBrush !== null && xEnd !== null) {
      const clippedStartX = Math.max(0, Math.min(maxVisibleX, xBrush));
      const clippedEndX = Math.max(0, Math.min(maxVisibleX, xEnd));
      const bgWidth = clippedEndX - clippedStartX;
      if (bgWidth > 0) {
        elements.gameBgArea.style.display = "block";
        elements.gameBgArea.style.transform = `translateX(${clippedStartX}px)`;
        elements.gameBgArea.style.width = `${bgWidth}px`;
      } else {
        elements.gameBgArea.style.display = "none";
      }
    } else {
      elements.gameBgArea.style.display = "none";
    }
  }
}
