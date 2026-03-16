import { appendFileSync, existsSync, statSync, createReadStream } from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';

function safeRecordingPath(recordingsPath: string, sessionId: string): string {
  const filePath = path.join(recordingsPath, `${sessionId}.jsonl`);
  const resolved = path.resolve(filePath);
  const base = path.resolve(recordingsPath);
  if (!resolved.startsWith(base + path.sep) && resolved !== base) {
    throw new Error('Invalid session ID: path traversal detected');
  }
  return resolved;
}

export function appendRecordingChunks(
  recordingsPath: string,
  sessionId: string,
  chunks: Array<{ ts: number; data: string }>,
): void {
  const filePath = safeRecordingPath(recordingsPath, sessionId);
  const lines = chunks.map((c) => JSON.stringify(c)).join('\n') + '\n';
  appendFileSync(filePath, lines);
}

export function getRecordingMeta(
  recordingsPath: string,
  sessionId: string,
): { exists: boolean; sizeBytes: number } {
  const filePath = safeRecordingPath(recordingsPath, sessionId);
  const exists = existsSync(filePath);
  const sizeBytes = exists ? statSync(filePath).size : 0;
  return { exists, sizeBytes };
}

export function streamRecording(recordingsPath: string, sessionId: string): Readable | null {
  const filePath = safeRecordingPath(recordingsPath, sessionId);
  if (!existsSync(filePath)) return null;
  return createReadStream(filePath, { encoding: 'utf-8' });
}
