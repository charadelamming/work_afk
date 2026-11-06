import { onMounted, onUnmounted, ref } from "vue";

/**
 * 1Hz 当前时间；窗口隐藏时暂停定时器，恢复时立刻对齐系统时钟。
 */
export function useNow(interval = 1000) {
  const now = ref(new Date());
  let timer: number | null = null;

  const tick = () => {
    now.value = new Date();
  };

  const stop = () => {
    if (timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  };

  const start = () => {
    stop();
    tick();
    timer = window.setInterval(tick, interval);
  };

  const resync = () => {
    tick();
  };

  const onVisibilityChange = () => {
    if (document.hidden) stop();
    else start();
  };

  onMounted(() => {
    start();
    window.addEventListener("focus", resync);
    document.addEventListener("visibilitychange", onVisibilityChange);
  });

  onUnmounted(() => {
    stop();
    window.removeEventListener("focus", resync);
    document.removeEventListener("visibilitychange", onVisibilityChange);
  });

  return { now, resync };
}
