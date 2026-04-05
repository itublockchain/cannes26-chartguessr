import type { ISeriesApi, SeriesType, UTCTimestamp } from "lightweight-charts";
import {
  BaseLineTool,
  Point,
  type AnchorPoint,
} from "lightweight-charts-line-tools-core";
import { LineToolBrush, LineToolHighlighter } from "lightweight-charts-line-tools-freehand";

/** Her Brush / Highlighter pane view sınıfı için bir kez _updateImpl sarılır. */
const patchedViewClasses = new WeakSet<object>();

let pointToScreenPatched = false;

/**
 * Fırça: line-tools paketi `interpolateLogicalIndexFromTime` + `logicalToCoordinate` kullanıyor;
 * LW zaman ölçeği / görünür aralık / autoscale sonrası bu X, grafik mumlarıyla kayabiliyor.
 * Önce `timeToCoordinate` + `priceToCoordinate` (seri ile aynı uzay), olmazsa paket yolu.
 * Clamp: `paneSize` (koordinat uzayı ile uyumlu); yoksa pane HTMLElement.
 */
export function ensureFreehandPointToScreenClamped(): void {
  if (pointToScreenPatched) return;
  pointToScreenPatched = true;

  const orig = BaseLineTool.prototype.pointToScreenPoint;

  function pointToScreenPointClamped(
    this: BaseLineTool<unknown>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    point: any,
  ) {
    const chart = this._chart;
    const series = this._series;

    let p: Point | null = null;

    if (
      (this.toolType === "Brush" || this.toolType === "Highlighter") &&
      chart &&
      series
    ) {
      const ts = Number(point.timestamp ?? point.time);
      const pr = Number(point.price);
      if (Number.isFinite(ts) && Number.isFinite(pr)) {
        const x = chart.timeScale().timeToCoordinate(ts as UTCTimestamp);
        const y = series.priceToCoordinate(pr);
        if (x !== null && y !== null) {
          p = new Point(x, y);
        }
      }
    }

    if (!p) {
      if (!this._chart) return null;
      p = orig.call(this, point);
      if (!p) return p;
      if (this.toolType !== "Brush" && this.toolType !== "Highlighter") return p;
    }

    if (this.toolType !== "Brush" && this.toolType !== "Highlighter") return p;

    const paneSize = chart?.paneSize?.();
    const paneEl = series?.getPane?.()?.getHTMLElement?.() ?? null;
    const w = paneSize?.width ?? paneEl?.clientWidth ?? 0;
    const h = paneSize?.height ?? paneEl?.clientHeight ?? 0;
    if (w <= 0 || h <= 0) return p;
    const lineW = Number(this.options().line?.width ?? 2) || 2;
    const pad = Math.ceil(lineW / 2);
    p.x = Math.max(pad, Math.min(w - pad, p.x)) as typeof p.x;
    p.y = Math.max(pad, Math.min(h - pad, p.y)) as typeof p.y;
    return p;
  }

  LineToolBrush.prototype.pointToScreenPoint = pointToScreenPointClamped;
  LineToolHighlighter.prototype.pointToScreenPoint = pointToScreenPointClamped;
}

type PaneViewLike = {
  _series: ISeriesApi<SeriesType>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _tool: any;
  _smoothArray: (points: AnchorPoint[], iterations?: number) => AnchorPoint[];
  _updateImpl: (height: number, width: number) => void;
};

type LineToolWithPaneViews = {
  toolType?: string;
  paneViews?: () => unknown[];
};

type LineToolsMap = {
  _tools?: Map<string, LineToolWithPaneViews>;
};

function patchFreehandPaneViewClass(View: new (...args: unknown[]) => unknown) {
  if (patchedViewClasses.has(View)) return;
  patchedViewClasses.add(View);

  const proto = View.prototype as PaneViewLike;
  const innerUpdate = proto._updateImpl;

  proto._updateImpl = function (
    this: PaneViewLike,
    height: number,
    width: number,
  ) {
    const paneEl = this._series?.getPane?.()?.getHTMLElement?.() ?? null;
    const pw = paneEl?.clientWidth ?? width;
    const ph = paneEl?.clientHeight ?? height;

    const lineW =
      Number(this._tool?.options?.()?.line?.width ?? 2) || 2;
    const pad = Math.min(pw, ph) > 0 ? Math.ceil(lineW / 2) : 0;
    const minX = pad;
    const maxX = Math.max(pad, pw - pad);
    const minY = pad;
    const maxY = Math.max(pad, ph - pad);

    /** Paket varsayılanı 2 geçişlik box blur; keskin köşeleri yumuşatıyor. Sadece klon + pane clamp. */
    this._smoothArray = (pts: AnchorPoint[]) => {
      const s = pts.map((p) => p.clone());
      for (const p of s) {
        const q = p as unknown as { x: number; y: number };
        q.x = Math.max(minX, Math.min(maxX, q.x));
        q.y = Math.max(minY, Math.min(maxY, q.y));
      }
      return s;
    };
    try {
      innerUpdate.call(this, height, width);
    } finally {
      delete (this as { _smoothArray?: unknown })._smoothArray;
    }
  };
}

/**
 * Fırça / highlighter smoothing’i pane piksel sınırlarının dışına taşıyabiliyor;
 * bu da çizgiyi fiyat ekseni vb. üzerinde gösterebiliyor. İlk oluşturmada pane view
 * sınıfının prototype’ına sarıcı ekler.
 */
export function ensureFreehandPaneViewsClamped(
  lineTools: LineToolsMap | null | undefined,
): void {
  const tools = lineTools?._tools;
  if (!tools) return;

  for (const t of tools.values()) {
    if (t.toolType !== "Brush" && t.toolType !== "Highlighter") continue;
    const views = t.paneViews?.();
    const Ctor = views?.[0]?.constructor;
    if (typeof Ctor === "function") {
      patchFreehandPaneViewClass(Ctor as new (...args: unknown[]) => unknown);
    }
  }
}
