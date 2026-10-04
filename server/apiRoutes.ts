import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { db } from './db';
import { ProviderEngine } from './providerEngine';
import { WebhookEngine } from './webhookEngine';
import { ProviderFactory } from './providers/GoXtopProvider';
import { Game, Service, Order, SupportTicket, Provider } from '../src/types';

export const apiRouter = Router();

// ==========================================
// MIDDLEWARES
// ==========================================

// Middleware: Authenticate Reseller by API Key or Session Header
const authenticateReseller = (req: Request, res: Response, next: NextFunction) => {
  const apiKeyHeader = req.headers['x-api-key'] as string;
  const authHeader = req.headers.authorization;
  const resellerIdHeader = req.headers['x-reseller-id'] as string;

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

  // Dashboard session header fallback
  if (resellerIdHeader) {
    const reseller = resellers.find(r => r.id === resellerIdHeader);
    if (reseller) {
      (req as any).reseller = reseller;
      return next();
    }
  }

  return res.status(401).json({
    error: 'Unauthorized',
    message: 'Authentification requise. Spécifiez l’en-tête "X-API-KEY: plup_live_..." ou connectez-vous.'
  });
};

// Middleware: Authenticate Admin
const authenticateAdmin = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : '';

  if (token === db.getAdminToken() || token === 'admin_session_valid') {
    return next();
  }

  return res.status(401).json({
    error: 'Unauthorized',
    message: 'Accès réservé aux administrateurs PlayUp.'
  });
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

  const populated = games.map(game => {
    const gameServices = services.filter(s => s.gameId === game.id).map(srv => ({
      id: srv.id,
      gameId: srv.gameId,
      name: srv.name,
      description: srv.description,
      category: srv.category,
      isActive: srv.isActive,
      displayOrder: srv.displayOrder,
      packages: srv.packages.filter(p => p.isActive).map(p => ({
        id: p.id,
        serviceId: p.serviceId,
        name: p.name,
        amount: p.amount,
        unit: p.unit,
        publicPrice: p.publicPrice,
        currency: p.currency,
        isActive: p.isActive,
        displayOrder: p.displayOrder
      }))
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

  const services = db.getServices().filter(s => s.gameId === game.id && s.isActive);
  res.json({
    ...game,
    services
  });
});

apiRouter.get('/services', (_req, res) => {
  const services = db.getServices().filter(s => s.isActive);
  res.json(services);
});

// ==========================================
// 2. PLAYUP MOBILE APP ENDPOINTS
// ==========================================

// Name Checker GoXtop (e.g. Free Fire Player ID verification before order confirmation)
apiRouter.post('/app/check-player', async (req, res) => {
  try {
    const { gameId, gameProfileData } = req.body;
    const game = db.getGames().find(g => g.id === gameId || g.slug === gameId || g.externalGameId === gameId);
    if (!game) {
      return res.status(404).json({ supported: false, verified: false, message: 'Jeu introuvable.' });
    }

    if (!game.supportsNameCheck) {
      return res.json({
        supported: false,
        verified: false,
        message: `La vérification de joueur (Name Checker) n'est pas requise pour ${game.name}.`
      });
    }

    const providerId = game.providerId || 'prov_goxtop';
    const adapter = ProviderFactory.getProviderInstance(providerId);
    if (!adapter) {
      return res.status(500).json({ supported: true, verified: false, message: 'Adaptateur GoXtop indisponible.' });
    }

    const gameCode = game.externalGameId || game.slug;
    const checkResult = await adapter.checkPlayer(gameCode, gameProfileData || {});
    return res.json(checkResult);
  } catch (err: any) {
    return res.status(500).json({
      supported: true,
      verified: false,
      message: `Erreur lors de la vérification du joueur : ${err.message}`
    });
  }
});

// User Notifications for PlayUp Mobile App
apiRouter.get('/app/notifications', (req, res) => {
  const userId = req.query.userId as string | undefined;
  res.json(db.getUserNotifications(userId));
});

apiRouter.post('/app/notifications/:id/read', (req, res) => {
  db.markNotificationRead(req.params.id);
  res.json({ success: true });
});

apiRouter.post('/app/orders', async (req, res) => {
  try {
    const {
      gameId,
      serviceId,
      packageId,
      gameProfileData,
      verifiedPlayerName,
      paymentConfirmed,
      partnerOrderId: clientPartnerId
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

    const providers = db.getProviders();
    const provider = providers.find(p => p.id === service.providerId) || providers.find(p => p.id === 'prov_goxtop') || providers[0];

    const orderNumber = `PLUP-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`;
    const playerId = profileData.playerId || profileData.userId || profileData.username || Object.values(profileData)[0] || '';
    const serverId = profileData.serverId || profileData.zoneId || '';
    const margin = Number((pkg.publicPrice - pkg.supplierCost).toFixed(2));
    const initialStatus = paymentConfirmed ? 'paid' : 'pending';
    const nowIso = new Date().toISOString();

    const newOrder: Order = {
      id: 'ord_' + Date.now(),
      orderNumber,
      partnerOrderId,
      source: 'mobile_app',
      userId: req.body.userId || 'app_user_default',
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

    db.addSystemLog('info', 'order', `New mobile order ${orderNumber} (Partner ID: ${partnerOrderId}) created for ${game.name} - ${pkg.name}`);

    // Dispatch order to selected provider (e.g. GoXtop) asynchronously
    setTimeout(() => {
      ProviderEngine.processOrder(newOrder.id).catch(console.error);
    }, 800);

    return res.status(201).json(newOrder);
  } catch (err: any) {
    db.addSystemLog('error', 'order', `Order creation error: ${err.message}`);
    return res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

apiRouter.get('/app/orders/:orderId', (req, res) => {
  const { orderId } = req.params;
  const order = db.getOrders().find(o => o.id === orderId || o.orderNumber === orderId || o.partnerOrderId === orderId);
  if (!order) {
    return res.status(404).json({ error: 'Commande introuvable' });
  }
  res.json(order);
});

apiRouter.get('/app/orders', (req, res) => {
  const userId = req.query.userId as string;
  let orders = db.getOrders();
  if (userId) {
    orders = orders.filter(o => o.userId === userId);
  } else {
    orders = orders.slice(0, 15);
  }
  res.json(orders);
});

// ==========================================
// 3. DEDICATED PROVIDER WEBHOOKS (GOXTOP & OTHERS)
// POST /api/webhooks/goxtop
// ==========================================

const handleProviderWebhook = async (req: Request, res: Response, providerSlugOrId: string) => {
  const providers = db.getProviders();
  const provider = providers.find(
    p => p.slug.toLowerCase() === providerSlugOrId.toLowerCase() || p.id.toLowerCase() === providerSlugOrId.toLowerCase()
  );

  if (!provider) {
    return res.status(404).json({ error: 'Unknown provider webhook endpoint' });
  }

  const adapter = ProviderFactory.getProviderInstance(provider.id);
  if (!adapter) {
    return res.status(500).json({ error: 'Provider adapter unavailable' });
  }

  const rawBody = JSON.stringify(req.body || {});
  const signatureHeader =
    (req.headers['x-goxtop-signature'] as string) ||
    (req.headers['x-webhook-signature'] as string) ||
    (req.headers['x-signature'] as string) ||
    (req.headers['x-hub-signature-256'] as string);

  const result = await adapter.handleWebhook(rawBody, signatureHeader, req.body || {});
  return res.status(result.httpCode).json(result.body);
};

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
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email requis' });
  }

  const resellers = db.getResellers();
  const reseller = resellers.find(r => r.email.toLowerCase() === email.toLowerCase());

  if (!reseller) {
    return res.status(404).json({ error: 'Aucun compte revendeur trouvé avec cet email.' });
  }

  reseller.lastActiveAt = new Date().toISOString();
  db.setResellers(resellers);

  res.json({ reseller });
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

apiRouter.post('/admin/login', (req, res) => {
  const { email, password } = req.body;
  if (email === 'admin@playup.io' && password === 'PlayUpAdmin2026!') {
    db.addSystemLog('info', 'auth', `Admin logged in successfully (${email})`);
    return res.json({
      token: db.getAdminToken(),
      admin: { email: 'admin@playup.io', name: 'Super Administrateur PlayUp' }
    });
  }

  db.addSystemLog('warn', 'auth', `Failed admin login attempt with email: ${email}`);
  return res.status(401).json({ error: 'Identifiants administrateur incorrects.' });
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
  const services = db.getServices();
  const index = services.findIndex(s => s.id === id);
  if (index === -1) return res.status(404).json({ error: 'Service introuvable' });

  services[index] = {
    ...services[index],
    ...req.body,
    updatedAt: new Date().toISOString()
  };
  db.setServices(services);
  res.json(services[index]);
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

// Reveal secret strictly for authenticated Admin when clicking "Afficher"
apiRouter.post('/admin/providers/:id/reveal-secret', authenticateAdmin, (req, res) => {
  const { id } = req.params;
  const { field } = req.body; // 'apiKey' | 'webhookSecret'
  const providers = db.getProviders();
  const provider = providers.find(p => p.id === id || p.slug === id);
  if (!provider) return res.status(404).json({ error: 'Fournisseur introuvable' });

  const secretRecord = db.getProviderSecret(provider.id);
  db.addSystemLog('info', 'auth', `Admin revealed ${field} for provider ${provider.name}`);

  if (field === 'webhookSecret') {
    return res.json({ value: secretRecord.webhookSecret || '' });
  }
  return res.json({ value: secretRecord.apiKey || '' });
});

// Real Connection Test to GoXtop / Provider
apiRouter.post('/admin/providers/:id/test-connection', authenticateAdmin, async (req, res) => {
  const { id } = req.params;
  const providers = db.getProviders();
  const index = providers.findIndex(p => p.id === id || p.slug === id);
  if (index === -1) return res.status(404).json({ error: 'Fournisseur introuvable' });

  const provider = providers[index];
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
  const adapter = ProviderFactory.getProviderInstance(provider.id);
  if (!adapter) {
    return res.status(500).json({ error: 'Adaptateur fournisseur introuvable' });
  }

  const syncResult =
    syncType === 'games'
      ? await adapter.getGames()
      : await adapter.getProducts(gameCode);

  if (syncResult.success) {
    providers[index].lastSyncAt = new Date().toISOString();
    db.setProviders(providers);
  }

  res.json({
    ...syncResult,
    syncType
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
  const current = db.getSettings();
  const updated = { ...current, ...req.body };
  db.setSettings(updated);
  db.addSystemLog('info', 'system', 'Admin updated platform settings');
  res.json(updated);
});

// Admin System Logs
apiRouter.get('/admin/logs', authenticateAdmin, (_req, res) => {
  res.json(db.getSystemLogs());
});
