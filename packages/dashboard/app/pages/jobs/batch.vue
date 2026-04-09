<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';

// CAP-055 / CAP-066 / story 016-005: batch launcher.

definePageMeta({ layout: 'default' });

interface RepoRow {
  id: string;
  name: string;
  tags?: string[] | null;
}

interface BatchPlanResult {
  batchId: string;
  jobs: Array<{ jobId: string; repoId: string; repoName: string; branch?: string }>;
  maxConcurrency: number;
}

const router = useRouter();

const repos = ref<RepoRow[]>([]);
const loadingRepos = ref(false);

// Selection mode: 'repos' → explicit multi-select; 'tags' → tag filter.
const selectionMode = ref<'repos' | 'tags'>('repos');
const selectedRepoIds = ref<string[]>([]);
const selectedTags = ref<string[]>([]);

const prompt = ref('');
const branchPrefix = ref('claude/batch');
const maxConcurrency = ref(3);
const autoPr = ref(false);
const maxCostUsd = ref<number | null>(null);
const timeoutSeconds = ref<number | null>(null);

const submitting = ref(false);
const error = ref<string | null>(null);

onMounted(async () => {
  loadingRepos.value = true;
  try {
    const res = await fetch('/api/repos');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    repos.value = (await res.json()) as RepoRow[];
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load repos';
  } finally {
    loadingRepos.value = false;
  }
});

const allTags = computed<string[]>(() => {
  const set = new Set<string>();
  for (const r of repos.value) {
    const tags = Array.isArray(r.tags)
      ? r.tags
      : typeof r.tags === 'string'
        ? (() => { try { return JSON.parse(r.tags); } catch { return []; } })()
        : [];
    for (const tag of tags) set.add(tag);
  }
  return [...set].sort();
});

const canSubmit = computed(() => {
  if (!prompt.value.trim()) return false;
  if (selectionMode.value === 'repos') return selectedRepoIds.value.length > 0;
  return selectedTags.value.length > 0;
});

const estimatedRepoCount = computed(() => {
  if (selectionMode.value === 'repos') return selectedRepoIds.value.length;
  if (selectedTags.value.length === 0) return 0;
  const wanted = new Set(selectedTags.value);
  return repos.value.filter((r) => {
    const tags = Array.isArray(r.tags) ? r.tags : [];
    return tags.some((t: string) => wanted.has(t));
  }).length;
});

