import { ref, onMounted, onUnmounted, type Ref } from 'vue';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';

export interface UseTerminalOptions {
  fontSize?: number;
  cursorBlink?: boolean;
}

export function useTerminal(containerRef: Ref<HTMLElement | null>, options?: UseTerminalOptions) {
  const terminal = ref<Terminal | null>(null);
  const fitAddon = ref<FitAddon | null>(null);
  let resizeObserver: ResizeObserver | null = null;
  let fitDebounce: ReturnType<typeof setTimeout> | null = null;

  function init(): void {
    if (!containerRef.value) return;

    const term = new Terminal({
      cursorBlink: options?.cursorBlink ?? true,
      fontSize: options?.fontSize ?? 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      scrollback: 10000,
      theme: {
        background: '#1E1E1E',
        foreground: '#D4D4D4',
        cursor: '#AEAFAD',
        selectionBackground: '#264F78',
      },
    });

    const fit = new FitAddon();
    term.loadAddon(fit);

    term.open(containerRef.value);
    fit.fit();

    // Try WebGL, fall back to DOM
    try {
      term.loadAddon(new WebglAddon());
    } catch {
      // DOM renderer is fine
    }

    // Resize on container change
    resizeObserver = new ResizeObserver(() => {
      if (fitDebounce) clearTimeout(fitDebounce);
      fitDebounce = setTimeout(() => fit.fit(), 50);
    });
    resizeObserver.observe(containerRef.value);

    terminal.value = term;
    fitAddon.value = fit;
  }

  function write(data: string): void {
    terminal.value?.write(data);
  }

  function clear(): void {
    terminal.value?.clear();
  }

  function dispose(): void {
    if (fitDebounce) clearTimeout(fitDebounce);
    resizeObserver?.disconnect();
    terminal.value?.dispose();
    terminal.value = null;
    fitAddon.value = null;
  }

  onMounted(() => init());
  onUnmounted(() => dispose());

  return { terminal, write, clear, dispose };
}
