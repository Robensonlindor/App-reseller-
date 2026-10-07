import crypto from 'crypto';
import { db, ProviderSecretRecord } from '../db';
import { 
  Provider, ConnectionTestResult, Order, PlayerCheckResult, OrderStatus, GameField 
} from '../../src/types';
import { WebhookEngine } from '../webhookEngine';
import { NotificationEngine } from '../notificationAndDownloadEngine';

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
  verifiedPlayerName?: string;
  httpStatus: number | null;
  latencyMs: number;
  rawResponse: any;
  errorMessage?: string;
}

export interface GoXtopNameCheckGameSpec {
  code: string;               // Official code in GoXtop GET /api/check/games
  name: string;
  zone?: boolean;             // Requires server_code (Zone ID / Server ID)
  zoneOptional?: boolean;
  zoneValues?: string[];      // Allowed server_code values
  regions?: string[];         // Allowed region values (e.g. ['global', 'mysg', 'bd', 'id', 'vn'])
  defaultRegion?: string;
  idFieldLabel?: string;
  idPlaceholder?: string;
}

/**
 * Official GoXtop Name Checker Catalog Specification (from GET https://goxtop.com/api/check/games)
 * Maps GoXtop gamecode / slug to exact parameters required by GET /api/check/game-check
 */
export const GOXTOP_OFFICIAL_CHECK_SPECS: Record<string, GoXtopNameCheckGameSpec> = {
  'free-fire': {
    code: 'free-fire',
    name: 'Free Fire',
    regions: ['global', 'mysg', 'bd', 'id', 'vn'],
    defaultRegion: 'global',
    idFieldLabel: 'Free Fire ID',
    idPlaceholder: '16777227705'
  },
  'mobile-legends': {
    code: 'mobile-legends',
    name: 'Mobile Legends',
    zone: true,
    idFieldLabel: 'Player ID (User ID)',
    idPlaceholder: '2009663813'
  },
  'mobile-legends-adventure': {
    code: 'mobile-legends-adventure',
    name: 'Mobile Legends: Adventure',
    zone: true,
    idFieldLabel: 'Player ID (User ID)',
    idPlaceholder: '12345678'
  },
  'pubg': {
    code: 'pubg',
    name: 'PUBG Mobile',
    idFieldLabel: 'Character ID (PUBG ID)',
    idPlaceholder: '5123984712'
  },
  'call-of-duty-mobile': {
    code: 'call-of-duty-mobile',
    name: 'Call of Duty: Mobile',
    idFieldLabel: 'Call of Duty Mobile ID',
    idPlaceholder: '68192309123849102'
  },
  '8-ball-pool': {
    code: '8-ball-pool',
    name: '8 Ball Pool',
    idFieldLabel: '8 Ball Pool Unique ID',
    idPlaceholder: '1234567890'
  },
  'ace-racer': {
    code: 'ace-racer',
    name: 'Ace Racer',
    zone: true
  },
  'arena-breakout': {
    code: 'arena-breakout',
    name: 'Arena Breakout',
    idFieldLabel: 'Arena Breakout Player ID',
    idPlaceholder: '1234567890'
  },
  'arena-of-valor': {
    code: 'arena-of-valor',
    name: 'Arena of Valor'
  },
  'asphalt-9-legends': {
    code: 'asphalt-9-legends',
    name: 'Asphalt 9: Legends'
  },
  'bigo': {
    code: 'bigo',
    name: 'Bigo Live'
  },
  'blood-strike': {
    code: 'blood-strike',
    name: 'Blood Strike',
    idFieldLabel: 'Blood Strike Account ID',
    idPlaceholder: '586013280424'
  },
  'brawl-stars': {
    code: 'brawl-stars',
    name: 'Brawl Stars'
  },
  'chamet': {
    code: 'chamet',
    name: 'Chamet'
  },
  'clash-of-clans': {
    code: 'clash-of-clans',
    name: 'Clash of Clans'
  },
  'clash-royale': {
    code: 'clash-royale',
    name: 'Clash Royale'
  },
  'football-master-2': {
    code: 'football-master-2',
    name: 'Football Master 2'
  },
  'genshin-impact': {
    code: 'genshin-impact',
    name: 'Genshin Impact',
    zoneOptional: true,
    regions: ['global', 'br', 'kh', 'id', 'my', 'ph', 'kr', 'th', 'us', 'eu', 'latam']
  },
  'hago': {
    code: 'hago',
    name: 'Hago'
  },
  'hayday': {
    code: 'hayday',
    name: 'Hay Day'
  },
  'honkai-impact-3': {
    code: 'honkai-impact-3',
    name: 'Honkai Impact 3rd'
  },
  'honkai-star-rail': {
    code: 'honkai-star-rail',
    name: 'Honkai: Star Rail',
    zone: true,
    zoneValues: ['america', 'europe', 'THM']
  },
  'honor-of-kings': {
    code: 'honor-of-kings',
    name: 'Honor of Kings'
  },
  'identity-v': {
    code: 'identity-v',
    name: 'Identity V'
  },
  'league-of-legends-wild-rift': {
    code: 'league-of-legends-wild-rift',
    name: 'League of Legends: Wild Rift'
  },
  'lifeafter': {
    code: 'lifeafter',
    name: 'LifeAfter'
  },
  'magic-chess-gogo': {
    code: 'magic-chess-gogo',
    name: 'Magic Chess: Go Go',
    zone: true
  },
  'marvel-rivals': {
    code: 'marvel-rivals',
    name: 'Marvel Rivals'
  },
  'nimo': {
    code: 'nimo',
    name: 'Nimo TV'
  },
  'point-blank': {
    code: 'point-blank',
    name: 'Point Blank'
  },
  'punishing-gray-raven': {
    code: 'punishing-gray-raven',
    name: 'Punishing: Gray Raven'
  },
  'rainbow-six-mobile': {
    code: 'rainbow-six-mobile',
    name: 'Rainbow Six Mobile'
  },
  'sausage-man': {
    code: 'sausage-man',
    name: 'Sausage Man'
  },
  'super-sus': {
    code: 'super-sus',
    name: 'Super Sus'
  },
  'sword-of-justice': {
    code: 'sword-of-justice',
    name: 'Sword of Justice',
    zone: true,
    zoneValues: ['ea', 'na', 'sea']
  },
  'teen-patti-gold': {
    code: 'teen-patti-gold',
    name: 'Teen Patti Gold'
  },
  'tomb-busters': {
    code: 'tomb-busters',
    name: 'Tomb Busters'
  },
  'valo': {
    code: 'valo',
    name: 'Valorant'
  },
  'where-winds-meet': {
    code: 'where-winds-meet',
    name: 'Where Winds Meet'
  },
  'wuthering-waves': {
    code: 'wuthering-waves',
    name: 'Wuthering Waves'
  },
  'zenless-zone-zero': {
    code: 'zenless-zone-zero',
    name: 'Zenless Zone Zero'
  },
  'zepeto': {
    code: 'zepeto',
    name: 'ZEPETO'
  }
};

