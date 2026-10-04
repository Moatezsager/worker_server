import { db } from '../db';

export interface IngestedMessageRecord {
  id: string;
  source: string;
  platform: 'telegram' | 'whatsapp' | 'cbl';
  timestamp: string;
  rawText: string;
  status: 'extracted' | 'ignored';
  extractedRates?: { code: string; name?: string; value: number }[];
  ignoreReason?: string;
}

// In-memory buffer of latest 50 ingested messages
const memoryBuffer: IngestedMessageRecord[] = [];

// Initialize SQLite table for ingested messages
try {
  if (db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ingested_messages (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        platform TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        raw_text TEXT NOT NULL,
        status TEXT NOT NULL,
        extracted_rates TEXT,
        ignore_reason TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_ingested_messages_created ON ingested_messages(created_at);
    `);

    // Load recent 30 from DB on startup
    const rows = db.prepare(`
      SELECT id, source, platform, timestamp, raw_text, status, extracted_rates, ignore_reason
      FROM ingested_messages
      ORDER BY rowid DESC
      LIMIT 30
    `).all() as any[];

    for (const r of rows) {
      memoryBuffer.push({
        id: r.id,
        source: r.source,
        platform: r.platform,
        timestamp: r.timestamp,
        rawText: r.raw_text,
        status: r.status,
        extractedRates: r.extracted_rates ? JSON.parse(r.extracted_rates) : undefined,
        ignoreReason: r.ignore_reason || undefined
      });
    }
  }
} catch (e) {
  console.warn('[IngestionService] SQLite initialization warning:', e);
}

// Seed default initial message if empty
if (memoryBuffer.length === 0) {
  memoryBuffer.push({
    id: 'cbl_init_' + Date.now(),
    source: 'موقع مصرف ليبيا المركزي الرسمي (CBL)',
    platform: 'cbl',
    timestamp: new Date().toISOString(),
    rawText: 'النشرة الرسمية لأسعار صرف العملات الأجنبية مقابل الدينار الليبي (دولار أمريكي: 4.85 د.ل، يورو: 5.25 د.ل)',
    status: 'extracted',
    extractedRates: [
      { code: 'USD', name: 'الدولار الأمريكي', value: 4.85 },
      { code: 'EUR', name: 'اليورو الأوروبي', value: 5.25 }
    ]
  });
}

/**
 * Record a message ingested from Telegram, WhatsApp, or CBL website.
 */
export function recordIngestion(entry: Omit<IngestedMessageRecord, 'id'>): IngestedMessageRecord {
  const fullRecord: IngestedMessageRecord = {
    ...entry,
    id: `ingest_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
  };

  // Add to in-memory buffer at front
  memoryBuffer.unshift(fullRecord);
  if (memoryBuffer.length > 50) {
    memoryBuffer.pop();
  }

  // Persist to SQLite
  try {
    if (db) {
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO ingested_messages (id, source, platform, timestamp, raw_text, status, extracted_rates, ignore_reason)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        fullRecord.id,
        fullRecord.source,
        fullRecord.platform,
        fullRecord.timestamp,
        fullRecord.rawText,
        fullRecord.status,
        fullRecord.extractedRates ? JSON.stringify(fullRecord.extractedRates) : null,
        fullRecord.ignoreReason || null
      );

      // Keep only newest 100 rows in SQLite
      db.prepare(`
        DELETE FROM ingested_messages WHERE rowid NOT IN (
          SELECT rowid FROM ingested_messages ORDER BY rowid DESC LIMIT 100
        )
      `).run();
    }
  } catch (err) {
    console.warn('[IngestionService] Failed to persist message log:', err);
  }

  return fullRecord;
}

/**
 * Get recent ingested messages.
 */
export function getRecentIngestedRecords(limit: number = 30): IngestedMessageRecord[] {
  return memoryBuffer.slice(0, limit);
}
