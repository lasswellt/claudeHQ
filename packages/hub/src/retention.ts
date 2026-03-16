import { readdirSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import type { FastifyBaseLogger } from 'fastify';

export interface RetentionConfig {
  maxAgeDays: number;
  maxSizeGb: number;
}

export function cleanupRecordings(
  recordingsPath: string,
  config: RetentionConfig,
  logger: FastifyBaseLogger,
): { deleted: number; freedBytes: number } {
  let deleted = 0;
  let freedBytes = 0;

  const now = Date.now();
  const maxAgeMs = config.maxAgeDays * 24 * 60 * 60 * 1000;
  const maxSizeBytes = config.maxSizeGb * 1024 * 1024 * 1024;

  let files: Array<{ name: string; path: string; size: number; mtime: number }>;

  try {
    files = readdirSync(recordingsPath)
      .filter((f) => f.endsWith('.jsonl'))
      .map((name) => {
        const fullPath = path.join(recordingsPath, name);
        const stat = statSync(fullPath);
        return { name, path: fullPath, size: stat.size, mtime: stat.mtimeMs };
      })
      .sort((a, b) => a.mtime - b.mtime); // oldest first
  } catch {
    return { deleted: 0, freedBytes: 0 };
  }

  // Delete files older than max age
  for (const file of files) {
    if (now - file.mtime > maxAgeMs) {
      try {
        unlinkSync(file.path);
        deleted++;
        freedBytes += file.size;
        logger.info({ file: file.name, ageDays: Math.floor((now - file.mtime) / 86400000) }, 'Deleted old recording');
      } catch (err) {
        logger.warn({ file: file.name, err }, 'Failed to delete recording');
      }
    }
  }

  // If still over size limit, delete oldest files
  let totalSize = files.reduce((sum, f) => sum + f.size, 0) - freedBytes;

  for (const file of files) {
    if (totalSize <= maxSizeBytes) break;
    // Skip already deleted
    if (now - file.mtime > maxAgeMs) continue;

    try {
      unlinkSync(file.path);
      deleted++;
      freedBytes += file.size;
      totalSize -= file.size;
      logger.info({ file: file.name, sizeBytes: file.size }, 'Deleted recording (size limit)');
    } catch {
      // Continue with next file
    }
  }

  return { deleted, freedBytes };
}

export function startRetentionCron(
  recordingsPath: string,
  config: RetentionConfig,
  logger: FastifyBaseLogger,
  intervalMs: number = 6 * 60 * 60 * 1000, // 6 hours
): ReturnType<typeof setInterval> {
  return setInterval(() => {
    const result = cleanupRecordings(recordingsPath, config, logger);
    if (result.deleted > 0) {
      logger.info(result, 'Retention cleanup completed');
    }
  }, intervalMs);
}
