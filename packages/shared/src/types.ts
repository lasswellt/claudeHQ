import { z } from 'zod';

// -- Session Status --
export const sessionStatusSchema = z.enum(['queued', 'running', 'completed', 'failed']);
export type SessionStatus = z.infer<typeof sessionStatusSchema>;

// -- Session Record --
export const sessionRecordSchema = z.object({
  id: z.string(),
  machine_id: z.string(),
  prompt: z.string(),
  cwd: z.string(),
  flags: z.array(z.string()).optional(),
  status: sessionStatusSchema,
  pid: z.number().optional(),
  exit_code: z.number().optional(),
  claude_session_id: z.string().optional(),
  parent_session_id: z.string().optional(),
  started_at: z.number().optional(),
  ended_at: z.number().optional(),
  last_activity_at: z.number().optional(),
  recording_path: z.string().optional(),
  recording_size_bytes: z.number().optional(),
  recording_chunk_count: z.number().optional(),
  created_at: z.number(),
});
export type SessionRecord = z.infer<typeof sessionRecordSchema>;

// -- Machine Status --
export const machineStatusSchema = z.enum(['online', 'offline']);
export type MachineStatus = z.infer<typeof machineStatusSchema>;

// -- Machine Record --
export const machineRecordSchema = z.object({
  id: z.string(),
  display_name: z.string().optional(),
  last_seen: z.number(),
  status: machineStatusSchema,
  max_sessions: z.number().default(2),
  meta: z.object({
    version: z.string(),
    os: z.string(),
    arch: z.string(),
  }).optional(),
});
export type MachineRecord = z.infer<typeof machineRecordSchema>;

// -- Queue Task --
export const queueTaskSchema = z.object({
  id: z.string(),
  machine_id: z.string(),
  prompt: z.string(),
  cwd: z.string(),
  flags: z.array(z.string()).optional(),
  priority: z.number().default(100),
  position: z.number(),
  created_at: z.number(),
});
export type QueueTask = z.infer<typeof queueTaskSchema>;

// -- Notification Record --
export const notificationRecordSchema = z.object({
  id: z.string(),
  session_id: z.string().optional(),
  type: z.string(),
  channel: z.string(),
  payload: z.string(),
  sent_at: z.number(),
  delivered: z.boolean().default(false),
});
export type NotificationRecord = z.infer<typeof notificationRecordSchema>;
