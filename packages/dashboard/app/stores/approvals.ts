import { ref, computed } from 'vue';
import { defineStore } from 'pinia';
import type { ApprovalRequest } from '@chq/shared';

export const useApprovalsStore = defineStore('approvals', () => {
  const approvals = ref<ApprovalRequest[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  const pending = computed(() => approvals.value.filter((a) => a.status === 'pending'));
  const pendingCount = computed(() => pending.value.length);

  async function fetchApprovals(status?: string): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const url = status ? `/api/approvals?status=${status}` : '/api/approvals';
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      approvals.value = (await res.json()) as ApprovalRequest[];
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to fetch approvals';
    } finally {
      loading.value = false;
    }
  }

  async function respond(
    approvalId: string,
    decision: 'approve' | 'deny',
    responseText?: string,
    rememberAsRule?: boolean,
  ): Promise<void> {
    const res = await fetch(`/api/approvals/${approvalId}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision, responseText, rememberAsRule }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    // Update local state
    const idx = approvals.value.findIndex((a) => a.id === approvalId);
    if (idx >= 0) {
      approvals.value[idx] = {
        ...approvals.value[idx]!,
        status: decision === 'approve' ? 'approved' : 'denied',
        resolved_by: 'user',
        resolved_at: Math.floor(Date.now() / 1000),
      };
    }
  }

  async function bulkRespond(approvalIds: string[], decision: 'approve' | 'deny'): Promise<void> {
    await fetch('/api/approvals/bulk/respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approvalIds, decision }),
    });
    await fetchApprovals();
  }

  return { approvals, loading, error, pending, pendingCount, fetchApprovals, respond, bulkRespond };
});