/**
 * Resolves any GoXtop gamecode (from GET /api/v.1/games) or PlayUp game slug to its documented
 * GoXtop Name Checker specification (from GET /api/check/games).
 * Returns null if the game is not documented in GoXtop's /api/check/games table.
 */
export function resolveGoXtopNameCheckSpec(gameCodeOrSlug: string): GoXtopNameCheckGameSpec | null {
  const clean = (gameCodeOrSlug || '').trim().toLowerCase();
  if (!clean) return null;

  // Exclude PIN / voucher games that do not use a Player ID
  if (clean.includes('pin') || clean.includes('voucher') || clean.includes('gift-card')) {
    return null;
  }

  if (GOXTOP_OFFICIAL_CHECK_SPECS[clean]) {
    return GOXTOP_OFFICIAL_CHECK_SPECS[clean];
  }

  const hyphenated = clean.replace(/_/g, '-');
  if (GOXTOP_OFFICIAL_CHECK_SPECS[hyphenated]) {
    return GOXTOP_OFFICIAL_CHECK_SPECS[hyphenated];
  }

  // Free Fire regional & global gamecodes in GoXtop
  if (clean.startsWith('freefire') || clean.startsWith('free-fire') || clean === 'game_ff') {
    let defaultRegion = 'global';
    if (clean.endsWith('_bd') || clean.endsWith('-bd')) defaultRegion = 'bd';
    else if (clean.endsWith('_id') || clean.endsWith('-id')) defaultRegion = 'id';
    else if (clean.endsWith('_vn') || clean.endsWith('-vn')) defaultRegion = 'vn';
    else if (clean.endsWith('_sgmy') || clean.endsWith('_sg') || clean.endsWith('_kh') || clean.endsWith('-sgmy') || clean.endsWith('-sg')) {
      defaultRegion = 'mysg';
    }
    return {
      ...GOXTOP_OFFICIAL_CHECK_SPECS['free-fire'],
      defaultRegion
    };
  }

  // Mobile Legends gamecodes in GoXtop
  if (clean.includes('mlbb') || clean.includes('mobile_legends') || clean.includes('mobile-legends')) {
    if (clean.includes('adventure') || clean === 'mla') {
      return GOXTOP_OFFICIAL_CHECK_SPECS['mobile-legends-adventure'];
    }
    return GOXTOP_OFFICIAL_CHECK_SPECS['mobile-legends'];
  }

  // PUBG Mobile gamecodes
  if (clean.startsWith('pubg') || clean === 'game_pubg') {
    return GOXTOP_OFFICIAL_CHECK_SPECS['pubg'];
  }

  // Call of Duty Mobile gamecodes
  if (clean.startsWith('codm') || clean.startsWith('cod_mobile') || clean.startsWith('cod-mobile') || clean === 'game_codm') {
    return GOXTOP_OFFICIAL_CHECK_SPECS['call-of-duty-mobile'];
  }

  // Arena Breakout
  if (clean.startsWith('arena_breakout') || clean.startsWith('arena-breakout')) {
    return GOXTOP_OFFICIAL_CHECK_SPECS['arena-breakout'];
  }

  // Arena of Valor
  if (clean === 'aove' || clean.startsWith('aov_') || clean.startsWith('arena_of_valor')) {
    return GOXTOP_OFFICIAL_CHECK_SPECS['arena-of-valor'];
  }

  // Blood Strike
  if (clean.startsWith('blood_strike') || clean.startsWith('blood-strike')) {
    return GOXTOP_OFFICIAL_CHECK_SPECS['blood-strike'];
  }

  // Genshin Impact
  if (clean.startsWith('genshin')) {
    return GOXTOP_OFFICIAL_CHECK_SPECS['genshin-impact'];
  }

  // Honkai Star Rail & Honkai Impact 3
  if (clean === 'hsr' || clean.startsWith('honkai_star_rail') || clean.startsWith('honkai-star-rail')) {
    return GOXTOP_OFFICIAL_CHECK_SPECS['honkai-star-rail'];
  }
  if (clean === 'honkai' || clean.startsWith('honkai_impact')) {
    return GOXTOP_OFFICIAL_CHECK_SPECS['honkai-impact-3'];
  }

  // Honor of Kings
  if (clean === 'hok' || clean.startsWith('honor_of_kings')) {
    return GOXTOP_OFFICIAL_CHECK_SPECS['honor-of-kings'];
  }

  // Wild Rift
  if (clean.startsWith('wild_rift') || clean.startsWith('wild-rift')) {
    return GOXTOP_OFFICIAL_CHECK_SPECS['league-of-legends-wild-rift'];
  }

  // Magic Chess Go Go
  if (clean === 'mcgg' || clean.startsWith('magic_chess')) {
    return GOXTOP_OFFICIAL_CHECK_SPECS['magic-chess-gogo'];
  }

  // Punishing Gray Raven
  if (clean === 'pgr' || clean.startsWith('punishing')) {
    return GOXTOP_OFFICIAL_CHECK_SPECS['punishing-gray-raven'];
  }

  // Rainbow Six Mobile
  if (clean === 'rsm' || clean.startsWith('rsm_') || clean.startsWith('rainbow_six')) {
    return GOXTOP_OFFICIAL_CHECK_SPECS['rainbow-six-mobile'];
  }

  // Sword of Justice
  if (clean.startsWith('swordofjustice') || clean.startsWith('sword_of_justice')) {
    return GOXTOP_OFFICIAL_CHECK_SPECS['sword-of-justice'];
  }

  // Valorant
  if (clean.startsWith('valorant') || clean === 'valo') {
    return GOXTOP_OFFICIAL_CHECK_SPECS['valo'];
  }

  // Where Winds Meet
  if (clean === 'wwm' || clean.startsWith('where_winds_meet')) {
    return GOXTOP_OFFICIAL_CHECK_SPECS['where-winds-meet'];
  }

  // Wuthering Waves
  if (clean === 'wuwa' || clean.startsWith('wuthering')) {
    return GOXTOP_OFFICIAL_CHECK_SPECS['wuthering-waves'];
  }

  // Zenless Zone Zero
  if (clean === 'zzz' || clean.startsWith('zenless')) {
    return GOXTOP_OFFICIAL_CHECK_SPECS['zenless-zone-zero'];
  }

  // Bigo Live
  if (clean.startsWith('bigo')) {
    return GOXTOP_OFFICIAL_CHECK_SPECS['bigo'];
  }

  return null;
}

