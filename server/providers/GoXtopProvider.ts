import crypto from 'crypto';
import { db, ProviderSecretRecord } from '../db';
import { 
  Provider, ConnectionTestResult, Order, PlayerCheckResult, OrderStatus 
} from '../../src/types';
import { WebhookEngine } from '../webhookEngine';

export interface ProviderSyncResponse {
  success: boolean;
  syncType: 'games' | 'products' | 'prices';
  statusLabel: string;
  httpStatus: number | null;
  latencyMs: number;
  itemsUpdated: number;
  gamesRetrieved?: number;
  productsRetrieved?: number;
  productsAdded?: number;
  productsUpdated?: number;
  productsDeactivated?: number;
  providerErrorMessage?: string;
  details: string;
}

export interface WebhookSignatureCheckResult {
  valid: boolean;
  signatureDetected: boolean;
  signatureHeaderName?: string;
  signatureValueMasked?: string;
  computedHmacPreview?: string;
  hmacValidation: 'Validée' | 'Échec' | 'Non applicable';
  reason?: string;
}

export interface ProviderOrderDispatchResult {
  accepted: boolean;
  status: OrderStatus;
  externalOrderId?: string;
  httpStatus: number | null;
  latencyMs: number;
  rawResponse: any;
  errorMessage?: string;
}

/**
 * Common Modular Provider Abstraction Interface
 * Supports: GoXtopProvider, ProviderB, ProviderC without altering core PlayUp logic.
 */
export interface IGameServiceProvider {
  getGames(): Promise<ProviderSyncResponse>;
  getProducts(gameCode?: string): Promise<ProviderSyncResponse>;
  checkPlayer(gameCode: string, playerData: Record<string, string>): Promise<PlayerCheckResult>;
  createOrder(order: Order, webhookCallbackUrl: string): Promise<ProviderOrderDispatchResult>;
  getOrderStatus(partnerOrderId: string): Promise<{ success: boolean; status?: OrderStatus; providerOrderId?: string; raw?: any; message?: string }>;
  trackOrder(providerOrderId: string): Promise<{ success: boolean; status?: OrderStatus; raw?: any; message?: string }>;
  handleWebhook(rawBody: string, headers: Record<string, any>, payload: any): Promise<{ httpCode: number; body: any }>;
  testConnection(): Promise<ConnectionTestResult>;
}

export abstract class BaseProvider implements IGameServiceProvider {
  protected provider: Provider;
  protected secrets: ProviderSecretRecord;

  constructor(provider: Provider, secrets: ProviderSecretRecord) {
    this.provider = provider;
    this.secrets = secrets;
  }

  public abstract getGames(): Promise<ProviderSyncResponse>;
  public abstract getProducts(gameCode?: string): Promise<ProviderSyncResponse>;
  public abstract checkPlayer(gameCode: string, playerData: Record<string, string>): Promise<PlayerCheckResult>;
  public abstract createOrder(order: Order, webhookCallbackUrl: string): Promise<ProviderOrderDispatchResult>;
  public abstract getOrderStatus(partnerOrderId: string): Promise<{ success: boolean; status?: OrderStatus; providerOrderId?: string; raw?: any; message?: string }>;
  public abstract trackOrder(providerOrderId: string): Promise<{ success: boolean; status?: OrderStatus; raw?: any; message?: string }>;
  public abstract handleWebhook(rawBody: string, headers: Record<string, any>, payload: any): Promise<{ httpCode: number; body: any }>;
  public abstract testConnection(): Promise<ConnectionTestResult>;

  protected buildUrl(pathTemplate: string, replacements?: Record<string, string>): string {
    let base = (this.provider.apiUrl || process.env.GOXTOP_API_BASE_URL || 'https://goxtop.com').trim().replace(/\/+$/, '');
    let resolvedPath = (pathTemplate || '').trim();
    if (replacements) {
      for (const [key, val] of Object.entries(replacements)) {
        resolvedPath = resolvedPath
          .replace(`{${key}}`, encodeURIComponent(val))
          .replace(`:${key}`, encodeURIComponent(val));
      }
    }
    if (resolvedPath.startsWith('http://') || resolvedPath.startsWith('https://')) {
      return resolvedPath;
    }
    // Prevent duplicate /api/v.1/api/v.1 if base URL already includes /api/v.1
    if (base.endsWith('/api/v.1') && resolvedPath.startsWith('/api/v.1')) {
      base = base.slice(0, -'/api/v.1'.length);
    }
    return `${base}${resolvedPath.startsWith('/') ? '' : '/'}${resolvedPath}`;
  }

  protected buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'PlayUp-GoXtopProvider/1.0'
    };

    const headerName = (this.provider.authHeaderName || 'x-api-key').trim();
    if (this.secrets.apiKey) {
      headers[headerName] = this.secrets.apiKey.trim();
    }
    const secretVal = (this.secrets.webhookSecret || process.env.GOXTOP_API_KEY_SECRET || '').trim();
    if (secretVal) {
      headers['x-api-secret'] = secretVal;
    }

    return headers;
  }

  protected buildMaskedHeaders(): Record<string, string> {
    const raw = this.buildHeaders();
    const masked: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      const lower = k.toLowerCase();
      if (lower.includes('key') || lower.includes('secret') || lower.includes('auth') || lower.includes('token')) {
        masked[k] = v.length > 8 ? `${v.slice(0, 4)}••••••••${v.slice(-4)}` : '••••••••';
      } else {
        masked[k] = v;
      }
    }
    return masked;
  }

  /**
   * Detects any signature header sent in the HTTP request without inventing a hardcoded header name,
   * and verifies HMAC-SHA256 on the exact unmodified rawBody when a Webhook Secret is configured.
   * If GoXtop does not provide/configure a Webhook Secret, does NOT block the webhook (returns 'Non applicable').
   */
  public verifyWebhookSignature(rawBody: string, headers: Record<string, any> = {}): WebhookSignatureCheckResult {
    const secret = this.secrets.webhookSecret?.trim();

    // Detect signature header from actual request headers (or configured header name if provided by official docs)
    let detectedHeaderName: string | undefined;
    let signatureValue: string | undefined;

    const configuredHeader = this.provider.webhookSignatureHeaderName?.trim().toLowerCase();
    if (configuredHeader && headers[configuredHeader]) {
      detectedHeaderName = configuredHeader;
      signatureValue = Array.isArray(headers[configuredHeader]) ? headers[configuredHeader][0] : String(headers[configuredHeader]);
    } else {
      for (const [k, v] of Object.entries(headers)) {
        const lowerKey = k.toLowerCase();
        if (lowerKey.includes('signature') || lowerKey.includes('hmac')) {
          detectedHeaderName = k;
          signatureValue = Array.isArray(v) ? v[0] : String(v);
          break;
        }
      }
    }

    const signatureDetected = Boolean(signatureValue && signatureValue.trim().length > 0);
    const cleanSig = signatureValue ? signatureValue.replace(/^(sha256=|hmac-sha256=)/i, '').trim() : '';
    const signatureValueMasked = cleanSig
      ? (cleanSig.length > 16 ? `sha256=${cleanSig.slice(0, 10)}••••${cleanSig.slice(-8)}` : `sha256=${cleanSig}`)
      : undefined;

    // Case B: Secret not provided by GoXtop / not configured -> Do NOT block integration
    if (!secret) {
      return {
        valid: true,
        signatureDetected,
        signatureHeaderName: detectedHeaderName,
        signatureValueMasked,
        hmacValidation: 'Non applicable',
        reason: 'Secret fournisseur : non configuré / non fourni par GoXtop'
      };
    }

    const expectedHex = crypto
      .createHmac('sha256', secret)
      .update(rawBody, 'utf8')
      .digest('hex');
    const expectedBase64 = crypto
      .createHmac('sha256', secret)
      .update(rawBody, 'utf8')
      .digest('base64');
    const computedHmacPreview = `sha256=${expectedHex.slice(0, 10)}••••${expectedHex.slice(-8)}`;

    // Case A: Secret is configured -> Require and validate HMAC-SHA256 signature on unmodified rawBody
    if (!signatureDetected || !signatureValue) {
      return {
        valid: false,
        signatureDetected: false,
        computedHmacPreview,
        hmacValidation: 'Échec',
        reason: 'Secret Webhook configuré mais aucune signature HMAC-SHA256 détectée dans les en-têtes HTTP reçus.'
      };
    }

    try {
      const sigHexBuf = Buffer.from(cleanSig, 'hex');
      const expHexBuf = Buffer.from(expectedHex, 'hex');
      if (sigHexBuf.length === expHexBuf.length && sigHexBuf.length > 0 && crypto.timingSafeEqual(sigHexBuf, expHexBuf)) {
        return {
          valid: true,
          signatureDetected: true,
          signatureHeaderName: detectedHeaderName,
          signatureValueMasked,
          computedHmacPreview,
          hmacValidation: 'Validée'
        };
      }

      const sigB64Buf = Buffer.from(cleanSig, 'utf8');
      const expB64Buf = Buffer.from(expectedBase64, 'utf8');
      if (sigB64Buf.length === expB64Buf.length && crypto.timingSafeEqual(sigB64Buf, expB64Buf)) {
        return {
          valid: true,
          signatureDetected: true,
          signatureHeaderName: detectedHeaderName,
          signatureValueMasked,
          computedHmacPreview,
          hmacValidation: 'Validée'
        };
      }

      return {
        valid: false,
        signatureDetected: true,
        signatureHeaderName: detectedHeaderName,
        signatureValueMasked,
        computedHmacPreview,
        hmacValidation: 'Échec',
        reason: `Signature HMAC-SHA256 invalide (en-tête détecté : ${detectedHeaderName})`
      };
    } catch {
      return {
        valid: false,
        signatureDetected: true,
        signatureHeaderName: detectedHeaderName,
        signatureValueMasked,
        computedHmacPreview,
        hmacValidation: 'Échec',
        reason: 'Format de signature HMAC-SHA256 malformé'
      };
    }
  }

  protected extractProviderErrorMessage(rawText: string, httpStatus: number): string {
    try {
      const parsed = JSON.parse(rawText);
      const msg = parsed.message || parsed.error || parsed.detail || parsed.error_description;
      if (msg) return `HTTP ${httpStatus} — ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`;
    } catch {
      // Not JSON
    }
    const snippet = rawText ? rawText.replace(/\s+/g, ' ').trim().slice(0, 180) : 'Aucun message retourné';
    return `HTTP ${httpStatus} — ${snippet}`;
  }
}

