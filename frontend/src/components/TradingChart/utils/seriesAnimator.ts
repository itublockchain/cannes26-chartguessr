import type { ISeriesApi, UTCTimestamp } from "lightweight-charts";

/**
 * Smooth price animator for Lightweight Charts.
 *
 * Key insight: Multiple WS ticks can arrive within the SAME second.
 * We only animate when time ADVANCES to a new second.
 * Same-second updates just update the animation's target in-flight
 * (no restart, no cancel).
 */
export class SeriesAnimator {
  private series: ISeriesApi<"Area"> | null;
  private rafId: number | null = null;
  private disposed = false;

  private lastValue: number | null = null;
  private lastTime: number | null = null;

  /** The value we're currently animating toward. */
  private animatingTarget: number | null = null;
  /** Whether an animation is currently in progress. */
  private animating = false;

  constructor(series: ISeriesApi<"Area">) {
    this.series = series;
  }

  /**
   * Set target price. Behavior depends on whether time changed:
   *
   * - **New time slot**: Start a 500ms easeOutCubic animation from
   *   current displayed value to the new price.
   * - **Same time slot**: If animating, update target in-flight
   *   (animation continues smoothly). If not animating, push directly.
   */
  setTarget(time: number, value: number): void {
    if (this.disposed || !this.series) return;

    // First ever value — snap immediately
    if (this.lastValue == null || this.lastTime == null) {
      this.lastValue = value;
      this.lastTime = time;
      this.push(time, value);
      return;
    }

    const timeChanged = time !== this.lastTime;

    if (timeChanged) {
      // ── NEW SECOND ── Start fresh animation
      // Finalize old time slot
      if (this.animatingTarget != null) {
        this.push(this.lastTime, this.animatingTarget);
        this.lastValue = this.animatingTarget;
      }

      // Cancel old animation if any
      if (this.rafId != null) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }

      this.lastTime = time;
      const startValue = this.lastValue;
      const targetValue = value;
      this.animatingTarget = targetValue;

      const diff = targetValue - startValue;
      if (Math.abs(diff) < 1e-12) {
        this.lastValue = value;
        this.push(time, value);
        this.animating = false;
        return;
      }

      // Animate: 500ms easeOutCubic
      // Push initial value immediately (no 16ms gap)
      this.push(time, startValue);
      this.animating = true;
      const t0 = performance.now();
      const duration = 500;

      const frame = (now: number) => {
        if (this.disposed || !this.series) return;

        const progress = Math.min((now - t0) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);

        // Use the LATEST target (may have been updated by same-second ticks)
        const currentTarget = this.animatingTarget!;
        const currentDiff = currentTarget - startValue;
        const current = startValue + currentDiff * eased;

        this.lastValue = current;
        this.push(time, current);

        if (progress < 1) {
          this.rafId = requestAnimationFrame(frame);
        } else {
          this.rafId = null;
          this.lastValue = currentTarget;
          this.push(time, currentTarget);
          this.animating = false;
          this.animatingTarget = null;
        }
      };

      this.rafId = requestAnimationFrame(frame);
    } else {
      // ── SAME SECOND ── Update target, don't restart animation
      if (this.animating) {
        // Animation already running — just update its target.
        // The running animation frame will pick up the new target.
        this.animatingTarget = value;
      } else {
        // No animation running — push directly
        this.lastValue = value;
        this.push(time, value);
      }
    }
  }

  /** Instant update — no animation. For gap-fills and snapshots. */
  snapTo(time: number, value: number): void {
    if (this.disposed || !this.series) return;

    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.animating = false;
    this.animatingTarget = null;

    this.lastTime = time;
    this.lastValue = value;
    this.push(time, value);
  }

  /** Reset state. */
  reset(): void {
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.lastValue = null;
    this.lastTime = null;
    this.animating = false;
    this.animatingTarget = null;
  }

  /** Cleanup. */
  dispose(): void {
    this.disposed = true;
    this.reset();
    this.series = null;
  }

  /** No-op — API compat. */
  start(): void {}

  /** Alias. */
  animateTo(time: number, value: number): void {
    this.setTarget(time, value);
  }

  private push(time: number, value: number): void {
    try {
      this.series?.update({ time: time as UTCTimestamp, value });
    } catch { /* detached */ }
  }
}
