import { pool } from '../db.js';
import { migrate } from '../migrate.js';

const applied = await migrate(pool);
console.log(applied.length ? `applied: ${applied.join(', ')}` : 'database is up to date');
await pool.end();
