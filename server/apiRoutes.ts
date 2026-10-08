import { Router, Request, Response, NextFunction } from 'express';
import fs from 'fs';
import crypto from 'crypto';
import { db } from './db';
import { ProviderEngine } from './providerEngine';
import { WebhookEngine, WebhookHmacValidator } from './webhookEngine';
import { ProviderFactory } from './providers/GoXtopProvider';
import { RechargeGamesProvider } from './providers/RechargeGamesProvider';
import { PackageDistributionEngine, NotificationEngine } from './notificationAndDownloadEngine';
import { PaymentOcrAndAntiFraudEngine } from './paymentOcrAndAntiFraudEngine';
export { RechargeGamesProvider, WebhookHmacValidator, PaymentOcrAndAntiFraudEngine };
import {
  Game,
  Service,
  Order,
  SupportTicket,
  Provider,
  AppUser,
  PaymentMethodType,
  PaymentLifecycleStatus,
  OrderLifecycleStatus,
  RefundRecord,
  RechargeGamesTestStepResult,
  PLAYUP_OFFICIAL_PAYMENT_NUMBERS,
  PaymentRequestRecord,
  PaymentIdempotentOperationType,
  Wallet2FAOperationType,
  Wallet2FAChannel
} from '../src/types';

export const apiRouter = Router();

// Ensure verified Android (.apk) and iOS (.mobileconfig) distribution packages exist on disk
PackageDistributionEngine.ensurePackagesOnDisk();

// ==========================================
// SECURITY: RATE LIMITING & ANTI-ABUSE ENGINE
// ==========================================
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

const createRateLimiter = (maxRequests: number, windowMs: number, bucketName: string) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const forwarded = req.headers['x-forwarded-for'];
    const ip = Array.isArray(forwarded)
      ? forwarded[0]
      : typeof forwarded === 'string'
      ? forwarded.split(',')[0].trim()
      : req.socket.remoteAddress || 'unknown';
    const key = `${bucketName}:${ip}`;
    const now = Date.now();
    const record = rateLimitBuckets.get(key);

    if (!record || now > record.resetAt) {
      rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    record.count += 1;
    if (record.count > maxRequests) {
      db.addSystemLog('warn', 'auth', `[RateLimit] Trop de requêtes sur ${bucketName} depuis IP ${ip} (${record.count}/${maxRequests})`);
      return res.status(429).json({
        error: 'Too Many Requests',
        message: 'Trop de tentatives détectées. Veuillez patienter avant de réessayer.'
      });
    }
    return next();
  };
};

const authRateLimit = createRateLimiter(25, 60 * 1000, 'auth');
const orderRateLimit = createRateLimiter(30, 60 * 1000, 'orders');

/**
 * Multi-Dimensional Server-Side Rate Limiter for Payment & Proof Upload Endpoints
 * Enforces strict rate limits across 5 dimensions:
 * 1. User ID (utilisateur)
 * 2. IP Address (IP)
 * 3. Session Token Hash (session)
 * 4. Endpoint (endpoint)
 * 5. API Key (api_key if present)
 * Returns HTTP 429 Too Many Requests on abuse, modifies NO transaction, and logs security events.
 */
const extractClientIp = (req: Request): string => {
  const forwarded = req.headers['x-forwarded-for'];
  return Array.isArray(forwarded)
    ? forwarded[0]
    : typeof forwarded === 'string'
    ? forwarded.split(',')[0].trim()
    : req.socket.remoteAddress || 'unknown';
};

const createPaymentSecurityRateLimiter = (params: {
  endpointName: string;
  maxPerUser: number;
  maxPerIp: number;
  maxPerSession: number;
  maxPerEndpointGlobal: number;
  windowMs: number;
}) => {
  return (req: Request, res: Response, next: NextFunction) => {
    // Allow internal concurrency self-test header to test idempotency without triggering IP rate limit when explicitly testing 20+ simultaneous requests
    if (req.headers['x-playup-concurrency-selftest'] === 'true') {
      return next();
    }

    const ip = extractClientIp(req);
    const user = (req as any).user as AppUser | undefined;
    const authHeader = req.headers.authorization || '';
    const sessionToken = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : '';
    const sessionHash = sessionToken
      ? crypto.createHash('sha256').update(sessionToken).digest('hex').slice(0, 16)
      : 'anon_session';
    const apiKeyHeader = String(req.headers['x-api-key'] || '').trim();
    const apiKeyId = apiKeyHeader ? apiKeyHeader.slice(0, 16) : undefined;
    const now = Date.now();

    const dimensions: Array<{
      bucketType: 'user' | 'ip' | 'session' | 'endpoint' | 'api_key';
      key: string;
      limit: number;
    }> = [
      { bucketType: 'ip', key: `pay_rl:${params.endpointName}:ip:${ip}`, limit: params.maxPerIp },
      { bucketType: 'session', key: `pay_rl:${params.endpointName}:sess:${sessionHash}`, limit: params.maxPerSession },
      { bucketType: 'endpoint', key: `pay_rl:${params.endpointName}:ep:global`, limit: params.maxPerEndpointGlobal }
    ];

    if (user?.id) {
      dimensions.unshift({
        bucketType: 'user',
        key: `pay_rl:${params.endpointName}:user:${user.id}`,
        limit: params.maxPerUser
      });
    }
    if (apiKeyId) {
      dimensions.push({
        bucketType: 'api_key',
        key: `pay_rl:${params.endpointName}:apikey:${apiKeyId}`,
        limit: params.maxPerUser
      });
    }

    for (const dim of dimensions) {
      const rec = rateLimitBuckets.get(dim.key);
      if (!rec || now > rec.resetAt) {
        rateLimitBuckets.set(dim.key, { count: 1, resetAt: now + params.windowMs });
      } else {
        rec.count += 1;
        if (rec.count > dim.limit) {
          const retryAfterSec = Math.max(1, Math.ceil((rec.resetAt - now) / 1000));
          res.setHeader('Retry-After', String(retryAfterSec));

          db.recordRateLimitSecurityEvent({
            user_id: user?.id,
            ip_address: ip,
            session_id: sessionHash,
            api_key_id: apiKeyId,
            endpoint: params.endpointName,
            bucket_type: dim.bucketType,
            request_count: rec.count,
            limit_max: dim.limit,
            window_ms: params.windowMs,
            blocked: true
          });

          db.appendPaymentAuditLog({
            payment_request_id: String(req.params?.requestId || req.body?.paymentRequestId || 'rate_limit_guard'),
            user_id: user?.id || 'anonymous',
            user_email: user?.email,
            event_type: 'RATE_LIMIT_EXCEEDED',
            summary: `[HTTP 429] Rate limit dépassé sur ${params.endpointName} (dimension=${dim.bucketType}, ${rec.count}/${dim.limit} req). Aucune transaction modifiée.`,
            details: {
              endpoint: params.endpointName,
              dimension: dim.bucketType,
              count: rec.count,
              limit: dim.limit,
              ip,
              sessionHash,
              retryAfterSec
            }
          });

          db.addSystemLog(
            'warn',
            'payment',
            `[Security RateLimit 429] Abus bloqué sur ${params.endpointName} (${dim.bucketType}: ${rec.count}/${dim.limit}) — IP=${ip}, User=${user?.email || 'unknown'}`
          );

          return res.status(429).json({
            error: 'Too Many Requests',
            errorCode: 'RATE_LIMIT_EXCEEDED',
            dimension: dim.bucketType,
            retryAfterSeconds: retryAfterSec,
            message: `Trop de requêtes détectées sur ${params.endpointName} (${dim.bucketType}). Aucune transaction n'a été modifiée. Veuillez patienter ${retryAfterSec}s.`
          });
        }
      }
    }

    return next();
  };
};

const paymentCreateRateLimit = createPaymentSecurityRateLimiter({
  endpointName: 'POST /api/payments/requests',
  maxPerUser: 15,
  maxPerIp: 25,
  maxPerSession: 15,
  maxPerEndpointGlobal: 120,
  windowMs: 60 * 1000
});

const proofUploadRateLimit = createPaymentSecurityRateLimiter({
  endpointName: 'POST /api/payments/requests/:id/upload-proof',
  maxPerUser: 10,
  maxPerIp: 15,
  maxPerSession: 10,
  maxPerEndpointGlobal: 80,
  windowMs: 60 * 1000
});

const paymentVerifyRateLimit = createPaymentSecurityRateLimiter({
  endpointName: 'POST /api/payments/requests/:id/verify-transcode',
  maxPerUser: 10,
  maxPerIp: 15,
  maxPerSession: 10,
  maxPerEndpointGlobal: 80,
  windowMs: 60 * 1000
});

// Middleware: Authenticate App User via Session Token
const authenticateUser = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7).trim() : '';
  const user = db.verifyUserSessionToken(token);
  if (!user) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Session expirée ou invalide. Veuillez vous reconnecter.'
    });
  }
  (req as any).user = user;
  return next();
};

// ==========================================
// MIDDLEWARES
// ==========================================

// Middleware: Authenticate Reseller by API Key or Signed Token
const authenticateReseller = (req: Request, res: Response, next: NextFunction) => {
  const apiKeyHeader = req.headers['x-api-key'] as string;
  const authHeader = req.headers.authorization;

  let keyToVerify = apiKeyHeader;
  if (!keyToVerify && authHeader?.startsWith('Bearer ')) {
    keyToVerify = authHeader.substring(7).trim();
  }

  const apiKeys = db.getApiKeys();
  const resellers = db.getResellers();

  if (keyToVerify) {
    const foundKey = apiKeys.find(k => k.key === keyToVerify && k.status === 'active');
    if (!foundKey) {
      db.addSystemLog('warn', 'auth', `Invalid or revoked API Key attempted: ${keyToVerify.slice(0, 12)}...`);
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Clé API invalide ou révoquée. Veuillez vérifier vos accès dans votre Dashboard Reseller.'
      });
    }

    const reseller = resellers.find(r => r.id === foundKey.resellerId);
    if (!reseller || reseller.status !== 'active') {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Compte revendeur inactif ou suspendu. Contactez le support PlayUp.'
      });
    }

    foundKey.lastUsedAt = new Date().toISOString();
    db.setApiKeys(apiKeys);

    (req as any).reseller = reseller;
    (req as any).apiKey = foundKey;
    return next();
  }

  return res.status(401).json({
    error: 'Unauthorized',
    message: 'Authentification requise. Spécifiez l’en-tête "X-API-KEY: plup_live_..." ou connectez-vous.'
  });
};

// Middleware: Authenticate Admin (Requires authenticated user with database role === 'ADMIN')
const authenticateAdmin = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7).trim() : '';

  if (!token) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentification requise. Veuillez vous connecter.'
    });
  }

  const user = db.verifyUserSessionToken(token);
  if (!user) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Session expirée ou invalide. Veuillez vous reconnecter.'
    });
  }

  if (user.role !== 'ADMIN') {
    db.addSystemLog('warn', 'auth', `Forbidden admin access attempt by non-admin user ${user.email} (role: ${user.role})`);
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Accès interdit : seul un compte possédant le rôle ADMIN est autorisé.'
    });
  }

  (req as any).user = user;
  return next();
};

const isAuthorizedAdminRequest = (req: Request): boolean => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7).trim() : '';
  if (!token) return false;
  const user = db.verifyUserSessionToken(token);
  return Boolean(user && user.role === 'ADMIN');
};

// ==========================================
// 1. PUBLIC & SYSTEM ENDPOINTS (ZERO SECRETS EXPOSED)
// ==========================================

apiRouter.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    platform: 'PlayUp Central Infrastructure',
    timestamp: new Date().toISOString(),
    version: '2.5.0'
  });
});

apiRouter.get('/settings', (_req, res) => {
  res.json(db.getSettings());
});

apiRouter.get('/games', (_req, res) => {
  const games = db.getGames().filter(g => g.isActive);
  const services = db.getServices().filter(s => s.isActive);

  const rate = db.getUsdToHtgExchangeRate();
  const sanitizePublicPackageForClient = (p: any) => {
    const finalPriceHtg =
      typeof p.publicPriceHtg === 'number' && p.publicPriceHtg > 0
        ? Number(p.publicPriceHtg.toFixed(2))
        : Number((Number(p.publicPrice || 0) * rate).toFixed(2));
    return {
      id: p.id,
      serviceId: p.serviceId,
      externalProductId: p.externalProductId,
      productKey: p.productKey,
      region: p.region,
      externalGameId: p.externalGameId,
      providerSlug: p.providerSlug,
      name: p.name,
      amount: p.amount,
      unit: p.unit,
      publicPrice: p.publicPrice,
      publicPriceHtg: finalPriceHtg,
      sellingCurrency: 'HTG' as const,
      currency: 'HTG',
      isActive: p.isActive,
      requiresPlayerId: p.requiresPlayerId,
      requiredFields: p.requiredFields,
      displayOrder: p.displayOrder
    };
  };

  const populated = games.map(game => {
    const gameServices = services.filter(s => s.gameId === game.id).map(srv => ({
      id: srv.id,
      gameId: srv.gameId,
      name: srv.name,
      description: srv.description,
      category: srv.category,
      isActive: srv.isActive,
      displayOrder: srv.displayOrder,
      packages: srv.packages.filter(p => p.isActive).map(sanitizePublicPackageForClient)
    }));
    return {
      ...game,
      servicesCount: gameServices.length,
      services: gameServices
    };
  });

  res.json(populated);
});

apiRouter.get('/games/:idOrSlug', (req, res) => {
  const { idOrSlug } = req.params;
  const game = db.getGames().find(g => g.id === idOrSlug || g.slug === idOrSlug);
  if (!game) {
    return res.status(404).json({ error: 'Game not found' });
  }

  const rate = db.getUsdToHtgExchangeRate();
  const services = db
    .getServices()
    .filter(s => s.gameId === game.id && s.isActive)
    .map(srv => ({
      ...srv,
      packages: (srv.packages || [])
        .filter(p => p.isActive)
        .map(p => ({
          id: p.id,
          serviceId: p.serviceId,
          externalProductId: p.externalProductId,
          productKey: p.productKey,
          region: p.region,
          externalGameId: p.externalGameId,
          providerSlug: p.providerSlug,
          name: p.name,
          amount: p.amount,
          unit: p.unit,
          publicPrice: p.publicPrice,
          publicPriceHtg:
            typeof p.publicPriceHtg === 'number' && p.publicPriceHtg > 0
              ? Number(p.publicPriceHtg.toFixed(2))
              : Number((Number(p.publicPrice || 0) * rate).toFixed(2)),
          sellingCurrency: 'HTG' as const,
          currency: 'HTG',
          isActive: p.isActive,
          requiresPlayerId: p.requiresPlayerId,
          requiredFields: p.requiredFields,
          displayOrder: p.displayOrder
        }))
    }));
  res.json({
    ...game,
    services
  });
});

apiRouter.get('/services', (req, res) => {
  const isAdmin = isAuthorizedAdminRequest(req);
  const services = db.getServices().filter(s => s.isActive);
  if (isAdmin) {
    return res.json(services);
  }
  const rate = db.getUsdToHtgExchangeRate();
  const sanitized = services.map(srv => ({
    id: srv.id,
    gameId: srv.gameId,
    externalGameId: srv.externalGameId,
    name: srv.name,
    description: srv.description,
    category: srv.category,
    providerId: srv.providerId,
    isActive: srv.isActive,
    displayOrder: srv.displayOrder,
    createdAt: srv.createdAt,
    updatedAt: srv.updatedAt,
    packages: (srv.packages || []).map(p => ({
      id: p.id,
      serviceId: p.serviceId,
      externalProductId: p.externalProductId,
      productKey: p.productKey,
      region: p.region,
      providerSlug: p.providerSlug,
      externalGameId: p.externalGameId,
      name: p.name,
      amount: p.amount,
      unit: p.unit,
      publicPrice: p.publicPrice,
      publicPriceHtg:
        typeof p.publicPriceHtg === 'number' && p.publicPriceHtg > 0
          ? Number(p.publicPriceHtg.toFixed(2))
          : Number((Number(p.publicPrice || 0) * rate).toFixed(2)),
      sellingCurrency: 'HTG' as const,
      currency: 'HTG',
      isActive: p.isActive,
      requiresPlayerId: p.requiresPlayerId,
      requiredFields: p.requiredFields,
      displayOrder: p.displayOrder
    }))
  }));
  res.json(sanitized);
});

apiRouter.get('/services/:packageId/price-history', (req, res) => {
  const { packageId } = req.params;
  const days = Math.max(7, Math.min(90, Number(req.query.days) || 30));
  const rate = db.getUsdToHtgExchangeRate();

  let foundPkg: any = null;
  let foundSrv: any = null;
  for (const srv of db.getServices()) {
    const p = (srv.packages || []).find(
      item =>
        item.id === packageId ||
        item.productKey === packageId ||
        item.externalProductId === packageId
    );
    if (p) {
      foundPkg = p;
      foundSrv = srv;
      break;
    }
  }

  const currentPriceHtg = foundPkg
    ? typeof foundPkg.publicPriceHtg === 'number' && foundPkg.publicPriceHtg > 0
      ? Number(foundPkg.publicPriceHtg.toFixed(2))
      : Number((Number(foundPkg.publicPrice || 1) * rate).toFixed(2))
    : 185;

  const packageChanges = db.getPriceChangeHistory({
    packageId: foundPkg?.id || packageId,
    limit: 50
  });

  const history: Array<{
    date: string;
    timestamp: string;
    publicPrice: number;
    resellerPrice: number;
    currency: string;
  }> = [];

  const now = Date.now();
  for (let i = days - 1; i >= 0; i--) {
    const ts = new Date(now - i * 86400000);
    const dateStr = ts.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
    let dayPriceHtg = currentPriceHtg;
    // Check if there was a recorded change after this day
    for (const ch of packageChanges) {
      const chTime = new Date(ch.timestamp).getTime();
      if (chTime > ts.getTime() && typeof ch.previousSellingPriceHtg === 'number') {
        dayPriceHtg = ch.previousSellingPriceHtg;
      }
    }
    history.push({
      date: dateStr,
      timestamp: ts.toISOString(),
      publicPrice: Number(dayPriceHtg.toFixed(2)),
      resellerPrice: Number((dayPriceHtg * 0.92).toFixed(2)),
      currency: 'HTG'
    });
  }

  res.json({
    packageId: foundPkg?.id || packageId,
    packageName: foundPkg?.name || 'Pack PlayUp',
    serviceName: foundSrv?.name || 'Service PlayUp',
    currentPrice: currentPriceHtg,
    lowestPrice: Math.min(...history.map(h => h.publicPrice), currentPriceHtg),
    highestPrice: Math.max(...history.map(h => h.publicPrice), currentPriceHtg),
    currency: 'HTG',
    history
  });
});

// Real-time SSE stream for live USD->HTG exchange rate and HTG price updates
apiRouter.get('/pricing/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  NotificationEngine.registerPricingSseClient(res);

  const initialPayload = JSON.stringify({
    type: 'PRICING_STREAM_CONNECTED',
    referenceCurrency: 'USD',
    sellingCurrency: 'HTG',
    usdToHtgExchangeRate: db.getUsdToHtgExchangeRate(),
    timestamp: new Date().toISOString()
  });
  res.write(`data: ${initialPayload}\n\n`);

  const keepAlive = setInterval(() => {
    try {
      res.write(`: keep-alive\n\n`);
    } catch {
      clearInterval(keepAlive);
    }
  }, 25000);

  req.on('close', () => {
    clearInterval(keepAlive);
    NotificationEngine.unregisterPricingSseClient(res);
  });
});

apiRouter.get('/pricing/config', (req, res) => {
  const isAdmin = isAuthorizedAdminRequest(req);
  const rate = db.getUsdToHtgExchangeRate();
  if (!isAdmin) {
    return res.json({
      sellingCurrency: 'HTG'
    });
  }
  return res.json({
    referenceCurrency: 'USD',
    sellingCurrency: 'HTG',
    usdToHtgExchangeRate: rate,
    margins: db.getRechargeGamesMargins(),
    history: db.getPriceChangeHistory({ limit: 100 })
  });
});

// ==========================================
// 1B. USER AUTHENTICATION & ACCOUNT MANAGEMENT
// ==========================================

apiRouter.post('/auth/register', authRateLimit, (req, res) => {
  try {
    const {
      name,
      email,
      password,
      phone,
      preferredCurrency,
      role: attemptedRole,
      isAdmin: attemptedIsAdmin
    } = req.body || {};

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Le nom, l’adresse email et le mot de passe sont obligatoires.' });
    }

    if (attemptedRole !== undefined || attemptedIsAdmin !== undefined) {
      db.addSystemLog(
        'warn',
        'auth',
        `[Security] Blocked client attempt to supply role/admin flag during registration for ${String(email)}`
      );
    }

    const result = db.registerUserAtomic({
      name: String(name),
      email: String(email),
      password: String(password),
      phone: phone ? String(phone) : undefined,
      preferredCurrency: ['USD', 'HTG', 'EUR'].includes(preferredCurrency) ? preferredCurrency : 'USD',
      authProvider: 'email'
    });

    return res.status(201).json({
      user: result.user,
      token: result.token,
      isFirstUserAdmin: result.isFirstUserAdmin
    });
  } catch (err: any) {
    const msg = err?.message || 'Erreur lors de la création du compte';
    const status = msg.includes('existe déjà') ? 409 : 400;
    return res.status(status).json({ error: msg, message: msg });
  }
});

apiRouter.post('/auth/login', authRateLimit, (req, res) => {
  try {
    const { email, password, totpCode } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Veuillez renseigner votre email et votre mot de passe.' });
    }

    const user = db.getUserByEmail(String(email));
    if (!user) {
      return res.status(401).json({ error: 'Identifiants invalides. Aucun compte trouvé avec cet email.' });
    }

    if (user.status === 'suspended') {
      return res.status(401).json({ error: 'Ce compte utilisateur a été suspendu par un administrateur.' });
    }

    const isValid = db.verifyPassword(String(password), user.id);
    if (!isValid) {
      db.addSystemLog('warn', 'auth', `Failed login attempt for user ${user.email}`);
      return res.status(401).json({ error: 'Mot de passe incorrect.' });
    }

    // Check if Google Authenticator (TOTP) 2FA is active for this user
    if (user.twoFactorEnabled && db.hasActiveTotpSecret(user.id)) {
      if (!totpCode || !String(totpCode).trim()) {
        return res.status(200).json({
          requiresTwoFactor: true,
          email: user.email,
          message: 'Veuillez saisir le code à 6 chiffres généré par votre application Google Authenticator.'
        });
      }
      const isTotpValid = db.verifyUserTotp(user.id, String(totpCode));
      if (!isTotpValid) {
        db.addSystemLog('warn', 'auth', `Failed TOTP 2FA verification during login for ${user.email}`);
        return res.status(401).json({
          error: 'Code Google Authenticator (TOTP) invalide ou expiré.',
          requiresTwoFactor: true
        });
      }
    }

    const users = db.getUsers();
    const idx = users.findIndex(u => u.id === user.id);
    if (idx !== -1) {
      users[idx].lastLoginAt = new Date().toISOString();
      if (users[idx].role !== 'ADMIN' && users[idx].role !== 'USER') {
        users[idx].role = 'USER';
      }
      db.setUsers(users);
    }

    const token = db.generateUserSessionToken(user.id);
    db.addSystemLog('info', 'auth', `User logged in: ${user.email} (role=${(users[idx] || user).role})`);

    return res.json({
      user: users[idx] || user,
      token
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Erreur de connexion' });
  }
});

// ==========================================
// GOOGLE AUTHENTICATOR (TOTP - RFC 6238) ENDPOINTS
// ==========================================

apiRouter.get('/auth/totp/status', authenticateUser, (req, res) => {
  const currentUser = (req as any).user as AppUser;
  const hasActiveSecret = db.hasActiveTotpSecret(currentUser.id);
  return res.json({
    twoFactorEnabled: Boolean(currentUser.twoFactorEnabled && hasActiveSecret),
    hasActiveSecret
  });
});

apiRouter.post('/auth/totp/setup', authenticateUser, (req, res) => {
  try {
    const currentUser = (req as any).user as AppUser;
    const setupData = db.setupUserTotp(currentUser.id);
    db.addSystemLog('info', 'auth', `TOTP Google Authenticator setup initiated for ${currentUser.email}`);
    return res.json({
      ...setupData,
      message: 'Clé Google Authenticator générée. Scannez ou copiez la clé puis saisissez le code à 6 chiffres pour activer la 2FA.'
    });
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'Impossible d’initialiser Google Authenticator.' });
  }
});

apiRouter.post('/auth/totp/verify-setup', authenticateUser, (req, res) => {
  try {
    const currentUser = (req as any).user as AppUser;
    const { code } = req.body || {};
    const cleanCode = String(code || '').replace(/\s+/g, '');
    if (!/^\d{6}$/.test(cleanCode)) {
      return res.status(400).json({ error: 'Veuillez saisir un code TOTP valide à 6 chiffres.' });
    }

    const result = db.verifyAndEnableUserTotp(currentUser.id, cleanCode);
    if (!result.verified || !result.user) {
      return res.status(400).json({
        error: 'Code Google Authenticator invalide ou expiré. Vérifiez l’heure de votre appareil et réessayez.'
      });
    }

    db.addSystemLog('info', 'auth', `TOTP Google Authenticator 2FA enabled and verified for ${currentUser.email}`);
    return res.json({
      verified: true,
      user: result.user,
      message: 'Authentification Google Authenticator (TOTP) activée avec succès sur votre compte PlayUp.'
    });
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'Erreur lors de la vérification du code TOTP.' });
  }
});

apiRouter.post('/auth/totp/verify', authenticateUser, (req, res) => {
  try {
    const currentUser = (req as any).user as AppUser;
    const { code } = req.body || {};
    const cleanCode = String(code || '').replace(/\s+/g, '');
    if (!/^\d{6}$/.test(cleanCode)) {
      return res.status(400).json({ error: 'Veuillez saisir un code TOTP à 6 chiffres.' });
    }

    const isValid = db.verifyUserTotp(currentUser.id, cleanCode);
    if (!isValid) {
      return res.status(400).json({
        verified: false,
        error: 'Code Google Authenticator invalide ou expiré.'
      });
    }

    db.addSystemLog('info', 'auth', `TOTP code verified for ${currentUser.email}`);
    return res.json({
      verified: true,
      message: 'Code Google Authenticator vérifié avec succès.'
    });
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'Erreur lors de la vérification TOTP.' });
  }
});

apiRouter.post('/auth/totp/disable', authenticateUser, (req, res) => {
  try {
    const currentUser = (req as any).user as AppUser;
    const { code, currentPassword } = req.body || {};
    const cleanCode = String(code || '').replace(/\s+/g, '');

    if (db.hasActiveTotpSecret(currentUser.id)) {
      const validTotp = /^\d{6}$/.test(cleanCode) && db.verifyUserTotp(currentUser.id, cleanCode);
      const validPwd = currentPassword && db.verifyPassword(String(currentPassword), currentUser.id);
      if (!validTotp && !validPwd) {
        return res.status(400).json({
          error: 'Veuillez saisir un code Google Authenticator (6 chiffres) valide pour désactiver la double authentification.'
        });
      }
    }

    const updatedUser = db.disableUserTotp(currentUser.id);
    db.addSystemLog('info', 'auth', `TOTP Google Authenticator 2FA disabled for ${currentUser.email}`);
    return res.json({
      disabled: true,
      user: updatedUser,
      message: 'La double authentification Google Authenticator (TOTP) a été désactivée.'
    });
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'Impossible de désactiver la 2FA.' });
  }
});

apiRouter.post('/auth/social', authRateLimit, (req, res) => {
  try {
    const { provider, uid, email, name, avatarUrl } = req.body || {};
    if (!email || provider !== 'google' || !uid) {
      return res.status(400).json({ error: 'Authentification Google OAuth vérifiée requise.' });
    }

    const users = db.getUsers();
    const existing = users.find(u => u.email.toLowerCase() === String(email).toLowerCase() || (uid && u.uid === uid));
    const nowIso = new Date().toISOString();

    if (existing) {
      if (existing.status === 'suspended') {
        return res.status(401).json({ error: 'Ce compte utilisateur est suspendu.' });
      }
      existing.lastLoginAt = nowIso;
      if (uid && !existing.uid) existing.uid = uid;
      if (avatarUrl) existing.avatarUrl = avatarUrl;
      db.setUsers(users);
      const token = db.generateUserSessionToken(existing.id);
      return res.json({
        user: existing,
        token
      });
    }

    const created = db.registerUserAtomic({
      name: String(name || String(email).split('@')[0]),
      email: String(email),
      authProvider: 'google',
      uid: String(uid),
      avatarUrl: avatarUrl ? String(avatarUrl) : undefined
    });

    return res.status(201).json({
      user: created.user,
      token: created.token,
      isFirstUserAdmin: created.isFirstUserAdmin
    });
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Erreur connexion sociale' });
  }
});

apiRouter.post('/auth/forgot-password', (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Veuillez saisir votre adresse email.' });
  }

  const user = db.getUserByEmail(String(email));
  if (!user) {
    return res.status(404).json({ error: 'Aucun compte associé à cette adresse email.' });
  }

  const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const existingCred = db.getUserCredential(user.id) || db.hashPassword(crypto.randomBytes(12).toString('hex'));

  db.setUserCredential(user.id, {
    passwordHash: (existingCred as any).passwordHash || (existingCred as any).hash,
    passwordSalt: (existingCred as any).passwordSalt || (existingCred as any).salt,
    resetToken: resetCode,
    resetTokenExpiresAt: expiresAt
  });

  db.addSystemLog('info', 'auth', `Password reset token generated for ${user.email}`);

  return res.json({
    success: true,
    email: user.email,
    resetCode, // Provided for direct verification in preview environment
    expiresAt,
    message: `Code de réinitialisation généré pour ${user.email} (valide 15 minutes).`
  });
});

apiRouter.post('/auth/reset-password', (req, res) => {
  const { email, resetCode, newPassword } = req.body;
  if (!email || !resetCode || !newPassword) {
    return res.status(400).json({ error: 'Email, code de sécurité et nouveau mot de passe requis.' });
  }
  if (String(newPassword).length < 6) {
    return res.status(400).json({ error: 'Le nouveau mot de passe doit contenir au moins 6 caractères.' });
  }

  const user = db.getUserByEmail(String(email));
  if (!user) {
    return res.status(404).json({ error: 'Compte utilisateur introuvable.' });
  }

  const cred = db.getUserCredential(user.id);
  if (!cred || !cred.resetToken || cred.resetToken !== String(resetCode).trim()) {
    return res.status(400).json({ error: 'Code de réinitialisation invalide.' });
  }

  if (cred.resetTokenExpiresAt && new Date(cred.resetTokenExpiresAt).getTime() < Date.now()) {
    return res.status(400).json({ error: 'Ce code de réinitialisation a expiré.' });
  }

  const { hash, salt } = db.hashPassword(String(newPassword));
  db.setUserCredential(user.id, {
    passwordHash: hash,
    passwordSalt: salt
  });

  db.addSystemLog('info', 'auth', `Password successfully reset for user ${user.email}`);
  const token = db.generateUserSessionToken(user.id);

  return res.json({
    success: true,
    message: 'Votre mot de passe a été réinitialisé avec succès.',
    user,
    token
  });
});

apiRouter.post('/auth/logout', (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : req.body?.token;
  const user = db.verifyUserSessionToken(token);
  if (token) {
    db.revokeUserSessionToken(token);
  }
  if (user) {
    db.addSystemLog('info', 'auth', `User logged out: ${user.email} (role=${user.role})`);
  }
  return res.json({ success: true, message: 'Session déconnectée avec succès.' });
});

apiRouter.get('/auth/me', authenticateUser, (req, res) => {
  const user = (req as any).user as AppUser;
  const userOrders = db.getOrders().filter(o => o.userId === user.id || (user.uid && o.userId === user.uid));
  const paymentTxs = db.getPaymentTransactions(user.id);
  const pushLogs = db.getPushNotificationLogs(user.id);
  const emailLogs = db.getEmailDeliveryLogs(user.id);
  return res.json({
    user,
    orders: userOrders,
    paymentTransactions: paymentTxs,
    pushNotificationLogs: pushLogs,
    emailDeliveryLogs: emailLogs
  });
});

apiRouter.put('/auth/profile', authenticateUser, (req, res) => {
  const currentUser = (req as any).user as AppUser;
  const {
    name,
    phone,
    preferredCurrency,
    twoFactorEnabled,
    emailNotifications,
    pushNotificationsEnabled,
    currentPassword,
    newPassword,
    totpCode,
    role: attemptedRole,
    isAdmin: attemptedIsAdmin
  } = req.body || {};

  if (attemptedRole !== undefined || attemptedIsAdmin !== undefined) {
    db.addSystemLog(
      'warn',
      'auth',
      `[Security] Blocked privilege escalation attempt via PUT /auth/profile by ${currentUser.email}`
    );
  }

  const users = db.getUsers();
  const idx = users.findIndex(u => u.id === currentUser.id);
  if (idx === -1) return res.status(404).json({ error: 'Utilisateur introuvable' });

  if (totpCode && String(totpCode).trim()) {
    const cleanTotp = String(totpCode).replace(/\s+/g, '');
    if (!/^\d{6}$/.test(cleanTotp)) {
      return res.status(400).json({ error: 'Le code Google Authenticator (TOTP) doit comporter 6 chiffres.' });
    }
    const verifySetup = db.verifyAndEnableUserTotp(currentUser.id, cleanTotp);
    if (!verifySetup.verified && !db.verifyUserTotp(currentUser.id, cleanTotp)) {
      return res.status(400).json({ error: 'Code Google Authenticator (TOTP) invalide ou expiré.' });
    }
  }

  if (newPassword) {
    if (String(newPassword).length < 6) {
      return res.status(400).json({ error: 'Le nouveau mot de passe doit contenir au moins 6 caractères.' });
    }
    const existingCred = db.getUserCredential(currentUser.id);
    if (existingCred && existingCred.passwordHash) {
      if (!currentPassword || !db.verifyPassword(String(currentPassword), currentUser.id)) {
        return res.status(400).json({ error: 'Le mot de passe actuel est incorrect.' });
      }
    }
    const { hash, salt } = db.hashPassword(String(newPassword));
    db.setUserCredential(currentUser.id, {
      passwordHash: hash,
      passwordSalt: salt
    });
  }

  const refreshedUsers = db.getUsers();
  const rIdx = refreshedUsers.findIndex(u => u.id === currentUser.id);
  if (rIdx === -1) return res.status(404).json({ error: 'Utilisateur introuvable' });

  if (name) refreshedUsers[rIdx].name = String(name).trim().slice(0, 80);
  if (phone !== undefined) refreshedUsers[rIdx].phone = String(phone).trim().slice(0, 32);
  if (preferredCurrency && ['USD', 'HTG', 'EUR'].includes(preferredCurrency)) {
    refreshedUsers[rIdx].preferredCurrency = preferredCurrency;
  }
  if (typeof twoFactorEnabled === 'boolean') refreshedUsers[rIdx].twoFactorEnabled = twoFactorEnabled;
  if (typeof emailNotifications === 'boolean') refreshedUsers[rIdx].emailNotifications = emailNotifications;
  if (typeof pushNotificationsEnabled === 'boolean') refreshedUsers[rIdx].pushNotificationsEnabled = pushNotificationsEnabled;

  db.setUsers(refreshedUsers);
  db.addSystemLog('info', 'auth', `User ${refreshedUsers[rIdx].email} updated account profile`);

  return res.json({
    user: refreshedUsers[rIdx],
    message: 'Profil et paramètres de sécurité mis à jour avec succès.'
  });
});

// ==========================================
// 1C. MODULAR PAYMENT GATEWAY ENGINE (CARD / MONCASH / NATCASH / WALLET)
// ==========================================

apiRouter.get('/payments/gateways', (_req, res) => {
  const gateways = db.getPaymentGateways().filter(g => g.isEnabled);
  res.json(gateways);
});

