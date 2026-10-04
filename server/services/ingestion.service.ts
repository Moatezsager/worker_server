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

// In-memory buffer of ingested messages
let memoryBuffer: IngestedMessageRecord[] = [];

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
      CREATE INDEX IF NOT EXISTS idx_ingested_messages_source ON ingested_messages(source);
    `);

    // Load recent from DB on startup
    const rows = db.prepare(`
      SELECT id, source, platform, timestamp, raw_text, status, extracted_rates, ignore_reason
      FROM ingested_messages
      ORDER BY rowid DESC
      LIMIT 50
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
 * Perform smart cleanup on memory buffer and SQLite database:
 * 1. Limits per-channel/source messages to maximum 4 newest records.
 * 2. Limits overall total records to 50 newest.
 */
function performSmartCleanup(): void {
  // Group by source and keep max 4 per source
  const sourceCounts: Record<string, number> = {};
  const cleanedBuffer: IngestedMessageRecord[] = [];

  for (const item of memoryBuffer) {
    const srcKey = item.source.toLowerCase().trim();
    sourceCounts[srcKey] = (sourceCounts[srcKey] || 0) + 1;
    if (sourceCounts[srcKey] <= 4) {
      cleanedBuffer.push(item);
    }
  }

  // Cap total buffer size to 50
  memoryBuffer = cleanedBuffer.slice(0, 50);

  // Perform per-channel cleanup in SQLite
  try {
    if (db) {
      // Delete old rows per source keeping max 4 per source
      const sources = db.prepare(`SELECT DISTINCT source FROM ingested_messages`).all() as { source: string }[];
      for (const s of sources) {
        db.prepare(`
          DELETE FROM ingested_messages 
          WHERE source = ? AND rowid NOT IN (
            SELECT rowid FROM ingested_messages WHERE source = ? ORDER BY rowid DESC LIMIT 4
          )
        `).run(s.source, s.source);
      }

      // Cap overall table to newest 50 rows
      db.prepare(`
        DELETE FROM ingested_messages WHERE rowid NOT IN (
          SELECT rowid FROM ingested_messages ORDER BY rowid DESC LIMIT 50
        )
      `).run();
    }
  } catch (err) {
    console.warn('[IngestionService] Smart cleanup error:', err);
  }
}

/**
 * Record a message ingested from Telegram, WhatsApp, or CBL website.
 * Prevents exact duplicates and enforces max 4 messages per channel/source.
 */
export function recordIngestion(entry: Omit<IngestedMessageRecord, 'id'>): IngestedMessageRecord {
  const normText = entry.rawText.trim();
  const normSource = entry.source.trim();

  // Deduplication check: if identical message exists from same source, update timestamp/status
  const existingIndex = memoryBuffer.findIndex(
    m => m.source.trim() === normSource && m.rawText.trim() === normText
  );

  if (existingIndex !== -1) {
    const existing = memoryBuffer[existingIndex];
    existing.timestamp = entry.timestamp || new Date().toISOString();
    existing.status = entry.status;
    existing.extractedRates = entry.extractedRates;
    existing.ignoreReason = entry.ignoreReason;

    // Move to front
    memoryBuffer.splice(existingIndex, 1);
    memoryBuffer.unshift(existing);

    // Update in SQLite
    try {
      if (db) {
        db.prepare(`
          UPDATE ingested_messages 
          SET timestamp = ?, status = ?, extracted_rates = ?, ignore_reason = ?
          WHERE id = ?
        `).run(
          existing.timestamp,
          existing.status,
          existing.extractedRates ? JSON.stringify(existing.extractedRates) : null,
          existing.ignoreReason || null,
          existing.id
        );
      }
    } catch {}

    performSmartCleanup();
    return existing;
  }

  const fullRecord: IngestedMessageRecord = {
    ...entry,
    id: `ingest_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
  };

  // Add to in-memory buffer at front
  memoryBuffer.unshift(fullRecord);

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
        fullRecord.ignoreReason || null,
        fullRecord.id
      );
    }
  } catch (err) {
    console.warn('[IngestionService] Failed to persist message log:', err);
  }

  // Execute smart auto-cleanup
  performSmartCleanup();

  return fullRecord;
}

/**
 * Get recent ingested messages.
 */
export function getRecentIngestedRecords(limit: number = 30): IngestedMessageRecord[] {
  return [...memoryBuffer]
    .sort((a, b) => {
      const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return timeB - timeA;
    })
    .slice(0, limit);
}
