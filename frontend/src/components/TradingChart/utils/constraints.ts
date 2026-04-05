import {
  LineToolBrush,
  LineToolHighlighter,
} from "lightweight-charts-line-tools-freehand";
import type { ResolvedTradingChartGameConfig } from "../types";

const REPLACE_ON_NEW_STROKE_KINDS = [
  "Brush",
  "TrendLine",
  "Ray",
  "HorizontalLine",
] as const;
type ReplaceOnNewStrokeKind = (typeof REPLACE_ON_NEW_STROKE_KINDS)[number];

function isReplaceOnNewStrokeKind(t: string): t is ReplaceOnNewStrokeKind {
  return (REPLACE_ON_NEW_STROKE_KINDS as readonly string[]).includes(t);
}

function removeOtherFinishedOfSameType(
  lineTools: {
    removeLineToolsById: (ids: string[]) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _tools?: Map<string, any>;
  },
  exceptToolId: string,
  toolType: ReplaceOnNewStrokeKind,
) {
  if (!lineTools._tools) return;
  const ids: string[] = [];
  for (const [id, tool] of lineTools._tools) {
    if (id === exceptToolId) continue;
    if (tool?.toolType !== toolType) continue;
    const creating =
      typeof tool?.isCreating === "function" && tool.isCreating();
    if (!creating) ids.push(id);
  }
  if (ids.length > 0) lineTools.removeLineToolsById(ids);
}

/**
 * Fırça: çizim anı (canlı mum) genelde tahmin penceresinde veya Shift+B chart debug açıkken;
 * noktalar [tTah … tBrushEnd] unix / ilgili mantıksal bar bandında.
 */
