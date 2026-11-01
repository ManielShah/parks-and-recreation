import { expect, type APIRequestContext, type Page } from '@playwright/test';

async function post(request: APIRequestContext, path: string, data?: unknown): Promise<void> {
  const res = await request.post(`/api/dev/${path}`, { data });
  expect(res.ok(), `POST /api/dev/${path} failed (${res.status()}); is ENABLE_DEV_TOOLS=true?`).toBeTruthy();
}

/** The prototype-control endpoints: reset the demo and simulate other families. */
export const dev = {
  reset: (request: APIRequestContext) => post(request, 'reset'),
  dropout: (request: APIRequestContext, sectionId: string) => post(request, 'dropout', { sectionId }),
  rivalHold: (request: APIRequestContext, sectionId: string) => post(request, 'rival-hold', { sectionId }),
  startsIn: (request: APIRequestContext, sectionId: string, minutesFromNow: number) =>
    post(request, 'section-start', { sectionId, minutesFromNow }),
};

/** Open a page and tuck away the prototype controls so they don't cover the content. */
export async function open(page: Page, path: string): Promise<void> {
  await page.goto(path);
  const collapse = page.getByRole('button', { name: 'Collapse prototype controls' });
  await collapse.click();
}

export async function openProgram(page: Page, programId: string): Promise<void> {
  await open(page, `/programs/${programId}`);
  await expect(page.getByRole('heading', { name: 'Choose a section' })).toBeVisible();
}

export const section = (page: Page, sectionId: string) => page.getByTestId(`section-${sectionId}`);

/** Close any notification toast (it can sit over the offer banner). */
export async function dismissToast(page: Page): Promise<void> {
  const close = page.getByRole('button', { name: 'Dismiss notification' });
  if (await close.isVisible()) await close.click();
}