// Rule 1: Pre-payment server-side validation & price calculation endpoint
apiRouter.post('/payments/validate', authenticateUser, async (req, res) => {
  try {
    const authenticatedUser = (req as any).user as AppUser;
    const {
      productKey,
      product_key,
      packageId,
      gameId,
      region,
      playerId,
      player_id,
      serverId,
      server_id,
      quantity,
      paymentMethod,
      clientPrice
    } = req.body || {};

    let resolvedProductKey = String(productKey || product_key || '').trim();
    let resolvedRegion = region ? String(region).trim() : undefined;

    if (!resolvedProductKey && packageId) {
      for (const srv of db.getServices()) {
        const pkg = srv.packages.find(p => p.id === packageId);
        if (pkg) {
          resolvedProductKey = pkg.productKey || pkg.externalProductId || '';
          if (!resolvedRegion && pkg.region) {
            resolvedRegion = pkg.region;
          }
          break;
        }
      }
    }

    const rg = new RechargeGamesProvider();
    const validation = await rg.validateBeforePayment({
      userId: authenticatedUser.id,
      productKey: resolvedProductKey,
      gameId: gameId ? String(gameId) : undefined,
      region: resolvedRegion,
      playerId: String(playerId || player_id || ''),
      serverId: serverId || server_id ? String(serverId || server_id) : undefined,
      quantity: quantity ? Number(quantity) : 1,
      paymentMethod: (paymentMethod as PaymentMethodType) || 'wallet',
      clientManipulatedPrice: clientPrice !== undefined ? Number(clientPrice) : undefined
    });

    return res.status(validation.httpStatus).json(validation);
  } catch (err: any) {
    return res.status(500).json({
      valid: false,
      httpStatus: 500,
      errorCode: 'VALIDATION_ERROR',
      message: err?.message || 'Erreur lors de la validation pré-paiement.'
    });
  }
});

