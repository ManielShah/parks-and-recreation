import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import type { ApiError } from '@parks/shared';
import * as booking from './booking.js';
import { BookingError } from './booking.js';
import { clock } from './clock.js';
import { config } from './config.js';
import { pool } from './db.js';
import { COMMUNITY_FAMILY, DEMO_FAMILY, seed } from './seed.js';
import { getCatalog, getState, markNoticesSeen } from './state.js';
import { sweepOnce } from './sweeper.js';

type Handler = (req: Request, res: Response) => Promise<unknown>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);

/**
 * The signed-in family. There is no auth yet: the client sends X-Family-Id and the demo
 * family is the default. Replace this with the session's family once sign-in exists.
 */
function familyOf(req: Request): string {
  return req.header('x-family-id') ?? DEMO_FAMILY;
}

const sectionChild = z.object({ sectionId: z.string().min(1), childId: z.string().min(1) });
const idParam = z.object({ id: z.string().regex(/^\d+$/) });

export function createApp() {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/catalog', wrap(async (_req, res) => res.json(await getCatalog())));

  app.get('/api/state', wrap(async (req, res) => {
    const state = await getState(familyOf(req));
    if (!state) throw new BookingError('not_found', 'Unknown family.', 404);
    res.json(state);
  }));

  app.post('/api/notices/seen', wrap(async (req, res) => {
    const { upTo } = z.object({ upTo: z.string().regex(/^\d+$/) }).parse(req.body);
    await markNoticesSeen(familyOf(req), upTo);
    res.status(204).end();
  }));

  app.post('/api/cart', wrap(async (req, res) => {
    const { sectionId, childId } = sectionChild.parse(req.body);
    res.status(201).json(await booking.addToCart(familyOf(req), sectionId, childId, clock.now()));
  }));

  app.delete('/api/cart/:id', wrap(async (req, res) => {
    const { id } = idParam.parse(req.params);
    await booking.removeFromCart(familyOf(req), id, clock.now());
    res.status(204).end();
  }));

  app.post('/api/checkout', wrap(async (req, res) => {
    const { holdIds } = z.object({ holdIds: z.array(z.string()).min(1) }).parse(req.body);
    res.status(201).json(await booking.checkout(familyOf(req), holdIds, clock.now()));
  }));

  app.post('/api/waitlist', wrap(async (req, res) => {
    const { sectionId, childId } = sectionChild.parse(req.body);
    res.status(201).json({ entry: await booking.joinWaitlist(familyOf(req), sectionId, childId, clock.now()) });
  }));

  app.put('/api/programs/:id/reminder', wrap(async (req, res) => {
    await booking.setReminder(familyOf(req), z.string().min(1).parse(req.params.id), true);
    res.status(204).end();
  }));

  app.delete('/api/programs/:id/reminder', wrap(async (req, res) => {
    await booking.setReminder(familyOf(req), z.string().min(1).parse(req.params.id), false);
    res.status(204).end();
  }));

  app.delete('/api/waitlist/:id', wrap(async (req, res) => {
    const { id } = idParam.parse(req.params);
    await booking.leaveWaitlist(familyOf(req), id);
    res.status(204).end();
  }));

  app.post('/api/offers/:id/accept', wrap(async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.status(201).json(await booking.acceptOffer(familyOf(req), id, clock.now()));
  }));

  app.post('/api/offers/:id/decline', wrap(async (req, res) => {
    const { id } = idParam.parse(req.params);
    await booking.declineOffer(familyOf(req), id, clock.now());
    res.status(204).end();
  }));

  app.post('/api/registrations/:id/withdraw', wrap(async (req, res) => {
    const { id } = idParam.parse(req.params);
    await booking.withdraw(familyOf(req), id, clock.now());
    res.status(204).end();
  }));

  if (config.devTools) {
    const sectionBody = z.object({ sectionId: z.string().min(1) });

    app.post('/api/dev/advance', wrap(async (req, res) => {
      const { ms } = z.object({ ms: z.number().int().positive().max(7 * 24 * 3600 * 1000) }).parse(req.body);
      clock.advance(ms);
      await sweepOnce();
      res.json({ clockOffsetMs: clock.offsetMs() });
    }));

    app.post('/api/dev/dropout', wrap(async (req, res) => {
      const { sectionId } = sectionBody.parse(req.body);
      res.json({ ok: await booking.simulateDropout(sectionId, COMMUNITY_FAMILY, clock.now()) });
    }));

    app.post('/api/dev/rival-hold', wrap(async (req, res) => {
      const { sectionId } = sectionBody.parse(req.body);
      res.json({ ok: await booking.simulateCartHold(sectionId, COMMUNITY_FAMILY, clock.now()) });
    }));

    app.post('/api/dev/reset', wrap(async (_req, res) => {
      clock.reset();
      await seed(pool);
      res.status(204).end();
    }));
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    let status = 500;
    let body: ApiError = { error: { code: 'invalid', message: 'Something went wrong. Please try again.' } };
    if (err instanceof BookingError) {
      status = err.status;
      body = { error: { code: err.code, message: err.message } };
    } else if (err instanceof z.ZodError) {
      status = 400;
      body = { error: { code: 'invalid', message: 'Invalid request.' } };
    } else {
      console.error(err);
    }
    res.status(status).json(body);
  });

  return app;
}
