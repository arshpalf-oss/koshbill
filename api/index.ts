import { getExpressApp } from '../server/app.js';

export default async function handler(req: any, res: any) {
  if (req.url && !req.url.startsWith('/api')) {
    req.url = `/api${req.url.startsWith('/') ? '' : '/'}${req.url}`;
  }
  const app = await getExpressApp();
  return app(req, res);
}
