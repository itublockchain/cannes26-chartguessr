import type {
  IChartApiBase,
  ISeriesApi,
  SeriesType,
  UTCTimestamp,
} from "lightweight-charts";
import {
  cloneElement,
  isValidElement,
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
  type CSSProperties,
  type ReactElement,
} from "react";
import type {
  DrawingCapabilityState,
  DrawingPoint,
  DrawingToolbarState,
  TradingChartProps,
} from "./types";
import { resolveGameConfig } from "./types";
import { useChartSetup } from "./hooks/useChartSetup";
import {
  useLineTools,
  type AddToolOptions,
  freezeAllBrushStrokes,
  removeCreatingLineTools,
  removeNonBrushLineTools,
} from "./hooks/useLineTools";
import {
  useWebSocket,
  animateBrushZoneHalfScreenViewport,
  applyLockedViewport,
  brushZoneOnlyLogicalRange,
  reassertViewportAfterLineToolsPlugin,
  scheduleReassertLockedViewport,
  visibleLogicalForChartAfterTool,
} from "./hooks/useWebSocket";
import { useGameLogic } from "./hooks/useGameLogic";
import type { ChartDualSync } from "./hooks/useMirrorWebSocket";
import type { OpponentMirrorChartProps } from "./OpponentMirrorChart";
import {
  applyDrawingConstraints,
  unregisterDrawingConstraintContext,
} from "./utils/constraints";
import { redrawDevDrawingPointsCanvas } from "./utils/devDrawingPointsCanvas";
import { buildPaneDualSync } from "./utils/buildPaneDualSync";
import { cn } from "./utils/cn";
import { PEN_CURSOR, type GamePhase } from "./chartConstants";
import { TradingChartToolbar } from "./TradingChartToolbar";
import { useTradingChartKeyboard } from "./hooks/useTradingChartKeyboard";
import { useTradingChartChartShellLayout } from "./hooks/useTradingChartChartShellLayout";
import {
  brushSegmentsFromLineToolsExport,
  clearGameDrawingPersistence,
  GAME_DRAWING_STORAGE_VERSION,
  readGameDrawingPersistence,
  writeGameDrawingPersistence,
} from "./utils/gameDrawingPersistence";
import { ensureFreehandPaneViewsClamped } from "./utils/freehandPaneViewClamp";
import styles from "./TradingChart.module.css";