/**
 * Dedicated GoXtopProvider Backend Integration
 * Implements documented endpoints:
 * - GET /api/v.1/games
 * - GET /api/v.1/products/{game}
 * - POST /api/v.1/create
 * - GET /api/v.1/:partner_orderid
 * - POST /api/v.1/:id/track
 */
export class GoXtopProvider extends BaseProvider {
  /**
   * Tests connection to GoXtop using GET /api/v.1/games without creating any real order.
   */
  public async testConnection(): Promise<ConnectionTestResult> {
    const startTime = Date.now();
    const timestamp = new Date().toISOString();
    const gamesPath = this.provider.endpoints?.getGamesPath || '/api/v.1/games';
    const fullUrl = this.buildUrl(gamesPath);
    const maskedHeaders = this.buildMaskedHeaders();
    const reqSummary = JSON.stringify({ method: 'GET', url: fullUrl, headers: maskedHeaders });

    try {
      const parsed = new URL(fullUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('Invalid protocol');
      }
    } catch {
      const res: ConnectionTestResult = {
        success: false,
        code: 'INVALID_URL',
        label: 'URL incorrecte',
        latencyMs: 0,
        endpointCalled: fullUrl,
        details: `L'URL de base ou l'endpoint "${fullUrl}" est invalide.`,
        timestamp,
        authHeadersUsed: maskedHeaders
      };
      this.logApi('TEST_CONNECTION', 'GET', fullUrl, null, 0, res.label, false, reqSummary, res.details);
      return res;
    }

    if (!this.secrets.apiKey || !this.secrets.apiKey.trim()) {
      const res: ConnectionTestResult = {
        success: false,
        code: 'INVALID_API_KEY',
        label: 'API Key invalide',
        latencyMs: 0,
        endpointCalled: fullUrl,
        details: 'Aucune API Key GoXtop enregistrée côté serveur. Configurez-la dans Administration → Fournisseurs → GoXtop.',
        timestamp,
        authHeadersUsed: maskedHeaders
      };
      this.logApi('TEST_CONNECTION', 'GET', fullUrl, null, 0, res.label, false, reqSummary, res.details);
      return res;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(fullUrl, {
        method: 'GET',
        headers: this.buildHeaders(),
        signal: controller.signal
      });
      clearTimeout(timeout);

      const latencyMs = Date.now() - startTime;
      const httpStatus = response.status;
      const contentType = response.headers.get('content-type') || '';
      const rawText = await response.text().catch(() => '');

      if (httpStatus === 401) {
        const res: ConnectionTestResult = {
          success: false,
          code: 'INVALID_API_KEY',
          label: 'API Key invalide',
          httpStatus,
          latencyMs,
          endpointCalled: fullUrl,
          details: 'GoXtop a refusé l’API Key (HTTP 401 Unauthorized).',
          timestamp,
          authHeadersUsed: maskedHeaders,
          responseSnippet: rawText.slice(0, 600)
        };
        this.logApi('TEST_CONNECTION', 'GET', fullUrl, httpStatus, latencyMs, res.label, false, reqSummary, rawText.slice(0, 1500));
        return res;
      }

      if (httpStatus === 403) {
        const res: ConnectionTestResult = {
          success: false,
          code: 'AUTH_ERROR',
          label: 'Erreur d\'authentification',
          httpStatus,
          latencyMs,
          endpointCalled: fullUrl,
          details: 'Accès interdit par GoXtop (HTTP 403 Forbidden). Vérifiez vos permissions ou IP autorisées.',
          timestamp,
          authHeadersUsed: maskedHeaders,
          responseSnippet: rawText.slice(0, 600)
        };
        this.logApi('TEST_CONNECTION', 'GET', fullUrl, httpStatus, latencyMs, res.label, false, reqSummary, rawText.slice(0, 1500));
        return res;
      }

      if (httpStatus === 404) {
        const res: ConnectionTestResult = {
          success: false,
          code: 'INVALID_URL',
          label: 'URL incorrecte',
          httpStatus,
          latencyMs,
          endpointCalled: fullUrl,
          details: `Endpoint introuvable (HTTP 404) sur ${fullUrl}.`,
          timestamp,
          authHeadersUsed: maskedHeaders,
          responseSnippet: rawText.slice(0, 600)
        };
        this.logApi('TEST_CONNECTION', 'GET', fullUrl, httpStatus, latencyMs, res.label, false, reqSummary, rawText.slice(0, 1500));
        return res;
      }

      if (httpStatus >= 200 && httpStatus < 300) {
        let parsedJson: any = null;
        try {
          parsedJson = JSON.parse(rawText);
        } catch {
          const res: ConnectionTestResult = {
            success: false,
            code: 'UNEXPECTED_RESPONSE',
            label: 'Réponse inattendue du fournisseur',
            httpStatus,
            latencyMs,
            endpointCalled: fullUrl,
            details: `HTTP ${httpStatus} reçu mais la réponse n'est pas au format JSON attendu (${contentType || 'HTML/Text'}).`,
            timestamp,
            authHeadersUsed: maskedHeaders,
            responseSnippet: rawText.slice(0, 600)
          };
          this.logApi('TEST_CONNECTION', 'GET', fullUrl, httpStatus, latencyMs, res.label, false, reqSummary, rawText.slice(0, 1500));
          return res;
        }

        if (parsedJson && (parsedJson.error || parsedJson.success === false)) {
          const res: ConnectionTestResult = {
            success: false,
            code: 'CONNECTION_FAILED',
            label: 'Échec de connexion',
            httpStatus,
            latencyMs,
            endpointCalled: fullUrl,
            details: `Erreur retournée par GoXtop : ${parsedJson.message || parsedJson.error}`,
            timestamp,
            authHeadersUsed: maskedHeaders,
            responseSnippet: rawText.slice(0, 600)
          };
          this.logApi('TEST_CONNECTION', 'GET', fullUrl, httpStatus, latencyMs, res.label, false, reqSummary, rawText.slice(0, 1500));
          return res;
        }

        const gamesArray = Array.isArray(parsedJson)
          ? parsedJson
          : (Array.isArray(parsedJson?.data) ? parsedJson.data : (Array.isArray(parsedJson?.games) ? parsedJson.games : []));

        const res: ConnectionTestResult = {
          success: true,
          code: 'SUCCESS',
          label: 'Connexion réussie',
          httpStatus,
          latencyMs,
          endpointCalled: fullUrl,
          details: `Authentification GoXtop validée (HTTP ${httpStatus} OK en ${latencyMs} ms). ${gamesArray.length} jeux actifs détectés dans le catalogue distant.`,
          timestamp,
          authHeadersUsed: maskedHeaders,
          gamesCountDetected: gamesArray.length,
          responseSnippet: rawText.slice(0, 800)
        };
        this.logApi('TEST_CONNECTION', 'GET', fullUrl, httpStatus, latencyMs, res.label, true, reqSummary, rawText.slice(0, 2000));
        return res;
      }

      const res: ConnectionTestResult = {
        success: false,
        code: 'UNEXPECTED_RESPONSE',
        label: 'Réponse inattendue du fournisseur',
        httpStatus,
        latencyMs,
        endpointCalled: fullUrl,
        details: `GoXtop a répondu avec le code HTTP ${httpStatus}.`,
        timestamp,
        authHeadersUsed: maskedHeaders,
        responseSnippet: rawText.slice(0, 600)
      };
      this.logApi('TEST_CONNECTION', 'GET', fullUrl, httpStatus, latencyMs, res.label, false, reqSummary, rawText.slice(0, 1500));
      return res;
    } catch (err: any) {
      clearTimeout(timeout);
      const latencyMs = Date.now() - startTime;
      const res: ConnectionTestResult = {
        success: false,
        code: 'NETWORK_ERROR',
        label: 'Erreur réseau',
        latencyMs,
        endpointCalled: fullUrl,
        details: `Erreur réseau lors de l'appel à ${fullUrl} : ${err.message || 'Impossible de joindre le serveur'}`,
        timestamp,
        authHeadersUsed: maskedHeaders
      };
      this.logApi('TEST_CONNECTION', 'GET', fullUrl, null, latencyMs, res.label, false, reqSummary, res.details);
      return res;
    }
  }

