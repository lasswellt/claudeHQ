<script setup lang="ts">
import { ref, onMounted } from 'vue';

definePageMeta({ layout: 'default' });

const status = ref<{ configured: boolean; authMethod: string; hasApp: boolean; hasInstallation: boolean } | null>(null);
const loading = ref(true);
const patToken = ref('');
const saving = ref(false);
const testResult = ref<string | null>(null);
const step = ref(1);

onMounted(fetchStatus);

async function fetchStatus(): Promise<void> {
  loading.value = true;
  const res = await fetch('/api/github/status');
  status.value = (await res.json()) as typeof status.value;
  loading.value = false;

  if (status.value?.configured) step.value = 4;
  else if (status.value?.hasApp) step.value = 3;
}

async function savePat(): Promise<void> {
  if (!patToken.value) return;
  saving.value = true;
  await fetch('/api/github/pat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: patToken.value }),
  });
  patToken.value = '';
  saving.value = false;
  await fetchStatus();
}

async function testConnection(): Promise<void> {
  const res = await fetch('/api/github/test', { method: 'POST' });
  const data = (await res.json()) as { connected: boolean };
  testResult.value = data.connected ? 'Connected successfully!' : 'Connection failed.';
}

async function startManifestFlow(): Promise<void> {
  // Fetch manifest and redirect to GitHub
  const res = await fetch('/api/github/manifest');
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
}
</script>

<template>
  <div>
    <h1 class="text-h4 font-weight-bold mb-6">GitHub Integration</h1>

    <v-skeleton-loader v-if="loading" type="card" />

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
