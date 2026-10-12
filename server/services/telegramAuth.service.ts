import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions";
import { computeCheck } from "telegram/Password";
import { initializeTelegram } from "../../telegramClient";
import { addLog } from "../utils/logger";
import { getTelegramCredentials, saveTelegramSession } from './telegramSession.service';
import { ensureAccountLease } from './accountLease.service';

interface PendingLoginSession {
  client: TelegramClient;
  apiId: number;
  apiHash: string;
  phoneNumber: string;
  phoneCodeHash: string;
  createdAt: number;
}

let pendingSession: PendingLoginSession | null = null;
let sendingCode = false;
let verifyingLogin = false;
let completingLogin: Promise<void> | null = null;
let loginExpiry: NodeJS.Timeout | null = null;

async function withLoginVerification<T>(step: () => Promise<T>): Promise<T> {
  if (sendingCode || verifyingLogin || completingLogin) throw new Error('طلب تسجيل الدخول قيد التنفيذ. انتظر اكتماله.');
  verifyingLogin = true;
  try { return await step(); } finally { verifyingLogin = false; }
}

export async function closeTelegramLogin(): Promise<void> {
  if (loginExpiry) clearTimeout(loginExpiry);
  loginExpiry = null;
  const session = pendingSession;
  pendingSession = null;
  if (session) {
    try { await session.client.destroy(); } catch { await session.client.disconnect(); }
  }
}

// Helper functions to retrieve Telegram API credentials from environment or config
export const getEnvTelegramApiId = (): number => {
  return getTelegramCredentials().apiId || 0;
};

export const getEnvTelegramApiHash = (): string => {
  return getTelegramCredentials().apiHash;
};

/**
 * Step 1: Send Telegram authentication code (OTP) to phone number.
 */
export async function sendTelegramLoginCode(params: {
  apiId?: number;
  apiHash?: string;
  phoneNumber: string;
}): Promise<{ phoneCodeHash: string; isCodeViaApp: boolean }> {
  const apiId = Number(params.apiId) || getEnvTelegramApiId();
  const apiHash = (params.apiHash && params.apiHash.trim()) || getEnvTelegramApiHash();
  const phoneNumber = params.phoneNumber.trim().replace(/\s+/g, '');

  if (!apiId || !apiHash) {
    throw new Error("يرجى إدخال App api_id و App api_hash أو تعيينهما في متغيرات البيئة (TELEGRAM_API_ID و TELEGRAM_API_HASH)");
  }

  if (!phoneNumber) {
    throw new Error("رقم الهاتف مطلوب للاتصال بحساب تيليجرام");
  }
  if (sendingCode || verifyingLogin || completingLogin) throw new Error('طلب تسجيل الدخول قيد التنفيذ. انتظر اكتماله.');
  sendingCode = true;
  let client: TelegramClient | null = null;
  try {
    if (!await ensureAccountLease()) throw new Error('انتظر انتقال اتصال الحسابات إلى نسخة Worker الحالية ثم أعد المحاولة.');

    // Cleanup existing pending session if any
    await closeTelegramLogin();

    console.log(`[TelegramAuth] Connecting with apiId=${apiId} for phone ${phoneNumber}...`);
    addLog("info", "حساب تيليجرام", `بدء طلب كود التحقق لرقم الهاتف: ${phoneNumber}`);

    const stringSession = new StringSession("");
    client = new TelegramClient(stringSession, apiId, apiHash, {
      connectionRetries: 3,
      deviceModel: "LYD Indicator Hub",
      systemVersion: "Linux/Node",
      appVersion: "1.0.0",
    });

    pendingSession = { client, apiId, apiHash, phoneNumber, phoneCodeHash: '', createdAt: Date.now() };
    await client.connect();
    if (!pendingSession || !await ensureAccountLease()) throw new Error('توقفت محاولة الاتصال. أعد طلب الكود.');

    const sendResult = await client.sendCode(
      { apiId, apiHash },
      phoneNumber,
      false
    );
    if (pendingSession?.client !== client || !await ensureAccountLease()) throw new Error('توقفت محاولة الاتصال. أعد طلب الكود.');

    if (!sendResult || !sendResult.phoneCodeHash) {
      throw new Error("تعذر الحصول على phoneCodeHash من سيرفر تيليجرام");
    }

    pendingSession = {
      client,
      apiId,
      apiHash,
      phoneNumber,
      phoneCodeHash: sendResult.phoneCodeHash,
      createdAt: Date.now()
    };
    loginExpiry = setTimeout(() => {
      closeTelegramLogin().catch(() => console.warn('[TelegramAuth] Expired login connection cleanup failed.'));
    }, 10 * 60 * 1000);
    loginExpiry.unref();

    return {
      phoneCodeHash: sendResult.phoneCodeHash,
      isCodeViaApp: Boolean(sendResult.isCodeViaApp)
    };
  } catch (error) {
    if (pendingSession?.client === client) pendingSession = null;
    if (client) { try { await client.destroy(); } catch {} }
    throw error;
  } finally { sendingCode = false; }
}

/**
 * Step 2: Verify the received Telegram code.
 * If 2FA is required, returns requires2FA = true.
 */
