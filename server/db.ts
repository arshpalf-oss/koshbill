import initSqlJs, { Database as SqlJsRawDb } from 'sql.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatMongoError,
  getMongoDatabase,
  isCloudDeploymentEnvironment,
  isMongoConfigured,
} from './mongo.js';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveLocalDbPath(): string {
  const preferredDir = path.resolve(process.cwd(), 'data');
  try {
    if (!fs.existsSync(preferredDir)) {
      fs.mkdirSync(preferredDir, { recursive: true });
    }
    return path.join(preferredDir, 'koshbill.sqlite');
  } catch {
    const fallbackDir = path.join(os.tmpdir(), 'koshbill-data');
    if (!fs.existsSync(fallbackDir)) {
      fs.mkdirSync(fallbackDir, { recursive: true });
    }
    return path.join(fallbackDir, 'koshbill.sqlite');
  }
}

function resolveSqlWasmPath(): string {
  const candidates = [
    () => require.resolve('sql.js/dist/sql-wasm.wasm'),
    () => path.resolve(process.cwd(), 'node_modules/sql.js/dist/sql-wasm.wasm'),
    () => path.resolve(__dirname, '../node_modules/sql.js/dist/sql-wasm.wasm'),
  ];
  for (const getPath of candidates) {
    try {
      const p = getPath();
      if (p && fs.existsSync(p)) return p;
    } catch {
      // try next candidate
    }
  }
  return require.resolve('sql.js/dist/sql-wasm.wasm');
}

const SYNCED_TABLES = [
  { name: 'organizations', pk: 'id' },
  { name: 'users', pk: 'id' },
  { name: 'sessions', pk: 'token' },
  { name: 'hsn_codes', pk: 'id' },
  { name: 'products', pk: 'id' },
  { name: 'customers', pk: 'id' },
  { name: 'suppliers', pk: 'id' },
  { name: 'purchases', pk: 'id' },
  { name: 'batches', pk: 'id' },
  { name: 'purchase_items', pk: 'id' },
  { name: 'invoices', pk: 'id' },
  { name: 'invoice_items', pk: 'id' },
  { name: 'invoice_item_batches', pk: 'id' },
  { name: 'stock_movements', pk: 'id' },
  { name: 'ledger_entries', pk: 'id' },
] as const;

export interface PreparedStatementCompat {
  get: (...params: any[]) => any;
  all: (...params: any[]) => any[];
  run: (...params: any[]) => { changes: number; lastInsertRowid: number };
}

function normalizeParams(params: any[]): any[] {
  return params.map((v) => {
    if (v === undefined) return null;
    if (typeof v === 'boolean') return v ? 1 : 0;
    return v;
  });
}

/**
 * Cloud-Ready Hybrid Relational + MongoDB Atlas Persistence Engine:
 * - When `MONGODB_URI` is configured, all 15 ERP tables are persisted as clean,
 *   human-readable documents in 15 MongoDB collections (`organizations`, `users`,
 *   `products`, `batches`, `invoices`, `purchases`, `ledger_entries`, etc.) with
 *   row-level bulkWrite diffs and multi-instance revision synchronization.
 * - When running locally without `MONGODB_URI`, falls back seamlessly to `data/koshbill.sqlite`.
 */
class CloudCompatDatabase {
  private rawDb: SqlJsRawDb | null = null;
  private txDepth = 0;
  private initPromise: Promise<void> | null = null;
  private schemaReady = false;

  // MongoDB synchronization state
  private hasDirtyMutations = false;
  private localRevision = 0;
  private lastSyncCheckAt = 0;
  private initialMongoHydrated = false;
  private tableSnapshots = new Map<string, Map<string | number, string>>();

