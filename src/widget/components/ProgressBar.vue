<script setup lang="ts">
import { computed } from "vue";

import { formatPercent } from "../../core/format";
import type { Phase } from "../../core/pay";

const props = defineProps<{
  progress: number;
  phase: Phase;
  start: string;
  end: string;
}>();

const width = computed(() => `${Math.min(100, props.progress * 100)}%`);
const isRestDay = computed(() => props.phase === "holiday" || props.phase === "rest");
</script>

<template>
  <div class="track">
    <div class="track__fill" :style="{ width }" />
  </div>

  <div v-if="isRestDay" class="scale scale--single">
    <span>{{ phase === "holiday" ? "法定节假日 · 全天计薪" : "休息日 · 今天不计薪" }}</span>
  </div>
  <div v-else class="scale">
    <span>{{ start }}</span>
    <span class="scale__pct">{{ formatPercent(progress) }}</span>
    <span>{{ end }}</span>
  </div>
</template>
