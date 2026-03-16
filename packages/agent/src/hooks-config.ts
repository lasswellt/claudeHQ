import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

interface ClaudeSettings {
  hooks?: Record<string, unknown>;
  [key: string]: unknown;
}

export function writeHooksConfig(hubUrl: string): void {
  const settingsDir = path.join(os.homedir(), '.claude');
  const settingsPath = path.join(settingsDir, 'settings.json');

  // Convert ws:// URL to http:// for hooks
  const httpUrl = hubUrl.replace(/^ws:\/\//, 'http://').replace(/^wss:\/\//, 'https://');

  const hooksConfig = {
    Stop: [
      {
        matcher: '',
        hooks: [{ type: 'http', url: `${httpUrl}/hooks/stop`, timeout: 10 }],
      },
    ],
    PreToolUse: [
      {
        matcher: '',
        hooks: [{ type: 'http', url: `${httpUrl}/hooks/pre-tool-use`, timeout: 10 }],
      },
    ],
    PostToolUse: [
      {
        matcher: '',
        hooks: [{ type: 'http', url: `${httpUrl}/hooks/post-tool-use`, timeout: 10 }],
      },
    ],
    SubagentStop: [
      {
        matcher: '',
        hooks: [{ type: 'http', url: `${httpUrl}/hooks/subagent-stop`, timeout: 10 }],
      },
    ],
  };

  // Merge with existing settings (don't overwrite)
  let settings: ClaudeSettings = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf-8')) as ClaudeSettings;
    } catch {
      // Corrupt file — overwrite
    }
  }

  settings.hooks = { ...(settings.hooks ?? {}), ...hooksConfig };

  if (!existsSync(settingsDir)) {
    mkdirSync(settingsDir, { recursive: true });
  }
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}