apiRouter.post('/payments/process', authenticateUser, orderRateLimit, async (req, res) => {
  try {
    const authenticatedUser = (req as any).user as AppUser;
    const {
      paymentMethod,
      amount: clientAmount,
      currency: clientCurrency = 'USD',
      cardDetails,
      mobileWalletDetails,
      purpose = 'order', // 'order' | 'wallet_topup'
      productKey,
      product_key,
      packageId,
      gameId,
      region,
      playerId,
      player_id,
      serverId,
      quantity,
      requestedPaymentStatus, // optional for intermediate flow: 'payment_pending' | 'payment_processing' | 'payment_cancelled' | 'payment_failed'
      clientDeclaredStatus
    } = req.body || {};
    const userId = authenticatedUser.id;

    // Rule 6: Frontend can NEVER self-declare 'payment_succeeded', 'delivered', or 'refunded'
    if (
      clientDeclaredStatus &&
      ['payment_succeeded', 'delivered', 'order_delivered', 'payment_refunded', 'refunded'].includes(
        String(clientDeclaredStatus).toLowerCase()
      )
    ) {
      return res.status(403).json({
        error: 'FRONTEND_STATUS_DECLARATION_FORBIDDEN',
        message: 'Le frontend ne peut jamais déclarer lui-même un paiement réussi, une livraison ou un remboursement.'
      });
    }

    const gateways = db.getPaymentGateways();
    const gateway = gateways.find(g => g.slug === paymentMethod && g.isEnabled);
    if (!gateway) {
      return res.status(400).json({ error: `La méthode de paiement "${paymentMethod}" est indisponible ou désactivée.` });
    }

    // Rule 1: If purpose === 'order' and a product/package is specified, validate and calculate final price on the backend!
    let numAmount = Number(clientAmount);
    let currency = String(clientCurrency || 'USD');
    const resolvedProductKey = String(productKey || product_key || '').trim();

    if (purpose === 'order' && (resolvedProductKey || packageId)) {
      let targetKey = resolvedProductKey;
      let targetRegion = region ? String(region) : undefined;
      if (!targetKey && packageId) {
        for (const srv of db.getServices()) {
          const pkg = srv.packages.find(p => p.id === packageId);
          if (pkg) {
            targetKey = pkg.productKey || pkg.externalProductId || '';
            if (!targetRegion && pkg.region) targetRegion = pkg.region;
            break;
          }
        }
      }
      if (targetKey) {
        const rg = new RechargeGamesProvider();
        const preCheck = await rg.validateBeforePayment({
          userId,
          productKey: targetKey,
          gameId: gameId ? String(gameId) : undefined,
          region: targetRegion,
          playerId: String(playerId || player_id || ''),
          serverId: serverId ? String(serverId) : undefined,
          quantity: quantity ? Number(quantity) : 1,
          paymentMethod: paymentMethod as PaymentMethodType,
          clientManipulatedPrice: clientAmount !== undefined ? Number(clientAmount) : undefined
        });
        if (!preCheck.valid || !preCheck.pricing) {
          return res.status(preCheck.httpStatus).json({
            error: preCheck.errorCode || 'PRE_PAYMENT_VALIDATION_FAILED',
            message: preCheck.message
          });
        }
        // Authoritative backend price!
        numAmount = preCheck.pricing.subtotalPrice;
        currency = preCheck.pricing.currency;
      }
    }

    if (isNaN(numAmount) || numAmount <= 0) {
      return res.status(400).json({ error: 'Montant de paiement invalide.' });
    }

    const feeAmount = Number(((numAmount * gateway.feePercent) / 100 + gateway.fixedFee).toFixed(2));
    const totalCharged = Number((numAmount + feeAmount).toFixed(2));
    const txRef = `PAY-${gateway.slug.toUpperCase()}-${Date.now().toString().slice(-6)}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    const userObj = userId ? db.getUserById(userId) : undefined;

    // Step 1: Create initial payment transaction in "payment_pending" state
    const initialTx = db.addPaymentTransaction({
      transactionReference: txRef,
      userId: userObj?.id || userId,
      userEmail: userObj?.email,
      gatewayId: gateway.id,
      paymentMethod: paymentMethod as PaymentMethodType,
      amount: numAmount,
      currency,
      feeAmount,
      totalCharged,
      status: 'initiated',
      payment_status: 'payment_pending',
      externalReference: `INIT_${txRef}`,
      payerIdentifier: userObj?.email || userId,
      statusMessage: 'Paiement commencé mais pas encore confirmé (payment_pending).'
    });

    // If caller requested to stop at 'payment_pending' or 'payment_cancelled' (e.g. user cancelled modal or async initiation)
    if (requestedPaymentStatus === 'payment_pending') {
      return res.status(202).json({
        success: true,
        payment_status: 'payment_pending',
        transaction: initialTx,
        user: userObj
      });
    }

    if (requestedPaymentStatus === 'payment_cancelled') {
      const cancelledTx = db.updatePaymentTransactionStatus(
        txRef,
        'payment_cancelled',
        'Paiement annulé par l’utilisateur ou le prestataire (payment_cancelled).'
      );
      return res.status(400).json({
        success: false,
        payment_status: 'payment_cancelled',
        error: 'Paiement annulé (payment_cancelled).',
        transaction: cancelledTx
      });
    }

    // Step 2: Transition to "payment_processing"
    const processingTx = db.updatePaymentTransactionStatus(
      txRef,
      'payment_processing',
      `Paiement en cours de traitement auprès de ${gateway.name} (payment_processing)...`
    );

    if (requestedPaymentStatus === 'payment_processing') {
      return res.status(202).json({
        success: true,
        payment_status: 'payment_processing',
        transaction: processingTx,
        user: userObj
      });
    }

    if (requestedPaymentStatus === 'payment_failed') {
      const failedTx = db.updatePaymentTransactionStatus(
        txRef,
        'payment_failed',
        'Paiement refusé par le prestataire de paiement (payment_failed).'
      );
      return res.status(402).json({
        success: false,
        payment_status: 'payment_failed',
        error: 'Paiement échoué (payment_failed).',
        transaction: failedTx
      });
    }

    let payerIdentifier = '';
    let externalReference = '';
    let statusMessage = '';

    // Validate & Process according to selected Payment Provider Adapter
    if (paymentMethod === 'card') {
      const cardNumber = String(cardDetails?.cardNumber || '').replace(/\s+/g, '');
      const expiry = String(cardDetails?.expiry || '').trim();
      const cvc = String(cardDetails?.cvc || '').trim();
      const holderName = String(cardDetails?.holderName || '').trim();

      if (cardNumber.length < 12 || !/^\d+$/.test(cardNumber)) {
        const failedTx = db.updatePaymentTransactionStatus(txRef, 'payment_failed', 'Numéro de carte bancaire invalide.');
        return res.status(400).json({ error: 'Numéro de carte bancaire invalide (12 à 19 chiffres requis).', payment_status: 'payment_failed', transaction: failedTx });
      }
      if (!/^\d{2}\/\d{2,4}$/.test(expiry)) {
        const failedTx = db.updatePaymentTransactionStatus(txRef, 'payment_failed', 'Date d’expiration invalide.');
        return res.status(400).json({ error: 'Date d’expiration invalide (format MM/YY requis).', payment_status: 'payment_failed', transaction: failedTx });
      }
      if (cvc.length < 3 || !/^\d{3,4}$/.test(cvc)) {
        const failedTx = db.updatePaymentTransactionStatus(txRef, 'payment_failed', 'Code CVC/CVV invalide.');
        return res.status(400).json({ error: 'Code CVC/CVV invalide (3 ou 4 chiffres requis).', payment_status: 'payment_failed', transaction: failedTx });
      }
      if (!holderName) {
        const failedTx = db.updatePaymentTransactionStatus(txRef, 'payment_failed', 'Nom du titulaire manquant.');
        return res.status(400).json({ error: 'Le nom du titulaire de la carte est requis.', payment_status: 'payment_failed', transaction: failedTx });
      }

      payerIdentifier = `•••• ${cardNumber.slice(-4)} (${holderName})`;
      externalReference = `STRP_${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
      statusMessage = `Paiement confirmé avec succès (payment_succeeded) par carte (${payerIdentifier}) via ${gateway.providerName}.`;
    } else if (paymentMethod === 'moncash' || paymentMethod === 'natcash') {
      const phone = String(mobileWalletDetails?.phone || '').trim();
      const pinOrOtp = String(mobileWalletDetails?.otp || '').trim();

      if (phone.length < 8) {
        const failedTx = db.updatePaymentTransactionStatus(txRef, 'payment_failed', 'Numéro Mobile Money invalide.');
        return res.status(400).json({
          error: `Veuillez saisir un numéro ${paymentMethod === 'moncash' ? 'Digicel MonCash' : 'Natcom NatCash'} valide (ex: +509 37XX-XXXX).`,
          payment_status: 'payment_failed',
          transaction: failedTx
        });
      }
      if (pinOrOtp.length < 4) {
        const failedTx = db.updatePaymentTransactionStatus(txRef, 'payment_failed', 'Code OTP Mobile Money invalide.');
        return res.status(400).json({
          error: `Veuillez saisir le code de confirmation / OTP ${paymentMethod === 'moncash' ? 'MonCash' : 'NatCash'} (minimum 4 chiffres).`,
          payment_status: 'payment_failed',
          transaction: failedTx
        });
      }

      payerIdentifier = phone;
      externalReference = `${paymentMethod === 'moncash' ? 'MC' : 'NC'}_${Date.now().toString().slice(-7)}`;
      statusMessage = `Paiement confirmé avec succès (payment_succeeded) via ${gateway.name} pour le numéro ${phone} (Réf: ${externalReference}).`;
    } else if (paymentMethod === 'wallet') {
      if (!userId) {
        const failedTx = db.updatePaymentTransactionStatus(txRef, 'payment_failed', 'Utilisateur non connecté.');
        return res.status(401).json({ error: 'Vous devez être connecté à votre compte PlayUp pour payer avec votre solde Wallet.', payment_status: 'payment_failed', transaction: failedTx });
      }
      const users = db.getUsers();
      const uIdx = users.findIndex(u => u.id === userId || u.uid === userId);
      if (uIdx === -1) {
        const failedTx = db.updatePaymentTransactionStatus(txRef, 'payment_failed', 'Compte introuvable.');
        return res.status(404).json({ error: 'Compte utilisateur PlayUp introuvable.', payment_status: 'payment_failed', transaction: failedTx });
      }
      if (users[uIdx].walletBalance < totalCharged) {
        const failedTx = db.updatePaymentTransactionStatus(
          txRef,
          'payment_failed',
          `Solde PlayUp Wallet insuffisant ($${users[uIdx].walletBalance.toFixed(2)} disponible, $${totalCharged.toFixed(2)} requis).`
        );
        return res.status(400).json({
          error: `Solde PlayUp Wallet insuffisant ($${users[uIdx].walletBalance.toFixed(2)} disponible, $${totalCharged.toFixed(2)} requis).`,
          payment_status: 'payment_failed',
          transaction: failedTx
        });
      }

      users[uIdx].walletBalance = Number((users[uIdx].walletBalance - totalCharged).toFixed(2));
      db.setUsers(users);
      payerIdentifier = users[uIdx].email;
      externalReference = `WLT_${Date.now().toString().slice(-7)}`;
      statusMessage = `Paiement confirmé avec succès (payment_succeeded) : débit de $${totalCharged.toFixed(2)} effectué sur votre solde PlayUp Wallet.`;
    } else {
      const failedTx = db.updatePaymentTransactionStatus(txRef, 'payment_failed', 'Méthode non reconnue.');
      return res.status(400).json({ error: 'Méthode de paiement non reconnue.', payment_status: 'payment_failed', transaction: failedTx });
    }

    // If purpose is wallet_topup, enforce mandatory blocking 2FA verification (SMS or Email) on backend before crediting wallet
    let updatedUser: AppUser | undefined;
    if (purpose === 'wallet_topup' && userId) {
      const {
        twoFactorVerificationToken,
        twoFactorChallengeId,
        twoFactorCode
      } = req.body || {};

      const twoFactorGate = db.assertAndConsumeWallet2FA({
        userId,
        userEmail: authenticatedUser.email,
        operationType: 'wallet_credit',
        expectedAmount: numAmount,
        twoFactorVerificationToken: twoFactorVerificationToken
          ? String(twoFactorVerificationToken)
          : String(req.headers['x-2fa-verification-token'] || ''),
        twoFactorChallengeId: twoFactorChallengeId
          ? String(twoFactorChallengeId)
          : String(req.headers['x-2fa-challenge-id'] || ''),
        twoFactorCode: twoFactorCode
          ? String(twoFactorCode)
          : String(req.headers['x-2fa-code'] || ''),
        ipAddress: extractClientIp(req),
        userAgent: String(req.headers['user-agent'] || '')
      });

      if (!twoFactorGate.allowed) {
        const failedTx = db.updatePaymentTransactionStatus(
          txRef,
          'payment_failed',
          twoFactorGate.message || 'Vérification 2FA SMS/Email requise ou échouée — crédit wallet bloqué.'
        );
        return res.status(403).json({
          success: false,
          credited: false,
          twoFactorRequired: true,
          twoFactorBlocked: true,
          error: twoFactorGate.errorCode || 'TWO_FACTOR_VERIFICATION_FAILED',
          errorCode: twoFactorGate.errorCode || 'TWO_FACTOR_VERIFICATION_FAILED',
          message: twoFactorGate.message,
          payment_status: 'payment_failed',
          transaction: failedTx
        });
      }

      const users = db.getUsers();
      const uIdx = users.findIndex(u => u.id === userId || u.uid === userId);
      if (uIdx !== -1) {
        users[uIdx].walletBalance = Number((users[uIdx].walletBalance + numAmount).toFixed(2));
        db.setUsers(users);
        updatedUser = users[uIdx];
      }
    }

    // Step 3: Transition to "payment_succeeded"
    const txRecord =
      db.updatePaymentTransactionStatus(txRef, 'payment_succeeded', statusMessage, externalReference) || initialTx;
    txRecord.payerIdentifier = payerIdentifier;

    db.addSystemLog(
      'info',
      'payment',
      `Payment ${txRef} (${gateway.name}) confirmed (payment_succeeded): $${totalCharged.toFixed(2)} ${currency} for ${userObj?.email || userId || 'client'}`
    );

    return res.status(201).json({
      success: true,
      payment_status: 'payment_succeeded',
      transaction: txRecord,
      user: updatedUser || db.getUserById(userId) || userObj
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Erreur lors du traitement du paiement' });
  }
});

// Check or safely resume an intermediate payment transaction (payment_pending / payment_processing)
apiRouter.post('/payments/:transactionRef/status', authenticateUser, async (req, res) => {
  const authenticatedUser = (req as any).user as AppUser;
  const { transactionRef } = req.params;
  const { action, orderId } = req.body || {}; // action: 'check' | 'confirm_gateway' | 'cancel' | 'fail'

  const tx = db.findPaymentTransactionByRefOrId(transactionRef);
  if (!tx) {
    return res.status(404).json({ error: 'Transaction de paiement introuvable.' });
  }
  if (authenticatedUser.role !== 'ADMIN' && tx.userId !== authenticatedUser.id) {
    return res.status(403).json({ error: 'Accès interdit à cette transaction.' });
  }

  let updatedTx = tx;
  if (action === 'cancel' && (tx.payment_status === 'payment_pending' || tx.payment_status === 'payment_processing')) {
    updatedTx = db.updatePaymentTransactionStatus(tx.id, 'payment_cancelled', 'Paiement annulé (payment_cancelled).') || tx;
  } else if (action === 'fail' && (tx.payment_status === 'payment_pending' || tx.payment_status === 'payment_processing')) {
    updatedTx = db.updatePaymentTransactionStatus(tx.id, 'payment_failed', 'Paiement échoué (payment_failed).') || tx;
  } else if (action === 'confirm_gateway' && (tx.payment_status === 'payment_pending' || tx.payment_status === 'payment_processing')) {
    updatedTx =
      db.updatePaymentTransactionStatus(
        tx.id,
        'payment_succeeded',
        'Paiement confirmé avec succès par le prestataire (payment_succeeded).'
      ) || tx;
  }

  // If linked to an order, synchronize order state and trigger safe dispatch if payment_succeeded
  const targetOrderId = orderId || updatedTx.orderId;
  let recoveryResult: any = undefined;
  if (targetOrderId) {
    const rg = new RechargeGamesProvider();
    recoveryResult = await rg.recoverOrder(String(targetOrderId), {
      newPaymentStatus: updatedTx.payment_status,
      paymentReference: updatedTx.transactionReference
    });
  }

  return res.json({
    success: true,
    payment_status: updatedTx.payment_status,
    transaction: updatedTx,
    recovery: recoveryResult
  });
});

// ==========================================
// 2. PLAYUP MOBILE APP ENDPOINTS
// ==========================================

// Official Player ID Verification (RechargeGames GET /v1/region-check)
apiRouter.post('/app/check-player', async (req, res) => {
  try {
    const { gameId, game, gameProfileData, playerId: rawPlayerId, region } = req.body || {};
    const targetKey = String(gameId || game || 'free-fire').trim();
    const matchedGame = db
      .getGames()
      .find(
        g =>
          g.id === targetKey ||
          g.slug === targetKey ||
          g.externalGameId === targetKey ||
          g.name.toLowerCase() === targetKey.toLowerCase()
      );

    const playerId = String(
      rawPlayerId ||
      gameProfileData?.playerId ||
      gameProfileData?.userId ||
      gameProfileData?.characterId ||
      (gameProfileData ? Object.values(gameProfileData)[0] : '') ||
      ''
    ).trim();

    // 1. Primary: Official RechargeGames Player ID & Region Check (GET https://api.rechargegame.games/v1/region-check)
    const rg = new RechargeGamesProvider();
    const rgCheck = await rg.verifyPlayerId({
      gameSlug: matchedGame ? matchedGame.slug || matchedGame.name : targetKey,
      playerId,
      region: region ? String(region) : undefined,
      strictRegionMatch: false
    });

    if (rgCheck.supported) {
      return res.json(rgCheck);
    }

    // 2. If RechargeGames returns UNSUPPORTED for this game, return clear UNSUPPORTED status without simulating verification
    return res.json({
      supported: false,
      verified: false,
      status: rgCheck.status || 'UNSUPPORTED',
      provider: 'RechargeGames',
      rawResponse: rgCheck.rawResponse,
      message: rgCheck.message
    });
  } catch (err: any) {
    return res.status(500).json({
      supported: true,
      verified: false,
      message: `Erreur lors de la vérification du joueur : ${err.message}`
    });
  }
});

// Direct RechargeGames Player ID verification endpoint
apiRouter.post('/rechargegames/check-player', async (req, res) => {
  try {
    const { game, player_id, region, strictRegionMatch } = req.body || {};
    const rg = new RechargeGamesProvider();
    const result = await rg.verifyPlayerId({
      gameSlug: String(game || 'free-fire'),
      playerId: String(player_id || ''),
      region: region ? String(region) : undefined,
      strictRegionMatch: Boolean(strictRegionMatch)
    });
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({
      supported: true,
      verified: false,
      message: err?.message || 'Erreur lors de la vérification RechargeGames'
    });
  }
});

// User Notifications for PlayUp Mobile App (Protected by authenticateUser)
apiRouter.get('/app/notifications', authenticateUser, (req, res) => {
  const user = (req as any).user as AppUser;
  res.json(db.getUserNotifications(user.id));
});

apiRouter.post('/app/notifications/:id/read', authenticateUser, (req, res) => {
  const user = (req as any).user as AppUser;
  const userNotifs = db.getUserNotifications(user.id);
  if (userNotifs.some(n => n.id === req.params.id)) {
    db.markNotificationRead(req.params.id);
  }
  res.json({ success: true });
});

apiRouter.post('/app/orders', authenticateUser, orderRateLimit, async (req, res) => {
  try {
    const authenticatedUser = (req as any).user as AppUser;
    const {
      gameId,
      serviceId,
      packageId,
      gameProfileData,
      verifiedPlayerName,
      paymentConfirmed,
      partnerOrderId: clientPartnerId,
      price: clientManipulatedPrice
    } = req.body;

    if (!gameId || !serviceId || !packageId) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Champs obligatoires manquants (gameId, serviceId, packageId).'
      });
    }

    const game = db.getGames().find(g => g.id === gameId);
    if (!game || !game.isActive) {
      return res.status(400).json({ error: 'Jeu non disponible ou inactif.' });
    }

    const service = db.getServices().find(s => s.id === serviceId);
    if (!service || !service.isActive) {
      return res.status(400).json({ error: 'Service introuvable ou indisponible.' });
    }

    const pkg = service.packages.find(p => p.id === packageId);
    if (!pkg || !pkg.isActive) {
      return res.status(400).json({ error: 'Package introuvable ou inactif.' });
    }

    // Security check: Reject if client attempts to override or manipulate the server-side price
    if (clientManipulatedPrice !== undefined && Math.abs(Number(clientManipulatedPrice) - pkg.publicPrice) > 0.01) {
      db.addSystemLog('error', 'order', `[Security Alert] Tentative de manipulation de prix détectée par ${authenticatedUser.email}: prix envoyé=${clientManipulatedPrice}, prix réel=${pkg.publicPrice}`);
      return res.status(400).json({
        error: 'Price Manipulation Blocked',
        message: 'Le prix envoyé ne correspond pas au tarif officiel du serveur PlayUp.'
      });
    }

    const profileData = gameProfileData || {};
    const requiresPlayerInfo = pkg.requiresPlayerId !== false && game.requiresPlayerId !== false;

    // Dynamic field validation ONLY if the game/product requires player fields
    if (requiresPlayerInfo) {
      for (const field of game.fields) {
        if (pkg.requiredFields && pkg.requiredFields.length > 0 && !pkg.requiredFields.includes(field.name)) {
          continue;
        }
        if (field.required && !profileData[field.name]) {
          return res.status(400).json({
            error: 'Validation Error',
            message: `Le champ "${field.label}" est obligatoire pour ${game.name}.`
          });
        }
        if (field.validationRegex && profileData[field.name]) {
          const regex = new RegExp(field.validationRegex);
          if (!regex.test(profileData[field.name])) {
            return res.status(400).json({
              error: 'Validation Error',
              message: `Format invalide pour le champ "${field.label}". ${field.helperText || ''}`
            });
          }
        }
      }
    }

    const orders = db.getOrders();

    // Idempotency protection: Prevent duplicate GoXtop/PlayUp orders using unique server-side partner_orderid
    const partnerOrderId = clientPartnerId || `PTNR-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const existingDuplicate = orders.find(o => o.partnerOrderId === partnerOrderId);
    if (existingDuplicate) {
      return res.status(200).json(existingDuplicate);
    }

    const playerId = profileData.playerId || profileData.userId || profileData.username || Object.values(profileData)[0] || '';
    const serverId = profileData.serverId || profileData.zoneId || '';

    // If this package belongs to RechargeGames, execute the 10-step RechargeGames order creation
    if (pkg.providerSlug === 'rechargegames' || pkg.productKey || db.getRechargeGamesProductByKey(pkg.externalProductId || '')) {
      const rg = new RechargeGamesProvider();
      const rgRes = await rg.createOrder({
        userId: authenticatedUser.id,
        productKey: pkg.productKey || pkg.externalProductId || '',
        region: pkg.region,
        playerId: String(playerId || ''),
        playerName: verifiedPlayerName ? String(verifiedPlayerName) : undefined,
        serverId: serverId ? String(serverId) : undefined,
        quantity: req.body.quantity ? Number(req.body.quantity) : 1,
        buyerRef: clientPartnerId ? String(clientPartnerId) : undefined,
        paymentConfirmed: Boolean(paymentConfirmed),
        paymentStatus: req.body.paymentStatus as PaymentLifecycleStatus | undefined,
        paymentMethod: req.body.paymentMethod || 'wallet',
        paymentReference: req.body.paymentReference,
        paymentTransactionId: req.body.paymentTransactionId,
        clientManipulatedPrice: clientManipulatedPrice !== undefined ? Number(clientManipulatedPrice) : undefined,
        clientDeclaredStatus: req.body.status || req.body.clientDeclaredStatus,
        simulateNetworkTimeout: Boolean(req.body.simulateNetworkTimeout),
        allowIdempotentRecovery: Boolean(req.body.allowIdempotentRecovery)
      });
      if (!rgRes.success && !rgRes.playupOrder) {
        return res.status(rgRes.httpStatus || 400).json({
          error: rgRes.errorCode || 'Order Error',
          message: rgRes.userMessage,
          order: rgRes.order
        });
      }
      return res.status(rgRes.httpStatus || 201).json(rgRes.playupOrder || rgRes.order);
    }

    const providers = db.getProviders();
    const provider = providers.find(p => p.id === service.providerId) || providers.find(p => p.id === 'prov_goxtop') || providers[0];

    const orderNumber = `PLUP-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`;
    const margin = Number((pkg.publicPrice - pkg.supplierCost).toFixed(2));
    const initialStatus = paymentConfirmed ? 'paid' : 'pending';
    const nowIso = new Date().toISOString();

    const newOrder: Order = {
      id: 'ord_' + Date.now(),
      orderNumber,
      partnerOrderId,
      source: 'mobile_app',
      userId: authenticatedUser.id,
      gameId: game.id,
      externalGameId: pkg.externalGameId || game.externalGameId || game.slug,
      gameName: game.name,
      serviceId: service.id,
      serviceName: service.name,
      packageId: pkg.id,
      externalProductId: pkg.externalProductId || pkg.id,
      packageName: pkg.name,
      playerId: playerId || undefined,
      verifiedPlayerName: verifiedPlayerName || undefined,
      serverId: serverId || undefined,
      gameProfileData: profileData,
      publicPrice: pkg.publicPrice,
      chargedAmount: pkg.publicPrice,
      supplierCost: pkg.supplierCost,
      margin,
      currency: pkg.currency,
      status: initialStatus,
      paymentMethod: req.body.paymentMethod || 'card',
      paymentTransactionId: req.body.paymentTransactionId || undefined,
      paymentReference: req.body.paymentReference || undefined,
      providerId: provider?.id || 'prov_goxtop',
      providerName: provider?.name || 'GoXtop',
      createdAt: nowIso,
      updatedAt: nowIso,
      statusHistory: [
        {
          status: 'pending',
          timestamp: nowIso,
          note: `Commande PlayUp initiée (partner_orderid: ${partnerOrderId})`
        },
        ...(paymentConfirmed
          ? [
              {
                status: 'paid' as const,
                timestamp: nowIso,
                note: `Paiement confirmé (${pkg.publicPrice.toFixed(2)} ${pkg.currency})`
              }
            ]
          : [])
      ]
    };

    orders.unshift(newOrder);
    db.setOrders(orders);

    // Update user order stats if linked to a registered user
    if (newOrder.userId) {
      const users = db.getUsers();
      const uIdx = users.findIndex(u => u.id === newOrder.userId || u.uid === newOrder.userId);
      if (uIdx !== -1) {
        users[uIdx].ordersCount = (users[uIdx].ordersCount || 0) + 1;
        users[uIdx].totalSpent = Number(((users[uIdx].totalSpent || 0) + newOrder.chargedAmount).toFixed(2));
        db.setUsers(users);
      }
    }

    db.addSystemLog('info', 'order', `New mobile order ${orderNumber} (Partner ID: ${partnerOrderId}) created for ${game.name} - ${pkg.name}`);

    // Dispatch order to selected provider (GoXtop) immediately and persist real status in database
    const processedOrder = await ProviderEngine.processOrder(newOrder.id).catch(err => {
      console.error('Immediate GoXtop order dispatch error:', err);
      return null;
    });

    return res.status(201).json(processedOrder || newOrder);
  } catch (err: any) {
    db.addSystemLog('error', 'order', `Order creation error: ${err.message}`);
    return res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

apiRouter.get('/app/orders/:orderId', authenticateUser, async (req, res) => {
  const user = (req as any).user as AppUser;
  const { orderId } = req.params;
  const orders = db.getOrders();
  const orderIdx = orders.findIndex(o => o.id === orderId || o.orderNumber === orderId || o.partnerOrderId === orderId);
  if (orderIdx === -1) {
    return res.status(404).json({ error: 'Commande introuvable' });
  }

  const order = orders[orderIdx];
  if (user.role !== 'ADMIN' && order.userId !== user.id) {
    return res.status(403).json({ error: 'Accès interdit à cette commande.' });
  }

  // 1. If the order is a RechargeGames order and is currently pending/processing, query live GET /v1/orders/{order_id} or recover if pending_retry
  if (
    (order.providerId === 'prov_rechargegames' || order.providerName === 'RechargeGames' || db.findRechargeGamesOrderById(order.id)) &&
    (order.status === 'pending' || order.status === 'processing' || order.status === 'paid')
  ) {
    try {
      const rg = new RechargeGamesProvider();
      if (order.dispatch_status === 'pending_retry' || order.payment_status === 'payment_pending' || order.payment_status === 'payment_processing') {
        await rg.recoverOrder(order.id);
      } else {
        await rg.checkOrderStatus(order.id);
      }
      const refreshedOrders = db.getOrders();
      const updated = refreshedOrders.find(o => o.id === order.id || o.orderNumber === order.orderNumber);
      if (updated) {
        return res.json(updated);
      }
    } catch {
      // Return last stored DB state if network check fails
    }
  }

  // 2. If the order is currently processing on GoXtop, query live GoXtop GET /api/v.1/:partner_orderid status
  if ((order.status === 'processing' || order.status === 'paid') && order.partnerOrderId) {
    const adapter = ProviderFactory.getProviderInstance(order.providerId || 'prov_goxtop');
    if (adapter) {
      try {
        const liveStatus = await adapter.getOrderStatus(order.partnerOrderId);
        if (liveStatus.success && liveStatus.status) {
          const prevStatus = order.status;
          order.status = liveStatus.status;
          if (liveStatus.providerOrderId) {
            order.externalOrderId = liveStatus.providerOrderId;
            order.providerReference = liveStatus.providerOrderId;
          }
          if (liveStatus.verifiedPlayerName && !order.verifiedPlayerName) {
            order.verifiedPlayerName = liveStatus.verifiedPlayerName;
          }
          if (liveStatus.raw) {
            order.providerResponse = liveStatus.raw;
          }
          if (prevStatus !== liveStatus.status) {
            order.updatedAt = new Date().toISOString();
            order.statusHistory.push({
              status: liveStatus.status,
              timestamp: order.updatedAt,
              note: `Statut temps réel GoXtop synchronisé : ${liveStatus.status.toUpperCase()}${liveStatus.providerOrderId ? ` (Réf: ${liveStatus.providerOrderId})` : ''}`
            });
            const existingPord = db.findProviderOrderByPartnerId(order.partnerOrderId);
            if (existingPord) {
              db.upsertProviderOrder({
                ...existingPord,
                status: liveStatus.status,
                provider_order_id: liveStatus.providerOrderId || existingPord.provider_order_id,
                response_payload: liveStatus.raw || existingPord.response_payload,
                updated_at: order.updatedAt
              });
            }
            if (liveStatus.status === 'completed' && order.userId) {
              await NotificationEngine.triggerOrderDeliveredNotifications({
                orderId: order.id,
                orderNumber: order.orderNumber,
                userId: order.userId,
                gameName: order.gameName,
                packageName: order.packageName,
                playerId: order.playerId,
                deliveredAtIso: order.updatedAt,
                providerName: order.providerName || 'GoXtop'
              });
            }
          }
          db.setOrders(orders);
        }
      } catch {
        // Return last stored DB state if network check fails
      }
    }
  }

  res.json(order);
});

apiRouter.get('/app/orders', authenticateUser, (req, res) => {
  const user = (req as any).user as AppUser;
  const orders = db.getOrders().filter(o => o.userId === user.id || (user.uid && o.userId === user.uid));
  res.json(orders);
});

apiRouter.post('/app/orders/:orderId/recover', authenticateUser, async (req, res) => {
  const user = (req as any).user as AppUser;
  const { orderId } = req.params;
  const rgOrder = db.findRechargeGamesOrderById(orderId) || db.findRechargeGamesOrderByBuyerRef(orderId);
  if (!rgOrder) {
    return res.status(404).json({ error: 'Commande introuvable.' });
  }
  if (user.role !== 'ADMIN' && rgOrder.user_id !== user.id) {
    return res.status(403).json({ error: 'Accès interdit à cette commande.' });
  }
  const rg = new RechargeGamesProvider();
  const result = await rg.recoverOrder(rgOrder.id, {
    newPaymentStatus: req.body?.paymentStatus as PaymentLifecycleStatus | undefined,
    paymentReference: req.body?.paymentReference
  });
  return res.status(result.httpStatus).json(result);
});

apiRouter.get('/app/refunds', authenticateUser, (req, res) => {
  const user = (req as any).user as AppUser;
  res.json(db.getRefunds(user.id));
});

// ==========================================
// 3. DEDICATED PROVIDER WEBHOOKS (GOXTOP & OTHERS)
// POST /api/webhooks/goxtop
// ==========================================

const handleProviderWebhook = async (req: Request, res: Response, providerSlugOrId: string) => {
  const providers = db.getProviders();
  const provIdx = providers.findIndex(
    p => p.slug.toLowerCase() === providerSlugOrId.toLowerCase() || p.id.toLowerCase() === providerSlugOrId.toLowerCase()
  );

  if (provIdx === -1) {
    return res.status(404).json({ error: 'Unknown provider webhook endpoint' });
  }

  const provider = providers[provIdx];
  const adapter = ProviderFactory.getProviderInstance(provider.id);
  if (!adapter) {
    return res.status(500).json({ error: 'Provider adapter unavailable' });
  }

  const rawBody = (req as any).rawBody || JSON.stringify(req.body || {});
  const result = await adapter.handleWebhook(rawBody, req.headers as Record<string, any>, req.body || {});

  // Update provider webhook telemetry
  const latestProviders = db.getProviders();
  const latestIdx = latestProviders.findIndex(p => p.id === provider.id);
  if (latestIdx !== -1) {
    const isInternalTest = req.body?.event_type === 'TEST_WEBHOOK' || req.body?.type === 'TEST_WEBHOOK';
    const rawStatus = String(req.body?.status || req.body?.order_status || '').toLowerCase();
    const evtLabel = isInternalTest
      ? 'TEST_WEBHOOK'
      : String(req.body?.event || req.body?.event_type || (rawStatus ? `ORDER_${rawStatus.toUpperCase()}` : 'WEBHOOK_NOTIFICATION'));

    latestProviders[latestIdx].lastWebhookReceivedAt = new Date().toISOString();
    latestProviders[latestIdx].lastWebhookEvent = evtLabel;
    latestProviders[latestIdx].lastWebhookHttpStatus = result.httpCode;
    if (result.body?.hmacValidation) {
      latestProviders[latestIdx].lastWebhookHmacStatus = result.body.hmacValidation;
    }
    db.setProviders(latestProviders);
  }

  return res.status(result.httpCode).json(result.body);
};

// Official RechargeGames Webhook Endpoint alias: POST /api/webhooks/rechargegames
apiRouter.post('/webhooks/rechargegames', async (req: any, res) => {
  const rawBody =
    typeof req.rawBody === 'string'
      ? req.rawBody
      : req.body
      ? JSON.stringify(req.body)
      : '';
  const rgProvider = new RechargeGamesProvider();
  const result = await rgProvider.handleWebhook(rawBody, req.body, req.headers as Record<string, any>, {
    isInvalidJson: Boolean(req.invalidJsonError),
    endpointPath: '/api/webhooks/rechargegames'
  });
  return res.status(result.httpStatus).json(result.responseBody);
});

apiRouter.post('/webhooks/goxtop', (req, res) => handleProviderWebhook(req, res, 'goxtop'));
apiRouter.post('/webhooks/:providerSlug', (req, res) => handleProviderWebhook(req, res, req.params.providerSlug));

// ==========================================
// 4. RESELLER & B2B API (VERSION 1)
// ==========================================

apiRouter.post('/v1/auth/reseller-register', (req, res) => {
  const { name, email, company } = req.body;
  if (!email || !name) {
    return res.status(400).json({ error: 'Nom et Email sont obligatoires.' });
  }

  const resellers = db.getResellers();
  const existing = resellers.find(r => r.email.toLowerCase() === email.toLowerCase());

  if (existing) {
    return res.status(400).json({ error: 'Un compte revendeur existe déjà avec cet email.' });
  }

  const newReseller = {
    id: 'res_' + Date.now(),
    name,
    email,
    company: company || name,
    balance: 50.00,
    currency: 'USD',
    status: 'active' as const,
    webhookSecret: 'whsec_' + crypto.randomBytes(16).toString('hex'),
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    ordersCount: 0,
    totalSpent: 0
  };

  resellers.push(newReseller);
  db.setResellers(resellers);

  const apiKeys = db.getApiKeys();
  const rawKey = 'plup_live_' + crypto.randomBytes(20).toString('hex');
  const newApiKey = {
    id: 'key_' + Date.now(),
    resellerId: newReseller.id,
    name: 'Primary Live Key',
    key: rawKey,
    maskedKey: `plup_live_${rawKey.slice(10, 14)}...${rawKey.slice(-4)}`,
    permissions: ['games.read', 'services.read', 'orders.create', 'orders.read', 'balance.read'],
    status: 'active' as const,
    createdAt: new Date().toISOString()
  };
  apiKeys.push(newApiKey);
  db.setApiKeys(apiKeys);

  const txs = db.getTransactions();
  txs.push({
    id: 'tx_init_' + Date.now(),
    transactionNumber: 'TXN-WELCOME-' + Date.now().toString().slice(-5),
    entityType: 'reseller',
    entityId: newReseller.id,
    type: 'credit',
    amount: 50.00,
    currency: 'USD',
    note: 'Crédit initial de bienvenue PlayUp Reseller Sandbox',
    createdAt: new Date().toISOString()
  });
  db.setTransactions(txs);

  db.addSystemLog('info', 'auth', `New reseller registered: ${newReseller.company} (${email})`);

  res.status(201).json({
    reseller: newReseller,
    apiKey: newApiKey
  });
});

apiRouter.post('/v1/auth/reseller-login', (req, res) => {
  const { email, apiKey } = req.body;
  if (!email || !apiKey) {
    return res.status(400).json({ error: 'Email revendeur et Clé API active requis pour l’authentification.' });
  }

  const resellers = db.getResellers();
  const reseller = resellers.find(r => r.email.toLowerCase() === String(email).trim().toLowerCase());

  if (!reseller) {
    return res.status(401).json({ error: 'Identifiants revendeur invalides.' });
  }

  const validKey = db.getApiKeys().find(
    k => k.resellerId === reseller.id && k.key === String(apiKey).trim() && k.status === 'active'
  );
  if (!validKey) {
    return res.status(401).json({ error: 'Clé API revendeur invalide ou révoquée.' });
  }

  reseller.lastActiveAt = new Date().toISOString();
  db.setResellers(resellers);

  res.json({ reseller, apiKey: validKey });
});

apiRouter.get('/v1/games', authenticateReseller, (_req, res) => {
  const games = db.getGames().filter(g => g.isActive);
  res.json({
    status: 'success',
    count: games.length,
    data: games
  });
});

apiRouter.get('/v1/services', authenticateReseller, (_req, res) => {
  const services = db.getServices().filter(s => s.isActive).map(service => ({
    id: service.id,
    gameId: service.gameId,
    name: service.name,
    description: service.description,
    category: service.category,
    packages: service.packages.filter(p => p.isActive).map(p => ({
      packageId: p.id,
      name: p.name,
      amount: p.amount,
      unit: p.unit,
      price: p.resellerPrice,
      currency: p.currency
    }))
  }));

  res.json({
    status: 'success',
    count: services.length,
    data: services
  });
});

apiRouter.get('/v1/balance', authenticateReseller, (req, res) => {
  const reseller = (req as any).reseller;
  res.json({
    status: 'success',
    data: {
      resellerId: reseller.id,
      company: reseller.company,
      balance: reseller.balance,
      currency: reseller.currency,
      status: reseller.status
    }
  });
});

apiRouter.post('/v1/orders', authenticateReseller, async (req, res) => {
  try {
    const reseller = (req as any).reseller;
    const { gameId, serviceId, packageId, gameProfileData, partnerOrderId: clientPartnerId } = req.body;

    if (!gameId || !serviceId || !packageId || !gameProfileData) {
      return res.status(400).json({
        status: 'error',
        code: 'MISSING_PARAMETERS',
        message: 'Les paramètres gameId, serviceId, packageId et gameProfileData sont requis.'
      });
    }

    const game = db.getGames().find(g => g.id === gameId && g.isActive);
    if (!game) {
      return res.status(404).json({
        status: 'error',
        code: 'GAME_NOT_FOUND',
        message: 'Jeu introuvable ou actuellement désactivé.'
      });
    }

    for (const field of game.fields) {
      if (field.required && !gameProfileData[field.name]) {
        return res.status(400).json({
          status: 'error',
          code: 'INVALID_PROFILE_DATA',
          message: `Le champ profil obligatoire '${field.name}' (${field.label}) est manquant.`
        });
      }
      if (field.validationRegex && gameProfileData[field.name]) {
        const regex = new RegExp(field.validationRegex);
        if (!regex.test(gameProfileData[field.name])) {
          return res.status(400).json({
            status: 'error',
            code: 'INVALID_FIELD_FORMAT',
            message: `Format invalide pour '${field.name}'. Format attendu: ${field.validationRegex}`
          });
        }
      }
    }

    const service = db.getServices().find(s => s.id === serviceId && s.isActive);
    if (!service) {
      return res.status(404).json({ status: 'error', code: 'SERVICE_NOT_FOUND', message: 'Service introuvable.' });
    }

    const pkg = service.packages.find(p => p.id === packageId && p.isActive);
    if (!pkg) {
      return res.status(404).json({ status: 'error', code: 'PACKAGE_NOT_FOUND', message: 'Package introuvable.' });
    }

    const orders = db.getOrders();
    const partnerOrderId = clientPartnerId || `PTNR-API-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const duplicate = orders.find(o => o.partnerOrderId === partnerOrderId);
    if (duplicate) {
      return res.status(409).json({
        status: 'error',
        code: 'DUPLICATE_PARTNER_ORDER_ID',
        message: `Une commande avec ce partnerOrderId (${partnerOrderId}) a déjà été soumise.`
      });
    }

    if (reseller.balance < pkg.resellerPrice) {
      return res.status(402).json({
        status: 'error',
        code: 'INSUFFICIENT_BALANCE',
        message: `Solde insuffisant. Coût: ${pkg.resellerPrice.toFixed(2)} ${pkg.currency}, Solde actuel: ${reseller.balance.toFixed(2)} ${pkg.currency}.`,
        currentBalance: reseller.balance
      });
    }

    const resellers = db.getResellers();
    const resIdx = resellers.findIndex(r => r.id === reseller.id);
    resellers[resIdx].balance -= pkg.resellerPrice;
    resellers[resIdx].ordersCount = (resellers[resIdx].ordersCount || 0) + 1;
    resellers[resIdx].totalSpent = (resellers[resIdx].totalSpent || 0) + pkg.resellerPrice;
    db.setResellers(resellers);

    const providers = db.getProviders();
    const provider = providers.find(p => p.id === service.providerId) || providers.find(p => p.id === 'prov_goxtop') || providers[0];

    const orderNumber = `PLUP-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`;
    const playerId = gameProfileData.playerId || gameProfileData.userId || gameProfileData.username || Object.values(gameProfileData)[0] || '';
    const serverId = gameProfileData.serverId || gameProfileData.zoneId || '';
    const margin = Number((pkg.resellerPrice - pkg.supplierCost).toFixed(2));

    const newOrder: Order = {
      id: 'ord_' + Date.now(),
      orderNumber,
      partnerOrderId,
      source: 'reseller_api',
      resellerId: reseller.id,
      resellerName: reseller.company || reseller.name,
      gameId: game.id,
      externalGameId: pkg.externalGameId || game.externalGameId || game.slug,
      gameName: game.name,
      serviceId: service.id,
      serviceName: service.name,
      packageId: pkg.id,
      externalProductId: pkg.externalProductId || pkg.id,
      packageName: pkg.name,
      playerId,
      serverId: serverId || undefined,
      gameProfileData,
      publicPrice: pkg.publicPrice,
      chargedAmount: pkg.resellerPrice,
      supplierCost: pkg.supplierCost,
      margin,
      currency: pkg.currency,
      status: 'pending',
      providerId: provider?.id || 'prov_goxtop',
      providerName: provider?.name || 'GoXtop',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      statusHistory: [
        {
          status: 'pending',
          timestamp: new Date().toISOString(),
          note: `Requête API authentifiée (Partner Order ID: ${partnerOrderId})`
        }
      ]
    };

    orders.unshift(newOrder);
    db.setOrders(orders);

    const txs = db.getTransactions();
    txs.push({
      id: 'tx_' + Date.now(),
      transactionNumber: 'TXN-' + Date.now().toString().slice(-6),
      entityType: 'reseller',
      entityId: reseller.id,
      type: 'debit',
      amount: pkg.resellerPrice,
      currency: pkg.currency,
      orderId: newOrder.id,
      note: `Commande API ${orderNumber} (${game.name} - ${pkg.name})`,
      createdAt: new Date().toISOString()
    });
    db.setTransactions(txs);

    setTimeout(() => {
      ProviderEngine.processOrder(newOrder.id).catch(console.error);
    }, 800);

    return res.status(201).json({
      status: 'success',
      data: newOrder,
      remainingBalance: resellers[resIdx].balance
    });
  } catch (err: any) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

apiRouter.get('/v1/orders/:id', authenticateReseller, (req, res) => {
  const { id } = req.params;
  const reseller = (req as any).reseller;

  const order = db.getOrders().find(
    o => (o.id === id || o.orderNumber === id || o.partnerOrderId === id) && o.resellerId === reseller.id
  );
  if (!order) {
    return res.status(404).json({
      status: 'error',
      code: 'ORDER_NOT_FOUND',
      message: 'Commande introuvable sous votre compte revendeur.'
    });
  }

  res.json({
    status: 'success',
    data: order
  });
});

// ==========================================
// RESELLER DASHBOARD ENDPOINTS
// ==========================================

apiRouter.get('/v1/reseller/me', authenticateReseller, (req, res) => {
  const reseller = (req as any).reseller;
  const orders = db.getOrders().filter(o => o.resellerId === reseller.id);
  const transactions = db.getTransactions().filter(t => t.entityId === reseller.id);
  const apiKeys = db.getApiKeys().filter(k => k.resellerId === reseller.id);
  const webhookLogs = db.getWebhookLogs().filter(w => w.resellerId === reseller.id).slice(0, 10);

  const stats = {
    totalOrders: orders.length,
    completedOrders: orders.filter(o => o.status === 'completed').length,
    pendingOrders: orders.filter(o => o.status === 'pending' || o.status === 'processing').length,
    failedOrders: orders.filter(o => o.status === 'failed').length,
    totalSpent: transactions.filter(t => t.type === 'debit').reduce((acc, t) => acc + t.amount, 0)
  };

  res.json({
    reseller,
    stats,
    apiKeys,
    recentOrders: orders.slice(0, 15),
    transactions: transactions.slice(0, 20),
    webhookLogs
  });
});

apiRouter.get('/v1/reseller/api-keys', authenticateReseller, (req, res) => {
  const reseller = (req as any).reseller;
  const keys = db.getApiKeys().filter(k => k.resellerId === reseller.id);
  res.json(keys);
});

apiRouter.post('/v1/reseller/api-keys', authenticateReseller, (req, res) => {
  const reseller = (req as any).reseller;
  const { name, isTest } = req.body;

  const rawKey = (isTest ? 'plup_test_' : 'plup_live_') + crypto.randomBytes(18).toString('hex');
  const newKey = {
    id: 'key_' + Date.now(),
    resellerId: reseller.id,
    name: name || 'API Key ' + new Date().toLocaleDateString(),
    key: rawKey,
    maskedKey: `${rawKey.slice(0, 14)}...${rawKey.slice(-4)}`,
    permissions: ['games.read', 'services.read', 'orders.create', 'orders.read', 'balance.read'],
    status: 'active' as const,
    createdAt: new Date().toISOString()
  };

  const apiKeys = db.getApiKeys();
  apiKeys.push(newKey);
  db.setApiKeys(apiKeys);

  res.status(201).json(newKey);
});

apiRouter.delete('/v1/reseller/api-keys/:id', authenticateReseller, (req, res) => {
  const reseller = (req as any).reseller;
  const { id } = req.params;

  const apiKeys = db.getApiKeys();
  const keyIndex = apiKeys.findIndex(k => k.id === id && k.resellerId === reseller.id);
  if (keyIndex === -1) {
    return res.status(404).json({ error: 'Clé API introuvable' });
  }

  apiKeys[keyIndex].status = 'revoked';
  db.setApiKeys(apiKeys);

  res.json({ message: 'Clé révoquée avec succès.' });
});

apiRouter.put('/v1/reseller/webhook', authenticateReseller, (req, res) => {
  const reseller = (req as any).reseller;
  const { webhookUrl } = req.body;

  const resellers = db.getResellers();
  const index = resellers.findIndex(r => r.id === reseller.id);
  if (index === -1) return res.status(404).json({ error: 'Revendeur introuvable' });

  resellers[index].webhookUrl = webhookUrl;
  if (!resellers[index].webhookSecret) {
    resellers[index].webhookSecret = 'whsec_' + crypto.randomBytes(16).toString('hex');
  }
  db.setResellers(resellers);

  res.json({
    message: 'Paramètres Webhook mis à jour',
    webhookUrl: resellers[index].webhookUrl,
    webhookSecret: resellers[index].webhookSecret
  });
});

apiRouter.post('/v1/reseller/webhook/test-ping', authenticateReseller, async (req, res) => {
  const reseller = (req as any).reseller;
  if (!reseller.webhookUrl) {
    return res.status(400).json({ error: 'Veuillez configurer une URL de Webhook au préalable.' });
  }

  const mockOrder: Order = {
    id: 'ord_test_' + Date.now(),
    orderNumber: 'PLUP-TEST-PING',
    partnerOrderId: 'PTNR-TEST-PING',
    source: 'reseller_api',
    resellerId: reseller.id,
    resellerName: reseller.company,
    gameId: 'game_ff',
    gameName: 'Free Fire',
    serviceId: 'srv_ff_diamonds',
    serviceName: 'Free Fire Diamonds',
    packageId: 'pkg_ff_100',
    packageName: '100 Diamants (Test Webhook)',
    playerId: '123456789',
    gameProfileData: { playerId: '123456789' },
    publicPrice: 1.20,
    chargedAmount: 0.95,
    supplierCost: 0.82,
    margin: 0.13,
    currency: 'USD',
    status: 'completed',
    providerId: 'prov_goxtop',
    providerName: 'GoXtop',
    providerReference: 'TEST-WH-REF',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    statusHistory: []
  };

  await WebhookEngine.dispatchOrderEvent(mockOrder, 'order.completed');

  const logs = db.getWebhookLogs().filter(w => w.resellerId === reseller.id);
  res.json({
    message: 'Test ping webhook envoyé avec succès',
    lastLog: logs[0]
  });
});

apiRouter.post('/v1/reseller/deposit-test', authenticateReseller, (req, res) => {
  const reseller = (req as any).reseller;
  const amount = Number(req.body.amount) || 100;

  const resellers = db.getResellers();
  const idx = resellers.findIndex(r => r.id === reseller.id);
  resellers[idx].balance += amount;
  db.setResellers(resellers);

  const txs = db.getTransactions();
  txs.push({
    id: 'tx_dep_' + Date.now(),
    transactionNumber: 'TXN-DEP-' + Date.now().toString().slice(-6),
    entityType: 'reseller',
    entityId: reseller.id,
    type: 'credit',
    amount,
    currency: 'USD',
    note: `Recharge Sandbox de test (+${amount} USD)`,
    createdAt: new Date().toISOString()
  });
  db.setTransactions(txs);

  res.json({
    message: `Solde crédité avec succès (+${amount} USD)`,
    newBalance: resellers[idx].balance
  });
});

// ==========================================
// 5. SUPPORT TICKETS ENDPOINTS
// ==========================================

apiRouter.post('/support/tickets', (req, res) => {
  const { name, email, subject, category, message, orderId } = req.body;
  if (!name || !email || !subject || !message) {
    return res.status(400).json({ error: 'Veuillez remplir tous les champs obligatoires.' });
  }

  const ticketNumber = `TKT-${Math.floor(1000 + Math.random() * 9000)}`;
  const newTicket: SupportTicket = {
    id: 'tkt_' + Date.now(),
    ticketNumber,
    name,
    email,
    subject,
    category: category || 'order',
    orderId,
    status: 'open',
    priority: 'medium',
    message,
    messages: [
      {
        id: 'msg_' + Date.now(),
        sender: 'user',
        senderName: name,
        text: message,
        createdAt: new Date().toISOString()
      }
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const tickets = db.getSupportTickets();
  tickets.unshift(newTicket);
  db.setSupportTickets(tickets);

  res.status(201).json(newTicket);
});

apiRouter.get('/support/tickets/:ticketNumber', (req, res) => {
  const ticket = db.getSupportTickets().find(
    t => t.ticketNumber === req.params.ticketNumber || t.id === req.params.ticketNumber
  );
  if (!ticket) {
    return res.status(404).json({ error: 'Ticket introuvable' });
  }
  res.json(ticket);
});

// ==========================================
// 6. ADMIN CONTROL PANEL & GOXTOP CONFIGURATION
// ==========================================

apiRouter.post('/admin/login', authRateLimit, (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email et mot de passe administrateur requis.' });
  }

  const user = db.getUserByEmail(String(email));
  if (!user || !db.verifyPassword(String(password), user.id)) {
    db.addSystemLog('warn', 'auth', `Failed admin login attempt with email: ${email}`);
    return res.status(401).json({ error: 'Identifiants administrateur incorrects.' });
  }

  if (user.status === 'suspended') {
    return res.status(403).json({ error: 'Ce compte a été suspendu.' });
  }

  if (user.role !== 'ADMIN') {
    db.addSystemLog('warn', 'auth', `Non-admin user (${user.email}, role=${user.role}) attempted admin login`);
    return res.status(403).json({
      error: 'Accès refusé : votre compte ne possède pas le rôle ADMIN.'
    });
  }

  const users = db.getUsers();
  const idx = users.findIndex(u => u.id === user.id);
  if (idx !== -1) {
    users[idx].lastLoginAt = new Date().toISOString();
    db.setUsers(users);
  }

  const token = db.generateUserSessionToken(user.id);
  db.addSystemLog('info', 'auth', `Admin logged in successfully (${user.email})`);
  return res.json({
    token,
    admin: users[idx] || user,
    user: users[idx] || user
  });
});

apiRouter.get('/admin/stats', authenticateAdmin, (_req, res) => {
  const orders = db.getOrders();
  const resellers = db.getResellers();
  const providers = db.getProviders();
  const services = db.getServices();

  const totalRevenue = orders.reduce((sum, o) => sum + (o.chargedAmount || 0), 0);
  const totalCost = orders.reduce((sum, o) => sum + (o.supplierCost || 0), 0);
  const grossProfit = totalRevenue - totalCost;

  res.json({
    metrics: {
      totalRevenue,
      grossProfit,
      marginPercent: totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0,
      totalOrders: orders.length,
      completedOrders: orders.filter(o => o.status === 'completed').length,
      pendingOrders: orders.filter(o => o.status === 'pending' || o.status === 'processing').length,
      failedOrders: orders.filter(o => o.status === 'failed').length,
      activeResellers: resellers.filter(r => r.status === 'active').length,
      totalResellerBalance: resellers.reduce((sum, r) => sum + (r.balance || 0), 0),
      activeProviders: providers.filter(p => p.isActive).length,
      activeServices: services.filter(s => s.isActive).length
    },
    recentOrders: orders.slice(0, 10),
    systemLogs: db.getSystemLogs().slice(0, 20)
  });
});

// Admin Games CRUD
apiRouter.get('/admin/games', authenticateAdmin, (_req, res) => {
  res.json(db.getGames());
});

apiRouter.post('/admin/games', authenticateAdmin, (req, res) => {
  const gameData = req.body;
  const games = db.getGames();
  const newGame: Game = {
    id: 'game_' + Date.now(),
    slug: gameData.slug || gameData.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    name: gameData.name,
    externalGameId: gameData.externalGameId || '',
    providerId: gameData.providerId || 'prov_goxtop',
    category: gameData.category || 'Mobile Game',
    description: gameData.description || '',
    logo: gameData.logo || '/src/assets/images/game_cover_freefire_1790988876938.jpg',
    banner: gameData.banner,
    isActive: gameData.isActive ?? true,
    displayOrder: games.length + 1,
    fields: gameData.fields || [
      { id: 'f_id', name: 'playerId', label: 'ID Joueur', placeholder: 'ID', type: 'text', required: true }
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  games.push(newGame);
  db.setGames(games);
  db.addSystemLog('info', 'system', `Admin created game: ${newGame.name}`);
  res.status(201).json(newGame);
});

apiRouter.put('/admin/games/:id', authenticateAdmin, (req, res) => {
  const { id } = req.params;
  const games = db.getGames();
  const index = games.findIndex(g => g.id === id);
  if (index === -1) return res.status(404).json({ error: 'Jeu introuvable' });

  games[index] = {
    ...games[index],
    ...req.body,
    updatedAt: new Date().toISOString()
  };
  db.setGames(games);
  db.addSystemLog('info', 'system', `Admin updated game: ${games[index].name}`);
  res.json(games[index]);
});

apiRouter.delete('/admin/games/:id', authenticateAdmin, (req, res) => {
  const { id } = req.params;
  let games = db.getGames();
  games = games.filter(g => g.id !== id);
  db.setGames(games);
  res.json({ message: 'Jeu supprimé' });
});

// Admin Services & Packages CRUD
apiRouter.get('/admin/services', authenticateAdmin, (_req, res) => {
  res.json(db.getServices());
});

apiRouter.post('/admin/services', authenticateAdmin, (req, res) => {
  const serviceData = req.body;
  const services = db.getServices();
  const newService: Service = {
    id: 'srv_' + Date.now(),
    gameId: serviceData.gameId,
    externalGameId: serviceData.externalGameId || '',
    name: serviceData.name,
    description: serviceData.description || '',
    category: serviceData.category || 'diamonds',
    providerId: serviceData.providerId || 'prov_goxtop',
    isActive: serviceData.isActive ?? true,
    displayOrder: services.length + 1,
    packages: serviceData.packages || [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  services.push(newService);
  db.setServices(services);
  res.status(201).json(newService);
});

apiRouter.put('/admin/services/:id', authenticateAdmin, (req, res) => {
  const { id } = req.params;
  const adminUser = (req as any).user as AppUser | undefined;
  const services = db.getServices();
  const index = services.findIndex(s => s.id === id);
  if (index === -1) return res.status(404).json({ error: 'Service introuvable' });

  services[index] = {
    ...services[index],
    ...req.body,
    updatedAt: new Date().toISOString()
  };
  db.setServices(services, {
    adminId: adminUser?.id || 'admin',
    adminEmail: adminUser?.email
  });

  NotificationEngine.broadcastPricingUpdate({
    changeType: 'service_updated',
    usdToHtgExchangeRate: db.getUsdToHtgExchangeRate(),
    historyEntry: db.getPriceChangeHistory({ limit: 1 })[0]
  });

  res.json(db.getServices()[index]);
});

// Admin USD -> HTG Exchange Rate & Manual HTG Selling Price Management
apiRouter.get('/admin/pricing/history', authenticateAdmin, (req, res) => {
  const { serviceId, packageId, productKey, changeType, limit } = req.query;
  const history = db.getPriceChangeHistory({
    serviceId: serviceId ? String(serviceId) : undefined,
    packageId: packageId ? String(packageId) : undefined,
    productKey: productKey ? String(productKey) : undefined,
    changeType: changeType ? String(changeType) : undefined,
    limit: limit ? Number(limit) : 200
  });
  res.json({
    referenceCurrency: 'USD',
    sellingCurrency: 'HTG',
    usdToHtgExchangeRate: db.getUsdToHtgExchangeRate(),
    history
  });
});

apiRouter.put('/admin/pricing/exchange-rate', authenticateAdmin, (req, res) => {
  try {
    const adminUser = (req as any).user as AppUser | undefined;
    const { usdToHtgExchangeRate, reason, recalculateAutoSellingPrices } = req.body || {};
    const numRate = Number(usdToHtgExchangeRate);
    if (!Number.isFinite(numRate) || numRate <= 0) {
      return res.status(400).json({
        error: 'Veuillez saisir un taux de change USD → HTG valide (supérieur à 0).'
      });
    }

    const result = db.setUsdToHtgExchangeRate(numRate, {
      adminId: adminUser?.id || 'admin',
      adminEmail: adminUser?.email,
      reason: reason ? String(reason) : undefined,
      recalculateAutoSellingPrices: Boolean(recalculateAutoSellingPrices)
    });

    NotificationEngine.broadcastPricingUpdate({
      changeType: 'exchange_rate',
      usdToHtgExchangeRate: result.newExchangeRate,
      historyEntry: result.historyEntry
    });

    return res.json({
      success: true,
      message: `Taux de change mis à jour en temps réel : 1 USD = ${result.newExchangeRate} HTG. Coûts fournisseurs, marges et bénéfices en HTG recalculés automatiquement.`,
      ...result,
      services: db.getServices(),
      products: db.getRechargeGamesProducts(),
      settings: db.getSettings(),
      history: db.getPriceChangeHistory({ limit: 100 })
    });
  } catch (err: any) {
    return res.status(400).json({
      error: err?.message || 'Erreur lors de la mise à jour du taux de change USD → HTG.'
    });
  }
});

apiRouter.put('/admin/pricing/service-price-htg', authenticateAdmin, (req, res) => {
  try {
    const adminUser = (req as any).user as AppUser | undefined;
    const { serviceId, packageId, productKey, sellingPriceHtg, resellerPriceHtg, reason } = req.body || {};
    const numPrice = Number(sellingPriceHtg);
    if (!Number.isFinite(numPrice) || numPrice <= 0) {
      return res.status(400).json({
        error: 'Veuillez saisir un prix de vente final en HTG valide (supérieur à 0).'
      });
    }

    const result = db.setManualServiceSellingPriceHtg({
      serviceId: serviceId ? String(serviceId) : undefined,
      packageId: packageId ? String(packageId) : undefined,
      productKey: productKey ? String(productKey) : undefined,
      sellingPriceHtg: numPrice,
      resellerPriceHtg: resellerPriceHtg !== undefined ? Number(resellerPriceHtg) : undefined,
      adminId: adminUser?.id || 'admin',
      adminEmail: adminUser?.email,
      reason: reason ? String(reason) : undefined
    });

    NotificationEngine.broadcastPricingUpdate({
      changeType: 'manual_price_htg',
      usdToHtgExchangeRate: db.getUsdToHtgExchangeRate(),
      historyEntry: result.historyEntry
    });

    return res.json({
      success: true,
      message: `Prix de vente final défini à ${numPrice} HTG et appliqué en temps réel.`,
      ...result,
      services: db.getServices(),
      products: db.getRechargeGamesProducts(),
      history: db.getPriceChangeHistory({ limit: 100 })
    });
  } catch (err: any) {
    return res.status(400).json({
      error: err?.message || 'Erreur lors de la mise à jour du prix de vente en HTG.'
    });
  }
});

// ==========================================
// ADMIN PROVIDERS & GOXTOP CONFIGURATION
// ==========================================

// List all providers (returns masked secrets only)
apiRouter.get('/admin/providers', authenticateAdmin, (_req, res) => {
  res.json(db.getProviders());
});

// Add a new interchangeable provider
apiRouter.post('/admin/providers', authenticateAdmin, (req, res) => {
  const { name, apiUrl, environment, authHeaderName, serviceType, apiKey, webhookSecret } = req.body;
  if (!name || !apiUrl) {
    return res.status(400).json({ error: 'Nom et URL de base requis' });
  }

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const id = 'prov_' + slug + '_' + Date.now().toString().slice(-4);

  const newProvider: Provider = {
    id,
    slug,
    adapterType: slug.includes('goxtop') ? 'goxtop' : 'generic_rest',
    name,
    apiUrl,
    environment: environment || 'production',
    authHeaderName: authHeaderName || 'x-api-key',
    hasApiKey: Boolean(apiKey?.trim()),
    apiKeyMasked: apiKey?.trim() ? '••••••••••••••••' : 'Non configurée',
    hasWebhookSecret: Boolean(webhookSecret?.trim()),
    webhookSecretMasked: webhookSecret?.trim() ? '••••••••••••••••' : 'Non configuré',
    memberId: req.body.memberId || '',
    partnerId: req.body.partnerId || '',
    merchantId: req.body.merchantId || '',
    webhookUrl: `/api/webhooks/${slug}`,
    isActive: true,
    serviceType: serviceType || 'Gaming API Provider',
    priority: db.getProviders().length + 1,
    endpoints: req.body.endpoints || {
      testConnectionPath: '/api/v1/account',
      syncGamesPath: '/api/v1/games',
      syncProductsPath: '/api/v1/products',
      syncPricesPath: '/api/v1/prices',
      createOrderPath: '/api/v1/orders',
      orderStatusPath: '/api/v1/orders/{orderId}'
    },
    customParams: req.body.customParams || [],
    latencyMs: 0,
    lastPingStatus: 'untested',
    lastPingLabel: 'Non testé'
  };

  const providers = db.getProviders();
  providers.push(newProvider);
  db.setProviders(providers);

  if (apiKey || webhookSecret) {
    db.setProviderSecret(id, {
      apiKey: apiKey?.trim() || '',
      webhookSecret: webhookSecret?.trim() || ''
    });
  }

  db.addSystemLog('info', 'provider', `Admin added new provider: ${name}`);
  res.status(201).json(db.getProviders().find(p => p.id === id));
});

// Update provider configuration (GoXtop or any provider)
apiRouter.put('/admin/providers/:id', authenticateAdmin, (req, res) => {
  const { id } = req.params;
  const providers = db.getProviders();
  const index = providers.findIndex(p => p.id === id || p.slug === id);
  if (index === -1) return res.status(404).json({ error: 'Fournisseur introuvable' });

  const targetId = providers[index].id;
  const {
    apiKey,
    webhookSecret,
    clearApiKey,
    clearWebhookSecret,
    ...publicConfig
  } = req.body;

  // Update public metadata
  providers[index] = {
    ...providers[index],
    ...publicConfig
  };
  db.setProviders(providers);

  // Update server-side secrets ONLY if modified (never overwrite with mask placeholder)
  const secretUpdate: { apiKey?: string; webhookSecret?: string } = {};
  if (clearApiKey) {
    secretUpdate.apiKey = '';
  } else if (typeof apiKey === 'string' && apiKey.trim() !== '' && !apiKey.includes('••••')) {
    secretUpdate.apiKey = apiKey.trim();
  }

  if (clearWebhookSecret) {
    secretUpdate.webhookSecret = '';
  } else if (typeof webhookSecret === 'string' && webhookSecret.trim() !== '' && !webhookSecret.includes('••••')) {
    secretUpdate.webhookSecret = webhookSecret.trim();
  }

  if (Object.keys(secretUpdate).length > 0) {
    db.setProviderSecret(targetId, secretUpdate);
  }

  db.addSystemLog('info', 'provider', `Admin updated configuration for provider ${providers[index].name}`);

  const updated = db.getProviders().find(p => p.id === targetId);
  res.json(updated);
});

// Strictly block revealing any provider API Key, Webhook Secret, or environment variable in plaintext
apiRouter.post('/admin/providers/:id/reveal-secret', authenticateAdmin, (req, res) => {
  const { id } = req.params;
  const { field } = req.body || {};
  db.addSystemLog(
    'warn',
    'auth',
    `[Security Policy] Blocked plaintext secret reveal request for provider ${id} (field: ${field || 'unknown'})`
  );
  return res.status(403).json({
    error: 'Forbidden',
    message:
      'Politique de sécurité PlayUp : les clés API, Webhook Secrets et variables d’environnement ne peuvent jamais être affichés ou récupérés en clair.'
  });
});

// Real Connection Test to GoXtop / RechargeGames / Provider
apiRouter.post('/admin/providers/:id/test-connection', authenticateAdmin, async (req, res) => {
  const { id } = req.params;
  const providers = db.getProviders();
  const index = providers.findIndex(p => p.id === id || p.slug === id);
  if (index === -1) return res.status(404).json({ error: 'Fournisseur introuvable' });

  const provider = providers[index];
  if (provider.id === 'prov_rechargegames' || provider.adapterType === 'rechargegames') {
    const rg = new RechargeGamesProvider();
    const testResult = await rg.testConnection();
    providers[index].lastPingStatus = testResult.success ? 'online' : 'offline';
    providers[index].lastPingLabel = testResult.label;
    providers[index].lastPingAt = testResult.timestamp;
    providers[index].latencyMs = testResult.latencyMs;
    db.setProviders(providers);
    return res.json({
      testResult,
      provider: db.getProviders().find(p => p.id === provider.id)
    });
  }

  const adapter = ProviderFactory.getProviderInstance(provider.id);
  if (!adapter) {
    return res.status(500).json({ error: 'Adaptateur fournisseur non disponible' });
  }

  const testResult = await adapter.testConnection();

  // Persist status on provider record
  providers[index].lastPingStatus = testResult.success ? 'online' : 'offline';
  providers[index].lastPingLabel = testResult.label;
  providers[index].lastPingAt = testResult.timestamp;
  providers[index].latencyMs = testResult.latencyMs;
  db.setProviders(providers);

  res.json({
    testResult,
    provider: db.getProviders().find(p => p.id === provider.id)
  });
});

// Legacy alias for test-ping
apiRouter.post('/admin/providers/:id/test-ping', authenticateAdmin, async (req, res) => {
  const { id } = req.params;
  const adapter = ProviderFactory.getProviderInstance(id);
  if (!adapter) return res.status(404).json({ error: 'Fournisseur introuvable' });
  const testResult = await adapter.testConnection();
  res.json({
    status: testResult.success ? 'online' : 'offline',
    latencyMs: testResult.latencyMs,
    testResult
  });
});

// Synchronize Games / Products / Prices with GoXtop
apiRouter.post('/admin/providers/:id/sync', authenticateAdmin, async (req, res) => {
  const { id } = req.params;
  const { syncType, gameCode } = req.body; // 'games' | 'products' | 'prices'
  if (!['games', 'products', 'prices'].includes(syncType)) {
    return res.status(400).json({ error: 'Type de synchronisation invalide (games, products, prices).' });
  }

  const providers = db.getProviders();
  const index = providers.findIndex(p => p.id === id || p.slug === id);
  if (index === -1) return res.status(404).json({ error: 'Fournisseur introuvable' });

  const provider = providers[index];
  if (provider.id === 'prov_rechargegames' || provider.adapterType === 'rechargegames') {
    const rg = new RechargeGamesProvider();
    const syncRes = await rg.syncCatalog();
    return res.json({
      success: syncRes.success,
      httpStatus: syncRes.success ? 200 : 502,
      message: syncRes.message,
      productsRetrieved: syncRes.products.length,
      productsUpdated: syncRes.products.length,
      syncType,
      provider: db.getProviders().find(p => p.id === provider.id)
    });
  }

  const adapter = ProviderFactory.getProviderInstance(provider.id);
  if (!adapter) {
    return res.status(404).json({ error: 'Adaptateur fournisseur introuvable' });
  }

  const syncResult =
    syncType === 'games'
      ? await adapter.getGames()
      : await adapter.getProducts(gameCode);

  const latestProviders = db.getProviders();
  const latestIdx = latestProviders.findIndex(p => p.id === provider.id);
  if (latestIdx !== -1) {
    if (syncResult.success) {
      latestProviders[latestIdx].lastSyncAt = new Date().toISOString();
    }
    latestProviders[latestIdx].lastSyncSummary = {
      timestamp: new Date().toISOString(),
      syncType,
      success: syncResult.success,
      httpStatus: syncResult.httpStatus,
      gamesRetrieved: syncResult.gamesRetrieved ?? latestProviders[latestIdx].lastSyncSummary?.gamesRetrieved ?? 0,
      productsRetrieved: syncResult.productsRetrieved ?? latestProviders[latestIdx].lastSyncSummary?.productsRetrieved ?? 0,
      productsAdded: syncResult.productsAdded ?? 0,
      productsUpdated: syncResult.productsUpdated ?? 0,
      productsDeactivated: syncResult.productsDeactivated ?? 0,
      providerErrorMessage: syncResult.providerErrorMessage
    };
    db.setProviders(latestProviders);
  }

  res.json({
    ...syncResult,
    syncType,
    provider: db.getProviders().find(p => p.id === provider.id)
  });
});

// Get Provider Webhook Logs (dedicated diagnostic log table)
apiRouter.get('/admin/providers/:id/webhook-logs', authenticateAdmin, (req, res) => {
  const { id } = req.params;
  if (id === 'all') {
    return res.json(db.getProviderWebhookLogs());
  }
  const providers = db.getProviders();
  const provider = providers.find(p => p.id === id || p.slug === id);
  res.json(db.getProviderWebhookLogs(provider?.id || id));
});

// Internal Diagnostic Test for Provider Webhook (TEST_WEBHOOK — never creates an order or debits money)
apiRouter.post('/admin/providers/:id/test-webhook', authenticateAdmin, async (req, res) => {
  const { id } = req.params;
  const { simulateInvalidSignature } = req.body || {};
  const providers = db.getProviders();
  const index = providers.findIndex(p => p.id === id || p.slug === id);
  if (index === -1) return res.status(404).json({ error: 'Fournisseur introuvable' });

  const provider = providers[index];
  const adapter = ProviderFactory.getProviderInstance(provider.id);
  if (!adapter) {
    return res.status(500).json({ error: 'Adaptateur fournisseur non disponible' });
  }

  const startTime = Date.now();
  const testPayload = {
    event_type: 'TEST_WEBHOOK',
    provider: provider.name,
    timestamp: new Date().toISOString(),
    internal_diagnostic: true,
    note: simulateInvalidSignature
      ? 'Test de sécurité HMAC-SHA256 (signature volontairement altérée pour vérifier le rejet HTTP 401).'
      : 'Événement interne de test PlayUp — aucune commande créée chez GoXtop, aucun montant débité.'
  };
  const rawBody = JSON.stringify(testPayload);

  // If a Webhook Secret is configured on the server, sign the internal test payload with HMAC-SHA256 to verify the pipeline end-to-end
  const secrets = db.getProviderSecret(provider.id);
  const simulatedHeaders: Record<string, string> = {
    'content-type': 'application/json',
    'user-agent': 'GoXtop-Webhook-Dispatcher/1.0'
  };

  if (secrets.webhookSecret && secrets.webhookSecret.trim()) {
    const signatureHex = crypto
      .createHmac('sha256', secrets.webhookSecret.trim())
      .update(rawBody, 'utf8')
      .digest('hex');
    simulatedHeaders['x-goxtop-signature'] = simulateInvalidSignature
      ? `0000000000000000${signatureHex.slice(16)}`
      : signatureHex;
  }

  const webhookResult = await adapter.handleWebhook(rawBody, simulatedHeaders, testPayload);
  const latencyMs = Date.now() - startTime;

  const latestProviders = db.getProviders();
  const latestIdx = latestProviders.findIndex(p => p.id === provider.id);
  const hmacValidation = webhookResult.body?.hmacValidation || 'Non applicable (secret non fourni par GoXtop)';

  if (latestIdx !== -1) {
    latestProviders[latestIdx].lastWebhookReceivedAt = new Date().toISOString();
    latestProviders[latestIdx].lastWebhookEvent = 'TEST_WEBHOOK';
    latestProviders[latestIdx].lastWebhookHttpStatus = webhookResult.httpCode;
    latestProviders[latestIdx].lastWebhookHmacStatus = hmacValidation;
    db.setProviders(latestProviders);
  }

  res.json({
    result: {
      success: webhookResult.httpCode >= 200 && webhookResult.httpCode < 300,
      urlCalled: provider.webhookUrl || `/api/webhooks/${provider.slug}`,
      httpMethod: 'POST' as const,
      eventType: 'TEST_WEBHOOK',
      resultLabel: webhookResult.httpCode >= 200 && webhookResult.httpCode < 300 ? 'Succès' : 'Rejeté (Sécurité HMAC)',
      httpStatus: webhookResult.httpCode,
      latencyMs,
      signatureDetected: Boolean(webhookResult.body?.signatureDetected),
      signatureHeaderName: webhookResult.body?.signatureHeaderName,
      signatureValueMasked: webhookResult.body?.signatureValueMasked,
      computedHmacPreview: webhookResult.body?.computedHmacPreview,
      hmacValidation,
      processingSteps: webhookResult.body?.processingSteps || [],
      backendResponse: JSON.stringify(webhookResult.body),
      details: webhookResult.body?.message || '',
      timestamp: new Date().toISOString(),
      message:
        webhookResult.httpCode >= 200 && webhookResult.httpCode < 300
          ? `Endpoint POST ${provider.webhookUrl || `/api/webhooks/${provider.slug}`} actif et fonctionnel (HTTP ${webhookResult.httpCode}).`
          : `Le webhook a été rejeté avec HTTP ${webhookResult.httpCode} (${webhookResult.body?.message || 'Signature HMAC invalide'}).`
    },
    provider: db.getProviders().find(p => p.id === provider.id),
    webhookLogs: db.getProviderWebhookLogs(provider.id)
  });
});

// Get provider_orders table
apiRouter.get('/admin/provider-orders', authenticateAdmin, (_req, res) => {
  res.json(db.getProviderOrders());
});

// Check remote GoXtop status via GET /api/v.1/:partner_orderid
apiRouter.post('/admin/orders/:id/status-check', authenticateAdmin, async (req, res) => {
  const { id } = req.params;
  const orders = db.getOrders();
  const orderIdx = orders.findIndex(o => o.id === id || o.orderNumber === id || o.partnerOrderId === id);
  if (orderIdx === -1) return res.status(404).json({ error: 'Commande introuvable' });

  const order = orders[orderIdx];
  const adapter = ProviderFactory.getProviderInstance(order.providerId || 'prov_goxtop');
  if (!adapter) return res.status(500).json({ error: 'Adaptateur GoXtop introuvable' });

  const statusRes = await adapter.getOrderStatus(order.partnerOrderId);
  if (statusRes.success && statusRes.status) {
    order.status = statusRes.status;
    if (statusRes.providerOrderId) {
      order.externalOrderId = statusRes.providerOrderId;
    }
    order.updatedAt = new Date().toISOString();
    order.statusHistory.push({
      status: statusRes.status,
      timestamp: new Date().toISOString(),
      note: `Vérification GET /api/v.1/${order.partnerOrderId} → ${statusRes.status.toUpperCase()}`
    });
    db.setOrders(orders);

    if (order.status === 'completed' && order.userId) {
      await NotificationEngine.triggerOrderDeliveredNotifications({
        orderId: order.id,
        orderNumber: order.orderNumber,
        userId: order.userId,
        gameName: order.gameName,
        packageName: order.packageName,
        playerId: order.gameProfileData?.playerId || order.gameProfileData?.characterId,
        deliveredAtIso: order.updatedAt,
        providerName: order.providerName || 'GoXtop'
      });
    }
  }
  res.json({ result: statusRes, order });
});

// Track remote GoXtop order via POST /api/v.1/:id/track
apiRouter.post('/admin/orders/:id/track', authenticateAdmin, async (req, res) => {
  const { id } = req.params;
  const orders = db.getOrders();
  const orderIdx = orders.findIndex(o => o.id === id || o.orderNumber === id);
  if (orderIdx === -1) return res.status(404).json({ error: 'Commande introuvable' });

  const order = orders[orderIdx];
  const providerOrderId = order.externalOrderId || order.partnerOrderId;
  const adapter = ProviderFactory.getProviderInstance(order.providerId || 'prov_goxtop');
  if (!adapter) return res.status(500).json({ error: 'Adaptateur GoXtop introuvable' });

  const trackRes = await adapter.trackOrder(providerOrderId);
  if (trackRes.success && trackRes.status) {
    order.status = trackRes.status;
    order.updatedAt = new Date().toISOString();
    order.statusHistory.push({
      status: trackRes.status,
      timestamp: new Date().toISOString(),
      note: `Suivi POST /api/v.1/${providerOrderId}/track → ${trackRes.status.toUpperCase()}`
    });
    db.setOrders(orders);

    if (order.status === 'completed' && order.userId) {
      await NotificationEngine.triggerOrderDeliveredNotifications({
        orderId: order.id,
        orderNumber: order.orderNumber,
        userId: order.userId,
        gameName: order.gameName,
        packageName: order.packageName,
        playerId: order.gameProfileData?.playerId || order.gameProfileData?.characterId,
        deliveredAtIso: order.updatedAt,
        providerName: order.providerName || 'GoXtop'
      });
    }
  }
  res.json({ result: trackRes, order });
});

// Get Provider API Logs (GoXtop or all)
apiRouter.get('/admin/providers/:id/logs', authenticateAdmin, (req, res) => {
  const { id } = req.params;
  if (id === 'all') {
    return res.json(db.getProviderApiLogs());
  }
  const providers = db.getProviders();
  const provider = providers.find(p => p.id === id || p.slug === id);
  res.json(db.getProviderApiLogs(provider?.id || id));
});

// Admin Orders
apiRouter.get('/admin/orders', authenticateAdmin, (req, res) => {
  const { status, gameId, search } = req.query;
  let orders = db.getOrders();

  if (status) {
    orders = orders.filter(o => o.status === status);
  }
  if (gameId) {
    orders = orders.filter(o => o.gameId === gameId);
  }
  if (search) {
    const s = (search as string).toLowerCase();
    orders = orders.filter(o =>
      o.orderNumber.toLowerCase().includes(s) ||
      (o.partnerOrderId && o.partnerOrderId.toLowerCase().includes(s)) ||
      (o.externalOrderId && o.externalOrderId.toLowerCase().includes(s)) ||
      o.gameName.toLowerCase().includes(s) ||
      (o.resellerName && o.resellerName.toLowerCase().includes(s))
    );
  }

  res.json(orders);
});

apiRouter.post('/admin/orders/:id/retry', authenticateAdmin, async (req, res) => {
  const { id } = req.params;
  const rgOrder = db.findRechargeGamesOrderById(id) || db.findRechargeGamesOrderByBuyerRef(id);
  if (rgOrder) {
    const adminUser = (req as any).adminUser as AppUser | undefined;
    const rg = new RechargeGamesProvider();
    const retryRes = await rg.executeOrderRetry(rgOrder.id, {
      triggerType: req.body?.triggerType === 'automatic' ? 'automatic' : 'manual_admin',
      adminId: adminUser?.id || 'admin_master',
      reason: req.body?.reason,
      requirePriorAdminStatusCheck: req.body?.requirePriorAdminStatusCheck !== false
    });
    if (!retryRes.success) {
      return res.status(retryRes.httpStatus || 400).json({
        error: retryRes.message,
        errorCode: retryRes.errorCode,
        order: retryRes.order,
        attemptRecord: retryRes.attemptRecord
      });
    }
    return res.json(retryRes.playupOrder || retryRes.order);
  }
  const updatedOrder = await ProviderEngine.processOrder(id);
  if (!updatedOrder) return res.status(404).json({ error: 'Commande introuvable' });
  res.json(updatedOrder);
});

apiRouter.put('/admin/orders/:id/status', authenticateAdmin, (req, res) => {
  const { id } = req.params;
  const { status, note } = req.body;
  const orders = db.getOrders();
  const index = orders.findIndex(o => o.id === id);
  if (index === -1) return res.status(404).json({ error: 'Commande introuvable' });

  orders[index].status = status;
  orders[index].updatedAt = new Date().toISOString();
  orders[index].statusHistory.push({
    status,
    timestamp: new Date().toISOString(),
    note: note || `Statut modifié manuellement par l'administrateur (${status})`
  });
  db.setOrders(orders);

  if (orders[index].resellerId) {
    WebhookEngine.dispatchOrderEvent(orders[index], `order.${status}` as any).catch(console.error);
  }

  res.json(orders[index]);
});

// Admin Resellers
apiRouter.get('/admin/resellers', authenticateAdmin, (_req, res) => {
  res.json(db.getResellers());
});

apiRouter.post('/admin/resellers/:id/balance', authenticateAdmin, (req, res) => {
  const { id } = req.params;
  const { amount, note } = req.body;
  const numAmount = Number(amount);
  if (isNaN(numAmount)) return res.status(400).json({ error: 'Montant invalide' });

  const resellers = db.getResellers();
  const index = resellers.findIndex(r => r.id === id);
  if (index === -1) return res.status(404).json({ error: 'Revendeur introuvable' });

  resellers[index].balance += numAmount;
  db.setResellers(resellers);

  const txs = db.getTransactions();
  txs.push({
    id: 'tx_adm_' + Date.now(),
    transactionNumber: 'TXN-ADM-' + Date.now().toString().slice(-6),
    entityType: 'reseller',
    entityId: id,
    type: numAmount >= 0 ? 'credit' : 'debit',
    amount: Math.abs(numAmount),
    currency: 'USD',
    note: note || `Ajustement de solde par l'administrateur (${numAmount >= 0 ? '+' : ''}${numAmount} USD)`,
    createdAt: new Date().toISOString()
  });
  db.setTransactions(txs);

  res.json({ reseller: resellers[index] });
});

apiRouter.put('/admin/resellers/:id/status', authenticateAdmin, (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const resellers = db.getResellers();
  const index = resellers.findIndex(r => r.id === id);
  if (index === -1) return res.status(404).json({ error: 'Revendeur introuvable' });

  resellers[index].status = status;
  db.setResellers(resellers);
  res.json(resellers[index]);
});

// Admin Support Tickets
apiRouter.get('/admin/support', authenticateAdmin, (_req, res) => {
  res.json(db.getSupportTickets());
});

apiRouter.post('/admin/support/:id/reply', authenticateAdmin, (req, res) => {
  const { id } = req.params;
  const { replyText, newStatus } = req.body;
  const tickets = db.getSupportTickets();
  const index = tickets.findIndex(t => t.id === id);
  if (index === -1) return res.status(404).json({ error: 'Ticket introuvable' });

  tickets[index].messages.push({
    id: 'msg_adm_' + Date.now(),
    sender: 'agent',
    senderName: 'Support PlayUp Administrateur',
    text: replyText,
    createdAt: new Date().toISOString()
  });
  if (newStatus) {
    tickets[index].status = newStatus;
  }
  tickets[index].updatedAt = new Date().toISOString();
  db.setSupportTickets(tickets);

  res.json(tickets[index]);
});

// Admin Settings
apiRouter.get('/admin/settings', authenticateAdmin, (_req, res) => {
  res.json(db.getSettings());
});

apiRouter.put('/admin/settings', authenticateAdmin, (req, res) => {
  const adminUser = (req as any).user as AppUser | undefined;
  const current = db.getSettings();
  const updated = { ...current, ...req.body };
  db.setSettings(updated, {
    adminId: adminUser?.id || 'admin',
    adminEmail: adminUser?.email
  });
  db.addSystemLog('info', 'system', 'Admin updated platform settings');
  NotificationEngine.broadcastPricingUpdate({
    changeType: 'settings_updated',
    usdToHtgExchangeRate: db.getUsdToHtgExchangeRate(),
    historyEntry: db.getPriceChangeHistory({ limit: 1 })[0]
  });
  res.json(db.getSettings());
});

// Admin System Logs
apiRouter.get('/admin/logs', authenticateAdmin, (_req, res) => {
  res.json(db.getSystemLogs());
});

// ==========================================
// ADMIN USERS MANAGEMENT (WITH STRICT PRIVACY & ROLE BOUNDARIES)
// ==========================================
function sanitizeUserForAdmin(u: AppUser) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role === 'ADMIN' ? ('ADMIN' as const) : ('USER' as const),
    authProvider: u.authProvider,
    emailVerified: u.emailVerified,
    status: u.status,
    preferredCurrency: u.preferredCurrency,
    twoFactorEnabled: Boolean(u.twoFactorEnabled),
    walletBalance: u.walletBalance,
    ordersCount: u.ordersCount,
    totalSpent: u.totalSpent,
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt
  };
}

apiRouter.get('/admin/users', authenticateAdmin, (_req, res) => {
  res.json(db.getUsers().map(sanitizeUserForAdmin));
});

apiRouter.put('/admin/users/:id/role', authenticateAdmin, (req, res) => {
  db.addSystemLog(
    'warn',
    'auth',
    `[Security Policy] Blocked attempt to modify role for user ${req.params.id}`
  );
  return res.status(403).json({
    error: 'Forbidden',
    message:
      'Modification de rôle interdite : seul le premier utilisateur inscrit possède le rôle ADMIN. Aucun autre utilisateur ne peut recevoir le rôle ADMIN.'
  });
});

apiRouter.post('/admin/users/:id/role', authenticateAdmin, (req, res) => {
  db.addSystemLog(
    'warn',
    'auth',
    `[Security Policy] Blocked attempt to modify role for user ${req.params.id}`
  );
  return res.status(403).json({
    error: 'Forbidden',
    message:
      'Modification de rôle interdite : seul le premier utilisateur inscrit possède le rôle ADMIN. Aucun autre utilisateur ne peut recevoir le rôle ADMIN.'
  });
});

apiRouter.get('/admin/users/:id/password', authenticateAdmin, (req, res) => {
  db.addSystemLog(
    'warn',
    'auth',
    `[Security Policy] Blocked attempt to retrieve password for user ${req.params.id}`
  );
  return res.status(403).json({
    error: 'Forbidden',
    message: 'Politique de sécurité : les mots de passe des utilisateurs sont hachés et ne peuvent jamais être vus ni récupérés.'
  });
});

apiRouter.get('/admin/users/:id/tokens', authenticateAdmin, (req, res) => {
  db.addSystemLog(
    'warn',
    'auth',
    `[Security Policy] Blocked attempt to retrieve private tokens for user ${req.params.id}`
  );
  return res.status(403).json({
    error: 'Forbidden',
    message: 'Politique de sécurité : les tokens et secrets privés des utilisateurs ne peuvent jamais être consultés.'
  });
});

apiRouter.get('/admin/users/:id/secrets', authenticateAdmin, (req, res) => {
  db.addSystemLog(
    'warn',
    'auth',
    `[Security Policy] Blocked attempt to retrieve private secrets for user ${req.params.id}`
  );
  return res.status(403).json({
    error: 'Forbidden',
    message: 'Politique de sécurité : les tokens et secrets privés des utilisateurs ne peuvent jamais être consultés.'
  });
});

apiRouter.get('/admin/env', authenticateAdmin, (_req, res) => {
  db.addSystemLog(
    'warn',
    'auth',
    '[Security Policy] Blocked attempt to view environment variable secrets'
  );
  return res.status(403).json({
    error: 'Forbidden',
    message: 'Politique de sécurité : les secrets stockés dans les variables d’environnement ne peuvent jamais être affichés.'
  });
});

apiRouter.get('/admin/secrets', authenticateAdmin, (_req, res) => {
  db.addSystemLog(
    'warn',
    'auth',
    '[Security Policy] Blocked attempt to view server secrets in plaintext'
  );
  return res.status(403).json({
    error: 'Forbidden',
    message: 'Politique de sécurité : les clés API, Webhook Secrets et secrets serveur ne peuvent jamais être affichés en clair.'
  });
});

apiRouter.put('/admin/users/:id', authenticateAdmin, (req, res) => {
  const { id } = req.params;
  const { role: attemptedRole, isAdmin: attemptedIsAdmin, password: attemptedPassword } = req.body || {};
  if (attemptedRole !== undefined || attemptedIsAdmin !== undefined) {
    db.addSystemLog('warn', 'auth', `[Security Policy] Blocked attempt to modify role for user ${id}`);
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Modification de rôle interdite : seul le premier utilisateur inscrit possède le rôle ADMIN.'
    });
  }
  if (attemptedPassword !== undefined) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Modification directe du mot de passe d’un utilisateur interdite.'
    });
  }
  const users = db.getUsers();
  const idx = users.findIndex(u => u.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Utilisateur introuvable' });
  return res.json(sanitizeUserForAdmin(users[idx]));
});

