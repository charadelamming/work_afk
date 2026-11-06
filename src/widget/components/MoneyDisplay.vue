<script setup lang="ts">
import { computed } from "vue";

import { splitMoney } from "../../core/format";
import type { Decimals } from "../../core/types";

const props = defineProps<{
  value: number;
  decimals: Decimals;
}>();

const parts = computed(() => splitMoney(props.value, props.decimals));
</script>

<template>
  <div class="money">
    <span class="money__cur">¥</span>
    <span class="money__int">{{ parts.int }}</span>
    <span v-if="decimals > 0" class="money__dec">.{{ parts.dec }}</span>
    <span class="money__tag">今日已赚</span>
  </div>
</template>
