<script setup lang="ts">
withDefaults(
  defineProps<{
    title: string;
    desc?: string;
    stacked?: boolean;
  }>(),
  { stacked: false },
);
</script>

<template>
  <div class="row" :class="{ 'row--stacked': stacked }">
    <div class="row__text">
      <div class="row__title">{{ title }}</div>
      <div v-if="desc" class="row__desc">{{ desc }}</div>
    </div>
    <div class="row__control">
      <slot />
    </div>
  </div>
</template>
