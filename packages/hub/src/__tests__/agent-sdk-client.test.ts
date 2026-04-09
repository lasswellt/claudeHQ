import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createFilesystemSdkClient,
  mergeDiscovered,
  type DiscoveredSession,
} from '../services/agent-sdk-client.js';

// CAP-016 / story 014-006: SDK session discovery wrapper.

let rootDir: string;

beforeEach(async () => {
  rootDir = await mkdtemp(join(tmpdir(), 'chq-sdk-test-'));
});

afterEach(async () => {
  await rm(rootDir, { recursive: true, force: true });
});

async function writeTranscript(
  projectSlug: string,
  sessionId: string,
  content: string,
): Promise<string> {
  const projectDir = join(rootDir, projectSlug);
  await mkdir(projectDir, { recursive: true });
  const path = join(projectDir, `${sessionId}.jsonl`);
  await writeFile(path, content, 'utf-8');
  return path;
}

describe('createFilesystemSdkClient', () => {
  it('returns empty list when rootDir does not exist', async () => {
    const client = createFilesystemSdkClient({ rootDir: '/nonexistent/path/deep' });
    const sessions = await client.listSessions();
    expect(sessions).toEqual([]);
  });

  it('discovers a single session with a prompt-shaped first line', async () => {
    await writeTranscript(
      '-home-me-project',
      'sess-1',
      JSON.stringify({ type: 'prompt', prompt: 'Fix the bug', timestamp: 1700000000 }) + '\n',
    );
    const client = createFilesystemSdkClient({ rootDir });
    const sessions = await client.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      id: 'sess-1',
      source: 'filesystem',
      summary: 'Fix the bug',
      projectSlug: '-home-me-project',
      startedAt: 1700000000,
    });
    expect(sessions[0]?.transcriptPath).toContain('sess-1.jsonl');
  });

  it('extracts summary from a Claude user-message shape', async () => {
    const head = {
      type: 'user',
      message: {
        content: [
          { type: 'text', text: 'Please review my PR' },
        ],
      },
    };
    await writeTranscript('proj', 'sess-ua', JSON.stringify(head) + '\n');
    const client = createFilesystemSdkClient({ rootDir });
    const [session] = await client.listSessions();
    expect(session?.summary).toBe('Please review my PR');
  });

  it('reads lastActivityAt from file mtime', async () => {
    const path = await writeTranscript('proj', 'sess-mtime', '{}\n');
    const client = createFilesystemSdkClient({ rootDir });
    const [session] = await client.listSessions();
    expect(session?.lastActivityAt).toBeTypeOf('number');
    // Sanity: mtime should be within the last minute.
    const now = Math.floor(Date.now() / 1000);
    expect(session?.lastActivityAt).toBeGreaterThanOrEqual(now - 60);
    expect(path).toContain('sess-mtime.jsonl');
  });

  it('skips non-jsonl files', async () => {
    await writeTranscript('proj', 'sess-a', '{}\n');
    await writeFile(join(rootDir, 'proj', 'README.md'), 'not a session');
    const client = createFilesystemSdkClient({ rootDir });
    const sessions = await client.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.id).toBe('sess-a');
  });

  it('handles multiple projects', async () => {
    await writeTranscript('alpha', 'a1', JSON.stringify({ prompt: 'A' }) + '\n');
    await writeTranscript('alpha', 'a2', JSON.stringify({ prompt: 'B' }) + '\n');
    await writeTranscript('beta', 'b1', JSON.stringify({ prompt: 'C' }) + '\n');
    const client = createFilesystemSdkClient({ rootDir });
    const sessions = await client.listSessions();
    expect(sessions).toHaveLength(3);
    const ids = sessions.map((s) => s.id).sort();
    expect(ids).toEqual(['a1', 'a2', 'b1']);
  });

  it('tolerates malformed first lines', async () => {
    await writeTranscript('proj', 'bad', 'not json\n{"type":"text_delta","text":"later"}\n');
    const client = createFilesystemSdkClient({ rootDir });
    const sessions = await client.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.summary).toBeUndefined();
  });

  it('honors maxSessions cap', async () => {
    for (let i = 0; i < 10; i++) {
      await writeTranscript('proj', `s${i}`, '{}\n');
    }
    const client = createFilesystemSdkClient({ rootDir, maxSessions: 3 });
    const sessions = await client.listSessions();
    expect(sessions.length).toBeLessThanOrEqual(3);
  });
});

describe('mergeDiscovered', () => {
  it('preserves hub_db entries and appends filesystem-only ones', () => {
    const hub: DiscoveredSession[] = [
      { id: 'a', source: 'hub_db', summary: 'hub-summary', lastActivityAt: 100 },
    ];
    const fs: DiscoveredSession[] = [
      { id: 'a', source: 'filesystem', transcriptPath: '/tmp/a.jsonl', projectSlug: 'proj' },
      { id: 'b', source: 'filesystem', transcriptPath: '/tmp/b.jsonl' },
    ];
    const merged = mergeDiscovered(hub, fs);
    const a = merged.find((s) => s.id === 'a');
    const b = merged.find((s) => s.id === 'b');
    expect(a?.source).toBe('hub_db');
    expect(a?.summary).toBe('hub-summary');
    // Filesystem-only enrichment should fill in.
    expect(a?.transcriptPath).toBe('/tmp/a.jsonl');
    expect(a?.projectSlug).toBe('proj');
    expect(a?.lastActivityAt).toBe(100); // hub wins
    expect(b?.source).toBe('filesystem');
  });

  it('keeps filesystem lastActivityAt when hub is missing it', () => {
    const hub: DiscoveredSession[] = [{ id: 'a', source: 'hub_db' }];
    const fs: DiscoveredSession[] = [{ id: 'a', source: 'filesystem', lastActivityAt: 500 }];
    const merged = mergeDiscovered(hub, fs);
    expect(merged[0]?.lastActivityAt).toBe(500);
  });
});
