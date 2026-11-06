import { computed, type Ref } from "vue";

import { getDayPlan, getMonthEarned } from "../core/pay";
import type { Settings } from "../core/types";

/** 结合当前时间与设置计算 DayPlan / 本月累计 */
export function useDayPlan(settings: Ref<Settings | null>, now: Ref<Date>) {
  const plan = computed(() => (settings.value ? getDayPlan(now.value, settings.value) : null));

  const monthEarned = computed(() => {
    if (!settings.value || !plan.value) return 0;
    return getMonthEarned(now.value, settings.value, plan.value.earned);
  });

  return { plan, monthEarned };
}
