import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CheckoutResponse, Program, StateResponse, Tone } from '@parks/shared';
import { api, ApiRequestError } from '../api/client';
import { buildModel, type Model } from '../domain/model';

const POLL_MS = 2000;

export interface Toast {
  text: string;
  tone: Tone;
  /** Show a "Go to checkout" button. */
  toCheckout?: boolean;
}

interface Ctx {
  model: Model | null;
  loadError: string | null;
  toast: Toast | null;
  showToast: (t: Toast | null) => void;
  lastOrder: CheckoutResponse | null;
  setLastOrder: (o: CheckoutResponse) => void;
  /** Run a mutation, refresh state, and turn API errors into a warning toast. Resolves to null on failure. */
  run: <T>(fn: () => Promise<T>) => Promise<T | null>;
  refresh: () => Promise<void>;
  /** Refetch programs, e.g. after dev tools reseed opening times. */
  reloadCatalog: () => Promise<void>;
}

const RegistrationContext = createContext<Ctx | null>(null);

export function RegistrationProvider({ children }: { children: ReactNode }) {
  const [programs, setPrograms] = useState<Program[] | null>(null);
  const [state, setState] = useState<StateResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [lastOrder, setLastOrder] = useState<CheckoutResponse | null>(null);
  // Server clock minus local clock, so countdowns match the server (and its dev clock skips).
  const skew = useRef(0);
  const [tick, setTick] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    try {
      const s = await api.state();
      skew.current = s.serverNow - Date.now();
      setState(s);
      setLoadError(null);
      const latest = s.notices[s.notices.length - 1];
      if (latest) {
        setToast({ text: latest.message, tone: latest.tone });
        void api.markSeen(latest.id);
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not reach the server.');
    }
  }, []);

  const reloadCatalog = useCallback(async () => {
    try {
      setPrograms((await api.catalog()).programs);
    } catch (err) {
      setLoadError(String(err));
    }
  }, []);

  useEffect(() => {
    void reloadCatalog();
    void refresh();
    const poll = setInterval(refresh, POLL_MS);
    const clock = setInterval(() => setTick(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [refresh, reloadCatalog]);

  const run = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T | null> => {
      try {
        return await fn();
      } catch (err) {
        setToast({ text: err instanceof ApiRequestError ? err.message : 'Something went wrong. Please try again.', tone: 'warn' });
        return null;
      } finally {
        await refresh();
      }
    },
    [refresh],
  );

  const model = useMemo(
    () => (programs && state ? buildModel(programs, state, tick + skew.current) : null),
    [programs, state, tick],
  );

  const value = useMemo(
    () => ({ model, loadError, toast, showToast: setToast, lastOrder, setLastOrder, run, refresh, reloadCatalog }),
    [model, loadError, toast, lastOrder, run, refresh, reloadCatalog],
  );
  return <RegistrationContext.Provider value={value}>{children}</RegistrationContext.Provider>;
}

export function useRegistration(): Ctx {
  const ctx = useContext(RegistrationContext);
  if (!ctx) throw new Error('useRegistration must be used inside RegistrationProvider');
  return ctx;
}
