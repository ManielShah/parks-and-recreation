import { pool } from '../db.js';
import { migrate } from '../migrate.js';
import { seed } from '../seed.js';

await migrate(pool);
await seed(pool);
console.log('seeded winter catalog and demo family');
await pool.end();
