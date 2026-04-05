import { BaseLineTool } from "lightweight-charts-line-tools-core";

let patched = false;

/**
 * `BaseLineTool.prototype.getChart` throws "Chart API not available" when `_chart` is null
 * (happens during teardown / HMR when a tool's primitive is still being painted but the chart
 * reference has already been cleared).
 *
 * `BaseLineTool.prototype.getSeries` throws "Series not attached to tool …" when `_series`
 * is null (same teardown / HMR scenario — the horizontal-line tool tries to read viewport
 * bounds via `getSeries().priceScale()` after the series has already been removed).
 *
 * This patches both methods to return `null` instead of throwing, which causes
 * downstream culling / viewport / destroy code to bail out gracefully.
 */
export function ensureSafeLineToolGetChart(): void {
  if (patched) return;
  patched = true;

  const proto = BaseLineTool.prototype as unknown as {
    getChart: () => unknown;
    getSeries: () => unknown;
    destroy: () => void;
    _chart?: unknown;
    _series?: unknown;
  };

  // --- safe getChart ---
  const originalGetChart = proto.getChart;
  proto.getChart = function safeGetChart(this: typeof proto) {
    if (!this._chart) return null;
    try {
      return originalGetChart.call(this);
    } catch {
      return null;
    }
  };

  // --- safe getSeries ---
  const originalGetSeries = proto.getSeries;
  if (originalGetSeries) {
    proto.getSeries = function safeGetSeries(this: typeof proto) {
      if (!this._series) return null;
      try {
        return originalGetSeries.call(this);
      } catch {
        return null;
      }
    };
  }

  // --- safe destroy ---
  // `destroy()` calls `priceScale().…` which throws "Value is null" when
  // the series' pane has already been removed from the chart.
  const originalDestroy = proto.destroy;
  if (originalDestroy) {
    proto.destroy = function safeDestroy(this: typeof proto) {
      try {
        originalDestroy.call(this);
      } catch {
        // swallow — tool is being torn down anyway
      }
    };
  }
}
