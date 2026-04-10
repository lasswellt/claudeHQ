<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useSessionsStore } from '../../stores/sessions';
import TerminalView from '../../components/terminal/TerminalView.vue';
import TerminalInput from '../../components/terminal/TerminalInput.vue';
import SessionEventsTab from '../../components/session/SessionEventsTab.vue';

definePageMeta({ layout: 'default' });

const route = useRoute();
const router = useRouter();
const sessionsStore = useSessionsStore();
const sessionId = computed(() => route.params.id as string);
const session = computed(() => sessionsStore.sessionById.get(sessionId.value));
const showKillConfirm = ref(false);
const showResume = ref(false);
const resumePrompt = ref('');
const killing = ref(false);
const resuming = ref(false);
const actionError = ref<string | null>(null);
// CAP-017: terminal / events tab selector.
const activeTab = ref<'terminal' | 'events'>('terminal');

const isCompleted = computed(() => session.value?.status === 'completed' || session.value?.status === 'failed');

onMounted(() => {
  if (!session.value) {
    sessionsStore.fetchSessions();
  }
});

const isRunning = computed(() => session.value?.status === 'running');

const statusColor: Record<string, string> = {
  running: 'success',
  completed: 'default',
  failed: 'error',
  queued: 'info',
};

async function killSession(): Promise<void> {
  killing.value = true;
  actionError.value = null;
  try {
    const res = await fetch(`/api/sessions/${sessionId.value}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`Kill failed: HTTP ${res.status}`);
    showKillConfirm.value = false;
  } catch (e) {
    actionError.value = e instanceof Error ? e.message : 'Failed to kill session';
  } finally {
    killing.value = false;
  }
}

async function resumeSession(): Promise<void> {
  if (!resumePrompt.value) return;
  resuming.value = true;
  actionError.value = null;
  try {
    const res = await fetch(`/api/sessions/${sessionId.value}/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: resumePrompt.value }),
    });
    if (!res.ok) throw new Error(`Resume failed: HTTP ${res.status}`);
    const data = (await res.json()) as { id: string };
    router.push(`/sessions/${data.id}`);
  } catch (e) {
    actionError.value = e instanceof Error ? e.message : 'Failed to resume session';
  } finally {
    resuming.value = false;
    showResume.value = false;
    resumePrompt.value = '';
  }
}
</script>

<template>
  <div>
    <div class="d-flex align-center ga-3 mb-4">
      <v-btn icon="mdi-arrow-left" variant="text" @click="router.back()" />
      <h1 class="text-h5 font-weight-bold">Session</h1>
      <v-chip v-if="session" :color="statusColor[session.status] ?? 'default'" size="small">
        {{ session.status }}
      </v-chip>
      <v-spacer />
      <v-btn
        v-if="isCompleted"
        variant="tonal"
        prepend-icon="mdi-replay"
        class="mr-2"
        :to="`/sessions/${sessionId}/replay`"
      >
        Replay
      </v-btn>
      <v-btn
        v-if="isCompleted"
        color="primary"
        variant="tonal"
        prepend-icon="mdi-message-reply"
        class="mr-2"
        @click="showResume = true"
      >
        Resume
      </v-btn>
      <v-btn
        v-if="isRunning"
        color="error"
        variant="tonal"
        prepend-icon="mdi-stop"
        @click="showKillConfirm = true"
      >
        Kill
      </v-btn>
    </div>

    <v-alert v-if="actionError" type="error" variant="tonal" closable class="mb-4" @click:close="actionError = null">
      {{ actionError }}
    </v-alert>

    <v-alert v-if="!session && !sessionsStore.loading" type="warning" variant="tonal">
      Session not found.
    </v-alert>

    <template v-else-if="session">
      <!-- Metadata -->
      <v-card class="mb-4">
        <v-card-text>
          <v-row dense>
            <v-col cols="12" sm="6">
              <div class="text-caption text-medium-emphasis">Prompt</div>
              <div>{{ session.prompt }}</div>
            </v-col>
            <v-col cols="6" sm="3">
              <div class="text-caption text-medium-emphasis">Machine</div>
              <div>{{ session.machine_id }}</div>
            </v-col>
            <v-col cols="6" sm="3">
              <div class="text-caption text-medium-emphasis">Directory</div>
              <div class="text-truncate">{{ session.cwd }}</div>
            </v-col>
          </v-row>
        </v-card-text>
      </v-card>

      <!-- Terminal / Events tabs -->
      <v-card class="mb-4">
        <v-tabs v-model="activeTab" density="compact">
          <v-tab value="terminal">
            <v-icon start>mdi-console</v-icon>
            Terminal
          </v-tab>
          <v-tab value="events">
            <v-icon start>mdi-format-list-bulleted</v-icon>
            Events
          </v-tab>
        </v-tabs>
        <v-divider />
        <v-window v-model="activeTab">
          <v-window-item value="terminal">
            <div style="height: 500px">
              <TerminalView :session-id="sessionId" />
            </div>
          </v-window-item>
          <v-window-item value="events">
            <div style="min-height: 500px; max-height: 500px; overflow-y: auto">
              <SessionEventsTab :session-id="sessionId" />
            </div>
          </v-window-item>
        </v-window>
      </v-card>

      <!-- Input -->
      <TerminalInput :session-id="sessionId" :disabled="!isRunning" />
    </template>

    <!-- Kill confirmation -->
    <v-dialog v-model="showKillConfirm" max-width="400">
      <v-card>
        <v-card-title>Kill Session?</v-card-title>
        <v-card-text>This will terminate the Claude Code process.</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="showKillConfirm = false">Cancel</v-btn>
          <v-btn color="error" variant="flat" :loading="killing" @click="killSession">Kill</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Resume dialog -->
    <v-dialog v-model="showResume" max-width="500">
      <v-card>
        <v-card-title>Resume Session</v-card-title>
        <v-card-text>
          <p class="text-body-2 text-medium-emphasis mb-3">
            Continue this conversation with a follow-up prompt. A new session will be created linked to this one.
          </p>
          <v-textarea
            v-model="resumePrompt"
            label="Follow-up prompt"
            placeholder="Now add tests for the fix..."
            rows="3"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="showResume = false">Cancel</v-btn>
          <v-btn color="primary" variant="flat" :loading="resuming" :disabled="!resumePrompt" @click="resumeSession">
            Resume
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>
