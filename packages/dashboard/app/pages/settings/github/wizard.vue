<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';

// CAP-057 / story 017-002: GitHub setup wizard (7 steps).

definePageMeta({ layout: 'default' });

const router = useRouter();

type StepId =
  | 'welcome'
  | 'method'
  | 'funnel'
  | 'create'
  | 'callback'
  | 'verify'
  | 'done';

interface Step {
  id: StepId;
  title: string;
  subtitle: string;
}

const steps: Step[] = [
  { id: 'welcome', title: 'Welcome', subtitle: 'Connect Claude HQ to GitHub' },
  { id: 'method', title: 'Method', subtitle: 'Choose GitHub App or PAT' },
  { id: 'funnel', title: 'Webhook URL', subtitle: 'Configure public reachability' },
  { id: 'create', title: 'Create', subtitle: 'Create the GitHub App' },
  { id: 'callback', title: 'Callback', subtitle: 'Exchange credentials' },
  { id: 'verify', title: 'Verify', subtitle: 'Test the connection' },
  { id: 'done', title: 'Done', subtitle: 'You are all set' },
];

const currentIndex = ref(0);
const method = ref<'app' | 'pat'>('app');

// Funnel step state
const funnelUrl = ref('');
const funnelCheckLoading = ref(false);
const funnelCheckResult = ref<null | { ok: boolean; detail: string }>(null);

// PAT step state
const patToken = ref('');
const patSaving = ref(false);

// Verify step state
const verifyLoading = ref(false);
const verifyResult = ref<null | { ok: boolean; detail: string }>(null);

const currentStep = computed<Step>(() => {
  const idx = currentIndex.value;
  return steps[idx] ?? steps[0]!;
});

const canAdvance = computed(() => {
  switch (currentStep.value.id) {
    case 'welcome':
      return true;
    case 'method':
      return method.value === 'app' || method.value === 'pat';
    case 'funnel':
      // App path requires a verified funnel URL; PAT path skips.
      if (method.value === 'pat') return true;
      return funnelCheckResult.value?.ok === true;
    case 'create':
      // Operator clicks "Create on GitHub" — advances once they return.
      return true;
    case 'callback':
      // Driven by URL query param in a real flow; here we just allow advance.
      return true;
    case 'verify':
      return verifyResult.value?.ok === true;
    default:
      return false;
  }
});

function next(): void {
  // Skip funnel step entirely on PAT path.
  if (currentStep.value.id === 'method' && method.value === 'pat') {
    // Jump directly to the callback-equivalent (PAT entry) step which we reuse "create".
    currentIndex.value = steps.findIndex((s) => s.id === 'create');
    return;
  }
  if (currentIndex.value < steps.length - 1) currentIndex.value += 1;
}

function back(): void {
  if (currentIndex.value > 0) currentIndex.value -= 1;
}

async function checkFunnel(): Promise<void> {
  if (!funnelUrl.value) return;
  funnelCheckLoading.value = true;
  funnelCheckResult.value = null;
  try {
    const res = await fetch('/api/github/funnel/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: funnelUrl.value }),
    });
    const data = (await res.json()) as { ok: boolean; detail?: string; reason?: string };
    funnelCheckResult.value = {
      ok: data.ok === true,
      detail: data.detail ?? data.reason ?? (data.ok ? 'Reachable' : 'Unreachable'),
    };
  } catch (e) {
    funnelCheckResult.value = { ok: false, detail: (e as Error).message };
  } finally {
    funnelCheckLoading.value = false;
  }
}

async function openGitHubManifest(): Promise<void> {
  // Posts a manifest-shaped form to GitHub. In a real implementation
  // the hub renders an HTML form and auto-submits; here we just
  // route to a placeholder endpoint.
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = 'https://github.com/settings/apps/new';
  form.target = '_blank';
  document.body.appendChild(form);
  form.submit();
  document.body.removeChild(form);
}

async function savePat(): Promise<void> {
  if (!patToken.value) return;
  patSaving.value = true;
  try {
    const res = await fetch('/api/github/pat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: patToken.value }),
    });
    if (res.ok) {
      currentIndex.value = steps.findIndex((s) => s.id === 'verify');
    }
  } finally {
    patSaving.value = false;
  }
}

