<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';

const props = defineProps<{ machineId: string }>();

interface HealthPoint {
  recorded_at: number;
  cpu_percent: number;
  mem_percent: number;
  active_sessions: number;
}

const healthData = ref<HealthPoint[]>([]);
const loading = ref(true);
const hours = ref(24);

async function fetchHealth(): Promise<void> {
  loading.value = true;
  try {
    const res = await fetch(`/api/machines/${props.machineId}/health?hours=${hours.value}`);
    healthData.value = (await res.json()) as HealthPoint[];
  } finally {
    loading.value = false;
  }
}

onMounted(() => fetchHealth());
watch(() => hours.value, () => fetchHealth());

function sparklineValues(key: 'cpu_percent' | 'mem_percent'): number[] {
  // Sample down to ~50 points max
  const data = healthData.value;
  if (data.length <= 50) return data.map((d) => d[key]);
  const step = Math.ceil(data.length / 50);
  return data.filter((_, i) => i % step === 0).map((d) => d[key]);
}
</script>

<template>
  <v-card>
    <v-card-title class="d-flex align-center justify-space-between">
      <span>Health History</span>
      <v-btn-toggle v-model="hours" mandatory density="compact" variant="outlined">
        <v-btn :value="1" size="x-small">1h</v-btn>
        <v-btn :value="6" size="x-small">6h</v-btn>
        <v-btn :value="24" size="x-small">24h</v-btn>
      </v-btn-toggle>
    </v-card-title>
    <v-card-text>
      <v-skeleton-loader v-if="loading" type="image" height="120" />
      <template v-else-if="healthData.length > 0">
        <div class="mb-3">
          <div class="text-caption text-medium-emphasis mb-1">CPU %</div>
          <v-sparkline
            :model-value="sparklineValues('cpu_percent')"
            color="primary"
            line-width="2"
            padding="4"
            smooth
            height="50"
            auto-draw
          />
        </div>
        <div>
          <div class="text-caption text-medium-emphasis mb-1">Memory %</div>
          <v-sparkline
            :model-value="sparklineValues('mem_percent')"
            color="secondary"
            line-width="2"
            padding="4"
            smooth
            height="50"
            auto-draw
          />
        </div>
      </template>
      <div v-else class="text-medium-emphasis text-body-2">No health data yet.</div>
    </v-card-text>
  </v-card>
</template>
