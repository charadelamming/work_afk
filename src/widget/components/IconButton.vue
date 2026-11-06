<script setup lang="ts">
defineProps<{
  title: string;
  active?: boolean;
}>();
</script>

<template>
  <button type="button" class="ico" :class="{ 'is-on': active }" :title="title" :aria-label="title">
    <slot />
  </button>
</template>
