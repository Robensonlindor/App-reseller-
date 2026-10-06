import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { apiRouter } from './server/apiRoutes';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isProduction = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT || 3000;

async function startServer() {
  const app = express();

  // JSON & URL-encoded body parser (preserving exact rawBody buffer for HMAC-SHA256 webhook verification)
  app.use(
    express.json({
      verify: (req: any, _res, buf) => {
        req.rawBody = buf.toString('utf8');
      }
    })
  );
  app.use(express.urlencoded({ extended: true }));

  // Request logger
  app.use((req, _res, next) => {
    if (req.url.startsWith('/api')) {
      console.log(`[API ${req.method}] ${req.url}`);
    }
    next();
  });

  // Healthcheck endpoint
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'PlayUp Core Engine', timestamp: new Date().toISOString() });
  });

  // Mount API Router under /api
  app.use('/api', apiRouter);

  // Explicit JSON 404 handler for any unmatched /api/* route so it never falls through to Vite HTML SPA fallback
  app.use('/api', (req, res) => {
    res.status(404).json({
      error: `Endpoint API non trouvé: ${req.method} ${req.originalUrl}`
    });
  });

  // Serve static generated assets if needed
  app.use('/src/assets', express.static(path.resolve(__dirname, 'src/assets')));

  if (!isProduction) {
    // Development mode with Vite middleware
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
        watch: process.env.DISABLE_HMR === 'true' ? null : {}
      },
      appType: 'spa'
    });

    app.use(vite.middlewares);
  } else {
    // Production mode: serve built client
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  // Global error handler so server never crashes on unhandled route errors
  app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[PlayUp Engine] Unhandled error:', err);
    if (req.url.startsWith('/api')) {
      res.status(500).json({ error: err?.message || 'Erreur interne du serveur PlayUp' });
    } else {
      res.status(500).send('Internal Server Error');
    }
  });

  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`[PlayUp Engine] Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('[PlayUp Engine] Fatal startup error:', err);
  process.exit(1);
});
