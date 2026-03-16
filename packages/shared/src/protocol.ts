import { z } from 'zod';
import { sessionRecordSchema, machineRecordSchema, queueTaskSchema, notificationRecordSchema } from './types.js';

// ── Shared chunk type ───────────────────────────────────────────
export const outputChunkSchema = z.object({
  ts: z.number(),
  data: z.string(),
});
export type OutputChunk = z.infer<typeof outputChunkSchema>;

// ═══════════════════════════════════════════════════════════════
// Agent → Hub messages
// ═══════════════════════════════════════════════════════════════

export const agentRegisterSchema = z.object({
  type: z.literal('agent:register'),
  machineId: z.string(),
  version: z.string(),
  maxSessions: z.number(),
  os: z.string(),
});

export const agentHeartbeatSchema = z.object({
  type: z.literal('agent:heartbeat'),
  machineId: z.string(),
  activeSessions: z.number(),
  cpuPercent: z.number(),
  memPercent: z.number(),
});

export const agentSessionStartedSchema = z.object({
  type: z.literal('agent:session:started'),
  sessionId: z.string(),
  machineId: z.string(),
  prompt: z.string(),
  cwd: z.string(),
  pid: z.number(),
});

export const agentSessionOutputSchema = z.object({
  type: z.literal('agent:session:output'),
  sessionId: z.string(),
  chunks: z.array(outputChunkSchema),
});

export const agentSessionEndedSchema = z.object({
  type: z.literal('agent:session:ended'),
  sessionId: z.string(),
  exitCode: z.number(),
  claudeSessionId: z.string().nullable(),
});

export const agentRecordingUploadSchema = z.object({
  type: z.literal('agent:recording:upload'),
  sessionId: z.string(),
  chunks: z.array(outputChunkSchema),
  final: z.boolean(),
});

export const agentQueueUpdatedSchema = z.object({
  type: z.literal('agent:queue:updated'),
  machineId: z.string(),
  queue: z.array(queueTaskSchema),
});

export const agentToHubSchema = z.discriminatedUnion('type', [
  agentRegisterSchema,
  agentHeartbeatSchema,
  agentSessionStartedSchema,
  agentSessionOutputSchema,
  agentSessionEndedSchema,
  agentRecordingUploadSchema,
  agentQueueUpdatedSchema,
]);
export type AgentToHubMessage = z.infer<typeof agentToHubSchema>;

// ═══════════════════════════════════════════════════════════════
// Hub → Agent messages
// ═══════════════════════════════════════════════════════════════

export const hubSessionStartSchema = z.object({
  type: z.literal('hub:session:start'),
  sessionId: z.string(),
  prompt: z.string(),
  cwd: z.string(),
  flags: z.array(z.string()).default([]),
});

export const hubSessionResumeSchema = z.object({
  type: z.literal('hub:session:resume'),
  sessionId: z.string(),
  prompt: z.string(),
  claudeSessionId: z.string(),
  cwd: z.string(),
});

export const hubSessionKillSchema = z.object({
  type: z.literal('hub:session:kill'),
  sessionId: z.string(),
});

export const hubSessionInputSchema = z.object({
  type: z.literal('hub:session:input'),
  sessionId: z.string(),
  input: z.string(),
});

export const hubQueueAddSchema = z.object({
  type: z.literal('hub:queue:add'),
  task: queueTaskSchema,
});

export const hubQueueRemoveSchema = z.object({
  type: z.literal('hub:queue:remove'),
  taskId: z.string(),
});

export const hubQueueReorderSchema = z.object({
  type: z.literal('hub:queue:reorder'),
  order: z.array(z.string()),
});

export const hubToAgentSchema = z.discriminatedUnion('type', [
  hubSessionStartSchema,
  hubSessionResumeSchema,
  hubSessionKillSchema,
  hubSessionInputSchema,
  hubQueueAddSchema,
  hubQueueRemoveSchema,
  hubQueueReorderSchema,
]);
export type HubToAgentMessage = z.infer<typeof hubToAgentSchema>;

// ═══════════════════════════════════════════════════════════════
// Hub → Dashboard messages
// ═══════════════════════════════════════════════════════════════

export const sessionOutputSchema = z.object({
  type: z.literal('session:output'),
  sessionId: z.string(),
  chunks: z.array(outputChunkSchema),
});

export const sessionUpdatedSchema = z.object({
  type: z.literal('session:updated'),
  session: sessionRecordSchema,
});

export const machineUpdatedSchema = z.object({
  type: z.literal('machine:updated'),
  machine: machineRecordSchema,
});

export const queueUpdatedSchema = z.object({
  type: z.literal('queue:updated'),
  machineId: z.string(),
  queue: z.array(queueTaskSchema),
});

export const notificationSchema = z.object({
  type: z.literal('notification'),
  notification: notificationRecordSchema,
});

export const hubToDashboardSchema = z.discriminatedUnion('type', [
  sessionOutputSchema,
  sessionUpdatedSchema,
  machineUpdatedSchema,
  queueUpdatedSchema,
  notificationSchema,
]);
export type HubToDashboardMessage = z.infer<typeof hubToDashboardSchema>;

// ═══════════════════════════════════════════════════════════════
// Dashboard → Hub messages
// ═══════════════════════════════════════════════════════════════

const resourceTypeSchema = z.enum(['session', 'machine', 'queue']);

export const subscribeSchema = z.object({
  type: z.literal('subscribe'),
  resource: resourceTypeSchema,
  id: z.string().optional(),
});

export const unsubscribeSchema = z.object({
  type: z.literal('unsubscribe'),
  resource: resourceTypeSchema,
  id: z.string().optional(),
});

export const dashboardToHubSchema = z.discriminatedUnion('type', [
  subscribeSchema,
  unsubscribeSchema,
]);
export type DashboardToHubMessage = z.infer<typeof dashboardToHubSchema>;
