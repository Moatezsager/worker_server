// ─── Circular In-Memory Log Buffer for Live Dashboard Stream ───

export interface LogEntry {
  id: string;
  timestamp: string;
  level: "info" | "success" | "warn" | "error";
  category: string;
  message: string;
  details?: any;
}

const MAX_LOGS = 200;
const logsBuffer: LogEntry[] = [];
let logCounter = 0;

export function sanitizeErrorMessage(rawError: any, limit = 500): string | null {
  if (!rawError) return null;
  let message = typeof rawError === 'string' ? rawError : (rawError.message || String(rawError));
  for (const [key, value] of Object.entries(process.env)) {
    if (/(PASSWORD|SECRET|TOKEN|SESSION|PRIVATE|SERVICE_ROLE|ANON_KEY|API_KEY|API_HASH|FOREX_KEY)/i.test(key) && value && value.length > 4) {
      message = message.split(value).join('[REDACTED]');
    }
  }
  message = message.replace(/EAA[a-zA-Z0-9_-]{20,}/g, '[REDACTED_FB_TOKEN]')
    .replace(/\d{8,12}:[a-zA-Z0-9_-]{30,}/g, '[REDACTED_TG_TOKEN]')
    .replace(/1[a-zA-Z0-9+/=]{50,}/g, '[REDACTED_SESSION]')
    .replace(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, '[REDACTED_JWT]')
    .replace(/Bearer\s+[^\s"',}]+/gi, 'Bearer [REDACTED]')
    .replace(/((?:access_token|x-worker-secret|token|secret|password|session(?:String)?|apiHash)["']?\s*[=:]\s*["']?)[^&\s"',}]+/gi, '$1[REDACTED]');
  return message.length > limit ? message.slice(0, limit - 3) + '...' : message;
}

export function addLog(
  level: "info" | "success" | "warn" | "error",
  category: string,
  message: string,
  details?: any
): LogEntry {
  let safeDetails: string | undefined;
  if (details !== undefined) {
    try {
      const seen = new WeakSet<object>();
      const serialized = typeof details === 'object' ? JSON.stringify(details, (key, value) => {
        if (/(password|secret|token|session|api.?hash|api.?key|authorization|cookie)/i.test(key)) return '[REDACTED]';
        if (value && typeof value === 'object') {
          if (seen.has(value)) return '[Circular]';
          seen.add(value);
          if (value instanceof Error || Object.prototype.toString.call(value) === '[object Error]') return { name: value.name, message: value.message, stack: value.stack, code: (value as any).code, cause: value.cause };
        }
        return value;
      }) : String(details);
      safeDetails = sanitizeErrorMessage(serialized, 8000) || undefined;
    } catch { safeDetails = '[Details could not be serialized]'; }
  }
  const entry: LogEntry = {
    id: `log_${Date.now()}_${++logCounter}`,
    timestamp: new Date().toISOString(),
    level,
    category: sanitizeErrorMessage(category, 120) || '',
    message: sanitizeErrorMessage(message, 2000) || '',
    details: safeDetails,
  };

  logsBuffer.unshift(entry);
  if (logsBuffer.length > MAX_LOGS) {
    logsBuffer.pop();
  }

  return entry;
}

export function getRecentLogs(limit = 100, filterLevel?: string): LogEntry[] {
  if (filterLevel && filterLevel !== "all") {
    return logsBuffer.filter((l) => l.level === filterLevel).slice(0, limit);
  }
  return logsBuffer.slice(0, limit);
}

export function clearLogs(): void {
  logsBuffer.length = 0;
}

// Helper to log initial boot entries
addLog("info", "النظام", "تم تشغيل وحدة السجلات الحية للوحة التحكم");
