import { appendFileSync, existsSync, statSync, createReadStream } from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';

export function appendRecordingChunks(
  recordingsPath: string,
  sessionId: string,
  chunks: Array<{ ts: number; data: string }>,
): void {
  const filePath = path.join(recordingsPath, `${sessionId}.jsonl`);
  const lines = chunks.map((c) => JSON.stringify(c)).join('\n') + '\n';
  appendFileSync(filePath, lines);
}

export function getRecordingMeta(
  recordingsPath: string,
  sessionId: string,
): { exists: boolean; sizeBytes: number; path: string } {
  const filePath = path.join(recordingsPath, `${sessionId}.jsonl`);
  const exists = existsSync(filePath);
  const sizeBytes = exists ? statSync(filePath).size : 0;
  return { exists, sizeBytes, path: filePath };
}

export function streamRecording(recordingsPath: string, sessionId: string): Readable | null {
  const filePath = path.join(recordingsPath, `${sessionId}.jsonl`);
  if (!existsSync(filePath)) return null;
  return createReadStream(filePath, { encoding: 'utf-8' });
}
