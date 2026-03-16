import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import pino from 'pino';

const log = pino({ name: 'devcontainer' });

export interface DevcontainerConfig {
  image?: string;
  dockerFile?: string;
  build?: { dockerfile: string; context?: string };
  forwardPorts?: number[];
  postCreateCommand?: string | string[];
  features?: Record<string, unknown>;
}

/**
 * Detect if a workspace has a devcontainer configuration.
 */
export function detectDevcontainer(workspacePath: string): DevcontainerConfig | null {
  const paths = [
    path.join(workspacePath, '.devcontainer', 'devcontainer.json'),
    path.join(workspacePath, '.devcontainer.json'),
  ];

  for (const p of paths) {
    if (existsSync(p)) {
      try {
        const raw = readFileSync(p, 'utf-8');
        // Strip comments (JSONC)
        const cleaned = raw.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
        const config = JSON.parse(cleaned) as DevcontainerConfig;
        log.info({ path: p }, 'Devcontainer detected');
        return config;
      } catch (err) {
        log.warn({ path: p, err }, 'Failed to parse devcontainer.json');
      }
    }
  }

  return null;
}

/**
 * Get the Docker image to use for a devcontainer.
 * Prefers explicit image, falls back to Dockerfile.
 */
export function getDevcontainerImage(config: DevcontainerConfig): string | null {
  if (config.image) return config.image;
  if (config.build?.dockerfile || config.dockerFile) {
    // Would need to build — return null to signal "build required"
    return null;
  }
  return null;
}
