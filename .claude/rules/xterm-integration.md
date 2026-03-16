---
globs: "packages/dashboard/**/terminal/**,packages/dashboard/**/composables/useTerminal*"
---
# xterm.js Integration Rules

- Load addons: fit (responsive resize), webgl (GPU rendering), serialize (replay scrub)
- Dispose terminal and addons in `onUnmounted` — xterm leaks memory if not cleaned up
- Handle container resize with `fitAddon.fit()` via ResizeObserver
- WebGL addon: wrap in try/catch — falls back to canvas if GPU unavailable
- Terminal theme should match dashboard design tokens

```typescript
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebglAddon } from 'xterm-addon-webgl';

const terminal = new Terminal({ cursorBlink: true, fontSize: 14 });
const fitAddon = new FitAddon();
terminal.loadAddon(fitAddon);

onMounted(() => {
  terminal.open(containerRef.value!);
  fitAddon.fit();
  try { terminal.loadAddon(new WebglAddon()); } catch { /* canvas fallback */ }
});

onUnmounted(() => {
  terminal.dispose();
});
```

- For replay: use serialize addon to snapshot terminal state at scrub points
- Never call `terminal.write()` with unsanitized HTML — xterm handles ANSI natively
- Session input: `terminal.onData(data => sendInput(sessionId, data))`
