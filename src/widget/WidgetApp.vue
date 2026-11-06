<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";

import { useDayPlan } from "../composables/useDayPlan";
import { useNow } from "../composables/useNow";
import { useRollingValue } from "../composables/useRollingValue";
import { useSettings } from "../composables/useSettings";
import { useWindowChrome } from "../composables/useWindowChrome";
import { formatHMS, isoWeekday } from "../core/date";
import { formatMoney, formatRate } from "../core/format";
import type { DayPlan } from "../core/pay";
import type { Settings } from "../core/types";
import { isTauri } from "../platform/config";
import { broadcastSettings } from "../platform/events";
import MoneyDisplay from "./components/MoneyDisplay.vue";
import ProgressBar from "./components/ProgressBar.vue";
import StatusLine from "./components/StatusLine.vue";
import IconButton from "./components/IconButton.vue";
import PinIcon from "./components/icons/PinIcon.vue";
import GearIcon from "./components/icons/GearIcon.vue";
import HideIcon from "./components/icons/HideIcon.vue";
import SparkIcon from "./components/icons/SparkIcon.vue";

const WEEK_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

interface StatusText {
  main: string;
  sub: string;
}

function getStatusText(plan: DayPlan, settings: Settings): StatusText {
  switch (plan.phase) {
    case "before":
      return { main: `距开工 ${formatHMS(plan.untilStartSeconds)}`, sub: "还没开始，先摸会儿鱼" };
    case "working":
      return { main: `搬砖中 · 距离下班 ${formatHMS(plan.remainingSeconds)}`, sub: "每一秒都在进账" };
    case "lunch":
      return { main: "干饭中 · 工资暂停", sub: `午休 ${settings.lunchStart} – ${settings.lunchEnd}` };
    case "after":
      return { main: "今日收工 · 已落袋", sub: `明天 ${settings.workStart} 继续` };
    case "holiday":
      return { main: `${plan.holidayName ?? "法定节假日"} · 躺赚一整天`, sub: "法定节假日，工资照发" };
    case "rest":
      return { main: "休息日 · 今天不打工", sub: "快乐白嫖，明天再说" };
    default:
      return { main: "正在计算", sub: "" };
  }
}

const { settings, patch, save } = useSettings({ subscribe: true });
const { now } = useNow();
const { plan, monthEarned } = useDayPlan(settings, now);
const { show, hide, setAlwaysOnTop, openSettings } = useWindowChrome();

const earned = computed(() => plan.value?.earned ?? 0);
const rolled = useRollingValue(earned, 620);
const status = computed<StatusText>(() => {
  if (!settings.value || !plan.value) return { main: "正在计算", sub: "" };
  return getStatusText(plan.value, settings.value);
});
const hourly = computed(() => (plan.value ? plan.value.perSecond * 3600 : 0));
const dateText = computed(
  () => `${now.value.getMonth() + 1}.${String(now.value.getDate()).padStart(2, "0")} ${WEEK_LABELS[isoWeekday(now.value) - 1]}`,
);

const burst = ref<{ id: number; amount: number } | null>(null);
let burstTimer: number | null = null;
let lastHundred = 0;

// 每跨过一个 ¥100 撒一次花（只在「工作中」触发，避免静默补算时连环爆炸）
watch(
  () => plan.value?.earned ?? 0,
  (earnedValue) => {
    if (!settings.value?.effects || !plan.value) return;
    const hundreds = Math.floor(earnedValue / 100);
    if (hundreds > lastHundred && lastHundred > 0) {
      burst.value = { id: Date.now(), amount: hundreds * 100 };
      if (burstTimer !== null) window.clearTimeout(burstTimer);
      burstTimer = window.setTimeout(() => {
        burst.value = null;
        burstTimer = null;
      }, 1600);
    }
    lastHundred = hundreds;
  },
);

// 首帧画完再显示窗口，避免白屏闪烁（位置由 Rust 侧恢复）
watch(settings, (value) => {
  if (!isTauri || !value) return;
  requestAnimationFrame(() => show());
});

// 置顶状态跟随设置
watch(
  () => settings.value?.alwaysOnTop,
  (value) => {
    if (value == null) return;
    setAlwaysOnTop(value);
  },
);

onUnmounted(() => {
  if (burstTimer !== null) window.clearTimeout(burstTimer);
});

async function togglePin() {
  const current = settings.value;
  if (!current) return;
  const next = { ...current, alwaysOnTop: !current.alwaysOnTop };
  patch("alwaysOnTop", next.alwaysOnTop);
  await save();
  broadcastSettings(next);
}
</script>

<template>
  <div
    v-if="settings && plan"
    class="card"
    :class="`card--${plan.phase}`"
    :style="{ '--alpha': settings.opacity }"
  >
    <header class="bar">
      <div class="brand" data-tauri-drag-region>
        <SparkIcon class="brand__spark" />
        <span data-tauri-drag-region>重生之我挂机上班</span>
      </div>
      <span class="date-chip" data-tauri-drag-region>{{ dateText }}</span>
      <div class="bar__actions">
        <IconButton
          :title="settings.alwaysOnTop ? '取消置顶' : '窗口置顶'"
          :active="settings.alwaysOnTop"
          @click="togglePin"
        >
          <PinIcon />
        </IconButton>
        <IconButton title="设置" @click="openSettings">
          <GearIcon />
        </IconButton>
        <IconButton title="收进托盘" @click="hide">
          <HideIcon />
        </IconButton>
      </div>
    </header>

    <MoneyDisplay :value="rolled" :decimals="settings.decimals" />

    <StatusLine :phase="plan.phase" :main="status.main" :sub="status.sub" />

    <ProgressBar
      :progress="plan.progress"
      :phase="plan.phase"
      :start="settings.workStart"
      :end="settings.workEnd"
    />

    <footer class="stats">
      <div class="stat">
        <span class="stat__k">时薪</span>
        <span class="stat__v">{{ formatRate(hourly) }}</span>
      </div>
      <div class="stat stat--center">
        <span class="stat__k">每秒</span>
        <span class="stat__v">{{ formatRate(plan.perSecond) }}</span>
      </div>
      <div class="stat stat--right">
        <span class="stat__k">本月已赚</span>
        <span class="stat__v">{{ formatMoney(monthEarned, 0) }}</span>
      </div>
    </footer>

    <div v-if="burst" :key="burst.id" class="burst">+¥{{ burst.amount }} 达成</div>
  </div>
</template>
