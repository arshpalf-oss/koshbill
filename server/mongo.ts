import fs from 'node:fs';
import path from 'node:path';
import { Db, MongoClient } from 'mongodb';

// Safely load local .env file if present (read-only / serverless safe)
function loadDotEnvIfPresent() {
  try {
    const envPath = path.resolve(process.cwd(), '.env');
    if (!fs.existsSync(envPath)) return;
    const raw = fs.readFileSync(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx <= 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (key && process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
  } catch {
    // Ignore filesystem errors in restricted serverless environments
  }
}

loadDotEnvIfPresent();

declare global {
  // eslint-disable-next-line no-var
  var __koshbillMongoClientPromise: Promise<MongoClient> | undefined;
  // eslint-disable-next-line no-var
  var __koshbillMongoIndexesReady: boolean | undefined;
}

export function getMongoUri(): string {
  return (
    process.env.MONGODB_URI ||
    process.env.MONGO_URI ||
    process.env.MONGODB_URL ||
    ''
  ).trim();
}

export function isCloudDeploymentEnvironment(): boolean {
  return Boolean(
    process.env.VERCEL ||
      process.env.RENDER ||
      process.env.RAILWAY_ENVIRONMENT ||
      process.env.FLY_APP_NAME ||
      process.env.KOYEB_SERVICE_NAME
  );
}

export function isMongoConfigured(): boolean {
  return getMongoUri().length > 0;
}

function resolveMongoDbName(uri: string): string {
  if (process.env.MONGODB_DB_NAME?.trim()) {
    return process.env.MONGODB_DB_NAME.trim();
  }
  try {
    // Extract pathname between host/ and ?query
    const withoutScheme = uri.replace(/^mongodb(\+srv)?:\/\//i, '');
    const slashIdx = withoutScheme.indexOf('/');
    if (slashIdx !== -1) {
      const afterSlash = withoutScheme.slice(slashIdx + 1);
      const qIdx = afterSlash.indexOf('?');
      const dbName = (qIdx === -1 ? afterSlash : afterSlash.slice(0, qIdx)).trim();
      if (dbName && dbName !== 'admin') {
        return decodeURIComponent(dbName);
      }
    }
  } catch {
    // fallback below
  }
  return 'koshbill_erp';
}

export function formatMongoError(err: any): string {
  const msg = String(err?.message || err || 'Unknown MongoDB error');
  if (/bad auth|authentication failed/i.test(msg)) {
    return 'MongoDB authentication failed. Please check the username and password in MONGODB_URI (URL-encode special characters like @ or # in passwords).';
  }
  if (/ServerSelection|timed out|ECONNREFUSED|ENOTFOUND|whitelist|IP/i.test(msg)) {
    return 'Could not reach MongoDB Atlas. Verify MONGODB_URI and ensure MongoDB Atlas -> Network Access has 0.0.0.0/0 ("Allow Access from Anywhere") enabled.';
  }
  return msg;
}

export async function getMongoDatabase(): Promise<Db> {
  const uri = getMongoUri();
  if (!uri) {
    throw new Error('MONGODB_URI environment variable is not set.');
  }

  if (!globalThis.__koshbillMongoClientPromise) {
    const client = new MongoClient(uri, {
      maxPoolSize: 10,
      minPoolSize: 0,
      serverSelectionTimeoutMS: 8000,
      connectTimeoutMS: 8000,
    });
    globalThis.__koshbillMongoClientPromise = client.connect().catch((err) => {
      globalThis.__koshbillMongoClientPromise = undefined;
      throw new Error(formatMongoError(err));
    });
  }

  const connectedClient = await globalThis.__koshbillMongoClientPromise;
  const dbName = resolveMongoDbName(uri);
  const mongoDb = connectedClient.db(dbName);

  if (!globalThis.__koshbillMongoIndexesReady) {
    globalThis.__koshbillMongoIndexesReady = true;
    try {
      await Promise.all([
        mongoDb.collection('users').createIndex({ email: 1 }, { unique: true }),
        mongoDb.collection('sessions').createIndex({ expires_at: 1 }),
        mongoDb.collection('products').createIndex({ org_id: 1, sku: 1 }),
        mongoDb.collection('batches').createIndex({ org_id: 1, product_id: 1 }),
        mongoDb.collection('invoices').createIndex({ org_id: 1, invoice_date: -1 }),
        mongoDb.collection('purchases').createIndex({ org_id: 1, purchase_date: -1 }),
        mongoDb.collection('customers').createIndex({ org_id: 1 }),
        mongoDb.collection('suppliers').createIndex({ org_id: 1 }),
        mongoDb
          .collection('ledger_entries')
          .createIndex({ org_id: 1, party_type: 1, party_id: 1 }),
      ]);
    } catch {
      // Index creation is best-effort and non-fatal
    }
  }

  return mongoDb;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function acquireMongoWriteLock(ownerId: string, maxWaitMs = 10000): Promise<void> {
  const mongoDb = await getMongoDatabase();
  const meta = mongoDb.collection<{ _id: string; locked_until: number; owner: string }>(
    '_engine_meta'
  );
  const deadline = Date.now() + maxWaitMs;
  const leaseMs = 12000;

  while (Date.now() < deadline) {
    const now = Date.now();
    try {
      const res = await meta.findOneAndUpdate(
        {
          _id: 'write_lock',
          $or: [{ locked_until: { $lte: now } }, { owner: ownerId }],
        },
        {
          $set: {
            locked_until: now + leaseMs,
            owner: ownerId,
          },
        },
        { upsert: true, returnDocument: 'after' }
      );
      if (res && res.owner === ownerId) {
        return;
      }
    } catch (err: any) {
      // Duplicate key error (E11000) when another concurrent writer currently holds the lock
      if (err?.code !== 11000) {
        throw new Error(formatMongoError(err));
      }
    }
    await sleep(60);
  }

  throw new Error('Server busy processing concurrent write — please retry in a moment.');
}

export async function releaseMongoWriteLock(ownerId: string): Promise<void> {
  if (!isMongoConfigured()) return;
  try {
    const mongoDb = await getMongoDatabase();
    await mongoDb
      .collection<{ _id: string; owner: string }>('_engine_meta')
      .updateOne({ _id: 'write_lock', owner: ownerId }, { $set: { locked_until: 0 } });
  } catch {
    // Lease expires automatically via TTL timestamp if release fails
  }
}
