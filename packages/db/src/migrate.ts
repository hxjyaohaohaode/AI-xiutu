import 'dotenv/config';
import { createDatabase, migrate } from './index.js';
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const db = createDatabase(url);
try {
  await migrate(db);
  process.stdout.write('Database migrations completed.\n');
} finally {
  await db.end();
}
