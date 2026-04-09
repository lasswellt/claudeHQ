import type { RiskLevel } from '@chq/shared';

/**
 * CAP-033 / story 013-009: risk-based notification escalation.
 *
 * Pure function — no I/O, no imports from hub internals beyond the
 * RiskLevel type from @chq/shared. Used by the notification engine
 * and batcher flush path to decide how loudly to deliver a pending
 * approval.
 *
 * Severity ladder (acceptance criterion from E002 epic):
 *   - critical  → urgent immediately
 *   - high      → high once age > 30s, otherwise normal
 *   - medium    → normal once age > 60s, otherwise low
 *   - low       → badge-only (no push)
 */

export type NotificationSeverity = 'urgent' | 'high' | 'normal' | 'low' | 'badge';

export interface EscalationInput {
  riskLevel: RiskLevel;
  /** Age of the pending approval in milliseconds */
  ageMs: number;
}

export function computeSeverity(input: EscalationInput): NotificationSeverity {
  const ageSeconds = Math.max(0, Math.floor(input.ageMs / 1000));

  switch (input.riskLevel) {
    case 'critical':
      return 'urgent';

    case 'high':
      return ageSeconds > 30 ? 'high' : 'normal';

    case 'medium':
      return ageSeconds > 60 ? 'normal' : 'low';

    case 'low':
    default:
      return 'badge';
  }
}

/**
 * Maps a severity bucket to the ntfy priority (1..5) used by the
 * ntfy notification channel. This is the bridge between the
 * generic severity ladder and the channel-specific urgency field.
 */
export function severityToNtfyPriority(severity: NotificationSeverity): 1 | 2 | 3 | 4 | 5 {
  switch (severity) {
    case 'urgent':
      return 5;
    case 'high':
      return 4;
    case 'normal':
      return 3;
    case 'low':
      return 2;
    case 'badge':
    default:
      return 1;
  }
}

/**
 * True if the severity should cause a push/phone notification.
 * Badge-only events update the dashboard counter but do not wake
 * the user's device.
 */
export function shouldPush(severity: NotificationSeverity): boolean {
  return severity !== 'badge';
}
