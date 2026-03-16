import { ref, type Ref } from 'vue';
import {
  hubToDashboardSchema,
  type HubToDashboardMessage,
  type DashboardToHubMessage,
} from '@chq/shared/browser';

export type WsState = 'connecting' | 'connected' | 'disconnected' | 'error';

type MessageHandler = (msg: HubToDashboardMessage) => void;

// Singleton state shared across all composable consumers
const state = ref<WsState>('disconnected') as Ref<WsState>;
let ws: WebSocket | null = null;
let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let initialized = false;
const handlers = new Map<string, Set<MessageHandler>>();
const globalHandlers = new Set<MessageHandler>();

function getWsUrl(): string {
  // In production (Hub serves dashboard), use same origin
  // In dev, use runtimeConfig or fall back to Hub default port
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

  if (window.location.port === '7700') {
    // Production: dashboard served by Hub on same port
    return `${protocol}//${window.location.host}/ws/dashboard`;
  }

  // Dev mode: connect directly to Hub
  // Try runtimeConfig, fall back to localhost:7700
  try {
    const config = useRuntimeConfig();
    const hubWsUrl = config.public.hubWsUrl as string;
    if (hubWsUrl) return `${hubWsUrl}/ws/dashboard`;
  } catch {
    // useRuntimeConfig not available outside Nuxt context
  }

  return `ws://localhost:7700/ws/dashboard`;
}

function doConnect(): void {
  if (typeof window === 'undefined') return; // SSR guard
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;

  const url = getWsUrl();

  state.value = 'connecting';

  try {
    ws = new WebSocket(url);
  } catch {
    state.value = 'error';
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    state.value = 'connected';
    reconnectAttempts = 0;
    console.log('[WS] Connected to Hub');
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data as string) as unknown;
      const msg = hubToDashboardSchema.parse(data);

      for (const handler of globalHandlers) {
        handler(msg);
      }

      const typeHandlers = handlers.get(msg.type);
      if (typeHandlers) {
        for (const handler of typeHandlers) {
          handler(msg);
        }
      }
    } catch {
      // Invalid message — ignore
    }
  };

  ws.onclose = () => {
    state.value = 'disconnected';
    ws = null;
    scheduleReconnect();
  };

  ws.onerror = () => {
    // onclose will fire after onerror, which handles reconnect
  };
}

function scheduleReconnect(): void {
  if (reconnectAttempts >= 50) return; // Stop after 50 attempts

  const baseDelay = 1000;
  const maxDelay = 30000;
  const delay = Math.min(baseDelay * Math.pow(2, reconnectAttempts), maxDelay);
  reconnectAttempts++;

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    doConnect();
  }, delay);
}

export function useWebSocket() {
  // Initialize once on first use
  if (!initialized && typeof window !== 'undefined') {
    initialized = true;
    doConnect();
  }

  function send(msg: DashboardToHubMessage): void {
    if (state.value !== 'connected' || !ws) return;
    ws.send(JSON.stringify(msg));
  }

  function subscribe(resource: 'session' | 'machine' | 'queue', id?: string): void {
    send({ type: 'subscribe', resource, id });
  }

  function unsubscribe(resource: 'session' | 'machine' | 'queue', id?: string): void {
    send({ type: 'unsubscribe', resource, id });
  }

  function onMessage(type: string, handler: MessageHandler): () => void {
    if (!handlers.has(type)) handlers.set(type, new Set());
    handlers.get(type)!.add(handler);
    return () => handlers.get(type)?.delete(handler);
  }

  function onAnyMessage(handler: MessageHandler): () => void {
    globalHandlers.add(handler);
    return () => globalHandlers.delete(handler);
  }

  function disconnect(): void {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    reconnectAttempts = 50; // Prevent further reconnects
    ws?.close();
    ws = null;
    state.value = 'disconnected';
    initialized = false;
  }

  return {
    state,
    send,
    subscribe,
    unsubscribe,
    onMessage,
    onAnyMessage,
    disconnect,
  };
}
