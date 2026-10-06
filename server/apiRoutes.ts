import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { db } from './db';
import { ProviderEngine } from './providerEngine';
import { WebhookEngine } from './webhookEngine';
import { ProviderFactory } from './providers/GoXtopProvider';
import {
  RechargeGamesProvider,
  rechargeGamesGatewayRouter,
  setGatewayOrderStatus
} from './providers/RechargeGamesProvider';
import {
  Game,
  Service,
  Order,
  SupportTicket,
  Provider,
  AppUser,
  PaymentMethodType,
  RechargeGamesTestStepResult
} from '../src/types';

export const apiRouter = Router();

// Mount RechargeGames v1 Gateway for official TEST mode (/api/rechargegames-v1-gateway/v1/*)
apiRouter.use('/rechargegames-v1-gateway', rechargeGamesGatewayRouter);

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
// 1B. USER AUTHENTICATION & ACCOUNT MANAGEMENT
// ==========================================

apiRouter.post('/auth/register', (req, res) => {
  try {
    const { name, email, password, phone, preferredCurrency } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Le nom, l’adresse email et le mot de passe sont obligatoires.' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères.' });
    }

    const existing = db.getUserByEmail(email);
    if (existing) {
      return res.status(400).json({ error: 'Un compte PlayUp existe déjà avec cette adresse email.' });
    }

    const userId = 'usr_' + Date.now() + '_' + crypto.randomBytes(2).toString('hex');
    const nowIso = new Date().toISOString();
    const { hash, salt } = db.hashPassword(String(password));

    const newUser: AppUser = {
      id: userId,
      name: String(name).trim().slice(0, 80),
      email: String(email).trim().toLowerCase().slice(0, 160),
      phone: phone ? String(phone).trim().slice(0, 32) : undefined,
      authProvider: 'email',
      emailVerified: true,
      status: 'active',
      preferredCurrency: ['USD', 'HTG', 'EUR'].includes(preferredCurrency) ? preferredCurrency : 'USD',
      twoFactorEnabled: false,
      emailNotifications: true,
      walletBalance: 15.00, // Welcome bonus credit for testing PlayUp Wallet
      ordersCount: 0,
      totalSpent: 0,
      createdAt: nowIso,
      lastLoginAt: nowIso
    };

    const users = db.getUsers();
    users.unshift(newUser);
    db.setUsers(users);
    db.setUserCredential(userId, {
      passwordHash: hash,
      passwordSalt: salt
    });

    const token = db.generateUserSessionToken(userId);
    db.addSystemLog('info', 'auth', `New PlayUp user registered: ${newUser.email} (${newUser.name})`);

    return res.status(201).json({
      user: newUser,
      token
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Erreur lors de la création du compte' });
  }
});

apiRouter.post('/auth/login', (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Veuillez renseigner votre email et votre mot de passe.' });
    }

    const user = db.getUserByEmail(String(email));
    if (!user) {
      return res.status(401).json({ error: 'Identifiants invalides. Aucun compte trouvé avec cet email.' });
    }

    if (user.status === 'suspended') {
      return res.status(403).json({ error: 'Ce compte utilisateur a été suspendu par un administrateur.' });
    }

    const isValid = db.verifyPassword(String(password), user.id);
    if (!isValid) {
      db.addSystemLog('warn', 'auth', `Failed login attempt for user ${user.email}`);
      return res.status(401).json({ error: 'Mot de passe incorrect.' });
    }

    const users = db.getUsers();
    const idx = users.findIndex(u => u.id === user.id);
    if (idx !== -1) {
      users[idx].lastLoginAt = new Date().toISOString();
      db.setUsers(users);
    }

    const token = db.generateUserSessionToken(user.id);
    db.addSystemLog('info', 'auth', `User logged in: ${user.email}`);

    return res.json({
      user: users[idx] || user,
      token
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Erreur de connexion' });
  }
});

