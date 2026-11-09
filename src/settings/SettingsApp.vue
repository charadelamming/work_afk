<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";

import { useAutostart } from "../composables/useAutostart";
import { useSettings } from "../composables/useSettings";
import { formatMoney, formatRate } from "../core/format";
import { describeMonth, getMonthInfo, validateSettings } from "../core/pay";
import { WORKDAY_LABELS, type Decimals, type Workday } from "../core/types";
import { broadcastSettings } from "../platform/events";
import { closeCurrentWindow } from "../platform/window";
import SettingRow from "./components/SettingRow.vue";
import SwitchField from "./components/SwitchField.vue";
import TimeField from "./components/TimeField.vue";

const WEEK_ORDER: Workday[] = [1, 2, 3, 4, 5, 6, 7];
const DECIMALS: Decimals[] = [0, 1, 2, 3];

const { settings, patch, save, reset: resetSettings } = useSettings();
const { apply: applyAutostart } = useAutostart();

const errors = computed(() => (settings.value ? validateSettings(settings.value) : []));
const month = computed(() => (settings.value ? getMonthInfo(new Date(), settings.value) : null));

/** 不透明度滑杆的已填充比例（min 50 / max 100），交给 CSS 画浅色轨道 */
const opacityFill = computed(() => {
  const value = settings.value ? Math.round(settings.value.opacity * 100) : 94;
  const ratio = Math.min(1, Math.max(0, (value - 50) / 50));
  return `${(ratio * 100).toFixed(1)}%`;
});

const dailyWage = computed(() => {
  const payDays = month.value?.payDays ?? 0;
  return month.value && settings.value && payDays > 0 ? settings.value.salary / payDays : 0;
});

const workMinutes = computed(() => {
  if (!settings.value) return 0;
  const toMin = (value: string) => {
    const [h, m] = value.split(":").map(Number);
    return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : 0;
  };
  let total = Math.max(0, toMin(settings.value.workEnd) - toMin(settings.value.workStart));
  if (settings.value.lunchEnabled) {
    total -= Math.max(0, toMin(settings.value.lunchEnd) - toMin(settings.value.lunchStart));
  }
  return Math.max(0, total);
});

const hourly = computed(() => (workMinutes.value > 0 ? dailyWage.value / (workMinutes.value / 60) : 0));
const monthDescription = computed(() =>
  month.value && settings.value ? describeMonth(month.value, settings.value) : "",
);

const saveState = ref<"idle" | "saving" | "saved">("idle");
const justReset = ref(false);
const hydrated = ref(false);

let saveTimer: number | null = null;
let savedTimer: number | null = null;
let resetTimer: number | null = null;

// 修改即自动保存（防抖 450ms），并实时推送给悬浮窗
watch(settings, (value) => {
  if (!value) return;
  if (!hydrated.value) {
    hydrated.value = true;
    return;
  }
  if (errors.value.length > 0) return;

  if (saveTimer !== null) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(async () => {
    saveTimer = null;
    saveState.value = "saving";
    await save();
    if (settings.value) broadcastSettings(settings.value);
    saveState.value = "saved";
    if (savedTimer !== null) window.clearTimeout(savedTimer);
    savedTimer = window.setTimeout(() => {
      saveState.value = "idle";
      savedTimer = null;
    }, 1800);
  }, 450);
});

onUnmounted(() => {
  if (saveTimer !== null) window.clearTimeout(saveTimer);
  if (savedTimer !== null) window.clearTimeout(savedTimer);
  if (resetTimer !== null) window.clearTimeout(resetTimer);
});

function toggleWorkday(day: Workday) {
  const current = settings.value;
  if (!current) return;
  const has = current.workdays.includes(day);
  patch(
    "workdays",
    has ? current.workdays.filter((d) => d !== day) : [...current.workdays, day].sort((a, b) => a - b),
  );
}

function onSalaryInput(event: Event) {
  patch("salary", Number((event.target as HTMLInputElement).value));
}

