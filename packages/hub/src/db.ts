import Database from 'better-sqlite3';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function initDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath);

  // Performance PRAGMAs
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -20000'); // 20MB
  db.pragma('mmap_size = 268435456'); // 256MB
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');

  // Run migrations
  runMigrations(db);

  return db;
}

function runMigrations(db: Database.Database): void {
  // Create migrations tracking table
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  const migrationsDir = path.join(__dirname, 'migrations');
  let files: string[];
  try {
    files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
  } catch {
    // No migrations directory yet — skip
    return;
  }

  const applied = new Set(
    db
      .prepare('SELECT name FROM _migrations')
      .all()
      .map((row) => (row as { name: string }).name),
  );

  const insertMigration = db.prepare('INSERT INTO _migrations (name) VALUES (?)');

  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = readFileSync(path.join(migrationsDir, file), 'utf-8');
    const migrate = db.transaction(() => {
      db.exec(sql);
      insertMigration.run(file);
    });
    migrate();
  }
}
