import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions";
import { computeCheck } from "telegram/Password";
import { appConfig, saveConfigToSupabase } from "../config";
import { initializeTelegram } from "../../telegramClient";
import { addLog } from "../utils/logger";

interface PendingLoginSession {
  client: TelegramClient;
  apiId: number;
  apiHash: string;
  phoneNumber: string;
  phoneCodeHash: string;
  createdAt: number;
}

let pendingSession: PendingLoginSession | null = null;

// Helper functions to retrieve Telegram API credentials from environment or config
export const getEnvTelegramApiId = (): number => {
  return Number(process.env.TELEGRAM_API_ID || process.env.VITE_TELEGRAM_API_ID || appConfig.telegramApiId) || 0;
};

export const getEnvTelegramApiHash = (): string => {
  return (process.env.TELEGRAM_API_HASH || process.env.VITE_TELEGRAM_API_HASH || appConfig.telegramApiHash || "").trim();
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

  // Cleanup existing pending session if any
  if (pendingSession?.client) {
    try {
      await pendingSession.client.disconnect();
    } catch (e) {}
    pendingSession = null;
  }

  console.log(`[TelegramAuth] Connecting with apiId=${apiId} for phone ${phoneNumber}...`);
  addLog("info", "حساب تيليجرام", `بدء طلب كود التحقق لرقم الهاتف: ${phoneNumber}`);

  const stringSession = new StringSession("");
  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 3,
    deviceModel: "LYD Indicator Hub",
    systemVersion: "Linux/Node",
    appVersion: "1.0.0",
  });

  await client.connect();

  const sendResult = await client.sendCode(
    { apiId, apiHash },
    phoneNumber,
    false
  );

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

  return {
    phoneCodeHash: sendResult.phoneCodeHash,
    isCodeViaApp: Boolean(sendResult.isCodeViaApp)
  };
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
  if (!pendingSession || !pendingSession.client) {
    throw new Error("لا توجد جلسة تسجيل دخول نشطة. يرجى طلب كود التحقق أولاً.");
  }

  // Session expiry check (10 minutes)
  if (Date.now() - pendingSession.createdAt > 10 * 60 * 1000) {
    try { await pendingSession.client.disconnect(); } catch (e) {}
    pendingSession = null;
    throw new Error("انتهت صلاحية جلسة تسجيل الدخول (أكثر من 10 دقائق). يرجى طلب كود جديد.");
  }

  const cleanCode = phoneCode.trim().replace(/\s+/g, '');
  if (!cleanCode) {
    throw new Error("يرجى إدخال كود التحقق المستلم");
  }

  addLog("info", "حساب تيليجرام", `محاولة تأكيد كود التحقق للحساب [${pendingSession.phoneNumber}]`);

  try {
    const result = await pendingSession.client.invoke(
      new Api.auth.SignIn({
        phoneNumber: pendingSession.phoneNumber,
        phoneCodeHash: pendingSession.phoneCodeHash,
        phoneCode: cleanCode,
      })
    );

    // Direct success without 2FA
    const sessionString = pendingSession.client.session.save() as unknown as string;
    await completeTelegramLogin(pendingSession.apiId, pendingSession.apiHash, sessionString);

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
}

/**
 * Step 3: Verify Two-Factor Authentication (2FA) password.
 */
export async function verifyTelegram2FAPassword(password: string): Promise<{
  success: boolean;
  message: string;
  sessionString: string;
}> {
  if (!pendingSession || !pendingSession.client) {
    throw new Error("لا توجد جلسة تسجيل دخول نشطة. يرجى بدء تسجيل الدخول من جديد.");
  }

  const cleanPassword = password.trim();
  if (!cleanPassword) {
    throw new Error("يرجى إدخال كلمة المرور الثنائية (2FA)");
  }

  addLog("info", "حساب تيليجرام", "التحقق من كلمة مرور الحساب الثنائية (2FA)...");

  try {
    const passwordSrpResult = await pendingSession.client.invoke(new Api.account.GetPassword());
    const passwordSrpCheck = await computeCheck(passwordSrpResult, cleanPassword);

    await pendingSession.client.invoke(
      new Api.auth.CheckPassword({
        password: passwordSrpCheck,
      })
    );

    const sessionString = pendingSession.client.session.save() as unknown as string;
    await completeTelegramLogin(pendingSession.apiId, pendingSession.apiHash, sessionString);

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
}

/**
 * Finalize login: persist session to appConfig, environment, Supabase, and connect active client.
 */
async function completeTelegramLogin(apiId: number, apiHash: string, sessionString: string): Promise<void> {
  appConfig.telegramApiId = apiId;
  appConfig.telegramApiHash = apiHash;
  appConfig.telegramSessionString = sessionString;

  process.env.TELEGRAM_API_ID = String(apiId);
  process.env.TELEGRAM_API_HASH = apiHash;
  process.env.TELEGRAM_SESSION = sessionString;

  await saveConfigToSupabase(appConfig);
  addLog("success", "حساب تيليجرام", "تم حفظ وتفعيل جلسة تيليجرام بنجاح ومزامنتها في السحابة");

  // Re-initialize active client
  try {
    await initializeTelegram();
  } catch (e) {
    console.warn("[TelegramAuth] Reconnect warning after login:", e);
  } finally {
    pendingSession = null;
  }
}
