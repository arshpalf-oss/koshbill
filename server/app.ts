import crypto from 'node:crypto';
import express, { Express } from 'express';
import { db, initSchema } from './db.js';
import {
  acquireMongoWriteLock,
  formatMongoError,
  getDetectedMongoEnvName,
  getMongoDatabase,
  isCloudDeploymentEnvironment,
  isMongoConfigured,
  releaseMongoWriteLock,
} from './mongo.js';
import { apiRouter } from './routes.js';

let appPromise: Promise<Express> | null = null;

export async function getExpressApp(): Promise<Express> {
  if (!appPromise) {
    appPromise = (async () => {
      await initSchema();

      const app = express();
      app.use(express.json({ limit: '5mb' }));

      app.get('/api/health', async (_req, res) => {
        const envVar = getDetectedMongoEnvName();
        if (isMongoConfigured()) {
          try {
            const mongoDb = await getMongoDatabase();
            await mongoDb.command({ ping: 1 });
            res.json({
              status: 'ok',
              service: 'KoshBill ERP API',
              storage_mode: 'mongodb',
              mongodb_connected: true,
              env_var: envVar,
              database_name: mongoDb.databaseName,
            });
            return;
          } catch (err: any) {
            res.status(503).json({
              status: 'error',
              service: 'KoshBill ERP API',
              storage_mode: 'mongodb_error',
              mongodb_connected: false,
              env_var: envVar,
              error: formatMongoError(err),
            });
            return;
          }
        }

        res.json({
          status: 'ok',
          service: 'KoshBill ERP API',
          storage_mode: isCloudDeploymentEnvironment() ? 'unconfigured_cloud' : 'local',
          mongodb_connected: false,
          env_var: null,
        });
      });

      // Cloud MongoDB synchronization & concurrency middleware
      app.use('/api', async (req, res, next) => {
        const isReadOnly =
          req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS';

        if (isCloudDeploymentEnvironment() && !isMongoConfigured() && !isReadOnly) {
          res.status(503).json({
            error:
              'MongoDB Atlas is not connected yet! Add KBE_MONGODB_URI in Vercel / Render -> Settings -> Environment Variables and redeploy.',
          });
          return;
        }

        if (!isMongoConfigured()) {
          next();
          return;
        }

        if (isReadOnly) {
          try {
            await db.ensureSyncedFromMongo(false);
            next();
          } catch (err: any) {
            if (req.path === '/meta/states') {
              (req as any).mongoSyncError = formatMongoError(err);
              next();
              return;
            }
            res.status(503).json({ error: formatMongoError(err) });
          }
          return;
        }

        const lockOwner = crypto.randomUUID();
        let lockReleased = false;
        const releaseOnce = async () => {
          if (lockReleased) return;
          lockReleased = true;
          await releaseMongoWriteLock(lockOwner);
        };

        try {
          await acquireMongoWriteLock(lockOwner);
          res.on('close', () => {
            void releaseOnce();
          });

          await db.ensureSyncedFromMongo(true);

          const origSend = res.send.bind(res);
          let sendIntercepted = false;

          res.send = ((body?: any) => {
            if (sendIntercepted) {
              return origSend(body);
            }
            sendIntercepted = true;

            if (db.hasPendingMongoSync()) {
              db.flushToMongo()
                .then(() => releaseOnce())
                .then(() => {
                  origSend(body);
                })
                .catch(async (err) => {
                  await releaseOnce();
                  const errMsg = formatMongoError(err);
                  res.status(500).set('Content-Type', 'application/json');
                  origSend(JSON.stringify({ error: `Failed to save to MongoDB: ${errMsg}` }));
                });
              return res;
            }

            void releaseOnce().finally(() => {
              origSend(body);
            });
            return res;
          }) as any;

          next();
        } catch (err: any) {
          await releaseOnce();
          res.status(503).json({ error: formatMongoError(err) });
        }
      });

      app.use('/api', apiRouter);

      // API 404 handler so unknown /api routes never fall through to HTML
      app.use('/api', (_req, res) => {
        res.status(404).json({ error: 'API endpoint not found' });
      });

      return app;
    })().catch((err) => {
      appPromise = null;
      throw err;
    });
  }

  return appPromise;
}
