<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useTerminal } from '../../../composables/useTerminal';
import { useReplay } from '../../../composables/useReplay';
import { useSessionsStore } from '../../../stores/sessions';

definePageMeta({ layout: 'default' });

const route = useRoute();
const router = useRouter();
const sessionsStore = useSessionsStore();
const sessionId = computed(() => route.params.id as string);
const session = computed(() => sessionsStore.sessionById.get(sessionId.value));
const containerRef = ref<HTMLElement | null>(null);
const { write } = useTerminal(containerRef);
const replay = useReplay();

const speedOptions = [0.5, 1, 2, 4, 8];

onMounted(async () => {
  if (!session.value) sessionsStore.fetchSessions();
  replay.setWriteCallback(write);
  await replay.loadRecording(sessionId.value);
});

onUnmounted(() => replay.dispose());

function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}
</script>

<template>
  <div>
    <div class="d-flex align-center ga-3 mb-4">
      <v-btn icon="mdi-arrow-left" variant="text" @click="router.back()" />
      <h1 class="text-h5 font-weight-bold">Replay</h1>
      <span v-if="session" class="text-medium-emphasis">{{ session.prompt }}</span>
    </div>

    <v-alert v-if="replay.error.value" type="error" variant="tonal" class="mb-4">
      {{ replay.error.value }}
    </v-alert>

    <!-- Terminal — HI-04: container must mount unconditionally so
         useTerminal can attach to the ref on first mount. The loader
         is overlaid via v-show so the DOM node persists across state. -->
    <v-card class="mb-4 position-relative" style="height: 450px">
      <div ref="containerRef" style="width: 100%; height: 100%" />
      <v-skeleton-loader
        v-show="replay.loading.value"
        type="image"
        height="450"
        class="position-absolute"
        style="top: 0; left: 0; right: 0; bottom: 0"
      />
    </v-card>

    <!-- Controls -->
    <v-card class="pa-4">
      <div class="d-flex align-center ga-4">
        <!-- Play/Pause -->
        <v-btn
          :icon="replay.playing.value ? 'mdi-pause' : 'mdi-play'"
          variant="flat"
          color="primary"
          size="small"
          @click="replay.playing.value ? replay.pause() : replay.play()"
        />

        <!-- Timeline -->
        <div class="flex-grow-1">
          <v-slider
            :model-value="replay.progress.value"
            min="0"
            max="100"
            step="0.1"
            hide-details
            color="primary"
            @update:model-value="(v: number) => replay.seek((v / 100) * replay.duration.value)"
          />
        </div>

        <!-- Time display -->
        <span class="text-caption text-no-wrap">
          {{ formatTime(replay.currentTime.value) }} / {{ formatTime(replay.duration.value) }}
        </span>

        <!-- Speed -->
        <v-btn-toggle
          :model-value="replay.speed.value"
          mandatory
          density="compact"
          variant="outlined"
          @update:model-value="(v: number) => replay.setSpeed(v)"
        >
          <v-btn v-for="s in speedOptions" :key="s" :value="s" size="x-small">
            {{ s }}x
          </v-btn>
        </v-btn-toggle>
      </div>
    </v-card>
  </div>
</template>
