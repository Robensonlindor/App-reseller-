import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { apiRouter } from './server/apiRoutes';
import { RechargeGamesProvider } from './server/providers/RechargeGamesProvider';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isProduction = process.env.NODE_ENV === 'production';
const PORT = 3000;

process.on('uncaughtException', err => {
  console.error('[PlayUp Engine] Uncaught exception (recovered):', err);
});

process.on('unhandledRejection', reason => {
  console.error('[PlayUp Engine] Unhandled rejection (recovered):', reason);
});

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

  // Catch JSON syntax errors on webhook routes so handleWebhook can verify HMAC and log invalid_payload (HTTP 400)
  app.use((err: any, req: any, res: express.Response, next: express.NextFunction) => {
    if (err instanceof SyntaxError && 'body' in err) {
      if (req.url.startsWith('/rechargegames-webhook') || req.url.startsWith('/api/webhooks/rechargegames')) {
        req.invalidJsonError = true;
        req.body = null;
        return next();
      }
      return res.status(400).json({ error: 'Invalid JSON payload' });
    }
    next(err);
  });

  app.use(express.urlencoded({ extended: true }));

  // Request logger
  app.use((req, _res, next) => {
    if (req.url.startsWith('/api') || req.url.startsWith('/rechargegames-webhook')) {
      console.log(`[API ${req.method}] ${req.url}`);
    }
    next();
  });

  // ============================================================================
  // PUBLIC HTTPS WEBHOOK ENDPOINT FOR RECHARGEGAMES: /rechargegames-webhook
  // ============================================================================
  app.post('/rechargegames-webhook', async (req: any, res) => {
    const rawBody =
      typeof req.rawBody === 'string'
        ? req.rawBody
        : req.body
        ? JSON.stringify(req.body)
        : '';
    const rg = new RechargeGamesProvider();
    const result = await rg.handleWebhook(rawBody, req.body, req.headers as Record<string, any>, {
      isInvalidJson: Boolean(req.invalidJsonError),
      endpointPath: '/rechargegames-webhook'
    });
    return res.status(result.httpStatus).json(result.responseBody);
  });

  app.get('/rechargegames-webhook', (_req, res) => {
    res.status(200).json({
      status: 'ACTIVE',
      endpoint: '/rechargegames-webhook',
      method: 'POST',
      provider: 'RechargeGames',
      hmac_sha256_verification: 'ENABLED',
      idempotency_store: 'Firestore (/webhook_events/{eventId})',
      supported_events: ['webhook.test', 'order.delivered', 'order.refunded', 'order.failed'],
      message: 'RechargeGames HTTPS Webhook endpoint is active with Firestore idempotency and HMAC-SHA256 verification.'
    });
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
    // Development mode with Vite middleware initialized eagerly while port binds immediately
    const vitePromise = import('vite').then(({ createServer }) =>
      createServer({
        server: {
          middlewareMode: true,
          hmr: process.env.DISABLE_HMR !== 'true',
          watch: process.env.DISABLE_HMR === 'true' ? null : {}
        },
        appType: 'spa'
      })
    );

    app.use(async (req, res, next) => {
      try {
        const vite = await vitePromise;
        return vite.middlewares(req, res, next);
      } catch (err) {
        return next(err);
      }
    });
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
