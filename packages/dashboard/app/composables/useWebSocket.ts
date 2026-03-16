import { ref, onUnmounted } from 'vue';
import {
  hubToDashboardSchema,
  type HubToDashboardMessage,
  type DashboardToHubMessage,
} from '@chq/shared';

export type WsState = 'connecting' | 'connected' | 'disconnected' | 'error';

type MessageHandler = (msg: HubToDashboardMessage) => void;

export function useWebSocket() {
  const state = ref<WsState>('disconnected');
  let ws: WebSocket | null = null;
  let reconnectAttempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  const handlers = new Map<string, Set<MessageHandler>>();
  const globalHandlers = new Set<MessageHandler>();

  function connect(): void {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}/ws/dashboard`;

    state.value = 'connecting';
    ws = new WebSocket(url);

    ws.onopen = () => {
      state.value = 'connected';
      reconnectAttempts = 0;
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string) as unknown;
        const msg = hubToDashboardSchema.parse(data);

        // Notify global handlers
        for (const handler of globalHandlers) {
          handler(msg);
        }

        // Notify type-specific handlers
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
      scheduleReconnect();
    };

    ws.onerror = () => {
      state.value = 'error';
    };
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

  function scheduleReconnect(): void {
    const baseDelay = 1000;
    const maxDelay = 30000;
    const delay = Math.min(baseDelay * Math.pow(2, reconnectAttempts), maxDelay);
    reconnectAttempts++;

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  function disconnect(): void {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    reconnectAttempts = Infinity; // Prevent reconnect
    ws?.close();
    ws = null;
    state.value = 'disconnected';
  }

  // Auto-connect
  connect();

  // Cleanup on unmount
  onUnmounted(() => {
    disconnect();
  });

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
