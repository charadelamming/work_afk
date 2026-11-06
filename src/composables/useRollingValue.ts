import { onUnmounted, ref, watch, type Ref } from "vue";

/**
 * 让显示值平滑追上目标值（默认 620ms ease-out）。
 * 每秒目标只更新一次，但画面是 60fps 连续滚动的，看起来才像「钱在跳」。
 */
export function useRollingValue(target: Ref<number>, duration = 620): Ref<number> {
  const display = ref(target.value);
  let current = target.value;
  let raf = 0;

  const cancel = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };

  const setDirect = (value: number) => {
    current = value;
    display.value = value;
  };

  const prefersReducedMotion = () =>
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  watch(target, (value) => {
    // 尊重系统「减少动画」设置：直接跳到目标值
    if (prefersReducedMotion()) {
      cancel();
      setDirect(value);
      return;
    }

    const from = current;
    const delta = value - from;
    if (Math.abs(delta) < 1e-9) {
      current = value;
      return;
    }

    const startedAt = performance.now();
    cancel();

    const tick = (now: number) => {
      const p = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      current = from + delta * eased;
      display.value = current;
      if (p < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        current = value;
        display.value = value;
        raf = 0;
      }
    };

    raf = requestAnimationFrame(tick);
  });

  onUnmounted(cancel);

  return display;
}