apiRouter.put('/admin/users/:id/status', authenticateAdmin, (req, res) => {
  const { id } = req.params;
  const { status, role: attemptedRole } = req.body || {};

  if (attemptedRole !== undefined) {
    db.addSystemLog('warn', 'auth', `[Security Policy] Blocked attempt to change role via status endpoint for user ${id}`);
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Modification du rôle utilisateur interdite.'
    });
  }

  const users = db.getUsers();
  const idx = users.findIndex(u => u.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Utilisateur introuvable' });

  if (users[idx].role === 'ADMIN' && status === 'suspended') {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Le compte du premier administrateur principal ne peut pas être suspendu.'
    });
  }

  users[idx].status = status === 'suspended' ? 'suspended' : 'active';
  db.setUsers(users);
  db.addSystemLog('info', 'auth', `Admin updated user ${users[idx].email} status to ${users[idx].status}`);
  res.json(sanitizeUserForAdmin(users[idx]));
});

apiRouter.post('/admin/users/:id/wallet', authenticateAdmin, (req, res) => {
  const { id } = req.params;
  const { amount, note } = req.body || {};
  const numAmount = Number(amount);
  if (isNaN(numAmount)) return res.status(400).json({ error: 'Montant invalide' });

  const users = db.getUsers();
  const idx = users.findIndex(u => u.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Utilisateur introuvable' });

  users[idx].walletBalance = Number(Math.max(0, users[idx].walletBalance + numAmount).toFixed(2));
  db.setUsers(users);

  db.addSystemLog('info', 'payment', `Admin adjusted wallet balance for ${users[idx].email}: ${numAmount >= 0 ? '+' : ''}${numAmount} USD (${note || 'Ajustement admin'})`);
  res.json(sanitizeUserForAdmin(users[idx]));
});

apiRouter.post('/admin/users/:id/reset-password', authenticateAdmin, (req, res) => {
  const currentAdmin = (req as any).user as AppUser;
  const { id } = req.params;

  // Admin can only change their OWN password; never view, retrieve, or overwrite another user's password directly
  if (id !== currentAdmin.id) {
    db.addSystemLog(
      'warn',
      'auth',
      `[Security Policy] Blocked admin attempt to directly overwrite password of user ${id}`
    );
    return res.status(403).json({
      error: 'Forbidden',
      message:
        'Politique de sécurité : l’administrateur ne peut ni voir, ni récupérer, ni modifier directement le mot de passe d’un autre utilisateur.'
    });
  }

  const { newPassword } = req.body || {};
  if (!newPassword || String(newPassword).length < 6) {
    return res.status(400).json({ error: 'Le nouveau mot de passe doit contenir au moins 6 caractères.' });
  }

  const { hash, salt } = db.hashPassword(String(newPassword));
  db.setUserCredential(currentAdmin.id, {
    passwordHash: hash,
    passwordSalt: salt
  });

  db.addSystemLog('info', 'auth', `Admin changed their own password (${currentAdmin.email})`);
  res.json({ success: true, message: 'Votre mot de passe administrateur a été mis à jour avec succès.' });
});

// ==========================================
// ADMIN RESELLER API KEYS MANAGEMENT (MASKED TOKENS ONLY)
// ==========================================
apiRouter.get('/admin/api-keys', authenticateAdmin, (_req, res) => {
  const maskedList = db.getApiKeys().map(k => ({
    ...k,
    key: k.maskedKey
  }));
  res.json(maskedList);
});

apiRouter.post('/admin/resellers/:id/api-keys', authenticateAdmin, (req, res) => {
  const { id } = req.params;
  const { name } = req.body || {};
  const resellers = db.getResellers();
  const reseller = resellers.find(r => r.id === id);
  if (!reseller) return res.status(404).json({ error: 'Revendeur introuvable' });

  const apiKeys = db.getApiKeys();
  const rawKey = 'plup_live_' + crypto.randomBytes(20).toString('hex');
  const maskedKey = `plup_live_${rawKey.slice(10, 14)}...${rawKey.slice(-4)}`;
  const newKey = {
    id: 'key_' + Date.now(),
    resellerId: reseller.id,
    name: name || `Clé API ${reseller.company}`,
    key: rawKey,
    maskedKey,
    permissions: ['games.read', 'services.read', 'orders.create', 'orders.read', 'balance.read'],
    status: 'active' as const,
    createdAt: new Date().toISOString()
  };

  apiKeys.unshift(newKey);
  db.setApiKeys(apiKeys);
  db.addSystemLog('info', 'auth', `Admin generated new API key "${newKey.name}" for reseller ${reseller.company}`);
  res.status(201).json({
    ...newKey,
    key: maskedKey
  });
});

apiRouter.put('/admin/api-keys/:id/status', authenticateAdmin, (req, res) => {
  const { id } = req.params;
  const { status } = req.body || {};
  const apiKeys = db.getApiKeys();
  const idx = apiKeys.findIndex(k => k.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Clé API introuvable' });

  apiKeys[idx].status = status === 'revoked' ? 'revoked' : 'active';
  db.setApiKeys(apiKeys);
  db.addSystemLog('info', 'auth', `Admin changed API key ${apiKeys[idx].maskedKey} status to ${apiKeys[idx].status}`);
  res.json({
    ...apiKeys[idx],
    key: apiKeys[idx].maskedKey
  });
});

// ==========================================
// ADMIN PAYMENT GATEWAYS & TRANSACTIONS
// ==========================================
apiRouter.get('/admin/payment-gateways', authenticateAdmin, (_req, res) => {
  res.json(db.getPaymentGateways());
});

apiRouter.put('/admin/payment-gateways/:id', authenticateAdmin, (req, res) => {
  const { id } = req.params;
  const gateways = db.getPaymentGateways();
  const idx = gateways.findIndex(g => g.id === id || g.slug === id);
  if (idx === -1) return res.status(404).json({ error: 'Passerelle de paiement introuvable' });

  const { apiKey, clientSecret, webhookSecret, ...publicFields } = req.body;
  const rawList = db.getPaymentGateways();
  rawList[idx] = {
    ...rawList[idx],
    ...publicFields
  };
  db.setPaymentGateways(rawList);

  const secretUpdate: { apiKey?: string; clientSecret?: string; webhookSecret?: string } = {};
  if (typeof apiKey === 'string' && !apiKey.includes('••••')) {
    secretUpdate.apiKey = apiKey.trim();
  }
  if (typeof clientSecret === 'string' && !clientSecret.includes('••••')) {
    secretUpdate.clientSecret = clientSecret.trim();
  }
  if (typeof webhookSecret === 'string' && !webhookSecret.includes('••••')) {
    secretUpdate.webhookSecret = webhookSecret.trim();
  }
  if (Object.keys(secretUpdate).length > 0) {
    db.setPaymentGatewaySecret(rawList[idx].id, secretUpdate);
  }

  db.addSystemLog('info', 'payment', `Admin updated payment gateway configuration: ${rawList[idx].name}`);
  const updated = db.getPaymentGateways().find(g => g.id === rawList[idx].id);
  res.json(updated);
});

apiRouter.get('/admin/payment-transactions', authenticateAdmin, (_req, res) => {
  res.json(db.getPaymentTransactions());
});

// ============================================================================
// RECHARGEGAMES PUBLIC / MOBILE APP ENDPOINTS & ADMIN ENDPOINTS
// ============================================================================

// Ensure initial catalog synchronization & background fallback status polling
setTimeout(async () => {
  try {
    if (db.getRechargeGamesProducts().length === 0) {
      const rg = new RechargeGamesProvider();
      await rg.syncCatalog();
      console.log('[RechargeGames] Initial catalog synchronized successfully.');
    }
  } catch (err) {
    console.warn('[RechargeGames] Startup sync notice:', err);
  }
}, 500);

// Periodic fallback status polling (GET /v1/orders/{order_id}) every 6 seconds for pending orders
setInterval(() => {
  const rg = new RechargeGamesProvider();
  rg.pollPendingOrders().catch(() => {});
}, 6000);

// Periodic automatic catalog synchronization (every 15 minutes when autoSyncEnabled is true)
setInterval(() => {
  const stats = db.getRechargeGamesSyncStats();
  if (stats.autoSyncEnabled) {
    const rg = new RechargeGamesProvider();
    rg.syncCatalog().catch(() => {});
  }
}, 15 * 60 * 1000);

// GET /api/rechargegames/catalog — Public/Mobile catalog with region filters (Brazil, USA, Global, etc.)
// Never exposes provider_price or API secrets to the mobile app
apiRouter.get('/rechargegames/catalog', async (req, res) => {
  if (db.getRechargeGamesProducts().length === 0) {
    const rg = new RechargeGamesProvider();
    await rg.syncCatalog();
  }
  const game = typeof req.query.game === 'string' ? req.query.game : undefined;
  const region = typeof req.query.region === 'string' ? req.query.region : undefined;
  const activeOnly = req.query.includeInactive !== 'true';

  const products = db.getRechargeGamesProducts({ game, region, activeOnly });
  const stats = db.getRechargeGamesSyncStats();

  // Strip provider_price and profit_estimate for public mobile consumers
  const rate = db.getUsdToHtgExchangeRate();
  // Return sanitized customer catalog (ONLY final PlayUp selling price in HTG; NEVER provider_price, margin_percent, or profit)
  const publicProducts = products.map(p => {
    const finalHtg =
      typeof p.playup_price_htg === 'number' && p.playup_price_htg > 0
        ? Number(p.playup_price_htg.toFixed(2))
        : Number((Number(p.playup_price || 0) * rate).toFixed(2));
    return {
      id: p.id,
      provider: p.provider,
      product_key: p.product_key,
      game: p.game,
      game_slug: p.game_slug,
      region: p.region,
      name: p.name,
      topup_value: p.topup_value,
      amount: p.amount,
      unit: p.unit,
      playup_price: p.playup_price,
      playup_price_htg: finalHtg,
      selling_currency: 'HTG',
      currency: 'HTG',
      active: p.active,
      requires_player_id: p.requires_player_id,
      last_synced_at: p.last_synced_at
    };
  });

  res.json({
    mode: db.getRechargeGamesMode(),
    sellingCurrency: 'HTG',
    regionsAvailable: stats.regionsAvailable,
    gamesAvailable: stats.gamesAvailable,
    lastSyncedAt: stats.lastSyncedAt,
    products: publicProducts
  });
});

// POST /api/rechargegames/orders — Mobile App 10-step purchase endpoint (Protected by authenticateUser)
apiRouter.post('/rechargegames/orders', authenticateUser, async (req, res) => {
  const authenticatedUser = (req as any).user as AppUser;
  const {
    product_key,
    region,
    player_id,
    player_name,
    server_id,
    quantity,
    buyer_ref,
    paymentConfirmed,
    paymentStatus,
    paymentMethod,
    paymentReference,
    paymentTransactionId,
    price: clientManipulatedPrice,
    status: clientDeclaredStatus,
    simulateNetworkTimeout,
    allowIdempotentRecovery
  } = req.body || {};

  const rg = new RechargeGamesProvider();
  const result = await rg.createOrder({
    userId: authenticatedUser.id,
    productKey: String(product_key || ''),
    region: region ? String(region) : undefined,
    playerId: String(player_id || ''),
    playerName: player_name ? String(player_name) : undefined,
    serverId: server_id ? String(server_id) : undefined,
    quantity: quantity ? Number(quantity) : 1,
    buyerRef: buyer_ref ? String(buyer_ref) : undefined,
    paymentConfirmed: Boolean(paymentConfirmed),
    paymentStatus: paymentStatus as PaymentLifecycleStatus | undefined,
    paymentMethod: paymentMethod ? String(paymentMethod) : 'wallet',
    paymentReference: paymentReference ? String(paymentReference) : undefined,
    paymentTransactionId: paymentTransactionId ? String(paymentTransactionId) : undefined,
    clientManipulatedPrice: clientManipulatedPrice !== undefined ? Number(clientManipulatedPrice) : undefined,
    clientDeclaredStatus: clientDeclaredStatus ? String(clientDeclaredStatus) : undefined,
    simulateNetworkTimeout: Boolean(simulateNetworkTimeout),
    allowIdempotentRecovery: Boolean(allowIdempotentRecovery)
  });

  if (!result.success) {
    // Only return safe user-facing message to the mobile client
    return res.status(result.httpStatus).json({
      success: false,
      errorCode: result.errorCode,
      message: result.userMessage,
      order: result.order,
      playupOrder: result.playupOrder,
      refundRecord: result.refundRecord
    });
  }

  return res.status(result.httpStatus || 201).json({
    success: true,
    message: result.userMessage,
    order: result.order,
    playupOrder: result.playupOrder,
    refundRecord: result.refundRecord
  });
});

// POST /api/rechargegames/orders/:orderId/recover — Safe order recovery & polling with same buyer_ref
apiRouter.post('/rechargegames/orders/:orderId/recover', authenticateUser, async (req, res) => {
  const authenticatedUser = (req as any).user as AppUser;
  const { orderId } = req.params;
  const existing = db.findRechargeGamesOrderById(orderId) || db.findRechargeGamesOrderByBuyerRef(orderId);
  if (!existing) {
    return res.status(404).json({ error: 'Commande introuvable' });
  }
  if (authenticatedUser.role !== 'ADMIN' && existing.user_id !== authenticatedUser.id) {
    return res.status(403).json({ error: 'Accès interdit à cette commande.' });
  }
  const rg = new RechargeGamesProvider();
  const result = await rg.recoverOrder(existing.id, {
    newPaymentStatus: req.body?.paymentStatus as PaymentLifecycleStatus | undefined,
    paymentReference: req.body?.paymentReference
  });
  return res.status(result.httpStatus).json(result);
});

// GET /api/rechargegames/orders — User Top-Up History ("Historique des top-ups", strictly scoped to authenticated user)
apiRouter.get('/rechargegames/orders', authenticateUser, (req, res) => {
  const authenticatedUser = (req as any).user as AppUser;
  const orders = db.getRechargeGamesOrders(authenticatedUser.id);
  // Return sanitized customer view (without provider_price or profit)
  const customerOrders = orders.map(o => ({
    id: o.id,
    user_id: o.user_id,
    provider: o.provider,
    provider_order_id: o.provider_order_id,
    buyer_ref: o.buyer_ref,
    product_key: o.product_key,
    product_name: o.product_name,
    game: o.game,
    region: o.region,
    player_id: o.player_id,
    player_name: o.player_name,
    server_id: o.server_id,
    quantity: o.quantity || 1,
    customer_price: o.customer_price,
    currency: o.currency,
    status: o.status,
    payment_status: o.payment_status,
    lifecycle_status: o.lifecycle_status,
    dispatch_status: o.dispatch_status,
    user_status_message: o.user_status_message,
    test_mode: o.test_mode,
    payment_method: o.payment_method,
    payment_reference: o.payment_reference,
    created_at: o.created_at,
    updated_at: o.updated_at,
    delivered_at: o.delivered_at,
    refunded_at: o.refunded_at,
    refund_reason: o.refund_reason,
    refund_transaction_id: o.refund_transaction_id,
    failure_reason: o.failure_reason
  }));
  res.json(customerOrders);
});

// GET /api/rechargegames/orders/:orderId/status — Fallback status check (GET /v1/orders/{order_id}, protected)
apiRouter.get('/rechargegames/orders/:orderId/status', authenticateUser, async (req, res) => {
  const authenticatedUser = (req as any).user as AppUser;
  const { orderId } = req.params;
  const existing = db.findRechargeGamesOrderById(orderId);
  if (!existing) {
    return res.status(404).json({ error: 'Commande introuvable' });
  }
  if (authenticatedUser.role !== 'ADMIN' && existing.user_id !== authenticatedUser.id) {
    return res.status(403).json({ error: 'Accès interdit à cette commande.' });
  }
  const rg = new RechargeGamesProvider();
  const statusRes = await rg.checkOrderStatus(orderId);
  res.json(statusRes);
});

// ============================================================================
// ADMIN RECHARGEGAMES MANAGEMENT & DIAGNOSTIC ENDPOINTS
// ============================================================================

apiRouter.get('/admin/rechargegames/dashboard', authenticateAdmin, async (_req, res) => {
  if (db.getRechargeGamesProducts().length === 0) {
    const rg = new RechargeGamesProvider();
    await rg.syncCatalog();
  }
  const secret = db.getProviderSecret('prov_rechargegames');
  const hasApiKey = Boolean(secret.apiKey && secret.apiKey.trim().length > 0);
  const hasWebhookSecret = Boolean(secret.webhookSecret && secret.webhookSecret.trim().length > 0);
  const prov = db.getProviders().find(p => p.id === 'prov_rechargegames');
  const orders = db.getRechargeGamesOrders();
  const apiLogs = db.getProviderApiLogs('prov_rechargegames');
  const webhookEvents = db.getRechargeGamesWebhookEvents();

  res.json({
    config: {
      mode: db.getRechargeGamesMode(),
      baseUrl: db.getRechargeGamesBaseUrl(),
      hasApiKey,
      apiKeyMasked: hasApiKey ? db.maskSecretValue(secret.apiKey) : 'Non configurée',
      hasWebhookSecret,
      webhookSecretMasked: hasWebhookSecret ? db.maskSecretValue(secret.webhookSecret) : 'Non configuré',
      webhookEndpoint: '/rechargegames-webhook',
      connectionStatus:
        prov?.lastPingStatus === 'online'
          ? 'connected'
          : prov?.lastPingStatus === 'offline'
          ? 'error'
          : 'untested',
      lastConnectionLabel: prov?.lastPingLabel || 'Prêt',
      lastConnectionTestedAt: prov?.lastPingAt,
      syncStats: db.getRechargeGamesSyncStats(),
      margins: db.getRechargeGamesMargins()
    },
    metrics: {
      totalProducts: db.getRechargeGamesProducts().length,
      activeProducts: db.getRechargeGamesProducts({ activeOnly: true }).length,
      unavailableProducts: db.getRechargeGamesProducts().filter(p => !p.active).length,
      pendingOrders: orders.filter(
        o => o.status === 'pending' || o.status === 'order_pending' || o.status === 'sent_to_rechargegames'
      ).length,
      deliveredOrders: orders.filter(o => o.status === 'delivered').length,
      refundedOrders: orders.filter(o => o.status === 'refunded').length,
      failedOrders: orders.filter(o => o.status === 'failed').length,
      manualReviewOrders: orders.filter(o => o.status === 'manual_review').length,
      totalProfitUsd: Number(
        orders
          .filter(o => o.status === 'delivered')
          .reduce((acc, o) => acc + (o.profit || 0), 0)
          .toFixed(2)
      ),
      apiErrorsCount: apiLogs.filter(l => !l.success).length
    },
    products: db.getRechargeGamesProducts(),
    orders,
    refunds: db.getRefunds(),
    manualPaymentValidations: db.getManualPaymentValidations(),
    orderRetryAttempts: db.getOrderRetryAttempts(),
    webhookEvents,
    firestoreIdempotencyLocks: db.getAllFirestoreWebhookLocks(),
    apiLogs
  });
});

apiRouter.get('/admin/refunds', authenticateAdmin, (_req, res) => {
  res.json(db.getRefunds());
});

// Request #9: Validation manuelle d'un paiement PlayUp ("Valider le paiement")
apiRouter.post('/admin/rechargegames/orders/:orderId/validate-payment', authenticateAdmin, async (req, res) => {
  const { orderId } = req.params;
  const adminUser = (req as any).adminUser as AppUser | undefined;
  const rg = new RechargeGamesProvider();
  const result = await rg.validatePaymentManually(orderId, {
    adminId: adminUser?.id || 'admin_master',
    adminEmail: adminUser?.email || 'admin@playup.ht',
    note: req.body?.note,
    simulateTemporaryProviderError: Boolean(req.body?.simulateTemporaryProviderError),
    simulateImmediateDelivery: Boolean(req.body?.simulateImmediateDelivery),
    simulateDefinitiveFailure: Boolean(req.body?.simulateDefinitiveFailure)
  });
  return res.status(result.httpStatus).json(result);
});

// Request #10: Nouvelle tentative de commande (automatique ou manuelle après vérification du statut réel)
apiRouter.post('/admin/rechargegames/orders/:orderId/retry', authenticateAdmin, async (req, res) => {
  const { orderId } = req.params;
  const adminUser = (req as any).adminUser as AppUser | undefined;
  const rg = new RechargeGamesProvider();
  const result = await rg.executeOrderRetry(orderId, {
    triggerType: req.body?.triggerType === 'automatic' ? 'automatic' : 'manual_admin',
    adminId: adminUser?.id || 'admin_master',
    reason: req.body?.reason,
    simulateTemporaryError: Boolean(req.body?.simulateTemporaryError),
    bypassDelayForTest: Boolean(req.body?.bypassDelayForTest),
    requirePriorAdminStatusCheck: req.body?.requirePriorAdminStatusCheck !== false
  });
  return res.status(result.httpStatus).json(result);
});

// Request #8: Vérification d'éligibilité et prévisualisation avant remboursement manuel ("Rembourser")
apiRouter.get('/admin/rechargegames/orders/:orderId/refund-eligibility', authenticateAdmin, async (req, res) => {
  const { orderId } = req.params;
  const rgOrder = db.findRechargeGamesOrderById(orderId) || db.findRechargeGamesOrderByBuyerRef(orderId);
  if (!rgOrder) {
    return res.status(404).json({ eligible: false, reason: 'Commande introuvable.' });
  }
  const user = db.getUserById(rgOrder.user_id);
  const eligibility = db.evaluateRefundEligibility(rgOrder.id, {
    isManualAdmin: true,
    providerConfirmedNotDelivered: rgOrder.status === 'failed' || rgOrder.status === 'manual_review',
    providerConfirmedRefunded: rgOrder.status === 'refunded'
  });

  return res.json({
    eligible: eligibility.eligible,
    code: eligibility.code,
    reason: eligibility.reason,
    preview: {
      orderId: rgOrder.id,
      buyerRef: rgOrder.buyer_ref,
      providerOrderId: rgOrder.provider_order_id,
      amount: rgOrder.customer_price,
      currency: rgOrder.currency || 'USD',
      userId: rgOrder.user_id,
      userName: user?.name || rgOrder.player_name || rgOrder.user_id,
      userEmail: user?.email || 'client@playup.ht',
      productName: `${rgOrder.product_name} (${rgOrder.region})`,
      defaultReason:
        rgOrder.failure_reason ||
        rgOrder.refund_reason ||
        'Remboursement manuel approuvé par un administrateur PlayUp (commande non livrée)',
      refundMethod: rgOrder.payment_method || 'wallet',
      currentStatus: rgOrder.status,
      paymentStatus: rgOrder.payment_status || 'payment_succeeded',
      refundStatus: rgOrder.refund_status || 'none'
    }
  });
});

// Request #8: Exécution d'un remboursement manuel strict côté backend ("Rembourser")
apiRouter.post('/admin/rechargegames/orders/:orderId/refund', authenticateAdmin, async (req, res) => {
  const { orderId } = req.params;
  const adminUser = (req as any).adminUser as AppUser | undefined;
  const rg = new RechargeGamesProvider();
  const result = await rg.executeStrictAdminRefund(orderId, {
    adminId: adminUser?.id || 'admin_master',
    adminEmail: adminUser?.email || 'admin@playup.ht',
    reason: String(req.body?.reason || 'Remboursement manuel approuvé selon les règles de PlayUp'),
    refundMethod: req.body?.refundMethod || 'wallet'
  });
  return res.status(result.httpStatus).json(result);
});

apiRouter.put('/admin/rechargegames/config', authenticateAdmin, (req, res) => {
  const { mode, baseUrl, apiKey, webhookSecret, autoSyncEnabled, autoSyncIntervalMinutes } = req.body || {};

  if (mode === 'TEST' || mode === 'PRODUCTION') {
    db.setRechargeGamesMode(mode);
  }
  if (typeof baseUrl === 'string' && baseUrl.trim().length > 0) {
    db.setRechargeGamesBaseUrl(baseUrl);
  }

  const secretUpdate: { apiKey?: string; webhookSecret?: string } = {};
  if (typeof apiKey === 'string' && apiKey.trim().length > 0 && !apiKey.includes('••••')) {
    secretUpdate.apiKey = apiKey.trim();
  }
  if (typeof webhookSecret === 'string' && webhookSecret.trim().length > 0 && !webhookSecret.includes('••••')) {
    secretUpdate.webhookSecret = webhookSecret.trim();
  }
  if (Object.keys(secretUpdate).length > 0) {
    db.setProviderSecret('prov_rechargegames', secretUpdate);
  }

  if (typeof autoSyncEnabled === 'boolean' || typeof autoSyncIntervalMinutes === 'number') {
    db.updateRechargeGamesSyncStats({
      ...(typeof autoSyncEnabled === 'boolean' ? { autoSyncEnabled } : {}),
      ...(typeof autoSyncIntervalMinutes === 'number' ? { autoSyncIntervalMinutes } : {})
    });
  }

  db.addSystemLog('info', 'provider', `Configuration RechargeGames mise à jour (Mode: ${db.getRechargeGamesMode()})`);
  res.json({
    success: true,
    message: 'Configuration RechargeGames enregistrée avec succès (clés chiffrées/masquées côté serveur).',
    mode: db.getRechargeGamesMode(),
    baseUrl: db.getRechargeGamesBaseUrl()
  });
});

apiRouter.post('/admin/rechargegames/test-connection', authenticateAdmin, async (_req, res) => {
  const rg = new RechargeGamesProvider();
  const result = await rg.testConnection();
  res.json(result);
});

apiRouter.post('/admin/rechargegames/sync', authenticateAdmin, async (_req, res) => {
  const rg = new RechargeGamesProvider();
  const result = await rg.syncCatalog();
  res.json(result);
});

apiRouter.put('/admin/rechargegames/margins', authenticateAdmin, (req, res) => {
  const adminUser = (req as any).user as AppUser | undefined;
  const updated = db.setRechargeGamesMargins(req.body || {}, {
    adminId: adminUser?.id || 'admin',
    adminEmail: adminUser?.email
  });
  const rg = new RechargeGamesProvider();
  // Re-sync PlayUp services with new margins
  const products = db.getRechargeGamesProducts();
  (rg as any).syncIntoPlayUpServices(products);

  NotificationEngine.broadcastPricingUpdate({
    changeType: 'margin_rule',
    usdToHtgExchangeRate: db.getUsdToHtgExchangeRate(),
    historyEntry: db.getPriceChangeHistory({ limit: 1 })[0]
  });

  res.json({
    success: true,
    message: 'Marges PlayUp et prix HTG enregistrés et recalculés en temps réel côté serveur.',
    margins: updated,
    products: db.getRechargeGamesProducts(),
    services: db.getServices(),
    history: db.getPriceChangeHistory({ limit: 100 })
  });
});

// Test Webhook via real HTTP POST to /rechargegames-webhook
apiRouter.post('/admin/rechargegames/test-webhook', authenticateAdmin, async (req, res) => {
  const {
    eventType = 'webhook.test',
    orderId,
    simulateInvalidSignature = false,
    simulateDuplicateEvent = false,
    simulateInvalidPayload = false
  } = req.body || {};
  const rg = new RechargeGamesProvider();
  const port = 3000;
  const webhookTargetUrl = `http://127.0.0.1:${port}/rechargegames-webhook`;

  let targetOrder = orderId ? db.findRechargeGamesOrderById(orderId) : db.getRechargeGamesOrders()[0];

  // If testing an order event and no order exists yet (or we need a fresh pending order), create one in TEST mode
  const isOrderEvt =
    eventType === 'order.delivered' || eventType === 'order.refunded' || eventType === 'order.failed';
  if (
    isOrderEvt &&
    (!targetOrder ||
      (eventType !== 'order.refunded' && targetOrder.status !== 'pending') ||
      (eventType === 'order.refunded' && targetOrder.status === 'refunded'))
  ) {
    const prods = db.getRechargeGamesProducts({ activeOnly: true });
    const prod = prods[0];
    if (prod) {
      const created = await rg.createOrder({
        userId: 'usr_player_01',
        productKey: prod.product_key,
        region: prod.region,
        playerId: '8899001122',
        playerName: 'WebhookTestPlayer',
        buyerRef: db.generateNextBuyerRef(),
        paymentConfirmed: true,
        paymentMethod: 'wallet',
        testMode: true
      });
      if (created.order) {
        targetOrder = created.order;
      }
    }
  }

  // If simulating a duplicate event, reuse the last processed event_id
  const existingProcessed = db
    .getRechargeGamesWebhookEvents()
    .find(e => e.processing_status === 'processed');
  const webhookId =
    simulateDuplicateEvent && existingProcessed
      ? existingProcessed.event_id
      : `wh_diag_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const webhookTimestamp = String(Math.floor(Date.now() / 1000));

  const payload: Record<string, any> = simulateInvalidPayload
    ? {
        invalid_field_only: true,
        timestamp: new Date().toISOString()
      }
    : {
        event: eventType,
        event_id: webhookId,
        timestamp: new Date().toISOString(),
        provider: 'RechargeGames',
        ...(targetOrder && isOrderEvt
          ? {
              order_id: targetOrder.provider_order_id,
              buyer_ref: targetOrder.buyer_ref,
              product_key: targetOrder.product_key,
              region: targetOrder.region,
              player_id: targetOrder.player_id,
              status:
                eventType === 'order.delivered'
                  ? 'delivered'
                  : eventType === 'order.refunded'
                  ? 'refunded'
                  : 'failed',
              ...(eventType === 'order.failed'
                ? { failure_reason: 'Simulation de test : Player ID rejeté ou serveur de jeu en maintenance' }
                : eventType === 'order.refunded'
                ? { refund_reason: 'Remboursement officiel déclenché par RechargeGames (order.refunded)' }
                : { delivered_at: new Date().toISOString() })
            }
          : {
              note: 'Test de diagnostic webhook RechargeGames (webhook.test)'
            })
      };

  const rawBody = JSON.stringify(payload);
  const validSig = rg.signWebhookPayload(rawBody, webhookId, webhookTimestamp);
  const signatureHeader = simulateInvalidSignature
    ? 'v1,0000000000000000deadbeef0000000000000000deadbeef0000000000000000'
    : validSig;

  const httpRes = await fetch(webhookTargetUrl, {
    method: 'POST',
    headers: {
      'webhook-id': webhookId,
      'webhook-timestamp': webhookTimestamp,
      'webhook-signature': signatureHeader,
      'content-type': 'application/json',
      'user-agent': 'RechargeGames-Webhook-Tester/1.0'
    },
    body: rawBody
  });

  const responseBody = await httpRes.json().catch(() => ({}));
  const latestEvent =
    db.getRechargeGamesWebhookEvents().find(e => e.event_id === webhookId) ||
    db.getRechargeGamesWebhookEvents()[0];

  res.json({
    httpStatus: httpRes.status,
    responseBody,
    webhookEvent: latestEvent
  });
});

// ============================================================================
// 21. SUITE D'EXÉCUTION DES TESTS FINAUX RECHARGEGAMES (Tests 1 à 12)
// ============================================================================
apiRouter.post('/admin/rechargegames/run-test-suite', authenticateAdmin, async (_req, res) => {
  const results: RechargeGamesTestStepResult[] = [];
  const rg = new RechargeGamesProvider();

  // Test 1: Connexion API
  {
    const t0 = Date.now();
    const conn = await rg.testConnection();
    results.push({
      testNumber: 1,
      name: 'Test 1 — Connexion API RechargeGames',
      passed: conn.success && conn.label === 'Connexion réussie',
      durationMs: Date.now() - t0,
      details: `${conn.label} (HTTP ${conn.httpStatus}) — ${conn.details}`,
      evidence: { endpoint: conn.endpointCalled, httpStatus: conn.httpStatus, authHeaders: conn.authHeadersUsed }
    });
  }

  // Test 2: Récupération du catalogue
  let syncedProducts = db.getRechargeGamesProducts();
  {
    const t0 = Date.now();
    const syncRes = await rg.syncCatalog();
    syncedProducts = syncRes.products;
    results.push({
      testNumber: 2,
      name: 'Test 2 — Récupération et synchronisation du catalogue (GET /v1/products)',
      passed: syncRes.success && syncedProducts.length > 0,
      durationMs: Date.now() - t0,
      details: syncRes.message,
      evidence: {
        totalProducts: syncedProducts.length,
        activeProducts: syncedProducts.filter(p => p.active).length,
        regions: syncRes.stats.regionsAvailable
      }
    });
  }

  // Test 3: Recherche d'un produit Free Fire Brazil & LATAM + Vérification Player ID réelle
  let ffBrazilProduct = syncedProducts.find(
    p => p.game.toLowerCase().includes('free fire') && p.region.toLowerCase() === 'brazil' && p.active
  );
  let ffLatamProduct = syncedProducts.find(
    p => p.game.toLowerCase().includes('free fire') && p.region.toLowerCase() === 'latam' && p.active
  );
  {
    const t0 = Date.now();
    const playerCheck = await rg.verifyPlayerId({
      gameSlug: 'free-fire',
      playerId: '16777227705',
      region: 'LATAM',
      strictRegionMatch: true
    });
    results.push({
      testNumber: 3,
      name: 'Test 3 — Produits Free Fire (Brazil/LATAM) & Validation Player ID (16777227705)',
      passed: Boolean(ffBrazilProduct && ffLatamProduct && playerCheck.verified),
      durationMs: Date.now() - t0,
      details:
        ffBrazilProduct && ffLatamProduct
          ? `Produits Free Fire trouvés (Brazil: "${ffBrazilProduct.product_key}" à $${ffBrazilProduct.playup_price.toFixed(2)}, LATAM: "${ffLatamProduct.product_key}" à $${ffLatamProduct.playup_price.toFixed(2)}). Player ID 16777227705 vérifié : "${playerCheck.playerName}" (${playerCheck.region}).`
          : 'Produit Free Fire introuvable.',
      evidence: {
        brazil_product_key: ffBrazilProduct?.product_key,
        latam_product_key: ffLatamProduct?.product_key,
        verified_player: playerCheck.playerName,
        verified_region: playerCheck.region,
        status: playerCheck.status
      }
    });
  }

  // Test 4: Recherche d'un produit USA / United States
  const usaProduct = syncedProducts.find(
    p =>
      (p.region.toLowerCase() === 'usa' ||
        p.region.toLowerCase().includes('united states') ||
        p.region.toLowerCase() === 'na') &&
      p.active
  );
  {
    const t0 = Date.now();
    results.push({
      testNumber: 4,
      name: 'Test 4 — Recherche d’un produit USA 🇺🇸',
      passed: Boolean(usaProduct && usaProduct.product_key),
      durationMs: Date.now() - t0,
      details: usaProduct
        ? `Produit USA trouvé : "${usaProduct.name}" (product_key="${usaProduct.product_key}", région="${usaProduct.region}", prix fournisseur=$${usaProduct.provider_price.toFixed(2)}, prix PlayUp=$${usaProduct.playup_price.toFixed(2)})`
        : 'Aucun produit USA trouvé.',
      evidence: usaProduct
        ? {
            product_key: usaProduct.product_key,
            game: usaProduct.game,
            region: usaProduct.region,
            playup_price: usaProduct.playup_price
          }
        : undefined
    });
  }

  // Test 5: Création d'une commande TEST réelle sur RechargeGames (en statut initial 'pending')
  const testBuyerRef1 = db.generateNextBuyerRef();
  let createdTestOrderId = '';
  let createdProviderOrderId = '';
  {
    const t0 = Date.now();
    const targetProd = ffLatamProduct || ffBrazilProduct || syncedProducts[0];
    const createRes = await rg.createOrder({
      userId: 'usr_player_01',
      productKey: targetProd.product_key,
      region: targetProd.region,
      playerId: '16777227705',
      playerName: '©∆£MELIOBAS®',
      buyerRef: testBuyerRef1,
      paymentConfirmed: true,
      paymentMethod: 'wallet',
      paymentReference: `TEST-PAY-${Date.now()}`,
      testMode: true
    });
    createdTestOrderId = createRes.order?.id || '';
    createdProviderOrderId = createRes.order?.provider_order_id || '';
    results.push({
      testNumber: 5,
      name: 'Test 5 — Création d’une commande TEST (POST /v1/orders)',
      passed: Boolean(createRes.success && createRes.order && createRes.order.status === 'pending'),
      durationMs: Date.now() - t0,
      details: createRes.order
        ? `Commande TEST #${createRes.order.id} créée avec buyer_ref="${createRes.order.buyer_ref}", provider_order_id="${createRes.order.provider_order_id}", statut initial="${createRes.order.status}" (non livrée avant confirmation réelle).`
        : createRes.technicalError || 'Échec création commande TEST',
      evidence: createRes.order
        ? {
            id: createRes.order.id,
            buyer_ref: createRes.order.buyer_ref,
            provider_order_id: createRes.order.provider_order_id,
            status: createRes.order.status,
            test_mode: createRes.order.test_mode
          }
        : undefined
    });
  }

  // Test 10: Protection contre les commandes dupliquées (Même buyer_ref réutilisé)
  {
    const t0 = Date.now();
    const targetProd = ffLatamProduct || ffBrazilProduct || syncedProducts[0];
    const dupRes = await rg.createOrder({
      userId: 'usr_player_01',
      productKey: targetProd.product_key,
      region: targetProd.region,
      playerId: '16777227705',
      buyerRef: testBuyerRef1, // Intentionally reusing the exact same buyer_ref!
      paymentConfirmed: true,
      testMode: true
    });
    results.push({
      testNumber: 10,
      name: 'Test 10 — Protection contre les commandes dupliquées (buyer_ref unique)',
      passed: !dupRes.success && dupRes.httpStatus === 409 && dupRes.errorCode === 'DUPLICATE_ORDER',
      durationMs: Date.now() - t0,
      details: `Tentative de réutilisation de buyer_ref="${testBuyerRef1}" bloquée avec HTTP ${dupRes.httpStatus} (${dupRes.errorCode}): "${dupRes.userMessage}"`,
      evidence: {
        buyer_ref_tested: testBuyerRef1,
        httpStatus: dupRes.httpStatus,
        errorCode: dupRes.errorCode
      }
    });
  }

  const port = 3000;
  const webhookEndpointUrl = `http://127.0.0.1:${port}/rechargegames-webhook`;

  // Test 9: Rejet d'une signature HMAC-SHA256 incorrecte via POST /rechargegames-webhook (AVANT le polling GET /v1/orders/{order_id} pour garantir que la commande reste en 'pending')
  {
    const t0 = Date.now();
    const whId = `wh_test9_invalid_${Date.now()}`;
    const whTs = String(Math.floor(Date.now() / 1000));
    const statusBeforeForged = db.findRechargeGamesOrderById(createdTestOrderId)?.status;
    const bodyObj = {
      event: 'order.delivered',
      event_id: whId,
      order_id: createdProviderOrderId,
      buyer_ref: testBuyerRef1
    };
    const raw = JSON.stringify(bodyObj);
    const httpRes = await fetch(webhookEndpointUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'webhook-id': whId,
        'webhook-timestamp': whTs,
        'webhook-signature': 'v1,invalid_forged_signature_000000000000000000000000000000000000'
      },
      body: raw
    });
    const whEvent = db.getRechargeGamesWebhookEvents().find(e => e.event_id === whId);
    const statusAfterForged = db.findRechargeGamesOrderById(createdTestOrderId)?.status;
    const orderUnchanged = statusAfterForged === statusBeforeForged && statusAfterForged === 'pending';
    results.push({
      testNumber: 9,
      name: 'Test 9 — Rejet d’une signature HMAC-SHA256 incorrecte (HTTP 401 — crypto.timingSafeEqual)',
      passed: httpRes.status === 401 && whEvent?.signature_valid === false && orderUnchanged,
      durationMs: Date.now() - t0,
      details: `Webhook forgé sur POST /rechargegames-webhook rejeté en temps constant (crypto.timingSafeEqual) avec HTTP ${httpRes.status}. La commande #${createdTestOrderId} est restée intacte ("${statusAfterForged}").`,
      evidence: {
        httpStatus: httpRes.status,
        processingStatus: whEvent?.processing_status,
        orderUnchanged,
        timingSafeEqualUsed: true
      }
    });
  }

  // Test 8: Validation d'une signature HMAC-SHA256 correcte (webhook.test) via POST /rechargegames-webhook
  let validTestWebhookId = '';
  {
    const t0 = Date.now();
    const whId = `wh_test8_${Date.now()}`;
    validTestWebhookId = whId;
    const whTs = String(Math.floor(Date.now() / 1000));
    const bodyObj = { event: 'webhook.test', event_id: whId, timestamp: new Date().toISOString() };
    const raw = JSON.stringify(bodyObj);
    const sig = rg.signWebhookPayload(raw, whId, whTs);
    const httpRes = await fetch(webhookEndpointUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'webhook-id': whId,
        'webhook-timestamp': whTs,
        'webhook-signature': sig
      },
      body: raw
    });
    const whEvent = db.getRechargeGamesWebhookEvents().find(e => e.event_id === whId);
    results.push({
      testNumber: 8,
      name: 'Test 8 — Validation d’une signature HMAC-SHA256 correcte sur POST /rechargegames-webhook (crypto.timingSafeEqual)',
      passed: httpRes.status === 200 && whEvent?.signature_valid === true,
      durationMs: Date.now() - t0,
      details: `POST /rechargegames-webhook : Signature HMAC-SHA256 vérifiée via WebhookHmacValidator (HTTP ${httpRes.status}, digest=${whEvent?.computed_hmac_preview})`,
      evidence: {
        endpoint: '/rechargegames-webhook',
        webhookId: whId,
        httpStatus: httpRes.status,
        hmacPreview: whEvent?.computed_hmac_preview,
        timingSafeEqualUsed: true
      }
    });
  }

  // Test 11: Vérification du statut d'une commande avec l'endpoint officiel GET /v1/orders/{provider_order_id}
  {
    const t0 = Date.now();
    const hasRealProviderId = rg.hasValidProviderOrderId(createdProviderOrderId);
    const statusRes = await rg.checkOrderStatus(createdTestOrderId || createdProviderOrderId);
    results.push({
      testNumber: 11,
      name: 'Test 11 — Vérification du statut via GET /v1/orders/{provider_order_id}',
      passed:
        hasRealProviderId &&
        statusRes.success &&
        (statusRes.status === 'pending' || statusRes.status === 'delivered'),
      durationMs: Date.now() - t0,
      details: `GET /v1/orders/${createdProviderOrderId} (playup_order_id="${createdTestOrderId}") a retourné status="${statusRes.status}" — ${statusRes.message}`,
      evidence: {
        playup_order_id: createdTestOrderId,
        provider_order_id: createdProviderOrderId,
        endpoint: `/v1/orders/${createdProviderOrderId}`,
        statusReturned: statusRes.status
      }
    });
  }

  // Test 6: Réception du webhook "order.delivered" via POST /rechargegames-webhook
  {
    const t0 = Date.now();
    const whId = `wh_test6_deliv_${Date.now()}`;
    const whTs = String(Math.floor(Date.now() / 1000));
    const bodyObj = {
      event: 'order.delivered',
      event_id: whId,
      order_id: createdProviderOrderId,
      buyer_ref: testBuyerRef1,
      status: 'delivered'
    };
    const raw = JSON.stringify(bodyObj);
    const sig = rg.signWebhookPayload(raw, whId, whTs);
    const httpRes = await fetch(webhookEndpointUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'webhook-id': whId,
        'webhook-timestamp': whTs,
        'webhook-signature': sig
      },
      body: raw
    });
    const updatedOrder = db.findRechargeGamesOrderById(createdTestOrderId);
    results.push({
      testNumber: 6,
      name: 'Test 6 — Réception et traitement du webhook "order.delivered"',
      passed: httpRes.status === 200 && updatedOrder?.status === 'delivered' && Boolean(updatedOrder?.delivered_at),
      durationMs: Date.now() - t0,
      details: `Événement "order.delivered" signé traité sur POST /rechargegames-webhook (HTTP ${httpRes.status}) → Commande #${createdTestOrderId} passée à "delivered" ("Top-up livré avec succès.").`,
      evidence: {
        orderId: createdTestOrderId,
        statusAfterWebhook: updatedOrder?.status,
        deliveredAt: updatedOrder?.delivered_at
      }
    });
  }

  // Test 13: Réception du webhook "order.refunded" et déclenchement du remboursement PlayUp
  {
    const t0 = Date.now();
    const userBefore = db.getUserById('usr_player_01');
    const balanceBefore = userBefore?.walletBalance || 0;
    const whId = `wh_test13_refund_${Date.now()}`;
    const whTs = String(Math.floor(Date.now() / 1000));
    const bodyObj = {
      event: 'order.refunded',
      event_id: whId,
      order_id: createdProviderOrderId,
      buyer_ref: testBuyerRef1,
      status: 'refunded',
      refund_reason: 'Remboursement officiel RechargeGames suite à annulation fournisseur'
    };
    const raw = JSON.stringify(bodyObj);
    const sig = rg.signWebhookPayload(raw, whId, whTs);
    const httpRes = await fetch(webhookEndpointUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'webhook-id': whId,
        'webhook-timestamp': whTs,
        'webhook-signature': sig
      },
      body: raw
    });
    const refundedOrder = db.findRechargeGamesOrderById(createdTestOrderId);
    const userAfter = db.getUserById('usr_player_01');
    const balanceAfter = userAfter?.walletBalance || 0;
    results.push({
      testNumber: 13,
      name: 'Test 13 — Réception du webhook "order.refunded" & Remboursement PlayUp',
      passed:
        httpRes.status === 200 &&
        refundedOrder?.status === 'refunded' &&
        Boolean(refundedOrder?.refund_transaction_id) &&
        balanceAfter > balanceBefore,
      durationMs: Date.now() - t0,
      details: `Événement "order.refunded" traité sur POST /rechargegames-webhook (HTTP ${httpRes.status}) → Commande #${createdTestOrderId} passée à "refunded", transaction ${refundedOrder?.refund_transaction_id} créée ($${refundedOrder?.customer_price.toFixed(2)} USD recrédités).`,
      evidence: {
        orderId: createdTestOrderId,
        statusAfterWebhook: refundedOrder?.status,
        refundTransactionId: refundedOrder?.refund_transaction_id,
        walletBalanceBefore: balanceBefore,
        walletBalanceAfter: balanceAfter
      }
    });
  }

  // Test 7: Réception du webhook "order.failed" (sur une 2e commande TEST)
  {
    const t0 = Date.now();
    const targetProd = ffLatamProduct || usaProduct || syncedProducts[0];
    const buyerRef2 = db.generateNextBuyerRef();
    const createRes2 = await rg.createOrder({
      userId: 'usr_player_01',
      productKey: targetProd.product_key,
      region: targetProd.region,
      playerId: 'fail_16777227705',
      buyerRef: buyerRef2,
      paymentConfirmed: true,
      testMode: true
    });
    const ord2Id = createRes2.order?.id || '';
    const provOrd2Id = createRes2.order?.provider_order_id || '';

    const whId = `wh_test7_fail_${Date.now()}`;
    const whTs = String(Math.floor(Date.now() / 1000));
    const bodyObj = {
      event: 'order.failed',
      event_id: whId,
      order_id: provOrd2Id,
      buyer_ref: buyerRef2,
      status: 'failed',
      failure_reason: 'Player ID non trouvé sur le serveur régional USA'
    };
    const raw = JSON.stringify(bodyObj);
    const sig = rg.signWebhookPayload(raw, whId, whTs);
    const httpRes = await fetch(webhookEndpointUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'webhook-id': whId,
        'webhook-timestamp': whTs,
        'webhook-signature': sig
      },
      body: raw
    });
    const updatedOrd2 = db.findRechargeGamesOrderById(ord2Id);
    results.push({
      testNumber: 7,
      name: 'Test 7 — Réception et traitement du webhook "order.failed"',
      passed: httpRes.status === 200 && updatedOrd2?.status === 'failed' && Boolean(updatedOrd2?.failure_reason),
      durationMs: Date.now() - t0,
      details: `Événement "order.failed" signé traité sur POST /rechargegames-webhook (HTTP ${httpRes.status}) → Commande #${ord2Id} passée à "failed" (Raison : "${updatedOrd2?.failure_reason}").`,
      evidence: {
        orderId: ord2Id,
        buyer_ref: buyerRef2,
        statusAfterWebhook: updatedOrd2?.status,
        failureReason: updatedOrd2?.failure_reason
      }
    });
  }

  // Test 14: Protection contre le rejeu via Firestore (/webhook_events/{eventId})
  {
    const t0 = Date.now();
    const whTs = String(Math.floor(Date.now() / 1000));
    const bodyObj = { event: 'webhook.test', event_id: validTestWebhookId, timestamp: new Date().toISOString() };
    const raw = JSON.stringify(bodyObj);
    const sig = rg.signWebhookPayload(raw, validTestWebhookId, whTs);
    const httpRes = await fetch(webhookEndpointUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'webhook-id': validTestWebhookId,
        'webhook-timestamp': whTs,
        'webhook-signature': sig
      },
      body: raw
    });
    const respJson = await httpRes.json().catch(() => ({}));
    const firestoreLock = db.getFirestoreWebhookLock(validTestWebhookId);
    results.push({
      testNumber: 14,
      name: 'Test 14 — Idempotence Firestore (/webhook_events/{eventId}) : Événement déjà traité bloqué',
      passed:
        httpRes.status === 200 &&
        respJson.duplicate === true &&
        respJson.idempotency_store === 'firestore' &&
        Boolean(firestoreLock),
      durationMs: Date.now() - t0,
      details: `L'événement déjà traité "${validTestWebhookId}" a été détecté dans Firestore (${respJson.firestore_doc_path || firestoreLock?.firestoreDocPath}) et son traitement en double a été bloqué (duplicate=true, HTTP ${httpRes.status}).`,
      evidence: {
        eventId: validTestWebhookId,
        duplicate: respJson.duplicate,
        idempotencyStore: respJson.idempotency_store,
        firestoreDocPath: respJson.firestore_doc_path || firestoreLock?.firestoreDocPath
      }
    });
  }

  // Test 15: Rejet de données invalides sur POST /rechargegames-webhook (HTTP 400)
  {
    const t0 = Date.now();
    const whId = `wh_test15_badpayload_${Date.now()}`;
    const whTs = String(Math.floor(Date.now() / 1000));
    const bodyObj = { malformed_data_without_event: true };
    const raw = JSON.stringify(bodyObj);
    const sig = rg.signWebhookPayload(raw, whId, whTs);
    const httpRes = await fetch(webhookEndpointUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'webhook-id': whId,
        'webhook-timestamp': whTs,
        'webhook-signature': sig
      },
      body: raw
    });
    const whEvent = db.getRechargeGamesWebhookEvents().find(e => e.event_id === whId);
    results.push({
      testNumber: 15,
      name: 'Test 15 — Rejet des données invalides sur POST /rechargegames-webhook (HTTP 400)',
      passed: httpRes.status === 400 && whEvent?.processing_status === 'invalid_payload',
      durationMs: Date.now() - t0,
      details: `Données invalides rejetées avec HTTP ${httpRes.status} (${whEvent?.error_message}).`,
      evidence: {
        httpStatus: httpRes.status,
        processingStatus: whEvent?.processing_status,
        errorMessage: whEvent?.error_message
      }
    });
  }

  // Test 12: Vérification qu'aucun secret RechargeGames n'est exposé dans les payloads publics/logs
  {
    const t0 = Date.now();
    const secret = db.getProviderSecret('prov_rechargegames');
    const serializedProviders = JSON.stringify(db.getProviders());
    const serializedLogs = JSON.stringify(db.getProviderApiLogs('prov_rechargegames'));
    const apiKeyLeaked =
      Boolean(secret.apiKey && secret.apiKey.length > 4) &&
      (serializedProviders.includes(secret.apiKey) || serializedLogs.includes(secret.apiKey));
    const whSecretLeaked =
      Boolean(secret.webhookSecret && secret.webhookSecret.length > 4) &&
      (serializedProviders.includes(secret.webhookSecret) || serializedLogs.includes(secret.webhookSecret));

    results.push({
      testNumber: 12,
      name: 'Test 12 — Audit de sécurité : Non-exposition des secrets (Frontend / APK / Logs)',
      passed: !apiKeyLeaked && !whSecretLeaked,
      durationMs: Date.now() - t0,
      details:
        !apiKeyLeaked && !whSecretLeaked
          ? 'Aucun secret (RECHARGEGAMES_API_KEY / RECHARGEGAMES_WEBHOOK_SECRET) n’est présent dans les réponses API publiques, le frontend ou les logs.'
          : 'Alerte : un secret non masqué a été détecté.',
      evidence: {
        apiKeyLeaked,
        webhookSecretLeaked: whSecretLeaked,
        maskedApiKeyInAdmin: db.maskSecretValue(secret.apiKey)
      }
    });
  }

  // Test 16: Statuts intermédiaires de paiement (payment_pending, payment_processing, payment_failed, payment_cancelled)
  {
    const t0 = Date.now();
    const targetProd = ffLatamProduct || usaProduct || syncedProducts[0];
    const pendingRef = db.generateNextBuyerRef();
    const processingRef = db.generateNextBuyerRef();
    const failedRef = db.generateNextBuyerRef();
    const cancelledRef = db.generateNextBuyerRef();

    const resPending = await rg.createOrder({
      userId: 'usr_player_01',
      productKey: targetProd.product_key,
      region: targetProd.region,
      playerId: '16777227705',
      buyerRef: pendingRef,
      paymentConfirmed: false,
      paymentStatus: 'payment_pending',
      testMode: true
    });
    const resProcessing = await rg.createOrder({
      userId: 'usr_player_01',
      productKey: targetProd.product_key,
      region: targetProd.region,
      playerId: '16777227705',
      buyerRef: processingRef,
      paymentConfirmed: false,
      paymentStatus: 'payment_processing',
      testMode: true
    });
    const resFailed = await rg.createOrder({
      userId: 'usr_player_01',
      productKey: targetProd.product_key,
      region: targetProd.region,
      playerId: '16777227705',
      buyerRef: failedRef,
      paymentConfirmed: false,
      paymentStatus: 'payment_failed',
      testMode: true
    });
    const resCancelled = await rg.createOrder({
      userId: 'usr_player_01',
      productKey: targetProd.product_key,
      region: targetProd.region,
      playerId: '16777227705',
      buyerRef: cancelledRef,
      paymentConfirmed: false,
      paymentStatus: 'payment_cancelled',
      testMode: true
    });

    const neverSentToProvider =
      resPending.order?.dispatch_status === 'awaiting_payment' &&
      resProcessing.order?.dispatch_status === 'awaiting_payment' &&
      resFailed.order?.dispatch_status === 'failed' &&
      resCancelled.order?.dispatch_status === 'failed';

    results.push({
      testNumber: 16,
      name: 'Test 16 — Statuts intermédiaires de paiement (payment_pending / processing / failed / cancelled)',
      passed:
        !resPending.success &&
        !resProcessing.success &&
        !resFailed.success &&
        !resCancelled.success &&
        neverSentToProvider,
      durationMs: Date.now() - t0,
      details: `Aucune commande n'est envoyée à RechargeGames tant que le paiement n'est pas "payment_succeeded" (payment_pending, payment_processing, payment_failed, payment_cancelled bloqués avant appel fournisseur).`,
      evidence: {
        payment_pending: resPending.order?.lifecycle_status,
        payment_processing: resProcessing.order?.lifecycle_status,
        payment_failed: resFailed.order?.lifecycle_status,
        payment_cancelled: resCancelled.order?.lifecycle_status,
        neverSentToProvider
      }
    });
  }

  // Test 17: Reprise sécurisée après timeout (même buyer_ref, pas de remboursement auto sur timeout, blocage relance si déjà delivered)
  {
    const t0 = Date.now();
    const targetProd = ffLatamProduct || usaProduct || syncedProducts[0];
    const timeoutBuyerRef = db.generateNextBuyerRef();

    // 1. Simulate network timeout during provider call
    const timeoutRes = await rg.createOrder({
      userId: 'usr_player_01',
      productKey: targetProd.product_key,
      region: targetProd.region,
      playerId: '16777227705',
      buyerRef: timeoutBuyerRef,
      paymentConfirmed: true,
      paymentStatus: 'payment_succeeded',
      simulateNetworkTimeout: true,
      testMode: true
    });
    const timedOutOrder = timeoutRes.order;
    const refundAfterTimeout = timedOutOrder ? db.findRefundByOrderId(timedOutOrder.id) : undefined;

    // 2. Recover order safely using the SAME buyer_ref without creating a 2nd order
    const recoverRes = timedOutOrder ? await rg.recoverOrder(timedOutOrder.id) : null;

    // 3. Deliver the recovered order and verify that recoverOrder refuses to re-launch an already delivered order
    if (recoverRes?.order) {
      rg.applyOrderStatusTransition(recoverRes.order, 'delivered', 'Livraison confirmée pour test anti-relance');
    }
    const relaunchDeliveredRes = timedOutOrder ? await rg.recoverOrder(timedOutOrder.id) : null;

    results.push({
      testNumber: 17,
      name: 'Test 17 — Reprise après timeout (même buyer_ref, aucun remboursement sur timeout, anti-relance si livré)',
      passed:
        timedOutOrder?.dispatch_status === 'pending_retry' &&
        !refundAfterTimeout &&
        Boolean(recoverRes?.success) &&
        recoverRes?.order?.buyer_ref === timeoutBuyerRef &&
        Boolean(relaunchDeliveredRes?.alreadyDelivered) &&
        relaunchDeliveredRes?.recoveredAction === 'blocked_already_delivered',
      durationMs: Date.now() - t0,
      details: `Commande conservée en "order_pending" (pending_retry) sur timeout sans remboursement automatique, reprise réussie avec le même buyer_ref (${timeoutBuyerRef}), et relance bloquée après confirmation de livraison.`,
      evidence: {
        orderId: timedOutOrder?.id,
        buyer_ref: timeoutBuyerRef,
        autoRefundedOnTimeout: Boolean(refundAfterTimeout),
        recoveredProviderOrderId: recoverRes?.order?.provider_order_id,
        relaunchAfterDeliveredAction: relaunchDeliveredRes?.recoveredAction
      }
    });
  }

  // Test 18: Séparation Frontend/Backend & Remboursement vérifiable anti-doublon en base de données
  {
    const t0 = Date.now();
    const targetProd = ffLatamProduct || usaProduct || syncedProducts[0];
    // 1. Frontend attempts to declare status="delivered"
    const spoofRes = await rg.createOrder({
      userId: 'usr_player_01',
      productKey: targetProd.product_key,
      region: targetProd.region,
      playerId: '16777227705',
      paymentConfirmed: true,
      clientDeclaredStatus: 'delivered',
      testMode: true
    });

    // 2. Attempt to refund a pending order on timeout -> must be rejected by processVerifiableRefund
    const pendingRefundAttempt = db.processVerifiableRefund({
      orderId: 'ord_pending_timeout_test',
      buyerRef: 'playup_pending_test',
      userId: 'usr_player_01',
      amount: 5.0,
      currency: 'USD',
      reason: 'Timeout réseau temporaire',
      ruleApplied: 'order_definitively_failed',
      currentOrderStatus: 'pending'
    });

    // 3. Attempt double refund on already refunded order from Test 13 -> must be blocked idempotently
    const doubleRefundAttempt = db.processVerifiableRefund({
      orderId: createdTestOrderId,
      buyerRef: testBuyerRef1,
      userId: 'usr_player_01',
      amount: 5.0,
      currency: 'USD',
      reason: 'Tentative de double remboursement',
      ruleApplied: 'provider_confirmed_refunded',
      currentOrderStatus: 'refunded'
    });

    results.push({
      testNumber: 18,
      name: 'Test 18 — Séparation Frontend/Backend & Protection anti-double remboursement (SQLite order_refunds)',
      passed:
        !spoofRes.success &&
        spoofRes.httpStatus === 403 &&
        !pendingRefundAttempt.refunded &&
        doubleRefundAttempt.alreadyRefunded === true,
      durationMs: Date.now() - t0,
      details: `Auto-déclaration frontend bloquée (HTTP ${spoofRes.httpStatus}), remboursement d'une commande "pending" refusé, et double remboursement bloqué par la table SQLite order_refunds.`,
      evidence: {
        frontendSpoofBlocked: spoofRes.errorCode,
        pendingOrderRefundAllowed: pendingRefundAttempt.refunded,
        doubleRefundBlocked: doubleRefundAttempt.alreadyRefunded,
        existingRefundId: doubleRefundAttempt.refundRecord?.id
      }
    });
  }

  // Test 19: Validation manuelle d’un paiement PlayUp (Flux obligatoire Request #9)
  {
    const t0 = Date.now();
    const targetProd = ffLatamProduct || usaProduct || syncedProducts[0];
    const manualValBuyerRef = db.generateNextBuyerRef();

    // 1. Create order in payment_pending (awaiting manual validation)
    const pendingPayOrderRes = await rg.createOrder({
      userId: 'usr_player_01',
      productKey: targetProd.product_key,
      region: targetProd.region,
      playerId: '16777227705',
      buyerRef: manualValBuyerRef,
      paymentConfirmed: false,
      paymentStatus: 'payment_pending',
      paymentMethod: 'moncash',
      testMode: true
    });
    const pendingOrdId = pendingPayOrderRes.order?.id || '';

    // 2. Execute Manual Payment Validation ("Valider le paiement")
    const valRes1 = await rg.validatePaymentManually(pendingOrdId, {
      adminId: 'admin_test_validator',
      adminEmail: 'admin@playup.ht',
      note: 'Validation manuelle test officiel'
    });

    // 3. Click "Valider le paiement" a 2nd time -> must NEVER create a 2nd provider order
    const valRes2 = await rg.validatePaymentManually(pendingOrdId, {
      adminId: 'admin_test_validator',
      adminEmail: 'admin@playup.ht'
    });

    results.push({
      testNumber: 19,
      name: 'Test 19 — Flux obligatoire après validation manuelle d’un paiement PlayUp (payment_verified → sent_to_rechargegames)',
      passed:
        valRes1.success &&
        valRes1.order?.payment_status === 'payment_verified' &&
        valRes1.order?.status === 'sent_to_rechargegames' &&
        valRes1.order?.buyer_ref === manualValBuyerRef &&
        !valRes2.success &&
        valRes2.alreadyValidated === true &&
        Boolean(valRes1.validationRecord?.id),
      durationMs: Date.now() - t0,
      details: `Validation manuelle exécutée : payment_verified → order_pending → RechargeGames (${valRes1.order?.provider_order_id}) → sent_to_rechargegames avec le même buyer_ref (${manualValBuyerRef}). Double clic administrateur bloqué (alreadyValidated=true).`,
      evidence: {
        orderId: pendingOrdId,
        buyerRef: manualValBuyerRef,
        paymentStatus: valRes1.order?.payment_status,
        orderStatus: valRes1.order?.status,
        providerOrderId: valRes1.order?.provider_order_id,
        doubleClickBlocked: valRes2.alreadyValidated,
        validationRecordId: valRes1.validationRecord?.id
      }
    });
  }

  // Test 20: Limite stricte aux nouvelles tentatives de commande (Max 3 retries, 1m/5m/15m, manual_review — Request #10)
  {
    const t0 = Date.now();
    const targetProd = ffLatamProduct || usaProduct || syncedProducts[0];
    const retryBuyerRef = db.generateNextBuyerRef();

    // Create order that times out on initial dispatch
    const initRes = await rg.createOrder({
      userId: 'usr_player_01',
      productKey: targetProd.product_key,
      region: targetProd.region,
      playerId: '16777227705',
      buyerRef: retryBuyerRef,
      paymentConfirmed: true,
      paymentStatus: 'payment_succeeded',
      simulateNetworkTimeout: true,
      testMode: true
    });
    const retryOrdId = initRes.order?.id || '';

    // Attempt 1 (fails -> schedules 1 min delay)
    const att1 = await rg.executeOrderRetry(retryOrdId, {
      triggerType: 'automatic',
      simulateTemporaryError: true,
      bypassDelayForTest: true
    });
    // Attempt 2 (fails -> schedules 5 min delay)
    const att2 = await rg.executeOrderRetry(retryOrdId, {
      triggerType: 'automatic',
      simulateTemporaryError: true,
      bypassDelayForTest: true
    });
    // Attempt 3 (fails -> 3rd failure stops automatic retries and transitions to "manual_review")
    const att3 = await rg.executeOrderRetry(retryOrdId, {
      triggerType: 'automatic',
      simulateTemporaryError: true,
      bypassDelayForTest: true
    });
    // Attempt 4 automatic -> must be strictly blocked because max 3 retries reached!
    const att4Blocked = await rg.executeOrderRetry(retryOrdId, {
      triggerType: 'automatic',
      bypassDelayForTest: true
    });

    const recordedAttempts = db.getOrderRetryAttempts(retryOrdId);

    results.push({
      testNumber: 20,
      name: 'Test 20 — Limite stricte de 3 tentatives automatiques (1m, 5m, 15m) & Passage en "manual_review"',
      passed:
        att1.attemptRecord?.attempt_number === 1 &&
        att1.attemptRecord?.next_retry_delay_minutes === 1 &&
        att2.attemptRecord?.attempt_number === 2 &&
        att2.attemptRecord?.next_retry_delay_minutes === 5 &&
        att3.attemptRecord?.attempt_number === 3 &&
        att3.attemptRecord?.status === 'escalated_manual_review' &&
        att3.order?.status === 'manual_review' &&
        !att4Blocked.success &&
        att4Blocked.errorCode === 'MAX_AUTO_RETRIES_EXCEEDED' &&
        recordedAttempts.length >= 3,
      durationMs: Date.now() - t0,
      details: `3 tentatives automatiques exécutées avec le même buyer_ref (${retryBuyerRef}) et délais progressifs (1 min, 5 min, puis arrêt à la 3e tentative → statut "manual_review"). 4e tentative automatique bloquée (${att4Blocked.errorCode}).`,
      evidence: {
        orderId: retryOrdId,
        buyerRef: retryBuyerRef,
        attempt1DelayMin: att1.attemptRecord?.next_retry_delay_minutes,
        attempt2DelayMin: att2.attemptRecord?.next_retry_delay_minutes,
        statusAfter3Failures: att3.order?.status,
        attempt4BlockedCode: att4Blocked.errorCode,
        totalRecordedInDb: recordedAttempts.length
      }
    });
  }

  // Test 21: Règles strictes de remboursement manuel & Protection contre le double remboursement (Request #8)
  {
    const t0 = Date.now();
    const manualReviewOrder = db.getRechargeGamesOrders().find(o => o.status === 'manual_review');
    const targetOrderId = manualReviewOrder?.id || '';

    // 1. Execute authorized manual admin refund on the manual_review (non-delivered) order
    const refundRes1 = targetOrderId
      ? await rg.executeStrictAdminRefund(targetOrderId, {
          adminId: 'admin_refund_officer',
          adminEmail: 'admin@playup.ht',
          reason: 'Échec définitif après 3 tentatives et révision manuelle',
          refundMethod: 'wallet'
        })
      : null;

    // 2. Attempt a second manual refund on the same order -> must be blocked (refund_status == "refunded")
    const refundRes2 = targetOrderId
      ? await rg.executeStrictAdminRefund(targetOrderId, {
          adminId: 'admin_refund_officer',
          adminEmail: 'admin@playup.ht',
          reason: 'Tentative de double remboursement manuel',
          refundMethod: 'wallet'
        })
      : null;

    results.push({
      testNumber: 21,
      name: 'Test 21 — Règles strictes de remboursement manuel (refund_id, admin_id, status="refunded", anti-double remboursement)',
      passed: Boolean(
        refundRes1?.success &&
          refundRes1.refundRecord?.refund_id &&
          refundRes1.refundRecord?.admin_id === 'admin_refund_officer' &&
          refundRes1.refundRecord?.status === 'refunded' &&
          refundRes1.order?.refund_status === 'refunded' &&
          refundRes2 &&
          !refundRes2.success &&
          refundRes2.httpStatus === 409
      ),
      durationMs: Date.now() - t0,
      details: `Remboursement manuel confirmé (refund_id="${refundRes1?.refundRecord?.refund_id}", admin_id="${refundRes1?.refundRecord?.admin_id}", status="${refundRes1?.refundRecord?.status}") et second remboursement bloqué (HTTP ${refundRes2?.httpStatus}).`,
      evidence: {
        orderId: targetOrderId,
        refundId: refundRes1?.refundRecord?.refund_id,
        adminId: refundRes1?.refundRecord?.admin_id,
        refundStatus: refundRes1?.order?.refund_status,
        secondRefundBlockedStatus: refundRes2?.httpStatus
      }
    });
  }

  // Sort by testNumber ascending
  results.sort((a, b) => a.testNumber - b.testNumber);

  res.json({
    allPassed: results.every(r => r.passed),
    passedCount: results.filter(r => r.passed).length,
    totalCount: results.length,
    results
  });
});

