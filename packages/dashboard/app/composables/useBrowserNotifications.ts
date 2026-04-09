import { ref, onMounted, onUnmounted } from 'vue';
import { useWebSocket } from './useWebSocket';
import { useApprovalsStore } from '../stores/approvals';

// CAP-032 / story 013-010: browser Notification channel.
//
// Foreground notifications: when the dashboard tab is open and a
// new approval arrives over the WebSocket, show a system
// notification with approve/deny action buttons. Background pushes
// via VAPID / web-push are a separate follow-up story — they need
// hub keypair generation + subscription storage.

export type NotificationPermission = 'default' | 'granted' | 'denied';

export interface UseBrowserNotifications {
  permission: ReturnType<typeof ref<NotificationPermission>>;
  supported: ReturnType<typeof ref<boolean>>;
  requestPermission: () => Promise<NotificationPermission>;
}

let registration: ServiceWorkerRegistration | null = null;
let registering: Promise<ServiceWorkerRegistration | null> | null = null;

async function ensureServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (registration) return registration;
  if (registering) return registering;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }
  registering = navigator.serviceWorker
    .register('/sw.js', { scope: '/' })
    .then((reg) => {
      registration = reg;
      return reg;
    })
    .catch((err) => {
      // Service worker registration can fail on localhost without
      // HTTPS, in private-mode Firefox, etc. Degrade gracefully.
      // eslint-disable-next-line no-console
      console.warn('[notifications] service worker registration failed', err);
      return null;
    });
  return registering;
}

export function useBrowserNotifications(): UseBrowserNotifications {
  const permission = ref<NotificationPermission>(
    typeof Notification !== 'undefined' ? (Notification.permission as NotificationPermission) : 'default',
  );
  const supported = ref<boolean>(
    typeof Notification !== 'undefined' && typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
  );

  const ws = useWebSocket();
  const approvals = useApprovalsStore();

  async function requestPermission(): Promise<NotificationPermission> {
    if (!supported.value) return 'denied';
    const result = (await Notification.requestPermission()) as NotificationPermission;
    permission.value = result;
    if (result === 'granted') {
      await ensureServiceWorker();
    }
    return result;
  }

  async function showApprovalNotification(
    approvalId: string,
    toolName: string | null,
    riskLevel: string,
    prompt: string,
  ): Promise<void> {
    if (permission.value !== 'granted') return;
    const reg = await ensureServiceWorker();
    if (!reg) return;

    const title = `Approval needed: ${toolName ?? 'tool request'}`;
    const body = prompt.length > 140 ? `${prompt.slice(0, 140)}…` : prompt;
    const tag = `approval-${approvalId}`; // replaces prior notif for same approval

    const options: NotificationOptions & { actions?: Array<{ action: string; title: string }> } = {
      body,
      tag,
      badge: '/favicon.ico',
      icon: '/favicon.ico',
      requireInteraction: riskLevel === 'critical' || riskLevel === 'high',
      data: { approvalId },
      // actions render as buttons on supported browsers (Chrome, Edge,
      // Android). Silently ignored elsewhere.
      actions: [
        { action: 'approve', title: 'Approve' },
        { action: 'deny', title: 'Deny' },
      ],
    };

    try {
      await reg.showNotification(title, options);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[notifications] showNotification failed', err);
    }
  }

  // Subscribe to incoming approval:requested messages so the user
  // sees a system notification even when they're on another page.
  const offMessage = ws.onMessage('approval:requested', (msg) => {
    void showApprovalNotification(
      msg.approval.id,
      msg.approval.tool_name ?? null,
      msg.approval.risk_level,
      msg.approval.prompt_text ?? msg.approval.tool_input ?? msg.approval.tool_name ?? '(no details)',
    );
  });

  // Listen for action-button clicks forwarded by the service worker.
  function handleSwMessage(event: MessageEvent): void {
    const data = event.data as { type?: string; approvalId?: string; action?: string } | null;
    if (!data || data.type !== 'approval-notification-click') return;
    if (!data.approvalId) return;
    if (data.action === 'approve') {
      void approvals.respond(data.approvalId, 'approve');
    } else if (data.action === 'deny') {
      void approvals.respond(data.approvalId, 'deny');
    }
    // 'default' (plain click) — the SW already navigated to /approvals
  }

  onMounted(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.addEventListener('message', handleSwMessage);
    // Kick off SW registration eagerly so first-use is responsive.
    if (permission.value === 'granted') {
      void ensureServiceWorker();
    }
  });

  onUnmounted(() => {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.removeEventListener('message', handleSwMessage);
    }
    offMessage();
  });

  return { permission, supported, requestPermission };
}
