// All booking logic reads time from here so dev tools can skip ahead without touching data.
let offsetMs = 0;

export const clock = {
  now: (): Date => new Date(Date.now() + offsetMs),
  offsetMs: (): number => offsetMs,
  advance(ms: number): void {
    offsetMs += ms;
  },
  reset(): void {
    offsetMs = 0;
  },
};
