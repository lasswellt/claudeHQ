import { ref, onMounted, onUnmounted } from 'vue';
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
  const unreadCount = ref(0);
  let cleanup: (() => void) | null = null;

  function init(): void {
    const ws = useWebSocket();

    cleanup = ws.onMessage('notification', (msg: HubToDashboardMessage) => {
      if (msg.type !== 'notification') return;

      const item: NotificationItem = {
        id: msg.notification.id,
        type: msg.notification.type,
        message: JSON.parse(msg.notification.payload).message ?? msg.notification.type,
        sessionId: msg.notification.session_id,
        timestamp: msg.notification.sent_at,
        read: false,
      };

      notifications.value.unshift(item);
      unreadCount.value++;

      // Keep max 50 notifications
      if (notifications.value.length > 50) {
        notifications.value = notifications.value.slice(0, 50);
      }
    });
  }

  function markAllRead(): void {
    for (const n of notifications.value) {
      n.read = true;
    }
    unreadCount.value = 0;
  }

  function clear(): void {
    notifications.value = [];
    unreadCount.value = 0;
  }

  onMounted(() => init());
  onUnmounted(() => cleanup?.());

  return { notifications, unreadCount, markAllRead, clear };
}