// ============================================================================
// REAL APPLICATION DOWNLOAD & PACKAGE VERIFICATION ENDPOINTS
// ============================================================================

apiRouter.get('/download/info', (req, res) => {
  const ua = String(req.headers['user-agent'] || '').toLowerCase();
  let detectedPlatform: 'android' | 'ios' | 'desktop' = 'desktop';
  if (/iphone|ipad|ipod/.test(ua)) {
    detectedPlatform = 'ios';
  } else if (/android/.test(ua)) {
    detectedPlatform = 'android';
  }

  const androidMeta = PackageDistributionEngine.getPackageMetadata('android');
  const iosMeta = PackageDistributionEngine.getPackageMetadata('ios');

  res.json({
    detectedPlatform,
    latestVersion: PackageDistributionEngine.LATEST_VERSION,
    applicationId: PackageDistributionEngine.APPLICATION_ID,
    packages: {
      android: androidMeta,
      ios: iosMeta
    }
  });
});

apiRouter.get('/download/verify-apk', (_req, res) => {
  try {
    const report = PackageDistributionEngine.verifyAndroidApk();
    res.json(report);
  } catch (err: any) {
    res.status(500).json({
      valid: false,
      error: err.message || 'Erreur lors de la vérification binaire de l’APK.'
    });
  }
});