async function submit(): Promise<void> {
  if (!canSubmit.value) return;
  submitting.value = true;
  error.value = null;

  const body: Record<string, unknown> = {
    prompt: prompt.value,
    branchPrefix: branchPrefix.value || undefined,
    maxConcurrency: maxConcurrency.value,
    autoPr: autoPr.value,
  };
  if (selectionMode.value === 'repos') body.repoIds = selectedRepoIds.value;
  else body.tags = selectedTags.value;
  if (maxCostUsd.value != null) body.maxCostUsd = maxCostUsd.value;
  if (timeoutSeconds.value != null) body.timeoutSeconds = timeoutSeconds.value;

  try {
    const res = await fetch('/api/jobs/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = (await res.json()) as { error?: string; detail?: string };
      throw new Error(err.error ?? err.detail ?? `HTTP ${res.status}`);
    }
    const result = (await res.json()) as BatchPlanResult;
    await router.push(`/jobs/batch/${result.batchId}`);
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to submit batch';
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div>
    <div class="d-flex align-center mb-6">
      <v-btn icon="mdi-arrow-left" variant="text" @click="router.back()" />
      <h1 class="text-h4 font-weight-bold ml-2">Launch Batch Job</h1>
    </div>

    <v-alert v-if="error" type="error" variant="tonal" class="mb-4" closable @click:close="error = null">
      {{ error }}
    </v-alert>

    <v-card class="mb-4">
      <v-card-title class="text-body-1">1. Select repositories</v-card-title>
      <v-card-text>
        <v-btn-toggle v-model="selectionMode" mandatory density="compact" class="mb-4">
          <v-btn value="repos" prepend-icon="mdi-checkbox-multiple-outline">Multi-select</v-btn>
          <v-btn value="tags" prepend-icon="mdi-tag-multiple">By tag</v-btn>
        </v-btn-toggle>

        <v-skeleton-loader v-if="loadingRepos" type="list-item-three-line" />

        <v-list
          v-else-if="selectionMode === 'repos'"
          select-strategy="classic"
          density="compact"
          class="rounded border"
          max-height="280"
          style="overflow-y: auto"
        >
          <v-list-item
            v-for="repo in repos"
            :key="repo.id"
            :value="repo.id"
            :active="selectedRepoIds.includes(repo.id)"
            @click="
              selectedRepoIds.includes(repo.id)
                ? (selectedRepoIds = selectedRepoIds.filter((id) => id !== repo.id))
                : selectedRepoIds.push(repo.id)
            "
          >
            <template #prepend>
              <v-checkbox-btn :model-value="selectedRepoIds.includes(repo.id)" />
            </template>
            <v-list-item-title>{{ repo.name }}</v-list-item-title>
          </v-list-item>
        </v-list>

        <div v-else>
          <v-combobox
            v-model="selectedTags"
            :items="allTags"
            label="Match any of these tags"
            multiple
            chips
            closable-chips
          />
        </div>
      </v-card-text>
    </v-card>

    <v-card class="mb-4">
      <v-card-title class="text-body-1">2. Prompt</v-card-title>
      <v-card-text>
        <v-textarea
          v-model="prompt"
          placeholder="What should each repo's Claude agent do?"
          rows="4"
          auto-grow
          variant="outlined"
        />
      </v-card-text>
    </v-card>

    <v-card class="mb-4">
      <v-card-title class="text-body-1">3. Concurrency</v-card-title>
      <v-card-text>
        <div class="d-flex align-center ga-3">
          <v-slider
            v-model="maxConcurrency"
            min="1"
            max="10"
            step="1"
            thumb-label="always"
            class="flex-grow-1"
            hide-details
          />
          <span class="text-body-2 text-medium-emphasis" style="min-width: 120px">
            {{ maxConcurrency }} at a time
          </span>
        </div>
      </v-card-text>
    </v-card>

    <v-expansion-panels class="mb-4" variant="accordion">
      <v-expansion-panel title="Advanced options">
        <template #text>
          <v-row dense>
            <v-col cols="12" sm="6">
              <v-text-field
                v-model="branchPrefix"
                label="Branch prefix"
                placeholder="claude/batch"
                density="compact"
                variant="outlined"
              />
            </v-col>
            <v-col cols="12" sm="6">
              <v-switch
                v-model="autoPr"
                label="Auto-open PR on completion"
                color="primary"
                density="compact"
                hide-details
              />
            </v-col>
            <v-col cols="6" sm="3">
              <v-text-field
                v-model.number="maxCostUsd"
                type="number"
                label="Max cost per repo ($)"
                min="0"
                step="0.5"
                density="compact"
                variant="outlined"
              />
            </v-col>
            <v-col cols="6" sm="3">
              <v-text-field
                v-model.number="timeoutSeconds"
                type="number"
                label="Timeout (seconds)"
                min="60"
                step="60"
                density="compact"
                variant="outlined"
              />
            </v-col>
          </v-row>
        </template>
      </v-expansion-panel>
    </v-expansion-panels>

    <div class="d-flex align-center justify-space-between">
      <div class="text-caption text-medium-emphasis">
        <template v-if="estimatedRepoCount > 0">
          Will launch <strong>{{ estimatedRepoCount }}</strong> job{{ estimatedRepoCount === 1 ? '' : 's' }}
          with <strong>{{ maxConcurrency }}</strong> running in parallel.
        </template>
      </div>
      <v-btn
        color="primary"
        variant="flat"
        size="large"
        prepend-icon="mdi-rocket-launch"
        :loading="submitting"
        :disabled="!canSubmit"
        @click="submit"
      >
        Launch batch
      </v-btn>
    </div>
  </div>
</template>