export function TradingChart({
  wsUrl,
  coin: coinProp,
  gameConfig: gameConfigProp,
  externalPhase,
  onDrawingComplete,
  onGameStateChange,
  onDrawingToolbarChange,
  className,
  resultSidePane,
  onGameRoundWindowKnown,
}: TradingChartProps) {
  const gameConfig = useMemo(
    () => resolveGameConfig(gameConfigProp),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(gameConfigProp ?? null)],
  );
  const gameConfigRef = useRef(gameConfig);
  gameConfigRef.current = gameConfig;

  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const lineT0Ref = useRef<HTMLDivElement | null>(null);
  const lineObsEndRef = useRef<HTMLDivElement | null>(null);
  const lineTahminEndRef = useRef<HTMLDivElement | null>(null);
  const lineRoundEndRef = useRef<HTMLDivElement | null>(null);
  const gameBgAreaRef = useRef<HTMLDivElement | null>(null);
  const gameTahminBgAreaRef = useRef<HTMLDivElement | null>(null);
  const activeToolRef = useRef<string | null>(null);
  const isLockedRef = useRef(false);
  const brushAllowedRef = useRef(false);
  /** SSE-driven drawing phase: bypass candle-timestamp temporal gate in constraints */
  const externalDrawingPhaseRef = useRef(false);
  /** Oyun penceresi veya line-tools henüz yokken seçilen araç; hazır olunca bir kez addTool ile uygulanır */
  const pendingToolRef = useRef<string | null>(null);
  const roundAnchorLogicalRef = useRef<number | null>(null);
  /** Faz 3+: yalnız fırça bandı + sağ boşluk görünümü uygulandı mı (yeniden boyutta sağ pad güncellenir) */
  const brushPanViewportAppliedRef = useRef(false);
  /** 60 mumluk fırça alanı başladı (tahmin bitti): fırça dışı çizimler bir kez silindi mi */
  const nonBrushToolsClearedAtBrushZoneStartRef = useRef(false);
  const viewportAnimationActiveRef = useRef(false);
  const brushViewportAnimRafRef = useRef<number | null>(null);
  const fixedLogicalRangeRef = useRef<{ from: number; to: number } | null>(
    null,
  );
  const fixedPriceRangeRef = useRef<{ from: number; to: number } | null>(null);

  const hasResultSidePane = resultSidePane != null;
  const hasResultSidePaneRef = useRef(hasResultSidePane);
  hasResultSidePaneRef.current = hasResultSidePane;

  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [isLocked, setIsLocked] = useState(false);
  const [gamePhase, setGamePhase] = useState<GamePhase>(1);
  const gamePhaseRef = useRef<GamePhase>(gamePhase);
  gamePhaseRef.current = gamePhase;
  /** Çizim yeteneği snapshot’ı (debug) */
  const [drawingCapability, setDrawingCapability] =
    useState<DrawingCapabilityState | null>(null);
  const lastDrawingCapabilityJsonRef = useRef<string>("");
  const [drawingToolbar, setDrawingToolbar] = useState<DrawingToolbarState>({
    activeDrawingToolKey: null,
    isEngaged: false,
  });
  /** Tur boyunca her tamamlanan fırça segmenti; oyun bitince tek seferlik log için */
  const drawingSegmentsRef = useRef<DrawingPoint[][]>([]);
  /** Debug overlay (Shift+B): son tamamlanan fırça stroke’u / noktalar */
  const devBrushPointsRef = useRef<DrawingPoint[]>([]);
  /** Shift+B — chart “debug mode”: fırça faz kilidi yok + sarı nokta overlay */
  const [chartDebugMode, setChartDebugMode] = useState(false);
  const chartDebugModeRef = useRef(false);
  const chartShellRef = useRef<HTMLDivElement | null>(null);
  const drawingDebugCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const redrawDevDrawingOverlayRef = useRef<() => void>(() => {});
  const schedulePersistGameDrawingsRef = useRef<(() => void) | null>(null);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoredGameStartRef = useRef<number | null>(null);
  /** Tamamlanan çizimler — Ctrl/Cmd+Z ile sondan geri alma (line-tools id sırası) */
  const drawingUndoStackRef = useRef<{ id: string; toolType: string }[]>([]);
  /** Geri alınan çizimler — Ctrl/Cmd+Shift+Z ile tekrar (exportLineTools tek öğe JSON) */
  const drawingRedoStackRef = useRef<string[]>([]);

  useEffect(() => {
    isLockedRef.current = isLocked;
  }, [isLocked]);

  const effectiveCoin = coinProp ?? "BTC";

  /** Çizim sırasında canlı fiyat bandı takibi durur; bitince flushLivePriceRangeRef ile devam eder. */
  const pauseLivePriceRangeRef = useRef(false);
  const flushLivePriceRangeRef = useRef<(() => void) | null>(null);

  const { chartRef, seriesRef } = useChartSetup(chartContainerRef);

  const redrawDevDrawingOverlay = useCallback(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    const shell = chartShellRef.current;
    const canvas = drawingDebugCanvasRef.current;
    if (!chart || !series || !shell || !canvas) return;
    redrawDevDrawingPointsCanvas(
      chart as IChartApiBase<UTCTimestamp>,
      series as ISeriesApi<SeriesType, UTCTimestamp>,
      shell,
      canvas,
      devBrushPointsRef.current,
      chartDebugModeRef.current,
    );
  }, [chartRef, seriesRef]);

  useEffect(() => {
    redrawDevDrawingOverlayRef.current = redrawDevDrawingOverlay;
  }, [redrawDevDrawingOverlay]);

  const {
    gameStartTimeRef,
    gameStartPriceRef,
    gameObservationEndTimeRef,
    gameTahminEndTimeRef,
    gameBrushZoneEndTimeRef,
    gameStartLogicalRef,
    lastTimeRef,
    checkLockCondition,
    updateOverlayPositions,
  } = useGameLogic({
    chartRef,
    roundAnchorLogicalRef,
    gameConfig,
    onGameStateChange,
  });

  const updateActiveTool = useCallback((toolKey: string | null) => {
    activeToolRef.current = toolKey;
    setActiveTool(toolKey);
  }, []);

  const handleDrawingComplete = useCallback(
    (points: DrawingPoint[]) => {
      if (points.length > 0) {
        drawingSegmentsRef.current.push(points);
        devBrushPointsRef.current = points.slice();
      }
      onDrawingComplete?.(points);
      requestAnimationFrame(() => redrawDevDrawingOverlayRef.current());
    },
    [onDrawingComplete],
  );

  /** Brush / Trend / Yatay çizim bitince yeniden arm — ref ile güncel addTool */
  const onStrokeFinishedContinuationRef = useRef<
    ((toolInfo: { toolType?: string }) => void) | null
  >(null);

  const {
    lineToolsRef,
    initLineTools,
    addTool,
    removeSelected,
    deactivateDrawingMode,
    lockAllTools,
    cleanup,
  } = useLineTools({
    chartRef,
    seriesRef,
    fixedLogicalRangeRef,
    fixedPriceRangeRef,
    onDrawingComplete: handleDrawingComplete,
    onToolFinished: (info) => onStrokeFinishedContinuationRef.current?.(info),
    schedulePersistGameDrawingsRef,
    pauseLivePriceRangeRef,
    flushLivePriceRangeRef,
  });

  const flushPersistGameDrawingState = useCallback(() => {
    const lt = lineToolsRef.current;
    const t0 = gameStartTimeRef.current;
    if (!lt || t0 == null || typeof lt.exportLineTools !== "function") return;
    try {
      const lineToolsJson = lt.exportLineTools();
      writeGameDrawingPersistence(effectiveCoin, {
        v: GAME_DRAWING_STORAGE_VERSION,
        gameStartTime: t0,
        lineToolsJson,
      });
    } catch {
      /* ignore */
    }
  }, [effectiveCoin]);

  const schedulePersistGameDrawingState = useCallback(() => {
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      persistTimerRef.current = null;
      flushPersistGameDrawingState();
    }, 120);
  }, [flushPersistGameDrawingState]);

  useEffect(() => {
    schedulePersistGameDrawingsRef.current = schedulePersistGameDrawingState;
    return () => {
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
    };
  }, [schedulePersistGameDrawingState]);

  const restoreGameDrawingsFromStorage = useCallback(() => {
    const lt = lineToolsRef.current;
    const chart = chartRef.current;
    const series = seriesRef.current;
    const t0 = gameStartTimeRef.current;
    const logical = fixedLogicalRangeRef.current;
    const price = fixedPriceRangeRef.current;
    if (!lt || !chart || !series || t0 == null) return;
    if (restoredGameStartRef.current === t0) return;

    const saved = readGameDrawingPersistence(effectiveCoin);
    if (!saved) {
      drawingUndoStackRef.current = [];
      drawingRedoStackRef.current = [];
      restoredGameStartRef.current = t0;
      return;
    }
    if (saved.gameStartTime !== t0) {
      clearGameDrawingPersistence(effectiveCoin);
      drawingUndoStackRef.current = [];
      drawingRedoStackRef.current = [];
      restoredGameStartRef.current = t0;
      return;
    }

    drawingUndoStackRef.current = [];
    drawingRedoStackRef.current = [];
    lt.removeAllLineTools();
    const ok = lt.importLineTools(saved.lineToolsJson);
    if (!ok) {
      restoredGameStartRef.current = t0;
      return;
    }
    ensureFreehandPaneViewsClamped(lt);
    freezeAllBrushStrokes(lt);
    drawingSegmentsRef.current = brushSegmentsFromLineToolsExport(
      saved.lineToolsJson,
    );
    const segs = drawingSegmentsRef.current;
    if (segs.length > 0) {
      devBrushPointsRef.current = segs[segs.length - 1]!.slice();
    } else {
      devBrushPointsRef.current = [];
    }
    if (logical) {
      applyLockedViewport(chart, series, logical, price);
      scheduleReassertLockedViewport(chart, series, logical, price);
    }
    restoredGameStartRef.current = t0;
    requestAnimationFrame(() => redrawDevDrawingOverlayRef.current());
  }, [effectiveCoin]);

  const restoreGameDrawingsFromStorageRef = useRef(
    restoreGameDrawingsFromStorage,
  );
  restoreGameDrawingsFromStorageRef.current = restoreGameDrawingsFromStorage;

  useEffect(() => {
    restoredGameStartRef.current = null;
    drawingUndoStackRef.current = [];
    drawingRedoStackRef.current = [];
  }, [effectiveCoin]);

  const removeSelectedAndPersist = useCallback(() => {
    drawingRedoStackRef.current = [];
    removeSelected();
    queueMicrotask(() => schedulePersistGameDrawingsRef.current?.());
  }, [removeSelected]);

  const addToolWithDevClear = useCallback(
    (toolKey: string, opts?: AddToolOptions) => {
      if (chartDebugModeRef.current && toolKey === "Brush") {
        devBrushPointsRef.current = [];
        requestAnimationFrame(() => redrawDevDrawingOverlayRef.current());
      }
      addTool(toolKey, opts);
    },
    [addTool],
  );

  /** Stroke sonrası yeniden arm: `addToolWithDevClear` kullanma — o ref’i sıfırlar; debug noktaları silinir. */
  const addToolRef = useRef(addTool);
  addToolRef.current = addTool;

  const emitDrawingCapability = useCallback(
    (reason: string, options?: { forceLog?: boolean }) => {
      const locked = isLockedRef.current;
      const phase = gamePhaseRef.current;
      const hasChart = chartRef.current != null;
      const hasSeries = seriesRef.current != null;
      const hasLineToolsPlugin = lineToolsRef.current != null;
      const hasGameLogicalRange = fixedLogicalRangeRef.current != null;
      const chartReady =
        hasChart && hasSeries && hasLineToolsPlugin && hasGameLogicalRange;
      const debugOn = chartDebugModeRef.current;
      const brushAllowed = !locked && (debugOn || phase === 2);
      const act = activeToolRef.current;
      const pend = pendingToolRef.current;
      const s: DrawingCapabilityState = {
        isLocked: locked,
        gamePhase: phase,
        activeTool: act,
        pendingTool: pend,
        chartDebugMode: debugOn,
        hasChart,
        hasSeries,
        hasLineToolsPlugin,
        hasGameLogicalRange,
        chartReadyForLineTools: chartReady,
        brushAllowed,
        canDrawTrendOrHorizontal: !locked && chartReady,
        canDrawBrush:
          brushAllowed && chartReady && (act === "Brush" || pend === "Brush"),
      };
      const json = JSON.stringify(s);
      const force = options?.forceLog === true;
      if (!force && json === lastDrawingCapabilityJsonRef.current) {
        return;
      }
      lastDrawingCapabilityJsonRef.current = json;
      setDrawingCapability(s);
      console.log("[DrawingCapability]", reason, s);
    },
    [],
  );

  /** Line-tools remove/import → `chart.applyOptions({})` viewport kayar; addTool/restore ile aynı kilidi yeniden uygula. */
  const reassertViewportAfterLineToolsMutation = useCallback(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    const game = fixedLogicalRangeRef.current;
    const price = fixedPriceRangeRef.current;
    if (!chart || !series || !game) return;
    const logical = visibleLogicalForChartAfterTool(chart, game);
    if (!logical) return;
    applyLockedViewport(chart, series, logical, price);
    reassertViewportAfterLineToolsPlugin(chart, series, logical, price);
  }, [chartRef, seriesRef]);

  const undoLastDrawing = useCallback(() => {
    if (isLockedRef.current) return;
    const lt = lineToolsRef.current;
    if (!lt?.removeLineToolsById) return;

    const stack = drawingUndoStackRef.current;
    if (stack.length > 0) {
      const { id, toolType } = stack.pop()!;
      if (typeof lt.exportLineTools === "function") {
        try {
          const exported = lt.exportLineTools() as string;
          const arr = JSON.parse(exported) as { id?: string }[];
          if (Array.isArray(arr)) {
            const entry = arr.find((t) => t && t.id === id);
            if (entry) {
              drawingRedoStackRef.current.push(JSON.stringify([entry]));
            }
          }
        } catch {
          /* ignore */
        }
      }
      try {
        lt.removeLineToolsById([id]);
      } catch {
        /* ignore */
      }
      reassertViewportAfterLineToolsMutation();
      if (toolType === "Brush" && drawingSegmentsRef.current.length > 0) {
        drawingSegmentsRef.current.pop();
      }
      if (toolType === "Brush") {
        const segsAfterUndo = drawingSegmentsRef.current;
        devBrushPointsRef.current =
          segsAfterUndo.length > 0
            ? segsAfterUndo[segsAfterUndo.length - 1]!.slice()
            : [];
      }
      requestAnimationFrame(() => redrawDevDrawingOverlayRef.current());
      queueMicrotask(() => schedulePersistGameDrawingsRef.current?.());
      emitDrawingCapability("undo-last-drawing", { forceLog: true });
      return;
    }

    const cancelled = removeCreatingLineTools(lt);
    if (cancelled > 0) {
      reassertViewportAfterLineToolsMutation();
      queueMicrotask(() => schedulePersistGameDrawingsRef.current?.());
      emitDrawingCapability("undo-in-progress-drawing", { forceLog: true });
    }
  }, [emitDrawingCapability, reassertViewportAfterLineToolsMutation]);

  const redoLastDrawing = useCallback(() => {
    if (isLockedRef.current) return;
    const lt = lineToolsRef.current;
    if (!lt?.importLineTools) return;

    const redoStack = drawingRedoStackRef.current;
    if (redoStack.length === 0) return;

    const json = redoStack[redoStack.length - 1]!;
    let id: string | undefined;
    let toolType: string | undefined;
    try {
      const parsed = JSON.parse(json) as { id?: string; toolType?: string }[];
      if (!Array.isArray(parsed) || parsed.length === 0) return;
      const entry = parsed[0]!;
      id = entry.id;
      toolType = entry.toolType;
      const ok = lt.importLineTools(json);
      if (!ok) return;
      redoStack.pop();
    } catch {
      return;
    }

    if (typeof id === "string" && id.length > 0 && toolType) {
      drawingUndoStackRef.current.push({ id, toolType });
    }

    if (toolType === "Brush") {
      const segs = brushSegmentsFromLineToolsExport(json);
      const stroke = segs[0];
      if (stroke && stroke.length > 0) {
        drawingSegmentsRef.current.push(stroke);
      }
    }

    ensureFreehandPaneViewsClamped(lt);
    freezeAllBrushStrokes(lt);
    reassertViewportAfterLineToolsMutation();

    if (toolType === "Brush") {
      const segs = drawingSegmentsRef.current;
      devBrushPointsRef.current =
        segs.length > 0 ? segs[segs.length - 1]!.slice() : [];
      requestAnimationFrame(() => redrawDevDrawingOverlayRef.current());
    }

    queueMicrotask(() => schedulePersistGameDrawingsRef.current?.());
    emitDrawingCapability("redo-last-drawing", { forceLog: true });
  }, [emitDrawingCapability, reassertViewportAfterLineToolsMutation]);

  const penCursorActive = useMemo(() => {
    const dc = drawingCapability;
    if (!dc || dc.isLocked || !dc.chartReadyForLineTools || !dc.canDrawBrush) {
      return false;
    }
    const act = dc.activeTool;
    const pend = dc.pendingTool;
    return act === "Brush" || pend === "Brush";
  }, [drawingCapability]);

  const tryApplyPendingTool = useCallback(() => {
    const p = pendingToolRef.current;
    if (!p || isLockedRef.current) return;
    if (p === "Brush" && !brushAllowedRef.current && !externalDrawingPhaseRef.current) return;
    if (!lineToolsRef.current || !fixedLogicalRangeRef.current) return;
    pendingToolRef.current = null;
    addToolWithDevClear(p, { replacePreviousOfSameKind: p === "Brush" });
    requestAnimationFrame(() => {
      chartContainerRef.current?.focus({ preventScroll: true });
    });
    emitDrawingCapability(`tryApplyPendingTool:${p}`, { forceLog: true });
  }, [addToolWithDevClear, emitDrawingCapability]);

  const tryApplyPendingToolRef = useRef(tryApplyPendingTool);
  tryApplyPendingToolRef.current = tryApplyPendingTool;

  const updateOverlays = useCallback(() => {
    const container = chartContainerRef.current;
    if (!container) return;
    updateOverlayPositions(
      lineT0Ref.current,
      lineObsEndRef.current,
      lineTahminEndRef.current,
      lineRoundEndRef.current,
      gameTahminBgAreaRef.current,
      gameBgAreaRef.current,
      container,
    );
  }, [updateOverlayPositions]);

  useEffect(() => {
    updateOverlays();
  }, [isLocked, updateOverlays]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !seriesRef.current) return;

    applyDrawingConstraints(chart, {
      lineToolsRef,
      gameStartTimeRef,
      gameObservationEndTimeRef,
      gameTahminEndTimeRef,
      gameBrushZoneEndTimeRef,
      gameStartLogicalRef,
      lastTimeRef,
      gameConfigRef,
      chartDebugModeRef,
      externalDrawingPhaseRef,
    });
    initLineTools();

    queueMicrotask(() => {
      restoreGameDrawingsFromStorageRef.current();
      tryApplyPendingToolRef.current();
      emitDrawingCapability("chart-line-tools-ready", { forceLog: true });
    });

    return () => {
      unregisterDrawingConstraintContext(chart);
      cleanup();
      restoredGameStartRef.current = null;
      drawingUndoStackRef.current = [];
      drawingRedoStackRef.current = [];
    };
  }, [chartRef.current, seriesRef.current, emitDrawingCapability]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    chartDebugModeRef.current = chartDebugMode;
    emitDrawingCapability("chart-debug-mode", { forceLog: true });
    requestAnimationFrame(() => redrawDevDrawingOverlayRef.current());
  }, [chartDebugMode, emitDrawingCapability]);

  useTradingChartChartShellLayout({
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
  });

  useEffect(() => {
    const ser = seriesRef.current;
    if (!ser) return;
    if (isLocked && hasResultSidePane) {
      ser.applyOptions({ lastValueVisible: false });
    } else {
      ser.applyOptions({ lastValueVisible: true });
    }
  }, [isLocked, hasResultSidePane, seriesRef.current]); // eslint-disable-line react-hooks/exhaustive-deps

  const syncPhaseAndMaybeAutoBrush = useCallback(() => {
    // When externalPhase is driving the game, skip candle-based phase detection
    if (externalPhase) return;

    const t0 = gameStartTimeRef.current;
    const lt = lastTimeRef.current;
    const obsEnd = gameObservationEndTimeRef.current;
    const tahEnd = gameTahminEndTimeRef.current;
    if (t0 === null || lt === null || obsEnd === null || tahEnd === null)
      return;

    const phase: GamePhase = lt < obsEnd ? 1 : lt < tahEnd ? 2 : 3;

    setGamePhase((prev) => {
      if (prev === 1 && phase === 2 && !isLockedRef.current) {
        queueMicrotask(() => {
          if (!isLockedRef.current && lineToolsRef.current) {
            addToolWithDevClear("Brush");
            updateActiveTool("Brush");
            requestAnimationFrame(() => {
              chartContainerRef.current?.focus({ preventScroll: true });
            });
            emitDrawingCapability("auto-brush-phase-2", { forceLog: true });
          }
        });
      }
      return phase;
    });
  }, [
    externalPhase,
    addToolWithDevClear,
    updateActiveTool,
    lineToolsRef,
    gameStartTimeRef,
    lastTimeRef,
    gameObservationEndTimeRef,
    gameTahminEndTimeRef,
    emitDrawingCapability,
  ]);

  const performAfterTick = useCallback(() => {
    syncPhaseAndMaybeAutoBrush();

    const lt = lastTimeRef.current;
    const te = gameTahminEndTimeRef.current;
    const anchor = roundAnchorLogicalRef.current;
    if (lt !== null && te !== null && lt < te) {
      brushPanViewportAppliedRef.current = false;
      nonBrushToolsClearedAtBrushZoneStartRef.current = false;
    } else if (lt !== null && te !== null && lt >= te) {
      if (!nonBrushToolsClearedAtBrushZoneStartRef.current) {
        nonBrushToolsClearedAtBrushZoneStartRef.current = true;
        drawingUndoStackRef.current = [];
        drawingRedoStackRef.current = [];
        removeNonBrushLineTools(lineToolsRef.current);
        queueMicrotask(() => schedulePersistGameDrawingsRef.current?.());
      }
      if (!brushPanViewportAppliedRef.current && anchor != null) {
        const ok = animateBrushZoneHalfScreenViewport(
          chartRef,
          seriesRef,
          fixedLogicalRangeRef,
          fixedPriceRangeRef,
          anchor,
          gameConfigRef.current,
          viewportAnimationActiveRef,
          brushViewportAnimRafRef,
        );
        if (ok) brushPanViewportAppliedRef.current = true;
      }
    }

    if (checkLockCondition()) {
      if (!isLockedRef.current) {
        const segments = drawingSegmentsRef.current;
        console.log("[Drawing — oyun bitti]", {
          segments,
          flatPoints: segments.flat(),
          segmentCount: segments.length,
          totalPoints: segments.reduce((n, s) => n + s.length, 0),
        });
      }
      pendingToolRef.current = null;
      setIsLocked(true);
      lockAllTools();
      if (activeToolRef.current) updateActiveTool(null);
      deactivateDrawingMode();
      emitDrawingCapability("game-locked", { forceLog: true });
    }
    updateOverlays();
    tryApplyPendingTool();
    if (chartDebugModeRef.current) {
      requestAnimationFrame(() => redrawDevDrawingOverlayRef.current());
    }
    emitDrawingCapability("afterTick");
  }, [
    syncPhaseAndMaybeAutoBrush,
    checkLockCondition,
    lockAllTools,
    updateActiveTool,
    updateOverlays,
    tryApplyPendingTool,
    emitDrawingCapability,
    deactivateDrawingMode,
  ]);

  const performAfterTickRef = useRef(performAfterTick);
  performAfterTickRef.current = performAfterTick;
  const updateOverlaysRef = useRef(updateOverlays);
  updateOverlaysRef.current = updateOverlays;

  /** Kilit + ikiye bölünmüş layout: fırça bandı varsa onu göster, yoksa tahmin bölgesi + bağlam */
  useEffect(() => {
    if (!isLocked) return;
    let cancelled = false;
    const outer = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (cancelled) return;
        const chart = chartRef.current;
        const series = seriesRef.current;
        const anchor = roundAnchorLogicalRef.current;
        const cfg = gameConfigRef.current;
        const price = fixedPriceRangeRef.current;
        if (!chart || !series || anchor == null) return;
        if (brushViewportAnimRafRef.current != null) {
          cancelAnimationFrame(brushViewportAnimRafRef.current);
          brushViewportAnimRafRef.current = null;
        }
        viewportAnimationActiveRef.current = false;

        const lockedRange = brushZoneOnlyLogicalRange(anchor, cfg);
        fixedLogicalRangeRef.current = lockedRange;
        applyLockedViewport(chart, series, lockedRange, price);
        scheduleReassertLockedViewport(chart, series, lockedRange, price);
        requestAnimationFrame(() => {
          updateOverlaysRef.current();
        });
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(outer);
    };
  }, [isLocked]);

  const onWsSnapshotLoaded = useCallback(() => {
    queueMicrotask(() => {
      restoreGameDrawingsFromStorageRef.current();
      performAfterTickRef.current();
    });
    setTimeout(() => updateOverlaysRef.current(), 0);
  }, []);

  const onWsCandleTick = useCallback(() => {
    performAfterTickRef.current();
  }, []);

  const onRoundWindowFromWs = useCallback(
    (start: number, end: number) => {
      onGameRoundWindowKnown?.({ startTime: start, endTime: end });
    },
    [onGameRoundWindowKnown],
  );

  useWebSocket({
    wsUrl,
    coin: effectiveCoin,
    chartRef,
    seriesRef,
    lastTimeRef,
    gameStartTimeRef,
    gameStartPriceRef,
    gameObservationEndTimeRef,
    gameTahminEndTimeRef,
    gameBrushZoneEndTimeRef,
    roundAnchorLogicalRef,
    fixedLogicalRangeRef,
    fixedPriceRangeRef,
    gameConfig,
    onSnapshotLoaded: onWsSnapshotLoaded,
    onCandleTick: onWsCandleTick,
    pauseLivePriceRangeRef,
    flushLivePriceRangeRef,
    viewportAnimationActiveRef,
    onGameRoundWindowKnown: onRoundWindowFromWs,
  });

  // SSE-driven phase override: when backend says "drawing", force phase 2 + activate brush
  useEffect(() => {
    if (!externalPhase) return;
    externalDrawingPhaseRef.current = externalPhase === 2;
    setGamePhase((prev) => {
      if (prev === externalPhase) return prev;
      // Phase 1→2 transition: auto-activate brush
      if (externalPhase === 2 && !isLockedRef.current) {
        // Set pendingTool so brush activates even if lineTools isn't ready yet
        pendingToolRef.current = "Brush";
        queueMicrotask(() => {
          if (!isLockedRef.current && lineToolsRef.current) {
            addToolWithDevClear("Brush");
            updateActiveTool("Brush");
            requestAnimationFrame(() => {
              chartContainerRef.current?.focus({ preventScroll: true });
            });
          }
        });
      }
      // Phase 2→3 transition: lock the game (submit drawings)
      if (externalPhase === 3 && !isLockedRef.current) {
        queueMicrotask(() => {
          if (!isLockedRef.current) {
            const segments = drawingSegmentsRef.current;
            console.log("[Drawing — external lock]", {
              segments,
              flatPoints: segments.flat(),
              segmentCount: segments.length,
              totalPoints: segments.reduce((n, s) => n + s.length, 0),
            });
            pendingToolRef.current = null;
            setIsLocked(true);
            lockAllTools();
            if (activeToolRef.current) updateActiveTool(null);
            deactivateDrawingMode();
            emitDrawingCapability("external-phase-locked", { forceLog: true });
          }
        });
      }
      return externalPhase;
    });
  }, [externalPhase, addToolWithDevClear, updateActiveTool, lineToolsRef, lockAllTools, deactivateDrawingMode, emitDrawingCapability]);

  const brushAllowed = !isLocked && (chartDebugMode || gamePhase === 2);

  useEffect(() => {
    brushAllowedRef.current = brushAllowed;
  }, [brushAllowed]);

  useEffect(() => {
    emitDrawingCapability("react-state");
  }, [
    activeTool,
    gamePhase,
    isLocked,
    brushAllowed,
    chartDebugMode,
    emitDrawingCapability,
  ]);

  useEffect(() => {
    const next: DrawingToolbarState = {
      activeDrawingToolKey: activeTool,
      isEngaged: activeTool !== null,
    };
    setDrawingToolbar(next);
    onDrawingToolbarChange?.(next);
  }, [activeTool, onDrawingToolbarChange]);

  /** Fırça artık izinli değilse (faz değişimi) araç modunu kapat */
  useEffect(() => {
    if (activeTool !== "Brush") return;
    if (brushAllowed) return;
    pendingToolRef.current = null;
    updateActiveTool(null);
    deactivateDrawingMode();
    emitDrawingCapability("condition:brush-phase-closed-tool", {
      forceLog: true,
    });
  }, [
    activeTool,
    brushAllowed,
    updateActiveTool,
    deactivateDrawingMode,
    emitDrawingCapability,
  ]);

  useEffect(() => {
    const g = globalThis as unknown as {
      __tradingChartDrawingCapability?: DrawingCapabilityState | null;
      __tradingChartDrawingToolbar?: DrawingToolbarState;
    };
    if (!chartDebugMode) {
      delete g.__tradingChartDrawingCapability;
      delete g.__tradingChartDrawingToolbar;
      return;
    }
    g.__tradingChartDrawingCapability = drawingCapability;
    g.__tradingChartDrawingToolbar = drawingToolbar;
  }, [chartDebugMode, drawingCapability, drawingToolbar]);

  onStrokeFinishedContinuationRef.current = (toolInfo: {
    toolType?: string;
    id?: string;
  }) => {
    const type = toolInfo?.toolType;
    if (
      type !== "Brush" &&
      type !== "TrendLine" &&
      type !== "Ray" &&
      type !== "HorizontalLine" &&
      type !== "FibRetracement"
    ) {
      return;
    }
    const finishedId = toolInfo?.id;
    if (
      typeof finishedId === "string" &&
      finishedId.length > 0 &&
      !isLockedRef.current
    ) {
      drawingRedoStackRef.current = [];
      drawingUndoStackRef.current.push({ id: finishedId, toolType: type });
    }
    if (isLockedRef.current) return;
    if (type === "Brush" && !brushAllowedRef.current && !externalDrawingPhaseRef.current) return;
    queueMicrotask(() => {
      if (isLockedRef.current) return;
      if (type === "Brush" && !brushAllowedRef.current && !externalDrawingPhaseRef.current) return;
      addToolRef.current(type, { replacePreviousOfSameKind: false });
      requestAnimationFrame(() => {
        chartContainerRef.current?.focus({ preventScroll: true });
      });
      emitDrawingCapability(`stroke-continued:${type}`, { forceLog: true });
    });
  };

  const handleSelectTool = useCallback(
    (toolKey: string) => {
      if (isLocked) {
        emitDrawingCapability("handleSelectTool:blocked-locked", {
          forceLog: true,
        });
        return;
      }

      if (activeTool === toolKey) {
        pendingToolRef.current = null;
        updateActiveTool(null);
        deactivateDrawingMode();
        emitDrawingCapability(`handleSelectTool:toggle-off:${toolKey}`, {
          forceLog: true,
        });
        return;
      }

      if (toolKey === "Brush" && !brushAllowed) {
        emitDrawingCapability("handleSelectTool:blocked-brush-phase", {
          forceLog: true,
        });
        return;
      }

      updateActiveTool(toolKey);
      if (!lineToolsRef.current || !fixedLogicalRangeRef.current) {
        pendingToolRef.current = toolKey;
        queueMicrotask(() => {
          tryApplyPendingToolRef.current();
        });
        emitDrawingCapability("handleSelectTool:pending-until-chart", {
          forceLog: true,
        });
        return;
      }
      pendingToolRef.current = null;
      addToolWithDevClear(toolKey, {
        replacePreviousOfSameKind:
          toolKey === "Brush" || toolKey === "FibRetracement",
      });
      requestAnimationFrame(() => {
        chartContainerRef.current?.focus({ preventScroll: true });
      });
      emitDrawingCapability(`handleSelectTool:${toolKey}`, { forceLog: true });
    },
    [
      isLocked,
      activeTool,
      addToolWithDevClear,
      updateActiveTool,
      brushAllowed,
      emitDrawingCapability,
      deactivateDrawingMode,
    ],
  );

  useTradingChartKeyboard({
    isLocked,
    setChartDebugMode,
    undoLastDrawing,
    redoLastDrawing,
    handleSelectTool,
    removeSelectedAndPersist,
  });

  const handleDeleteSelected = useCallback(() => {
    if (isLocked) return;
    pendingToolRef.current = null;
    removeSelectedAndPersist();
    updateActiveTool(null);
    deactivateDrawingMode();
    emitDrawingCapability("deleteSelected", { forceLog: true });
  }, [
    isLocked,
    removeSelectedAndPersist,
    updateActiveTool,
    deactivateDrawingMode,
    emitDrawingCapability,
  ]);

  /** Kilit anında bile ilk karede — snapshot race olmadan rakibe iletilir */
  const paneDualSync: ChartDualSync | null =
    isLocked && hasResultSidePane
      ? buildPaneDualSync(
          chartRef.current ?? undefined,
          roundAnchorLogicalRef.current,
          fixedPriceRangeRef.current,
        )
      : null;

  return (
    <div className={cn(styles.wrapper, className)}>
      <TradingChartToolbar
        isLocked={isLocked}
        activeTool={activeTool}
        brushAllowed={brushAllowed}
        onSelectTool={handleSelectTool}
        onDeleteSelected={handleDeleteSelected}
      />

      <div className={styles.mainColumn}>
        <div className={styles.chartWorkspace}>
          <div
            className={cn(
              styles.chartLeftPane,
              isLocked ? styles.chartLeftPaneHalf : styles.chartLeftPaneFull,
            )}
          >
            <div className={styles.chartInfoBar} aria-label="Trading pair">
              {effectiveCoin}/USDC
            </div>
            <div
              className={styles.chartArea}
              style={
                {
                  ["--trading-chart-overlay-bottom" as string]: `${gameConfig.overlayBottomPx}px`,
                } as CSSProperties
              }
            >
              <div
                ref={gameTahminBgAreaRef}
                className={styles.gameTahminBgArea}
              />
              <div ref={gameBgAreaRef} className={styles.gameBgArea} />
              <div ref={lineT0Ref} className={styles.gameStartLine} />
              <div ref={lineObsEndRef} className={styles.gameEndLine} />
              <div ref={lineTahminEndRef} className={styles.gameRedLine} />
              <div ref={lineRoundEndRef} className={styles.gameRoundEndLine} />
              {chartDebugMode ? (
                <div className={styles.devDrawingPointsBadge} aria-hidden>
                  Debug: points · Shift+B
                </div>
              ) : null}
              <div ref={chartShellRef} className={styles.chartShell}>
                <div
                  ref={chartContainerRef}
                  className={cn(
                    styles.chart,
                    penCursorActive && styles.chartPenCursor,
                  )}
                  style={
                    penCursorActive
                      ? ({
                          cursor: PEN_CURSOR,
                          ["--trading-chart-pen-cursor" as string]: PEN_CURSOR,
                        } as CSSProperties)
                      : undefined
                  }
                  tabIndex={-1}
                  aria-label="Grafik — çizim için alan"
                />
                <canvas
                  ref={drawingDebugCanvasRef}
                  className={styles.drawingDebugCanvas}
                  aria-hidden
                />
              </div>
            </div>
          </div>
          {isLocked ? (
            <>
              <div className={styles.chartWorkspaceDivider} aria-hidden />
              <div
                className={styles.chartRightPlaceholder}
                aria-label={resultSidePane ? "Rakip grafiği" : undefined}
              >
                {isValidElement(resultSidePane)
                  ? cloneElement(
                      resultSidePane as ReactElement<OpponentMirrorChartProps>,
                      {
                        dualSync: paneDualSync,
                        mainChartPriceRangeRef: fixedPriceRangeRef,
                      },
                    )
                  : (resultSidePane ?? null)}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