/**
 * Builds dynamic GameField[] for a game based on its GoXtop Name Checker & Product requirements
 */
export function buildDynamicFieldsForGoXtopGame(
  gameCode: string,
  gameName: string,
  requiresServerIdFromProducts = false
): GameField[] {
  const spec = resolveGoXtopNameCheckSpec(gameCode);
  const cleanCode = gameCode.toLowerCase();

  if (cleanCode.includes('pin') || cleanCode.includes('voucher') || cleanCode.includes('gift-card')) {
    return [];
  }

  const fields: GameField[] = [];

  if (cleanCode.startsWith('freefire') || cleanCode.startsWith('free-fire')) {
    fields.push({
      id: `f_${gameCode}_uid`,
      name: 'playerId',
      label: 'Free Fire ID',
      placeholder: '16777227705',
      type: 'text',
      required: true,
      helperText: 'Saisissez votre Free Fire ID (ex: 16777227705) puis cliquez sur "Vérifier l’ID".',
      validationRegex: '^[0-9]{5,16}$'
    });
    return fields;
  }

  if (spec?.code === 'pubg') {
    fields.push({
      id: `f_${gameCode}_uid`,
      name: 'characterId',
      label: 'Character ID (PUBG ID)',
      placeholder: spec.idPlaceholder || '5123984712',
      type: 'text',
      required: true,
      helperText: 'Votre Character ID numérique PUBG Mobile.',
      validationRegex: '^[0-9]{5,16}$'
    });
    return fields;
  }

  fields.push({
    id: `f_${gameCode}_uid`,
    name: 'playerId',
    label: spec?.idFieldLabel || `${gameName} ID (User ID)`,
    placeholder: spec?.idPlaceholder || 'Entrez votre Player ID',
    type: 'text',
    required: true,
    helperText: spec
      ? `Identifiant joueur requis par GoXtop (${spec.code}). Cliquez sur "Vérifier l’ID" avant de commander.`
      : `Identifiant joueur requis pour ${gameName}.`
  });

  if (spec?.zone || requiresServerIdFromProducts) {
    if (spec?.zoneValues && spec.zoneValues.length > 0) {
      fields.push({
        id: `f_${gameCode}_zone`,
        name: 'zoneId',
        label: 'Server / Zone',
        placeholder: spec.zoneValues[0],
        type: 'select',
        options: spec.zoneValues,
        required: true,
        helperText: `Serveur requis (${spec.zoneValues.join(', ')})`
      });
    } else {
      fields.push({
        id: `f_${gameCode}_zone`,
        name: spec?.code?.includes('mobile-legends') ? 'zoneId' : 'serverId',
        label: spec?.code?.includes('mobile-legends') ? 'Zone ID (Server Code)' : 'Server ID / Zone ID',
        placeholder: spec?.code?.includes('mobile-legends') ? 'ex: 6104' : 'Entrez votre Server / Zone ID',
        type: 'text',
        required: true,
        helperText: 'Identifiant de serveur / zone requis pour ce service.'
      });
    }
  }

  return fields;
}

/**
 * Common Modular Provider Abstraction Interface
 * Supports: GoXtopProvider, ProviderB, ProviderC without altering core PlayUp logic.
 */
