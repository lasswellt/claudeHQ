import { z } from 'zod';
import { readFileSync } from 'node:fs';

// ── Agent Configuration ─────────────────────────────────────────
export const agentConfigSchema = z.object({
  machineId: z.string(),
  displayName: z.string().optional(),
  hubUrl: z.string().url(),
  claudeBinary: z.string().default('claude'),
  defaultFlags: z.array(z.string()).default([]),
  defaultCwd: z.string().optional(),
  maxConcurrentSessions: z.number().min(1).max(10).default(2),
  recordingChunkIntervalMs: z.number().default(100),
  recordingUploadIntervalMs: z.number().default(5000),
  recordingRetentionDays: z.number().default(7),
});
export type AgentConfig = z.infer<typeof agentConfigSchema>;

// ── Hub Configuration ───────────────────────────────────────────
export const hubConfigSchema = z.object({
  port: z.number().default(7700),
  host: z.string().default('127.0.0.1'),
  databasePath: z.string().default('./data/db/chq.db'),
  recordingsPath: z.string().default('./data/recordings'),
  dashboardStaticPath: z.string().optional(),
  logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  // Agent container spawning
  agentImage: z.string().default('chq-agent:local'),
  claudeBinaryHostPath: z.string().optional(),
  reposPath: z.string().default('/data/repos'),
  dockerSocketPath: z.string().default('/var/run/docker.sock'),
  agentNetworkName: z.string().default('chq-internal'),
  agentDefaultMemoryMb: z.number().default(2048),
  agentMaxContainers: z.number().default(10),
  // CAP-047 / story 019-004: recordings retention. 0 disables.
  recordingsMaxAgeDays: z.number().default(30),
  recordingsMaxSizeGb: z.number().default(10),
});
export type HubConfig = z.infer<typeof hubConfigSchema>;

// ── Config loader ───────────────────────────────────────────────
export function loadConfig<S extends z.ZodTypeAny>(
  schema: S,
  filePath?: string,
  envPrefix?: string,
): z.output<S> {
  let fileData: Record<string, unknown> = {};

  if (filePath) {
    try {
      const raw = readFileSync(filePath, 'utf-8');
      fileData = JSON.parse(raw) as Record<string, unknown>;
    } catch (err: unknown) {
      // Only ignore ENOENT (file not found); rethrow permission errors,
      // JSON syntax errors, etc. so corrupt configs are not silently ignored.
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: string }).code === 'ENOENT'
      ) {
        // File not found — proceed with env/defaults only
      } else {
        throw err;
      }
    }
  }

  // Overlay environment variables if prefix is provided
  if (envPrefix) {
    for (const [key, value] of Object.entries(process.env)) {
      if (key.startsWith(envPrefix) && value !== undefined) {
        const configKey = key
          .slice(envPrefix.length)
          .toLowerCase()
          .replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
        // Attempt boolean coercion before numeric
        if (value === 'true') {
          fileData[configKey] = true;
        } else if (value === 'false') {
          fileData[configKey] = false;
        } else {
          // Attempt numeric coercion
          const numVal = Number(value);
          fileData[configKey] = isNaN(numVal) ? value : numVal;
        }
      }
    }
  }

  return schema.parse(fileData);
}
