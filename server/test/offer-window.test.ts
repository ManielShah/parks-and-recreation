import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoOfferExpiry, formatDuration, offerWindowMs } from '@parks/shared';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

test('offer window shrinks as class start approaches', () => {
  assert.equal(offerWindowMs(3 * 24 * HOUR), 2 * HOUR);
  assert.equal(offerWindowMs(24 * HOUR + 1), 2 * HOUR);
  assert.equal(offerWindowMs(24 * HOUR), 30 * MIN);
  assert.equal(offerWindowMs(2 * HOUR), 30 * MIN);
  assert.equal(offerWindowMs(2 * HOUR - 1), 10 * MIN);
  assert.equal(offerWindowMs(20 * MIN), 10 * MIN);
  assert.equal(offerWindowMs(20 * MIN - 1), null);
  assert.equal(offerWindowMs(-HOUR), null);
});

test('automatic offers never run past 10 minutes before class', () => {
  const start = 1_000 * HOUR;
  assert.equal(autoOfferExpiry(start, start - 25 * HOUR), start - 25 * HOUR + 2 * HOUR);
  assert.equal(autoOfferExpiry(start, start - 20 * MIN), start - 10 * MIN);
  assert.equal(autoOfferExpiry(start, start - 19 * MIN), null);
  assert.equal(autoOfferExpiry(start, start - 5 * MIN), null);
});

test('durations read naturally', () => {
  assert.equal(formatDuration(2 * HOUR), '2 hours');
  assert.equal(formatDuration(HOUR), '1 hour');
  assert.equal(formatDuration(30 * MIN), '30 minutes');
  assert.equal(formatDuration(MIN), '1 minute');
});