export interface IGameServiceProvider {
  getGames(): Promise<ProviderSyncResponse>;
  getProducts(gameCode?: string): Promise<ProviderSyncResponse>;
  checkPlayer(gameCode: string, playerData: Record<string, string>, clientIp?: string): Promise<PlayerCheckResult>;
  createOrder(order: Order, webhookCallbackUrl: string): Promise<ProviderOrderDispatchResult>;
  getOrderStatus(partnerOrderId: string): Promise<{ success: boolean; status?: OrderStatus; providerOrderId?: string; verifiedPlayerName?: string; raw?: any; message?: string }>;
  trackOrder(partnerOrderId: string): Promise<{ success: boolean; status?: OrderStatus; providerOrderId?: string; raw?: any; message?: string }>;
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
  public abstract checkPlayer(gameCode: string, playerData: Record<string, string>, clientIp?: string): Promise<PlayerCheckResult>;
  public abstract createOrder(order: Order, webhookCallbackUrl: string): Promise<ProviderOrderDispatchResult>;
  public abstract getOrderStatus(partnerOrderId: string): Promise<{ success: boolean; status?: OrderStatus; providerOrderId?: string; verifiedPlayerName?: string; raw?: any; message?: string }>;
  public abstract trackOrder(partnerOrderId: string): Promise<{ success: boolean; status?: OrderStatus; providerOrderId?: string; raw?: any; message?: string }>;
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
    if (base.endsWith('/api/v.1') && (resolvedPath.startsWith('/api/v.1') || resolvedPath.startsWith('/api/check'))) {
      base = base.slice(0, -'/api/v.1'.length);
    }
    return `${base}${resolvedPath.startsWith('/') ? '' : '/'}${resolvedPath}`;
  }

  protected buildHeaders(extraHeaders?: Record<string, string>): Record<string, string> {
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
    if (extraHeaders) {
      for (const [k, v] of Object.entries(extraHeaders)) {
        if (v) headers[k] = v;
      }
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
   * Verifies GoXtop Webhook HMAC-SHA256 signature.
   * Official GoXtop format:
   *   Headers: X-Webhook-Timestamp, X-Webhook-Signature
   *   signature = hex(hmac_sha256(YOUR_SECRET_KEY, timestamp + "." + raw_request_body))
   * Also supports direct HMAC-SHA256 on raw_request_body for internal diagnostics.
   */
  public verifyWebhookSignature(rawBody: string, headers: Record<string, any> = {}): WebhookSignatureCheckResult {
    const secret = this.secrets.webhookSecret?.trim();

    let detectedHeaderName: string | undefined;
    let signatureValue: string | undefined;
    let timestampValue: string | undefined;

    for (const [k, v] of Object.entries(headers)) {
      const lowerKey = k.toLowerCase();
      if (lowerKey === 'x-webhook-timestamp' || lowerKey === 'webhook-timestamp') {
        timestampValue = Array.isArray(v) ? v[0] : String(v);
      }
    }

    const configuredHeader = this.provider.webhookSignatureHeaderName?.trim().toLowerCase();
    if (configuredHeader && headers[configuredHeader]) {
      detectedHeaderName = configuredHeader;
      signatureValue = Array.isArray(headers[configuredHeader]) ? headers[configuredHeader][0] : String(headers[configuredHeader]);
    } else {
      for (const [k, v] of Object.entries(headers)) {
        const lowerKey = k.toLowerCase();
        if (lowerKey === 'x-webhook-signature' || lowerKey.includes('signature') || lowerKey.includes('hmac')) {
          detectedHeaderName = k;
          signatureValue = Array.isArray(v) ? v[0] : String(v);
          break;
        }
      }
    }

    const signatureDetected = Boolean(signatureValue && signatureValue.trim().length > 0);
    const cleanSig = signatureValue ? signatureValue.replace(/^(sha256=|hmac-sha256=|v1,)/i, '').trim() : '';
    const signatureValueMasked = cleanSig
      ? (cleanSig.length > 16 ? `sha256=${cleanSig.slice(0, 10)}••••${cleanSig.slice(-8)}` : `sha256=${cleanSig}`)
      : undefined;

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

    const signingInputWithTs = timestampValue ? `${timestampValue}.${rawBody}` : rawBody;
    const expectedHexWithTs = crypto
      .createHmac('sha256', secret)
      .update(signingInputWithTs, 'utf8')
      .digest('hex');
    const expectedHexRaw = crypto
      .createHmac('sha256', secret)
      .update(rawBody, 'utf8')
      .digest('hex');
    const expectedBase64Raw = crypto
      .createHmac('sha256', secret)
      .update(rawBody, 'utf8')
      .digest('base64');

    const computedHmacPreview = `sha256=${expectedHexWithTs.slice(0, 10)}••••${expectedHexWithTs.slice(-8)}`;

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
      const expHexTsBuf = Buffer.from(expectedHexWithTs, 'hex');
      if (sigHexBuf.length === expHexTsBuf.length && sigHexBuf.length > 0 && crypto.timingSafeEqual(sigHexBuf, expHexTsBuf)) {
        return {
          valid: true,
          signatureDetected: true,
          signatureHeaderName: detectedHeaderName,
          signatureValueMasked,
          computedHmacPreview,
          hmacValidation: 'Validée'
        };
      }

      const expHexRawBuf = Buffer.from(expectedHexRaw, 'hex');
      if (sigHexBuf.length === expHexRawBuf.length && sigHexBuf.length > 0 && crypto.timingSafeEqual(sigHexBuf, expHexRawBuf)) {
        return {
          valid: true,
          signatureDetected: true,
          signatureHeaderName: detectedHeaderName,
          signatureValueMasked,
          computedHmacPreview: `sha256=${expectedHexRaw.slice(0, 10)}••••${expectedHexRaw.slice(-8)}`,
          hmacValidation: 'Validée'
        };
      }

      const sigB64Buf = Buffer.from(cleanSig, 'utf8');
      const expB64Buf = Buffer.from(expectedBase64Raw, 'utf8');
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
 * Implements documented endpoints from https://goxtop.com:
 * - GET /api/v.1/balance
 * - GET /api/v.1/games
 * - GET /api/v.1/products/:gameCode
 * - GET /api/v.1/server-options?gamecode=:gameCode
 * - POST /api/v.1/create
 * - GET /api/v.1/:partner_orderid
 * - POST /api/v.1/:partner_orderid/track
 * - GET /api/check/games
 * - GET /api/check/game-check
 * - GET /api/check/mlbb-check
 * - GET /api/check/ff-levelup-check
 */
export class GoXtopProvider extends BaseProvider {
  /**
   * Fetches real GoXtop reseller wallet balance via GET /api/v.1/balance
   */
  public async getBalance(): Promise<{ success: boolean; walletBalance?: number; currency?: string; message?: string }> {
    if (!this.secrets.apiKey?.trim()) {
      return { success: false, message: 'API Key GoXtop manquante' };
    }
    const fullUrl = this.buildUrl('/api/v.1/balance');
    try {
      const response = await fetch(fullUrl, {
        method: 'GET',
        headers: this.buildHeaders()
      });
      const rawText = await response.text().catch(() => '');
      const parsed = rawText ? JSON.parse(rawText) : null;
      if (response.ok && parsed?.success !== false && parsed?.data) {
        return {
          success: true,
          walletBalance: Number(parsed.data.wallet_balance ?? 0),
          currency: String(parsed.data.currency || 'USD')
        };
      }
      return {
        success: false,
        message: parsed?.message || `HTTP ${response.status}`
      };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  }

  /**
   * Tests connection to GoXtop using GET /api/v.1/games and GET /api/v.1/balance without creating any order.
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
      const [response, balResult] = await Promise.all([
        fetch(fullUrl, {
          method: 'GET',
          headers: this.buildHeaders(),
          signal: controller.signal
        }),
        this.getBalance().catch(() => ({ success: false as const }))
      ]);
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

        const balNote = balResult.success && balResult.walletBalance !== undefined
          ? ` Solde Wallet GoXtop : $${balResult.walletBalance.toFixed(3)} ${balResult.currency || 'USD'}.`
          : '';

        const res: ConnectionTestResult = {
          success: true,
          code: 'SUCCESS',
          label: 'Connexion réussie',
          httpStatus,
          latencyMs,
          endpointCalled: fullUrl,
          details: `Authentification GoXtop validée (HTTP ${httpStatus} OK en ${latencyMs} ms). ${gamesArray.length} jeux actifs détectés dans le catalogue distant.${balNote}`,
          timestamp,
          authHeadersUsed: maskedHeaders,
          gamesCountDetected: gamesArray.length,
          walletBalance: balResult.success ? balResult.walletBalance : undefined,
          walletCurrency: balResult.success ? balResult.currency : undefined,
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
   * Also cross-references GET /api/check/games so all supported games have supportsNameCheck: true and exact dynamic fields.
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

        const checkSpec = resolveGoXtopNameCheckSpec(gameCode);
        const supportsNameCheck = Boolean(checkSpec || gItem.name_check || gItem.supports_name_check);
        const dynamicFields = buildDynamicFieldsForGoXtopGame(gameCode, gameName);

        const candidateId =
          gameCode === 'freefire_global'
            ? 'game_ff'
            : gameCode === 'mlbb_special' || gameCode === 'mlbb'
            ? 'game_mlbb'
            : gameCode === 'pubgm'
            ? 'game_pubg'
            : gameCode === 'codm_sgmy'
            ? 'game_codm'
            : 'game_' + gameCode.toLowerCase().replace(/[^a-z0-9]+/g, '_');

        const existing = games.find(
          g =>
            g.id === candidateId ||
            g.externalGameId?.toLowerCase() === gameCode.toLowerCase() ||
            g.slug.toLowerCase() === gameCode.toLowerCase() ||
            (gameCode === 'freefire_global' && g.id === 'game_ff') ||
            ((gameCode === 'mlbb_special' || gameCode === 'mlbb') && g.id === 'game_mlbb') ||
            ((gameCode === 'codm_sgmy' || gameCode === 'codm') && g.id === 'game_codm') ||
            (gameCode === 'pubgm' && g.id === 'game_pubg')
        );

        if (existing) {
          existing.externalGameId = gameCode;
          existing.providerId = this.provider.id;
          existing.supportsNameCheck = supportsNameCheck;
          if (!existing.fields || existing.fields.length === 0 || existing.id === 'game_ff') {
            existing.fields = dynamicFields;
          }
          if (gItem.active !== undefined || gItem.status !== undefined) {
            existing.isActive = gItem.active !== undefined ? Boolean(gItem.active) : String(gItem.status).toLowerCase() === 'active';
          }
          existing.updatedAt = new Date().toISOString();
          updatedCount++;
        } else {
          games.push({
            id: candidateId,
            slug: gameCode === 'freefire_global' ? 'free-fire' : gameCode.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            name: gameCode === 'freefire_global' ? 'Free Fire' : gameName,
            externalGameId: gameCode,
            providerId: this.provider.id,
            supportsNameCheck,
            requiresPlayerId: gItem.requires_player_id !== undefined ? Boolean(gItem.requires_player_id) : !gameCode.includes('pin') && !gameCode.includes('gift-card'),
            category: gItem.category || 'Gaming Top-Up',
            description: gItem.description || `Service officiel ${gameName} via GoXtop (${gItem.totalProducts || 0} packs disponibles)`,
            logo: resolvedLogo,
            banner: resolvedLogo,
            isActive: true,
            displayOrder: candidateId === 'game_ff' ? 1 : candidateId === 'game_pubg' ? 2 : candidateId === 'game_mlbb' ? 3 : candidateId === 'game_codm' ? 4 : games.length + 6,
            fields: dynamicFields,
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
      const fullUrl = this.buildUrl(productsPath, { game: gCode, gameCode: gCode });
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
            id: game.id === 'game_ff' ? 'srv_ff_diamonds' : 'srv_' + game.slug,
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
        service.providerId = this.provider.id;

        if (prodList.length > 0) {
          const validExtIds = new Set(
            prodList
              .map((pItem: any) => String(pItem.Pack || pItem.pack || pItem.id || pItem.product_id || pItem.code || pItem.sku || pItem.name || '').trim())
              .filter(Boolean)
          );
          // Remove legacy initial placeholder or RechargeGames packages that don't match real GoXtop Pack codes
          service.packages = service.packages.filter(
            pkg => pkg.providerSlug !== 'rechargegames' && (!pkg.externalProductId || validExtIds.has(pkg.externalProductId))
          );
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

          if (dbGame && reqCharName && !dbGame.fields.some(f => f.name === 'playerName' || f.name === 'charname')) {
            dbGame.fields.push({
              id: `f_${gCode}_charname`,
              name: 'playerName',
              label: 'Character Name',
              placeholder: 'Nom du personnage en jeu',
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
            existingPkg.providerSlug = 'goxtop';
            existingPkg.requiresPlayerId = reqUserId;
            if (requiredFields.length > 0) {
              existingPkg.requiredFields = requiredFields;
            }
            if (!isNaN(goxtopCost) && goxtopCost > 0) {
              existingPkg.supplierCost = Number(goxtopCost.toFixed(3));
              const currentMargin =
                typeof existingPkg.margin === 'number' && existingPkg.margin > 0
                  ? existingPkg.margin
                  : Number(Math.max(0.15, goxtopCost * 0.25).toFixed(2));
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
              providerSlug: 'goxtop',
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
   * Official GoXtop Name Checker Integration
   * Documented Endpoint:
   *   GET /api/check/game-check?code={code}&characterId={characterId}&server_code={server_code}&region={region}
   *   Headers: x-api-key: YOUR_API_KEY
   *
   * Zero simulation: Calls the live GoXtop Name Checker API and returns the real result or real error.
   * If a game is not documented in GoXtop's /api/check/games table, returns "REQUIRES GOXTOP DOCUMENTATION".
   */
  public async checkPlayer(
    gameCode: string,
    playerData: Record<string, string>,
    clientIp?: string
  ): Promise<PlayerCheckResult> {
    const startTime = Date.now();
    const spec = resolveGoXtopNameCheckSpec(gameCode);

    if (!spec) {
      return {
        supported: false,
        verified: false,
        requiresDocumentation: true,
        message: `REQUIRES GOXTOP DOCUMENTATION : Le service "${gameCode}" ne possède pas de code confirmé dans la table officielle /api/check/games de GoXtop.`
      };
    }

    if (!this.secrets.apiKey?.trim()) {
      return {
        supported: true,
        verified: false,
        code: 'MISSING_API_KEY',
        message: 'Vérification impossible : API Key GoXtop non configurée côté serveur.'
      };
    }

    const characterId = String(
      playerData.playerId ||
      playerData.characterId ||
      playerData.userId ||
      playerData.userid ||
      playerData.uid ||
      ''
    ).trim();

    if (!characterId) {
      return {
        supported: true,
        verified: false,
        code: 'MISSING_PLAYER_ID',
        message: `Veuillez saisir votre ${spec.idFieldLabel || 'Player ID'} avant de cliquer sur "Vérifier l’ID".`
      };
    }

    const serverCode = String(
      playerData.zoneId ||
      playerData.serverId ||
      playerData.server_code ||
      playerData.zone ||
      ''
    ).trim();

    if (spec.zone && !serverCode) {
      return {
        supported: true,
        verified: false,
        code: 'MISSING_SERVER_CODE',
        message: `Le champ Zone ID / Server Code (server_code) est requis par GoXtop pour vérifier un compte ${spec.name}.`
      };
    }

    const rawRegion = String(playerData.region || spec.defaultRegion || '').trim().toLowerCase();
    const resolvedRegion =
      spec.regions && spec.regions.length > 0
        ? (spec.regions.includes(rawRegion) ? rawRegion : (spec.defaultRegion || spec.regions[0]))
        : undefined;

    const configuredPath = (this.provider.endpoints?.checkPlayerPath || '').trim();
    const checkEndpointPath =
      !configuredPath || configuredPath === 'REQUIRES GOXTOP DOCUMENTATION'
        ? '/api/check/game-check'
        : configuredPath;

    const baseCheckUrl = this.buildUrl(checkEndpointPath);
    const urlObj = new URL(baseCheckUrl);
    urlObj.searchParams.set('code', spec.code);
    urlObj.searchParams.set('characterId', characterId);
    if (serverCode && (spec.zone || spec.zoneOptional)) {
      urlObj.searchParams.set('server_code', serverCode);
    }
    if (resolvedRegion) {
      urlObj.searchParams.set('region', resolvedRegion);
    }

    const fullUrl = urlObj.toString();
    const reqPreview = JSON.stringify({
      method: 'GET',
      url: fullUrl,
      params: {
        code: spec.code,
        characterId,
        ...(serverCode ? { server_code: serverCode } : {}),
        ...(resolvedRegion ? { region: resolvedRegion } : {})
      },
      headers: this.buildMaskedHeaders()
    });

    const executeGoXtopCheckRequest = async (forwardedIp?: string) => {
      const extraHeaders: Record<string, string> = {};
      if (forwardedIp) {
        extraHeaders['X-Forwarded-For'] = forwardedIp;
        extraHeaders['X-Real-IP'] = forwardedIp;
      }
      const response = await fetch(fullUrl, {
        method: 'GET',
        headers: this.buildHeaders(extraHeaders)
      });
      const rawText = await response.text().catch(() => '');
      let parsed: any = null;
      try {
        parsed = rawText ? JSON.parse(rawText) : null;
      } catch {
        parsed = null;
      }
      return { response, rawText, parsed };
    };

    try {
      const cleanClientIp = clientIp ? clientIp.split(',')[0].trim() : undefined;
      let { response, rawText, parsed } = await executeGoXtopCheckRequest(cleanClientIp);

      // If clientIp triggered IP_NOT_ALLOWED on GoXtop, immediately retry without X-Forwarded-For (using server IP)
      if (cleanClientIp && response.status === 403 && parsed?.code === 'IP_NOT_ALLOWED') {
        const retryResult = await executeGoXtopCheckRequest(undefined);
        if (retryResult.response.ok || retryResult.parsed?.code !== 'IP_NOT_ALLOWED') {
          response = retryResult.response;
          rawText = retryResult.rawText;
          parsed = retryResult.parsed;
        }
      }

      const latencyMs = Date.now() - startTime;

      if (response.status >= 200 && response.status < 300 && parsed && parsed.success !== false) {
        const resolvedName =
          parsed.username ||
          parsed.player_name ||
          parsed.nickname ||
          parsed.name ||
          parsed.data?.username ||
          parsed.data?.nickname ||
          parsed.data?.name;

        if (resolvedName) {
          const regionReturned = parsed.region || parsed.country || parsed.data?.region || resolvedRegion;
          const uidReturned = String(parsed.uid || parsed.user_id || parsed.data?.uid || characterId);

          this.logApi(
            'CHECK_PLAYER',
            'GET',
            fullUrl,
            response.status,
            latencyMs,
            'Connexion réussie',
            true,
            reqPreview,
            rawText.slice(0, 800)
          );

          return {
            supported: true,
            verified: true,
            playerName: String(resolvedName),
            playerId: uidReturned,
            region: regionReturned ? String(regionReturned) : undefined,
            game: parsed.game || spec.name,
            code: 'VERIFIED',
            httpStatus: response.status,
            endpointCalled: fullUrl,
            rawResponse: parsed,
            message: `ID valide — Joueur confirmé par GoXtop : ${resolvedName}${regionReturned ? ` (Région : ${regionReturned})` : ''}`
          };
        }
      }

      const goxtopErrorMsg =
        parsed?.message ||
        parsed?.error ||
        `Impossible de vérifier l'ID auprès de GoXtop (HTTP ${response.status}).`;
      const goxtopErrorCode = parsed?.code || (response.status === 404 ? 'PLAYER_NOT_FOUND' : `HTTP_${response.status}`);
      const detectedIp = parsed?.ip ? String(parsed.ip) : undefined;

      const detailedErrorMessage =
        goxtopErrorCode === 'IP_NOT_ALLOWED'
          ? `Erreur GoXtop (HTTP ${response.status} - ${goxtopErrorCode}) : ${goxtopErrorMsg}${detectedIp ? ` [IP détectée par GoXtop : ${detectedIp}]` : ''}. Autorisez cette IP dans votre tableau de bord GoXtop API Key.`
          : `Erreur GoXtop (HTTP ${response.status}) : ${goxtopErrorMsg}`;

      this.logApi(
        'CHECK_PLAYER',
        'GET',
        fullUrl,
        response.status,
        latencyMs,
        response.status === 404 ? 'Joueur introuvable (404)' : 'Échec de vérification',
        false,
        reqPreview,
        rawText.slice(0, 800)
      );

      return {
        supported: true,
        verified: false,
        playerId: characterId,
        region: resolvedRegion,
        game: spec.name,
        code: goxtopErrorCode,
        httpStatus: response.status,
        endpointCalled: fullUrl,
        ipDetected: detectedIp,
        rawResponse: parsed || { raw: rawText.slice(0, 300) },
        message: detailedErrorMessage
      };
    } catch (err: any) {
      const latencyMs = Date.now() - startTime;
      this.logApi('CHECK_PLAYER', 'GET', fullUrl, null, latencyMs, 'Erreur réseau', false, reqPreview, err.message);
      return {
        supported: true,
        verified: false,
        playerId: characterId,
        code: 'NETWORK_ERROR',
        httpStatus: null,
        endpointCalled: fullUrl,
        message: `Erreur réseau lors de la requête GoXtop Name Checker : ${err.message}`
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
    verifiedPlayerName?: string;
    raw?: any;
    message?: string;
  }> {
    const startTime = Date.now();
    const statusPath = this.provider.endpoints?.orderStatusPath || '/api/v.1/:partner_orderid';
    const fullUrl = this.buildUrl(statusPath, { partner_orderid: partnerOrderId, id: partnerOrderId });

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
        this.logApi('GET_ORDER_STATUS', 'GET', fullUrl, response.status, latencyMs, 'Échec de connexion', false, undefined, rawText.slice(0, 300), undefined, partnerOrderId);
        return { success: false, message: `HTTP ${response.status}` };
      }

      const parsed = JSON.parse(rawText);
      const dataObj = parsed?.data || parsed;
      const remoteStatus = String(dataObj?.status || parsed?.status || '').toLowerCase();
      const providerOrderId = String(
        dataObj?.reference ||
        dataObj?.provider_order_id ||
        dataObj?.id ||
        dataObj?.order_id ||
        parsed?.reference ||
        parsed?.id ||
        ''
      );
      const verifiedPlayerName = dataObj?.username ? String(dataObj.username) : undefined;

      let mappedStatus: OrderStatus = 'processing';
      if (['completed', 'success', 'successful', 'delivered'].includes(remoteStatus)) mappedStatus = 'completed';
      else if (['failed', 'error', 'rejected'].includes(remoteStatus)) mappedStatus = 'failed';
      else if (['cancelled', 'canceled'].includes(remoteStatus)) mappedStatus = 'cancelled';
      else if (['refunded'].includes(remoteStatus)) mappedStatus = 'refunded';

      this.logApi('GET_ORDER_STATUS', 'GET', fullUrl, response.status, latencyMs, 'Connexion réussie', true, undefined, rawText.slice(0, 400), undefined, partnerOrderId);

      return {
        success: true,
        status: mappedStatus,
        providerOrderId: providerOrderId || undefined,
        verifiedPlayerName,
        raw: parsed
      };
    } catch (err: any) {
      this.logApi('GET_ORDER_STATUS', 'GET', fullUrl, null, Date.now() - startTime, 'Erreur réseau', false, undefined, err.message, undefined, partnerOrderId);
      return { success: false, message: err.message };
    }
  }

  /**
   * Documented Endpoint: POST /api/v.1/:partner_orderid/track
   */
  public async trackOrder(partnerOrderId: string): Promise<{
    success: boolean;
    status?: OrderStatus;
    providerOrderId?: string;
    raw?: any;
    message?: string;
  }> {
    const startTime = Date.now();
    const trackPath = this.provider.endpoints?.trackOrderPath || '/api/v.1/:partner_orderid/track';
    const fullUrl = this.buildUrl(trackPath, { partner_orderid: partnerOrderId, id: partnerOrderId });

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
        this.logApi('TRACK_ORDER', 'POST', fullUrl, response.status, latencyMs, 'Échec de connexion', false, undefined, rawText.slice(0, 300), partnerOrderId, partnerOrderId);
        return { success: false, message: `HTTP ${response.status}` };
      }

      const parsed = JSON.parse(rawText);
      const dataObj = parsed?.data || parsed;
      const remoteStatus = String(dataObj?.status || parsed?.status || '').toLowerCase();
      const providerOrderId = String(
        dataObj?.reference ||
        dataObj?.provider_order_id ||
        dataObj?.id ||
        parsed?.reference ||
        ''
      );

      let mappedStatus: OrderStatus = 'processing';
      if (['completed', 'success', 'successful', 'delivered'].includes(remoteStatus)) mappedStatus = 'completed';
      else if (['failed', 'error', 'rejected'].includes(remoteStatus)) mappedStatus = 'failed';
      else if (['cancelled', 'canceled'].includes(remoteStatus)) mappedStatus = 'cancelled';
      else if (['refunded'].includes(remoteStatus)) mappedStatus = 'refunded';

      this.logApi('TRACK_ORDER', 'POST', fullUrl, response.status, latencyMs, 'Connexion réussie', true, undefined, rawText.slice(0, 400), partnerOrderId, partnerOrderId);

      return {
        success: true,
        status: mappedStatus,
        providerOrderId: providerOrderId || undefined,
        raw: parsed
      };
    } catch (err: any) {
      this.logApi('TRACK_ORDER', 'POST', fullUrl, null, Date.now() - startTime, 'Erreur réseau', false, undefined, err.message, partnerOrderId, partnerOrderId);
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
          verifiedPlayerName: statusCheck.verifiedPlayerName,
          httpStatus: 200,
          latencyMs: Date.now() - startTime,
          rawResponse: statusCheck.raw || existingProviderOrder.response_payload
        };
      }

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

    // Build payload for POST /api/v.1/create using exact documented GoXtop parameters:
    // game, denom, userid, serverid, charname, partner_webhook_url, partner_orderid
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

    // GoXtop requires partner_webhook_url to be HTTPS
    const httpsWebhookUrl = webhookCallbackUrl.startsWith('http://localhost')
      ? `https://ais-dev-x2ludovvteawsky54uj7vr-266949098099.europe-west2.run.app/api/webhooks/${this.provider.slug || 'goxtop'}`
      : webhookCallbackUrl.replace(/^http:\/\//i, 'https://');

    const requestPayload: Record<string, any> = {
      game: order.externalGameId || order.gameId,
      denom: order.externalProductId || order.packageId,
      userid: resolvedUserId,
      serverid: resolvedServerId || '',
      charname: resolvedCharName || '',
      partner_webhook_url: httpsWebhookUrl,
      partner_orderid: order.partnerOrderId,
      ...customEntries
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

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

      const dataObj = parsed?.data || parsed;

      // Handle HTTP 2xx OR HTTP 409 Duplicate partner_orderid with existing order data
      if (
        (httpStatus >= 200 && httpStatus < 300 && parsed && !parsed.error && parsed.success !== false) ||
        (httpStatus === 409 && dataObj && (dataObj.reference || dataObj.orderid))
      ) {
        const providerOrderId = String(
          dataObj?.reference ||
          dataObj?.provider_order_id ||
          parsed?.reference ||
          parsed?.id ||
          parsed?.order_id ||
          dataObj?.orderid ||
          order.partnerOrderId
        );
        const remoteStatusRaw = String(dataObj?.status || parsed?.status || 'pending').toLowerCase();
        const mappedStatus: OrderStatus =
          ['completed', 'success', 'successful', 'delivered'].includes(remoteStatusRaw)
            ? 'completed'
            : ['failed', 'error', 'rejected'].includes(remoteStatusRaw)
            ? 'failed'
            : ['refunded'].includes(remoteStatusRaw)
            ? 'refunded'
            : 'processing';
        const verifiedNameFromOrder = dataObj?.username ? String(dataObj.username) : undefined;

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
          rawText.slice(0, 600),
          order.orderNumber,
          order.partnerOrderId
        );

        return {
          accepted: mappedStatus !== 'failed',
          status: mappedStatus,
          externalOrderId: providerOrderId,
          verifiedPlayerName: verifiedNameFromOrder,
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
        rawText.slice(0, 600),
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
   * - Official GoXtop X-Webhook-Timestamp + X-Webhook-Signature HMAC-SHA256 verification
   * - Dedicated handling for internal "TEST_WEBHOOK" diagnostic event (never creates order or debits balance)
   * - Duplicate event rejection (idempotent)
   * - Confirmed status mapping ("successful", "completed", "failed", "refunded") & real-time Webhook Diagnostic Logging
   */
  public async handleWebhook(
    rawBody: string,
    headers: Record<string, any>,
    payload: any
  ): Promise<{ httpCode: number; body: any }> {
    const startTime = Date.now();
    const endpoint = `/api/webhooks/${this.provider.slug}`;
    const isInternalTest = payload?.event_type === 'TEST_WEBHOOK' || payload?.type === 'TEST_WEBHOOK';
    const dataObj = payload?.data || payload;
    const partnerOrderId = String(
      dataObj?.orderid ||
      payload?.partner_orderid ||
      payload?.partner_order_id ||
      payload?.partnerOrderId ||
      payload?.orderid ||
      ''
    );
    const providerOrderId = String(
      dataObj?.reference ||
      dataObj?.provider_order_id ||
      payload?.id ||
      payload?.order_id ||
      payload?.goxtop_order_id ||
      payload?.reference ||
      ''
    );
    const rawStatus = String(dataObj?.status || payload?.status || payload?.order_status || '').toLowerCase();
    const eventType = isInternalTest
      ? 'TEST_WEBHOOK'
      : String(payload?.event || payload?.event_type || (rawStatus ? `ORDER_${rawStatus.toUpperCase()}` : 'WEBHOOK_NOTIFICATION'));

    // 1. Verify HMAC-SHA256 signature
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

    // 5. Map status ONLY when meaning is confirmed (including GoXtop's official "successful" status)
    let mappedStatus: OrderStatus | null = null;
    if (['pending'].includes(rawStatus)) mappedStatus = 'pending';
    else if (['processing', 'in_progress'].includes(rawStatus)) mappedStatus = 'processing';
    else if (['completed', 'success', 'successful', 'delivered'].includes(rawStatus)) mappedStatus = 'completed';
    else if (['failed', 'error', 'rejected'].includes(rawStatus)) mappedStatus = 'failed';
    else if (['cancelled', 'canceled'].includes(rawStatus)) mappedStatus = 'cancelled';
    else if (['refunded'].includes(rawStatus)) mappedStatus = 'refunded';

    if (!mappedStatus) {
      const unconfirmedMsg = `Statut GoXtop "${rawStatus}" non reconnu — REQUIRES GOXTOP DOCUMENTATION`;
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
      order.errorMessage = dataObj?.error || dataObj?.message || payload.error || payload.message || `Statut GoXtop: ${mappedStatus}`;
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

    // 8b. Single Source of Truth: When GoXtop confirms delivery ('completed'), trigger real Push Notification + Email
    if (mappedStatus === 'completed' && order.userId) {
      await NotificationEngine.triggerOrderDeliveredNotifications({
        orderId: order.id,
        orderNumber: order.orderNumber,
        userId: order.userId,
        gameName: order.gameName,
        packageName: order.packageName,
        playerId: order.gameProfileData?.playerId || order.gameProfileData?.characterId,
        deliveredAtIso: order.updatedAt,
        providerName: this.provider.name || 'GoXtop'
      });
    }

    // 9. Notify downstream reseller if applicable
    if (order.resellerId && ['completed', 'failed', 'processing'].includes(mappedStatus)) {
      WebhookEngine.dispatchOrderEvent(order, `order.${mappedStatus}` as any).catch(console.error);
    }

    const okBody = {
      status: 'acknowledged',
      success: true,
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
