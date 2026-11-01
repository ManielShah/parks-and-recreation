import { expect, test } from '@playwright/test';
import { dev, dismissToast, open, openProgram, section } from './helpers';

// Demo family: Maya (7) and Leo (10). See server/src/seed.ts for the catalog.

test.beforeEach(async ({ request }) => {
  await dev.reset(request);
});

test('browse, filter by age, hold a seat and check out', async ({ page }) => {
  await open(page, '/');
  await expect(page.getByRole('heading', { name: 'Winter registration is open' })).toBeVisible();

  // Programs carry no age of their own; a program matches if any section takes the child.
  await expect(page.getByText(/^Ages /)).toHaveCount(0);
  await page.getByRole('button', { name: 'Leo · 10' }).click();
  await expect(page.getByRole('heading', { name: '4 programs for Leo' })).toBeVisible();

  // Picking both kids keeps only programs with a section that takes them together.
  await page.getByRole('button', { name: 'Maya · 7' }).click();
  await expect(page.getByRole('heading', { name: '4 programs for Maya & Leo together' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 3 })).toHaveText(['Swim Level 2', 'Art Studio: Clay & Paint', 'Youth Basketball Camp', 'Climbing Wall']);

  await openProgram(page, 'art');
  await section(page, 'art-sat').getByRole('button', { name: 'Add Maya to cart' }).click();
  await expect(page.getByRole('status')).toContainText('You have the last spot');

  await open(page, '/checkout');
  await expect(page.getByText('Held for you', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Pay $95 and register' }).click();
  await expect(page.getByRole('heading', { name: "You're registered" })).toBeVisible();
  await expect(page.getByText(/Confirmation CV-\d+/)).toBeVisible();

  await page.getByRole('button', { name: 'View my registrations' }).click();
  await expect(page.getByText('Art Studio: Clay & Paint')).toBeVisible();
});

test('ages are set per section: a limited section turns a child away, an open one takes them', async ({ page }) => {
  await openProgram(page, 'art');
  await expect(page.getByRole('main').getByText(/Ages vary|^Ages$/)).toHaveCount(0); // no program-level age
  await page.getByRole('button', { name: /^Leo/ }).click();

  const wed = section(page, 'art-wed'); // ages 5–7
  await expect(wed.getByText('Ages 5–7', { exact: true })).toBeVisible();
  await expect(wed.getByText('Ages 5–7 · Leo is 10')).toBeVisible();
  await expect(wed.getByRole('button', { name: 'Ages 5–7 only' })).toBeDisabled();

  const sat = section(page, 'art-sat'); // open to all ages
  await expect(sat.getByText('All ages', { exact: true })).toBeVisible();
  await expect(sat.getByText('Maya & Leo can both join')).toBeVisible();
  await expect(sat.getByRole('button', { name: 'Add Leo to cart' })).toBeEnabled();
});

test('a child registered for one section can still add another section of the same program', async ({ page }) => {
  await openProgram(page, 'art');
  await section(page, 'art-wed').getByRole('button', { name: 'Add Maya to cart' }).click();
  await open(page, '/checkout');
  await page.getByRole('button', { name: 'Pay $95 and register' }).click();
  await expect(page.getByRole('heading', { name: "You're registered" })).toBeVisible();

  await openProgram(page, 'art');
  await expect(page.getByRole('button', { name: /^Maya/ })).toContainText('Registered Wednesdays · can add another day');
  await expect(section(page, 'art-wed')).toContainText('Maya registered');
  await section(page, 'art-sat').getByRole('button', { name: 'Add Maya to cart' }).click();
  await expect(page.getByRole('status')).toContainText('You have the last spot in Art Studio: Clay & Paint · Saturdays');
});

test('waitlist offer: accepting registers and charges in one step', async ({ page, request }) => {
  await openProgram(page, 'swim2');
  await section(page, 'swim2-sat').getByRole('button', { name: 'Waitlist Maya' }).click();
  await expect(page.getByRole('status')).toContainText('Maya is #3 on the waitlist');

  // Three families drop out: the first two spots go to the families ahead of Maya.
  for (let i = 0; i < 3; i++) await dev.dropout(request, 'swim2-sat');

  const offer = page.getByRole('region', { name: 'Waitlist offer' });
  await expect(offer).toContainText('A spot opened for Maya in Swim Level 2 · Saturdays');
  await dismissToast(page);
  await offer.getByRole('button', { name: 'Accept and pay $85' }).click();

  await expect(page.getByRole('heading', { name: "You're registered" })).toBeVisible();
  await expect(page.getByText('Swim Level 2', { exact: true })).toBeVisible();
});

for (const [startsIn, minutesFromNow, timer] of [
  ['more than a day away: 2 hours', 25 * 60, /(2:00:00|1:59:\d\d) left/],
  ['3 hours away: 30 minutes', 180, /(30:00|29:\d\d) left/],
  ['1 hour away: 10 minutes', 60, /(10:00|9:\d\d) left/],
] as const) {
  test(`offer window shrinks with class start — ${startsIn}`, async ({ page, request }) => {
    await dev.startsIn(request, 'swim2-sat', minutesFromNow);
    await openProgram(page, 'swim2');
    await section(page, 'swim2-sat').getByRole('button', { name: 'Waitlist Maya' }).click();
    for (let i = 0; i < 3; i++) await dev.dropout(request, 'swim2-sat');

    await expect(page.getByRole('region', { name: 'Waitlist offer' })).toContainText(timer);
  });
}

test('under 20 minutes to class: no automatic offer, and the seat stays with the waitlist', async ({ page, request }) => {
  await dev.startsIn(request, 'swim2-sat', 15);
  await dev.dropout(request, 'swim2-sat'); // a seat opens; two families are already waiting
  await openProgram(page, 'swim2');

  // Maya isn't on the waitlist, so she can't take the open seat, only join the line for it.
  const sat = section(page, 'swim2-sat');
  await expect(sat).toContainText('Open seat reserved for the waitlist · 2 families in line');
  await expect(sat.getByRole('button', { name: 'Waitlist Maya' })).toBeVisible();

  await sat.getByRole('button', { name: 'Waitlist Maya' }).click();
  await dev.dropout(request, 'swim2-sat');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Choose a section' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Waitlist offer' })).toHaveCount(0);
});

test("another family's hold looks like any taken seat", async ({ page, request }) => {
  await dev.rivalHold(request, 'art-sat'); // takes Art · Saturdays' last seat
  await openProgram(page, 'art');

  await expect(section(page, 'art-sat').getByRole('button', { name: 'Waitlist Maya' })).toBeVisible();
  await expect(page.getByRole('main')).not.toContainText(/another family|in their cart|someone has/i);
});
