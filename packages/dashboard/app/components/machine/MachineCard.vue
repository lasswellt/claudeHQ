<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { MachineRecord } from '@chq/shared/browser';
import StatusIndicator from '../StatusIndicator.vue';
import { useMachineConditions, type MachineCondition } from '../../composables/useMachineConditions';

// CAP-035 / stories 020-002 + 020-003: richer machine card with
// StatusIndicator, K8s-style conditions, session-slot progress
// bar, and CPU/memory sparklines from the last 30 min of
// machine_health_history.

const props = defineProps<{ machine: MachineRecord }>();
defineEmits<{ (e: 'select', id: string): void }>();

interface HealthSample {
  recorded_at: number;
  cpu_percent: number;
  mem_percent: number;
  active_sessions: number;
}

const samples = ref<HealthSample[]>([]);
const loading = ref(false);

const { derive, headline } = useMachineConditions();

const meta = computed(() => {
  const raw = (props.machine as unknown as { meta?: unknown }).meta;
  if (!raw || typeof raw !== 'object') return {} as Record<string, unknown>;
  return raw as Record<string, unknown>;
});

const cpuPercent = computed<number | undefined>(() =>
  typeof meta.value.cpuPercent === 'number' ? (meta.value.cpuPercent as number) : undefined,
);
const memPercent = computed<number | undefined>(() =>
  typeof meta.value.memPercent === 'number' ? (meta.value.memPercent as number) : undefined,
);
const activeSessions = computed<number>(() =>
  typeof meta.value.activeSessions === 'number' ? (meta.value.activeSessions as number) : 0,
);

const conditions = computed<MachineCondition[]>(() =>
  derive({
    lastSeen: props.machine.last_seen,
    cpuPercent: cpuPercent.value,
    memPercent: memPercent.value,
    activeSessions: activeSessions.value,
    maxSessions: props.machine.max_sessions,
  }),
);

const headlineCondition = computed(() => headline(conditions.value));

const slotPercent = computed(() => {
  if (props.machine.max_sessions <= 0) return 0;
  return Math.min(100, (activeSessions.value / props.machine.max_sessions) * 100);
});

const cpuSparkline = computed(() => samples.value.map((s) => s.cpu_percent));
const memSparkline = computed(() => samples.value.map((s) => s.mem_percent));

onMounted(async () => {
  loading.value = true;
  try {
    // Last 30 minutes — the health endpoint from 012-005 accepts `hours`.
    const res = await fetch(`/api/machines/${props.machine.id}/health?hours=0.5`);
    if (res.ok) {
      samples.value = (await res.json()) as HealthSample[];
    }
  } catch {
    // Non-fatal — card still renders without sparklines
  } finally {
    loading.value = false;
  }
});

const conditionColor: Record<MachineCondition['severity'], string> = {
  ok: 'success',
  warning: 'warning',
  error: 'error',
};
</script>

<template>
  <v-card class="machine-card" @click="$emit('select', machine.id)">
    <v-card-item>
      <template #prepend>
        <StatusIndicator :status="machine.status" variant="icon" size="small" />
      </template>
      <v-card-title>{{ machine.display_name || machine.id }}</v-card-title>
      <v-card-subtitle v-if="headlineCondition">
        <v-chip
          :color="conditionColor[headlineCondition.severity]"
          size="x-small"
          variant="flat"
        >
          {{ headlineCondition.kind }}
        </v-chip>
        <span class="text-caption ml-2">{{ headlineCondition.reason }}</span>
      </v-card-subtitle>
    </v-card-item>

    <v-card-text>
      <!-- Session slot progress bar -->
      <div class="d-flex justify-space-between align-center mb-1">
        <span class="text-caption">Sessions</span>
        <span class="text-caption text-medium-emphasis">
          {{ activeSessions }} / {{ machine.max_sessions }}
        </span>
      </div>
      <v-progress-linear
        :model-value="slotPercent"
        :color="slotPercent >= 90 ? 'warning' : 'primary'"
        height="6"
        rounded
        class="mb-3"
      />

      <!-- CPU + memory sparklines (last 30 min) -->
      <div v-if="cpuSparkline.length > 1" class="d-flex ga-3 mb-2">
        <div class="flex-grow-1">
          <div class="text-caption text-medium-emphasis">
            CPU {{ cpuPercent !== undefined ? `${Math.round(cpuPercent)}%` : '—' }}
          </div>
          <v-sparkline
            :model-value="cpuSparkline"
            :height="24"
            color="primary"
            line-width="1.5"
            smooth
            auto-draw
          />
        </div>
        <div class="flex-grow-1">
          <div class="text-caption text-medium-emphasis">
            Memory {{ memPercent !== undefined ? `${Math.round(memPercent)}%` : '—' }}
          </div>
          <v-sparkline
            :model-value="memSparkline"
            :height="24"
            color="secondary"
            line-width="1.5"
            smooth
            auto-draw
          />
        </div>
      </div>

      <div v-if="meta.os" class="text-caption text-medium-emphasis">
        {{ String(meta.os) }}
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
