import type { RiskLevel } from '@chq/shared';

const DANGEROUS_PATTERNS = /rm\s+-rf\s+\/|sudo\s+|curl\s+.*\|\s*(ba)?sh|wget\s+.*\|\s*(ba)?sh|chmod\s+777|mkfs|dd\s+if=|shutdown|reboot/;
const SAFE_BASH_PATTERNS = /^(ls|cat|head|tail|wc|find|grep|rg|git\s+(status|log|diff|branch|show)|npm\s+test|pnpm\s+test|node\s|tsc|eslint|prettier|jest|vitest)/;

export function classifyRisk(requestType: string, toolName?: string, toolInput?: string): RiskLevel {
  if (requestType === 'ask_user') return 'low';

  if (!toolName) return 'medium';

  const name = toolName.toLowerCase();

  // Read-only tools
  if (['read', 'glob', 'grep', 'ls', 'view'].includes(name)) return 'low';

  // Write/Edit — medium
  if (['write', 'edit'].includes(name)) return 'medium';

  // Bash — depends on command
  if (name === 'bash' && toolInput) {
    if (DANGEROUS_PATTERNS.test(toolInput)) return 'critical';
    if (SAFE_BASH_PATTERNS.test(toolInput)) return 'medium';
    return 'high';
  }

  // MCP tools
  if (name.startsWith('mcp_') || requestType === 'mcp_elicitation') return 'high';

  return 'medium';
}