async function verifyConnection(): Promise<void> {
  verifyLoading.value = true;
  verifyResult.value = null;
  try {
    const res = await fetch('/api/github/status');
    const data = (await res.json()) as { configured?: boolean; authMethod?: string };
    verifyResult.value = {
      ok: data.configured === true,
      detail: data.configured
        ? `Connected via ${data.authMethod}`
        : 'Not yet connected — check the GitHub App callback',
    };
  } catch (e) {
    verifyResult.value = { ok: false, detail: (e as Error).message };
  } finally {
    verifyLoading.value = false;
  }
}

function finish(): void {
  router.push('/settings/github');
}

// Read ?code= from URL (callback from GitHub manifest exchange).
onMounted(async () => {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  if (code) {
    try {
      const res = await fetch('/api/github/manifest/callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      if (res.ok) {
        currentIndex.value = steps.findIndex((s) => s.id === 'verify');
      }
    } catch {
      // If the exchange fails, keep the user on the create step to retry.
    }
  }
});
</script>

<template>
  <div>
    <div class="d-flex align-center mb-4">
      <v-btn icon="mdi-arrow-left" variant="text" @click="router.back()" />
      <h1 class="text-h5 font-weight-bold ml-2">Connect Claude HQ to GitHub</h1>
    </div>

    <!-- Progress stepper -->
    <v-stepper :model-value="currentStep.id" class="mb-4" alt-labels>
      <v-stepper-header>
        <template v-for="(s, idx) in steps" :key="s.id">
          <v-stepper-item
            :value="s.id"
            :title="s.title"
            :complete="idx < currentIndex"
          />
          <v-divider v-if="idx < steps.length - 1" />
        </template>
      </v-stepper-header>
    </v-stepper>

    <v-card>
      <v-card-text>
        <!-- Step: welcome -->
        <template v-if="currentStep.id === 'welcome'">
          <h2 class="text-h5 mb-3">Let's connect your GitHub account</h2>
          <p class="text-body-1 mb-2">
            Claude HQ uses GitHub to clone repos, push branches, open pull requests, and update check runs
            from automated jobs.
          </p>
          <p class="text-body-2 text-medium-emphasis">
            You'll need:
          </p>
          <ul class="text-body-2 text-medium-emphasis ml-4 mb-4">
            <li>Admin access to the org or user account you want to connect</li>
            <li>One of: a public Funnel URL (GitHub App flow, recommended), or a fine-grained PAT</li>
            <li>~3 minutes</li>
          </ul>
        </template>

        <!-- Step: method -->
        <template v-else-if="currentStep.id === 'method'">
          <h2 class="text-h5 mb-3">Choose a connection method</h2>
          <v-radio-group v-model="method">
            <v-radio value="app">
              <template #label>
                <div>
                  <div class="font-weight-medium">GitHub App (recommended)</div>
                  <div class="text-caption text-medium-emphasis">
                    Full feature access: webhooks, Checks API, automatic PR status.
                    Requires a public webhook URL (we'll help you set one up via Tailscale Funnel).
                  </div>
                </div>
              </template>
            </v-radio>
            <v-radio value="pat" class="mt-2">
              <template #label>
                <div>
                  <div class="font-weight-medium">Personal Access Token (PAT)</div>
                  <div class="text-caption text-medium-emphasis">
                    Works without a public URL but polls for updates. No webhooks, no Checks API.
                    Good for air-gapped or home setups.
                  </div>
                </div>
              </template>
            </v-radio>
          </v-radio-group>
        </template>

        <!-- Step: funnel (GitHub App path only) -->
        <template v-else-if="currentStep.id === 'funnel'">
          <h2 class="text-h5 mb-3">Configure the webhook URL</h2>
          <p class="text-body-2 text-medium-emphasis mb-4">
            GitHub needs to reach Claude HQ over HTTPS to deliver webhooks. Run the Tailscale
            Funnel setup script on your hub host:
          </p>
          <pre class="pa-3 rounded bg-surface-variant text-body-2 mb-4">./deploy/tailscale-funnel.sh enable 7700</pre>
          <v-text-field
            v-model="funnelUrl"
            label="Funnel URL"
            placeholder="https://hub.tailnet.ts.net"
            variant="outlined"
            density="compact"
            hint="Usually https://<your-hostname>.<tailnet>.ts.net"
            persistent-hint
          />
          <div class="d-flex align-center ga-2 mt-3">
            <v-btn color="primary" variant="tonal" :loading="funnelCheckLoading" @click="checkFunnel">
              Test reachability
            </v-btn>
            <v-chip v-if="funnelCheckResult" :color="funnelCheckResult.ok ? 'success' : 'error'" size="small">
              {{ funnelCheckResult.detail }}
            </v-chip>
          </div>
        </template>

        <!-- Step: create -->
        <template v-else-if="currentStep.id === 'create'">
          <template v-if="method === 'app'">
            <h2 class="text-h5 mb-3">Create the GitHub App</h2>
            <p class="text-body-2 text-medium-emphasis mb-4">
              Click below to open GitHub with a pre-filled manifest. After you create the App,
              GitHub will redirect you back here automatically.
            </p>
            <v-btn color="primary" variant="flat" prepend-icon="mdi-github" @click="openGitHubManifest">
              Create on GitHub
            </v-btn>
          </template>
          <template v-else>
            <h2 class="text-h5 mb-3">Paste your PAT</h2>
            <p class="text-body-2 text-medium-emphasis mb-4">
              Create a fine-grained token at
              <a href="https://github.com/settings/personal-access-tokens/new" target="_blank">
                github.com/settings/personal-access-tokens/new
              </a>
              with these scopes: contents, pull_requests, issues, checks, actions, metadata.
            </p>
            <v-text-field
              v-model="patToken"
              label="Personal Access Token"
              type="password"
              variant="outlined"
              density="compact"
            />
            <v-btn color="primary" variant="flat" :loading="patSaving" :disabled="!patToken" @click="savePat">
              Save PAT
            </v-btn>
            <v-alert type="warning" variant="tonal" class="mt-4" density="compact">
              PAT mode polls GitHub every 5 minutes. Webhooks and Checks API are unavailable.
            </v-alert>
          </template>
        </template>

        <!-- Step: callback -->
        <template v-else-if="currentStep.id === 'callback'">
          <h2 class="text-h5 mb-3">Exchanging credentials…</h2>
          <v-progress-circular indeterminate color="primary" class="mb-3" />
          <p class="text-body-2 text-medium-emphasis">
            Hub is exchanging the callback code with GitHub. This should take a few seconds.
          </p>
        </template>

        <!-- Step: verify -->
        <template v-else-if="currentStep.id === 'verify'">
          <h2 class="text-h5 mb-3">Verify the connection</h2>
          <v-btn color="primary" variant="tonal" :loading="verifyLoading" @click="verifyConnection">
            Verify connection
          </v-btn>
          <v-alert
            v-if="verifyResult"
            :type="verifyResult.ok ? 'success' : 'error'"
            variant="tonal"
            class="mt-3"
          >
            {{ verifyResult.detail }}
          </v-alert>
        </template>

        <!-- Step: done -->
        <template v-else-if="currentStep.id === 'done'">
          <v-icon color="success" size="64" class="mb-3">mdi-check-circle</v-icon>
          <h2 class="text-h5 mb-3">You're connected!</h2>
          <p class="text-body-1">
            Claude HQ can now clone, push, and open PRs on your behalf.
          </p>
        </template>
      </v-card-text>

      <v-divider />

      <v-card-actions>
        <v-btn
          variant="text"
          :disabled="currentIndex === 0"
          prepend-icon="mdi-arrow-left"
          @click="back"
        >
          Back
        </v-btn>
        <v-spacer />
        <v-btn
          v-if="currentStep.id === 'done'"
          color="primary"
          variant="flat"
          @click="finish"
        >
          Done
        </v-btn>
        <v-btn
          v-else
          color="primary"
          variant="flat"
          :disabled="!canAdvance"
          append-icon="mdi-arrow-right"
          @click="next"
        >
          Next
        </v-btn>
      </v-card-actions>
    </v-card>
  </div>
</template>
