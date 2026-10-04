import React, { useState } from 'react';
import { 
  Terminal, Key, Code, Play, CheckCircle2, Copy, 
  Send, Shield, ArrowRight, RefreshCw, AlertCircle 
} from 'lucide-react';
import { Language, translations } from '../../i18n';

interface ApiDocsViewProps {
  onNavigate: (tab: string) => void;
  lang: Language;
}

export const ApiDocsView: React.FC<ApiDocsViewProps> = ({ onNavigate, lang }) => {
  const [activeSection, setActiveSection] = useState<'auth' | 'games' | 'services' | 'orders' | 'status' | 'balance' | 'webhooks'>('auth');
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [codeLanguage, setCodeLanguage] = useState<'curl' | 'js' | 'python'>('curl');

  // Interactive Sandbox state
  const [sandboxApiKey, setSandboxApiKey] = useState('plup_live_99f2b87a1c4e908d1234567890abcdef');
  const [sandboxEndpoint, setSandboxEndpoint] = useState('/api/v1/games');
  const [sandboxMethod, setSandboxMethod] = useState<'GET' | 'POST'>('GET');
  const [sandboxBody, setSandboxBody] = useState(`{\n  "gameId": "game_ff",\n  "serviceId": "srv_ff_diamonds",\n  "packageId": "pkg_ff_100",\n  "gameProfileData": {\n    "playerId": "123456789",\n    "playerName": "AlexGamer"\n  }\n}`);
  const [sandboxResponse, setSandboxResponse] = useState<any>(null);
  const [sandboxLoading, setSandboxLoading] = useState(false);
  const [sandboxStatus, setSandboxStatus] = useState<number | null>(null);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCode(id);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const runSandbox = async () => {
    setSandboxLoading(true);
    setSandboxResponse(null);
    setSandboxStatus(null);
    try {
      const options: RequestInit = {
        method: sandboxMethod,
        headers: {
          'Content-Type': 'application/json',
          'X-API-KEY': sandboxApiKey
        }
      };

      if (sandboxMethod === 'POST' && sandboxBody.trim()) {
        try {
          JSON.parse(sandboxBody);
          options.body = sandboxBody;
        } catch (e) {
          setSandboxResponse({ error: 'JSON malformé dans le corps de requête' });
          setSandboxStatus(400);
          setSandboxLoading(false);
          return;
        }
      }

      const res = await fetch(sandboxEndpoint, options);
      const data = await res.json().catch(() => ({ status: 'raw response', code: res.status }));
      setSandboxStatus(res.status);
      setSandboxResponse(data);
    } catch (err: any) {
      setSandboxStatus(500);
      setSandboxResponse({ error: err.message || 'Échec de connexion au serveur' });
    } finally {
      setSandboxLoading(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-12">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-6 border-b border-slate-200">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-orange-600 bg-orange-50 px-3 py-1 rounded-full mb-2">
            <span>PlayUp REST API v1.0</span>
            <span aria-hidden="true">·</span>
            <span>Haute Disponibilité</span>
          </div>
          <h1 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900">
            Documentation API Développeurs & Resellers
          </h1>
          <p className="text-sm text-slate-600 mt-2 leading-relaxed">
            Intégrez les recharges Free Fire, PUBG Mobile, MLBB et Roblox dans vos applications, sites web ou bots de vente avec livraison automatisée et webhooks instantanés.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => onNavigate('reseller')}
            className="px-4 py-2.5 bg-orange-600 hover:bg-orange-500 text-white text-xs font-semibold rounded-xl shadow-xs transition-colors flex items-center gap-2"
          >
            <Key className="w-3.5 h-3.5" />
            <span>Obtenir ma Clé d’API</span>
          </button>
        </div>
      </div>

      {/* Main Layout: Left Navigation + Right Content */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Navigation Bar */}
        <div className="lg:col-span-3 space-y-1.5 lg:sticky lg:top-24">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 px-3 block mb-2">
            Endpoints & Guides
          </span>

          {[
            { id: 'auth', label: '1. Authentification', method: 'HEADER' },
            { id: 'games', label: '2. Liste des jeux', method: 'GET' },
            { id: 'services', label: '3. Services & Tarifs', method: 'GET' },
            { id: 'orders', label: '4. Créer une commande', method: 'POST' },
            { id: 'status', label: '5. Statut d’une commande', method: 'GET' },
            { id: 'balance', label: '6. Solde revendeur', method: 'GET' },
            { id: 'webhooks', label: '7. Webhooks & Signatures', method: 'EVENT' }
          ].map(item => (
            <button
              key={item.id}
              onClick={() => setActiveSection(item.id as any)}
              className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all flex items-center justify-between ${
                activeSection === item.id
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <span>{item.label}</span>
              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                item.method === 'POST' ? 'bg-emerald-500/20 text-emerald-400' :
                item.method === 'GET' ? 'bg-blue-500/20 text-blue-400' : 'bg-slate-700 text-slate-300'
              }`}>
                {item.method}
              </span>
            </button>
          ))}

          {/* Quick Sandbox jump */}
          <div className="pt-6 border-t border-slate-200 mt-6">
            <a
              href="#sandbox-console"
              className="w-full py-2.5 px-3 border border-orange-200 bg-orange-50 hover:bg-orange-100 text-orange-800 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
            >
              <Terminal className="w-3.5 h-3.5 text-orange-600" />
              <span>Tester dans la console Sandbox</span>
            </a>
          </div>
        </div>

        {/* Right Content Area */}
        <div className="lg:col-span-9 space-y-10">
          {/* SECTION: AUTHENTICATION */}
          {activeSection === 'auth' && (
            <section className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 space-y-6 shadow-xs">
              <div className="space-y-2">
                <span className="text-xs font-semibold text-orange-600 uppercase tracking-wider">Sécurité</span>
                <h2 className="font-display text-2xl font-bold text-slate-900">Authentification par Clé d’API</h2>
                <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                  Toutes les requêtes vers l'API PlayUp Reseller doivent être authentifiées en passant votre clé d'API secrète dans l'en-tête HTTP <code className="bg-slate-100 text-orange-700 px-2 py-0.5 rounded font-mono text-xs">X-API-KEY</code> ou via <code className="bg-slate-100 text-orange-700 px-2 py-0.5 rounded font-mono text-xs">Authorization: Bearer &lt;CLE&gt;</code>.
                </p>
              </div>

              <div className="bg-slate-900 text-slate-200 rounded-2xl p-5 font-mono text-xs overflow-x-auto relative">
                <div className="text-slate-400 mb-2">// Exemple d'en-tête HTTP</div>
                <div className="text-emerald-400">X-API-KEY: plup_live_99f2b87a1c4e908d1234567890abcdef</div>
                <div>Content-Type: application/json</div>
                <div>Accept: application/json</div>
              </div>

              <div className="border border-amber-200 bg-amber-50 rounded-2xl p-4 text-xs text-amber-900 flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <strong className="block font-semibold">Conservez votre clé d'API confidentielle</strong>
                  Ne transmettez jamais votre clé d'API côté client dans une application front-end publique. Les appels API doivent être exécutés depuis votre propre serveur backend.
                </div>
              </div>
            </section>
          )}

          {/* SECTION: GET GAMES */}
          {activeSection === 'games' && (
            <section className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 space-y-6 shadow-xs">
              <div className="flex items-center gap-3">
                <span className="px-2.5 py-1 bg-blue-100 text-blue-700 font-mono text-xs font-bold rounded-lg">GET</span>
                <span className="font-mono text-sm font-semibold text-slate-900">/api/v1/games</span>
              </div>

              <p className="text-xs sm:text-sm text-slate-600">
                Renvoie la liste des jeux vidéo actifs et la définition exacte des champs requis pour le profil de chaque joueur (Player ID, Server ID, etc.).
              </p>

              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Exemple de Réponse JSON (200 OK)</h4>
                <div className="bg-slate-900 text-slate-200 rounded-2xl p-5 font-mono text-xs overflow-x-auto">
{`{
  "status": "success",
  "count": 5,
  "data": [
    {
      "id": "game_ff",
      "slug": "free-fire",
      "name": "Free Fire",
      "category": "Battle Royale",
      "fields": [
        {
          "name": "playerName",
          "label": "Nom du joueur",
          "type": "text",
          "required": true
        },
        {
          "name": "playerId",
          "label": "ID du joueur",
          "type": "text",
          "required": true,
          "validationRegex": "^[0-9]{8,12}$"
        }
      ]
    }
  ]
}`}
                </div>
              </div>
            </section>
          )}

          {/* SECTION: GET SERVICES */}
          {activeSection === 'services' && (
            <section className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 space-y-6 shadow-xs">
              <div className="flex items-center gap-3">
                <span className="px-2.5 py-1 bg-blue-100 text-blue-700 font-mono text-xs font-bold rounded-lg">GET</span>
                <span className="font-mono text-sm font-semibold text-slate-900">/api/v1/services</span>
              </div>

              <p className="text-xs sm:text-sm text-slate-600">
                Renvoie tous les services et packages avec vos tarifs de gros préférentiels (prix revendeur).
              </p>

              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Exemple de Réponse JSON (200 OK)</h4>
                <div className="bg-slate-900 text-slate-200 rounded-2xl p-5 font-mono text-xs overflow-x-auto">
{`{
  "status": "success",
  "count": 4,
  "data": [
    {
      "id": "srv_ff_diamonds",
      "gameId": "game_ff",
      "name": "Free Fire Diamonds",
      "packages": [
        {
          "packageId": "pkg_ff_100",
          "name": "100 Diamants",
          "amount": 100,
          "price": 0.95,
          "currency": "USD"
        },
        {
          "packageId": "pkg_ff_310",
          "name": "310 Diamants",
          "amount": 310,
          "price": 2.85,
          "currency": "USD"
        }
      ]
    }
  ]
}`}
                </div>
              </div>
            </section>
          )}

          {/* SECTION: CREATE ORDER */}
          {activeSection === 'orders' && (
            <section className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 space-y-6 shadow-xs">
              <div className="flex items-center gap-3">
                <span className="px-2.5 py-1 bg-emerald-100 text-emerald-700 font-mono text-xs font-bold rounded-lg">POST</span>
                <span className="font-mono text-sm font-semibold text-slate-900">/api/v1/orders</span>
              </div>

              <p className="text-xs sm:text-sm text-slate-600">
                Crée une nouvelle commande, débite instantanément votre solde revendeur et transmet la commande au fournisseur approprié.
              </p>

              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Corps de la Requête (JSON)</h4>
                <div className="bg-slate-900 text-slate-200 rounded-2xl p-5 font-mono text-xs overflow-x-auto">
{`{
  "gameId": "game_ff",
  "serviceId": "srv_ff_diamonds",
  "packageId": "pkg_ff_310",
  "gameProfileData": {
    "playerId": "123456789",
    "playerName": "Robenson"
  }
}`}
                </div>
              </div>

              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Réponse de Succès (201 Created)</h4>
                <div className="bg-slate-900 text-slate-200 rounded-2xl p-5 font-mono text-xs overflow-x-auto">
{`{
  "status": "success",
  "data": {
    "id": "ord_179098829102",
    "orderNumber": "PLUP-2026-98211",
    "status": "pending",
    "gameName": "Free Fire",
    "packageName": "310 Diamants",
    "chargedAmount": 2.85,
    "currency": "USD",
    "createdAt": "2026-10-02T17:10:00Z"
  },
  "remainingBalance": 482.65
}`}
                </div>
              </div>
            </section>
          )}

          {/* SECTION: ORDER STATUS */}
          {activeSection === 'status' && (
            <section className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 space-y-6 shadow-xs">
              <div className="flex items-center gap-3">
                <span className="px-2.5 py-1 bg-blue-100 text-blue-700 font-mono text-xs font-bold rounded-lg">GET</span>
                <span className="font-mono text-sm font-semibold text-slate-900">/api/v1/orders/:id</span>
              </div>

              <p className="text-xs sm:text-sm text-slate-600">
                Récupère le statut en temps réel d'une commande par son ID unique ou son numéro de commande (ex: <code className="bg-slate-100 text-orange-600 px-1 py-0.5 rounded font-mono">PLUP-2026-98210</code>).
              </p>

              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Exemple de Réponse JSON (200 OK)</h4>
                <div className="bg-slate-900 text-slate-200 rounded-2xl p-5 font-mono text-xs overflow-x-auto">
{`{
  "status": "success",
  "data": {
    "orderNumber": "PLUP-2026-98210",
    "status": "completed",
    "providerReference": "SM-20261002-88192",
    "updatedAt": "2026-10-02T16:15:42Z"
  }
}`}
                </div>
              </div>
            </section>
          )}

          {/* SECTION: BALANCE */}
          {activeSection === 'balance' && (
            <section className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 space-y-6 shadow-xs">
              <div className="flex items-center gap-3">
                <span className="px-2.5 py-1 bg-blue-100 text-blue-700 font-mono text-xs font-bold rounded-lg">GET</span>
                <span className="font-mono text-sm font-semibold text-slate-900">/api/v1/balance</span>
              </div>

              <p className="text-xs sm:text-sm text-slate-600">
                Consultez à tout moment votre solde actuel en USD pour anticiper vos approvisionnements.
              </p>

              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Exemple de Réponse JSON</h4>
                <div className="bg-slate-900 text-slate-200 rounded-2xl p-5 font-mono text-xs overflow-x-auto">
{`{
  "status": "success",
  "data": {
    "resellerId": "res_demo_01",
    "company": "Alpha Games Network",
    "balance": 485.50,
    "currency": "USD",
    "status": "active"
  }
}`}
                </div>
              </div>
            </section>
          )}

          {/* SECTION: WEBHOOKS */}
          {activeSection === 'webhooks' && (
            <section className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 space-y-6 shadow-xs">
              <div className="space-y-2">
                <span className="text-xs font-semibold text-orange-600 uppercase tracking-wider">Temps Réel</span>
                <h2 className="font-display text-2xl font-bold text-slate-900">Webhooks & Notifications d'Événements</h2>
                <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                  Ne faites pas de polling constant ! Dès qu'une commande change de statut (<code className="bg-slate-100 text-orange-700 px-1 py-0.5 rounded font-mono">pending → processing → completed</code> ou <code className="bg-slate-100 text-red-700 px-1 py-0.5 rounded font-mono">failed</code>), nos serveurs envoient immédiatement une requête HTTP POST à l'URL que vous avez enregistrée.
                </p>
              </div>

              <div className="space-y-4">
                <h3 className="font-semibold text-slate-900 text-sm">Vérification de la Signature Cryptographique HMAC-SHA256</h3>
                <p className="text-xs text-slate-600">
                  Chaque requête de webhook comprend un en-tête <code className="bg-slate-100 text-orange-600 px-1 py-0.5 rounded font-mono">X-PlayUp-Signature</code> calculé à l'aide de votre <code className="bg-slate-100 text-orange-600 px-1 py-0.5 rounded font-mono">webhookSecret</code>.
                </p>

                <div className="bg-slate-900 text-slate-200 rounded-2xl p-5 font-mono text-xs overflow-x-auto">
{`// Exemple de validation en Node.js
const crypto = require('crypto');

function verifyPlayUpWebhook(rawBody, signature, secret) {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}`}
                </div>
              </div>
            </section>
          )}

          {/* INTERACTIVE SANDBOX CONSOLE */}
          <div id="sandbox-console" className="bg-slate-950 text-white rounded-3xl p-6 sm:p-8 space-y-6 shadow-xl border border-slate-800">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-800">
              <div className="space-y-1">
                <div className="inline-flex items-center gap-2 text-xs font-semibold text-orange-400">
                  <Terminal className="w-4 h-4" />
                  <span>Console Sandbox Interactive</span>
                </div>
                <h3 className="font-display text-xl font-bold">
                  Testez l'API directement en direct
                </h3>
              </div>

              <button
                onClick={runSandbox}
                disabled={sandboxLoading}
                className="px-5 py-2.5 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-xs font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                {sandboxLoading ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Exécution...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>Envoyer la requête</span>
                  </>
                )}
              </button>
            </div>

            {/* Request inputs */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
              <div className="md:col-span-3">
                <label className="text-[11px] font-semibold text-slate-400 block mb-1">Méthode</label>
                <select
                  value={sandboxMethod}
                  onChange={(e) => {
                    const m = e.target.value as any;
                    setSandboxMethod(m);
                    if (m === 'POST') setSandboxEndpoint('/api/v1/orders');
                    else setSandboxEndpoint('/api/v1/games');
                  }}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-orange-500"
                >
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                </select>
              </div>

              <div className="md:col-span-9">
                <label className="text-[11px] font-semibold text-slate-400 block mb-1">Endpoint</label>
                <input
                  type="text"
                  value={sandboxEndpoint}
                  onChange={(e) => setSandboxEndpoint(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-orange-500"
                />
              </div>

              <div className="md:col-span-12">
                <label className="text-[11px] font-semibold text-slate-400 block mb-1">X-API-KEY</label>
                <input
                  type="text"
                  value={sandboxApiKey}
                  onChange={(e) => setSandboxApiKey(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-orange-300 focus:outline-none focus:border-orange-500"
                />
              </div>

              {sandboxMethod === 'POST' && (
                <div className="md:col-span-12">
                  <label className="text-[11px] font-semibold text-slate-400 block mb-1">Corps JSON (Request Body)</label>
                  <textarea
                    rows={6}
                    value={sandboxBody}
                    onChange={(e) => setSandboxBody(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-xs font-mono text-emerald-300 focus:outline-none focus:border-orange-500"
                  />
                </div>
              )}
            </div>

            {/* Response Display */}
            {sandboxResponse && (
              <div className="space-y-2 pt-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-400">Réponse du serveur :</span>
                  <span className={`font-mono font-bold ${
                    sandboxStatus && sandboxStatus >= 200 && sandboxStatus < 300 ? 'text-emerald-400' : 'text-red-400'
                  }`}>
                    HTTP {sandboxStatus}
                  </span>
                </div>
                <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 font-mono text-xs text-slate-200 overflow-x-auto max-h-80">
                  <pre>{JSON.stringify(sandboxResponse, null, 2)}</pre>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
