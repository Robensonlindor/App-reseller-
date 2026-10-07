import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isProduction = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT) || 3000;

process.on('uncaughtException', err => {
  console.error('[PlayUp Engine] Uncaught exception (recovered):', err);
});

process.on('unhandledRejection', reason => {
  console.error('[PlayUp Engine] Unhandled rejection (recovered):', reason);
});

async function loadBackendCore(): Promise<{ apiRouter: express.Router; RechargeGamesProvider: any }> {
  const builtBundlePath = path.resolve(__dirname, 'dist/apiRoutes.mjs');
  if (fs.existsSync(builtBundlePath)) {
    try {
      // Load via tsx in dev if available so source edits take effect immediately; otherwise use built bundle for native node server.ts
      if (!isProduction) {
        const modPath = './server/apiRoutes';
        return await import(modPath);
      }
    } catch {
      // Fallback to built bundle when running under plain node without tsx
    }
    return await import(builtBundlePath);
  }
  const modPath = './server/apiRoutes';
  return await import(modPath);
}

async function startServer() {
  const { apiRouter, RechargeGamesProvider } = await loadBackendCore();
  const app = express();
  app.disable('x-powered-by');

  // Strict Security Headers & Controlled CORS Middleware
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, HEAD, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-KEY, stripe-signature, webhook-id, webhook-timestamp, webhook-signature');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }
    next();
  });

  // Serve Web App Manifest for Android & iOS PWA Installation
  app.get('/manifest.webmanifest', (_req, res) => {
    res.setHeader('Content-Type', 'application/manifest+json');
    res.json({
      id: '/',
      name: 'PlayUp Gaming Top-Up',
      short_name: 'PlayUp',
      description: 'Plateforme officielle de recharges gaming instantanées (Free Fire, PUBG Mobile, Mobile Legends, Cartes Cadeaux).',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      background_color: '#0f172a',
      theme_color: '#ea580c',
      icons: [
        {
          src: '/src/assets/images/game_cover_freefire_1790988876938.jpg',
          sizes: '192x192',
          type: 'image/jpeg',
          purpose: 'any'
        },
        {
          src: '/src/assets/images/game_cover_freefire_1790988876938.jpg',
          sizes: '512x512',
          type: 'image/jpeg',
          purpose: 'any'
        }
      ]
    });
  });

  // Serve Real Service Worker (/sw.js) for Background, Closed-App & Locked-Screen Push Notifications
  app.get('/sw.js', (_req, res) => {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Service-Worker-Allowed', '/');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(`
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Listen for Web Push events from PlayUp Backend even when app is closed or phone is locked
self.addEventListener('push', (event) => {
  let payload = {
    title: 'PlayUp',
    body: 'Votre commande est terminée.',
    orderNumber: ''
  };
  if (event.data) {
    try {
      payload = Object.assign(payload, event.data.json());
    } catch (e) {
      payload.body = event.data.text() || payload.body;
    }
  }
  event.waitUntil(
    self.registration.showNotification(payload.title || 'PlayUp', {
      body: payload.body,
      tag: payload.orderNumber ? 'playup-order-' + payload.orderNumber : 'playup-push-' + Date.now(),
      renotify: true,
      requireInteraction: false,
      data: payload
    })
  );
});

// Also allow triggering OS notifications from the background SSE listener
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SHOW_ORDER_NOTIFICATION') {
    const n = event.data.notification || {};
    self.registration.showNotification(n.title || 'PlayUp', {
      body: n.body || 'Votre commande est terminée.',
      tag: n.orderNumber ? 'playup-order-' + n.orderNumber : 'playup-push-' + Date.now(),
      renotify: true,
      data: n
    });
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('/');
    })
  );
});
`);
  });

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
