import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * CAP-016 / story 014-006: agent SDK session discovery.
 *
 * Goal: cross-reference the hub's own `sessions` table with
 * sessions that `@anthropic-ai/claude-agent-sdk` would enumerate
 * via its `query()` / `listSessions()` APIs, so the dashboard can
 * show sessions even when the hub doesn't have a direct record of
 * them (e.g. sessions started outside the agent daemon).
 *
 * The official SDK is not yet a dependency of this project; once
 * it is, its client can be swapped in for the filesystem fallback
 * without touching the consumer. The filesystem fallback reads
 * Claude Code's on-disk session transcripts at
 * `~/.claude/projects/<project-slug>/<session-uuid>.jsonl`.
 */

export interface DiscoveredSession {
  /** Stable session identifier — matches `sessionRecord.id` when one exists. */
  id: string;
  /** Source that produced this record. */
  source: 'hub_db' | 'sdk' | 'filesystem';
  /** Absolute path to the transcript on disk, if known. */
  transcriptPath?: string;
  /** First prompt text or summary, if available. */
  summary?: string;
  /** First-line timestamp (unix seconds). */
  startedAt?: number;
  /** Last-modified timestamp (unix seconds). */
  lastActivityAt?: number;
  /** Slug of the project directory the session belongs to. */
  projectSlug?: string;
}

export interface AgentSdkClient {
  /** List sessions the client knows about. Order is unspecified. */
  listSessions(): Promise<DiscoveredSession[]>;
}

export interface FilesystemClientOptions {
  /**
   * Root directory containing per-project subdirs with .jsonl
   * transcripts. Defaults to `~/.claude/projects`.
   */
  rootDir?: string;
  /** Cap the total number of sessions scanned. Defaults to 500. */
  maxSessions?: number;
}

/**
 * Filesystem-based fallback. Walks the Claude Code projects
 * directory and extracts a summary from each transcript's first
 * JSONL entry. Tolerant of missing directories — returns an empty
 * list if `rootDir` doesn't exist so the API endpoint still works
 * on fresh installations.
 */
export function createFilesystemSdkClient(
  opts: FilesystemClientOptions = {},
): AgentSdkClient {
  const rootDir = opts.rootDir ?? join(homedir(), '.claude', 'projects');
  const maxSessions = opts.maxSessions ?? 500;

  async function readFirstJsonLine(path: string): Promise<Record<string, unknown> | null> {
    try {
      // We only need the first line; for very large transcripts we
      // slice the head so we don't allocate the whole file.
      const buf = await readFile(path, { encoding: 'utf-8' });
      const firstNewline = buf.indexOf('\n');
      const firstLine = firstNewline === -1 ? buf : buf.slice(0, firstNewline);
      if (!firstLine.trim()) return null;
      return JSON.parse(firstLine) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  function extractSummary(head: Record<string, unknown> | null): string | undefined {
    if (!head) return undefined;
    // Common shapes across Claude Code transcript versions:
    //   { type: 'prompt', prompt: '...' }
    //   { type: 'user', message: { content: [{ type: 'text', text: '...' }] } }
    //   { summary: '...' }
    if (typeof head.summary === 'string') return head.summary;
    if (typeof head.prompt === 'string') return head.prompt;
    const message = head.message;
    if (message && typeof message === 'object') {
      const content = (message as Record<string, unknown>).content;
      if (Array.isArray(content)) {
        for (const part of content) {
          if (
            part &&
            typeof part === 'object' &&
            (part as Record<string, unknown>).type === 'text'
          ) {
            const text = (part as Record<string, unknown>).text;
            if (typeof text === 'string') return text;
          }
        }
      }
    }
    return undefined;
  }

  function extractStartedAt(head: Record<string, unknown> | null): number | undefined {
    if (!head) return undefined;
    const ts = head.timestamp ?? head.created_at ?? head.startedAt;
    if (typeof ts === 'number') return ts;
    if (typeof ts === 'string') {
      const parsed = Date.parse(ts);
      if (!Number.isNaN(parsed)) return Math.floor(parsed / 1000);
    }
    return undefined;
  }

  async function scanProject(projectDir: string, projectSlug: string): Promise<DiscoveredSession[]> {
    let entries: string[];
    try {
      entries = await readdir(projectDir);
    } catch {
      return [];
    }

    const discovered: DiscoveredSession[] = [];
    for (const entry of entries) {
      if (!entry.endsWith('.jsonl')) continue;
      const full = join(projectDir, entry);
      let stats;
      try {
        stats = await stat(full);
      } catch {
        continue;
      }
      if (!stats.isFile()) continue;

      const sessionId = entry.replace(/\.jsonl$/, '');
      const head = await readFirstJsonLine(full);
      discovered.push({
        id: sessionId,
        source: 'filesystem',
        transcriptPath: full,
        summary: extractSummary(head),
        startedAt: extractStartedAt(head),
        lastActivityAt: Math.floor(stats.mtimeMs / 1000),
        projectSlug,
      });
    }
    return discovered;
  }

  return {
    async listSessions(): Promise<DiscoveredSession[]> {
      let projectDirs: string[];
      try {
        projectDirs = await readdir(rootDir);
      } catch {
        // Directory doesn't exist yet — that's fine on a fresh install.
        return [];
      }

      const all: DiscoveredSession[] = [];
      for (const projectSlug of projectDirs) {
        if (all.length >= maxSessions) break;
        const projectDir = join(rootDir, projectSlug);
        let stats;
        try {
          stats = await stat(projectDir);
        } catch {
          continue;
        }
        if (!stats.isDirectory()) continue;
        const projectSessions = await scanProject(projectDir, projectSlug);
        for (const s of projectSessions) {
          if (all.length >= maxSessions) break;
          all.push(s);
        }
      }
      return all;
    },
  };
}

/**
 * Merge discovered sessions with the hub's own session records.
 * Entries with the same id are collapsed (hub_db wins for
 * deterministic fields; filesystem fills in transcriptPath and
 * projectSlug when the hub doesn't know them).
 */
export function mergeDiscovered(
  hubSessions: DiscoveredSession[],
  fromSdk: DiscoveredSession[],
): DiscoveredSession[] {
  const byId = new Map<string, DiscoveredSession>();
  for (const s of hubSessions) byId.set(s.id, s);
  for (const s of fromSdk) {
    const existing = byId.get(s.id);
    if (!existing) {
      byId.set(s.id, s);
      continue;
    }
    byId.set(s.id, {
      ...existing,
      transcriptPath: existing.transcriptPath ?? s.transcriptPath,
      projectSlug: existing.projectSlug ?? s.projectSlug,
      // Keep hub's lastActivityAt if present, else filesystem mtime.
      lastActivityAt: existing.lastActivityAt ?? s.lastActivityAt,
    });
  }
  return [...byId.values()];
}
