import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

let dbInstance: DatabaseSync | null = null;

export function initDatabase(dbPath?: string): DatabaseSync {
  if (dbInstance) {
    return dbInstance;
  }

  const resolvedPath =
    dbPath || path.resolve(process.cwd(), 'data', 'queue.sqlite');

  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new DatabaseSync(resolvedPath);

  // Enable WAL mode for better concurrency
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');

  // Create review_jobs table
  db.exec(`
    CREATE TABLE IF NOT EXISTS review_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repository TEXT NOT NULL,
      pr_number INTEGER NOT NULL,
      head_sha TEXT NOT NULL,
      base_branch TEXT NOT NULL,
      clone_url TEXT NOT NULL,
      installation_id INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'completed', 'failed', 'superseded')),
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_status ON review_jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_repo_pr ON review_jobs(repository, pr_number);
  `);

  dbInstance = db;
  return dbInstance;
}

export function getDatabase(): DatabaseSync {
  if (!dbInstance) {
    return initDatabase();
  }
  return dbInstance;
}
