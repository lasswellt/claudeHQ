<script setup lang="ts">
import { ref, onMounted } from 'vue';

definePageMeta({ layout: 'default' });

const status = ref<{ configured: boolean; authMethod: string; hasApp: boolean; hasInstallation: boolean } | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const patToken = ref('');
const saving = ref(false);
const testResult = ref<string | null>(null);
const step = ref(1);

onMounted(fetchStatus);

async function fetchStatus(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const res = await fetch('/api/github/status');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    status.value = (await res.json()) as typeof status.value;

    if (status.value?.configured) step.value = 4;
    else if (status.value?.hasApp) step.value = 3;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load GitHub status';
  } finally {
    loading.value = false;
  }
}

async function savePat(): Promise<void> {
  if (!patToken.value) return;
  saving.value = true;
  error.value = null;
  try {
    const res = await fetch('/api/github/pat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: patToken.value }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // Only clear token on success
    patToken.value = '';
    await fetchStatus();
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to save PAT';
  } finally {
    saving.value = false;
  }
}

async function testConnection(): Promise<void> {
  error.value = null;
  try {
    const res = await fetch('/api/github/test', { method: 'POST' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { connected: boolean };
    testResult.value = data.connected ? 'Connected successfully!' : 'Connection failed.';
  } catch (e) {
    testResult.value = e instanceof Error ? e.message : 'Connection test failed';
  }
}

async function startManifestFlow(): Promise<void> {
  error.value = null;
  // Fetch manifest and redirect to GitHub
  try {
    const res = await fetch('/api/github/manifest');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const manifest = await res.json();

    // Create a form and submit to GitHub
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = 'https://github.com/settings/apps/new';

    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = 'manifest';
    input.value = JSON.stringify(manifest);
    form.appendChild(input);

    document.body.appendChild(form);
    form.submit();
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to start GitHub App flow';
  }
}
</script>

<template>
  <div>
    <div class="d-flex align-center justify-space-between mb-6">
      <h1 class="text-h4 font-weight-bold">GitHub Integration</h1>
      <v-btn
        color="primary"
        variant="tonal"
        prepend-icon="mdi-progress-wrench"
        to="/settings/github/wizard"
      >
        Launch setup wizard
      </v-btn>
    </div>

    <v-skeleton-loader v-if="loading" type="card" />

    <v-alert v-else-if="error" type="error" variant="tonal" class="mb-4">
      {{ error }}
      <template #append>
        <v-btn variant="text" @click="fetchStatus">Retry</v-btn>
      </template>
    </v-alert>

    <template v-else>
      <!-- Status card -->
      <v-card class="mb-6">
        <v-card-item>
          <template #prepend>
            <v-icon :color="status?.configured ? 'success' : 'warning'" size="large">
              {{ status?.configured ? 'mdi-check-circle' : 'mdi-alert-circle' }}
            </v-icon>
          </template>
          <v-card-title>
            {{ status?.configured ? 'Connected' : 'Not Connected' }}
          </v-card-title>
          <v-card-subtitle>
            {{ status?.authMethod === 'github_app' ? 'GitHub App' : status?.authMethod === 'pat' ? 'Personal Access Token' : 'Not configured' }}
          </v-card-subtitle>
        </v-card-item>
      </v-card>

      <!-- Setup stepper -->
      <v-stepper v-if="!status?.configured" v-model="step" :items="['Choose Method', 'Configure', 'Install', 'Verify']">
        <template #item.1>
          <v-card flat>
            <v-card-text>
              <h3 class="text-h6 mb-4">Choose authentication method</h3>
              <v-row>
                <v-col cols="12" sm="6">
                  <v-card variant="outlined" class="pa-4 cursor-pointer" @click="startManifestFlow">
                    <v-icon size="x-large" color="primary" class="mb-2">mdi-github</v-icon>
                    <h4 class="text-subtitle-1 font-weight-bold">GitHub App (Recommended)</h4>
                    <p class="text-body-2 text-medium-emphasis">
                      Creates a dedicated GitHub App with fine-grained permissions.
                      Supports webhooks, Checks API, and auto-rotating tokens.
                    </p>
                    <v-btn color="primary" variant="flat" class="mt-2">Create GitHub App</v-btn>
                  </v-card>
                </v-col>
                <v-col cols="12" sm="6">
                  <v-card variant="outlined" class="pa-4">
                    <v-icon size="x-large" color="secondary" class="mb-2">mdi-key</v-icon>
                    <h4 class="text-subtitle-1 font-weight-bold">Personal Access Token</h4>
                    <p class="text-body-2 text-medium-emphasis">
                      Simpler setup. No webhooks, no Checks API.
                      Tied to your GitHub account.
                    </p>
                    <v-text-field
                      v-model="patToken"
                      label="Fine-grained PAT"
                      placeholder="github_pat_..."
                      type="password"
                      density="compact"
                      class="mt-2"
                    />
                    <v-btn color="secondary" variant="flat" :loading="saving" :disabled="!patToken" @click="savePat">
                      Save Token
                    </v-btn>
                  </v-card>
                </v-col>
              </v-row>
            </v-card-text>
          </v-card>
        </template>

        <template #item.4>
          <v-card flat>
            <v-card-text class="text-center pa-8">
              <v-icon size="x-large" color="success" class="mb-4">mdi-check-circle</v-icon>
              <h3 class="text-h6 mb-2">GitHub Connected</h3>
              <v-btn color="primary" variant="flat" @click="testConnection">Test Connection</v-btn>
              <v-alert v-if="testResult" :type="testResult.includes('success') ? 'success' : 'error'" variant="tonal" class="mt-4">
                {{ testResult }}
              </v-alert>
            </v-card-text>
          </v-card>
        </template>
      </v-stepper>

      <!-- Test button when already configured -->
      <v-card v-if="status?.configured">
        <v-card-actions>
          <v-btn variant="flat" color="primary" @click="testConnection">Test Connection</v-btn>
        </v-card-actions>
        <v-alert v-if="testResult" :type="testResult.includes('success') ? 'success' : 'error'" variant="tonal" class="ma-4">
          {{ testResult }}
        </v-alert>
      </v-card>
    </template>
  </div>
</template>
