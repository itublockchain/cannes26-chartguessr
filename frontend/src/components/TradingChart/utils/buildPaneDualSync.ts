import type { IChartApi } from "lightweight-charts";
import type { ChartDualSync } from "../hooks/useMirrorWebSocket";

export function buildPaneDualSync(
  chart: IChartApi | null | undefined,
  anchorLogical: number | null,
  priceRange: { from: number; to: number } | null,
): ChartDualSync | null {
  if (anchorLogical == null || priceRange == null) return null;
  const vis = chart?.timeScale().getVisibleLogicalRange() ?? null;
  const barSpacing = chart?.timeScale().options().barSpacing;
  return {
    anchorLogical,
    priceRange: { from: priceRange.from, to: priceRange.to },
    ...(vis
      ? { visibleLogical: { from: vis.from, to: vis.to } }
      : undefined),
    ...(typeof barSpacing === "number" ? { barSpacing } : undefined),
  };
}