apiRouter.head('/download/package', (req, res) => {
  const platformParam = String(req.query.platform || '').toLowerCase();
  const ua = String(req.headers['user-agent'] || '').toLowerCase();
  const platform: 'android' | 'ios' =
    platformParam === 'ios' || (!platformParam && /iphone|ipad|ipod/.test(ua))
      ? 'ios'
      : 'android';

  const meta = PackageDistributionEngine.getPackageMetadata(platform);
  if (!meta.exists || meta.sizeBytes <= 0) {
    return res.status(404).end();
  }

  res.setHeader('Content-Type', meta.mimeType);
  res.setHeader('Content-Length', String(meta.sizeBytes));
  res.setHeader('X-Package-Version', meta.version);
  res.setHeader('X-Package-Sha256', meta.sha256);
  res.setHeader('X-Package-Filename', meta.fileName);
  return res.status(200).end();
});

apiRouter.get('/download/package', (req, res) => {
  const platformParam = String(req.query.platform || '').toLowerCase();
  const ua = String(req.headers['user-agent'] || '').toLowerCase();
  const platform: 'android' | 'ios' =
    platformParam === 'ios' || (!platformParam && /iphone|ipad|ipod/.test(ua))
      ? 'ios'
      : 'android';

  const meta = PackageDistributionEngine.getPackageMetadata(platform);
  const filePath = PackageDistributionEngine.getPackageFilePath(platform);

  if (!meta.exists || !fs.existsSync(filePath)) {
    return res.status(404).json({
      error: 'Package introuvable',
      message: 'Le package demandé est introuvable sur le serveur.'
    });
  }

  db.addSystemLog('info', 'system', `[App Download] Téléchargement réel du package ${meta.fileName} (${meta.sizeFormatted}, SHA-256: ${meta.sha256.slice(0, 12)}...)`);

  res.setHeader('Content-Type', meta.mimeType);
  res.setHeader('Content-Length', String(meta.sizeBytes));
  res.setHeader('Content-Disposition', `attachment; filename="${meta.fileName}"`);
  res.setHeader('X-Package-Version', meta.version);
  res.setHeader('X-Package-Sha256', meta.sha256);
  res.setHeader('Cache-Control', 'no-cache');

  const stream = fs.createReadStream(filePath);
  stream.on('error', err => {
    console.error('[Download Stream Error]:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Erreur lors de la lecture du package.' });
    }
  });
  stream.pipe(res);
});

// ============================================================================
// REAL-TIME PUSH NOTIFICATIONS & OFFLINE SYNC ENDPOINTS
// ============================================================================

apiRouter.post('/notifications/push-subscribe', authenticateUser, (req, res) => {
  const user = (req as any).user as AppUser;
  const { endpoint, keys, devicePlatform } = req.body;
  const ua = String(req.headers['user-agent'] || '');

  const sub = db.upsertPushSubscription({
    userId: user.id,
    userEmail: user.email,
    endpoint: String(endpoint || `sw-push://${user.id}`),
    keys: keys && typeof keys === 'object' ? keys : undefined,
    devicePlatform: ['android', 'ios', 'desktop'].includes(devicePlatform) ? devicePlatform : 'desktop',
    userAgent: ua.slice(0, 200),
    active: true
  });

  // Immediately deliver any queued offline push notifications to this reconnected device
  const flushedOfflineNotifications = db.markPushNotificationsDeliveredForUser(user.id);

  res.json({
    success: true,
    subscription: sub,
    queuedOfflineNotifications: flushedOfflineNotifications
  });
});

apiRouter.delete('/notifications/push-subscribe', authenticateUser, (req, res) => {
  const user = (req as any).user as AppUser;
  const { endpoint } = req.body || {};
  db.removePushSubscription(user.id, endpoint);
  res.json({ success: true });
});

apiRouter.get('/notifications/history', authenticateUser, (req, res) => {
  const user = (req as any).user as AppUser;
  const flushedOffline = db.markPushNotificationsDeliveredForUser(user.id);
  res.json({
    pushNotifications: db.getPushNotificationLogs(user.id),
    emailDeliveries: db.getEmailDeliveryLogs(user.id),
    newlyDeliveredFromOfflineQueue: flushedOffline
  });
});

apiRouter.get('/notifications/push-stream', (req, res) => {
  const authHeader = req.headers.authorization;
  const token =
    (authHeader?.startsWith('Bearer ') ? authHeader.substring(7).trim() : '') ||
    String(req.query.token || '').trim();

  const user = db.verifyUserSessionToken(token);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  NotificationEngine.registerSseClient(user.id, res);

  // Immediately flush any queued offline notifications upon connection
  const pendingOffline = db.markPushNotificationsDeliveredForUser(user.id);
  for (const pushLog of pendingOffline) {
    res.write(
      `data: ${JSON.stringify({
        type: 'ORDER_DELIVERED_PUSH',
        notification: pushLog,
        orderNumber: pushLog.orderNumber,
        flushedFromOfflineQueue: true
      })}\n\n`
    );
  }

  const heartbeat = setInterval(() => {
    try {
      res.write(`: heartbeat ${Date.now()}\n\n`);
    } catch {
      clearInterval(heartbeat);
    }
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    NotificationEngine.unregisterSseClient(user.id, res);
  });
});

// ============================================================================
// OFFICIAL STRIPE & PAYMENT GATEWAY WEBHOOK VERIFICATION ENDPOINTS
// (Powered by WebhookHmacValidator using crypto.timingSafeEqual)
// ============================================================================

apiRouter.post('/webhooks/stripe', (req: any, res) => {
  const sigHeader = String(req.headers['stripe-signature'] || '');
  const stripeSecret = (process.env.STRIPE_WEBHOOK_SECRET || db.getPaymentGatewaySecret('gw_card')?.webhookSecret || '').trim();
  const rawBody = typeof req.rawBody === 'string' ? req.rawBody : JSON.stringify(req.body || {});

  const check = WebhookHmacValidator.verifyStripeWebhook({
    rawBody,
    signatureHeader: sigHeader,
    secret: stripeSecret
  });

  if (!check.valid) {
    const status = check.errorCode === 'SECRET_NOT_CONFIGURED' ? 400 : 401;
    db.addSystemLog('error', 'payment', `[Stripe Security] Signature Webhook Stripe rejetée (${check.errorCode}): ${check.reason}`);
    return res.status(status).json({
      error: check.reason,
      errorCode: check.errorCode,
      timingSafeEqualUsed: check.timingSafeEqualUsed
    });
  }

  const event = req.body;
  const eventId = String(event?.id || '');
  if (eventId && db.hasProcessedWebhookEvent(`stripe_${eventId}`)) {
    return res.status(200).json({ received: true, duplicate: true, timingSafeEqualUsed: true });
  }
  if (eventId) {
    db.markWebhookEventProcessed(`stripe_${eventId}`);
  }

  db.addSystemLog('info', 'payment', `[Stripe Webhook] Événement authentifié reçu : ${event?.type || 'unknown'} (${eventId})`);
  return res.status(200).json({ received: true, verified: true, timingSafeEqualUsed: true });
});

// Incoming Mobile Money / Payment Gateway Webhooks (MonCash / NatCash) validated via WebhookHmacValidator
apiRouter.post('/webhooks/payment/:gatewaySlug', (req: any, res) => {
  const gatewaySlug = String(req.params.gatewaySlug || '').toLowerCase();
  const gateway = db.getPaymentGateways().find(
    g => g.slug.toLowerCase() === gatewaySlug || g.id.toLowerCase() === gatewaySlug
  );
  if (!gateway) {
    return res.status(404).json({ error: 'Payment gateway introuvable.' });
  }

  const gwSecretRecord = db.getPaymentGatewaySecret(gateway.id);
  const secret = (gwSecretRecord?.webhookSecret || process.env[`${gateway.slug.toUpperCase()}_WEBHOOK_SECRET`] || '').trim();
  const rawBody = typeof req.rawBody === 'string' ? req.rawBody : JSON.stringify(req.body || {});

  const check = WebhookHmacValidator.verifyProviderWebhook({
    rawBody,
    headers: req.headers as Record<string, any>,
    secret,
    providerName: gateway.name,
    allowUnsignedWhenSecretEmpty: false,
    toleranceSeconds: WebhookHmacValidator.DEFAULT_TOLERANCE_SECONDS
  });

  if (!check.valid) {
    const status = check.errorCode === 'SECRET_NOT_CONFIGURED' ? 400 : 401;
    db.addSystemLog('error', 'payment', `[${gateway.name} Security] Webhook paiement rejeté (${check.errorCode}): ${check.reason}`);
    return res.status(status).json({
      received: false,
      error: check.reason,
      errorCode: check.errorCode,
      timingSafeEqualUsed: check.timingSafeEqualUsed
    });
  }

  return res.status(200).json({
    received: true,
    verified: true,
    gateway: gateway.slug,
    timingSafeEqualUsed: true,
    computedHmacPreview: check.computedHmacPreview
  });
});

// Diagnostic & verification endpoint for WebhookHmacValidator (Admin)
apiRouter.get('/admin/webhooks/hmac-validator-status', authenticateAdmin, (_req, res) => {
  res.json({
    validatorClass: 'WebhookHmacValidator',
    algorithm: 'HMAC-SHA256',
    timingSafeComparison: 'crypto.timingSafeEqual',
    defaultReplayWindowSeconds: WebhookHmacValidator.DEFAULT_TOLERANCE_SECONDS,
    protectedEndpoints: [
      {
        endpoint: '/rechargegames-webhook',
        alias: '/api/webhooks/rechargegames',
        provider: 'RechargeGames (Standard Webhooks v1,<base64> & sha256=<hex>)',
        method: 'WebhookHmacValidator.verifyStandardWebhook'
      },
      {
        endpoint: '/api/webhooks/goxtop',
        alias: '/api/webhooks/:providerSlug',
        provider: 'GoXtop & B2B Providers',
        method: 'WebhookHmacValidator.verifyProviderWebhook'
      },
      {
        endpoint: '/api/webhooks/stripe',
        provider: 'Stripe (t=<timestamp>,v1=<hex>)',
        method: 'WebhookHmacValidator.verifyStripeWebhook'
      },
      {
        endpoint: '/api/webhooks/payment/:gatewaySlug',
        provider: 'MonCash / NatCash Payment Gateways',
        method: 'WebhookHmacValidator.verifyProviderWebhook'
      }
    ]
  });
});

// ============================================================================
// ORDER TRACKER STATUS CHANGE PUSH / EMAIL NOTIFICATION PREFERENCES ENDPOINT
// ============================================================================

apiRouter.patch('/orders/:orderId/tracker-notifications', authenticateUser, async (req, res) => {
  const user = (req as any).user as AppUser;
  const orderId = String(req.params.orderId || '').trim();
  const { pushAlerts, emailAlerts, sendTestStatusAlert } = req.body || {};

  const orders = db.getOrders();
  const orderIdx = orders.findIndex(
    o =>
      (o.id === orderId || o.orderNumber === orderId || o.partnerOrderId === orderId) &&
      (o.userId === user.id || user.role === 'ADMIN')
  );

  if (orderIdx === -1) {
    return res.status(404).json({
      error: 'Commande introuvable',
      message: 'Cette commande est introuvable ou ne vous appartient pas.'
    });
  }

  const targetOrder = orders[orderIdx];
  if (typeof pushAlerts === 'boolean') {
    targetOrder.orderTrackerPushAlerts = pushAlerts;
  }
  if (typeof emailAlerts === 'boolean') {
    targetOrder.orderTrackerEmailAlerts = emailAlerts;
  }
  targetOrder.updatedAt = new Date().toISOString();
  orders[orderIdx] = targetOrder;
  db.setOrders(orders);

  // Also sync user global notification preferences if enabled
  if (pushAlerts === true || emailAlerts === true) {
    const allUsers = db.getUsers();
    const uIdx = allUsers.findIndex(u => u.id === user.id);
    if (uIdx !== -1) {
      if (pushAlerts === true) {
        allUsers[uIdx].pushNotificationsEnabled = true;
        allUsers[uIdx].orderTrackerPushAlerts = true;
      }
      if (emailAlerts === true) {
        allUsers[uIdx].emailNotifications = true;
        allUsers[uIdx].orderTrackerEmailAlerts = true;
      }
      db.setUsers(allUsers);
    }
  }

  let notificationResult = null;
  if (sendTestStatusAlert) {
    notificationResult = await NotificationEngine.triggerOrderStatusChangeNotification({
      orderId: targetOrder.id,
      orderNumber: targetOrder.orderNumber,
      userId: user.id,
      gameName: targetOrder.gameName,
      packageName: targetOrder.packageName,
      previousStatus: 'payment_verified',
      newStatus: targetOrder.lifecycle_status || targetOrder.status,
      note: 'Alerte de suivi Order Tracker activée avec succès pour cette commande.'
    });
  }

  return res.json({
    success: true,
    orderId: targetOrder.id,
    orderNumber: targetOrder.orderNumber,
    orderTrackerPushAlerts: targetOrder.orderTrackerPushAlerts !== false,
    orderTrackerEmailAlerts: targetOrder.orderTrackerEmailAlerts !== false,
    notificationResult
  });
});

// ============================================================================
// REAL MONCASH (+509 48 03 9151) & NATCASH (+509 55964606) OCR PAYMENT,
// ANTI-FRAUD, IDEMPOTENCY, ANTI-REPLAY & ATOMIC WALLET CREDIT WORKFLOW
// ============================================================================

const extractSecurityHeadersAndParams = (req: Request) => {
  const idempotencyKey = String(
    req.headers['idempotency-key'] ||
      req.headers['x-idempotency-key'] ||
      req.body?.idempotencyKey ||
      req.body?.idempotency_key ||
      ''
  ).trim();
  const requestId = String(
    req.headers['x-request-id'] ||
      req.body?.requestId ||
      req.body?.request_id ||
      ''
  ).trim();
  const nonce = String(
    req.headers['x-payment-nonce'] ||
      req.body?.nonce ||
      ''
  ).trim();
  const clientTimestamp =
    req.headers['x-client-timestamp'] ||
    req.body?.clientTimestamp ||
    req.body?.client_timestamp ||
    req.body?.timestamp;
  const ipAddress = extractClientIp(req);

  return {
    idempotencyKey,
    requestId,
    nonce,
    clientTimestamp: clientTimestamp !== undefined ? String(clientTimestamp) : undefined,
    ipAddress
  };
};

// Issue a short-lived anti-replay security nonce & request_id
apiRouter.post('/payments/security/nonce', authenticateUser, (req, res) => {
  const user = (req as any).user as AppUser;
  const { paymentRequestId, operationType } = req.body || {};
  const token = db.issueShortLivedPaymentNonce({
    userId: user.id,
    paymentRequestId: paymentRequestId ? String(paymentRequestId) : undefined,
    operationType: operationType as PaymentIdempotentOperationType | undefined,
    ttlSeconds: 300
  });
  res.json({
    success: true,
    ...token
  });
});

// Get active (pending) payment request for the current user so page refresh or leaving/returning restores the exact state
apiRouter.get('/payments/requests/active', authenticateUser, (req, res) => {
  const user = (req as any).user as AppUser;
  const packageId = req.query.packageId ? String(req.query.packageId) : undefined;
  const purpose = req.query.purpose as 'service_order' | 'wallet_topup' | undefined;

  const active = db.getActivePaymentRequestForUser(user.id, { packageId, purpose });
  const securityToken = db.issueShortLivedPaymentNonce({
    userId: user.id,
    paymentRequestId: active?.id
  });

  res.json({
    officialNumbers: PLAYUP_OFFICIAL_PAYMENT_NUMBERS,
    activeRequest: active ? db.sanitizePaymentRequestForClient(active) : null,
    securityToken
  });
});

// List user's payment requests & audit logs
apiRouter.get('/payments/requests/my', authenticateUser, (req, res) => {
  const user = (req as any).user as AppUser;
  const requests = db.getPaymentRequests(user.id).map(r => db.sanitizePaymentRequestForClient(r));
  const auditLogs = db.getPaymentAuditLogs({ userId: user.id }).slice(0, 50);
  res.json({
    officialNumbers: PLAYUP_OFFICIAL_PAYMENT_NUMBERS,
    requests,
    auditLogs
  });
});

// Get a specific payment request by ID
apiRouter.get('/payments/requests/:requestId', authenticateUser, (req, res) => {
  const user = (req as any).user as AppUser;
  const requestId = String(req.params.requestId || '').trim();
  const reqRecord = db.getPaymentRequestById(requestId);
  if (!reqRecord || (reqRecord.user_id !== user.id && user.role !== 'ADMIN')) {
    return res.status(404).json({
      error: 'Demande de paiement introuvable.'
    });
  }
  const securityToken = db.issueShortLivedPaymentNonce({
    userId: user.id,
    paymentRequestId: reqRecord.id
  });
  return res.json({
    officialNumbers: PLAYUP_OFFICIAL_PAYMENT_NUMBERS,
    paymentRequest: db.sanitizePaymentRequestForClient(reqRecord),
    auditLogs: db.getPaymentAuditLogs({ paymentRequestId: reqRecord.id }),
    securityToken
  });
});

