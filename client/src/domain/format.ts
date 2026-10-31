/** 4:59, or 1:59:59 once there are hours left. */
export function countdown(ms: number): string {
  const t = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const pad = (n: number) => (n < 10 ? '0' : '') + n;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function money(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

export const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