export function applyDrawingConstraints(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  lineToolsRef: React.MutableRefObject<any>,
  gameStartTimeRef: React.MutableRefObject<number | null>,
  gameObservationEndTimeRef: React.MutableRefObject<number | null>,
  gameTahminEndTimeRef: React.MutableRefObject<number | null>,
  gameBrushZoneEndTimeRef: React.MutableRefObject<number | null>,
  gameStartLogicalRef: React.MutableRefObject<number | null>,
  lastTimeRef: React.MutableRefObject<number | null>,
  gameConfigRef: React.MutableRefObject<ResolvedTradingChartGameConfig>,
  /** Shift+B “chart debug”: faz kilidi olmadan fırça (koordinat bandı geçerli) */
  chartDebugModeRef: React.MutableRefObject<boolean>,
  /** SSE-driven drawing phase: bypass candle-timestamp temporal gate */
  externalDrawingPhaseRef?: React.MutableRefObject<boolean>,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const patchAddPoint = (proto: any) => {
    if (proto._isPatchedForBounds) return;
    const originalAddPoint = proto.addPoint;
    proto._isPatchedForBounds = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    proto.addPoint = function (newPoint: any) {
      if (
        lineToolsRef.current &&
        isReplaceOnNewStrokeKind(this.toolType)
      ) {
        const n =
          typeof this.getPermanentPointsCount === "function"
            ? this.getPermanentPointsCount()
            : 0;
        if (n === 0) {
          const myId =
            typeof this.id === "function" ? String(this.id()) : "";
          removeOtherFinishedOfSameType(
            lineToolsRef.current,
            myId,
            this.toolType,
          );
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const getTs = (p: any) => p.time ?? p.timestamp ?? 0;
      const targetTs = getTs(newPoint);
      const cfg = () => gameConfigRef.current;

      const checkBounds = (ts: number): boolean => {
        const tObs = gameObservationEndTimeRef.current;
        const tTah = gameTahminEndTimeRef.current;
        const tBrushEnd = gameBrushZoneEndTimeRef.current;
        const t0 = gameStartTimeRef.current;
        const lt = lastTimeRef.current;

        if (
          tObs === null ||
          tTah === null ||
          tBrushEnd === null ||
          t0 === null
        ) {
          return false;
        }
        // When SSE says we're in drawing phase, bypass candle-timestamp temporal gate
        const externalDrawing = externalDrawingPhaseRef?.current === true;
        // Chart debug (Shift+B): faz kilidi yok. Kapalı: yalnızca tahmin penceresi (phase 2).
        if (!externalDrawing && !chartDebugModeRef.current && (lt === null || lt < tObs || lt >= tTah)) return false;

        // Drawing is constrained to the right side: [tObs, tBrushEnd]
        const isUnixTs = ts > 1_000_000_000;
        if (isUnixTs) {
          return ts >= tObs && ts <= tBrushEnd;
        }

        if (gameStartLogicalRef.current !== null) {
          const lo = gameStartLogicalRef.current;
          const barObs = lo + cfg().observationSeconds;
          const barEnd = lo + cfg().brushZoneEndOffsetBars;
          return ts >= barObs && ts <= barEnd;
        }
        return false;
      };

      if (!checkBounds(targetTs)) return;

      const isGloballyUnique = (ts: number): boolean => {
        if (lineToolsRef.current && lineToolsRef.current._tools) {
          const registry = lineToolsRef.current._tools;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          for (const [id, tool] of registry as Map<string, any>) {
            if (id === this.id()) continue;
            const points = tool.getPermanentPoints
              ? tool.getPermanentPoints()
              : tool._points || [];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if (points.some((p: any) => getTs(p) === ts)) {
              return false;
            }
          }
        }
        return true;
      };

      const pts =
        this._points ||
        (this.points && Array.isArray(this.points) ? this.points : null);
      if (pts && pts.length > 0) {
        const lastTs = getTs(pts[pts.length - 1]);

        const isUnixTarget = targetTs > 1_000_000_000;
        const isUnixLast = lastTs > 1_000_000_000;

        let isGoingBackwards = false;
        if (isUnixTarget === isUnixLast) {
          isGoingBackwards = targetTs < lastTs;
        } else {
          const toUnix = (tsc: number, isU: boolean) => {
            if (isU) return tsc;
            if (
              gameStartLogicalRef.current !== null &&
              gameStartTimeRef.current !== null
            ) {
              return (
                gameStartTimeRef.current +
                (tsc - gameStartLogicalRef.current)
              );
            }
            return null;
          };
          const uTarget = toUnix(targetTs, isUnixTarget);
          const uLast = toUnix(lastTs, isUnixLast);
          if (uTarget !== null && uLast !== null) {
            isGoingBackwards = uTarget < uLast;
          }
        }

        if (isGoingBackwards) return;

        if (isUnixTarget === isUnixLast && targetTs === lastTs) {
          pts.pop();
        }

        if (pts.length > 0) {
          const newLast = pts[pts.length - 1];
          const newLastTs = getTs(newLast);
          const isUnixNewLast = newLastTs > 1_000_000_000;

          if (isUnixTarget === isUnixNewLast) {
            const diff = targetTs - newLastTs;
            const maxGap = cfg().brushInterpolationMaxGapExclusive;
            if (diff > 1 && diff < maxGap) {
              const p1 = newLast.price;
              const p2 = newPoint.price;
              for (let fillTs = newLastTs + 1; fillTs < targetTs; fillTs++) {
                if (!checkBounds(fillTs)) continue;
                if (!isGloballyUnique(fillTs)) continue;

                const ratio = (fillTs - newLastTs) / diff;
                const interpPoint = { ...newPoint };
                if (interpPoint.time !== undefined) interpPoint.time = fillTs;
                if (interpPoint.timestamp !== undefined)
                  interpPoint.timestamp = fillTs;
                interpPoint.price = p1 + (p2 - p1) * ratio;

                if (
                  interpPoint.logical !== undefined &&
                  newLast.logical !== undefined
                ) {
                  interpPoint.logical =
                    newLast.logical +
                    (newPoint.logical - newLast.logical) * ratio;
                } else {
                  delete interpPoint.logical;
                }

                originalAddPoint.call(this, interpPoint);
              }
            }
          }
        }
      }

      if (!isGloballyUnique(targetTs)) return;

      originalAddPoint.call(this, newPoint);
    };
  };

  if (LineToolBrush) patchAddPoint(LineToolBrush.prototype);
  if (LineToolHighlighter) patchAddPoint(LineToolHighlighter.prototype);
}
