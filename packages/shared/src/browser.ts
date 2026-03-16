// Browser-safe exports — no Node.js fs/path imports
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

export {
  type OutputChunk,
  outputChunkSchema,
  type AgentToHubMessage,
  agentToHubSchema,
  type HubToAgentMessage,
  hubToAgentSchema,
  type HubToDashboardMessage,
  hubToDashboardSchema,
  type DashboardToHubMessage,
  dashboardToHubSchema,
  subscribeSchema,
  unsubscribeSchema,
} from './protocol.js';

export {
  type ApprovalRequestType,
  type ApprovalSource,
  type RiskLevel,
  type ApprovalStatus,
  type ApprovalRequest,
  type ApprovalResponse,
  type ApprovalPolicyRule,
  approvalRequestSchema,
  approvalResponseSchema,
  approvalPolicyRuleSchema,
} from './approvals.js';

export {
  type TemplateVariable,
  type SessionTemplate,
  sessionTemplateSchema,
} from './templates.js';

export {
  type RepoRecord,
  type WorkspaceRecord,
  type JobRecord,
  repoRecordSchema,
  workspaceRecordSchema,
  jobRecordSchema,
} from './workforce.js';
