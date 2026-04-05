import { useEffect, useRef } from "react";
import {
  AreaSeries,
  ColorType,
  createChart,
  LastPriceAnimationMode,
  LineType,
  type ChartOptions,
  type DeepPartial,
  type IChartApi,
  type ISeriesApi,
} from "lightweight-charts";
import {
  chartTickMarkFormatterFull,
  chartTimeFormatterFull,
} from "../utils/chartTimeScale";

/** line-tools-core boş applyOptions({}) ile full invalidation → bir karelik scale flicker; gereksiz. */
function patchChartIgnoreEmptyApplyOptions(chart: IChartApi) {
  const original = chart.applyOptions.bind(chart);
  chart.applyOptions = (options: DeepPartial<ChartOptions>) => {
    if (
      options &&
      typeof options === "object" &&
      !Array.isArray(options) &&
      Object.keys(options as object).length === 0
    ) {
      return;
    }
    original(options);
  };
}

/**
 * pressedMouseMove açıkken LW hem zaman hem fiyatı kaydırır; public API ile ayıramıyoruz.
 * ChartModel üzerinde pane fiyat scroll'unu no-op yaparız (vite: lightweight-charts → development.mjs).
 */
function disablePanePriceScroll(chart: IChartApi) {
  type ChartModel = {
    _internal_startScrollPrice?: (
      pane: unknown,
      priceScale: unknown,
      x: number,
    ) => void;
    _internal_scrollPriceTo?: (
      pane: unknown,
      priceScale: unknown,
      x: number,
    ) => void;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const widget = (chart as any)._private__chartWidget;
  const model = widget?._internal_model?.() as ChartModel | undefined;
  if (
    !model ||
    typeof model._internal_scrollPriceTo !== "function" ||
    typeof model._internal_startScrollPrice !== "function"
  ) {
    console.warn(
      "[TradingChart] disablePanePriceScroll: model patch skipped (unexpected lightweight-charts build)",
    );
    return;
  }
  model._internal_startScrollPrice = () => {};
  model._internal_scrollPriceTo = () => {};
}

export interface ChartAreaSeriesStyle {
  lineColor: string;
  topColor: string;
  bottomColor: string;
}

export interface UseChartSetupOptions {
  /** Kilitli oyun grafiği gibi: sağ fiyat eksenini tamamen kapatır. */
  hideRightPriceScale?: boolean;
  /**
   * Sağ eksen gizliyken de son fiyat etiketi gösterilsin (ana grafik kilit + çift sütun ile aynı raster).
   * Verilmezse: `hideRightPriceScale` ile tersi (eski davranış).
   */
  lastValueVisible?: boolean;
  /** Ayna / salt-okunur: yatay sürükleme ve dokunma kaydırmayı kapatır. */
  disableChartScroll?: boolean;
}

export function useChartSetup(
  containerRef: React.RefObject<HTMLDivElement | null>,
  areaSeriesStyle?: ChartAreaSeriesStyle,
  options?: UseChartSetupOptions,
) {
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const { clientWidth, clientHeight } = container;

    /** Oyun penceresi setVisibleLogicalRange ile yatayda sınırlı; fiyat bandı kodla sabit — eksende dikey kaydırma yok. */
    const defaultBarSpacing = 6;

    const hideRightPriceScale = options?.hideRightPriceScale === true;
    const lastValueVisible =
      typeof options?.lastValueVisible === "boolean"
        ? options.lastValueVisible
        : !hideRightPriceScale;

    const scrollLocked = options?.disableChartScroll === true;

    const chart = createChart(container, {
      width: clientWidth,
      height: clientHeight,
      handleScroll: {
        mouseWheel: false,
        pressedMouseMove: !scrollLocked,
        horzTouchDrag: !scrollLocked,
        vertTouchDrag: false,
      },
      handleScale: {
        mouseWheel: false,
        pinch: false,
        axisPressedMouseMove: { time: false, price: false },
        axisDoubleClickReset: { time: false, price: false },
      },
      kineticScroll: { touch: false, mouse: false },
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#334155",
      },
      grid: {
        vertLines: { color: "rgba(0, 0, 0, 0.04)" },
        horzLines: { color: "rgba(0, 0, 0, 0.04)" },
      },
      crosshair: {
        vertLine: { visible: false },
        horzLine: { visible: false },
      },
      rightPriceScale: {
        visible: !hideRightPriceScale,
        borderColor: "rgba(0, 0, 0, 0.1)",
        scaleMargins: { top: 0.2, bottom: 0.2 },
        autoScale: false,
      },
      timeScale: {
        borderColor: "rgba(0, 0, 0, 0.1)",
        secondsVisible: true,
        timeVisible: true,
        shiftVisibleRangeOnNewBar: false,
        allowShiftVisibleRangeOnWhitespaceReplacement: false,
        rightOffset: 0,
        lockVisibleTimeRangeOnResize: true,
        barSpacing: defaultBarSpacing,
        minBarSpacing: 0.25,
        maxBarSpacing: 512,
        tickMarkFormatter: chartTickMarkFormatterFull,
      },
      localization: {
        timeFormatter: chartTimeFormatterFull,
      },
    });

    patchChartIgnoreEmptyApplyOptions(chart);
    disablePanePriceScroll(chart);

    const palette = areaSeriesStyle ?? {
      lineColor: "#f7931a",
      topColor: "rgba(247, 147, 26, 0.42)",
      bottomColor: "rgba(247, 147, 26, 0)",
    };
    const series = chart.addSeries(AreaSeries, {
      lineColor: palette.lineColor,
      topColor: palette.topColor,
      bottomColor: palette.bottomColor,
      relativeGradient: true,
      lineWidth: 3,
      /** Curved: sık 1s OHLC’de spline taşması / kopuk alan dolgusu; basit çizgi stabil. */
      lineType: LineType.Simple,
      lastPriceAnimation: LastPriceAnimationMode.OnDataUpdate,
      priceLineVisible: false,
      lastValueVisible,
      crosshairMarkerVisible: true,
    });

    /*
     * LW charts: rightPriceScale.visible=false ile oluşturulduğunda scaleMargins
     * düzgün uygulanmıyor (varsayılan bottom:0.1'e düşüyor). Series eklendikten
     * sonra açıkça yeniden uygula.
     */
    if (hideRightPriceScale) {
      const ps = series.priceScale();
      ps.applyOptions({ scaleMargins: { top: 0.2, bottom: 0.2 } });
    }

    chartRef.current = chart;
    seriesRef.current = series;

    // DEBUG: global erişim
    const debugKey = hideRightPriceScale ? '__debugMirrorChart' : '__debugMainChart';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any)[debugKey] = { chart, series };

    const resizeObserver = new ResizeObserver(() => {
      chart.applyOptions({
        width: container.clientWidth,
        height: container.clientHeight,
      });
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      // Remove all attached primitives (line tools) before destroying the chart
      // to prevent "Chart API not available" errors during teardown paint cycles.
      try {
        const s = seriesRef.current;
        if (s) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const primitives = (s as any).attachedPrimitives?.() ?? [];
          for (const p of primitives) {
            try { s.detachPrimitive(p); } catch { /* ignore */ }
          }
        }
      } catch { /* ignore */ }
      seriesRef.current = null;
      chartRef.current = null;
      chart.remove();
    };
  }, [
    containerRef,
    areaSeriesStyle,
    options?.hideRightPriceScale === true,
    options?.lastValueVisible,
    options?.disableChartScroll === true,
  ]);

  return { chartRef, seriesRef };
}