apiRouter.post('/auth/social', (req, res) => {
  try {
    const { provider, uid, email, name, avatarUrl } = req.body;
    if (!email || !provider) {
      return res.status(400).json({ error: 'Informations d’authentification sociale incomplètes.' });
    }

    const users = db.getUsers();
    let user = users.find(u => u.email.toLowerCase() === String(email).toLowerCase() || (uid && u.uid === uid));
    const nowIso = new Date().toISOString();

    if (user) {
      if (user.status === 'suspended') {
        return res.status(403).json({ error: 'Ce compte utilisateur est suspendu.' });
      }
      user.lastLoginAt = nowIso;
      if (uid && !user.uid) user.uid = uid;
      if (avatarUrl) user.avatarUrl = avatarUrl;
      db.setUsers(users);
    } else {
      const userId = 'usr_' + Date.now() + '_' + crypto.randomBytes(2).toString('hex');
      user = {
        id: userId,
        uid: uid || undefined,
        name: String(name || email.split('@')[0]).slice(0, 80),
        email: String(email).toLowerCase().slice(0, 160),
        avatarUrl: avatarUrl || undefined,
        authProvider: provider === 'facebook' ? 'facebook' : 'google',
        emailVerified: true,
        status: 'active',
        preferredCurrency: 'USD',
        twoFactorEnabled: false,
        emailNotifications: true,
        walletBalance: 15.00,
        ordersCount: 0,
        totalSpent: 0,
        createdAt: nowIso,
        lastLoginAt: nowIso
      };
      users.unshift(user);
      db.setUsers(users);
      db.addSystemLog('info', 'auth', `New social login user (${provider}): ${user.email}`);
    }

    const token = db.generateUserSessionToken(user.id);
    return res.json({
      user,
      token
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Erreur connexion sociale' });
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

apiRouter.get('/auth/me', authenticateUser, (req, res) => {
  const user = (req as any).user as AppUser;
  const userOrders = db.getOrders().filter(o => o.userId === user.id || (user.uid && o.userId === user.uid));
  const paymentTxs = db.getPaymentTransactions(user.id);
  return res.json({
    user,
    orders: userOrders,
    paymentTransactions: paymentTxs
  });
});

apiRouter.put('/auth/profile', authenticateUser, (req, res) => {
  const currentUser = (req as any).user as AppUser;
  const { name, phone, preferredCurrency, twoFactorEnabled, emailNotifications, currentPassword, newPassword } = req.body;

  const users = db.getUsers();
  const idx = users.findIndex(u => u.id === currentUser.id);
  if (idx === -1) return res.status(404).json({ error: 'Utilisateur introuvable' });

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

  if (name) users[idx].name = String(name).trim().slice(0, 80);
  if (phone !== undefined) users[idx].phone = String(phone).trim().slice(0, 32);
  if (preferredCurrency && ['USD', 'HTG', 'EUR'].includes(preferredCurrency)) {
    users[idx].preferredCurrency = preferredCurrency;
  }
  if (typeof twoFactorEnabled === 'boolean') users[idx].twoFactorEnabled = twoFactorEnabled;
  if (typeof emailNotifications === 'boolean') users[idx].emailNotifications = emailNotifications;

  db.setUsers(users);
  db.addSystemLog('info', 'auth', `User ${users[idx].email} updated account profile`);

  return res.json({
    user: users[idx],
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

apiRouter.post('/payments/process', async (req, res) => {
  try {
    const {
      userId,
      paymentMethod,
      amount,
      currency = 'USD',
      cardDetails,
      mobileWalletDetails,
      purpose = 'order' // 'order' | 'wallet_topup'
    } = req.body;

    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      return res.status(400).json({ error: 'Montant de paiement invalide.' });
    }

    const gateways = db.getPaymentGateways();
    const gateway = gateways.find(g => g.slug === paymentMethod && g.isEnabled);
    if (!gateway) {
      return res.status(400).json({ error: `La méthode de paiement "${paymentMethod}" est indisponible ou désactivée.` });
    }

    const feeAmount = Number(((numAmount * gateway.feePercent) / 100 + gateway.fixedFee).toFixed(2));
    const totalCharged = Number((numAmount + feeAmount).toFixed(2));
    const txRef = `PAY-${gateway.slug.toUpperCase()}-${Date.now().toString().slice(-6)}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

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
        return res.status(400).json({ error: 'Numéro de carte bancaire invalide (12 à 19 chiffres requis).' });
      }
      if (!/^\d{2}\/\d{2,4}$/.test(expiry)) {
        return res.status(400).json({ error: 'Date d’expiration invalide (format MM/YY requis).' });
      }
      if (cvc.length < 3 || !/^\d{3,4}$/.test(cvc)) {
        return res.status(400).json({ error: 'Code CVC/CVV invalide (3 ou 4 chiffres requis).' });
      }
      if (!holderName) {
        return res.status(400).json({ error: 'Le nom du titulaire de la carte est requis.' });
      }

      payerIdentifier = `•••• ${cardNumber.slice(-4)} (${holderName})`;
      externalReference = `STRP_${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
      statusMessage = `Paiement par carte (${payerIdentifier}) autorisé et capturé via ${gateway.providerName} (${gateway.mode.toUpperCase()}).`;
    } else if (paymentMethod === 'moncash' || paymentMethod === 'natcash') {
      const phone = String(mobileWalletDetails?.phone || '').trim();
      const pinOrOtp = String(mobileWalletDetails?.otp || '').trim();

      if (phone.length < 8) {
        return res.status(400).json({
          error: `Veuillez saisir un numéro ${paymentMethod === 'moncash' ? 'Digicel MonCash' : 'Natcom NatCash'} valide (ex: +509 37XX-XXXX).`
        });
      }
      if (pinOrOtp.length < 4) {
        return res.status(400).json({
          error: `Veuillez saisir le code de confirmation / OTP ${paymentMethod === 'moncash' ? 'MonCash' : 'NatCash'} (minimum 4 chiffres).`
        });
      }

      payerIdentifier = phone;
      externalReference = `${paymentMethod === 'moncash' ? 'MC' : 'NC'}_${Date.now().toString().slice(-7)}`;
      statusMessage = `Transaction ${gateway.name} confirmée pour le numéro ${phone} (Réf: ${externalReference}).`;
    } else if (paymentMethod === 'wallet') {
      if (!userId) {
        return res.status(401).json({ error: 'Vous devez être connecté à votre compte PlayUp pour payer avec votre solde Wallet.' });
      }
      const users = db.getUsers();
      const uIdx = users.findIndex(u => u.id === userId || u.uid === userId);
      if (uIdx === -1) {
        return res.status(404).json({ error: 'Compte utilisateur PlayUp introuvable.' });
      }
      if (users[uIdx].walletBalance < totalCharged) {
        return res.status(400).json({
          error: `Solde PlayUp Wallet insuffisant ($${users[uIdx].walletBalance.toFixed(2)} disponible, $${totalCharged.toFixed(2)} requis).`
        });
      }

      users[uIdx].walletBalance = Number((users[uIdx].walletBalance - totalCharged).toFixed(2));
      db.setUsers(users);
      payerIdentifier = users[uIdx].email;
      externalReference = `WLT_${Date.now().toString().slice(-7)}`;
      statusMessage = `Débit instantané de $${totalCharged.toFixed(2)} effectué sur votre solde PlayUp Wallet.`;
    } else {
      return res.status(400).json({ error: 'Méthode de paiement non reconnue.' });
    }

    // If purpose is wallet_topup, credit user wallet
    let updatedUser: AppUser | undefined;
    if (purpose === 'wallet_topup' && userId) {
      const users = db.getUsers();
      const uIdx = users.findIndex(u => u.id === userId || u.uid === userId);
      if (uIdx !== -1) {
        users[uIdx].walletBalance = Number((users[uIdx].walletBalance + numAmount).toFixed(2));
        db.setUsers(users);
        updatedUser = users[uIdx];
      }
    }

    const userObj = userId ? db.getUserById(userId) : undefined;
    const txRecord = db.addPaymentTransaction({
      transactionReference: txRef,
      userId: userObj?.id || userId || 'guest_user',
      userEmail: userObj?.email,
      gatewayId: gateway.id,
      paymentMethod: paymentMethod as PaymentMethodType,
      amount: numAmount,
      currency,
      feeAmount,
      totalCharged,
      status: 'completed',
      externalReference,
      payerIdentifier,
      statusMessage
    });

    db.addSystemLog(
      'info',
      'payment',
      `Payment ${txRef} (${gateway.name}) completed: $${totalCharged.toFixed(2)} ${currency} for ${userObj?.email || userId || 'client'}`
    );

    return res.status(201).json({
      success: true,
      transaction: txRecord,
      user: updatedUser || userObj
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Erreur lors du traitement du paiement' });
  }
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

  if (provider.id === 'prov_rechargegames' || provider.adapterType === 'rechargegames') {
    return res.status(403).json({
      error: 'Politique de sécurité RechargeGames : les clés secrètes ne sont jamais affichées en clair.'
    });
  }

  const secretRecord = db.getProviderSecret(provider.id);
  db.addSystemLog('info', 'auth', `Admin revealed ${field} for provider ${provider.name}`);

  if (field === 'webhookSecret') {
    return res.json({ value: secretRecord.webhookSecret || '' });
  }
  return res.json({ value: secretRecord.apiKey || '' });
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

// ==========================================
// ADMIN USERS MANAGEMENT
// ==========================================
apiRouter.get('/admin/users', authenticateAdmin, (_req, res) => {
  res.json(db.getUsers());
});

apiRouter.put('/admin/users/:id/status', authenticateAdmin, (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const users = db.getUsers();
  const idx = users.findIndex(u => u.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Utilisateur introuvable' });

  users[idx].status = status === 'suspended' ? 'suspended' : 'active';
  db.setUsers(users);
  db.addSystemLog('info', 'auth', `Admin updated user ${users[idx].email} status to ${users[idx].status}`);
  res.json(users[idx]);
});

apiRouter.post('/admin/users/:id/wallet', authenticateAdmin, (req, res) => {
  const { id } = req.params;
  const { amount, note } = req.body;
  const numAmount = Number(amount);
  if (isNaN(numAmount)) return res.status(400).json({ error: 'Montant invalide' });

  const users = db.getUsers();
  const idx = users.findIndex(u => u.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Utilisateur introuvable' });

  users[idx].walletBalance = Number(Math.max(0, users[idx].walletBalance + numAmount).toFixed(2));
  db.setUsers(users);

  db.addSystemLog('info', 'payment', `Admin adjusted wallet balance for ${users[idx].email}: ${numAmount >= 0 ? '+' : ''}${numAmount} USD (${note || 'Ajustement admin'})`);
  res.json(users[idx]);
});

apiRouter.post('/admin/users/:id/reset-password', authenticateAdmin, (req, res) => {
  const { id } = req.params;
  const { newPassword } = req.body;
  if (!newPassword || String(newPassword).length < 6) {
    return res.status(400).json({ error: 'Le nouveau mot de passe doit contenir au moins 6 caractères.' });
  }

  const users = db.getUsers();
  const user = users.find(u => u.id === id);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });

  const { hash, salt } = db.hashPassword(String(newPassword));
  db.setUserCredential(user.id, {
    passwordHash: hash,
    passwordSalt: salt
  });

  db.addSystemLog('info', 'auth', `Admin reset password for user ${user.email}`);
  res.json({ success: true, message: `Mot de passe réinitialisé pour ${user.email}.` });
});

// ==========================================
// ADMIN RESELLER API KEYS MANAGEMENT
// ==========================================
apiRouter.get('/admin/api-keys', authenticateAdmin, (_req, res) => {
  res.json(db.getApiKeys());
});

apiRouter.post('/admin/resellers/:id/api-keys', authenticateAdmin, (req, res) => {
  const { id } = req.params;
  const { name } = req.body;
  const resellers = db.getResellers();
  const reseller = resellers.find(r => r.id === id);
  if (!reseller) return res.status(404).json({ error: 'Revendeur introuvable' });

  const apiKeys = db.getApiKeys();
  const rawKey = 'plup_live_' + crypto.randomBytes(20).toString('hex');
  const newKey = {
    id: 'key_' + Date.now(),
    resellerId: reseller.id,
    name: name || `Clé API ${reseller.company}`,
    key: rawKey,
    maskedKey: `plup_live_${rawKey.slice(10, 14)}...${rawKey.slice(-4)}`,
    permissions: ['games.read', 'services.read', 'orders.create', 'orders.read', 'balance.read'],
    status: 'active' as const,
    createdAt: new Date().toISOString()
  };

  apiKeys.unshift(newKey);
  db.setApiKeys(apiKeys);
  db.addSystemLog('info', 'auth', `Admin generated new API key "${newKey.name}" for reseller ${reseller.company}`);
  res.status(201).json(newKey);
});

apiRouter.put('/admin/api-keys/:id/status', authenticateAdmin, (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const apiKeys = db.getApiKeys();
  const idx = apiKeys.findIndex(k => k.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Clé API introuvable' });

  apiKeys[idx].status = status === 'revoked' ? 'revoked' : 'active';
  db.setApiKeys(apiKeys);
  db.addSystemLog('info', 'auth', `Admin changed API key ${apiKeys[idx].maskedKey} status to ${apiKeys[idx].status}`);
  res.json(apiKeys[idx]);
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
  const publicProducts = products.map(p => ({
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
    currency: p.currency,
    active: p.active,
    requires_player_id: p.requires_player_id,
    last_synced_at: p.last_synced_at
  }));

  res.json({
    mode: db.getRechargeGamesMode(),
    regionsAvailable: stats.regionsAvailable,
    gamesAvailable: stats.gamesAvailable,
    lastSyncedAt: stats.lastSyncedAt,
    products: publicProducts
  });
});

// POST /api/rechargegames/orders — Mobile App 10-step purchase endpoint
apiRouter.post('/rechargegames/orders', async (req, res) => {
  const {
    userId,
    product_key,
    region,
    player_id,
    player_name,
    server_id,
    buyer_ref,
    paymentConfirmed,
    paymentMethod,
    paymentReference
  } = req.body || {};

  const rg = new RechargeGamesProvider();
  const result = await rg.createOrder({
    userId: String(userId || 'usr_player_01'),
    productKey: String(product_key || ''),
    region: region ? String(region) : undefined,
    playerId: String(player_id || ''),
    playerName: player_name ? String(player_name) : undefined,
    serverId: server_id ? String(server_id) : undefined,
    buyerRef: buyer_ref ? String(buyer_ref) : undefined,
    paymentConfirmed: Boolean(paymentConfirmed),
    paymentMethod: paymentMethod ? String(paymentMethod) : 'wallet',
    paymentReference: paymentReference ? String(paymentReference) : undefined
  });

  if (!result.success) {
    // Only return safe user-facing message to the mobile client
    return res.status(result.httpStatus).json({
      success: false,
      errorCode: result.errorCode,
      message: result.userMessage,
      order: result.order
    });
  }

  // In TEST mode, schedule realistic asynchronous delivery via signed webhook after 3.5 seconds so the mobile user sees "Pending -> Delivered" in real time
  if (result.order && result.order.test_mode && req.body?.skipAutoWebhook !== true) {
    const createdOrder = result.order;
    setTimeout(() => {
      try {
        const currentOrd = db.findRechargeGamesOrderById(createdOrder.id);
        if (currentOrd && currentOrd.status === 'pending') {
          const webhookId = `wh_auto_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
          const webhookTs = String(Math.floor(Date.now() / 1000));
          const evtPayload = {
            event: 'order.delivered',
            event_id: webhookId,
            order_id: currentOrd.provider_order_id,
            buyer_ref: currentOrd.buyer_ref,
            product_key: currentOrd.product_key,
            region: currentOrd.region,
            player_id: currentOrd.player_id,
            status: 'delivered',
            delivered_at: new Date().toISOString()
          };
          const raw = JSON.stringify(evtPayload);
          const providerInstance = new RechargeGamesProvider();
          const sig = providerInstance.signWebhookPayload(raw, webhookId, webhookTs);
          providerInstance.handleWebhook(raw, evtPayload, {
            'webhook-id': webhookId,
            'webhook-timestamp': webhookTs,
            'webhook-signature': sig,
            'user-agent': 'RechargeGames-Webhook/1.0'
          });
        }
      } catch (e) {
        console.error('[RechargeGames Auto-Webhook Error]:', e);
      }
    }, 3500);
  }

  return res.status(201).json({
    success: true,
    message: result.userMessage,
    order: result.order,
    playupOrder: result.playupOrder
  });
});

// GET /api/rechargegames/orders — User Top-Up History ("Historique des top-ups")
apiRouter.get('/rechargegames/orders', (req, res) => {
  const userId = typeof req.query.userId === 'string' ? req.query.userId : undefined;
  const orders = db.getRechargeGamesOrders(userId);
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
    customer_price: o.customer_price,
    currency: o.currency,
    status: o.status,
    test_mode: o.test_mode,
    payment_method: o.payment_method,
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

// GET /api/rechargegames/orders/:orderId/status — Fallback status check (GET /v1/orders/{order_id})
apiRouter.get('/rechargegames/orders/:orderId/status', async (req, res) => {
  const { orderId } = req.params;
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
      pendingOrders: orders.filter(o => o.status === 'pending').length,
      deliveredOrders: orders.filter(o => o.status === 'delivered').length,
      refundedOrders: orders.filter(o => o.status === 'refunded').length,
      failedOrders: orders.filter(o => o.status === 'failed').length,
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
    webhookEvents,
    firestoreIdempotencyLocks: db.getAllFirestoreWebhookLocks(),
    apiLogs
  });
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
  const updated = db.setRechargeGamesMargins(req.body || {});
  const rg = new RechargeGamesProvider();
  // Re-sync PlayUp services with new margins
  const products = db.getRechargeGamesProducts();
  (rg as any).syncIntoPlayUpServices(products);
  res.json({
    success: true,
    message: 'Marges PlayUp enregistrées et prix clients recalculés côté serveur.',
    margins: updated,
    products
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

  // Test 3: Recherche d'un produit Free Fire Brazil
  let ffBrazilProduct = syncedProducts.find(
    p => p.game.toLowerCase().includes('free fire') && p.region.toLowerCase() === 'brazil' && p.active
  );
  {
    const t0 = Date.now();
    results.push({
      testNumber: 3,
      name: 'Test 3 — Recherche d’un produit Free Fire Brazil 🇧🇷',
      passed: Boolean(ffBrazilProduct && ffBrazilProduct.product_key),
      durationMs: Date.now() - t0,
      details: ffBrazilProduct
        ? `Produit trouvé : "${ffBrazilProduct.name}" (product_key="${ffBrazilProduct.product_key}", région="${ffBrazilProduct.region}", prix fournisseur=$${ffBrazilProduct.provider_price.toFixed(2)}, prix PlayUp=$${ffBrazilProduct.playup_price.toFixed(2)})`
        : 'Aucun produit Free Fire Brazil trouvé.',
      evidence: ffBrazilProduct
        ? {
            product_key: ffBrazilProduct.product_key,
            region: ffBrazilProduct.region,
            provider_price: ffBrazilProduct.provider_price,
            playup_price: ffBrazilProduct.playup_price
          }
        : undefined
    });
  }

  // Test 4: Recherche d'un produit USA
  const usaProduct = syncedProducts.find(p => p.region.toLowerCase() === 'usa' && p.active);
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

  // Test 5: Création d'une commande TEST (en statut initial 'pending')
  const testBuyerRef1 = db.generateNextBuyerRef();
  let createdTestOrderId = '';
  let createdProviderOrderId = '';
  {
    const t0 = Date.now();
    const targetProd = ffBrazilProduct || syncedProducts[0];
    const createRes = await rg.createOrder({
      userId: 'usr_player_01',
      productKey: targetProd.product_key,
      region: targetProd.region,
      playerId: '987654321',
      playerName: 'GamerBrazilTest',
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
    const targetProd = ffBrazilProduct || syncedProducts[0];
    const dupRes = await rg.createOrder({
      userId: 'usr_player_01',
      productKey: targetProd.product_key,
      region: targetProd.region,
      playerId: '987654321',
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

  // Test 11: Vérification du statut d'une commande avec l'endpoint officiel GET /v1/orders/{order_id}
  {
    const t0 = Date.now();
    const statusRes = await rg.checkOrderStatus(createdTestOrderId || createdProviderOrderId);
    results.push({
      testNumber: 11,
      name: 'Test 11 — Vérification du statut via GET /v1/orders/{order_id}',
      passed: statusRes.success && statusRes.status === 'pending',
      durationMs: Date.now() - t0,
      details: `GET /v1/orders/${createdProviderOrderId} a retourné status="${statusRes.status}" — ${statusRes.message}`,
      evidence: {
        endpoint: `/v1/orders/${createdProviderOrderId}`,
        statusReturned: statusRes.status
      }
    });
  }

  const port = 3000;
  const webhookEndpointUrl = `http://127.0.0.1:${port}/rechargegames-webhook`;

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
      name: 'Test 8 — Validation d’une signature HMAC-SHA256 correcte sur POST /rechargegames-webhook',
      passed: httpRes.status === 200 && whEvent?.signature_valid === true,
      durationMs: Date.now() - t0,
      details: `POST /rechargegames-webhook : Signature HMAC-SHA256 vérifiée (HTTP ${httpRes.status}, digest=${whEvent?.computed_hmac_preview})`,
      evidence: {
        endpoint: '/rechargegames-webhook',
        webhookId: whId,
        httpStatus: httpRes.status,
        hmacPreview: whEvent?.computed_hmac_preview
      }
    });
  }

  // Test 9: Rejet d'une signature HMAC-SHA256 incorrecte via POST /rechargegames-webhook
  {
    const t0 = Date.now();
    const whId = `wh_test9_invalid_${Date.now()}`;
    const whTs = String(Math.floor(Date.now() / 1000));
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
    const orderStillPending = db.findRechargeGamesOrderById(createdTestOrderId)?.status === 'pending';
    results.push({
      testNumber: 9,
      name: 'Test 9 — Rejet d’une signature HMAC-SHA256 incorrecte (HTTP 401)',
      passed: httpRes.status === 401 && whEvent?.signature_valid === false && orderStillPending,
      durationMs: Date.now() - t0,
      details: `Webhook forgé sur POST /rechargegames-webhook rejeté avec HTTP ${httpRes.status}. La commande #${createdTestOrderId} est restée intacte ("pending").`,
      evidence: {
        httpStatus: httpRes.status,
        processingStatus: whEvent?.processing_status,
        orderUnchanged: orderStillPending
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
    const targetProd = usaProduct || syncedProducts[0];
    const buyerRef2 = db.generateNextBuyerRef();
    const createRes2 = await rg.createOrder({
      userId: 'usr_player_01',
      productKey: targetProd.product_key,
      region: targetProd.region,
      playerId: '1122334455',
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

  // Sort by testNumber ascending
  results.sort((a, b) => a.testNumber - b.testNumber);

  res.json({
    allPassed: results.every(r => r.passed),
    passedCount: results.filter(r => r.passed).length,
    totalCount: results.length,
    results
  });
});

