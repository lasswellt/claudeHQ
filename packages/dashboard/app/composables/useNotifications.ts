import { ref, computed, onMounted, onUnmounted, getCurrentInstance } from 'vue';
import { useWebSocket } from './useWebSocket';
import type { HubToDashboardMessage } from '@chq/shared/browser';

export interface NotificationItem {
  id: string;
  type: string;
  message: string;
  sessionId?: string;
  timestamp: number;
  read: boolean;
}

export function useNotifications() {
  const notifications = ref<NotificationItem[]>([]);
  // ME-16: derive unreadCount from the array so it stays in sync even when the
  // array is capped at 50 entries.
  const unreadCount = computed(() => notifications.value.filter((n) => !n.read).length);
  let cleanup: (() => void) | null = null;

  function init(): void {
    const ws = useWebSocket();

    cleanup = ws.onMessage('notification', (msg: HubToDashboardMessage) => {
      if (msg.type !== 'notification') return;

      // ME-15: guard against malformed JSON in the payload field.
      let message: string;
      try {
        message = (JSON.parse(msg.notification.payload) as { message?: string }).message ?? msg.notification.type;
      } catch {
        message = msg.notification.type;
      }

      const item: NotificationItem = {
        id: msg.notification.id,
        type: msg.notification.type,
        message,
        sessionId: msg.notification.session_id,
        timestamp: msg.notification.sent_at,
        read: false,
      };

      notifications.value.unshift(item);

      // Keep max 50 notifications
      if (notifications.value.length > 50) {
        notifications.value = notifications.value.slice(0, 50);
      }
    });
  }

  function teardown(): void {
    cleanup?.();
  }

  function markAllRead(): void {
    for (const n of notifications.value) {
      n.read = true;
    }
  }

  function clear(): void {
    notifications.value = [];
  }

  // ME-17: only register lifecycle hooks when called from a component setup
  // context; calling from a store or plugin would produce Vue warnings.
  if (getCurrentInstance()) {
    onMounted(() => init());
    onUnmounted(() => teardown());
  }

  return { notifications, unreadCount, init, teardown, markAllRead, clear };
}