  /**
   * Documented Endpoint: GET /api/v.1/games
   */
  public async getGames(): Promise<ProviderSyncResponse> {
    const startTime = Date.now();
    const gamesPath = this.provider.endpoints?.getGamesPath || '/api/v.1/games';
    const fullUrl = this.buildUrl(gamesPath);
    const reqSummary = JSON.stringify({ method: 'GET', url: fullUrl, headers: this.buildMaskedHeaders() });

    if (!this.secrets.apiKey?.trim()) {
      const msg = 'Synchronisation des jeux refusée : API Key GoXtop manquante.';
      this.logApi('GET_GAMES', 'GET', fullUrl, null, 0, 'API Key invalide', false, reqSummary, msg);
      return {
        success: false,
        syncType: 'games',
        statusLabel: 'API Key invalide',
        httpStatus: null,
        latencyMs: 0,
        itemsUpdated: 0,
        details: msg
      };
    }

    try {
      const response = await fetch(fullUrl, {
        method: 'GET',
        headers: this.buildHeaders()
      });
      const latencyMs = Date.now() - startTime;
      const httpStatus = response.status;
      const rawText = await response.text().catch(() => '');

      if (httpStatus < 200 || httpStatus >= 300) {
        const providerErr = this.extractProviderErrorMessage(rawText, httpStatus);
        const label =
          httpStatus === 401
            ? 'API Key invalide'
            : httpStatus === 403
            ? 'Erreur d\'authentification'
            : httpStatus === 404
            ? 'URL incorrecte'
            : 'Échec de connexion';
        this.logApi('GET_GAMES', 'GET', fullUrl, httpStatus, latencyMs, label, false, reqSummary, rawText.slice(0, 1800) || providerErr);
        return {
          success: false,
          syncType: 'games',
          statusLabel: label,
          httpStatus,
          latencyMs,
          itemsUpdated: 0,
          gamesRetrieved: 0,
          providerErrorMessage: providerErr,
          details: `Échec GET /api/v.1/games : ${providerErr}`
        };
      }

      let parsed: any = null;
      try {
        parsed = JSON.parse(rawText);
      } catch {
        const errDetail = `HTTP ${httpStatus} reçu mais la réponse n'est pas un JSON valide.`;
        this.logApi('GET_GAMES', 'GET', fullUrl, httpStatus, latencyMs, 'Réponse inattendue du fournisseur', false, reqSummary, rawText.slice(0, 1500) || errDetail);
        return {
          success: false,
          syncType: 'games',
          statusLabel: 'Réponse inattendue du fournisseur',
          httpStatus,
          latencyMs,
          itemsUpdated: 0,
          gamesRetrieved: 0,
          providerErrorMessage: errDetail,
          details: errDetail
        };
      }

      const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.data) ? parsed.data : (Array.isArray(parsed.games) ? parsed.games : null));
      if (!list) {
        const errDetail = `Format JSON de GET /api/v.1/games non reconnu : ${rawText.slice(0, 160)}`;
        this.logApi('GET_GAMES', 'GET', fullUrl, httpStatus, latencyMs, 'Réponse inattendue du fournisseur', false, reqSummary, rawText.slice(0, 1500) || errDetail);
        return {
          success: false,
          syncType: 'games',
          statusLabel: 'Réponse inattendue du fournisseur',
          httpStatus,
          latencyMs,
          itemsUpdated: 0,
          gamesRetrieved: 0,
          providerErrorMessage: errDetail,
          details: errDetail
        };
      }

      const games = db.getGames();
      let updatedCount = 0;
      let addedCount = 0;

      for (const gItem of list) {
        const gameCode = String(gItem.gamecode || gItem.code || gItem.slug || gItem.id || gItem.game || '').trim();
        const gameName = String(gItem.Name || gItem.name || gItem.title || gameCode).trim();
        if (!gameCode) continue;

        const rawImage = String(gItem.image || gItem.logo || '').trim();
        const resolvedLogo = rawImage.startsWith('/')
          ? `https://goxtop.com${rawImage}`
          : (rawImage || '/src/assets/images/game_cover_freefire_1790988876938.jpg');

        const existing = games.find(
          g =>
            g.externalGameId?.toLowerCase() === gameCode.toLowerCase() ||
            g.slug.toLowerCase() === gameCode.toLowerCase() ||
            (gameCode === 'freefire_global' && g.id === 'game_ff') ||
            (gameCode === 'mlbb_special' && g.id === 'game_mlbb') ||
            (gameCode === 'codm_sgmy' && g.id === 'game_codm')
        );

        if (existing) {
          existing.externalGameId = gameCode;
          existing.providerId = this.provider.id;
          if (gItem.active !== undefined || gItem.status !== undefined) {
            existing.isActive = gItem.active !== undefined ? Boolean(gItem.active) : String(gItem.status).toLowerCase() === 'active';
          }
          existing.updatedAt = new Date().toISOString();
          updatedCount++;
        } else {
          games.push({
            id: 'game_' + gameCode.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
            slug: gameCode.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            name: gameName,
            externalGameId: gameCode,
            providerId: this.provider.id,
            supportsNameCheck: Boolean(gItem.name_check || gItem.supports_name_check),
            requiresPlayerId: gItem.requires_player_id !== undefined ? Boolean(gItem.requires_player_id) : !gameCode.includes('pin') && !gameCode.includes('gift-card'),
            category: gItem.category || 'Gaming Top-Up',
            description: gItem.description || `Service officiel ${gameName} via GoXtop (${gItem.totalProducts || 0} packs disponibles)`,
            logo: resolvedLogo,
            banner: resolvedLogo,
            isActive: true,
            displayOrder: games.length + 1,
            fields: Array.isArray(gItem.fields)
              ? gItem.fields.map((f: any, idx: number) => ({
                  id: `f_${gameCode}_${idx}`,
                  name: typeof f === 'string' ? f : (f.name || 'playerId'),
                  label: typeof f === 'string' ? f : (f.label || f.name || 'Player ID'),
                  placeholder: '',
                  type: 'text' as const,
                  required: true
                }))
              : [
                  {
                    id: `f_${gameCode}_uid`,
                    name: 'playerId',
                    label: 'Player ID (User ID)',
                    placeholder: 'Entrez votre Player ID',
                    type: 'text',
                    required: true
                  }
                ],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          });
          addedCount++;
        }
      }

      db.setGames(games);
      const totalGames = updatedCount + addedCount;
      this.logApi('GET_GAMES', 'GET', fullUrl, httpStatus, latencyMs, 'Connexion réussie', true, reqSummary, rawText.slice(0, 2200));

