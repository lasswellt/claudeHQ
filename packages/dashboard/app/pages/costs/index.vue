<script setup lang="ts">
import { ref, onMounted } from 'vue';

definePageMeta({ layout: 'default' });

interface CostSummary {
  today: { cost: number; tokens: number };
  week: { cost: number };
  month: { cost: number };
}

interface CostByEntity { repo_name?: string; machine_name?: string; total_cost: number; session_count: number }
interface DailyCost { day: string; cost: number; tokens: number }

const summary = ref<CostSummary | null>(null);
const byRepo = ref<CostByEntity[]>([]);
const byMachine = ref<CostByEntity[]>([]);
const daily = ref<DailyCost[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

async function fetchCosts(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const fetchJson = async (url: string): Promise<unknown> => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      return res.json();
    };
    const [s, r, m, d] = await Promise.all([
      fetchJson('/api/costs/summary'),
      fetchJson('/api/costs/by-repo'),
      fetchJson('/api/costs/by-machine'),
      fetchJson('/api/costs/daily'),
    ]);
    summary.value = s as CostSummary;
    byRepo.value = r as CostByEntity[];
    byMachine.value = m as CostByEntity[];
    daily.value = d as DailyCost[];
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load cost data';
  } finally {
    loading.value = false;
  }
}

onMounted(fetchCosts);

function formatUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// CAP-073: CSV export. Triggers a download of the last 30 days of
// session_costs via the hub's export endpoint.
function exportCsv(): void {
  const to = Math.floor(Date.now() / 1000);
  const from = to - 30 * 86400;
  window.open(`/api/costs/export?from=${from}&to=${to}`, '_blank');
}
</script>

<template>
  <div>
    <div class="d-flex align-center justify-space-between mb-6">
      <h1 class="text-h4 font-weight-bold">Costs & Budget</h1>
      <v-btn
        variant="tonal"
        prepend-icon="mdi-download"
        :disabled="loading"
        @click="exportCsv"
      >
        Export CSV
      </v-btn>
    </div>

    <v-skeleton-loader v-if="loading" type="card" />
    <v-alert v-else-if="error" type="error" variant="tonal">
      {{ error }}
      <template #append>
        <v-btn variant="text" @click="fetchCosts">Retry</v-btn>
      </template>
    </v-alert>

    <template v-else-if="summary">
      <!-- Summary cards -->
      <v-row class="mb-6">
        <v-col cols="12" sm="4">
          <v-card>
            <v-card-item>
              <v-card-title class="text-h4">{{ formatUsd(summary.today.cost) }}</v-card-title>
              <v-card-subtitle>Today</v-card-subtitle>
            </v-card-item>
            <v-card-text class="text-caption">{{ formatTokens(summary.today.tokens) }} tokens</v-card-text>
          </v-card>
        </v-col>
        <v-col cols="12" sm="4">
          <v-card>
            <v-card-item>
              <v-card-title class="text-h4">{{ formatUsd(summary.week.cost) }}</v-card-title>
              <v-card-subtitle>This Week</v-card-subtitle>
            </v-card-item>
          </v-card>
        </v-col>
        <v-col cols="12" sm="4">
          <v-card>
            <v-card-item>
              <v-card-title class="text-h4">{{ formatUsd(summary.month.cost) }}</v-card-title>
              <v-card-subtitle>This Month</v-card-subtitle>
            </v-card-item>
          </v-card>
        </v-col>
      </v-row>

      <!-- Cost by repo -->
      <v-row>
        <v-col cols="12" md="6">
          <v-card>
            <v-card-title>Cost by Repository</v-card-title>
            <v-card-text>
              <v-list v-if="byRepo.length > 0" density="compact">
                <v-list-item v-for="item in byRepo" :key="item.repo_name">
                  <v-list-item-title>{{ item.repo_name || 'Unknown' }}</v-list-item-title>
                  <template #append>
                    <span class="font-weight-bold">{{ formatUsd(item.total_cost) }}</span>
                    <span class="text-caption text-medium-emphasis ml-2">({{ item.session_count }} sessions)</span>
                  </template>
                </v-list-item>
              </v-list>
              <div v-else class="text-medium-emphasis">No cost data yet.</div>
            </v-card-text>
          </v-card>
        </v-col>
        <v-col cols="12" md="6">
          <v-card>
            <v-card-title>Cost by Machine</v-card-title>
            <v-card-text>
              <v-list v-if="byMachine.length > 0" density="compact">
                <v-list-item v-for="item in byMachine" :key="item.machine_name">
                  <v-list-item-title>{{ item.machine_name || 'Unknown' }}</v-list-item-title>
                  <template #append>
                    <span class="font-weight-bold">{{ formatUsd(item.total_cost) }}</span>
                  </template>
                </v-list-item>
              </v-list>
              <div v-else class="text-medium-emphasis">No cost data yet.</div>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>
    </template>
  </div>
</template>
