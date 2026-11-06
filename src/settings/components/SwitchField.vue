<script setup lang="ts">
defineProps<{
  modelValue: boolean;
  label: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
}>();

function onChange(event: Event) {
  emit("update:modelValue", (event.target as HTMLInputElement).checked);
}
</script>

<template>
  <label class="switch" :aria-label="label">
    <input type="checkbox" :checked="modelValue" @change="onChange" />
    <span class="switch__track">
      <span class="switch__thumb" />
    </span>
  </label>
</template>
