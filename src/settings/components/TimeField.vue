<script setup lang="ts">
defineProps<{
  modelValue: string;
  label: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

function onInput(event: Event) {
  emit("update:modelValue", (event.target as HTMLInputElement).value);
}
</script>

<template>
  <label class="field">
    <span class="field__label">{{ label }}</span>
    <input class="input" type="time" step="60" :value="modelValue" @input="onInput" />
  </label>
</template>
