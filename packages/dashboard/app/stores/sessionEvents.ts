import { ref, computed } from 'vue';
import { defineStore } from 'pinia';
import { useWebSocket } from '../composables/useWebSocket';

/**
 * CAP-017 / story 014-008: session events store — holds stream-json
 * events surfaced by the agent's dual-stream parser. The backend
 * protocol schema (`session:event`) lands in a follow-up sprint; for
 * now we consume raw messages via `onAnyMessage` and filter by type
 * string so the dashboard is ready the moment events start flowing.
 */

export interface SessionEvent {
  /** Unique id within the session (sequential). */
  seq: number;
  /** Unix millis when the hub forwarded the event. */
  ts: number;
  /** Session this event belongs to. */
  sessionId: string;
  /** Event kind from the stream-json parser. */
  kind:
    | 'permissionAsked'
    | 'toolCalled'
    | 'toolResult'
    | 'textDelta'
    | 'costUpdated'
    | 'completed'
    | 'error'
    | 'unknown';
  /** Free-form payload — shape depends on kind. */
  payload: Record<string, unknown>;
}

export const useSessionEventsStore = defineStore('sessionEvents', () => {
  const eventsBySession = ref<Map<string, SessionEvent[]>>(new Map());
  let nextSeq = 1;

  function eventsFor(sessionId: string): SessionEvent[] {
    return eventsBySession.value.get(sessionId) ?? [];
  }

  function clearSession(sessionId: string): void {
    eventsBySession.value.delete(sessionId);
  }

  function appendEvent(event: Omit<SessionEvent, 'seq' | 'ts'>): void {
    const enriched: SessionEvent = {
      ...event,
      seq: nextSeq++,
      ts: Date.now(),
    };
    const list = eventsBySession.value.get(event.sessionId) ?? [];
    list.push(enriched);
    // Cap at 1000 events per session so long runs don't balloon
    // the reactive store. Oldest drops first.
    if (list.length > 1000) list.shift();
    eventsBySession.value.set(event.sessionId, list);
  }

  // Subscribe to incoming messages. We use onAnyMessage + a type
  // string guard because the protocol schema for `session:event`
  // hasn't shipped yet — this keeps the store decoupled from the
  // backend rollout.
  const ws = useWebSocket();
  ws.onAnyMessage((msg) => {
    const obj = msg as unknown as { type?: string; sessionId?: string; kind?: SessionEvent['kind']; payload?: Record<string, unknown> };
    if (obj.type !== 'session:event') return;
    if (!obj.sessionId || !obj.kind) return;
    appendEvent({
      sessionId: obj.sessionId,
      kind: obj.kind,
      payload: obj.payload ?? {},
    });
  });

  const totalEventCount = computed(() => {
    let total = 0;
    for (const list of eventsBySession.value.values()) total += list.length;
    return total;
  });

  return {
    eventsBySession,
    eventsFor,
    clearSession,
    appendEvent,
    totalEventCount,
  };
});
