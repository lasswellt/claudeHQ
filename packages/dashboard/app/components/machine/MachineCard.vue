<script setup lang="ts">
import type { MachineRecord } from '@chq/shared/browser';

defineProps<{ machine: MachineRecord }>();
defineEmits<{ (e: 'select', id: string): void }>();
</script>

<template>
  <v-card class="machine-card" @click="$emit('select', machine.id)">
    <v-card-item>
      <template #prepend>
        <v-icon :color="machine.status === 'online' ? 'success' : 'error'" size="12">
          mdi-circle
        </v-icon>
      </template>
      <v-card-title>{{ machine.display_name || machine.id }}</v-card-title>
      <v-card-subtitle>{{ machine.status }}</v-card-subtitle>
    </v-card-item>
    <v-card-text>
      <div class="d-flex justify-space-between align-center mb-2">
        <span class="text-caption">Sessions</span>
        <v-chip size="x-small" :color="machine.status === 'online' ? 'primary' : 'default'">
          {{ machine.max_sessions }} max
        </v-chip>
      </div>
      <div v-if="machine.meta" class="text-caption text-medium-emphasis">
        {{ machine.meta.os }}
      </div>
    </v-card-text>
  </v-card>
</template>

<style scoped>
.machine-card {
  cursor: pointer;
  transition: transform 0.1s;
}
.machine-card:hover {
  transform: translateY(-2px);
}
</style>
