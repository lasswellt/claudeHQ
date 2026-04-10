<script setup lang="ts">
import { ref, onMounted } from 'vue';
import type { RepoRecord } from '@chq/shared/browser';

definePageMeta({ layout: 'default' });

const repos = ref<RepoRecord[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const showImport = ref(false);
const importUrl = ref('');
const importing = ref(false);

onMounted(fetchRepos);

async function fetchRepos(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const res = await fetch('/api/repos');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    repos.value = (await res.json()) as RepoRecord[];
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load repositories';
  } finally {
    loading.value = false;
  }
}

async function importRepo(): Promise<void> {
  if (!importUrl.value) return;
  importing.value = true;
  error.value = null;
  try {
    const res = await fetch('/api/repos/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: importUrl.value }),
    });
    if (!res.ok) throw new Error(`Import failed: HTTP ${res.status}`);
    importUrl.value = '';
    showImport.value = false;
    await fetchRepos();
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to import repository';
  } finally {
    importing.value = false;
  }
}
</script>

<template>
  <div>
    <div class="d-flex align-center justify-space-between mb-6">
      <h1 class="text-h4 font-weight-bold">Repositories</h1>
      <v-btn color="primary" prepend-icon="mdi-plus" @click="showImport = true">
        Add Repo
      </v-btn>
    </div>

    <v-skeleton-loader v-if="loading" type="card" />
    <v-alert v-else-if="error" type="error" variant="tonal">
      {{ error }}
      <template #append>
        <v-btn variant="text" @click="fetchRepos">Retry</v-btn>
      </template>
    </v-alert>
    <v-alert v-else-if="repos.length === 0" type="info" variant="tonal">
      No repositories registered. Import one to get started.
    </v-alert>

    <v-row v-else>
      <v-col v-for="repo in repos" :key="repo.id" cols="12" sm="6" md="4">
        <v-card :to="`/repos/${repo.id}`">
          <v-card-item>
            <template #prepend>
              <v-icon color="primary">mdi-source-repository</v-icon>
            </template>
            <v-card-title>{{ repo.name }}</v-card-title>
            <v-card-subtitle>{{ repo.owner ?? '' }}</v-card-subtitle>
          </v-card-item>
          <v-card-text>
            <div class="d-flex ga-2 flex-wrap">
              <v-chip v-if="repo.dependency_manager" size="x-small">{{ repo.dependency_manager }}</v-chip>
              <v-chip v-if="repo.node_version" size="x-small">Node {{ repo.node_version }}</v-chip>
              <v-chip v-for="tag in (repo.tags ?? [])" :key="tag" size="x-small" color="primary" variant="outlined">
                {{ tag }}
              </v-chip>
            </div>
            <div v-if="repo.last_synced_at" class="text-caption text-medium-emphasis mt-2">
              Synced {{ new Date(repo.last_synced_at * 1000).toLocaleString() }}
            </div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <v-dialog v-model="showImport" max-width="500">
      <v-card>
        <v-card-title>Import Repository</v-card-title>
        <v-card-text>
          <v-text-field
            v-model="importUrl"
            label="Git URL"
            placeholder="https://github.com/owner/repo"
            hint="GitHub HTTPS or SSH URL"
            persistent-hint
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="showImport = false">Cancel</v-btn>
          <v-btn color="primary" variant="flat" :loading="importing" :disabled="!importUrl" @click="importRepo">
            Import
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>
