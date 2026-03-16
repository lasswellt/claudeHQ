import { ref, computed } from 'vue';

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

  function scheduleNext(): void {
    if (!playing.value || chunkIndex >= chunks.value.length) {
      playing.value = false;
      return;
    }

    const chunk = chunks.value[chunkIndex]!;
    const prevTs = chunkIndex > 0 ? chunks.value[chunkIndex - 1]!.ts : 0;
    const delay = Math.max(0, (chunk.ts - prevTs) / speed.value);

    playTimer = setTimeout(() => {
      writeCallback?.(chunk.data);
      currentTime.value = chunk.ts;
      chunkIndex++;
      scheduleNext();
    }, delay);
  }

  function dispose(): void {
    pause();
    chunks.value = [];
    chunkIndex = 0;
  }

  const progress = computed(() => (duration.value > 0 ? (currentTime.value / duration.value) * 100 : 0));

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
