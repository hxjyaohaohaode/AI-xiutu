import 'dotenv/config';
import { createDatabase, migrate, transaction, audit, ensureMonthlyGrant } from '@ai-xiutu/db';
import { loadConfig } from './config.js';
import { normalizePhone, passwordSchema, hashPassword } from './core.js';
import { createPersonalSpace } from './auth.js';

const config = loadConfig();
const phoneValue = process.env.BOOTSTRAP_ADMIN_PHONE;
const passwordValue = process.env.BOOTSTRAP_ADMIN_PASSWORD;
const name = process.env.BOOTSTRAP_ADMIN_NAME?.trim();
if (!phoneValue || !passwordValue || !name || name.length > 120)
  throw new Error(
    'Set BOOTSTRAP_ADMIN_PHONE, BOOTSTRAP_ADMIN_PASSWORD and BOOTSTRAP_ADMIN_NAME explicitly. No default credentials are provided.',
  );
const phone = normalizePhone(phoneValue);
passwordSchema.parse(passwordValue);
const password = await hashPassword(passwordValue);
const db = createDatabase(config.databaseUrl);
try {
  await migrate(db);
  const userId = await transaction(db, async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('ai-xiutu-bootstrap'))");
    if ((await tx.query('SELECT user_id FROM operator_users LIMIT 1')).rowCount)
      throw new Error(
        'An operator already exists. Bootstrap refuses to replace credentials or grant additional operators.',
      );
    if ((await tx.query('SELECT id FROM users WHERE phone=$1', [phone])).rowCount)
      throw new Error(
        'Phone already belongs to an account. Bootstrap refuses to silently promote or overwrite it.',
      );
    const user = (
      await tx.query(
        'INSERT INTO users(phone,display_name,password_hash,phone_verified_at) VALUES($1,$2,$3,clock_timestamp()) RETURNING id',
        [phone, name, password],
      )
    ).rows[0]!;
    await tx.query('INSERT INTO operator_users(user_id) VALUES($1)', [user.id]);
    await createPersonalSpace(tx, user.id, name);
    await ensureMonthlyGrant(tx, user.id);
    await audit(tx, user.id, 'operator.bootstrap', 'user', user.id, {
      verification: 'explicit trusted CLI provisioning',
    });
    return user.id;
  });
  process.stdout.write(
    `Operator created: ${userId}. Store credentials securely; no password was printed.\n`,
  );
} finally {
  await db.end();
}
