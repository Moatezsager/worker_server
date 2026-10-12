import crypto from 'crypto';
import { supabase, supabaseKey } from '../db';

const KEY = 'worker_account_lease';
const OWNER = crypto.randomUUID();
const TTL = 120000;
let heldValue: string | null = null;
let expiresAt = 0;
let pending: Promise<boolean> | null = null;
let losing: Promise<void> | null = null;
let nextCheck = 0;
let timer: NodeJS.Timeout | null = null;
let stopped = false;
let ticking = false;
let acquired = async () => {};
let lost = async () => {};

export function configureAccountLease(onAcquired: () => Promise<void>, onLost: () => Promise<void>) {
  acquired = onAcquired;
  lost = onLost;
}

async function refreshLease(): Promise<boolean> {
  if (stopped || !supabase || !supabaseKey || supabaseKey.includes('dummy')) return false;
  try {
    nextCheck = Date.now() + 30000;
    const { data, error } = await supabase.from('server_config').select('value').eq('key', KEY)
      .abortSignal(AbortSignal.timeout(10000)).maybeSingle();
    if (error) throw error;
    if (data) {
      const previous = JSON.parse(data.value);
      if (typeof previous.owner !== 'string' || !Number.isFinite(previous.expiresAt)) return false;
      if (previous.owner !== OWNER && previous.expiresAt > Date.now()) return false;
    }
    const until = Date.now() + TTL;
    const value = JSON.stringify({ owner: OWNER, expiresAt: until });
    const result = data
      ? await supabase.from('server_config').update({ value, updated_at: new Date().toISOString() })
        .eq('key', KEY).eq('value', data.value).select('key').abortSignal(AbortSignal.timeout(10000))
      : await supabase.from('server_config').insert({ key: KEY, value, updated_at: new Date().toISOString() })
        .select('key').abortSignal(AbortSignal.timeout(10000));
    if (result.error || !result.data?.length) return false;
    heldValue = value;
    expiresAt = until;
    return !stopped;
  } catch {
    console.warn('[Accounts] Connection lease unavailable; no competing account connection was started.');
    return false;
  }
}

function acquire(): Promise<boolean> {
  if (pending) return pending;
  pending = refreshLease().finally(() => { pending = null; });
  return pending;
}

function loseLease(): Promise<void> {
  if (losing) return losing;
  heldValue = null;
  expiresAt = 0;
  losing = lost().finally(() => { losing = null; });
  return losing;
}

export function ownsAccountLease(): boolean {
  return !!heldValue && expiresAt > Date.now();
}

export async function ensureAccountLease(): Promise<boolean> {
  if (stopped) return false;
  if (!timer) {
    timer = setInterval(async () => {
      if (ticking || stopped) return;
      ticking = true;
      try {
        if (heldValue && expiresAt <= Date.now()) {
          await loseLease();
        }
        const hadLease = !!heldValue;
        const ok = await acquire();
        if (stopped) return;
        if (!ok && hadLease) await loseLease();
        else if (ok && !hadLease) await acquired();
      } catch {
        console.warn('[Accounts] Account handoff failed; it will be retried on the next lease check.');
      } finally { ticking = false; }
    }, 30000);
    timer.unref();
  }
  if (losing) await losing;
  if (heldValue && expiresAt <= Date.now()) await loseLease();
  if (heldValue && expiresAt > Date.now() + 15000) return true;
  if (pending) return pending;
  if (!heldValue && Date.now() < nextCheck) return false;
  const hadLease = !!heldValue;
  const ok = await acquire();
  if (!ok && hadLease) await loseLease();
  return ok;
}

export function stopAccountLease(): void {
  stopped = true;
  if (timer) clearInterval(timer);
  timer = null;
}

export async function releaseAccountLease(): Promise<void> {
  stopAccountLease();
  if (pending) await pending;
  if (heldValue && supabase) {
    await supabase.from('server_config').delete().eq('key', KEY).eq('value', heldValue)
      .abortSignal(AbortSignal.timeout(5000));
  }
  heldValue = null;
  expiresAt = 0;
}
