export const config = {
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://parks:parks@localhost:5432/parks',
  port: Number(process.env.PORT ?? 4000),
  devTools: process.env.ENABLE_DEV_TOOLS === 'true',
  /**
   * Shared secret for /api/staff/* (sent as X-Staff-Token). Stand-in until staff sign-in exists.
   * Unset: staff routes are open only when dev tools are on, and absent otherwise.
   */
  staffToken: process.env.STAFF_TOKEN || null,
  /** How often the background sweeper releases expired holds. */
  sweepIntervalMs: Number(process.env.SWEEP_INTERVAL_MS ?? 1000),
};
