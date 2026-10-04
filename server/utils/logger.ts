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

export function addLog(
  level: "info" | "success" | "warn" | "error",
  category: string,
  message: string,
  details?: any
): LogEntry {
  const entry: LogEntry = {
    id: `log_${Date.now()}_${++logCounter}`,
    timestamp: new Date().toISOString(),
    level,
    category,
    message,
    details: details ? (typeof details === "object" ? JSON.stringify(details) : String(details)) : undefined,
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