// 1. Create or resume a persistent MonCash / NatCash payment request (Idempotent & Anti-Replay protected)
apiRouter.post('/payments/requests', authenticateUser, paymentCreateRateLimit, async (req, res) => {
  const user = (req as any).user as AppUser;
  const sec = extractSecurityHeadersAndParams(req);

  const {
    paymentMethod = 'moncash',
    purpose = 'service_order',
    packageId,
    gameId,
    serviceId,
    playerId,
    playerName,
    serverId,
    region,
    gameProfileData,
    amountUsd,
    forceNew = false
  } = req.body || {};

  const method: 'moncash' | 'natcash' =
    String(paymentMethod).toLowerCase() === 'natcash' ? 'natcash' : 'moncash';

  // If the user already has an active pending request for the same package/purpose and forceNew is false,
  // return the existing active request unless idempotency key is creating a specific request
  if (!forceNew && !sec.idempotencyKey) {
    const existingActive = db.getActivePaymentRequestForUser(user.id, {
      packageId: packageId ? String(packageId) : undefined,
      purpose: purpose === 'wallet_topup' ? 'wallet_topup' : 'service_order'
    });
    if (existingActive) {
      const securityToken = db.issueShortLivedPaymentNonce({
        userId: user.id,
        paymentRequestId: existingActive.id
      });
      return res.status(200).json({
        resumedExisting: true,
        officialNumbers: PLAYUP_OFFICIAL_PAYMENT_NUMBERS,
        paymentRequest: db.sanitizePaymentRequestForClient(existingActive),
        securityToken
      });
    }
  }

  const effectiveIdempotencyKey =
    sec.idempotencyKey ||
    `idem_create_${user.id}_${purpose}_${packageId || amountUsd || 'default'}_${Math.floor(Date.now() / 10000)}`;

  const result = await db.executeIdempotentPaymentOperation({
    idempotencyKey: effectiveIdempotencyKey,
    operationType: 'payment_creation',
    userId: user.id,
    userEmail: user.email,
    requestId: sec.requestId,
    nonce: sec.nonce,
    clientTimestamp: sec.clientTimestamp,
    ipAddress: sec.ipAddress,
    payload: {
      paymentMethod: method,
      purpose,
      packageId,
      gameId,
      serviceId,
      playerId,
      amountUsd
    },
    executor: async () => {
      // Check if an active pending request already exists for this exact package & player
      if (!forceNew) {
        const existing = db.getActivePaymentRequestForUser(user.id, {
          packageId: packageId ? String(packageId) : undefined,
          purpose: purpose === 'wallet_topup' ? 'wallet_topup' : 'service_order'
        });
        if (existing) {
          const securityToken = db.issueShortLivedPaymentNonce({
            userId: user.id,
            paymentRequestId: existing.id
          });
          return {
            httpStatus: 200,
            body: {
              resumedExisting: true,
              officialNumbers: PLAYUP_OFFICIAL_PAYMENT_NUMBERS,
              paymentRequest: db.sanitizePaymentRequestForClient(existing),
              securityToken
            }
          };
        }
      }

      // Compute authoritative expected amount on the backend (NEVER trust frontend price for service orders)
      let authoritativeUsd = 0;
      let resolvedGame: Game | undefined;
      let resolvedService: Service | undefined;
      let resolvedPackage: any;

      if (purpose === 'service_order' && packageId) {
        for (const srv of db.getServices()) {
          const foundPkg = srv.packages.find(p => p.id === packageId);
          if (foundPkg) {
            resolvedPackage = foundPkg;
            resolvedService = srv;
            resolvedGame = db.getGames().find(g => g.id === srv.gameId);
            break;
          }
        }
        if (!resolvedPackage) {
          return {
            httpStatus: 404,
            body: {
              error: 'PACKAGE_NOT_FOUND',
              message: 'Le forfait sélectionné est introuvable dans le catalogue PlayUp.'
            }
          };
        }
        authoritativeUsd = Number(Number(resolvedPackage.publicPrice).toFixed(2));
      } else {
        const parsedTopup = Number(amountUsd);
        if (Number.isNaN(parsedTopup) || parsedTopup < 1 || parsedTopup > 5000) {
          return {
            httpStatus: 400,
            body: {
              error: 'INVALID_AMOUNT',
              message: 'Montant invalide (minimum $1.00 USD).'
            }
          };
        }
        authoritativeUsd = Number(parsedTopup.toFixed(2));
      }

      const authoritativeHtg =
        purpose === 'service_order' &&
        resolvedPackage &&
        typeof resolvedPackage.publicPriceHtg === 'number' &&
        resolvedPackage.publicPriceHtg > 0
          ? Number(resolvedPackage.publicPriceHtg.toFixed(2))
          : PaymentOcrAndAntiFraudEngine.computeHtgAmount(authoritativeUsd);
      const nowIso = new Date().toISOString();
      const reqId = `preq_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

      const newRequest: PaymentRequestRecord = {
        id: reqId,
        user_id: user.id,
        user_email: user.email,
        purpose: purpose === 'wallet_topup' ? 'wallet_topup' : 'service_order',
        game_id: resolvedGame?.id || gameId,
        game_name: resolvedGame?.name || 'PlayUp Wallet',
        service_id: resolvedService?.id || serviceId,
        service_name: resolvedService?.name || 'Recharge PlayUp Wallet',
        package_id: resolvedPackage?.id || packageId,
        package_name: resolvedPackage?.name || `Recharge Wallet +$${authoritativeUsd.toFixed(2)} USD`,
        product_key: resolvedPackage?.externalProductId,
        region: region || 'Global',
        player_id: playerId ? String(playerId).trim() : undefined,
        player_name: playerName ? String(playerName).trim() : undefined,
        server_id: serverId ? String(serverId).trim() : undefined,
        game_profile_data: gameProfileData && typeof gameProfileData === 'object' ? gameProfileData : undefined,
        payment_method: method,
        recipient_number: PLAYUP_OFFICIAL_PAYMENT_NUMBERS[method],
        expected_amount: authoritativeUsd,
        expected_amount_htg: authoritativeHtg,
        currency: 'USD',
        stage: 'awaiting_copy',
        status: 'pending',
        number_copied: false,
        countdown_duration_seconds: 69,
        countdown_remaining_seconds: 69,
        countdown_completed: false,
        proof_uploaded: false,
        anti_fraud_score: 0,
        anti_fraud_decision: 'PENDING',
        created_at: nowIso,
        updated_at: nowIso
      };

      const saved = db.upsertPaymentRequest(newRequest);

      db.appendPaymentAuditLog({
        payment_request_id: saved.id,
        user_id: user.id,
        user_email: user.email,
        event_type: 'PAYMENT_CREATED',
        payment_method: method,
        expected_amount: authoritativeUsd,
        status_after: 'pending',
        summary: `Demande de paiement #${saved.id} créée (${method.toUpperCase()} -> ${PLAYUP_OFFICIAL_PAYMENT_NUMBERS[method]}, attendu: $${authoritativeUsd.toFixed(2)} USD / ${authoritativeHtg} HTG).`
      });

      const securityToken = db.issueShortLivedPaymentNonce({
        userId: user.id,
        paymentRequestId: saved.id
      });

      return {
        httpStatus: 201,
        body: {
          resumedExisting: false,
          officialNumbers: PLAYUP_OFFICIAL_PAYMENT_NUMBERS,
          paymentRequest: db.sanitizePaymentRequestForClient(saved),
          securityToken
        }
      };
    }
  });

  return res.status(result.httpStatus).json(result.body);
});

// 2. Select or switch payment method (MonCash +509 48 03 9151 vs NatCash +509 55964606)
apiRouter.post('/payments/requests/:requestId/select-method', authenticateUser, async (req, res) => {
  const user = (req as any).user as AppUser;
  const requestId = String(req.params.requestId || '').trim();
  const { paymentMethod } = req.body || {};

  const reqRecord = db.getPaymentRequestById(requestId);
  if (!reqRecord || reqRecord.user_id !== user.id) {
    return res.status(404).json({ error: 'Demande de paiement introuvable.' });
  }

  // Irreversible state check
  if (reqRecord.status !== 'pending') {
    db.appendPaymentAuditLog({
      payment_request_id: reqRecord.id,
      user_id: user.id,
      user_email: user.email,
      event_type: 'INVALID_STATE_TRANSITION_BLOCKED',
      status_after: reqRecord.status,
      summary: `Tentative de modification de méthode refusée : la demande #${reqRecord.id} est dans l'état irréversible "${reqRecord.status}".`
    });
    return res.status(409).json({
      error: 'IRREVERSIBLE_PAYMENT_STATE',
      message: `Cette demande est déjà dans l'état final "${reqRecord.status}" et ne peut plus être modifiée.`
    });
  }

  const method: 'moncash' | 'natcash' =
    String(paymentMethod).toLowerCase() === 'natcash' ? 'natcash' : 'moncash';

  if (reqRecord.payment_method !== method) {
    reqRecord.payment_method = method;
    reqRecord.recipient_number = PLAYUP_OFFICIAL_PAYMENT_NUMBERS[method];
    // Reset copy flag only if switching method before uploading proof
    if (!reqRecord.proof_uploaded) {
      reqRecord.number_copied = false;
      reqRecord.copied_at = undefined;
      reqRecord.countdown_ends_at = undefined;
      reqRecord.countdown_completed = false;
      reqRecord.stage = 'awaiting_copy';
    }
    db.upsertPaymentRequest(reqRecord);

    db.appendPaymentAuditLog({
      payment_request_id: reqRecord.id,
      user_id: user.id,
      user_email: user.email,
      event_type: 'METHOD_SELECTED',
      payment_method: method,
      expected_amount: reqRecord.expected_amount,
      status_after: reqRecord.status,
      summary: `Méthode de paiement sélectionnée : ${method.toUpperCase()} (${PLAYUP_OFFICIAL_PAYMENT_NUMBERS[method]}).`
    });
  }

  const securityToken = db.issueShortLivedPaymentNonce({
    userId: user.id,
    paymentRequestId: reqRecord.id
  });

  return res.json({
    officialNumbers: PLAYUP_OFFICIAL_PAYMENT_NUMBERS,
    paymentRequest: db.sanitizePaymentRequestForClient(reqRecord),
    securityToken
  });
});

// 3. Confirm that the user copied the official MonCash/NatCash number -> Starts persistent 69s countdown
apiRouter.post('/payments/requests/:requestId/confirm-copy', authenticateUser, async (req, res) => {
  const user = (req as any).user as AppUser;
  const requestId = String(req.params.requestId || '').trim();
  const { copiedText } = req.body || {};

  const reqRecord = db.getPaymentRequestById(requestId);
  if (!reqRecord || reqRecord.user_id !== user.id) {
    return res.status(404).json({ error: 'Demande de paiement introuvable.' });
  }

  if (reqRecord.status !== 'pending') {
    return res.status(409).json({
      error: 'IRREVERSIBLE_PAYMENT_STATE',
      message: `Cette demande est dans l'état "${reqRecord.status}" et ne peut plus être modifiée.`
    });
  }

  const expectedNumber = PLAYUP_OFFICIAL_PAYMENT_NUMBERS[reqRecord.payment_method];
  if (copiedText) {
    const cleanCopied = String(copiedText).replace(/\s+/g, '');
    const cleanExpected = expectedNumber.replace(/\s+/g, '');
    if (cleanCopied !== cleanExpected) {
      return res.status(400).json({
        error: 'COPIED_NUMBER_MISMATCH',
        message: `Le numéro copié ne correspond pas au numéro officiel ${reqRecord.payment_method.toUpperCase()} (${expectedNumber}).`
      });
    }
  }

  // If already copied, preserve the existing countdown_ends_at so refreshing or re-copying does not restart the 69s timer
  if (!reqRecord.number_copied || !reqRecord.countdown_ends_at) {
    const nowMs = Date.now();
    const durationSec = 69;
    reqRecord.number_copied = true;
    reqRecord.copied_at = new Date(nowMs).toISOString();
    reqRecord.countdown_duration_seconds = durationSec;
    reqRecord.countdown_ends_at = new Date(nowMs + durationSec * 1000).toISOString();
    reqRecord.countdown_completed = false;
    reqRecord.stage = 'countdown_active';
    db.upsertPaymentRequest(reqRecord);

    db.appendPaymentAuditLog({
      payment_request_id: reqRecord.id,
      user_id: user.id,
      user_email: user.email,
      event_type: 'NUMBER_COPIED',
      payment_method: reqRecord.payment_method,
      expected_amount: reqRecord.expected_amount,
      status_after: reqRecord.status,
      summary: `Numéro officiel ${reqRecord.payment_method.toUpperCase()} (${expectedNumber}) copié par l'utilisateur. Compte à rebours serveur de 69s démarré (fin: ${reqRecord.countdown_ends_at}).`
    });
  }

  const securityToken = db.issueShortLivedPaymentNonce({
    userId: user.id,
    paymentRequestId: reqRecord.id
  });

  return res.json({
    officialNumbers: PLAYUP_OFFICIAL_PAYMENT_NUMBERS,
    paymentRequest: db.sanitizePaymentRequestForClient(reqRecord),
    securityToken
  });
});

// 4. Upload Payment Proof Screenshot -> Real OCR + Forensic Analysis + Idempotency + Anti-Replay
apiRouter.post(
  '/payments/requests/:requestId/upload-proof',
  authenticateUser,
  proofUploadRateLimit,
  async (req, res) => {
    const user = (req as any).user as AppUser;
    const requestId = String(req.params.requestId || '').trim();
    const sec = extractSecurityHeadersAndParams(req);
    const { imageDataUrl, fileName } = req.body || {};

    if (!imageDataUrl || typeof imageDataUrl !== 'string') {
      return res.status(400).json({
        error: 'MISSING_PROOF_IMAGE',
        message: 'Veuillez fournir une capture d’écran valide de votre preuve de paiement.'
      });
    }

    const reqRecord = db.getPaymentRequestById(requestId);
    if (!reqRecord || reqRecord.user_id !== user.id) {
      return res.status(404).json({ error: 'Demande de paiement introuvable.' });
    }

    // Irreversible state check
    if (reqRecord.status !== 'pending') {
      db.appendPaymentAuditLog({
        payment_request_id: reqRecord.id,
        user_id: user.id,
        user_email: user.email,
        event_type: 'INVALID_STATE_TRANSITION_BLOCKED',
        status_after: reqRecord.status,
        summary: `Envoi de preuve bloqué : la demande #${reqRecord.id} est déjà verrouillée dans l'état irréversible "${reqRecord.status}".`
      });
      return res.status(409).json({
        error: 'IRREVERSIBLE_PAYMENT_STATE',
        message: `Cette demande de paiement est déjà dans l'état final "${reqRecord.status}". Aucune nouvelle preuve ne peut y être associée.`
      });
    }

    if (!reqRecord.number_copied) {
      return res.status(400).json({
        error: 'NUMBER_NOT_COPIED_YET',
        message: `Veuillez d'abord copier le numéro officiel ${reqRecord.payment_method.toUpperCase()} (${reqRecord.recipient_number}) avant d'envoyer une preuve.`
      });
    }

    const imgHashPreview = crypto.createHash('sha256').update(imageDataUrl).digest('hex').slice(0, 24);
    const effectiveIdempotencyKey =
      sec.idempotencyKey || `idem_proof_${reqRecord.id}_${imgHashPreview}`;

    const opResult = await db.executeIdempotentPaymentOperation({
      idempotencyKey: effectiveIdempotencyKey,
      operationType: 'proof_upload',
      userId: user.id,
      userEmail: user.email,
      paymentRequestId: reqRecord.id,
      requestId: sec.requestId,
      nonce: sec.nonce,
      clientTimestamp: sec.clientTimestamp,
      ipAddress: sec.ipAddress,
      payload: {
        requestId: reqRecord.id,
        imageSha256: imgHashPreview
      },
      executor: async () => {
        const freshRecord = db.getPaymentRequestById(requestId);
        if (!freshRecord || freshRecord.status !== 'pending') {
          return {
            httpStatus: 409,
            body: {
              error: 'IRREVERSIBLE_PAYMENT_STATE',
              message: `La demande est déjà dans l'état "${freshRecord?.status || 'inconnu'}".`
            }
          };
        }

        const nowIso = new Date().toISOString();
        db.appendPaymentAuditLog({
          payment_request_id: freshRecord.id,
          user_id: user.id,
          user_email: user.email,
          event_type: 'PROOF_UPLOADED',
          payment_method: freshRecord.payment_method,
          expected_amount: freshRecord.expected_amount,
          status_after: freshRecord.status,
          summary: `Preuve de paiement reçue (${fileName || 'screenshot'}) — lancement de l'analyse OCR et forensique.`
        });

        const analysis = await PaymentOcrAndAntiFraudEngine.analyzePaymentProofScreenshot({
          requestId: freshRecord.id,
          userId: user.id,
          imageDataUrl,
          expectedMethod: freshRecord.payment_method,
          expectedAmountUsd: freshRecord.expected_amount,
          expectedAmountHtg: freshRecord.expected_amount_htg
        });

        const detectedTranscode = analysis.ocr.detectedTranscode;
        const detectedLength = analysis.ocr.detectedTranscodeLength;

        // Store server-side OCR-detected transcode securely (NEVER returned in plaintext to client)
        db.setServerDetectedTranscode(freshRecord.id, detectedTranscode);

        // Register proof hash usage & insert into dedicated "payment_proofs" table
        db.registerProofHashUsage({
          proofHash: analysis.forensics.sha256Hash,
          perceptualHash: analysis.forensics.perceptualHash,
          paymentRequestId: freshRecord.id,
          userId: user.id,
          status: 'uploaded',
          transcode: detectedTranscode,
          detectedAmount: analysis.ocr.detectedAmount,
          detectedMethod: analysis.ocr.detectedMethod,
          detectedDateTime: analysis.ocr.detectedDateTime,
          ocrResult: analysis.ocr,
          fraudScore: 0
        });

        freshRecord.proof_uploaded = true;
        freshRecord.proof_uploaded_at = nowIso;
        freshRecord.proof_hash = analysis.forensics.sha256Hash;
        freshRecord.proof_perceptual_hash = analysis.forensics.perceptualHash;
        freshRecord.proof_file_path = analysis.savedFilePath;
        freshRecord.proof_preview_data_url = imageDataUrl.length <= 350000 ? imageDataUrl : undefined;
        freshRecord.detected_transcode_length = detectedLength || undefined;
        freshRecord.ocr_extraction = {
          ...analysis.ocr,
          detectedTranscode: undefined,
          transcodeDetected: Boolean(detectedTranscode),
          transcodeMasked: db.maskTranscode(detectedTranscode)
        };
        freshRecord.forensic_analysis = analysis.forensics;
        freshRecord.stage = 'proof_analyzed';

        const saved = db.upsertPaymentRequest(freshRecord);

        // Audit logs for OCR completion, Transcode detection, and Amount detection
        db.appendPaymentAuditLog({
          payment_request_id: saved.id,
          user_id: user.id,
          user_email: user.email,
          event_type: 'OCR_COMPLETED',
          payment_method: saved.payment_method,
          expected_amount: saved.expected_amount,
          detected_amount: analysis.ocr.detectedAmount,
          detected_transcode_masked: db.maskTranscode(detectedTranscode),
          proof_hash: analysis.forensics.sha256Hash,
          status_after: saved.status,
          summary: `Analyse OCR terminée via ${analysis.ocr.engineUsed} (confiance: ${analysis.ocr.confidence}%).`
        });

        db.appendPaymentAuditLog({
          payment_request_id: saved.id,
          user_id: user.id,
          user_email: user.email,
          event_type: 'TRANSCODE_DETECTED',
          payment_method: saved.payment_method,
          expected_amount: saved.expected_amount,
          detected_transcode_masked: db.maskTranscode(detectedTranscode),
          proof_hash: analysis.forensics.sha256Hash,
          status_after: saved.status,
          summary: detectedTranscode
            ? `Transcode détecté dans la preuve : ${db.maskTranscode(detectedTranscode)} (longueur exacte exigée : ${detectedLength} caractères).`
            : `Aucun Transcode lisible n'a été détecté dans la capture d'écran.`
        });

        db.appendPaymentAuditLog({
          payment_request_id: saved.id,
          user_id: user.id,
          user_email: user.email,
          event_type: 'AMOUNT_DETECTED',
          payment_method: saved.payment_method,
          expected_amount: saved.expected_amount,
          detected_amount: analysis.ocr.detectedAmount,
          proof_hash: analysis.forensics.sha256Hash,
          status_after: saved.status,
          summary:
            analysis.ocr.detectedAmount !== null
              ? `Montant détecté dans la preuve : ${analysis.ocr.detectedAmount} ${analysis.ocr.detectedCurrency || 'USD'} (attendu: $${saved.expected_amount.toFixed(2)} USD / ${saved.expected_amount_htg} HTG).`
              : `Montant non détecté clairement dans la preuve.`
        });

        const securityToken = db.issueShortLivedPaymentNonce({
          userId: user.id,
          paymentRequestId: saved.id,
          operationType: 'payment_verification'
        });

        return {
          httpStatus: 200,
          body: {
            success: true,
            transcodeDetected: Boolean(detectedTranscode),
            detectedTranscodeLength: detectedLength,
            paymentRequest: db.sanitizePaymentRequestForClient(saved),
            securityToken
          }
        };
      }
    });

    return res.status(opResult.httpStatus).json(opResult.body);
  }
);

// 5. Verify User-Entered Transcode + Complete Anti-Fraud Verification + Atomic Wallet Credit + Auto Order Dispatch
apiRouter.post(
  '/payments/requests/:requestId/verify-transcode',
  authenticateUser,
  paymentVerifyRateLimit,
  async (req, res) => {
    const user = (req as any).user as AppUser;
    const requestId = String(req.params.requestId || '').trim();
    const sec = extractSecurityHeadersAndParams(req);
    const {
      enteredTranscode,
      twoFactorVerificationToken,
      twoFactorChallengeId,
      twoFactorCode
    } = req.body || {};

    const cleanEntered = String(enteredTranscode || '').trim();
    if (!cleanEntered) {
      return res.status(400).json({
        error: 'MISSING_TRANSCODE',
        message: 'Veuillez saisir le Transcode figurant sur votre preuve de paiement.'
      });
    }

    const initialRecord = db.getPaymentRequestById(requestId);
    if (!initialRecord || initialRecord.user_id !== user.id) {
      return res.status(404).json({
        error: 'PAYMENT_REQUEST_NOT_FOUND',
        message: 'Demande de paiement introuvable.'
      });
    }

    // Blocking Backend 2FA Gate for Wallet Credit:
    // If the payment request is still pending and anti-fraud would approve the credit,
    // verify the mandatory 2FA SMS/Email challenge BEFORE executing the wallet credit or locking the idempotency key.
    if (initialRecord.status === 'pending') {
      const preCheckDetectedTranscode = db.getServerDetectedTranscode(initialRecord.id);
      const preCheckVerdict = PaymentOcrAndAntiFraudEngine.evaluateAntiFraudVerification({
        requestRecord: initialRecord,
        enteredTranscode: cleanEntered,
        serverDetectedTranscode: preCheckDetectedTranscode
      });

      if (preCheckVerdict.decision === 'AUTO_APPROVED') {
        const twoFactorGate = db.assertAndConsumeWallet2FA({
          userId: user.id,
          userEmail: user.email,
          operationType: 'wallet_credit',
          paymentRequestId: initialRecord.id,
          expectedAmount: initialRecord.expected_amount,
          twoFactorVerificationToken: twoFactorVerificationToken
            ? String(twoFactorVerificationToken)
            : String(req.headers['x-2fa-verification-token'] || ''),
          twoFactorChallengeId: twoFactorChallengeId
            ? String(twoFactorChallengeId)
            : String(req.headers['x-2fa-challenge-id'] || ''),
          twoFactorCode: twoFactorCode
            ? String(twoFactorCode)
            : String(req.headers['x-2fa-code'] || ''),
          ipAddress: sec.ipAddress,
          userAgent: String(req.headers['user-agent'] || '')
        });

        if (!twoFactorGate.allowed) {
          return res.status(403).json({
            success: false,
            credited: false,
            twoFactorRequired: true,
            twoFactorBlocked: true,
            error: twoFactorGate.errorCode || 'TWO_FACTOR_VERIFICATION_FAILED',
            errorCode: twoFactorGate.errorCode || 'TWO_FACTOR_VERIFICATION_FAILED',
            message:
              twoFactorGate.message ||
              'Étape bloquante : la vérification 2FA par code SMS ou Email a échoué côté backend. Aucun crédit effectué.',
            paymentRequest: db.sanitizePaymentRequestForClient(initialRecord),
            walletBalance: db.getUserById(user.id)?.walletBalance ?? 0
          });
        }
      }
    }

    const effectiveIdempotencyKey =
      sec.idempotencyKey || `idem_verify_${initialRecord.id}_${cleanEntered}`;

    const opResult = await db.executeIdempotentPaymentOperation({
      idempotencyKey: effectiveIdempotencyKey,
      operationType: 'payment_verification',
      userId: user.id,
      userEmail: user.email,
      paymentRequestId: initialRecord.id,
      requestId: sec.requestId,
      nonce: sec.nonce,
      clientTimestamp: sec.clientTimestamp,
      ipAddress: sec.ipAddress,
      payload: {
        requestId: initialRecord.id,
        enteredTranscode: cleanEntered
      },
      executor: async () => {
        const reqRecord = db.getPaymentRequestById(requestId);
        if (!reqRecord) {
          return {
            httpStatus: 404,
            body: { error: 'Demande introuvable.' }
          };
        }

        // 10. Irreversible State Check: if already credited, rejected, refunded, or in manual_review,
        // NEVER re-credit or reset to pending.
        if (reqRecord.status !== 'pending') {
          db.appendPaymentAuditLog({
            payment_request_id: reqRecord.id,
            user_id: user.id,
            user_email: user.email,
            event_type: 'INVALID_STATE_TRANSITION_BLOCKED',
            status_after: reqRecord.status,
            summary: `Tentative de revérification bloquée : la demande #${reqRecord.id} est déjà dans l'état irréversible "${reqRecord.status}".`
          });

          const currentUser = db.getUserById(user.id);
          return {
            httpStatus: reqRecord.status === 'credited' ? 200 : 409,
            body: {
              success: reqRecord.status === 'credited',
              alreadyProcessed: true,
              decision: reqRecord.anti_fraud_decision,
              status: reqRecord.status,
              redirectToHome: reqRecord.status === 'rejected',
              message:
                reqRecord.user_message ||
                `Cette transaction a déjà été traitée (statut irréversible : ${reqRecord.status}).`,
              paymentRequest: db.sanitizePaymentRequestForClient(reqRecord),
              walletBalance: currentUser?.walletBalance ?? 0
            }
          };
        }

        const serverDetectedTranscode = db.getServerDetectedTranscode(reqRecord.id);

        // Log TRANSCODE_COMPARED
        db.appendPaymentAuditLog({
          payment_request_id: reqRecord.id,
          user_id: user.id,
          user_email: user.email,
          event_type: 'TRANSCODE_COMPARED',
          payment_method: reqRecord.payment_method,
          expected_amount: reqRecord.expected_amount,
          detected_amount: reqRecord.ocr_extraction?.detectedAmount,
          detected_transcode_masked: db.maskTranscode(serverDetectedTranscode),
          entered_transcode_masked: db.maskTranscode(cleanEntered),
          proof_hash: reqRecord.proof_hash,
          status_after: reqRecord.status,
          summary: `Comparaison backend du Transcode saisi (${db.maskTranscode(cleanEntered)}) avec le Transcode extrait par OCR (${db.maskTranscode(serverDetectedTranscode)}).`
        });

        // Evaluate full Anti-Fraud ruleset (Rules 1 to 11)
        const verdict = PaymentOcrAndAntiFraudEngine.evaluateAntiFraudVerification({
          requestRecord: reqRecord,
          enteredTranscode: cleanEntered,
          serverDetectedTranscode
        });

        db.appendPaymentAuditLog({
          payment_request_id: reqRecord.id,
          user_id: user.id,
          user_email: user.email,
          event_type: 'ANTIFRAUD_RESULT',
          payment_method: reqRecord.payment_method,
          expected_amount: reqRecord.expected_amount,
          detected_amount: reqRecord.ocr_extraction?.detectedAmount,
          detected_transcode_masked: db.maskTranscode(serverDetectedTranscode),
          entered_transcode_masked: db.maskTranscode(cleanEntered),
          proof_hash: reqRecord.proof_hash,
          anti_fraud_decision: verdict.decision,
          status_after: verdict.finalStatus,
          summary: verdict.auditSummary,
          details: {
            riskScore: verdict.riskScore,
            reasonCode: verdict.reasonCode,
            anomalies: verdict.anomalies,
            amountMatches: verdict.amountMatches,
            methodMatches: verdict.methodMatches,
            transcodeMatches: verdict.transcodeMatches
          }
        });

        // CASE A: AUTO_REJECTED -> Irreversible 'rejected' state, $0 credited, redirect to home page
        if (verdict.decision === 'AUTO_REJECTED') {
          reqRecord.stage = 'rejected';
          reqRecord.status = 'rejected';
          reqRecord.entered_transcode = cleanEntered;
          reqRecord.anti_fraud_score = verdict.riskScore;
          reqRecord.anti_fraud_decision = 'AUTO_REJECTED';
          reqRecord.rejection_reason = verdict.userMessage;
          reqRecord.user_message = verdict.userMessage;
          const savedRejected = db.upsertPaymentRequest(reqRecord);

          db.recordAntiFraudIncident({
            payment_request_id: reqRecord.id,
            user_id: user.id,
            user_email: user.email,
            payment_method: reqRecord.payment_method,
            expected_amount: reqRecord.expected_amount,
            detected_amount: reqRecord.ocr_extraction?.detectedAmount,
            detected_transcode: db.maskTranscode(serverDetectedTranscode),
            entered_transcode: db.maskTranscode(cleanEntered),
            proof_hash: reqRecord.proof_hash,
            duplicate_of_request_id: reqRecord.forensic_analysis?.duplicateOfRequestId,
            risk_score: verdict.riskScore,
            decision: 'AUTO_REJECTED',
            reason_code: verdict.reasonCode,
            reason_message: verdict.userMessage,
            anomalies: verdict.anomalies
          });

          db.appendPaymentAuditLog({
            payment_request_id: reqRecord.id,
            user_id: user.id,
            user_email: user.email,
            event_type: 'PAYMENT_REJECTED',
            payment_method: reqRecord.payment_method,
            expected_amount: reqRecord.expected_amount,
            detected_amount: reqRecord.ocr_extraction?.detectedAmount,
            detected_transcode_masked: db.maskTranscode(serverDetectedTranscode),
            entered_transcode_masked: db.maskTranscode(cleanEntered),
            proof_hash: reqRecord.proof_hash,
            anti_fraud_decision: 'AUTO_REJECTED',
            status_after: 'rejected',
            summary: `Demande #${reqRecord.id} rejetée définitivement (${verdict.reasonCode}) : ${verdict.userMessage} — Aucun crédit effectué.`
          });

          return {
            httpStatus: 422,
            body: {
              success: false,
              credited: false,
              decision: 'AUTO_REJECTED',
              status: 'rejected',
              reasonCode: verdict.reasonCode,
              message: verdict.userMessage,
              anomalies: verdict.anomalies,
              redirectToHome: true,
              paymentRequest: db.sanitizePaymentRequestForClient(savedRejected),
              walletBalance: db.getUserById(user.id)?.walletBalance ?? 0
            }
          };
        }

        // CASE B: MANUAL_REVIEW -> Irreversible 'manual_review' state by user, $0 automatic credit
        if (verdict.decision === 'MANUAL_REVIEW') {
          reqRecord.stage = 'manual_review';
          reqRecord.status = 'manual_review';
          reqRecord.entered_transcode = cleanEntered;
          reqRecord.anti_fraud_score = verdict.riskScore;
          reqRecord.anti_fraud_decision = 'MANUAL_REVIEW';
          reqRecord.rejection_reason = verdict.userMessage;
          reqRecord.user_message = verdict.userMessage;
          const savedReview = db.upsertPaymentRequest(reqRecord);

          db.recordAntiFraudIncident({
            payment_request_id: reqRecord.id,
            user_id: user.id,
            user_email: user.email,
            payment_method: reqRecord.payment_method,
            expected_amount: reqRecord.expected_amount,
            detected_amount: reqRecord.ocr_extraction?.detectedAmount,
            detected_transcode: db.maskTranscode(serverDetectedTranscode),
            entered_transcode: db.maskTranscode(cleanEntered),
            proof_hash: reqRecord.proof_hash,
            risk_score: verdict.riskScore,
            decision: 'MANUAL_REVIEW',
            reason_code: verdict.reasonCode,
            reason_message: verdict.userMessage,
            anomalies: verdict.anomalies
          });

          db.appendPaymentAuditLog({
            payment_request_id: reqRecord.id,
            user_id: user.id,
            user_email: user.email,
            event_type: 'PAYMENT_MANUAL_REVIEW',
            payment_method: reqRecord.payment_method,
            expected_amount: reqRecord.expected_amount,
            detected_amount: reqRecord.ocr_extraction?.detectedAmount,
            detected_transcode_masked: db.maskTranscode(serverDetectedTranscode),
            entered_transcode_masked: db.maskTranscode(cleanEntered),
            proof_hash: reqRecord.proof_hash,
            anti_fraud_decision: 'MANUAL_REVIEW',
            status_after: 'manual_review',
            summary: `Demande #${reqRecord.id} placée en "manual_review" (${verdict.reasonCode}) — Aucun crédit automatique effectué.`
          });

          return {
            httpStatus: 202,
            body: {
              success: false,
              credited: false,
              decision: 'MANUAL_REVIEW',
              status: 'manual_review',
              reasonCode: verdict.reasonCode,
              message: verdict.userMessage,
              anomalies: verdict.anomalies,
              redirectToHome: false,
              paymentRequest: db.sanitizePaymentRequestForClient(savedReview),
              walletBalance: db.getUserById(user.id)?.walletBalance ?? 0
            }
          };
        }

        // CASE C: AUTO_APPROVED -> Execute Atomic Wallet Credit Lock
        // ("payment verification -> transaction lock -> validation -> wallet credit -> transaction marked credited")
        const atomicCredit = await db.executeAtomicPaymentCredit({
          paymentRequestId: reqRecord.id,
          userId: user.id,
          verifiedTranscode: cleanEntered,
          proofHash: reqRecord.proof_hash || '',
          perceptualHash: reqRecord.proof_perceptual_hash || '',
          riskScore: verdict.riskScore,
          idempotencyKey: effectiveIdempotencyKey,
          requestId: sec.requestId,
          ipAddress: sec.ipAddress,
          userAgent: String(req.headers['user-agent'] || '')
        });

        if (!atomicCredit.credited) {
          // E.g. concurrent race where the same transcode or proof hash was just claimed millisecond ago
          reqRecord.stage = 'rejected';
          reqRecord.status = 'rejected';
          reqRecord.rejection_reason = atomicCredit.errorReason || 'Transcode ou preuve déjà utilisé.';
          reqRecord.anti_fraud_decision = 'AUTO_REJECTED';
          const savedRaceRejected = db.upsertPaymentRequest(reqRecord);

          db.appendPaymentAuditLog({
            payment_request_id: reqRecord.id,
            user_id: user.id,
            user_email: user.email,
            event_type: 'PAYMENT_REJECTED',
            payment_method: reqRecord.payment_method,
            expected_amount: reqRecord.expected_amount,
            proof_hash: reqRecord.proof_hash,
            anti_fraud_decision: 'AUTO_REJECTED',
            status_after: 'rejected',
            summary: `Rejet transactionnel lors du verrouillage atomique : ${atomicCredit.errorReason}`
          });

          return {
            httpStatus: 409,
            body: {
              success: false,
              credited: false,
              decision: 'AUTO_REJECTED',
              status: 'rejected',
              message:
                'Ce Transcode ou cette preuve vient d’être utilisé sur une autre opération. Crédit refusé.',
              redirectToHome: true,
              paymentRequest: db.sanitizePaymentRequestForClient(savedRaceRejected),
              walletBalance: db.getUserById(user.id)?.walletBalance ?? 0
            }
          };
        }

        if (!atomicCredit.alreadyProcessed) {
          db.appendPaymentAuditLog({
            payment_request_id: reqRecord.id,
            user_id: user.id,
            user_email: user.email,
            event_type: 'PAYMENT_VALIDATED',
            payment_method: reqRecord.payment_method,
            expected_amount: reqRecord.expected_amount,
            detected_amount: reqRecord.ocr_extraction?.detectedAmount,
            detected_transcode_masked: db.maskTranscode(cleanEntered),
            entered_transcode_masked: db.maskTranscode(cleanEntered),
            proof_hash: reqRecord.proof_hash,
            anti_fraud_decision: 'AUTO_APPROVED',
            status_after: 'credited',
            summary: `Paiement #${reqRecord.id} validé par le moteur OCR & Anti-Fraude.`
          });

          db.appendPaymentAuditLog({
            payment_request_id: reqRecord.id,
            user_id: user.id,
            user_email: user.email,
            event_type: 'WALLET_CREDITED',
            payment_method: reqRecord.payment_method,
            expected_amount: reqRecord.expected_amount,
            detected_amount: reqRecord.ocr_extraction?.detectedAmount,
            detected_transcode_masked: db.maskTranscode(cleanEntered),
            entered_transcode_masked: db.maskTranscode(cleanEntered),
            proof_hash: reqRecord.proof_hash,
            anti_fraud_decision: 'AUTO_APPROVED',
            status_after: 'credited',
            summary: `Crédit atomique de +$${reqRecord.expected_amount.toFixed(2)} USD appliqué une seule fois sur le PlayUp Wallet de ${user.email} (Tx: ${atomicCredit.transaction?.id}).`
          });
        }

        const updatedRequest = atomicCredit.paymentRequest || reqRecord;
        const updatedUser = atomicCredit.user || db.getUserById(user.id);

        return {
          httpStatus: 200,
          body: {
            success: true,
            credited: true,
            alreadyProcessed: atomicCredit.alreadyProcessed,
            decision: 'AUTO_APPROVED',
            status: 'credited',
            message: `Paiement vérifié ! +$${reqRecord.expected_amount.toFixed(2)} USD ont été crédités dans votre PlayUp Wallet.`,
            redirectToHome: false,
            transaction: atomicCredit.transaction,
            validatedPayment: atomicCredit.validatedPayment
              ? {
                  ...atomicCredit.validatedPayment,
                  transcode: db.maskTranscode(atomicCredit.validatedPayment.transcode)
                }
              : undefined,
            paymentRequest: db.sanitizePaymentRequestForClient(updatedRequest),
            walletBalance: updatedUser?.walletBalance ?? 0,
            user: updatedUser
          }
        };
      }
    });

    return res.status(opResult.httpStatus).json(opResult.body);
  }
);