export async function verifyTelegramLoginCode(phoneCode: string): Promise<{
  success: boolean;
  requires2FA: boolean;
  message: string;
  sessionString?: string;
}> {
  return withLoginVerification(async () => {
    const session = pendingSession;
    if (!session || !session.client) {
      throw new Error("لا توجد جلسة تسجيل دخول نشطة. يرجى طلب كود التحقق أولاً.");
    }

    // Session expiry check (10 minutes)
    if (Date.now() - session.createdAt > 10 * 60 * 1000) {
      await closeTelegramLogin();
      throw new Error("انتهت صلاحية جلسة تسجيل الدخول (أكثر من 10 دقائق). يرجى طلب كود جديد.");
    }

    const cleanCode = phoneCode.trim().replace(/\s+/g, '');
    if (!await ensureAccountLease()) throw new Error('اتصال الحسابات غير متاح في النسخة الحالية.');
    if (!cleanCode) {
      throw new Error("يرجى إدخال كود التحقق المستلم");
    }

    addLog("info", "حساب تيليجرام", `محاولة تأكيد كود التحقق للحساب [${session.phoneNumber}]`);
    if (pendingSession !== session) throw new Error('جلسة تسجيل الدخول تغيرت. أعد المحاولة.');

    try {
      if (!await session.client.checkAuthorization()) await session.client.invoke(
        new Api.auth.SignIn({
          phoneNumber: session.phoneNumber,
          phoneCodeHash: session.phoneCodeHash,
          phoneCode: cleanCode,
        })
      );

      // Direct success without 2FA
      const sessionString = session.client.session.save() as unknown as string;
      await completeTelegramLogin(session.apiId, session.apiHash, sessionString);

      return {
        success: true,
        requires2FA: false,
        message: "تم تسجيل الدخول بنجاح وحفظ جلسة تيليجرام السحابية الدائمة!",
        sessionString
      };
    } catch (error: any) {
      const errorMsg = error?.errorMessage || error?.message || String(error);

      // Check if account has 2FA enabled
      if (errorMsg === "SESSION_PASSWORD_NEEDED" || errorMsg.includes("SESSION_PASSWORD_NEEDED")) {
        console.log("[TelegramAuth] Account has Two-Step Verification (2FA) enabled. Awaiting password...");
        addLog("warn", "حساب تيليجرام", "الحساب محمي بكلمة مرور ثنائية (2FA) - بانتظار إدخال كلمة المرور");
        return {
          success: true,
          requires2FA: true,
          message: "حسابك محمي بالتحقق بخطوتين (2FA). يرجى إدخال كلمة المرور الثنائية لإتمام الربط."
        };
      }

      if (errorMsg.includes("PHONE_CODE_INVALID")) {
        throw new Error("كود التحقق غير صحيح. تأكد من إدخال الأرقام بشكل صحيح.");
      }
      if (errorMsg.includes("PHONE_CODE_EXPIRED")) {
        throw new Error("انتهت صلاحية كود التحقق. يرجى طلب كود جديد.");
      }

      throw new Error(`خطأ تيليجرام: ${errorMsg}`);
    }
  });
}

/**
 * Step 3: Verify Two-Factor Authentication (2FA) password.
 */
export async function verifyTelegram2FAPassword(password: string): Promise<{
  success: boolean;
  message: string;
  sessionString: string;
}> {
  return withLoginVerification(async () => {
    const session = pendingSession;
    if (!session || !session.client) {
      throw new Error("لا توجد جلسة تسجيل دخول نشطة. يرجى بدء تسجيل الدخول من جديد.");
    }

    const cleanPassword = password.trim();
    if (Date.now() - session.createdAt > 10 * 60 * 1000) {
      await closeTelegramLogin();
      throw new Error('انتهت صلاحية جلسة تسجيل الدخول. اطلب كودًا جديدًا.');
    }
    if (!await ensureAccountLease()) throw new Error('اتصال الحسابات غير متاح في النسخة الحالية.');
    if (!cleanPassword) {
      throw new Error("يرجى إدخال كلمة المرور الثنائية (2FA)");
    }

    addLog("info", "حساب تيليجرام", "التحقق من كلمة مرور الحساب الثنائية (2FA)...");
    if (pendingSession !== session) throw new Error('جلسة تسجيل الدخول تغيرت. أعد المحاولة.');

    try {
      if (!await session.client.checkAuthorization()) {
        const passwordSrpResult = await session.client.invoke(new Api.account.GetPassword());
        const passwordSrpCheck = await computeCheck(passwordSrpResult, cleanPassword);

        await session.client.invoke(
          new Api.auth.CheckPassword({
            password: passwordSrpCheck,
          })
        );
      }

      const sessionString = session.client.session.save() as unknown as string;
      await completeTelegramLogin(session.apiId, session.apiHash, sessionString);

      return {
        success: true,
        message: "تم التحقق من كلمة المرور الثنائية بنجاح وحفظ جلسة تيليجرام السحابية الدائمة!",
        sessionString
      };
    } catch (error: any) {
      const errorMsg = error?.errorMessage || error?.message || String(error);
      if (errorMsg.includes("PASSWORD_HASH_INVALID") || errorMsg.includes("SRP_ID_INVALID")) {
        throw new Error("كلمة المرور الثنائية غير صحيحة. يرجى إعادة المحاولة.");
      }
      throw new Error(`خطأ في التحقق من كلمة المرور: ${errorMsg}`);
    }
  });
}

/**
 * Finalize login in Worker-private storage, never the shared Web configuration.
 */
async function completeTelegramLogin(apiId: number, apiHash: string, sessionString: string): Promise<void> {
  if (completingLogin) return completingLogin;
  completingLogin = (async () => {
    if (!await ensureAccountLease()) throw new Error('توقف اتصال الحسابات قبل الحفظ. أعد تسجيل الدخول من النسخة الحالية.');
    await saveTelegramSession(apiId, apiHash, sessionString);
    // The OTP client uses this same auth key: close it before opening the runtime client.
    await closeTelegramLogin();
    addLog("success", "حساب تيليجرام", "تم حفظ جلسة تيليجرام في التخزين الخاص الدائم");
    await initializeTelegram();
  })().finally(() => { completingLogin = null; });
  return completingLogin;
}
