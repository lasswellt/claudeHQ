---
globs: "packages/hub/src/db*,packages/hub/src/**/*db*"
---
# SQLite Patterns (better-sqlite3)

- ALWAYS use prepared statements with parameterized queries:
  ```typescript
  const stmt = db.prepare('SELECT * FROM sessions WHERE machine_id = ?');
  const sessions = stmt.all(machineId);
  ```
- NEVER use string interpolation in SQL:
  ```typescript
  // FORBIDDEN — SQL injection risk!
  db.exec(`SELECT * FROM sessions WHERE id = '${id}'`);
  ```
- Enable WAL mode: `db.pragma('journal_mode = WAL')`
- Use transactions for multi-statement operations:
  ```typescript
  const tx = db.transaction(() => { stmt1.run(...); stmt2.run(...); });
  tx();
  ```
- Migrations in separate files, applied on startup
- INTEGER for timestamps (Unix epoch seconds), TEXT for UUIDs
