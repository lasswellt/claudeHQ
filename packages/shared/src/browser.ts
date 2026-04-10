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
  // HI-03 — message schemas for the dashboard
  agentApprovalRequestMsg,
  hubApprovalDecisionMsg,
  approvalRequestedMsg,
  approvalResolvedMsg,
  approvalCountMsg,
} from './approvals.js';

export {
  type TemplateVariable,
  type SessionTemplate,
  sessionTemplateSchema,
} from './templates.js';

export {
  type RepoRecord,
  type WorkspaceRecord,
  type WorkspaceStatus,
  type JobRecord,
  type JobStatus,
  repoRecordSchema,
  workspaceRecordSchema,
  jobRecordSchema,
  // Workforce / container message schemas the dashboard may consume
  hubWorkspaceProvisionMsg,
  hubWorkspaceCleanupMsg,
  agentWorkspaceReadyMsg,
  agentWorkspaceErrorMsg,
  hubContainerCreateMsg,
  hubContainerStopMsg,
  hubContainerRemoveMsg,
  agentContainerCreatedMsg,
  agentContainerStartedMsg,
  agentContainerStdoutMsg,
  agentContainerExitedMsg,
  agentContainerStatsMsg,
  agentContainerErrorMsg,
} from './workforce.js';
