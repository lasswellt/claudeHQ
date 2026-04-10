import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fs and pino before importing TaskQueue so the module under test uses mocks.
vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(),
}));

vi.mock('pino', () => ({
  default: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { TaskQueue, type QueuedTask } from '../queue.js';

const mockReadFileSync = vi.mocked(readFileSync);
const mockWriteFileSync = vi.mocked(writeFileSync);
const mockExistsSync = vi.mocked(existsSync);

function makeTask(overrides: Partial<QueuedTask> = {}): QueuedTask {
  return {
    id: 'task-1',
    prompt: 'Fix the bug',
    cwd: '/home/user/project',
    priority: 0,
    createdAt: 1710000000,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: file does not exist
  mockExistsSync.mockReturnValue(false);
});

// ---------------------------------------------------------------------------
// Zod validation on deserialization
// ---------------------------------------------------------------------------

describe('TaskQueue — queue file deserialization', () => {
  it('should parse valid queue data correctly when file exists', () => {
    // Arrange
    const tasks: QueuedTask[] = [
      makeTask({ id: 'task-1', priority: 1 }),
      makeTask({ id: 'task-2', priority: 2 }),
    ];
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(tasks));

    // Act
    const queue = new TaskQueue('/tmp/queue.json');

    // Assert
    expect(queue.length).toBe(2);
    expect(queue.peek()?.id).toBe('task-1');
  });

  it('should parse tasks with optional flags field', () => {
    // Arrange
    const tasks: QueuedTask[] = [
      makeTask({ id: 'task-1', flags: ['--verbose', '--print'] }),
    ];
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(tasks));

    // Act
    const queue = new TaskQueue('/tmp/queue.json');

    // Assert
    expect(queue.peek()?.flags).toEqual(['--verbose', '--print']);
  });

  it('should fall back to empty queue when required field is missing', () => {
    // Arrange — task missing "prompt" field
    const malformed = [{ id: 'task-1', cwd: '/path', priority: 0, createdAt: 1710000000 }];
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(malformed));

    // Act
    const queue = new TaskQueue('/tmp/queue.json');

    // Assert
    expect(queue.isEmpty).toBe(true);
  });

  it('should fall back to empty queue when a field has the wrong type', () => {
    // Arrange — priority is a string instead of number
    const malformed = [makeTask({ priority: 'high' as unknown as number })];
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(malformed));

    // Act
    const queue = new TaskQueue('/tmp/queue.json');

    // Assert
    expect(queue.isEmpty).toBe(true);
  });

  it('should fall back to empty queue when file contains invalid JSON', () => {
    // Arrange
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('not-valid-json{{}}');

    // Act
    const queue = new TaskQueue('/tmp/queue.json');

    // Assert
    expect(queue.isEmpty).toBe(true);
  });

  it('should fall back to empty queue when file contains a JSON object instead of array', () => {
    // Arrange
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ id: 'task-1' }));

    // Act
    const queue = new TaskQueue('/tmp/queue.json');

    // Assert
    expect(queue.isEmpty).toBe(true);
  });

  it('should start with empty queue when persist file is absent', () => {
    // Arrange
    mockExistsSync.mockReturnValue(false);

    // Act
    const queue = new TaskQueue('/tmp/queue.json');

    // Assert
    expect(queue.isEmpty).toBe(true);
    expect(mockReadFileSync).not.toHaveBeenCalled();
  });

  it('should start with empty queue when no persistPath is provided', () => {
    // Arrange — no persist file at all
    // Act
    const queue = new TaskQueue();

    // Assert
    expect(queue.isEmpty).toBe(true);
    expect(mockExistsSync).not.toHaveBeenCalled();
  });

  it('should handle empty array in persist file gracefully', () => {
    // Arrange
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('[]');

    // Act
    const queue = new TaskQueue('/tmp/queue.json');

    // Assert
    expect(queue.isEmpty).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Core queue operations
// ---------------------------------------------------------------------------

describe('TaskQueue — operations', () => {
  it('should sort tasks by priority when adding', () => {
    // Arrange
    const queue = new TaskQueue();

    // Act
    queue.add(makeTask({ id: 'low', priority: 10 }));
    queue.add(makeTask({ id: 'high', priority: 1 }));
    queue.add(makeTask({ id: 'mid', priority: 5 }));

    // Assert
    expect(queue.peek()?.id).toBe('high');
    expect(queue.list().map((t) => t.id)).toEqual(['high', 'mid', 'low']);
  });

  it('should remove a task by id and return true', () => {
    // Arrange
    const queue = new TaskQueue();
    queue.add(makeTask({ id: 'task-1' }));

    // Act
    const removed = queue.remove('task-1');

    // Assert
    expect(removed).toBe(true);
    expect(queue.isEmpty).toBe(true);
  });

  it('should return false when removing a non-existent task id', () => {
    // Arrange
    const queue = new TaskQueue();

    // Act
    const removed = queue.remove('non-existent');

    // Assert
    expect(removed).toBe(false);
  });

  it('should pop the highest-priority task and return it', () => {
    // Arrange
    const queue = new TaskQueue();
    queue.add(makeTask({ id: 'task-a', priority: 1 }));
    queue.add(makeTask({ id: 'task-b', priority: 2 }));

    // Act
    const task = queue.pop();

    // Assert
    expect(task?.id).toBe('task-a');
    expect(queue.length).toBe(1);
  });

  it('should return undefined when popping from an empty queue', () => {
    // Arrange
    const queue = new TaskQueue();

    // Act
    const task = queue.pop();

    // Assert
    expect(task).toBeUndefined();
  });

  it('should reorder tasks to match supplied id order', () => {
    // Arrange
    const queue = new TaskQueue();
    queue.add(makeTask({ id: 'a', priority: 1 }));
    queue.add(makeTask({ id: 'b', priority: 2 }));
    queue.add(makeTask({ id: 'c', priority: 3 }));

    // Act
    queue.reorder(['c', 'a', 'b']);

    // Assert
    expect(queue.list().map((t) => t.id)).toEqual(['c', 'a', 'b']);
  });

  it('should drop unknown ids when reordering', () => {
    // Arrange
    const queue = new TaskQueue();
    queue.add(makeTask({ id: 'a', priority: 1 }));

    // Act
    queue.reorder(['a', 'unknown-id']);

    // Assert
    expect(queue.list().map((t) => t.id)).toEqual(['a']);
  });

  it('should persist to file on add when persistPath is set', () => {
    // Arrange
    const queue = new TaskQueue('/tmp/queue.json');

    // Act
    queue.add(makeTask());

    // Assert
    expect(mockWriteFileSync).toHaveBeenCalledWith('/tmp/queue.json', expect.any(String));
  });

  it('should emit updated event when task is added', () => {
    // Arrange
    const queue = new TaskQueue();
    const listener = vi.fn();
    queue.on('updated', listener);

    // Act
    queue.add(makeTask());

    // Assert
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ id: 'task-1' })]));
  });

  it('should return a copy of the tasks list from list()', () => {
    // Arrange
    const queue = new TaskQueue();
    queue.add(makeTask({ id: 'task-1' }));

    // Act
    const snapshot = queue.list();
    snapshot.pop(); // mutate the copy

    // Assert — internal state unchanged
    expect(queue.length).toBe(1);
  });
});
