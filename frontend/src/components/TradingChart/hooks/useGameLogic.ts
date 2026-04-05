import { useRef, useCallback } from "react";
import type { IChartApi, UTCTimestamp } from "lightweight-charts";
import type { ResolvedTradingChartGameConfig } from "../types";

interface UseGameLogicParams {
  chartRef: React.RefObject<IChartApi | null>;
  /** T0 mumunun mantıksal indeksi (snapshot); çizgiler hep anchor+offset ile — zaman ekseni kaysa bile oyun alanı sabit */
  roundAnchorLogicalRef: React.MutableRefObject<number | null>;
  gameConfig: ResolvedTradingChartGameConfig;
  onGameStateChange?: (state: "drawing" | "locked" | "scored") => void;
}

export function useGameLogic({
  chartRef,
  roundAnchorLogicalRef,
  gameConfig,
  onGameStateChange,
}: UseGameLogicParams) {
  const gameStartTimeRef = useRef<number | null>(null);
  const gameStartPriceRef = useRef<number | null>(null);
  /** Gözlem biter / tahmin başlar (T0 + observation) */
  const gameObservationEndTimeRef = useRef<number | null>(null);
  /** Tahmin biter / 60sn çizilecek alan başlar (T0 + obs + tahmin) */
  const gameTahminEndTimeRef = useRef<number | null>(null);
  /** Tur eksen sonu T0 + 120 */
  const gameBrushZoneEndTimeRef = useRef<number | null>(null);
  const gameStartLogicalRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);

  const checkLockCondition = useCallback((): boolean => {
    if (lastTimeRef.current !== null && gameTahminEndTimeRef.current !== null) {
      if (lastTimeRef.current >= gameTahminEndTimeRef.current) {
        onGameStateChange?.("locked");
        return true;
      }
    }
    return false;
  }, [onGameStateChange]);

  const updateOverlayPositions = useCallback(
    (
      lineT0: HTMLDivElement | null,
      lineObsEnd: HTMLDivElement | null,
      lineTahminEnd: HTMLDivElement | null,
      lineRoundEnd: HTMLDivElement | null,
      gameTahminBgAreaEl: HTMLDivElement | null,
      gameBgAreaEl: HTMLDivElement | null,
      container: HTMLElement,
    ) => {
      const chart = chartRef.current;
      if (
        !chart ||
        !lineT0 ||
        !lineObsEnd ||
        !lineTahminEnd ||
        !lineRoundEnd ||
        gameStartTimeRef.current === null ||
        gameObservationEndTimeRef.current === null ||
        gameTahminEndTimeRef.current === null ||
        gameBrushZoneEndTimeRef.current === null
      )
        return;

      const rightScaleWidth = chart.priceScale("right").width();
      const maxVisibleX = container.clientWidth - rightScaleWidth;

      const updatePosition = (el: HTMLDivElement | null, x: number | null) => {
        if (!el) return;
        if (x === null || x < 0 || x > maxVisibleX) {
          el.style.display = "none";
        } else {
          el.style.display = "block";
          el.style.transform = `translateX(${x}px)`;
        }
      };

      const anchor = roundAnchorLogicalRef.current;
      const ts = chart.timeScale();
      /** Merkez → sol mum kenarı (çizgiler border-left ile bu x’te). */
      const halfBar = ts.options().barSpacing / 2;
      const centerToBarLeft = (centerX: number | null): number | null => {
        if (centerX === null) return null;
        return centerX - halfBar;
      };

      const getXLogical = (offsetBars: number): number | null => {
        if (anchor === null) return null;
        const cx = ts.logicalToCoordinate((anchor + offsetBars) as never);
        return centerToBarLeft(cx);
      };

      let startX: number | null = null;
      if (anchor !== null) {
        gameStartLogicalRef.current = anchor;
        startX = getXLogical(0);
      } else {
        const centerStart = ts.timeToCoordinate(
          gameStartTimeRef.current as UTCTimestamp,
        );
        if (centerStart !== null && gameStartLogicalRef.current === null) {
          gameStartLogicalRef.current = ts.coordinateToLogical(centerStart);
        }
        startX = centerToBarLeft(centerStart);
      }

      const getX = (
        timeRef: React.MutableRefObject<number | null>,
        offsetBars: number,
      ) => {
        if (anchor !== null) return getXLogical(offsetBars);
        let cx = ts.timeToCoordinate(timeRef.current as UTCTimestamp);
        if (cx === null && gameStartLogicalRef.current !== null) {
          cx = ts.logicalToCoordinate(
            (gameStartLogicalRef.current + offsetBars) as never,
          );
        }
        return centerToBarLeft(cx);
      };

      updatePosition(lineT0, startX);
      updatePosition(
        lineObsEnd,
        anchor !== null
          ? getXLogical(gameConfig.observationSeconds)
          : getX(gameObservationEndTimeRef, gameConfig.observationSeconds),
      );
      updatePosition(
        lineTahminEnd,
        anchor !== null
          ? getXLogical(gameConfig.tahminEndOffsetBars)
          : getX(gameTahminEndTimeRef, gameConfig.tahminEndOffsetBars),
      );
      updatePosition(
        lineRoundEnd,
        anchor !== null
          ? getXLogical(gameConfig.brushZoneEndOffsetBars)
          : getX(gameBrushZoneEndTimeRef, gameConfig.brushZoneEndOffsetBars),
      );

      const xTahminBandStart =
        anchor !== null
          ? getXLogical(gameConfig.observationSeconds)
          : getX(gameObservationEndTimeRef, gameConfig.observationSeconds);
      const xTahminBandEnd =
        anchor !== null
          ? getXLogical(gameConfig.tahminEndOffsetBars)
          : getX(gameTahminEndTimeRef, gameConfig.tahminEndOffsetBars);

      if (gameTahminBgAreaEl) {
        if (xTahminBandStart !== null && xTahminBandEnd !== null) {
          const clippedStartX = Math.max(
            0,
            Math.min(maxVisibleX, xTahminBandStart),
          );
          const clippedEndX = Math.max(
            0,
            Math.min(maxVisibleX, xTahminBandEnd),
          );
          const bgWidth = clippedEndX - clippedStartX;
          if (bgWidth > 0) {
            gameTahminBgAreaEl.style.display = "block";
            gameTahminBgAreaEl.style.transform = `translateX(${clippedStartX}px)`;
            gameTahminBgAreaEl.style.width = `${bgWidth}px`;
          } else {
            gameTahminBgAreaEl.style.display = "none";
          }
        } else {
          gameTahminBgAreaEl.style.display = "none";
        }
      }

      if (gameBgAreaEl) {
        const xBrush = xTahminBandEnd;
        const xEnd =
          anchor !== null
            ? getXLogical(gameConfig.brushZoneEndOffsetBars)
            : getX(gameBrushZoneEndTimeRef, gameConfig.brushZoneEndOffsetBars);
        if (xBrush !== null && xEnd !== null) {
          const clippedStartX = Math.max(0, Math.min(maxVisibleX, xBrush));
          const clippedEndX = Math.max(0, Math.min(maxVisibleX, xEnd));
          const bgWidth = clippedEndX - clippedStartX;
          if (bgWidth > 0) {
            gameBgAreaEl.style.display = "block";
            gameBgAreaEl.style.transform = `translateX(${clippedStartX}px)`;
            gameBgAreaEl.style.width = `${bgWidth}px`;
          } else {
            gameBgAreaEl.style.display = "none";
          }
        } else {
          gameBgAreaEl.style.display = "none";
        }
      }
    },
    [
      chartRef,
      roundAnchorLogicalRef,
      gameConfig.observationSeconds,
      gameConfig.tahminEndOffsetBars,
      gameConfig.brushZoneEndOffsetBars,
    ],
  );

  return {
    gameStartTimeRef,
    gameStartPriceRef,
    gameObservationEndTimeRef,
    gameTahminEndTimeRef,
    gameBrushZoneEndTimeRef,
    gameStartLogicalRef,
    lastTimeRef,
    checkLockCondition,
    updateOverlayPositions,
  };
}
