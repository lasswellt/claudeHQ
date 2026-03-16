<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useSessionsStore } from '../../stores/sessions';
import TerminalView from '../../components/terminal/TerminalView.vue';
import TerminalInput from '../../components/terminal/TerminalInput.vue';

definePageMeta({ layout: 'default' });

const route = useRoute();
const router = useRouter();
const sessionsStore = useSessionsStore();
const sessionId = computed(() => route.params.id as string);
const session = computed(() => sessionsStore.sessionById.get(sessionId.value));
const showKillConfirm = ref(false);
const killing = ref(false);

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
  try {
    await fetch(`/api/sessions/${sessionId.value}`, { method: 'DELETE' });
    showKillConfirm.value = false;
  } finally {
    killing.value = false;
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
        v-if="isRunning"
        color="error"
        variant="tonal"
        prepend-icon="mdi-stop"
        @click="showKillConfirm = true"
      >
        Kill
      </v-btn>
    </div>

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

      <!-- Terminal -->
      <v-card class="mb-4" style="height: 500px">
        <TerminalView :session-id="sessionId" />
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
  </div>
</template>
