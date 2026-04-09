<script setup lang="ts">
import { computed } from 'vue';
import { useSessionEventsStore, type SessionEvent } from '../../stores/sessionEvents';

// CAP-017 / story 014-008: Events tab for a session detail view.

const props = defineProps<{ sessionId: string }>();
const store = useSessionEventsStore();

const events = computed<SessionEvent[]>(() => store.eventsFor(props.sessionId));

const kindIcon: Record<SessionEvent['kind'], string> = {
  permissionAsked: 'mdi-shield-alert',
  toolCalled: 'mdi-wrench',
  toolResult: 'mdi-check',
  textDelta: 'mdi-message-text',
  costUpdated: 'mdi-currency-usd',
  completed: 'mdi-flag-checkered',
  error: 'mdi-alert-circle',
  unknown: 'mdi-help-circle',
};

const kindColor: Record<SessionEvent['kind'], string> = {
  permissionAsked: 'warning',
  toolCalled: 'info',
  toolResult: 'success',
  textDelta: 'default',
  costUpdated: 'primary',
  completed: 'success',
  error: 'error',
  unknown: 'default',
};

function formatPayload(event: SessionEvent): string {
  switch (event.kind) {
    case 'toolCalled':
    case 'permissionAsked':
      return `${String(event.payload.toolName ?? 'unknown')}${
        event.payload.toolInput ? ` — ${JSON.stringify(event.payload.toolInput).slice(0, 80)}` : ''
      }`;
    case 'toolResult':
      return event.payload.isError ? 'error' : 'ok';
    case 'textDelta':
      return String(event.payload.text ?? '').slice(0, 120);
    case 'costUpdated': {
      const usd = event.payload.totalUsd;
      const inT = event.payload.inputTokens ?? 0;
      const outT = event.payload.outputTokens ?? 0;
      return `in ${inT} / out ${outT}${typeof usd === 'number' ? ` / $${usd.toFixed(4)}` : ''}`;
    }
    case 'completed':
      return `exit ${event.payload.exitCode ?? '?'} — ${String(event.payload.reason ?? '')}`;
    case 'error':
      return String(event.payload.message ?? 'unknown error');
    default:
      return JSON.stringify(event.payload).slice(0, 120);
  }
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString();
}
</script>

<template>
  <v-card variant="flat">
    <v-card-text v-if="events.length === 0" class="text-center text-medium-emphasis py-8">
      <v-icon size="48" class="mb-2">mdi-radar</v-icon>
      <div class="text-body-2">No events yet.</div>
      <div class="text-caption">
        Events appear here when the session is spawned with
        <code>--output-format stream-json</code>.
      </div>
    </v-card-text>

    <v-list v-else density="compact">
      <v-list-item
        v-for="event in events"
        :key="event.seq"
        :prepend-icon="kindIcon[event.kind]"
      >
        <template #title>
          <div class="d-flex align-center ga-2">
            <v-chip :color="kindColor[event.kind]" size="x-small" variant="flat">
              {{ event.kind }}
            </v-chip>
            <span class="text-caption text-medium-emphasis">{{ formatTime(event.ts) }}</span>
          </div>
        </template>
        <template #subtitle>
          <span class="text-body-2">{{ formatPayload(event) }}</span>
        </template>
      </v-list-item>
    </v-list>
  </v-card>
</template>
