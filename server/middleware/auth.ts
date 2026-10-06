import express from 'express';
import crypto from 'crypto';
import { appConfig } from '../config';

export interface AdminSession {
  token: string;
  ip: string;
  userAgent: string;
  createdAt: number;
  lastActiveAt: number;
  expiresAt: number;
}

// In-memory active sessions store
export const activeSessions = new Map<string, AdminSession>();

// In-memory failed login tracking per IP
export interface LoginAttempt {
  attempts: number;
  firstAttemptAt: number;
  lockedUntil: number;
}
export const loginAttempts = new Map<string, LoginAttempt>();

// Max failed attempts before lockout
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 30 * 60 * 1000; // 30 minutes lockout
const ATTEMPTS_WINDOW_MS = 15 * 60 * 1000; // 15 minutes window
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours valid session

export let adminToken = crypto.randomBytes(32).toString('hex');
export let tokenCreatedAt = Date.now();

export function getAdminToken(): string {
  return adminToken;
}

export function setAdminToken(token: string): void {
  adminToken = token;
  tokenCreatedAt = Date.now();
}

/**
 * Cookie parser helper to extract cookies without extra dependencies
 */
export function parseCookies(cookieHeader?: string): Record<string, string> {
  const list: Record<string, string> = {};
  if (!cookieHeader || typeof cookieHeader !== 'string') return list;

  cookieHeader.split(';').forEach((cookie) => {
    const parts = cookie.split('=');
    if (parts.length >= 2) {
      const name = parts[0].trim();
      const val = parts.slice(1).join('=').trim();
      try {
        list[name] = decodeURIComponent(val);
      } catch {
        list[name] = val;
      }
    }
  });

  return list;
}

/**
 * Timing-safe string comparison using SHA-256 digests
 * Guaranteed constant-time comparison against timing attacks
 */
export function safeCompare(a?: string | null, b?: string | null): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) {
    return false;
  }
  try {
    const hashA = crypto.createHash('sha256').update(a).digest();
    const hashB = crypto.createHash('sha256').update(b).digest();
    return crypto.timingSafeEqual(hashA, hashB);
  } catch {
    return false;
  }
}

/**
 * Validates the admin master password against environment & config
 */
export function validateAdminPassword(candidate: string): boolean {
  if (!candidate || typeof candidate !== 'string') return false;
  const configuredPassword = (
    process.env.ADMIN_PASSWORD ||
    appConfig.adminPassword ||
    'Admin@Lyd2026!'
  ).trim();

  return safeCompare(candidate.trim(), configuredPassword);
}

/**
 * Checks if an IP is currently locked out from login attempts
 */
export function getIpLockoutStatus(ip: string): { isLocked: boolean; remainingSeconds: number; attemptsLeft: number } {
  const record = loginAttempts.get(ip);
  const now = Date.now();

  if (!record) {
    return { isLocked: false, remainingSeconds: 0, attemptsLeft: MAX_FAILED_ATTEMPTS };
  }

  if (record.lockedUntil > now) {
    return {
      isLocked: true,
      remainingSeconds: Math.ceil((record.lockedUntil - now) / 1000),
      attemptsLeft: 0
    };
  }

  // Reset if window has expired
  if (now - record.firstAttemptAt > ATTEMPTS_WINDOW_MS) {
    loginAttempts.delete(ip);
    return { isLocked: false, remainingSeconds: 0, attemptsLeft: MAX_FAILED_ATTEMPTS };
  }

  return {
    isLocked: false,
    remainingSeconds: 0,
    attemptsLeft: Math.max(0, MAX_FAILED_ATTEMPTS - record.attempts)
  };
}

/**
 * Records a failed login attempt for an IP
 */
export function recordFailedLogin(ip: string): { isLocked: boolean; remainingSeconds: number; attemptsLeft: number } {
  const now = Date.now();
  let record = loginAttempts.get(ip);

  if (!record || now - record.firstAttemptAt > ATTEMPTS_WINDOW_MS) {
    record = { attempts: 1, firstAttemptAt: now, lockedUntil: 0 };
  } else {
    record.attempts += 1;
  }

  if (record.attempts >= MAX_FAILED_ATTEMPTS) {
    record.lockedUntil = now + LOCKOUT_DURATION_MS;
    console.warn(`[SecurityAlert] 🛑 تم حظر الـ IP ${ip} لمدة 30 دقيقة بسبب تكرار ${record.attempts} محاولات دخول خاطئة.`);
  }

  loginAttempts.set(ip, record);
  return getIpLockoutStatus(ip);
}

