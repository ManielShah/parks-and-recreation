import { createApp } from './app.js';
import { config } from './config.js';
import { pool } from './db.js';
import { migrate } from './migrate.js';
import { startSweeper } from './sweeper.js';

const applied = await migrate(pool);
if (applied.length) console.log('applied migrations:', applied.join(', '));

const stopSweeper = startSweeper(config.sweepIntervalMs);
const server = createApp().listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port}${config.devTools ? ' (dev tools on)' : ''}`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    stopSweeper();
    server.close(() => void pool.end());
  });
}
