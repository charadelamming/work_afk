<script setup lang="ts">
import type { Phase } from "../../core/pay";

defineProps<{
  phase: Phase;
  main: string;
  sub: string;
}>();
</script>

<template>
  <div class="status">
    <i class="dot" :class="`dot--${phase}`" />
    <span class="status__main">{{ main }}</span>
    <span class="status__sub">{{ sub }}</span>
  </div>
</template>