/**
 * Clears failed login record on successful authentication
 */
export function clearFailedLogins(ip: string): void {
  loginAttempts.delete(ip);
}

/**
 * Creates a cryptographically signed admin session token
 */
export function createAdminSession(ip: string, userAgent: string): AdminSession {
  const randomBytes = crypto.randomBytes(48).toString('hex');
  const secretKey = process.env.API_HMAC_SECRET || process.env.WORKER_INTERNAL_SECRET || 'lyd-shield-master-key-2026';
  const signature = crypto.createHmac('sha256', secretKey).update(`${randomBytes}:${ip}`).digest('hex').substring(0, 16);
  const token = `${randomBytes}.${signature}`;

  const now = Date.now();
  const session: AdminSession = {
    token,
    ip,
    userAgent: (userAgent || 'unknown').substring(0, 150),
    createdAt: now,
    lastActiveAt: now,
    expiresAt: now + SESSION_TTL_MS
  };

  activeSessions.set(token, session);

  // Set global token for backwards compatibility
  adminToken = token;
  tokenCreatedAt = now;

  // Cleanup expired sessions periodically
  if (activeSessions.size > 100) {
    for (const [key, sess] of activeSessions.entries()) {
      if (sess.expiresAt < now) activeSessions.delete(key);
    }
  }

  return session;
}

/**
 * Verifies if a given token represents a valid, active session
 */
export function verifyAdminSession(token?: string | null): boolean {
  if (!token || typeof token !== 'string') return false;

  const cleanToken = token.trim();
  const session = activeSessions.get(cleanToken);
  if (!session) return false;

  const now = Date.now();
  if (now > session.expiresAt) {
    activeSessions.delete(cleanToken);
    return false;
  }

  // Sliding expiration: update last active
  session.lastActiveAt = now;
  return true;
}

/**
 * Extracts admin token from request (Bearer header, custom headers, cookies, or query)
 */
export function extractAdminToken(req: express.Request): string {
  // 1. Authorization header (Bearer)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const t = authHeader.slice(7).trim();
    if (t) return t;
  }

  // 2. Custom header
  const customHeader = req.headers['x-admin-token'] || req.headers['x-access-token'];
  if (customHeader && typeof customHeader === 'string' && customHeader.trim()) {
    return customHeader.trim();
  }

  // 3. Cookies
  const cookies = parseCookies(req.headers.cookie);
  if (cookies.lyd_admin_token) return cookies.lyd_admin_token.trim();
  if (cookies.admin_session) return cookies.admin_session.trim();
  if (cookies.admin_token) return cookies.admin_token.trim();

  // 4. Query param
  if (typeof req.query.token === 'string' && req.query.token.trim()) {
    return req.query.token.trim();
  }
  if (typeof req.query.admin_token === 'string' && req.query.admin_token.trim()) {
    return req.query.admin_token.trim();
  }

  return '';
}

/**
 * Verifies if the incoming HTTP request is authenticated as an Admin
 */
export function verifyAdminSessionFromReq(req: express.Request): boolean {
  const token = extractAdminToken(req);
  return verifyAdminSession(token);
}

/**
 * Destroys an active admin session
 */
export function revokeAdminSession(token?: string | null): void {
  if (token) {
    const cleanToken = token.trim();
    activeSessions.delete(cleanToken);
    if (safeCompare(cleanToken, adminToken)) {
      adminToken = crypto.randomBytes(32).toString('hex');
    }
  }
}

/**
 * Middleware: Requires a valid admin session or token for protected API endpoints
 */
export function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  const token = extractAdminToken(req);

  if (token && verifyAdminSession(token)) {
    return next();
  }

  res.status(401).json({
    success: false,
    error: "Unauthorized",
    code: "SESSION_EXPIRED",
    message: "جلسة العمل غير صالحة أو انتهت صلاحيتها. يرجى تسجيل الدخول مجدداً."
  });
}




