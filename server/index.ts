import { exec } from 'node:child_process';
import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { getExpressApp } from './app.js';
import { isMongoConfigured } from './mongo.js';

function openBrowserOnDesktop(url: string) {
  if (process.env.NO_OPEN === '1' || process.env.CI) return;
  if (process.platform === 'win32') {
    exec(`cmd /c start "" "${url}"`);
  } else if (process.platform === 'darwin') {
    exec(`open "${url}"`);
  }
}

async function startServer() {
  const app = await getExpressApp();
  const httpServer = http.createServer(app);

  const isProd =
    process.env.NODE_ENV === 'production' || process.argv.includes('--production');

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        hmr: {
          server: httpServer,
        },
        watch: {
          ignored: [
            '**/data/**',
            '**/*.sqlite',
            '**/*.sqlite-wal',
            '**/*.sqlite-shm',
            '**/*.tmp',
          ],
        },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.use((_req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  }

  let activePort = Number(process.env.PORT || 3000);
  const bindHost = process.platform === 'win32' ? undefined : '0.0.0.0';

  const listenOnPort = (portToTry: number) => {
    const onListening = () => {
      const browserUrl = `http://localhost:${portToTry}`;
      console.log('');
      console.log('=====================================================');
      console.log('  KoshBill ERP Server is running!');
      console.log(
        `  Database Engine:   ${
          isMongoConfigured() ? 'MongoDB Atlas Cloud (Connected)' : 'Local Fallback Storage'
        }`
      );
      console.log(`  Open in Browser:   ${browserUrl}`);
      console.log(`  IPv4 Fallback:     http://127.0.0.1:${portToTry}`);
      console.log('=====================================================');
      console.log('');

      if (!isProd) {
        openBrowserOnDesktop(browserUrl);
      }
    };

    if (bindHost) {
      httpServer.listen(portToTry, bindHost, onListening);
    } else {
      httpServer.listen(portToTry, onListening);
    }
  };

  httpServer.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE' && !process.env.PORT && activePort < 3010) {
      const prev = activePort;
      activePort += 1;
      console.warn(`Port ${prev} is already in use — trying port ${activePort}...`);
      setTimeout(() => listenOnPort(activePort), 150);
      return;
    }
    console.error('Server listen error:', err);
    process.exit(1);
  });

  listenOnPort(activePort);
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