  async init(): Promise<void> {
    if (this.rawDb) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      const wasmPath = resolveSqlWasmPath();
      const SQL = await initSqlJs({
        locateFile: () => wasmPath,
      });

      const useDiskFile = !isMongoConfigured() && !isCloudDeploymentEnvironment();
      if (useDiskFile) {
        const dbPath = resolveLocalDbPath();
        if (fs.existsSync(dbPath)) {
          const existingBytes = fs.readFileSync(dbPath);
          this.rawDb =
            existingBytes.length > 0 ? new SQL.Database(existingBytes) : new SQL.Database();
        } else {
          this.rawDb = new SQL.Database();
        }
      } else {
        this.rawDb = new SQL.Database();
      }

      this.rawDb.exec('PRAGMA foreign_keys = ON;');
    })();

    await this.initPromise;
  }

  private ensureReady(): SqlJsRawDb {
    if (!this.rawDb) {
      throw new Error('Database engine not initialized yet — call await initSchema() first.');
    }
    return this.rawDb;
  }

  private persistLocalFallbackIfNeeded(): void {
    if (!this.rawDb) return;
    if (isMongoConfigured()) {
      if (this.schemaReady) {
        this.hasDirtyMutations = true;
      }
      return;
    }
    if (isCloudDeploymentEnvironment()) {
      return;
    }

    const dbPath = resolveLocalDbPath();
    const bytes = Buffer.from(this.rawDb.export());
    const tmpPath = `${dbPath}.tmp`;
    try {
      fs.writeFileSync(tmpPath, bytes);
      fs.renameSync(tmpPath, dbPath);
    } catch {
      fs.writeFileSync(dbPath, bytes);
      try {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      } catch {
        // ignore cleanup error
      }
    }
  }

  private readAllRowsRaw(tableName: string): Record<string, any>[] {
    const raw = this.ensureReady();
    const stmt = raw.prepare(`SELECT * FROM ${tableName}`);
    const rows: Record<string, any>[] = [];
    try {
      while (stmt.step()) {
        rows.push(stmt.getAsObject());
      }
    } finally {
      stmt.free();
    }
    return rows;
  }

  private captureSnapshotsFromMemory(): void {
    this.tableSnapshots.clear();
    for (const tbl of SYNCED_TABLES) {
      const rows = this.readAllRowsRaw(tbl.name);
      const rowMap = new Map<string | number, string>();
      for (const row of rows) {
        const pkVal = row[tbl.pk];
        if (pkVal !== undefined && pkVal !== null) {
          rowMap.set(pkVal, JSON.stringify(row));
        }
      }
      this.tableSnapshots.set(tbl.name, rowMap);
    }
  }

  async hydrateFromMongo(): Promise<void> {
    if (!isMongoConfigured()) return;
    const raw = this.ensureReady();
    const mongoDb = await getMongoDatabase();

    const [metaDoc, ...collectionsDocs] = await Promise.all([
      mongoDb
        .collection<{
          _id: string;
          revision?: number;
          sqlite_sequences?: Record<string, number>;
        }>('_engine_meta')
        .findOne({ _id: 'sync_state' }),
      ...SYNCED_TABLES.map((tbl) => mongoDb.collection(tbl.name).find({}).toArray()),
    ]);

    const savedSequences = metaDoc?.sqlite_sequences || {};

    raw.exec('PRAGMA foreign_keys = OFF;');
    raw.exec('BEGIN TRANSACTION;');
    try {
      // Clear tables in reverse dependency order
      for (let i = SYNCED_TABLES.length - 1; i >= 0; i--) {
        raw.exec(`DELETE FROM ${SYNCED_TABLES[i].name};`);
      }
      try {
        raw.exec('DELETE FROM sqlite_sequence;');
      } catch {
        // sqlite_sequence may not exist until first AUTOINCREMENT insert
      }

      // Insert documents in topological parent -> child order
      for (let i = 0; i < SYNCED_TABLES.length; i++) {
        const tbl = SYNCED_TABLES[i];
        const docs = collectionsDocs[i] || [];

        const colStmt = raw.prepare(`PRAGMA table_info(${tbl.name})`);
        const validCols: string[] = [];
        try {
          while (colStmt.step()) {
            const info = colStmt.getAsObject() as { name: string };
            validCols.push(info.name);
          }
        } finally {
          colStmt.free();
        }

        let maxNumericId = 0;

        if (docs.length > 0 && validCols.length > 0) {
          const placeholders = validCols.map(() => '?').join(', ');
          const insertSql = `INSERT INTO ${tbl.name} (${validCols.join(', ')}) VALUES (${placeholders})`;
          const insertStmt = raw.prepare(insertSql);
          try {
            for (const doc of docs) {
              const record = doc as Record<string, any>;
              const values = validCols.map((col) => {
                if (col === tbl.pk && record[col] === undefined && record._id !== undefined) {
                  return record._id;
                }
                const v = record[col];
                if (v === undefined) return null;
                if (typeof v === 'boolean') return v ? 1 : 0;
                return v;
              });
              insertStmt.bind(values);
              insertStmt.step();
              insertStmt.reset();
              if (tbl.pk === 'id') {
                const numericId = Number(record.id ?? record._id ?? 0);
                if (numericId > maxNumericId) maxNumericId = numericId;
              }
            }
          } finally {
            insertStmt.free();
          }
        }

        if (tbl.pk === 'id') {
          const targetSeq = Math.max(maxNumericId, Number(savedSequences[tbl.name] || 0));
          if (targetSeq > 0) {
            try {
              const seqStmt = raw.prepare(
                'INSERT OR REPLACE INTO sqlite_sequence (name, seq) VALUES (?, ?)'
              );
              try {
                seqStmt.bind([tbl.name, targetSeq]);
                seqStmt.step();
              } finally {
                seqStmt.free();
              }
            } catch {
              // ignore if sqlite_sequence is not initialized yet
            }
          }
        }
      }

      raw.exec('COMMIT;');
    } catch (err) {
      try {
        raw.exec('ROLLBACK;');
      } catch {
        // ignore rollback error
      }
      throw new Error(formatMongoError(err));
    } finally {
      raw.exec('PRAGMA foreign_keys = ON;');
    }

    this.captureSnapshotsFromMemory();
    this.localRevision = Number(metaDoc?.revision || 0);
    this.hasDirtyMutations = false;
    this.initialMongoHydrated = true;
    this.lastSyncCheckAt = Date.now();
  }

  async ensureSyncedFromMongo(forceCheck = false): Promise<void> {
    if (!isMongoConfigured()) return;

    if (!this.initialMongoHydrated) {
      await this.hydrateFromMongo();
      return;
    }

    // Always verify on serverless or forced write lock; throttle to 250ms on persistent servers
    const isServerless = Boolean(process.env.VERCEL);
    if (!forceCheck && !isServerless && Date.now() - this.lastSyncCheckAt < 250) {
      return;
    }

    const mongoDb = await getMongoDatabase();
    const metaDoc = await mongoDb
      .collection<{ _id: string; revision?: number }>('_engine_meta')
      .findOne({ _id: 'sync_state' }, { projection: { revision: 1 } });

    this.lastSyncCheckAt = Date.now();
    const remoteRevision = Number(metaDoc?.revision || 0);

    if (remoteRevision !== this.localRevision) {
      await this.hydrateFromMongo();
    }
  }

  hasPendingMongoSync(): boolean {
    return isMongoConfigured() && this.hasDirtyMutations;
  }

  async flushToMongo(): Promise<void> {
    if (!isMongoConfigured() || !this.hasDirtyMutations) return;

    const raw = this.ensureReady();
    const mongoDb = await getMongoDatabase();

    const writePromises: Promise<any>[] = [];
    const nextSnapshots = new Map<string, Map<string | number, string>>();

    for (const tbl of SYNCED_TABLES) {
      const currentRows = this.readAllRowsRaw(tbl.name);
      const prevMap = this.tableSnapshots.get(tbl.name) || new Map<string | number, string>();
      const nextMap = new Map<string | number, string>();
      const ops: any[] = [];

      for (const row of currentRows) {
        const pkVal = row[tbl.pk];
        if (pkVal === undefined || pkVal === null) continue;
        const serialized = JSON.stringify(row);
        nextMap.set(pkVal, serialized);

        if (prevMap.get(pkVal) !== serialized) {
          ops.push({
            replaceOne: {
              filter: { _id: pkVal },
              replacement: { _id: pkVal, ...row },
              upsert: true,
            },
          });
        }
      }

      for (const oldPk of prevMap.keys()) {
        if (!nextMap.has(oldPk)) {
          ops.push({
            deleteOne: {
              filter: { _id: oldPk },
            },
          });
        }
      }

      nextSnapshots.set(tbl.name, nextMap);

      if (ops.length > 0) {
        writePromises.push(
          mongoDb.collection<any>(tbl.name).bulkWrite(ops, { ordered: false })
        );
      }
    }

    if (writePromises.length > 0) {
      await Promise.all(writePromises);
    }

    // Persist sqlite_sequence counters & bump revision atomically
    const sqliteSequences: Record<string, number> = {};
    try {
      const seqRes = raw.exec('SELECT name, seq FROM sqlite_sequence');
      if (seqRes?.[0]?.values) {
        for (const [name, seq] of seqRes[0].values) {
          if (typeof name === 'string') {
            sqliteSequences[name] = Number(seq || 0);
          }
        }
      }
    } catch {
      // ignore if sqlite_sequence doesn't exist yet
    }

    const updatedMeta = await mongoDb
      .collection<{ _id: string; revision: number }>('_engine_meta')
      .findOneAndUpdate(
        { _id: 'sync_state' },
        {
          $inc: { revision: 1 },
          $set: {
            sqlite_sequences: sqliteSequences,
            updated_at: new Date().toISOString(),
          },
        },
        { upsert: true, returnDocument: 'after' }
      );

    this.tableSnapshots = nextSnapshots;
    this.localRevision = Number(updatedMeta?.revision || this.localRevision + 1);
    this.hasDirtyMutations = false;
    this.lastSyncCheckAt = Date.now();
  }

  pragma(expr: string): void {
    const raw = this.ensureReady();
    if (/journal_mode/i.test(expr)) return;
    raw.exec(`PRAGMA ${expr};`);
  }

  exec(sql: string, persist = true): void {
    const raw = this.ensureReady();
    raw.exec(sql);
    if (persist && this.txDepth === 0) {
      this.persistLocalFallbackIfNeeded();
    }
  }

  prepare(sql: string): PreparedStatementCompat {
    return {
      get: (...params: any[]) => {
        const raw = this.ensureReady();
        const stmt = raw.prepare(sql);
        try {
          const bound = normalizeParams(params);
          if (bound.length > 0) stmt.bind(bound);
          if (stmt.step()) {
            return stmt.getAsObject();
          }
          return undefined;
        } finally {
          stmt.free();
        }
      },

      all: (...params: any[]) => {
        const raw = this.ensureReady();
        const stmt = raw.prepare(sql);
        try {
          const bound = normalizeParams(params);
          if (bound.length > 0) stmt.bind(bound);
          const rows: any[] = [];
          while (stmt.step()) {
            rows.push(stmt.getAsObject());
          }
          return rows;
        } finally {
          stmt.free();
        }
      },

      run: (...params: any[]) => {
        const raw = this.ensureReady();
        const stmt = raw.prepare(sql);
        try {
          const bound = normalizeParams(params);
          if (bound.length > 0) stmt.bind(bound);
          stmt.step();
        } finally {
          stmt.free();
        }
        const changes = raw.getRowsModified();
        const idRes = raw.exec('SELECT last_insert_rowid()');
        const lastInsertRowid = Number(idRes?.[0]?.values?.[0]?.[0] ?? 0);

        if (this.txDepth === 0) {
          this.persistLocalFallbackIfNeeded();
        }
        return { changes, lastInsertRowid };
      },
    };
  }

  transaction<T extends (...args: any[]) => any>(fn: T): T {
    const wrapped = ((...args: any[]) => {
      const raw = this.ensureReady();
      const savepoint = `sp_${this.txDepth}`;
      if (this.txDepth === 0) {
        raw.exec('BEGIN TRANSACTION');
      } else {
        raw.exec(`SAVEPOINT ${savepoint}`);
      }
      this.txDepth += 1;

      try {
        const result = fn(...args);
        this.txDepth -= 1;
        if (this.txDepth === 0) {
          raw.exec('COMMIT');
          this.persistLocalFallbackIfNeeded();
        } else {
          raw.exec(`RELEASE SAVEPOINT ${savepoint}`);
        }
        return result;
      } catch (err) {
        this.txDepth -= 1;
        try {
          if (this.txDepth === 0) {
            raw.exec('ROLLBACK');
          } else {
            raw.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
            raw.exec(`RELEASE SAVEPOINT ${savepoint}`);
          }
        } catch {
          // ignore rollback error
        }
        throw err;
      }
    }) as T;

    return wrapped;
  }

  markSchemaInitialized(): void {
    this.schemaReady = true;
  }

  close(): void {
    if (this.rawDb) {
      this.persistLocalFallbackIfNeeded();
      this.rawDb.close();
      this.rawDb = null;
      this.initPromise = null;
      this.schemaReady = false;
      this.initialMongoHydrated = false;
    }
  }
}

