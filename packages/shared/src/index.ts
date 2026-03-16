// Types
export {
  type SessionRecord,
  type SessionStatus,
  type MachineRecord,
  type MachineStatus,
  type QueueTask,
  type NotificationRecord,
  sessionRecordSchema,
  sessionStatusSchema,
  machineRecordSchema,
  machineStatusSchema,
  queueTaskSchema,
  notificationRecordSchema,
} from './types.js';

// Protocol
export {
  type OutputChunk,
  outputChunkSchema,
  // Agent → Hub
  type AgentToHubMessage,
  agentToHubSchema,
  agentRegisterSchema,
  agentHeartbeatSchema,
  agentSessionStartedSchema,
  agentSessionOutputSchema,
  agentSessionEndedSchema,
  agentRecordingUploadSchema,
  agentQueueUpdatedSchema,
  // Hub → Agent
  type HubToAgentMessage,
  hubToAgentSchema,
  hubSessionStartSchema,
  hubSessionResumeSchema,
  hubSessionKillSchema,
  hubSessionInputSchema,
  hubQueueAddSchema,
  hubQueueRemoveSchema,
  hubQueueReorderSchema,
  // Hub → Dashboard
  type HubToDashboardMessage,
  hubToDashboardSchema,
  sessionOutputSchema,
  sessionUpdatedSchema,
  machineUpdatedSchema,
  queueUpdatedSchema,
  notificationSchema,
  // Dashboard → Hub
  type DashboardToHubMessage,
  dashboardToHubSchema,
  subscribeSchema,
  unsubscribeSchema,
} from './protocol.js';

// Config
export {
  type AgentConfig,
  type HubConfig,
  agentConfigSchema,
  hubConfigSchema,
  loadConfig,
} from './config.js';
