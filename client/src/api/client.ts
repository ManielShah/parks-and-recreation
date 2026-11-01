import type {
  AddToCartResponse, ApiError, CatalogResponse, CheckoutResponse, ErrorCode, JoinWaitlistResponse, StateResponse,
} from '@parks/shared';

export class ApiRequestError extends Error {
  constructor(public code: ErrorCode, message: string, public status: number) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (data as ApiError | null)?.error;
    throw new ApiRequestError(err?.code ?? 'invalid', err?.message ?? 'Something went wrong. Please try again.', res.status);
  }
  return data as T;
}

export const api = {
  catalog: () => call<CatalogResponse>('GET', '/catalog'),
  state: () => call<StateResponse>('GET', '/state'),
  markSeen: (upTo: string) => call<void>('POST', '/notices/seen', { upTo }),
  addToCart: (sectionId: string, childId: string) => call<AddToCartResponse>('POST', '/cart', { sectionId, childId }),
  removeFromCart: (holdId: string) => call<void>('DELETE', `/cart/${holdId}`),
  checkout: (holdIds: string[]) => call<CheckoutResponse>('POST', '/checkout', { holdIds }),
  joinWaitlist: (sectionId: string, childId: string) => call<JoinWaitlistResponse>('POST', '/waitlist', { sectionId, childId }),
  setReminder: (programId: string, on: boolean) => call<void>(on ? 'PUT' : 'DELETE', `/programs/${programId}/reminder`),
  leaveWaitlist: (entryId: string) => call<void>('DELETE', `/waitlist/${entryId}`),
  acceptOffer: (holdId: string) => call<CheckoutResponse>('POST', `/offers/${holdId}/accept`),
  declineOffer: (holdId: string) => call<void>('POST', `/offers/${holdId}/decline`),
  claim: (entryId: string) => call<CheckoutResponse>('POST', `/waitlist/${entryId}/claim`),
  withdraw: (registrationId: string) => call<void>('POST', `/registrations/${registrationId}/withdraw`),
  dev: {
    sectionStart: (sectionId: string, minutesFromNow: number) =>
      call<void>('POST', '/dev/section-start', { sectionId, minutesFromNow }),
    advance: (ms: number) => call<{ clockOffsetMs: number }>('POST', '/dev/advance', { ms }),
    dropout: (sectionId: string) => call<{ ok: boolean }>('POST', '/dev/dropout', { sectionId }),
    rivalHold: (sectionId: string) => call<{ ok: boolean }>('POST', '/dev/rival-hold', { sectionId }),
    reset: () => call<void>('POST', '/dev/reset'),
  },
};