export const db = new CloudCompatDatabase();

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, key] = stored.split(':');
  if (!salt || !key) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(key, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

export function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export async function initSchema() {
  await db.init();
  db.pragma('foreign_keys = ON');
  db.exec(
    `
    CREATE TABLE IF NOT EXISTS organizations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_name TEXT NOT NULL,
      legal_name TEXT DEFAULT '',
      tagline TEXT DEFAULT '',
      gst_enabled INTEGER NOT NULL DEFAULT 1,
      gstin TEXT DEFAULT '',
      pan TEXT DEFAULT '',
      state_name TEXT NOT NULL DEFAULT 'Uttar Pradesh',
      state_code TEXT NOT NULL DEFAULT '09',
      address TEXT DEFAULT '',
      city TEXT DEFAULT '',
      pincode TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      email TEXT DEFAULT '',
      upi_id TEXT NOT NULL DEFAULT '',
      upi_payee_name TEXT DEFAULT '',
      bank_name TEXT DEFAULT '',
      bank_account_no TEXT DEFAULT '',
      bank_ifsc TEXT DEFAULT '',
      bank_branch TEXT DEFAULT '',
      invoice_prefix TEXT NOT NULL DEFAULT 'INV',
      non_gst_prefix TEXT NOT NULL DEFAULT 'BOS',
      purchase_prefix TEXT NOT NULL DEFAULT 'PUR',
      default_tax_inclusive INTEGER NOT NULL DEFAULT 0,
      terms_and_conditions TEXT DEFAULT '1. Goods once sold will not be taken back without original bill.\n2. Check batch & expiry details at the time of delivery.\n3. Subject to local jurisdiction.',
      currency_symbol TEXT NOT NULL DEFAULT '₹',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'ADMIN',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS hsn_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      description TEXT NOT NULL,
      gst_rate REAL NOT NULL DEFAULT 18,
      cess_rate REAL NOT NULL DEFAULT 0,
      category TEXT NOT NULL DEFAULT 'GOODS',
      UNIQUE(org_id, code)
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      sku TEXT NOT NULL,
      barcode TEXT DEFAULT '',
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'General',
      unit TEXT NOT NULL DEFAULT 'PCS',
      hsn_code TEXT DEFAULT '',
      gst_rate REAL NOT NULL DEFAULT 0,
      default_cost_price REAL NOT NULL DEFAULT 0,
      default_selling_price REAL NOT NULL DEFAULT 0,
      default_mrp REAL NOT NULL DEFAULT 0,
      default_bv REAL NOT NULL DEFAULT 0,
      reorder_level REAL NOT NULL DEFAULT 10,
      track_expiry INTEGER NOT NULL DEFAULT 1,
      description TEXT DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      UNIQUE(org_id, sku)
    );

    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      customer_type TEXT NOT NULL DEFAULT 'B2C',
      phone TEXT DEFAULT '',
      email TEXT DEFAULT '',
      gstin TEXT DEFAULT '',
      state_name TEXT NOT NULL DEFAULT 'Uttar Pradesh',
      state_code TEXT NOT NULL DEFAULT '09',
      address TEXT DEFAULT '',
      credit_limit REAL NOT NULL DEFAULT 25000,
      opening_balance REAL NOT NULL DEFAULT 0,
      current_balance REAL NOT NULL DEFAULT 0,
      opening_bv REAL NOT NULL DEFAULT 0,
      notes TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      contact_person TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      email TEXT DEFAULT '',
      gstin TEXT DEFAULT '',
      state_name TEXT NOT NULL DEFAULT 'Uttar Pradesh',
      state_code TEXT NOT NULL DEFAULT '09',
      address TEXT DEFAULT '',
      upi_id TEXT DEFAULT '',
      bank_details TEXT DEFAULT '',
      opening_balance REAL NOT NULL DEFAULT 0,
      current_balance REAL NOT NULL DEFAULT 0,
      notes TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      purchase_number TEXT NOT NULL,
      supplier_invoice_no TEXT DEFAULT '',
      supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
      purchase_date TEXT NOT NULL,
      due_date TEXT DEFAULT '',
      is_gst INTEGER NOT NULL DEFAULT 1,
      supply_type TEXT NOT NULL DEFAULT 'INTRA',
      subtotal REAL NOT NULL DEFAULT 0,
      discount_amount REAL NOT NULL DEFAULT 0,
      taxable_amount REAL NOT NULL DEFAULT 0,
      cgst_amount REAL NOT NULL DEFAULT 0,
      sgst_amount REAL NOT NULL DEFAULT 0,
      igst_amount REAL NOT NULL DEFAULT 0,
      total_tax REAL NOT NULL DEFAULT 0,
      grand_total REAL NOT NULL DEFAULT 0,
      amount_paid REAL NOT NULL DEFAULT 0,
      balance_due REAL NOT NULL DEFAULT 0,
      payment_status TEXT NOT NULL DEFAULT 'UNPAID',
      payment_mode TEXT DEFAULT 'CREDIT',
      payment_ref TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      notes TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      batch_number TEXT NOT NULL,
      mfg_date TEXT DEFAULT '',
      expiry_date TEXT DEFAULT '',
      received_date TEXT NOT NULL,
      purchase_id INTEGER REFERENCES purchases(id) ON DELETE SET NULL,
      supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
      cost_price REAL NOT NULL DEFAULT 0,
      mrp REAL NOT NULL DEFAULT 0,
      selling_price REAL NOT NULL DEFAULT 0,
      initial_qty REAL NOT NULL DEFAULT 0,
      remaining_qty REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      notes TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS purchase_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      batch_id INTEGER REFERENCES batches(id),
      batch_number TEXT NOT NULL,
      mfg_date TEXT DEFAULT '',
      expiry_date TEXT DEFAULT '',
      hsn_code TEXT DEFAULT '',
      quantity REAL NOT NULL,
      free_qty REAL NOT NULL DEFAULT 0,
      cost_price REAL NOT NULL,
      mrp REAL NOT NULL DEFAULT 0,
      selling_price REAL NOT NULL DEFAULT 0,
      discount_amount REAL NOT NULL DEFAULT 0,
      taxable_amount REAL NOT NULL DEFAULT 0,
      gst_rate REAL NOT NULL DEFAULT 0,
      cgst_amount REAL NOT NULL DEFAULT 0,
      sgst_amount REAL NOT NULL DEFAULT 0,
      igst_amount REAL NOT NULL DEFAULT 0,
      line_total REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      invoice_number TEXT NOT NULL,
      invoice_type TEXT NOT NULL DEFAULT 'TAX_INVOICE',
      is_gst INTEGER NOT NULL DEFAULT 1,
      tax_inclusive INTEGER NOT NULL DEFAULT 0,
      supply_type TEXT NOT NULL DEFAULT 'INTRA',
      customer_id INTEGER REFERENCES customers(id),
      customer_name TEXT NOT NULL DEFAULT 'Walk-in Consumer',
      customer_phone TEXT DEFAULT '',
      customer_gstin TEXT DEFAULT '',
      customer_address TEXT DEFAULT '',
      place_of_supply TEXT NOT NULL DEFAULT 'Uttar Pradesh (09)',
      invoice_date TEXT NOT NULL,
      due_date TEXT DEFAULT '',
      subtotal REAL NOT NULL DEFAULT 0,
      item_discount_total REAL NOT NULL DEFAULT 0,
      bill_discount REAL NOT NULL DEFAULT 0,
      taxable_amount REAL NOT NULL DEFAULT 0,
      cgst_amount REAL NOT NULL DEFAULT 0,
      sgst_amount REAL NOT NULL DEFAULT 0,
      igst_amount REAL NOT NULL DEFAULT 0,
      total_tax REAL NOT NULL DEFAULT 0,
      round_off REAL NOT NULL DEFAULT 0,
      grand_total REAL NOT NULL DEFAULT 0,
      total_fifo_cost REAL NOT NULL DEFAULT 0,
      total_bv REAL NOT NULL DEFAULT 0,
      show_bv_on_bill INTEGER NOT NULL DEFAULT 0,
      amount_paid REAL NOT NULL DEFAULT 0,
      balance_due REAL NOT NULL DEFAULT 0,
      payment_status TEXT NOT NULL DEFAULT 'PAID',
      payment_mode TEXT NOT NULL DEFAULT 'UPI_QR',
      payment_ref TEXT DEFAULT '',
      upi_uri TEXT DEFAULT '',
      qr_confirmed_at TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'ISSUED',
      notes TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS invoice_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      product_name TEXT NOT NULL,
      sku TEXT NOT NULL,
      unit TEXT NOT NULL,
      hsn_code TEXT DEFAULT '',
      quantity REAL NOT NULL,
      mrp REAL NOT NULL DEFAULT 0,
      unit_price REAL NOT NULL,
      discount_percent REAL NOT NULL DEFAULT 0,
      discount_amount REAL NOT NULL DEFAULT 0,
      taxable_amount REAL NOT NULL DEFAULT 0,
      gst_rate REAL NOT NULL DEFAULT 0,
      cgst_amount REAL NOT NULL DEFAULT 0,
      sgst_amount REAL NOT NULL DEFAULT 0,
      igst_amount REAL NOT NULL DEFAULT 0,
      line_total REAL NOT NULL DEFAULT 0,
      fifo_cost_total REAL NOT NULL DEFAULT 0,
      bv_per_unit REAL NOT NULL DEFAULT 0,
      bv_included INTEGER NOT NULL DEFAULT 1,
      line_bv_total REAL NOT NULL DEFAULT 0,
      batch_summary TEXT DEFAULT '',
      expiry_summary TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS invoice_item_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_item_id INTEGER NOT NULL REFERENCES invoice_items(id) ON DELETE CASCADE,
      invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      batch_id INTEGER NOT NULL REFERENCES batches(id),
      batch_number TEXT NOT NULL,
      expiry_date TEXT DEFAULT '',
      quantity REAL NOT NULL,
      cost_price REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stock_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      batch_id INTEGER REFERENCES batches(id) ON DELETE SET NULL,
      batch_number TEXT DEFAULT '',
      movement_type TEXT NOT NULL,
      quantity_change REAL NOT NULL,
      balance_after REAL NOT NULL,
      unit_cost REAL NOT NULL DEFAULT 0,
      reference_type TEXT DEFAULT '',
      reference_id INTEGER,
      reference_no TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ledger_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      party_type TEXT NOT NULL,
      party_id INTEGER NOT NULL,
      entry_date TEXT NOT NULL,
      entry_type TEXT NOT NULL,
      voucher_no TEXT NOT NULL,
      reference_id INTEGER,
      debit REAL NOT NULL DEFAULT 0,
      credit REAL NOT NULL DEFAULT 0,
      balance_after REAL NOT NULL DEFAULT 0,
      payment_mode TEXT DEFAULT '',
      payment_ref TEXT DEFAULT '',
      narration TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_products_org ON products(org_id);
    CREATE INDEX IF NOT EXISTS idx_batches_product_fifo ON batches(org_id, product_id, received_date, id);
    CREATE INDEX IF NOT EXISTS idx_invoices_org_date ON invoices(org_id, invoice_date);
    CREATE INDEX IF NOT EXISTS idx_purchases_org_date ON purchases(org_id, purchase_date);
    CREATE INDEX IF NOT EXISTS idx_ledger_party ON ledger_entries(org_id, party_type, party_id, entry_date, id);
    CREATE INDEX IF NOT EXISTS idx_movements_org ON stock_movements(org_id, created_at);
  `,
    false
  );

  const ensureColumn = (table: string, col: string, ddl: string) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === col)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`, false);
    }
  };

  ensureColumn('products', 'default_bv', 'REAL NOT NULL DEFAULT 0');
  ensureColumn('customers', 'opening_bv', 'REAL NOT NULL DEFAULT 0');
  ensureColumn('invoices', 'total_bv', 'REAL NOT NULL DEFAULT 0');
  ensureColumn('invoices', 'show_bv_on_bill', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('invoice_items', 'bv_per_unit', 'REAL NOT NULL DEFAULT 0');
  ensureColumn('invoice_items', 'bv_included', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn('invoice_items', 'line_bv_total', 'REAL NOT NULL DEFAULT 0');

  db.markSchemaInitialized();

  if (isMongoConfigured()) {
    try {
      await db.hydrateFromMongo();
    } catch (err) {
      // Allow server to boot cleanly so /api/meta/states and /api/health can surface diagnostics
      // and automatically retry hydration on the next incoming request.
      console.warn('Initial MongoDB hydration deferred:', err);
    }
  }
}