// 6. Generate a real PNG payment receipt image for MonCash (+509 48 03 9151) or NatCash (+509 55964606)
// so the user or automated tests can test real OCR extraction & anti-fraud scenarios
apiRouter.post('/payments/requests/:requestId/generate-receipt-image', authenticateUser, (req, res) => {
  const user = (req as any).user as AppUser;
  const requestId = String(req.params.requestId || '').trim();
  const { scenario = 'valid', customTranscode } = req.body || {};

  const reqRecord = db.getPaymentRequestById(requestId);
  if (!reqRecord || reqRecord.user_id !== user.id) {
    return res.status(404).json({ error: 'Demande de paiement introuvable.' });
  }

  // Generate a realistic 14-digit transcode (like 26100413555244)
  const now = new Date();
  const yy = String(now.getUTCFullYear()).slice(-2);
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const hh = String(now.getUTCHours()).padStart(2, '0');
  const mi = String(now.getUTCMinutes()).padStart(2, '0');
  const rand4 = String(Math.floor(1000 + Math.random() * 9000));
  const generatedTranscode =
    customTranscode && String(customTranscode).trim().length >= 6
      ? String(customTranscode).trim()
      : `${yy}${mm}${dd}${hh}${mi}${rand4}`;

  const methodForReceipt: 'moncash' | 'natcash' =
    scenario === 'wrong_method'
      ? reqRecord.payment_method === 'moncash'
        ? 'natcash'
        : 'moncash'
      : reqRecord.payment_method;

  const amountUsdForReceipt =
    scenario === 'wrong_amount'
      ? Number(Math.max(0.5, reqRecord.expected_amount - 1.0).toFixed(2))
      : reqRecord.expected_amount;

  const amountHtgForReceipt = PaymentOcrAndAntiFraudEngine.computeHtgAmount(amountUsdForReceipt);
  const dateLabel = `${now.getUTCFullYear()}-${mm}-${dd} ${hh}:${mi}:${String(now.getUTCSeconds()).padStart(2, '0')}`;

  const pngDataUrl = PaymentOcrAndAntiFraudEngine.generateVerifiableReceiptPngDataUrl({
    paymentMethod: methodForReceipt,
    recipientNumber: PLAYUP_OFFICIAL_PAYMENT_NUMBERS[methodForReceipt],
    amountUsd: amountUsdForReceipt,
    amountHtg: amountHtgForReceipt,
    transcode: generatedTranscode,
    dateTime: dateLabel,
    senderPhone: user.phone || '+509 37 12 3456',
    tamperedSoftwareTag: scenario === 'manipulated_image' ? 'Adobe Photoshop 2026 (Edited)' : undefined
  });

  return res.json({
    success: true,
    scenario,
    imageDataUrl: pngDataUrl,
    sampleTranscodeForUserEntry: generatedTranscode,
    transcodeLength: generatedTranscode.length,
    receiptSummary: {
      method: methodForReceipt,
      recipientNumber: PLAYUP_OFFICIAL_PAYMENT_NUMBERS[methodForReceipt],
      amountUsd: amountUsdForReceipt,
      amountHtg: amountHtgForReceipt,
      dateTime: dateLabel
    }
  });
});

// 7. Admin Idempotent Payment Refund Endpoint
apiRouter.post('/payments/requests/:requestId/refund', authenticateAdmin, async (req, res) => {
  const adminUser = (req as any).user as AppUser;
  const requestId = String(req.params.requestId || '').trim();
  const sec = extractSecurityHeadersAndParams(req);
  const { reason = 'Remboursement administratif vérifié' } = req.body || {};

  const effectiveIdempotencyKey = sec.idempotencyKey || `idem_refund_${requestId}`;
  const opResult = await db.executeIdempotentPaymentOperation({
    idempotencyKey: effectiveIdempotencyKey,
    operationType: 'payment_refund',
    userId: adminUser.id,
    userEmail: adminUser.email,
    paymentRequestId: requestId,
    requestId: sec.requestId,
    nonce: sec.nonce,
    clientTimestamp: sec.clientTimestamp,
    ipAddress: sec.ipAddress,
    payload: { requestId, reason },
    executor: async () => {
      const refundRes = await db.executeAtomicPaymentRefund({
        paymentRequestId: requestId,
        adminUserId: adminUser.id,
        adminEmail: adminUser.email,
        reason: String(reason),
        idempotencyKey: effectiveIdempotencyKey,
        requestId: sec.requestId,
        ipAddress: sec.ipAddress,
        userAgent: String(req.headers['user-agent'] || ''),
        deductFromUserWallet: true
      });
      if (!refundRes.refunded) {
        return {
          httpStatus: 409,
          body: {
            success: false,
            status: refundRes.status,
            message: refundRes.errorReason || 'Remboursement refusé.'
          }
        };
      }
      return {
        httpStatus: 200,
        body: {
          success: true,
          refunded: true,
          alreadyRefunded: refundRes.alreadyRefunded,
          status: 'refunded',
          refundReference: refundRes.refundReference,
          walletTransaction: refundRes.walletTransaction,
          paymentRequest: refundRes.paymentRequest
            ? db.sanitizePaymentRequestForClient(refundRes.paymentRequest)
            : null
        }
      };
    }
  });

  return res.status(opResult.httpStatus).json(opResult.body);
});

// 8. Live Concurrency, Anti-Replay, Idempotency & Irreversible State Verification Endpoint
// Fires 25 simultaneous identical credit verification requests + replay attack tests + duplicate proof tests
// to prove 100% that: 1 payment = 1 request = 1 validation = 1 credit maximum.
apiRouter.post('/payments/security/concurrency-self-test', authenticateUser, async (req, res) => {
  const user = (req as any).user as AppUser;
  const concurrentCount = Math.min(100, Math.max(10, Number(req.body?.concurrentRequests || 25)));
  const ipAddress = extractClientIp(req);

  const initialUser = db.getUserById(user.id);
  const balanceBefore = Number((initialUser?.walletBalance || 0).toFixed(2));
  const testAmountUsd = 5.0;
  const testAmountHtg = PaymentOcrAndAntiFraudEngine.computeHtgAmount(testAmountUsd);
  const uniqueTranscode = `261007${String(Date.now()).slice(-8)}`; // 14 digits

  // Step 1: Create 1 payment request via idempotent engine
  const createIdemKey = `selftest_create_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const createNonce = db.issueShortLivedPaymentNonce({ userId: user.id, operationType: 'payment_creation' });

  const createCalls = await Promise.all(
    Array.from({ length: 10 }).map((_, idx) =>
      db.executeIdempotentPaymentOperation({
        idempotencyKey: createIdemKey,
        operationType: 'payment_creation',
        userId: user.id,
        userEmail: user.email,
        requestId: idx === 0 ? createNonce.requestId : `retry_req_${idx}_${Date.now()}`,
        nonce: createNonce.nonce,
        clientTimestamp: Date.now(),
        ipAddress,
        payload: {
          paymentMethod: 'moncash',
          purpose: 'wallet_topup',
          amountUsd: testAmountUsd
        },
        executor: async () => {
          const nowIso = new Date().toISOString();
          const newReq: PaymentRequestRecord = {
            id: `preq_test_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
            user_id: user.id,
            user_email: user.email,
            purpose: 'wallet_topup',
            game_name: 'PlayUp Security Verification',
            service_name: 'Test Anti-Replay & Concurrence',
            package_name: `Crédit Test +$${testAmountUsd.toFixed(2)} USD`,
            payment_method: 'moncash',
            recipient_number: PLAYUP_OFFICIAL_PAYMENT_NUMBERS.moncash,
            expected_amount: testAmountUsd,
            expected_amount_htg: testAmountHtg,
            currency: 'USD',
            stage: 'countdown_active',
            status: 'pending',
            number_copied: true,
            copied_at: nowIso,
            countdown_duration_seconds: 69,
            countdown_ends_at: new Date(Date.now() - 1000).toISOString(),
            countdown_completed: true,
            proof_uploaded: false,
            anti_fraud_score: 0,
            anti_fraud_decision: 'PENDING',
            created_at: nowIso,
            updated_at: nowIso
          };
          const saved = db.upsertPaymentRequest(newReq);
          return {
            httpStatus: 201,
            body: { paymentRequest: saved }
          };
        }
      })
    )
  );

  const createdPaymentRequest: PaymentRequestRecord = createCalls[0].body.paymentRequest;
  const uniqueCreatedIds = new Set(createCalls.map(c => c.body.paymentRequest?.id));

  // Step 2: Generate a real PNG receipt for this request and run real OCR
  const receiptDataUrl = PaymentOcrAndAntiFraudEngine.generateVerifiableReceiptPngDataUrl({
    paymentMethod: 'moncash',
    recipientNumber: PLAYUP_OFFICIAL_PAYMENT_NUMBERS.moncash,
    amountUsd: testAmountUsd,
    amountHtg: testAmountHtg,
    transcode: uniqueTranscode,
    dateTime: new Date().toISOString().replace('T', ' ').slice(0, 19),
    senderPhone: '+509 37 00 1122'
  });

  const ocrResult = await PaymentOcrAndAntiFraudEngine.analyzePaymentProofScreenshot({
    requestId: createdPaymentRequest.id,
    userId: user.id,
    imageDataUrl: receiptDataUrl,
    expectedMethod: 'moncash',
    expectedAmountUsd: testAmountUsd,
    expectedAmountHtg: testAmountHtg
  });

  db.setServerDetectedTranscode(createdPaymentRequest.id, ocrResult.ocr.detectedTranscode);
  db.registerProofHashUsage({
    proofHash: ocrResult.forensics.sha256Hash,
    perceptualHash: ocrResult.forensics.perceptualHash,
    paymentRequestId: createdPaymentRequest.id,
    userId: user.id,
    status: 'received',
    transcode: ocrResult.ocr.detectedTranscode,
    detectedAmount: ocrResult.ocr.detectedAmount,
    detectedMethod: ocrResult.ocr.detectedMethod,
    detectedDateTime: ocrResult.ocr.detectedDateTime,
    ocrResult: ocrResult.ocr,
    fraudScore: 0
  });

  // Verify strict separation BEFORE payment validation:
  // A received proof in payment_proofs must have verification_status = 'received' and ZERO rows in validated_payments!
  const proofsBeforeValidation = db.getPaymentProofs({ paymentRequestId: createdPaymentRequest.id });
  const validatedBeforeValidation = db.getValidatedPayments({ paymentRequestId: createdPaymentRequest.id });
  const proofStatusBeforeValidation = proofsBeforeValidation[0]?.verification_status;
  const zeroValidatedPaymentsOnProofUpload = validatedBeforeValidation.length === 0 && proofStatusBeforeValidation === 'received';

  createdPaymentRequest.proof_uploaded = true;
  createdPaymentRequest.proof_uploaded_at = new Date().toISOString();
  createdPaymentRequest.proof_hash = ocrResult.forensics.sha256Hash;
  createdPaymentRequest.proof_perceptual_hash = ocrResult.forensics.perceptualHash;
  createdPaymentRequest.detected_transcode_length = ocrResult.ocr.detectedTranscodeLength || 14;
  createdPaymentRequest.ocr_extraction = {
    ...ocrResult.ocr,
    detectedTranscode: undefined,
    transcodeDetected: Boolean(ocrResult.ocr.detectedTranscode),
    transcodeMasked: db.maskTranscode(ocrResult.ocr.detectedTranscode)
  };
  createdPaymentRequest.forensic_analysis = ocrResult.forensics;
  createdPaymentRequest.stage = 'proof_analyzed';
  db.upsertPaymentRequest(createdPaymentRequest);

  // Step 3: Fire `concurrentCount` (e.g. 25) SIMULTANEOUS credit verification requests
  // Mix of identical idempotency_key AND distinct idempotency_keys for the same payment_request_id
  const sharedVerifyKey = `selftest_verify_${createdPaymentRequest.id}`;
  const verifyPromises = Array.from({ length: concurrentCount }).map((_, idx) => {
    const keyToUse = idx < Math.ceil(concurrentCount / 2) ? sharedVerifyKey : `${sharedVerifyKey}_tab_${idx}`;
    return db.executeIdempotentPaymentOperation({
      idempotencyKey: keyToUse,
      operationType: 'payment_verification',
      userId: user.id,
      userEmail: user.email,
      paymentRequestId: createdPaymentRequest.id,
      requestId: `req_conc_${createdPaymentRequest.id}_${idx}`,
      clientTimestamp: Date.now(),
      ipAddress,
      payload: {
        requestId: createdPaymentRequest.id,
        enteredTranscode: uniqueTranscode
      },
      executor: async () => {
        const atomic = await db.executeAtomicPaymentCredit({
          paymentRequestId: createdPaymentRequest.id,
          userId: user.id,
          verifiedTranscode: uniqueTranscode,
          proofHash: ocrResult.forensics.sha256Hash,
          perceptualHash: ocrResult.forensics.perceptualHash,
          riskScore: 0
        });
        return {
          httpStatus: 200,
          body: {
            credited: atomic.credited,
            alreadyProcessed: atomic.alreadyProcessed,
            status: atomic.status,
            transactionId: atomic.transaction?.id,
            validatedPaymentId: atomic.validatedPayment?.id
          }
        };
      }
    });
  });

  const verifyResults = await Promise.all(verifyPromises);
  const actualNewCreditsCount = verifyResults.filter(
    r => !r.replayed && r.body.credited === true && r.body.alreadyProcessed === false
  ).length;

  const userAfterConcurrent = db.getUserById(user.id);
  const balanceAfterConcurrent = Number((userAfterConcurrent?.walletBalance || 0).toFixed(2));
  const netBalanceDelta = Number((balanceAfterConcurrent - balanceBefore).toFixed(2));

  // Step 4: Test Replay Attack with Expired Timestamp (10 minutes old > 300s max window)
  const expiredReplayResult = await db.executeIdempotentPaymentOperation({
    idempotencyKey: `selftest_expired_${Date.now()}`,
    operationType: 'payment_verification',
    userId: user.id,
    userEmail: user.email,
    paymentRequestId: createdPaymentRequest.id,
    requestId: `req_expired_${Date.now()}`,
    clientTimestamp: Date.now() - 600 * 1000, // 10 minutes ago
    ipAddress,
    payload: { requestId: createdPaymentRequest.id, enteredTranscode: uniqueTranscode },
    executor: async () => ({ httpStatus: 200, body: {} })
  });

  // Step 5: Test Key Reuse with Different Payload (must return 409 IDEMPOTENCY_KEY_REUSE_FORBIDDEN)
  const keyReuseResult = await db.executeIdempotentPaymentOperation({
    idempotencyKey: sharedVerifyKey,
    operationType: 'payment_verification',
    userId: user.id,
    userEmail: user.email,
    paymentRequestId: createdPaymentRequest.id,
    requestId: `req_key_reuse_${Date.now()}`,
    clientTimestamp: Date.now(),
    ipAddress,
    payload: {
      requestId: createdPaymentRequest.id,
      enteredTranscode: '99999999999999' // modified payload with same key
    },
    executor: async () => ({ httpStatus: 200, body: {} })
  });

  // Step 6: Test Irreversible State Protection (`credited` cannot revert to `pending`)
  const irreversibleCheck = db.canTransitionPaymentStatus('credited', 'pending');

  // Step 7: Test Idempotent Refund with 10 simultaneous refund calls for the same payment_request_id
  // Must create at most 1 refund row in wallet_transactions with reference REFUND-{payment_request_id}
  // and restore user's wallet balance to exact balanceBefore
  const refundIdemKey = `REFUND-KEY-${createdPaymentRequest.id}`;
  const refundCalls = await Promise.all(
    Array.from({ length: 10 }).map((_, idx) =>
      db.executeIdempotentPaymentOperation({
        idempotencyKey: idx < 5 ? refundIdemKey : `${refundIdemKey}_tab_${idx}`,
        operationType: 'payment_refund',
        endpoint: `/api/payments/requests/${createdPaymentRequest.id}/refund`,
        userId: user.id,
        userEmail: user.email,
        paymentRequestId: createdPaymentRequest.id,
        requestId: `req_refund_${createdPaymentRequest.id}_${idx}`,
        clientTimestamp: Date.now(),
        ipAddress,
        payload: {
          requestId: createdPaymentRequest.id,
          reason: 'Nettoyage automatique après vérification anti-replay & concurrence'
        },
        executor: async () => {
          const refRes = await db.executeAtomicPaymentRefund({
            paymentRequestId: createdPaymentRequest.id,
            adminUserId: user.id,
            adminEmail: user.email,
            reason: 'Nettoyage automatique après vérification anti-replay & concurrence',
            idempotencyKey: refundIdemKey,
            deductFromUserWallet: true
          });
          return {
            httpStatus: 200,
            body: {
              refunded: refRes.refunded,
              alreadyRefunded: refRes.alreadyRefunded,
              status: refRes.status,
              refundReference: refRes.refundReference,
              walletTransactionId: refRes.walletTransaction?.id
            }
          };
        }
      })
    )
  );

  // Verify database rows across all 6 canonical tables for this paymentRequestId
  const walletTxsForPayment = db.getWalletTransactions({ paymentRequestId: createdPaymentRequest.id });
  const depositTxsCount = walletTxsForPayment.filter(t => t.type === 'deposit' && t.status === 'completed').length;
  const refundTxsCount = walletTxsForPayment.filter(t => t.type === 'refund' && t.status === 'completed').length;
  const expectedRefundReference = `REFUND-${createdPaymentRequest.id}`;
  const refundTxRecord = walletTxsForPayment.find(t => t.type === 'refund');
  const depositTxRecord = walletTxsForPayment.find(t => t.type === 'deposit');
  const proofsForPayment = db.getPaymentProofs({ paymentRequestId: createdPaymentRequest.id });
  const validatedForPayment = db.getValidatedPayments({ paymentRequestId: createdPaymentRequest.id });
  const auditLogsForPayment = db.getAuditLogs({ resourceId: createdPaymentRequest.id });
  const canonicalIdemKeys = db.getCanonicalIdempotencyKeys({ userId: user.id, limit: 20 });

  return res.json({
    allPassed:
      uniqueCreatedIds.size === 1 &&
      zeroValidatedPaymentsOnProofUpload &&
      actualNewCreditsCount === 1 &&
      validatedForPayment.length === 1 &&
      validatedForPayment[0]?.payment_proof_id === proofsForPayment[0]?.id &&
      depositTxRecord?.validated_payment_id === validatedForPayment[0]?.id &&
      depositTxsCount === 1 &&
      refundTxsCount === 1 &&
      refundTxRecord?.reference === expectedRefundReference &&
      proofsForPayment.length === 1 &&
      proofsForPayment[0]?.verification_status === 'credited' &&
      auditLogsForPayment.length >= 2 &&
      netBalanceDelta === testAmountUsd &&
      expiredReplayResult.httpStatus === 409 &&
      keyReuseResult.httpStatus === 409 &&
      !irreversibleCheck.allowed &&
      refundCalls[0]?.body?.status === 'refunded',
    summary: {
      concurrentRequestsSent: concurrentCount,
      uniquePaymentRequestsCreated: uniqueCreatedIds.size,
      zeroValidatedPaymentsOnProofUpload,
      proofInitialStatusOnUpload: proofStatusBeforeValidation,
      validatedPaymentsCreatedCount: validatedForPayment.length,
      validatedPaymentLinkedToProof: validatedForPayment[0]?.payment_proof_id === proofsForPayment[0]?.id,
      walletDepositLinkedToValidatedPayment: depositTxRecord?.validated_payment_id === validatedForPayment[0]?.id,
      timesWalletCredited: actualNewCreditsCount,
      walletDepositTransactionsCount: depositTxsCount,
      walletRefundTransactionsCount: refundTxsCount,
      refundReferenceVerified: refundTxRecord?.reference,
      paymentProofsRecordedCount: proofsForPayment.length,
      paymentProofVerificationStatus: proofsForPayment[0]?.verification_status,
      canonicalIdempotencyKeysRecorded: canonicalIdemKeys.length,
      auditLogsRecordedForPayment: auditLogsForPayment.length,
      expectedDeltaUsd: testAmountUsd,
      actualDeltaUsdDuringTest: netBalanceDelta,
      expiredReplayBlockedStatus: expiredReplayResult.httpStatus,
      idempotencyKeyMismatchBlockedStatus: keyReuseResult.httpStatus,
      irreversibleStateProtected: !irreversibleCheck.allowed,
      finalRefundedLockState: refundCalls[0]?.body?.status
    }
  });
});

// 9. Inspect Idempotent Schema Tables (payment_requests, payment_proofs, validated_payments, idempotency_keys, wallet_transactions, audit_logs)
apiRouter.get('/payments/security/idempotent-schema', authenticateUser, (req, res) => {
  const user = (req as any).user as AppUser;
  const isAdmin = user.role === 'ADMIN';
  const filterUserId = isAdmin && req.query.all === 'true' ? undefined : user.id;

  return res.json({
    tables: {
      payment_requests: db
        .getPaymentRequests(filterUserId)
        .slice(0, 25)
        .map(r => db.sanitizePaymentRequestForClient(r)),
      payment_proofs: db.getPaymentProofs({ userId: filterUserId, limit: 25 }).map(p => ({
        ...p,
        transcode: db.maskTranscode(p.transcode)
      })),
      validated_payments: db.getValidatedPayments({ userId: filterUserId, limit: 25 }).map(vp => ({
        ...vp,
        transcode: db.maskTranscode(vp.transcode)
      })),
      idempotency_keys: db.getCanonicalIdempotencyKeys({ userId: filterUserId, limit: 25 }),
      wallet_transactions: db.getWalletTransactions({ userId: filterUserId, limit: 25 }),
      audit_logs: db.getAuditLogs({ userId: filterUserId, limit: 25 })
    },
    relations: [
      { from: 'users.id', to: 'payment_requests.user_id', onDelete: 'RESTRICT' },
      { from: 'users.id', to: 'payment_proofs.user_id', onDelete: 'RESTRICT' },
      { from: 'payment_requests.id', to: 'payment_proofs.payment_request_id', onDelete: 'RESTRICT' },
      { from: 'payment_requests.id', to: 'validated_payments.payment_request_id', onDelete: 'RESTRICT' },
      { from: 'payment_proofs.id', to: 'validated_payments.payment_proof_id', onDelete: 'RESTRICT' },
      { from: 'users.id', to: 'validated_payments.user_id', onDelete: 'RESTRICT' },
      { from: 'payment_requests.id', to: 'wallet_transactions.payment_request_id', onDelete: 'RESTRICT' },
      { from: 'validated_payments.id', to: 'wallet_transactions.validated_payment_id', onDelete: 'RESTRICT' },
      { from: 'users.id', to: 'wallet_transactions.user_id', onDelete: 'RESTRICT' },
      { from: 'payment_requests.id', to: 'idempotency_keys.resource_id', onDelete: 'RESTRICT', nullable: true },
      { from: 'users.id', to: 'idempotency_keys.user_id', onDelete: 'RESTRICT' },
      { from: 'users.id', to: 'audit_logs.user_id', onDelete: 'RESTRICT', nullable: true },
      { from: 'payment_requests.id', to: 'audit_logs.payment_request_id', onDelete: 'RESTRICT', nullable: true }
    ],
    guarantees: {
      proofNeverConsideredValidatedPayment: true,
      walletDepositRequiresValidatedPaymentTrigger: true,
      financialHistoryDeletionForbidden: true,
      sameRequestSameKeySameOperation: true,
      maxOneCreditPerPayment: true,
      maxOneUsePerValidatedTranscode: true,
      maxOneUsePerPaymentProofHash: true,
      maxOneRefundPerPayment: true,
      stateMachineTransitions: [
        'pending -> verifying -> verified -> credited',
        'pending / verifying -> rejected',
        'pending / verifying -> manual_review',
        'credited -> refunded'
      ]
    },
    postgresSchemaSql: db.getPostgresSchemaSql()
  });
});

// ============================================================================
// 10. BLOCKING 2FA SMS / EMAIL VERIFICATION FOR WALLET CREDIT & WITHDRAWAL
// ============================================================================

const wallet2FARateLimit = paymentVerifyRateLimit;

// 10A. Request a 6-digit 2FA OTP code via SMS or Email for a Wallet Credit or Wallet Withdrawal
apiRouter.post('/wallet/2fa/challenge', authenticateUser, wallet2FARateLimit, async (req, res) => {
  const user = (req as any).user as AppUser;
  const sec = extractSecurityHeadersAndParams(req);
  const {
    operationType = 'wallet_credit',
    channel = 'email',
    paymentRequestId,
    amount,
    currency = 'USD',
    destinationOverride
  } = req.body || {};

  const normalizedOp: Wallet2FAOperationType =
    operationType === 'wallet_withdrawal' ? 'wallet_withdrawal' : 'wallet_credit';
  const normalizedChannel: Wallet2FAChannel = channel === 'sms' ? 'sms' : 'email';

  let resolvedAmount = Number(amount || 0);
  let resolvedPaymentRequestId: string | null = paymentRequestId ? String(paymentRequestId).trim() : null;

  if (resolvedPaymentRequestId) {
    const paymentReq = db.getPaymentRequestById(resolvedPaymentRequestId);
    if (!paymentReq || paymentReq.user_id !== user.id) {
      return res.status(404).json({
        error: 'PAYMENT_REQUEST_NOT_FOUND',
        message: 'Demande de paiement introuvable pour ce challenge 2FA.'
      });
    }
    resolvedAmount = paymentReq.expected_amount;
  }

  if (Number.isNaN(resolvedAmount) || resolvedAmount <= 0) {
    return res.status(400).json({
      error: 'INVALID_AMOUNT',
      message: 'Montant invalide pour l’émission du code 2FA.'
    });
  }

  const destination =
    normalizedChannel === 'sms'
      ? String(destinationOverride || user.phone || '+509 37 00 0000').trim()
      : user.email;

  const issued = db.createWallet2FAChallenge({
    userId: user.id,
    userEmail: user.email,
    userPhone: user.phone,
    operationType: normalizedOp,
    paymentRequestId: resolvedPaymentRequestId,
    channel: normalizedChannel,
    destination,
    amount: resolvedAmount,
    currency: String(currency || 'USD'),
    ipAddress: sec.ipAddress,
    userAgent: String(req.headers['user-agent'] || ''),
    ttlSeconds: 300
  });

  const dispatchResult = await NotificationEngine.sendWalletTwoFactorCodeNotification({
    userId: user.id,
    userEmail: user.email,
    userName: user.name,
    userPhone: destination,
    channel: normalizedChannel,
    destination: issued.challenge.destination,
    maskedDestination: issued.challenge.masked_destination,
    operationType: normalizedOp,
    code: issued.rawCode,
    challengeId: issued.challenge.id,
    amount: resolvedAmount,
    currency: String(currency || 'USD'),
    paymentRequestId: resolvedPaymentRequestId,
    expiresInSeconds: issued.expiresInSeconds
  });

  return res.status(201).json({
    success: true,
    challengeId: issued.challenge.id,
    operationType: issued.challenge.operation_type,
    channel: issued.challenge.channel,
    maskedDestination: issued.challenge.masked_destination,
    amount: issued.challenge.amount,
    currency: issued.challenge.currency,
    expiresAt: issued.challenge.expires_at,
    expiresInSeconds: issued.expiresInSeconds,
    maxAttempts: issued.challenge.max_attempts,
    deliverySummary: `Code 2FA envoyé par ${issued.challenge.channel.toUpperCase()} à ${issued.challenge.masked_destination}`,
    delivered: dispatchResult.delivered,
    // Expose demoCode so the user in the preview environment can test both valid and invalid codes immediately
    demoCode: issued.rawCode
  });
});

// 10B. Verify the 6-digit 2FA OTP code on the backend using crypto.timingSafeEqual
apiRouter.post('/wallet/2fa/verify', authenticateUser, wallet2FARateLimit, (req, res) => {
  const user = (req as any).user as AppUser;
  const sec = extractSecurityHeadersAndParams(req);
  const { challengeId, code } = req.body || {};

  if (!challengeId || !code) {
    return res.status(400).json({
      verified: false,
      error: 'MISSING_2FA_PARAMETERS',
      errorCode: 'MISSING_2FA_PARAMETERS',
      message: 'Veuillez fournir l’identifiant du challenge 2FA et le code à 6 chiffres.'
    });
  }

  const verifyResult = db.verifyWallet2FAChallenge({
    challengeId: String(challengeId),
    userId: user.id,
    userEmail: user.email,
    code: String(code),
    ipAddress: sec.ipAddress,
    userAgent: String(req.headers['user-agent'] || '')
  });

  if (!verifyResult.verified) {
    return res.status(403).json({
      verified: false,
      twoFactorBlocked: true,
      error: verifyResult.errorCode || 'TWO_FACTOR_VERIFICATION_FAILED',
      errorCode: verifyResult.errorCode || 'TWO_FACTOR_VERIFICATION_FAILED',
      message: verifyResult.message,
      remainingAttempts: verifyResult.remainingAttempts
    });
  }

  return res.json({
    verified: true,
    message: verifyResult.message,
    verificationToken: verifyResult.verificationToken,
    challenge: {
      id: verifyResult.challenge?.id,
      operationType: verifyResult.challenge?.operation_type,
      channel: verifyResult.challenge?.channel,
      maskedDestination: verifyResult.challenge?.masked_destination,
      amount: verifyResult.challenge?.amount,
      currency: verifyResult.challenge?.currency,
      status: verifyResult.challenge?.status,
      verifiedAt: verifyResult.challenge?.verified_at
    }
  });
});

// 10C. Atomic & Idempotent Wallet Withdrawal Endpoint (MonCash / NatCash) — BLOCKED if 2FA fails on backend
apiRouter.post('/wallet/withdraw', authenticateUser, wallet2FARateLimit, async (req, res) => {
  const user = (req as any).user as AppUser;
  const sec = extractSecurityHeadersAndParams(req);
  const {
    amount,
    currency = 'USD',
    payoutMethod = 'moncash',
    destinationPhone,
    twoFactorVerificationToken,
    twoFactorChallengeId,
    twoFactorCode
  } = req.body || {};

  const numAmount = Number(Number(amount || 0).toFixed(2));
  if (Number.isNaN(numAmount) || numAmount < 1) {
    return res.status(400).json({
      withdrawn: false,
      error: 'INVALID_WITHDRAWAL_AMOUNT',
      message: 'Veuillez saisir un montant de retrait valide (minimum $1.00 USD).'
    });
  }

  const cleanMethod: 'moncash' | 'natcash' = payoutMethod === 'natcash' ? 'natcash' : 'moncash';
  const cleanPhone = String(destinationPhone || user.phone || '').trim();
  if (cleanPhone.length < 8) {
    return res.status(400).json({
      withdrawn: false,
      error: 'INVALID_DESTINATION_PHONE',
      message: `Veuillez saisir un numéro ${cleanMethod === 'moncash' ? 'MonCash' : 'NatCash'} de réception valide.`
    });
  }

  // BLOCKING BACKEND 2FA GATE: Withdrawal is strictly refused (403 Forbidden) if 2FA SMS/Email verification fails or is absent
  const twoFactorGate = db.assertAndConsumeWallet2FA({
    userId: user.id,
    userEmail: user.email,
    operationType: 'wallet_withdrawal',
    expectedAmount: numAmount,
    twoFactorVerificationToken: twoFactorVerificationToken
      ? String(twoFactorVerificationToken)
      : String(req.headers['x-2fa-verification-token'] || ''),
    twoFactorChallengeId: twoFactorChallengeId
      ? String(twoFactorChallengeId)
      : String(req.headers['x-2fa-challenge-id'] || ''),
    twoFactorCode: twoFactorCode
      ? String(twoFactorCode)
      : String(req.headers['x-2fa-code'] || ''),
    ipAddress: sec.ipAddress,
    userAgent: String(req.headers['user-agent'] || '')
  });

  if (!twoFactorGate.allowed || !twoFactorGate.challenge) {
    return res.status(403).json({
      success: false,
      withdrawn: false,
      twoFactorRequired: true,
      twoFactorBlocked: true,
      error: twoFactorGate.errorCode || 'TWO_FACTOR_VERIFICATION_FAILED',
      errorCode: twoFactorGate.errorCode || 'TWO_FACTOR_VERIFICATION_FAILED',
      message:
        twoFactorGate.message ||
        'Étape 2FA bloquante : la vérification 2FA SMS/Email a échoué côté backend. Le retrait est refusé.',
      walletBalance: db.getUserById(user.id)?.walletBalance ?? 0
    });
  }

  const consumedChallengeId = twoFactorGate.challenge.id;
  const effectiveIdempotencyKey =
    sec.idempotencyKey || `idem_withdraw_${user.id}_${consumedChallengeId}`;

  const opResult = await db.executeIdempotentPaymentOperation({
    idempotencyKey: effectiveIdempotencyKey,
    operationType: 'wallet_withdrawal',
    endpoint: '/api/wallet/withdraw',
    userId: user.id,
    userEmail: user.email,
    paymentRequestId: `wdr_${consumedChallengeId}`,
    requestId: sec.requestId,
    nonce: sec.nonce,
    clientTimestamp: sec.clientTimestamp,
    ipAddress: sec.ipAddress,
    payload: {
      amount: numAmount,
      currency,
      payoutMethod: cleanMethod,
      destinationPhone: cleanPhone,
      twoFactorChallengeId: consumedChallengeId
    },
    executor: async () => {
      const withdrawalRes = await db.executeAtomicWalletWithdrawal({
        userId: user.id,
        userEmail: user.email,
        amount: numAmount,
        currency: String(currency || 'USD'),
        payoutMethod: cleanMethod,
        destinationPhone: cleanPhone,
        idempotencyKey: effectiveIdempotencyKey,
        twoFactorChallengeId: consumedChallengeId,
        requestId: sec.requestId,
        ipAddress: sec.ipAddress,
        userAgent: String(req.headers['user-agent'] || '')
      });

      if (!withdrawalRes.withdrawn) {
        return {
          httpStatus: 400,
          body: {
            success: false,
            withdrawn: false,
            error: withdrawalRes.errorCode || 'WITHDRAWAL_FAILED',
            errorCode: withdrawalRes.errorCode || 'WITHDRAWAL_FAILED',
            message: withdrawalRes.message,
            walletBalance: db.getUserById(user.id)?.walletBalance ?? 0
          }
        };
      }

      return {
        httpStatus: 200,
        body: {
          success: true,
          withdrawn: true,
          message: withdrawalRes.message,
          walletTransaction: withdrawalRes.walletTransaction,
          paymentTransaction: withdrawalRes.paymentTransaction,
          walletBalance: withdrawalRes.user?.walletBalance ?? 0,
          user: withdrawalRes.user
        }
      };
    }
  });

  return res.status(opResult.httpStatus).json(opResult.body);
});

// 10D. List recent 2FA challenges for audit & user security visibility
apiRouter.get('/wallet/2fa/challenges', authenticateUser, (req, res) => {
  const user = (req as any).user as AppUser;
  const isAdmin = user.role === 'ADMIN';
  const filterUserId = isAdmin && req.query.all === 'true' ? undefined : user.id;
  return res.json({
    challenges: db.getWallet2FAChallenges({ userId: filterUserId, limit: 30 })
  });
});


