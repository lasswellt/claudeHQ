import { ref, computed, onUnmounted } from 'vue';

interface ReplayChunk {
  ts: number;
  data: string;
}

export function useReplay() {
  const chunks = ref<ReplayChunk[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const playing = ref(false);
  const currentTime = ref(0);
  const speed = ref(1);
  const duration = ref(0);

  let playTimer: ReturnType<typeof setTimeout> | null = null;
  let chunkIndex = 0;
  let writeCallback: ((data: string) => void) | null = null;

  async function loadRecording(sessionId: string): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const res = await fetch(`/api/sessions/${sessionId}/recording`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      chunks.value = text
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as ReplayChunk);

      if (chunks.value.length > 0) {
        duration.value = chunks.value[chunks.value.length - 1]!.ts;
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load recording';
    } finally {
      loading.value = false;
    }
  }

  function setWriteCallback(cb: (data: string) => void): void {
    writeCallback = cb;
  }

  function play(): void {
    if (chunks.value.length === 0) return;
    playing.value = true;
    scheduleNext();
  }

  function pause(): void {
    playing.value = false;
    if (playTimer) {
      clearTimeout(playTimer);
      playTimer = null;
    }
  }

  function seek(timeMs: number): void {
    pause();
    currentTime.value = timeMs;

    // Replay all chunks up to this time
    writeCallback?.('\x1bc'); // Clear terminal
    chunkIndex = 0;
    for (const chunk of chunks.value) {
      if (chunk.ts > timeMs) break;
      writeCallback?.(chunk.data);
      chunkIndex++;
    }
  }

  function setSpeed(newSpeed: number): void {
    speed.value = newSpeed;
    if (playing.value) {
      pause();
      play();
    }
  }

  // ME-19: batch all chunks that share the same timestamp (delta = 0) into a
  // single write call instead of scheduling each as a separate 0 ms timer.
  // This prevents an unbounded synchronous-feeling recursive setTimeout chain
  // on burst-heavy recordings.
  function scheduleNext(): void {
    if (!playing.value || chunkIndex >= chunks.value.length) {
      playing.value = false;
      return;
    }

    const startTs = chunks.value[chunkIndex]!.ts;
    let batch = '';

    while (chunkIndex < chunks.value.length) {
      const chunk = chunks.value[chunkIndex]!;
      const delta = chunk.ts - startTs;
      if (delta > 0) {
        // Schedule the next batch after the relative delay
        playTimer = setTimeout(scheduleNext, delta / speed.value);
        break;
      }
      batch += chunk.data;
      currentTime.value = chunk.ts;
      chunkIndex++;
    }

    if (batch) writeCallback?.(batch);

    if (chunkIndex >= chunks.value.length) {
      playing.value = false;
    }
  }

  function dispose(): void {
    pause();
    chunks.value = [];
    chunkIndex = 0;
  }

  const progress = computed(() => (duration.value > 0 ? (currentTime.value / duration.value) * 100 : 0));

  // ME-18: dispose the replay engine when the owning component unmounts so
  // the setTimeout chain does not outlive the component.
  onUnmounted(() => dispose());

  return {
    chunks,
    loading,
    error,
    playing,
    currentTime,
    speed,
    duration,
    progress,
    loadRecording,
    setWriteCallback,
    play,
    pause,
    seek,
    setSpeed,
    dispose,
  };
}
