<script setup lang="ts">
import { computed } from 'vue';

// CAP-038 / story 020-001: shared status indicator.
//
// One component, one source of truth for how Running/Completed/
// Failed/etc. are rendered everywhere in the app. Follows the
// Carbon status pattern: color + icon + text label, optionally
// with a pulsing animation for "in-progress" states.
//
// Seven states: queued, blocked, running, waiting, completed, failed, cancelled.
// The `Waiting for Input` state covers approval-blocked sessions.

export type SessionLikeStatus =
  | 'queued'
  | 'blocked'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'cancelled'
  // Machine / job statuses that map onto the same visual vocabulary
  | 'online'
  | 'offline'
  | 'pending'
  | 'provisioning'
  | 'preparing';

interface StatusToken {
  label: string;
  color: string;
  icon: string;
  /** When true, the component applies a pulsing ring — gated on prefers-reduced-motion. */
  pulsing: boolean;
}

const TOKENS: Record<SessionLikeStatus, StatusToken> = {
  queued: { label: 'Queued', color: 'info', icon: 'mdi-clock-outline', pulsing: false },
  blocked: { label: 'Blocked', color: 'warning', icon: 'mdi-pause-octagon-outline', pulsing: false },
  running: { label: 'Running', color: 'success', icon: 'mdi-play-circle', pulsing: true },
  waiting: {
    label: 'Waiting for Input',
    color: 'warning',
    icon: 'mdi-help-circle-outline',
    pulsing: true,
  },
  completed: { label: 'Completed', color: 'success', icon: 'mdi-check-circle', pulsing: false },
  failed: { label: 'Failed', color: 'error', icon: 'mdi-alert-circle', pulsing: false },
  cancelled: { label: 'Cancelled', color: 'default', icon: 'mdi-cancel', pulsing: false },
  // Machines
  online: { label: 'Online', color: 'success', icon: 'mdi-server-network', pulsing: false },
  offline: { label: 'Offline', color: 'default', icon: 'mdi-server-network-off', pulsing: false },
  // Jobs (map to the same vocabulary)
  pending: { label: 'Pending', color: 'info', icon: 'mdi-clock-outline', pulsing: false },
  provisioning: {
    label: 'Provisioning',
    color: 'info',
    icon: 'mdi-progress-wrench',
    pulsing: true,
  },
  preparing: { label: 'Preparing', color: 'info', icon: 'mdi-cog-sync', pulsing: true },
};

const props = withDefaults(
  defineProps<{
    status: SessionLikeStatus | string;
    /** `chip` (default), `inline` (icon + text, no chip background), or `icon` (icon-only, tooltip on hover). */
    variant?: 'chip' | 'inline' | 'icon';
    size?: 'x-small' | 'small' | 'default' | 'large';
    /** When false, the label text is hidden — icon still renders. */
    showLabel?: boolean;
  }>(),
  {
    variant: 'chip',
    size: 'small',
    showLabel: true,
  },
);

const token = computed<StatusToken>(() => {
  const t = (TOKENS as Record<string, StatusToken>)[props.status];
  if (t) return t;
  // Unknown status — render a neutral dot with the raw value as label.
  return {
    label: String(props.status),
    color: 'default',
    icon: 'mdi-help-circle-outline',
    pulsing: false,
  };
});
</script>

<template>
  <v-chip
    v-if="variant === 'chip'"
    :color="token.color"
    :size="size"
    :prepend-icon="token.icon"
    variant="flat"
    :class="{ 'status-pulsing': token.pulsing }"
  >
    <template v-if="showLabel">{{ token.label }}</template>
  </v-chip>

  <span v-else-if="variant === 'inline'" class="d-inline-flex align-center ga-1">
    <v-icon
      :color="token.color"
      :size="size === 'x-small' ? 14 : size === 'small' ? 16 : 20"
      :class="{ 'status-pulsing': token.pulsing }"
    >
      {{ token.icon }}
    </v-icon>
    <span v-if="showLabel" class="text-body-2">{{ token.label }}</span>
  </span>

  <v-tooltip v-else location="top">
    <template #activator="{ props: tooltipProps }">
      <v-icon
        v-bind="tooltipProps"
        :color="token.color"
        :size="size === 'x-small' ? 14 : size === 'small' ? 16 : 20"
        :class="{ 'status-pulsing': token.pulsing }"
      >
        {{ token.icon }}
      </v-icon>
    </template>
    {{ token.label }}
  </v-tooltip>
</template>

<style scoped>
/*
 * CAP-038: pulsing ring for in-progress states, gated on
 * prefers-reduced-motion per WCAG AAA guidance. Users with
 * motion-sensitivity see a static icon with the same color
 * contrast.
 */
@media (prefers-reduced-motion: no-preference) {
  .status-pulsing {
    animation: chq-status-pulse 2s ease-in-out infinite;
  }
}

@keyframes chq-status-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.55;
  }
}
</style>