      return {
        success: true,
        syncType: 'games',
        statusLabel: 'Connexion réussie',
        httpStatus,
        latencyMs,
        itemsUpdated: totalGames,
        gamesRetrieved: list.length,
        productsAdded: addedCount,
        productsUpdated: updatedCount,
        details: `${list.length} jeux récupérés depuis GET /api/v.1/games (${addedCount} nouveaux, ${updatedCount} mis à jour).`
      };
    } catch (err: any) {
      const latencyMs = Date.now() - startTime;
      this.logApi('GET_GAMES', 'GET', fullUrl, null, latencyMs, 'Erreur réseau', false, reqSummary, err.message);
      return {
        success: false,
        syncType: 'games',
        statusLabel: 'Erreur réseau',
        httpStatus: null,
        latencyMs,
        itemsUpdated: 0,
        details: `Erreur lors de l'appel à GET /api/v.1/games : ${err.message}`
      };
    }
  }

  /**
   * Documented Endpoint: GET /api/v.1/products/{game}
   * Synchronizes products and supplier costs while preserving PlayUp margin and selling price:
   * PlayUp Selling Price = GoXtop Cost + PlayUp Margin
   */
  public async getProducts(gameCode?: string): Promise<ProviderSyncResponse> {
    const startTime = Date.now();
    const allGames = db.getGames().filter(g => !gameCode || g.externalGameId === gameCode || g.slug === gameCode || g.id === gameCode);
    // Prioritize top featured games when syncing without a specific gameCode so synchronization stays fast (< 3s)
    const games = gameCode
      ? allGames
      : allGames
          .slice()
          .sort((a, b) => (a.displayOrder || 999) - (b.displayOrder || 999))
          .slice(0, 12);

    if (!this.secrets.apiKey?.trim()) {
      const msg = 'Synchronisation des produits refusée : API Key GoXtop manquante.';
      const sampleUrl = this.buildUrl(this.provider.endpoints?.getProductsPath || '/api/v.1/products/{game}', { game: gameCode || 'freefire_global' });
      this.logApi('GET_PRODUCTS', 'GET', sampleUrl, null, 0, 'API Key invalide', false, msg);
      return {
        success: false,
        syncType: 'products',
        statusLabel: 'API Key invalide',
        httpStatus: null,
        latencyMs: 0,
        itemsUpdated: 0,
        details: msg
      };
    }

    let productsRetrieved = 0;
    let productsAdded = 0;
    let productsUpdated = 0;
    let productsDeactivated = 0;
    let lastStatus: number | null = null;
    let lastErrorMsg: string | undefined;
    const services = db.getServices();
    const fullGamesList = db.getGames();

    for (const game of games) {
      const gCode = game.externalGameId || game.slug;
      const productsPath = this.provider.endpoints?.getProductsPath || '/api/v.1/products/{game}';
      const fullUrl = this.buildUrl(productsPath, { game: gCode });
      const reqSummary = JSON.stringify({ method: 'GET', url: fullUrl, gameCode: gCode, headers: this.buildMaskedHeaders() });

      try {
        const response = await fetch(fullUrl, {
          method: 'GET',
          headers: this.buildHeaders()
        });
        lastStatus = response.status;
        const rawText = await response.text().catch(() => '');

        if (response.status < 200 || response.status >= 300) {
          const provErr = this.extractProviderErrorMessage(rawText, response.status);
          lastErrorMsg = provErr;
          const label =
            response.status === 401
              ? 'API Key invalide'
              : response.status === 403
              ? 'Erreur d\'authentification'
              : response.status === 404
              ? 'URL incorrecte'
              : 'Échec de connexion';
          this.logApi('GET_PRODUCTS', 'GET', fullUrl, response.status, Date.now() - startTime, label, false, reqSummary, rawText.slice(0, 1800) || provErr);
          continue;
        }

        const parsed = JSON.parse(rawText);
        const prodList = Array.isArray(parsed)
          ? parsed
          : (Array.isArray(parsed.data) ? parsed.data : (Array.isArray(parsed.products) ? parsed.products : []));

        productsRetrieved += prodList.length;

        let service = services.find(s => s.gameId === game.id);
        if (!service && prodList.length > 0) {
          service = {
            id: 'srv_' + game.slug,
            gameId: game.id,
            externalGameId: gCode,
            name: `${game.name} Top-Up`,
            description: `Services officiels ${game.name} synchronisés depuis GoXtop`,
            category: 'diamonds',
            providerId: this.provider.id,
            isActive: true,
            displayOrder: services.length + 1,
            packages: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
          services.push(service);
        }

        if (!service) continue;
        service.externalGameId = gCode;

        if (prodList.length > 0) {
          const validExtIds = new Set(
            prodList
              .map((pItem: any) => String(pItem.Pack || pItem.pack || pItem.id || pItem.product_id || pItem.code || pItem.sku || pItem.name || '').trim())
              .filter(Boolean)
          );
          // Remove legacy initial placeholder packages that don't match real GoXtop Pack codes
          service.packages = service.packages.filter(pkg => !pkg.externalProductId || validExtIds.has(pkg.externalProductId));
        }

        for (const pItem of prodList) {
          const extProdId = String(pItem.Pack || pItem.pack || pItem.id || pItem.product_id || pItem.code || pItem.sku || pItem.name || '').trim();
          const goxtopCost = Number(pItem.price ?? pItem.cost ?? pItem.amount_price ?? NaN);
          const available =
            pItem.stockStatus !== undefined
              ? String(pItem.stockStatus).toLowerCase() === 'in_stock'
              : pItem.available !== undefined
              ? Boolean(pItem.available)
              : pItem.status
              ? String(pItem.status).toLowerCase() === 'active'
              : true;

          if (!extProdId) continue;

          const reqUserId = pItem.requiresUserId !== undefined ? Boolean(pItem.requiresUserId) : (game.requiresPlayerId ?? true);
          const reqServerId = Boolean(pItem.requiresServerId);
          const reqCharName = Boolean(pItem.requiresCharName);

          // Ensure parent game has zoneId/serverId field if GoXtop requires it
          const dbGame = fullGamesList.find(gf => gf.id === game.id);
          if (dbGame && reqServerId && !dbGame.fields.some(f => f.name === 'serverId' || f.name === 'zoneId')) {
            dbGame.fields.push({
              id: `f_${gCode}_server`,
              name: 'serverId',
              label: 'Server ID / Zone ID',
              placeholder: 'Entrez votre Server / Zone ID',
              type: 'text',
              required: true
            });
          }

          const requiredFields: string[] = [];
          if (reqUserId) {
            const uidField = dbGame?.fields.find(f => f.name === 'playerId' || f.name === 'characterId' || f.name === 'userId');
            requiredFields.push(uidField ? uidField.name : 'playerId');
          }
          if (reqServerId) {
            const srvField = dbGame?.fields.find(f => f.name === 'zoneId' || f.name === 'serverId');
            requiredFields.push(srvField ? srvField.name : 'serverId');
          }
          if (reqCharName) {
            requiredFields.push('playerName');
          }

          const rawName = String(pItem.name || pItem.title || extProdId).trim();
          const parsedNumericAmount = parseInt(rawName.replace(/[^0-9]/g, ''), 10);
          const numericAmount = !isNaN(parsedNumericAmount) && parsedNumericAmount > 0 ? parsedNumericAmount : Number(pItem.amount || pItem.quantity || 1);
          const unitLabel = service.category === 'uc' ? 'UC' : 'Diamonds';
          const displayName = /^\d+$/.test(rawName) ? `${rawName} ${unitLabel}` : rawName;

          const existingPkg = service.packages.find(
            pkg =>
              pkg.externalProductId === extProdId ||
              pkg.id === extProdId ||
              (pkg.amount === numericAmount && /^\d+$/.test(rawName))
          );

          if (existingPkg) {
            existingPkg.externalProductId = extProdId;
            existingPkg.externalGameId = gCode;
            existingPkg.requiresPlayerId = reqUserId;
            if (requiredFields.length > 0) {
              existingPkg.requiredFields = requiredFields;
            }
            if (!isNaN(goxtopCost) && goxtopCost > 0) {
              existingPkg.supplierCost = Number(goxtopCost.toFixed(3));
              const currentMargin =
                typeof existingPkg.margin === 'number' && existingPkg.margin > 0
                  ? existingPkg.margin
                  : Number((goxtopCost * 0.25).toFixed(2));
              existingPkg.margin = currentMargin;
              existingPkg.publicPrice = Number((existingPkg.supplierCost + existingPkg.margin).toFixed(2));
              existingPkg.resellerPrice = Number((existingPkg.supplierCost + existingPkg.margin * 0.5).toFixed(2));
            }
            if (!available && existingPkg.isActive) {
              productsDeactivated++;
            }
            existingPkg.isActive = available;
            productsUpdated++;
          } else if (!isNaN(goxtopCost) && goxtopCost > 0) {
            const defaultMargin = Number(Math.max(0.15, goxtopCost * 0.25).toFixed(2));
            service.packages.push({
              id: `pkg_${extProdId.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
              serviceId: service.id,
              externalProductId: extProdId,
              externalGameId: gCode,
              name: displayName,
              amount: numericAmount,
              unit: String(pItem.unit || unitLabel),
              supplierCost: Number(goxtopCost.toFixed(3)),
              margin: defaultMargin,
              publicPrice: Number((goxtopCost + defaultMargin).toFixed(2)),
              resellerPrice: Number((goxtopCost + defaultMargin * 0.5).toFixed(2)),
              currency: 'USD',
              isActive: available,
              requiresPlayerId: reqUserId,
              requiredFields: requiredFields.length > 0 ? requiredFields : game.fields.map(f => f.name),
              displayOrder: service.packages.length + 1
            });
            if (!available) productsDeactivated++;
            productsAdded++;
          }
        }

        this.logApi('GET_PRODUCTS', 'GET', fullUrl, response.status, Date.now() - startTime, 'Connexion réussie', true, reqSummary, rawText.slice(0, 2200));
      } catch (err: any) {
        lastErrorMsg = `Erreur réseau : ${err.message}`;
        this.logApi('GET_PRODUCTS', 'GET', fullUrl, null, Date.now() - startTime, 'Erreur réseau', false, reqSummary, err.message);
      }
    }

    db.setGames(fullGamesList);
    db.setServices(services);
    const totalLatency = Date.now() - startTime;
    const totalUpdated = productsAdded + productsUpdated;

    return {
      success: totalUpdated > 0,
      syncType: 'products',
      statusLabel: totalUpdated > 0 ? 'Connexion réussie' : (lastStatus === 401 ? 'API Key invalide' : 'Échec de connexion'),
      httpStatus: lastStatus,
      latencyMs: totalLatency,
      itemsUpdated: totalUpdated,
      gamesRetrieved: games.length,
      productsRetrieved,
      productsAdded,
      productsUpdated,
      productsDeactivated,
      providerErrorMessage: totalUpdated === 0 ? lastErrorMsg : undefined,
      details:
        totalUpdated > 0
          ? `${productsRetrieved} produits récupérés (${productsAdded} ajoutés, ${productsUpdated} mis à jour, ${productsDeactivated} désactivés).`
          : `Échec de synchronisation GET /api/v.1/products/{game} : ${lastErrorMsg || 'Aucun produit retourné par GoXtop.'}`
    };
  }

  /**
   * Name Checker GoXtop (e.g. Free Fire Player ID -> Player Name lookup before order confirmation)
   */
  public async checkPlayer(gameCode: string, playerData: Record<string, string>): Promise<PlayerCheckResult> {
    const startTime = Date.now();
    const checkPath = (this.provider.endpoints?.checkPlayerPath || '').trim();

    if (!checkPath || checkPath === 'REQUIRES GOXTOP DOCUMENTATION') {
      return {
        supported: false,
        verified: false,
        requiresDocumentation: true,
        message: 'REQUIRES GOXTOP DOCUMENTATION : L’endpoint exact du Name Checker GoXtop doit être renseigné dans Admin → Settings → Providers → GoXtop.'
      };
    }

    if (!this.secrets.apiKey?.trim()) {
      return {
        supported: true,
        verified: false,
        message: 'Vérification impossible : API Key GoXtop non configurée côté serveur.'
      };
    }

    const playerId = playerData.playerId || playerData.userId || playerData.characterId || '';
    const serverId = playerData.serverId || playerData.zoneId || '';
    const fullUrl = this.buildUrl(checkPath, { game: gameCode, player_id: playerId });

    try {
      const response = await fetch(fullUrl, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify({
          game: gameCode,
          player_id: playerId,
          server_id: serverId || undefined,
          ...playerData
        })
      });

      const latencyMs = Date.now() - startTime;
      const rawText = await response.text().catch(() => '');
      let parsed: any = null;
      try {
        parsed = JSON.parse(rawText);
      } catch {
        parsed = null;
      }

      if (response.status >= 200 && response.status < 300 && parsed) {
        const resolvedName = parsed.player_name || parsed.nickname || parsed.username || parsed.name || parsed.data?.nickname || parsed.data?.name;
        if (resolvedName) {
          this.logApi('CHECK_PLAYER', 'POST', fullUrl, response.status, latencyMs, 'Connexion réussie', true, JSON.stringify({ game: gameCode, player_id: playerId }), `Joueur vérifié: ${resolvedName}`);
          return {
            supported: true,
            verified: true,
            playerName: String(resolvedName),
            message: `Joueur confirmé par GoXtop : ${resolvedName}`
          };
        }
      }

      this.logApi('CHECK_PLAYER', 'POST', fullUrl, response.status, latencyMs, 'Échec de connexion', false, JSON.stringify({ game: gameCode, player_id: playerId }), rawText.slice(0, 200));
      return {
        supported: true,
        verified: false,
        message: parsed?.message || parsed?.error || `Impossible de vérifier le Player ID auprès de GoXtop (HTTP ${response.status}).`
      };
    } catch (err: any) {
      this.logApi('CHECK_PLAYER', 'POST', fullUrl, null, Date.now() - startTime, 'Erreur réseau', false, undefined, err.message);
      return {
        supported: true,
        verified: false,
        message: `Erreur réseau lors de la vérification du joueur : ${err.message}`
      };
    }
  }

  /**
   * Documented Endpoint: GET /api/v.1/:partner_orderid
   * Checks the status of an order on GoXtop using PlayUp's unique partner_orderid
   */
  public async getOrderStatus(partnerOrderId: string): Promise<{
    success: boolean;
    status?: OrderStatus;
    providerOrderId?: string;
    raw?: any;
    message?: string;
  }> {
    const startTime = Date.now();
    const statusPath = this.provider.endpoints?.orderStatusPath || '/api/v.1/:partner_orderid';
    const fullUrl = this.buildUrl(statusPath, { partner_orderid: partnerOrderId });

    if (!this.secrets.apiKey?.trim()) {
      return { success: false, message: 'API Key GoXtop non configurée' };
    }

    try {
      const response = await fetch(fullUrl, {
        method: 'GET',
        headers: this.buildHeaders()
      });
      const latencyMs = Date.now() - startTime;
      const rawText = await response.text().catch(() => '');

      if (response.status < 200 || response.status >= 300) {
        this.logApi('GET_ORDER_STATUS', 'GET', fullUrl, response.status, latencyMs, 'Échec de connexion', false, undefined, rawText.slice(0, 200), undefined, partnerOrderId);
        return { success: false, message: `HTTP ${response.status}` };
      }

      const parsed = JSON.parse(rawText);
      const remoteStatus = String(parsed.status || parsed.data?.status || '').toLowerCase();
      const providerOrderId = String(parsed.id || parsed.order_id || parsed.data?.id || '');

      let mappedStatus: OrderStatus = 'processing';
      if (['completed', 'success', 'delivered'].includes(remoteStatus)) mappedStatus = 'completed';
      else if (['failed', 'error', 'rejected'].includes(remoteStatus)) mappedStatus = 'failed';
      else if (['cancelled', 'canceled'].includes(remoteStatus)) mappedStatus = 'cancelled';
      else if (['refunded'].includes(remoteStatus)) mappedStatus = 'refunded';

      this.logApi('GET_ORDER_STATUS', 'GET', fullUrl, response.status, latencyMs, 'Connexion réussie', true, undefined, rawText.slice(0, 200), undefined, partnerOrderId);

      return {
        success: true,
        status: mappedStatus,
        providerOrderId: providerOrderId || undefined,
        raw: parsed
      };
    } catch (err: any) {
      this.logApi('GET_ORDER_STATUS', 'GET', fullUrl, null, Date.now() - startTime, 'Erreur réseau', false, undefined, err.message, undefined, partnerOrderId);
      return { success: false, message: err.message };
    }
  }

  /**
   * Documented Endpoint: POST /api/v.1/:id/track
   */
  public async trackOrder(providerOrderId: string): Promise<{
    success: boolean;
    status?: OrderStatus;
    raw?: any;
    message?: string;
  }> {
    const startTime = Date.now();
    const trackPath = this.provider.endpoints?.trackOrderPath || '/api/v.1/:id/track';
    const fullUrl = this.buildUrl(trackPath, { id: providerOrderId });

    if (!this.secrets.apiKey?.trim()) {
      return { success: false, message: 'API Key GoXtop non configurée' };
    }

    try {
      const response = await fetch(fullUrl, {
        method: 'POST',
        headers: this.buildHeaders()
      });
      const latencyMs = Date.now() - startTime;
      const rawText = await response.text().catch(() => '');

      if (response.status < 200 || response.status >= 300) {
        this.logApi('TRACK_ORDER', 'POST', fullUrl, response.status, latencyMs, 'Échec de connexion', false, undefined, rawText.slice(0, 200), providerOrderId);
        return { success: false, message: `HTTP ${response.status}` };
      }

      const parsed = JSON.parse(rawText);
      const remoteStatus = String(parsed.status || parsed.data?.status || '').toLowerCase();

      let mappedStatus: OrderStatus = 'processing';
      if (['completed', 'success', 'delivered'].includes(remoteStatus)) mappedStatus = 'completed';
      else if (['failed', 'error', 'rejected'].includes(remoteStatus)) mappedStatus = 'failed';
      else if (['refunded'].includes(remoteStatus)) mappedStatus = 'refunded';

      this.logApi('TRACK_ORDER', 'POST', fullUrl, response.status, latencyMs, 'Connexion réussie', true, undefined, rawText.slice(0, 200), providerOrderId);

      return {
        success: true,
        status: mappedStatus,
        raw: parsed
      };
    } catch (err: any) {
      this.logApi('TRACK_ORDER', 'POST', fullUrl, null, Date.now() - startTime, 'Erreur réseau', false, undefined, err.message, providerOrderId);
      return { success: false, message: err.message };
    }
  }

  /**
   * Documented Endpoint: POST /api/v.1/create
   * Includes strict idempotency protection:
   * Checks provider_orders and GET /api/v.1/:partner_orderid before creating a new order on GoXtop.
   */
  public async createOrder(order: Order, webhookCallbackUrl: string): Promise<ProviderOrderDispatchResult> {
    const startTime = Date.now();
    const createPath = this.provider.endpoints?.createOrderPath || '/api/v.1/create';
    const fullUrl = this.buildUrl(createPath);

    // 1. Idempotency Check: Check if a provider_order with this partner_order_id was already sent
    const existingProviderOrder = db.findProviderOrderByPartnerId(order.partnerOrderId);
    if (existingProviderOrder && (existingProviderOrder.status === 'processing' || existingProviderOrder.status === 'completed')) {
      // Query status on GoXtop before attempting anything
      const statusCheck = await this.getOrderStatus(order.partnerOrderId);
      if (statusCheck.success && statusCheck.status) {
        db.upsertProviderOrder({
          ...existingProviderOrder,
          status: statusCheck.status,
          provider_order_id: statusCheck.providerOrderId || existingProviderOrder.provider_order_id,
          response_payload: statusCheck.raw || existingProviderOrder.response_payload,
          updated_at: new Date().toISOString()
        });
        return {
          accepted: statusCheck.status !== 'failed',
          status: statusCheck.status,
          externalOrderId: statusCheck.providerOrderId || existingProviderOrder.provider_order_id,
          httpStatus: 200,
          latencyMs: Date.now() - startTime,
          rawResponse: statusCheck.raw || existingProviderOrder.response_payload
        };
      }

      // Already in flight: never create duplicate order on GoXtop
      return {
        accepted: true,
        status: existingProviderOrder.status,
        externalOrderId: existingProviderOrder.provider_order_id,
        httpStatus: 200,
        latencyMs: 0,
        rawResponse: existingProviderOrder.response_payload
      };
    }

    if (!this.secrets.apiKey || !this.secrets.apiKey.trim()) {
      const errMsg = 'Impossible d’exécuter POST /api/v.1/create : API Key GoXtop non configurée côté serveur.';
      db.upsertProviderOrder({
        id: existingProviderOrder?.id || 'pord_' + Date.now(),
        playup_order_id: order.orderNumber,
        provider: this.provider.name,
        provider_order_id: '',
        partner_order_id: order.partnerOrderId,
        request_payload: { partner_orderid: order.partnerOrderId, endpoint: createPath },
        response_payload: { error: 'MISSING_API_KEY' },
        status: 'failed',
        error_message: errMsg,
        created_at: existingProviderOrder?.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
      this.logApi('CREATE_ORDER', 'POST', fullUrl, null, 0, 'API Key invalide', false, JSON.stringify({ partner_orderid: order.partnerOrderId }), errMsg, order.orderNumber, order.partnerOrderId);

      return {
        accepted: false,
        status: 'failed',
        httpStatus: null,
        latencyMs: 0,
        rawResponse: { error: 'MISSING_GOXTOP_API_KEY', message: errMsg },
        errorMessage: errMsg
      };
    }

    // Build payload for POST /api/v.1/create
    const customEntries: Record<string, string> = {};
    for (const cp of this.provider.customParams || []) {
      if (cp.key.trim()) {
        customEntries[cp.key.trim()] = cp.value;
      }
    }

    const resolvedUserId =
      order.playerId ||
      order.gameProfileData?.playerId ||
      order.gameProfileData?.characterId ||
      order.gameProfileData?.userId ||
      order.gameProfileData?.username ||
      '';
    const resolvedServerId =
      order.serverId ||
      order.gameProfileData?.serverId ||
      order.gameProfileData?.zoneId ||
      '';
    const resolvedCharName =
      order.verifiedPlayerName ||
      order.gameProfileData?.playerName ||
      order.gameProfileData?.charname ||
      '';

    const requestPayload: Record<string, any> = {
      game: order.externalGameId || order.gameId,
      denom: order.externalProductId || order.packageId,
      userid: resolvedUserId,
      ...(resolvedServerId ? { serverid: resolvedServerId } : {}),
      ...(resolvedCharName ? { charname: resolvedCharName } : {}),
      partner_webhook_url: webhookCallbackUrl,
      partner_orderid: order.partnerOrderId,
      ...customEntries
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(fullUrl, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(requestPayload),
        signal: controller.signal
      });
      clearTimeout(timeout);

      const latencyMs = Date.now() - startTime;
      const httpStatus = response.status;
      const rawText = await response.text().catch(() => '');

      let parsed: any = null;
      try {
        parsed = JSON.parse(rawText);
      } catch {
        parsed = { raw: rawText.slice(0, 300) };
      }

      if (httpStatus >= 200 && httpStatus < 300 && parsed && !parsed.error && parsed.success !== false) {
        const providerOrderId = String(parsed.id || parsed.order_id || parsed.goxtop_order_id || `GOX-${Date.now()}`);
        const remoteStatusRaw = String(parsed.status || 'processing').toLowerCase();
        const mappedStatus: OrderStatus =
          ['completed', 'success', 'delivered'].includes(remoteStatusRaw)
            ? 'completed'
            : ['failed', 'error', 'rejected'].includes(remoteStatusRaw)
            ? 'failed'
            : 'processing';

        db.upsertProviderOrder({
          id: existingProviderOrder?.id || 'pord_' + Date.now(),
          playup_order_id: order.orderNumber,
          provider: this.provider.name,
          provider_order_id: providerOrderId,
          partner_order_id: order.partnerOrderId,
          request_payload: requestPayload,
          response_payload: parsed,
          status: mappedStatus,
          created_at: existingProviderOrder?.created_at || new Date().toISOString(),
          updated_at: new Date().toISOString()
        });

        this.logApi(
          'CREATE_ORDER',
          'POST',
          fullUrl,
          httpStatus,
          latencyMs,
          'Connexion réussie',
          true,
          JSON.stringify(requestPayload),
          rawText.slice(0, 250),
          order.orderNumber,
          order.partnerOrderId
        );

        return {
          accepted: mappedStatus !== 'failed',
          status: mappedStatus,
          externalOrderId: providerOrderId,
          httpStatus,
          latencyMs,
          rawResponse: parsed
        };
      }

      const errMsg = parsed?.message || parsed?.error || `GoXtop HTTP ${httpStatus}`;
      db.upsertProviderOrder({
        id: existingProviderOrder?.id || 'pord_' + Date.now(),
        playup_order_id: order.orderNumber,
        provider: this.provider.name,
        provider_order_id: '',
        partner_order_id: order.partnerOrderId,
        request_payload: requestPayload,
        response_payload: parsed,
        status: 'failed',
        error_message: errMsg,
        created_at: existingProviderOrder?.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      this.logApi(
        'CREATE_ORDER',
        'POST',
        fullUrl,
        httpStatus,
        latencyMs,
        httpStatus === 401 ? 'API Key invalide' : 'Échec de connexion',
        false,
        JSON.stringify(requestPayload),
        rawText.slice(0, 250),
        order.orderNumber,
        order.partnerOrderId
      );

      return {
        accepted: false,
        status: 'failed',
        httpStatus,
        latencyMs,
        rawResponse: parsed,
        errorMessage: errMsg
      };
    } catch (err: any) {
      clearTimeout(timeout);
      const latencyMs = Date.now() - startTime;
      const errMsg = `Erreur réseau lors de POST /api/v.1/create : ${err.message}`;

      db.upsertProviderOrder({
        id: existingProviderOrder?.id || 'pord_' + Date.now(),
        playup_order_id: order.orderNumber,
        provider: this.provider.name,
        provider_order_id: '',
        partner_order_id: order.partnerOrderId,
        request_payload: requestPayload,
        response_payload: { error: errMsg },
        status: 'failed',
        error_message: errMsg,
        created_at: existingProviderOrder?.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      this.logApi(
        'CREATE_ORDER',
        'POST',
        fullUrl,
        null,
        latencyMs,
        'Erreur réseau',
        false,
        JSON.stringify(requestPayload),
        errMsg,
        order.orderNumber,
        order.partnerOrderId
      );

      return {
        accepted: false,
        status: 'failed',
        httpStatus: null,
        latencyMs,
        rawResponse: { error: errMsg },
        errorMessage: errMsg
      };
    }
  }

  /**
   * Handles incoming GoXtop Webhook with:
   * - Unmodified rawBody HMAC-SHA256 verification (or Non applicable when GoXtop does not provide a secret)
   * - Dedicated handling for internal "TEST_WEBHOOK" diagnostic event (never creates order or debits balance)
   * - Duplicate event rejection (idempotent)
   * - Confirmed status mapping & real-time Webhook Diagnostic Logging
   */
  public async handleWebhook(
    rawBody: string,
    headers: Record<string, any>,
    payload: any
  ): Promise<{ httpCode: number; body: any }> {
    const startTime = Date.now();
    const endpoint = `/api/webhooks/${this.provider.slug}`;
    const isInternalTest = payload?.event_type === 'TEST_WEBHOOK' || payload?.type === 'TEST_WEBHOOK';
    const partnerOrderId = String(payload?.partner_orderid || payload?.partner_order_id || payload?.partnerOrderId || '');
    const providerOrderId = String(payload?.id || payload?.order_id || payload?.goxtop_order_id || '');
    const rawStatus = String(payload?.status || payload?.order_status || '').toLowerCase();
    const eventType = isInternalTest
      ? 'TEST_WEBHOOK'
      : String(payload?.event || payload?.event_type || (rawStatus ? `ORDER_${rawStatus.toUpperCase()}` : 'WEBHOOK_NOTIFICATION'));

    // 1. Verify HMAC-SHA256 signature on unmodified rawBody
    const sigCheck = this.verifyWebhookSignature(rawBody, headers);
    const processingSteps: string[] = [
      `[1] Réception HTTP POST sur ${endpoint} (${rawBody.length} octets bruts)`,
      sigCheck.hmacValidation === 'Validée'
        ? `[2] Signature HMAC-SHA256 (${sigCheck.signatureHeaderName || 'header'}) vérifiée avec succès via crypto.timingSafeEqual (${sigCheck.signatureValueMasked})`
        : sigCheck.hmacValidation === 'Non applicable'
        ? `[2] Signature HMAC-SHA256 : Non applicable (aucun Webhook Secret imposé côté serveur)`
        : `[2] ÉCHEC vérification HMAC-SHA256 : ${sigCheck.reason}`
    ];

    if (!sigCheck.valid) {
      processingSteps.push(`[3] Rejet de l'événement (HTTP 401 Unauthorized) — aucune modification de commande effectuée`);
      const errResp = {
        status: 'error',
        code: 'INVALID_HMAC_SIGNATURE',
        hmacValidation: sigCheck.hmacValidation,
        signatureDetected: sigCheck.signatureDetected,
        signatureValueMasked: sigCheck.signatureValueMasked,
        computedHmacPreview: sigCheck.computedHmacPreview,
        processingSteps,
        message: sigCheck.reason
      };
      db.addProviderWebhookLog({
        providerId: this.provider.id,
        providerName: this.provider.name,
        eventType,
        partnerOrderId: partnerOrderId || undefined,
        goxtopOrderId: providerOrderId || undefined,
        receivedStatus: rawStatus || undefined,
        httpStatus: 401,
        latencyMs: Date.now() - startTime,
        signatureDetected: sigCheck.signatureDetected,
        signatureHeaderName: sigCheck.signatureHeaderName,
        signatureValueMasked: sigCheck.signatureValueMasked,
        computedHmacPreview: sigCheck.computedHmacPreview,
        hmacValidation: sigCheck.hmacValidation,
        rawPayload: rawBody,
        headersReceived: headers,
        processingSteps,
        backendResponse: JSON.stringify(errResp),
        errorMessage: sigCheck.reason,
        isInternalTest
      });
      this.logApi('WEBHOOK_EVENT', 'POST', endpoint, 401, Date.now() - startTime, 'Erreur d\'authentification', false, rawBody.slice(0, 600), sigCheck.reason);
      return {
        httpCode: 401,
        body: errResp
      };
    }

    // 2. Handle Internal Diagnostic "TEST_WEBHOOK" (never creates order, never debits money)
    if (isInternalTest) {
      processingSteps.push(`[3] Identification de l'événement diagnostic interne : TEST_WEBHOOK`);
      processingSteps.push(`[4] Isolation garantie : aucune commande GoXtop créée, aucun solde débité`);
      processingSteps.push(`[5] Confirmation HTTP 200 OK retournée par le pipeline Webhook PlayUp`);
      const testResp = {
        status: 'acknowledged',
        event_type: 'TEST_WEBHOOK',
        internal_test: true,
        signatureDetected: sigCheck.signatureDetected,
        signatureHeaderName: sigCheck.signatureHeaderName,
        signatureValueMasked: sigCheck.signatureValueMasked,
        computedHmacPreview: sigCheck.computedHmacPreview,
        hmacValidation: sigCheck.hmacValidation,
        processingSteps,
        message: 'Test interne PlayUp Webhook réussi (aucune commande créée chez GoXtop, aucun montant débité).'
      };
      db.addProviderWebhookLog({
        providerId: this.provider.id,
        providerName: this.provider.name,
        eventType: 'TEST_WEBHOOK',
        partnerOrderId: 'TEST_INTERNAL_NO_ORDER',
        receivedStatus: 'test_ok',
        httpStatus: 200,
        latencyMs: Date.now() - startTime,
        signatureDetected: sigCheck.signatureDetected,
        signatureHeaderName: sigCheck.signatureHeaderName,
        signatureValueMasked: sigCheck.signatureValueMasked,
        computedHmacPreview: sigCheck.computedHmacPreview,
        hmacValidation: sigCheck.hmacValidation,
        rawPayload: rawBody,
        headersReceived: headers,
        processingSteps,
        backendResponse: JSON.stringify(testResp),
        isInternalTest: true
      });
      this.logApi('WEBHOOK_EVENT', 'POST', endpoint, 200, Date.now() - startTime, 'Connexion réussie', true, rawBody.slice(0, 600), JSON.stringify(testResp));
      return {
        httpCode: 200,
        body: testResp
      };
    }

    // 3. Prevent duplicate processing of the same webhook event (Idempotence)
    const eventId = String(
      payload?.event_id ||
      payload?.eventId ||
      (partnerOrderId || providerOrderId ? `${partnerOrderId}_${providerOrderId}_${rawStatus}` : '')
    );

    if (eventId && db.hasProcessedWebhookEvent(eventId)) {
      processingSteps.push(`[3] Contrôle d'idempotence : Événement "${eventId}" déjà traité précédemment`);
      processingSteps.push(`[4] Doublon ignoré en toute sécurité (HTTP 200 OK retourné)`);
      const dupResp = { status: 'acknowledged', duplicate: true, eventId, processingSteps };
      db.addProviderWebhookLog({
        providerId: this.provider.id,
        providerName: this.provider.name,
        eventType: `${eventType} (DOUBLON IGNORÉ)`,
        partnerOrderId: partnerOrderId || undefined,
        goxtopOrderId: providerOrderId || undefined,
        receivedStatus: rawStatus || undefined,
        httpStatus: 200,
        latencyMs: Date.now() - startTime,
        signatureDetected: sigCheck.signatureDetected,
        signatureHeaderName: sigCheck.signatureHeaderName,
        signatureValueMasked: sigCheck.signatureValueMasked,
        computedHmacPreview: sigCheck.computedHmacPreview,
        hmacValidation: sigCheck.hmacValidation,
        rawPayload: rawBody,
        headersReceived: headers,
        processingSteps,
        backendResponse: JSON.stringify(dupResp)
      });
      this.logApi('WEBHOOK_EVENT', 'POST', endpoint, 200, Date.now() - startTime, 'Connexion réussie', true, rawBody.slice(0, 600), `Événement doublon ${eventId} ignoré (idempotent)`);
      return {
        httpCode: 200,
        body: dupResp
      };
    }

    processingSteps.push(`[3] Contrôle d'idempotence validé (clé événement : ${eventId || 'nouveau'})`);

    // 4. Locate PlayUp Order
    const orders = db.getOrders();
    const orderIdx = orders.findIndex(
      o =>
        (partnerOrderId && o.partnerOrderId === partnerOrderId) ||
        (providerOrderId && o.externalOrderId === providerOrderId)
    );

    if (orderIdx === -1) {
      const notFoundMsg = `Aucune commande PlayUp trouvée pour partner_orderid="${partnerOrderId || 'N/A'}" / goxtop_order_id="${providerOrderId || 'N/A'}"`;
      processingSteps.push(`[4] Recherche commande échouée : ${notFoundMsg}`);
      const errBody = { status: 'error', message: notFoundMsg, processingSteps };
      db.addProviderWebhookLog({
        providerId: this.provider.id,
        providerName: this.provider.name,
        eventType,
        partnerOrderId: partnerOrderId || undefined,
        goxtopOrderId: providerOrderId || undefined,
        receivedStatus: rawStatus || undefined,
        httpStatus: 404,
        latencyMs: Date.now() - startTime,
        signatureDetected: sigCheck.signatureDetected,
        signatureHeaderName: sigCheck.signatureHeaderName,
        signatureValueMasked: sigCheck.signatureValueMasked,
        computedHmacPreview: sigCheck.computedHmacPreview,
        hmacValidation: sigCheck.hmacValidation,
        rawPayload: rawBody,
        headersReceived: headers,
        processingSteps,
        backendResponse: JSON.stringify(errBody),
        errorMessage: notFoundMsg
      });
      this.logApi('WEBHOOK_EVENT', 'POST', endpoint, 404, Date.now() - startTime, 'Réponse inattendue du fournisseur', false, rawBody.slice(0, 600), notFoundMsg);
      return {
        httpCode: 404,
        body: errBody
      };
    }

    const order = orders[orderIdx];
    processingSteps.push(`[4] Commande PlayUp localisée : ${order.orderNumber} (${order.gameName} — ${order.packageName})`);

    // 5. Map status ONLY when meaning is confirmed
    let mappedStatus: OrderStatus | null = null;
    if (['pending'].includes(rawStatus)) mappedStatus = 'pending';
    else if (['processing', 'in_progress'].includes(rawStatus)) mappedStatus = 'processing';
    else if (['completed', 'success', 'delivered'].includes(rawStatus)) mappedStatus = 'completed';
    else if (['failed', 'error', 'rejected'].includes(rawStatus)) mappedStatus = 'failed';
    else if (['cancelled', 'canceled'].includes(rawStatus)) mappedStatus = 'cancelled';
    else if (['refunded'].includes(rawStatus)) mappedStatus = 'refunded';

    if (!mappedStatus) {
      const unconfirmedMsg = `Statut GoXtop "${rawStatus}" non reconnu — REQUIRES PROVIDER CONFIRMATION`;
      processingSteps.push(`[5] ${unconfirmedMsg}`);
      const unconfBody = { status: 'acknowledged_unmapped', rawStatus, note: unconfirmedMsg, processingSteps };
      db.addProviderWebhookLog({
        providerId: this.provider.id,
        providerName: this.provider.name,
        eventType,
        partnerOrderId: order.partnerOrderId,
        goxtopOrderId: providerOrderId || order.externalOrderId,
        receivedStatus: rawStatus || 'inconnu',
        httpStatus: 200,
        latencyMs: Date.now() - startTime,
        signatureDetected: sigCheck.signatureDetected,
        signatureHeaderName: sigCheck.signatureHeaderName,
        signatureValueMasked: sigCheck.signatureValueMasked,
        computedHmacPreview: sigCheck.computedHmacPreview,
        hmacValidation: sigCheck.hmacValidation,
        rawPayload: rawBody,
        headersReceived: headers,
        processingSteps,
        backendResponse: JSON.stringify(unconfBody),
        errorMessage: unconfirmedMsg
      });
      return {
        httpCode: 200,
        body: unconfBody
      };
    }

    order.status = mappedStatus;
    if (providerOrderId) {
      order.externalOrderId = providerOrderId;
      order.providerReference = providerOrderId;
    }
    order.providerResponse = db.sanitizeForLogs(payload);
    if (mappedStatus === 'failed' || mappedStatus === 'refunded') {
      order.errorMessage = payload.error || payload.message || `Statut GoXtop: ${mappedStatus}`;
      if (mappedStatus === 'refunded' || payload.refund) {
        order.refundInfo = payload.refund_reason || payload.message || 'Remboursement confirmé par GoXtop';
      }
    }
    order.updatedAt = new Date().toISOString();
    order.statusHistory.push({
      status: mappedStatus,
      timestamp: new Date().toISOString(),
      note: `Webhook GoXtop reçu (HMAC: ${sigCheck.hmacValidation}) → Statut: ${mappedStatus.toUpperCase()}`
    });

    db.setOrders(orders);
    processingSteps.push(`[5] Statut de la commande ${order.orderNumber} mis à jour : ${mappedStatus.toUpperCase()}`);

    // 6. Update provider_orders table
    const existingPord = db.findProviderOrderByPartnerId(order.partnerOrderId);
    db.upsertProviderOrder({
      id: existingPord?.id || 'pord_' + Date.now(),
      playup_order_id: order.orderNumber,
      provider: this.provider.name,
      provider_order_id: providerOrderId || order.externalOrderId || '',
      partner_order_id: order.partnerOrderId,
      request_payload: existingPord?.request_payload || { partner_orderid: order.partnerOrderId },
      response_payload: payload,
      status: mappedStatus,
      error_message: order.errorMessage,
      created_at: existingPord?.created_at || order.createdAt,
      updated_at: new Date().toISOString()
    });
    processingSteps.push(`[6] Table provider_orders synchronisée et notification client envoyée`);

    // 7. Mark event as processed (idempotency)
    if (eventId) {
      db.markWebhookEventProcessed(eventId);
    }

    // 8. Send notification to PlayUp User
    db.addUserNotification({
      userId: order.userId,
      orderId: order.id,
      orderNumber: order.orderNumber,
      title:
        mappedStatus === 'completed'
          ? `Commande ${order.gameName} livrée !`
          : mappedStatus === 'failed'
          ? `Échec commande ${order.orderNumber}`
          : mappedStatus === 'refunded'
          ? `Commande ${order.orderNumber} remboursée`
          : `Mise à jour commande ${order.orderNumber}`,
      message:
        mappedStatus === 'completed'
          ? `Votre pack ${order.packageName} (${order.gameName}) a été livré avec succès par GoXtop.`
          : `Le statut de votre commande ${order.orderNumber} est passé à : ${mappedStatus}. ${order.errorMessage || ''}`,
      type: mappedStatus === 'completed' ? 'order' : mappedStatus === 'refunded' ? 'refund' : 'error'
    });

    // 9. Notify downstream reseller if applicable
    if (order.resellerId && ['completed', 'failed', 'processing'].includes(mappedStatus)) {
      WebhookEngine.dispatchOrderEvent(order, `order.${mappedStatus}` as any).catch(console.error);
    }

    const okBody = {
      status: 'acknowledged',
      orderNumber: order.orderNumber,
      partner_orderid: order.partnerOrderId,
      goxtop_order_id: order.externalOrderId,
      updatedStatus: order.status,
      hmacValidation: sigCheck.hmacValidation,
      processingSteps
    };

    db.addProviderWebhookLog({
      providerId: this.provider.id,
      providerName: this.provider.name,
      eventType,
      partnerOrderId: order.partnerOrderId,
      goxtopOrderId: providerOrderId || order.externalOrderId,
      receivedStatus: rawStatus,
      httpStatus: 200,
      latencyMs: Date.now() - startTime,
      signatureDetected: sigCheck.signatureDetected,
      signatureHeaderName: sigCheck.signatureHeaderName,
      signatureValueMasked: sigCheck.signatureValueMasked,
      computedHmacPreview: sigCheck.computedHmacPreview,
      hmacValidation: sigCheck.hmacValidation,
      rawPayload: rawBody,
      headersReceived: headers,
      processingSteps,
      backendResponse: JSON.stringify(okBody)
    });

    this.logApi(
      'WEBHOOK_EVENT',
      'POST',
      endpoint,
      200,
      Date.now() - startTime,
      'Connexion réussie',
      true,
      rawBody.slice(0, 600),
      JSON.stringify(okBody),
      order.orderNumber,
      order.partnerOrderId
    );

    return {
      httpCode: 200,
      body: okBody
    };
  }

  private logApi(
    requestType: 'TEST_CONNECTION' | 'GET_GAMES' | 'GET_PRODUCTS' | 'CHECK_PLAYER' | 'CREATE_ORDER' | 'GET_ORDER_STATUS' | 'TRACK_ORDER' | 'WEBHOOK_EVENT',
    httpMethod: 'GET' | 'POST' | 'PUT',
    endpoint: string,
    httpStatus: number | null,
    latencyMs: number,
    resultLabel: string,
    success: boolean,
    requestPreview?: string,
    responseOrError?: string,
    orderId?: string,
    partnerOrderId?: string
  ) {
    db.addProviderApiLog({
      providerId: this.provider.id,
      providerName: this.provider.name,
      requestType,
      httpMethod,
      endpoint,
      orderId,
      partnerOrderId,
      httpStatus,
      latencyMs,
      resultLabel,
      success,
      requestHeadersMasked: this.buildMaskedHeaders(),
      requestPreview,
      errorMessage: !success ? responseOrError : undefined,
      responsePreview: responseOrError
    });
  }
}

export class ProviderFactory {
  public static getProviderInstance(providerIdOrSlug: string): BaseProvider | null {
    const providers = db.getProviders();
    const provider = providers.find(p => p.id === providerIdOrSlug || p.slug === providerIdOrSlug);
    if (!provider) return null;

    const secrets = db.getProviderSecret(provider.id);
    return new GoXtopProvider(provider, secrets);
  }
}