function onPaydaysInput(event: Event) {
  patch("paydaysOverride", Number((event.target as HTMLInputElement).value));
}

function onAutoPaydaysChange(auto: boolean) {
  if (auto) {
    patch("paydaysOverride", null);
    return;
  }
  const payDays = month.value?.payDays;
  if (payDays != null) patch("paydaysOverride", payDays);
}

function onOpacityInput(event: Event) {
  patch("opacity", Number((event.target as HTMLInputElement).value) / 100);
}

function onAutostartChange(value: boolean) {
  patch("autostart", value);
  applyAutostart(value);
}

function close() {
  closeCurrentWindow();
}

function reset() {
  resetSettings();
  justReset.value = true;
  if (resetTimer !== null) window.clearTimeout(resetTimer);
  resetTimer = window.setTimeout(() => {
    justReset.value = false;
    resetTimer = null;
  }, 1600);
}
</script>

<template>
  <div v-if="settings && month" class="settings">
    <header class="set-head">
      <div>
        <h1>设置</h1>
        <p>改完即时生效，自动保存在本机，不会上传任何数据。</p>
      </div>
      <button type="button" class="set-close" title="关闭" @click="close">✕</button>
    </header>

    <main class="set-body">
      <section class="panel">
        <div class="panel__head">
          <h2>薪资待遇</h2>
          <span class="panel__hint">口径由你决定：填到手月薪即可</span>
        </div>

        <div class="salary">
          <span class="salary__cur">¥</span>
          <input
            class="salary__input"
            type="number"
            min="0"
            step="100"
            :value="Number.isFinite(settings.salary) ? settings.salary : 0"
            @input="onSalaryInput"
          />
          <span class="salary__unit">元 / 月</span>
        </div>

        <div class="stat-grid">
          <div class="stat-card">
            <span class="stat-card__k">日薪</span>
            <span class="stat-card__v">{{ formatMoney(dailyWage, 2) }}</span>
          </div>
          <div class="stat-card">
            <span class="stat-card__k">时薪</span>
            <span class="stat-card__v">{{ formatRate(hourly) }}</span>
          </div>
          <div class="stat-card">
            <span class="stat-card__k">每秒</span>
            <span class="stat-card__v">{{ formatRate(hourly / 3600) }}</span>
          </div>
          <div class="stat-card">
            <span class="stat-card__k">本月计薪</span>
            <span class="stat-card__v">{{ month.payDays }}<small> 天</small></span>
          </div>
        </div>

        <SettingRow title="自动计算计薪天数" :desc="monthDescription">
          <SwitchField
            :model-value="settings.paydaysOverride == null"
            label="自动计算计薪天数"
            @update:model-value="onAutoPaydaysChange"
          />
        </SettingRow>

        <SettingRow v-if="settings.paydaysOverride != null" title="手动计薪天数" desc="比如 21.75、22；改完日薪会立即重算">
          <input
            class="input input--short"
            type="number"
            min="1"
            max="31"
            step="0.25"
            :value="settings.paydaysOverride"
            @input="onPaydaysInput"
          />
        </SettingRow>
      </section>

      <section class="panel">
        <div class="panel__head">
          <h2>工作时间</h2>
          <span class="panel__hint">午休期间工资暂停滚动</span>
        </div>

        <div class="time-grid">
          <TimeField
            label="上班时间"
            :model-value="settings.workStart"
            @update:model-value="(value) => patch('workStart', value)"
          />
          <TimeField
            label="下班时间"
            :model-value="settings.workEnd"
            @update:model-value="(value) => patch('workEnd', value)"
          />
        </div>

        <SettingRow title="扣除午休" desc="开启后，午休时段金额冻结">
          <SwitchField
            :model-value="settings.lunchEnabled"
            label="扣除午休"
            @update:model-value="(value) => patch('lunchEnabled', value)"
          />
        </SettingRow>

        <div v-if="settings.lunchEnabled" class="time-grid">
          <TimeField
            label="午休开始"
            :model-value="settings.lunchStart"
            @update:model-value="(value) => patch('lunchStart', value)"
          />
          <TimeField
            label="午休结束"
            :model-value="settings.lunchEnd"
            @update:model-value="(value) => patch('lunchEnd', value)"
          />
        </div>

        <div class="field field--block">
          <span class="field__label">每周工作日</span>
          <div class="chips">
            <button
              v-for="day in WEEK_ORDER"
              :key="day"
              type="button"
              class="chip"
              :class="{ 'is-on': settings.workdays.includes(day) }"
              @click="toggleWorkday(day)"
            >
              周{{ WORKDAY_LABELS[day] }}
            </button>
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="panel__head">
          <h2>显示与行为</h2>
          <span class="panel__hint">小组件外观</span>
        </div>

        <SettingRow title="小数位数" desc="决定金额滚动的精细程度">
          <div class="seg">
            <button
              v-for="d in DECIMALS"
              :key="d"
              type="button"
              class="seg__item"
              :class="{ 'is-on': settings.decimals === d }"
              @click="patch('decimals', d)"
            >
              {{ d }}
            </button>
          </div>
        </SettingRow>

        <SettingRow title="卡片不透明度" :desc="`${Math.round(settings.opacity * 100)}%`" stacked>
          <input
            class="slider"
            type="range"
            min="50"
            max="100"
            step="1"
            :value="Math.round(settings.opacity * 100)"
            :style="{ '--fill': opacityFill }"
            @input="onOpacityInput"
          />
        </SettingRow>

        <SettingRow title="底部统计栏" desc="显示时薪、每秒和本月已赚；关闭后小组件更紧凑">
          <SwitchField
            :model-value="settings.showStats"
            label="底部统计栏"
            @update:model-value="(value) => patch('showStats', value)"
          />
        </SettingRow>

        <SettingRow title="里程碑特效" desc="每赚满 ¥100 弹一次提示">
          <SwitchField
            :model-value="settings.effects"
            label="里程碑特效"
            @update:model-value="(value) => patch('effects', value)"
          />
        </SettingRow>

        <SettingRow title="窗口置顶" desc="让小组件一直压在其它窗口上方">
          <SwitchField
            :model-value="settings.alwaysOnTop"
            label="窗口置顶"
            @update:model-value="(value) => patch('alwaysOnTop', value)"
          />
        </SettingRow>

        <SettingRow title="开机自动启动" desc="登录 Windows 后自动出现在桌面角落">
          <SwitchField
            :model-value="settings.autostart"
            label="开机自动启动"
            @update:model-value="onAutostartChange"
          />
        </SettingRow>
      </section>

      <section v-if="month.holidays.length > 0" class="panel panel--quiet">
        <div class="panel__head">
          <h2>本月法定节假日</h2>
          <span class="panel__hint">这些天不上班也照发工资</span>
        </div>
        <div class="holiday-list">
          <span v-for="holiday in month.holidays" :key="holiday.day" class="holiday">
            {{ month.month + 1 }} 月 {{ holiday.day }} 日 · {{ holiday.name }}
          </span>
        </div>
      </section>
    </main>

    <footer class="set-foot">
      <div class="foot__state">
        <span v-if="errors.length > 0" class="foot__error">{{ errors[0] }}</span>
        <span v-else-if="justReset" class="foot__ok">已恢复默认设置</span>
        <span v-else-if="saveState === 'saving'" class="foot__muted">保存中…</span>
        <span v-else-if="saveState === 'saved'" class="foot__ok">已自动保存</span>
        <span v-else class="foot__muted">修改会实时同步到小组件</span>
      </div>
      <div class="foot__actions">
        <button type="button" class="btn btn--ghost" @click="reset">恢复默认</button>
        <button type="button" class="btn btn--primary" @click="close">完成</button>
      </div>
    </footer>
  </div>
</template>
