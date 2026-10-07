import React, { useState, useEffect } from 'react';
import {
  Shield, Key, Eye, EyeOff, CheckCircle2, AlertTriangle, RefreshCw,
  Server, Copy, Check, Plus, Trash2, Activity, Terminal, BookOpen,
  Layers, ArrowRight, Lock, Globe, Sliders, Save
} from 'lucide-react';
import {
  Provider, Game, Service, ProviderApiLog, ConnectionTestResult, ProviderCustomParam,
  ProviderEndpointsConfig, ProviderOrder, ProviderWebhookLog, WebhookTestResult
} from '../../types';
import { apiClient } from '../../services/apiClient';

interface GoXtopAdminPanelProps {
  token: string;
  providers: Provider[];
  games: Game[];
  services: Service[];
  onRefreshData: () => Promise<void>;
}

export const GoXtopAdminPanel: React.FC<GoXtopAdminPanelProps> = ({
  token,
  providers,
  games,
  services,
  onRefreshData
}) => {
  // Default to GoXtop provider
  const [selectedProviderId, setSelectedProviderId] = useState<string>('prov_goxtop');
  const [subTab, setSubTab] = useState<'config' | 'webhook' | 'products' | 'logs' | 'docs'>('config');

  const currentProvider = providers.find(p => p.id === selectedProviderId || p.slug === 'goxtop') || providers[0];

  // Form state for Configuration API
  const [name, setName] = useState('');
  const [apiUrl, setApiUrl] = useState('');
  const [environment, setEnvironment] = useState<'production' | 'sandbox'>('production');
  const [authHeaderName, setAuthHeaderName] = useState('x-api-key');
  const [isActive, setIsActive] = useState(true);
  const [priority, setPriority] = useState(1);

  // Secret fields state
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [isApiKeyRevealed, setIsApiKeyRevealed] = useState(false);
  const [webhookSecretInput, setWebhookSecretInput] = useState('');
  const [isWebhookSecretRevealed, setIsWebhookSecretRevealed] = useState(false);

  // Optional partner/merchant fields
  const [showOptionalPartnerFields, setShowOptionalPartnerFields] = useState(false);
  const [partnerId, setPartnerId] = useState('');
  const [merchantId, setMerchantId] = useState('');
  const [memberId, setMemberId] = useState('');

  // Configurable endpoint paths (Documented GoXtop API v.1)
  const [endpoints, setEndpoints] = useState<ProviderEndpointsConfig>({
    getGamesPath: '/api/v.1/games',
    getProductsPath: '/api/v.1/products/{game}',
    createOrderPath: '/api/v.1/create',
    orderStatusPath: '/api/v.1/:partner_orderid',
    trackOrderPath: '/api/v.1/:id/track',
    checkPlayerPath: 'REQUIRES GOXTOP DOCUMENTATION'
  });

  // Dynamic additional parameters required by official documentation
  const [customParams, setCustomParams] = useState<ProviderCustomParam[]>([]);

  // UI feedback states
  const [saving, setSaving] = useState(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);
  const [saveErrorMsg, setSaveErrorMsg] = useState<string | null>(null);

  // Connection test state
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionResult, setConnectionResult] = useState<ConnectionTestResult | null>(null);

  // Sync state
  const [syncingType, setSyncingType] = useState<'games' | 'products' | 'prices' | null>(null);
  const [syncFeedback, setSyncFeedback] = useState<{
    success: boolean;
    statusLabel: string;
    details: string;
    httpStatus: number | null;
    latencyMs: number;
    gamesRetrieved?: number;
    productsRetrieved?: number;
    productsAdded?: number;
    productsUpdated?: number;
    productsDeactivated?: number;
    providerErrorMessage?: string;
  } | null>(null);

  // Editable catalog mapping state
  const [editableServices, setEditableServices] = useState<Service[]>([]);
  const [savingCatalogId, setSavingCatalogId] = useState<string | null>(null);

  // Logs, Webhook Logs & ProviderOrders state
  const [apiLogs, setApiLogs] = useState<ProviderApiLog[]>([]);
  const [webhookLogs, setWebhookLogs] = useState<ProviderWebhookLog[]>([]);
  const [providerOrders, setProviderOrders] = useState<ProviderOrder[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  // Webhook internal test state
  const [testingWebhook, setTestingWebhook] = useState(false);
  const [webhookTestResult, setWebhookTestResult] = useState<WebhookTestResult | null>(null);
  const [selectedWebhookLogId, setSelectedWebhookLogId] = useState<string | null>(null);
  const [liveWebhookPolling, setLiveWebhookPolling] = useState<boolean>(true);

  // API Logs Inspector & Filter state
  const [selectedApiLogId, setSelectedApiLogId] = useState<string | null>(null);
  const [apiLogTypeFilter, setApiLogTypeFilter] = useState<string>('ALL');
  const [apiLogOnlyErrors, setApiLogOnlyErrors] = useState<boolean>(false);
  const [apiLogSearch, setApiLogSearch] = useState<string>('');
  const [liveApiLogsPolling, setLiveApiLogsPolling] = useState<boolean>(true);

  // New provider modal
  const [showNewProviderModal, setShowNewProviderModal] = useState(false);
  const [newProvName, setNewProvName] = useState('');
  const [newProvUrl, setNewProvUrl] = useState('');
  const [newProvKey, setNewProvKey] = useState('');

  // Copied webhook state
  const [copiedWebhook, setCopiedWebhook] = useState(false);

  // Synchronize local form state when selected provider changes
  useEffect(() => {
    if (!currentProvider) return;
    setName(currentProvider.name);
    setApiUrl(currentProvider.apiUrl);
    setEnvironment(currentProvider.environment || 'production');
    setAuthHeaderName(currentProvider.authHeaderName || 'x-api-key');
    setIsActive(currentProvider.isActive);
    setPriority(currentProvider.priority || 1);
    setPartnerId(currentProvider.partnerId || '');
    setMerchantId(currentProvider.merchantId || '');
    setMemberId(currentProvider.memberId || '');
    setShowOptionalPartnerFields(Boolean(currentProvider.partnerId || currentProvider.merchantId || currentProvider.memberId));
    setEndpoints(
      currentProvider.endpoints || {
        getGamesPath: '/api/v.1/games',
        getProductsPath: '/api/v.1/products/{game}',
        createOrderPath: '/api/v.1/create',
        orderStatusPath: '/api/v.1/:partner_orderid',
        trackOrderPath: '/api/v.1/:id/track',
        checkPlayerPath: 'REQUIRES GOXTOP DOCUMENTATION'
      }
    );
    setCustomParams(currentProvider.customParams || []);
    setApiKeyInput(currentProvider.hasApiKey ? '••••••••••••••••' : '');
    setIsApiKeyRevealed(false);
    setWebhookSecretInput(currentProvider.hasWebhookSecret ? '••••••••••••••••' : '');
    setIsWebhookSecretRevealed(false);
    setConnectionResult(null);
    setSaveSuccessMsg(null);
    setSaveErrorMsg(null);
  }, [currentProvider?.id, currentProvider?.hasApiKey, currentProvider?.hasWebhookSecret]);

  useEffect(() => {
    setEditableServices(JSON.parse(JSON.stringify(services)));
  }, [services]);

  useEffect(() => {
    if (currentProvider) {
      loadProviderLogs(currentProvider.id);
    }
  }, [subTab, currentProvider?.id]);

  // Real-time polling for Webhook Diagnostic & API Logs views
  useEffect(() => {
    if (!currentProvider) return;
    const shouldPoll =
      (subTab === 'webhook' && liveWebhookPolling) ||
      (subTab === 'logs' && liveApiLogsPolling);
    if (!shouldPoll) return;

    const timer = setInterval(() => {
      loadProviderLogs(currentProvider.id, true);
    }, 3000);
    return () => clearInterval(timer);
  }, [subTab, currentProvider?.id, liveWebhookPolling, liveApiLogsPolling]);

  const formatJsonPretty = (raw?: string | any): string => {
    if (!raw) return '—';
    if (typeof raw === 'object') {
      try {
        return JSON.stringify(raw, null, 2);
      } catch {
        return String(raw);
      }
    }
    try {
      const parsed = JSON.parse(raw);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return String(raw);
    }
  };

  const loadProviderLogs = async (provId: string, silent = false) => {
    if (!silent) setLoadingLogs(true);
    try {
      const [logs, whLogs, pOrders] = await Promise.all([
        apiClient.getProviderApiLogs(token, provId),
        apiClient.getProviderWebhookLogs(token, provId),
        apiClient.getProviderOrders(token)
      ]);
      setApiLogs(logs);
      setWebhookLogs(whLogs);
      setProviderOrders(pOrders);
      if (logs.length > 0 && !selectedApiLogId) {
        setSelectedApiLogId(logs[0].id);
      }
      if (whLogs.length > 0 && !selectedWebhookLogId) {
        setSelectedWebhookLogId(whLogs[0].id);
      }
    } catch (err) {
      console.error(err);
    } finally {
      if (!silent) setLoadingLogs(false);
    }
  };

  const handleTestWebhook = async (simulateInvalidSignature = false) => {
    if (!currentProvider) return;
    setTestingWebhook(true);
    setWebhookTestResult(null);
    setSaveErrorMsg(null);
    try {
      const res = await apiClient.testProviderWebhook(token, currentProvider.id, {
        simulateInvalidSignature
      });
      setWebhookTestResult(res.result);
      const updatedWhLogs = res.webhookLogs || [];
      setWebhookLogs(updatedWhLogs);
      if (updatedWhLogs.length > 0) {
        setSelectedWebhookLogId(updatedWhLogs[0].id);
      }
      await onRefreshData();
      await loadProviderLogs(currentProvider.id, true);
    } catch (err: any) {
      setSaveErrorMsg(err.message || 'Erreur lors du test interne du webhook');
    } finally {
      setTestingWebhook(false);
    }
  };

  const fullWebhookUrl = `${window.location.origin}${currentProvider?.webhookUrl || '/api/webhooks/goxtop'}`;

  const handleSaveConfig = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!currentProvider) return;

    setSaving(true);
    setSaveSuccessMsg(null);
    setSaveErrorMsg(null);

    try {
      const payload: any = {
        name,
        apiUrl: apiUrl.trim(),
        environment,
        authHeaderName: authHeaderName.trim() || 'x-api-key',
        isActive,
        priority: Number(priority) || 1,
        partnerId: partnerId.trim(),
        merchantId: merchantId.trim(),
        memberId: memberId.trim(),
        endpoints,
        customParams: customParams.filter(cp => cp.key.trim() !== '')
      };

      // Handle API Key update or clearing
      if (apiKeyInput.trim() === '') {
        payload.clearApiKey = true;
      } else if (!apiKeyInput.includes('••••')) {
        payload.apiKey = apiKeyInput.trim();
      }

      // Handle Webhook Secret update or clearing
      if (webhookSecretInput.trim() === '') {
        payload.clearWebhookSecret = true;
      } else if (!webhookSecretInput.includes('••••')) {
        payload.webhookSecret = webhookSecretInput.trim();
      }

      await apiClient.updateAdminProvider(token, currentProvider.id, payload);
      await onRefreshData();
      setSaveSuccessMsg(`Configuration ${currentProvider.name} enregistrée côté serveur de manière sécurisée.`);
    } catch (err: any) {
      setSaveErrorMsg(err.message || 'Erreur lors de la sauvegarde');
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    if (!currentProvider) return;
    setTestingConnection(true);
    setConnectionResult(null);
    setSaveErrorMsg(null);

    try {
      // Save any pending changes first so the backend tests with the latest input
      await handleSaveConfig();
      const res = await apiClient.testProviderConnection(token, currentProvider.id);
      setConnectionResult(res.testResult);
      await onRefreshData();
      if (subTab === 'logs') {
        loadProviderLogs(currentProvider.id);
      }
    } catch (err: any) {
      setSaveErrorMsg(err.message || 'Erreur lors du test de connexion');
    } finally {
      setTestingConnection(false);
    }
  };

  const handleRunSync = async (syncType: 'games' | 'products' | 'prices') => {
    if (!currentProvider) return;
    setSyncingType(syncType);
    setSyncFeedback(null);
    try {
      const res = await apiClient.syncProviderCatalog(token, currentProvider.id, syncType);
      setSyncFeedback(res);
      await onRefreshData();
    } catch (err: any) {
      setSyncFeedback({
        success: false,
        statusLabel: 'Échec de connexion',
        details: err.message || 'Erreur lors de la synchronisation',
        httpStatus: null,
        latencyMs: 0
      });
    } finally {
      setSyncingType(null);
    }
  };

  const handleSaveServiceMapping = async (srv: Service) => {
    setSavingCatalogId(srv.id);
    try {
      // Recalculate margin for every package
      const updatedPackages = srv.packages.map(pkg => ({
        ...pkg,
        margin: Number((pkg.publicPrice - pkg.supplierCost).toFixed(2))
      }));
      await apiClient.saveAdminService(token, { ...srv, packages: updatedPackages }, false);
      await onRefreshData();
      setSaveSuccessMsg(`Tarifs et IDs produits mis à jour pour ${srv.name}.`);
    } catch (err: any) {
      setSaveErrorMsg(err.message || 'Erreur de sauvegarde');
    } finally {
      setSavingCatalogId(null);
    }
  };

  const handleCreateNewProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProvName.trim() || !newProvUrl.trim()) return;
    try {
      const created = await apiClient.createAdminProvider(token, {
        name: newProvName.trim(),
        apiUrl: newProvUrl.trim(),
        apiKey: newProvKey.trim()
      });
      await onRefreshData();
      setSelectedProviderId(created.id);
      setShowNewProviderModal(false);
      setNewProvName('');
      setNewProvUrl('');
      setNewProvKey('');
    } catch (err: any) {
      setSaveErrorMsg(err.message);
    }
  };

  if (!currentProvider) return null;

  const totalProductsSynced = services
    .filter(s => s.providerId === currentProvider.id)
    .reduce((acc, s) => acc + s.packages.length, 0);
  const provOrdersForCurrent = providerOrders.filter(
    po =>
      (po?.provider || '').toLowerCase() === (currentProvider?.name || '').toLowerCase() ||
      currentProvider?.slug === 'goxtop'
  );
  const ordersSentCount = provOrdersForCurrent.length;
  const ordersProcessingCount = provOrdersForCurrent.filter(po => po.status === 'processing' || po.status === 'pending' || po.status === 'paid').length;
  const ordersCompletedCount = provOrdersForCurrent.filter(po => po.status === 'completed').length;
  const ordersFailedCount = provOrdersForCurrent.filter(po => po.status === 'failed' || po.status === 'cancelled').length;
  const apiErrorsCount = apiLogs.filter(l => !l.success).length + webhookLogs.filter(w => w.httpStatus >= 400).length;

  return (
    <div className="space-y-6">
      {/* Breadcrumb & Interchangeable Provider Selector */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-xs text-slate-500 font-medium">
            <span>Administration</span>
            <span>→</span>
            <span>Fournisseurs</span>
            <span>→</span>
            <span className="text-orange-600 font-semibold">{currentProvider.name}</span>
            <span>→</span>
            <span className="text-slate-900 font-semibold">
              {subTab === 'config' && 'Configuration API'}
              {subTab === 'webhook' && 'Webhook Diagnostic'}
              {subTab === 'products' && 'Synchronisation & Produits'}
              {subTab === 'logs' && 'Logs API'}
              {subTab === 'docs' && 'Documentation d’intégration'}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <h2 className="font-display text-2xl font-bold text-slate-900">
              Intégration Fournisseur : {currentProvider.name}
            </h2>
            <span className={`px-2.5 py-0.5 rounded text-[11px] font-bold uppercase ${
              currentProvider.isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'
            }`}>
              {currentProvider.isActive ? 'Actif' : 'Inactif'}
            </span>
            <span className={`px-2.5 py-0.5 rounded text-[11px] font-bold ${
              currentProvider.hasApiKey ? 'bg-blue-50 text-blue-700' : 'bg-amber-100 text-amber-800'
            }`}>
              {currentProvider.hasApiKey ? 'Clé API enregistrée (Serveur)' : 'Clé API non configurée'}
            </span>
          </div>
        </div>

        {/* Provider Switcher ("Provider" -> "GoXtopProvider" -> future providers) */}
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs font-semibold text-slate-500">Fournisseur :</label>
          <select
            value={currentProvider.id}
            onChange={(e) => setSelectedProviderId(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-900 focus:outline-none focus:border-orange-500"
          >
            {providers.map(p => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.adapterType === 'goxtop' ? 'GoXtopProvider' : 'Provider'})
              </option>
            ))}
          </select>

          <button
            type="button"
            disabled={testingConnection}
            onClick={handleTestConnection}
            className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-xs"
            title="Tester réellement l'authentification avec les identifiants GoXtop enregistrés"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-orange-400 ${testingConnection ? 'animate-spin' : ''}`} />
            <span>{testingConnection ? 'Test GoXtop...' : 'Tester la connexion'}</span>
          </button>

          <button
            onClick={() => setShowNewProviderModal(true)}
            className="px-3 py-2 border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors"
            title="Ajouter un nouveau fournisseur interchangeable"
          >
            <Plus className="w-3.5 h-3.5 text-orange-600" />
            <span>Nouveau fournisseur</span>
          </button>
        </div>
      </div>

      {/* Live Connection Test Banner when triggered from any tab */}
      {connectionResult && subTab !== 'config' && (
        <div className={`p-4 rounded-2xl border text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
          connectionResult.success
            ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
            : 'bg-red-50 border-red-200 text-red-950'
        }`}>
          <div className="space-y-1">
            <div className="flex items-center gap-2 font-bold text-sm">
              {connectionResult.success ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
              )}
              <span>Test de Connexion {currentProvider.name} : {connectionResult.label}</span>
              <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-white/80">
                {connectionResult.httpStatus ? `HTTP ${connectionResult.httpStatus}` : 'NO HTTP'} · {connectionResult.latencyMs}ms
              </span>
            </div>
            <p className="opacity-90">{connectionResult.details}</p>
          </div>
          <button
            onClick={() => setConnectionResult(null)}
            className="text-slate-500 hover:text-slate-800 font-bold self-end sm:self-center"
          >
            ✕
          </button>
        </div>
      )}

      {/* =========================================================
          TABLEAU DE SYNTHÈSE COMPLET GOXTOP (5 BLOCS TEMPS RÉEL)
         ========================================================= */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
        {/* Bloc 1: API */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2 shadow-xs text-xs">
          <div className="flex items-center justify-between">
            <span className="font-bold uppercase tracking-wider text-[11px] text-slate-400">1. API {currentProvider.name}</span>
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
              currentProvider.lastPingStatus === 'online'
                ? 'bg-emerald-100 text-emerald-800'
                : currentProvider.lastPingStatus === 'offline'
                ? 'bg-red-100 text-red-800'
                : 'bg-slate-100 text-slate-600'
            }`}>
              {currentProvider.lastPingStatus === 'online' ? 'Connecté' : currentProvider.lastPingStatus === 'offline' ? 'Échec' : 'Non testé'}
            </span>
          </div>
          <div className="space-y-1 text-slate-600">
            <div className="flex justify-between">
              <span>API Key configurée :</span>
              <strong className={currentProvider.hasApiKey ? 'text-emerald-700' : 'text-amber-700'}>
                {currentProvider.hasApiKey ? 'Oui' : 'Non'}
              </strong>
            </div>
            <div className="flex justify-between">
              <span>Dernier test :</span>
              <span className="font-mono text-[11px] text-slate-800">
                {currentProvider.lastPingAt ? new Date(currentProvider.lastPingAt).toLocaleTimeString() : 'Jamais'}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Diagnostic :</span>
              <span className="font-semibold text-slate-900 truncate max-w-[130px]" title={currentProvider.lastPingLabel}>
                {currentProvider.lastPingLabel || 'Non testé'}
              </span>
            </div>
          </div>
        </div>

        {/* Bloc 2: Webhook */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2 shadow-xs text-xs">
          <div className="flex items-center justify-between">
            <span className="font-bold uppercase tracking-wider text-[11px] text-slate-400">2. Webhook PlayUp</span>
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
              currentProvider.isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'
            }`}>
              {currentProvider.isActive ? 'Actif' : 'Inactif'}
            </span>
          </div>
          <div className="space-y-1 text-slate-600">
            <div className="flex justify-between">
              <span>Dernier événement :</span>
              <strong className="font-mono text-[11px] text-slate-900">
                {currentProvider.lastWebhookEvent || 'Aucun'}
              </strong>
            </div>
            <div className="flex justify-between">
              <span>Code HTTP :</span>
              <span className="font-mono font-bold text-slate-900">
                {currentProvider.lastWebhookHttpStatus ? `HTTP ${currentProvider.lastWebhookHttpStatus}` : '—'}
              </span>
            </div>
            <div className="flex justify-between">
              <span>HMAC-SHA256 :</span>
              <span className="font-semibold text-slate-800 truncate max-w-[135px]" title={currentProvider.lastWebhookHmacStatus || (currentProvider.hasWebhookSecret ? 'Secret configuré' : 'Non applicable (secret non fourni par GoXtop)')}>
                {currentProvider.lastWebhookHmacStatus || (currentProvider.hasWebhookSecret ? 'Secret actif' : 'Non applicable')}
              </span>
            </div>
          </div>
        </div>

        {/* Bloc 3: Synchronisation */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2 shadow-xs text-xs">
          <div className="flex items-center justify-between">
            <span className="font-bold uppercase tracking-wider text-[11px] text-slate-400">3. Synchronisation</span>
            <span className="font-mono text-[10px] font-bold text-orange-600">Catalogue</span>
          </div>
          <div className="space-y-1 text-slate-600">
            <div className="flex justify-between">
              <span>Jeux synchronisés :</span>
              <strong className="font-mono text-slate-900">{games.length}</strong>
            </div>
            <div className="flex justify-between">
              <span>Produits synchronisés :</span>
              <strong className="font-mono text-slate-900">{totalProductsSynced}</strong>
            </div>
            <div className="flex justify-between">
              <span>Dernière sync :</span>
              <span className="font-mono text-[11px] text-slate-800">
                {currentProvider.lastSyncAt ? new Date(currentProvider.lastSyncAt).toLocaleTimeString() : 'Aucune'}
              </span>
            </div>
          </div>
        </div>

        {/* Bloc 4: Commandes */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2 shadow-xs text-xs">
          <div className="flex items-center justify-between">
            <span className="font-bold uppercase tracking-wider text-[11px] text-slate-400">4. Commandes GoXtop</span>
            <span className="font-mono text-[10px] font-bold text-slate-700">Total: {ordersSentCount}</span>
          </div>
          <div className="space-y-1 text-slate-600">
            <div className="flex justify-between">
              <span>En cours :</span>
              <strong className="font-mono text-amber-700">{ordersProcessingCount}</strong>
            </div>
            <div className="flex justify-between">
              <span>Terminées :</span>
              <strong className="font-mono text-emerald-700">{ordersCompletedCount}</strong>
            </div>
            <div className="flex justify-between">
              <span>Échouées :</span>
              <strong className="font-mono text-red-600">{ordersFailedCount}</strong>
            </div>
          </div>
        </div>

        {/* Bloc 5: Logs */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2 shadow-xs text-xs">
          <div className="flex items-center justify-between">
            <span className="font-bold uppercase tracking-wider text-[11px] text-slate-400">5. Logs & Audit</span>
            <button onClick={() => setSubTab('logs')} className="text-[11px] font-bold text-orange-600 hover:underline">
              Voir tout →
            </button>
          </div>
          <div className="space-y-1 text-slate-600">
            <div className="flex justify-between">
              <span>Requêtes API :</span>
              <strong className="font-mono text-slate-900">{apiLogs.length}</strong>
            </div>
            <div className="flex justify-between">
              <span>Événements Webhook :</span>
              <strong className="font-mono text-slate-900">{webhookLogs.length}</strong>
            </div>
            <div className="flex justify-between">
              <span>Erreurs détectées :</span>
              <strong className={`font-mono ${apiErrorsCount > 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                {apiErrorsCount}
              </strong>
            </div>
          </div>
        </div>
      </div>

      {/* Sub-Navigation Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-px overflow-x-auto">
        <button
          onClick={() => setSubTab('config')}
          className={`px-4 py-2.5 text-xs font-semibold border-b-2 whitespace-nowrap flex items-center gap-2 transition-colors ${
            subTab === 'config'
              ? 'border-orange-600 text-orange-600 bg-orange-50/50 rounded-t-xl'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <Sliders className="w-4 h-4" />
          <span>1. Configuration API</span>
        </button>

        <button
          onClick={() => setSubTab('webhook')}
          className={`px-4 py-2.5 text-xs font-semibold border-b-2 whitespace-nowrap flex items-center gap-2 transition-colors ${
            subTab === 'webhook'
              ? 'border-orange-600 text-orange-600 bg-orange-50/50 rounded-t-xl'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <Globe className="w-4 h-4" />
          <span>2. Webhook Diagnostic</span>
        </button>

        <button
          onClick={() => setSubTab('products')}
          className={`px-4 py-2.5 text-xs font-semibold border-b-2 whitespace-nowrap flex items-center gap-2 transition-colors ${
            subTab === 'products'
              ? 'border-orange-600 text-orange-600 bg-orange-50/50 rounded-t-xl'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>3. Synchronisation &amp; Produits</span>
        </button>

        <button
          onClick={() => setSubTab('logs')}
          className={`px-4 py-2.5 text-xs font-semibold border-b-2 whitespace-nowrap flex items-center gap-2 transition-colors ${
            subTab === 'logs'
              ? 'border-orange-600 text-orange-600 bg-orange-50/50 rounded-t-xl'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <Terminal className="w-4 h-4" />
          <span>4. Logs API ({currentProvider.name})</span>
        </button>

        <button
          onClick={() => setSubTab('docs')}
          className={`px-4 py-2.5 text-xs font-semibold border-b-2 whitespace-nowrap flex items-center gap-2 transition-colors ${
            subTab === 'docs'
              ? 'border-orange-600 text-orange-600 bg-orange-50/50 rounded-t-xl'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <BookOpen className="w-4 h-4" />
          <span>5. Documentation d’intégration</span>
        </button>
      </div>

      {/* =========================================================
          SUB-TAB 1: CONFIGURATION API
         ========================================================= */}
      {subTab === 'config' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <form onSubmit={handleSaveConfig} className="lg:col-span-8 bg-white border border-slate-200 rounded-2xl p-6 space-y-6 shadow-xs">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div>
                <h3 className="font-display text-lg font-bold text-slate-900">
                  Paramètres d’Authentification & Endpoints ({currentProvider.name})
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Les clés et secrets sont chiffrés et stockés exclusivement côté serveur. Ils ne sont jamais exposés au frontend public ni à l'application mobile.
                </p>
              </div>
              <Lock className="w-5 h-5 text-orange-600 shrink-0" />
            </div>

            {saveSuccessMsg && (
              <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-900 flex items-center gap-2 font-medium">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{saveSuccessMsg}</span>
              </div>
            )}

            {saveErrorMsg && (
              <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800 flex items-center gap-2 font-medium">
                <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                <span>{saveErrorMsg}</span>
              </div>
            )}

            {/* Primary Configuration Fields */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Nom du fournisseur</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-xs font-semibold text-slate-900 focus:outline-none focus:border-orange-500"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Statut du fournisseur</label>
                <select
                  value={isActive ? 'active' : 'inactive'}
                  onChange={(e) => setIsActive(e.target.value === 'active')}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-xs font-semibold text-slate-900 focus:outline-none focus:border-orange-500"
                >
                  <option value="active">Actif (Autorisé pour les commandes)</option>
                  <option value="inactive">Inactif (Désactivé)</option>
                </select>
              </div>

              <div className="sm:col-span-2">
                <label className="font-semibold text-slate-700 block mb-1">
                  API Base URL <span className="text-orange-600">*</span>
                </label>
                <input
                  type="url"
                  required
                  value={apiUrl}
                  onChange={(e) => setApiUrl(e.target.value)}
                  placeholder="https://goxtop.com"
                  className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-xs font-mono text-slate-900 focus:outline-none focus:border-orange-500"
                />
                <span className="text-[11px] text-slate-400 mt-1 block">
                  URL racine du serveur API {currentProvider.name} (sans slash final).
                </span>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Environment (si pris en charge par {currentProvider.name})
                </label>
                <select
                  value={environment}
                  onChange={(e) => setEnvironment(e.target.value as 'production' | 'sandbox')}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-orange-500"
                >
                  <option value="production">Production (Live)</option>
                  <option value="sandbox">Sandbox / Test (Si disponible sur {currentProvider.name})</option>
                </select>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  En-tête HTTP d’authentification
                </label>
                <input
                  type="text"
                  value={authHeaderName}
                  onChange={(e) => setAuthHeaderName(e.target.value)}
                  placeholder="x-api-key"
                  className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-xs font-mono text-slate-900 focus:outline-none focus:border-orange-500"
                />
                <span className="text-[11px] text-slate-400 mt-1 block">
                  GoXtop utilise l’en-tête standard <code className="font-mono text-slate-700">x-api-key</code>.
                </span>
              </div>
            </div>

            {/* Secure API Key Field */}
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-4 text-xs">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-bold text-slate-900 flex items-center gap-1.5">
                    <Key className="w-3.5 h-3.5 text-orange-600" />
                    <span>API Key ({currentProvider.name})</span>
                  </label>
                  <span className="text-[11px] text-slate-500">
                    {currentProvider.hasApiKey ? 'Clé enregistrée sur le serveur' : 'Aucune clé enregistrée'}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="password"
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    placeholder="Collez une nouvelle API Key pour remplacer celle du serveur..."
                    className="flex-1 bg-white border border-slate-300 rounded-xl px-3 py-2.5 text-xs font-mono text-slate-900 focus:outline-none focus:border-orange-500"
                  />
                  <span className="px-3 py-2.5 bg-slate-100 border border-slate-200 rounded-xl text-[11px] font-semibold text-slate-600 flex items-center gap-1.5 shrink-0">
                    <Lock className="w-3.5 h-3.5 text-slate-500" />
                    <span>Masqué en permanence</span>
                  </span>
                </div>
                <span className="text-[11px] text-slate-500 mt-1 block">
                  Politique de sécurité PlayUp : les clés API ne peuvent jamais être affichées en clair une fois enregistrées.
                </span>
              </div>

              {/* Webhook URL & Webhook Secret */}
              <div className="pt-3 border-t border-slate-200/80 space-y-3">
                <div>
                  <label className="font-bold text-slate-900 block mb-1">
                    Webhook URL PlayUp (Générée automatiquement pour {currentProvider.name})
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={fullWebhookUrl}
                      className="flex-1 bg-slate-100 border border-slate-300 rounded-xl px-3 py-2 text-xs font-mono text-slate-700"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(fullWebhookUrl);
                        setCopiedWebhook(true);
                        setTimeout(() => setCopiedWebhook(false), 2000);
                      }}
                      className="px-3 py-2 bg-white border border-slate-300 hover:bg-slate-100 rounded-xl text-xs font-semibold text-slate-700 flex items-center gap-1.5 shrink-0"
                    >
                      {copiedWebhook ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedWebhook ? 'Copié' : 'Copier'}</span>
                    </button>
                  </div>
                  <span className="text-[11px] text-slate-500 mt-1 block">
                    Renseignez cette URL dans votre dashboard {currentProvider.name} (ou transmise automatiquement via <code className="font-mono">webhook_url</code> lors des commandes).
                  </span>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="font-bold text-slate-900 block">
                      Webhook Secret (Optionnel — uniquement si {currentProvider.name} fournit officiellement un secret)
                    </label>
                    <span className="text-[11px] font-semibold text-slate-600">
                      Webhook signature : <code className="font-mono text-orange-600">HMAC-SHA256</code>
                    </span>
                  </div>
                  <div className="p-2.5 mb-2 bg-white border border-slate-200 rounded-xl flex items-center justify-between text-[11px]">
                    <span className="text-slate-600">
                      Secret fournisseur :{' '}
                      <strong className="text-slate-900">
                        {currentProvider.hasWebhookSecret
                          ? 'Configuré côté serveur (vérification HMAC-SHA256 stricte active)'
                          : 'Non configuré / non fourni par GoXtop'}
                      </strong>
                    </span>
                    <button
                      type="button"
                      onClick={() => setSubTab('webhook')}
                      className="text-orange-600 font-bold hover:underline"
                    >
                      Ouvrir Diagnostic Webhook →
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="password"
                      value={webhookSecretInput}
                      onChange={(e) => setWebhookSecretInput(e.target.value)}
                      placeholder="Laisser vide ou saisir un nouveau Webhook Secret (écriture seule)"
                      className="flex-1 bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-mono text-slate-900 focus:outline-none focus:border-orange-500"
                    />
                    <span className="px-3 py-2 bg-slate-100 border border-slate-200 rounded-xl text-[11px] font-semibold text-slate-600 flex items-center gap-1.5 shrink-0">
                      <Lock className="w-3.5 h-3.5 text-slate-500" />
                      <span>Masqué en permanence</span>
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-500 mt-1 block">
                    Politique de sécurité PlayUp : le Webhook Secret est stocké côté serveur uniquement et ne peut jamais être affiché en clair.
                  </span>
                </div>
              </div>
            </div>

            {/* Optional Partner ID / Merchant ID / Member Code */}
            <div className="border border-slate-200 rounded-2xl p-4 space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-bold text-slate-800 block">
                    Identifiants Partenaire / Marchand (Optionnels)
                  </span>
                  <span className="text-[11px] text-slate-500">
                    N’activez ces champs que si votre documentation ou dashboard {currentProvider.name} les exige explicitement.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowOptionalPartnerFields(!showOptionalPartnerFields)}
                  className="text-xs font-semibold text-orange-600 hover:underline"
                >
                  {showOptionalPartnerFields ? 'Masquer' : 'Afficher les champs'}
                </button>
              </div>

              {showOptionalPartnerFields && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-slate-100">
                  <div>
                    <label className="font-semibold text-slate-600 block mb-1">Partner ID</label>
                    <input
                      type="text"
                      value={partnerId}
                      onChange={(e) => setPartnerId(e.target.value)}
                      placeholder="Optionnel"
                      className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="font-semibold text-slate-600 block mb-1">Merchant ID</label>
                    <input
                      type="text"
                      value={merchantId}
                      onChange={(e) => setMerchantId(e.target.value)}
                      placeholder="Optionnel"
                      className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="font-semibold text-slate-600 block mb-1">Member Code</label>
                    <input
                      type="text"
                      value={memberId}
                      onChange={(e) => setMemberId(e.target.value)}
                      placeholder="Optionnel"
                      className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-mono"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Configurable API Paths */}
            <div className="border border-slate-200 rounded-2xl p-4 space-y-3 text-xs">
              <div>
                <span className="font-bold text-slate-800 block">
                  Chemins des Endpoints API ({currentProvider.name})
                </span>
                <span className="text-[11px] text-slate-500">
                  Modifiables directement selon la documentation officielle de votre compte {currentProvider.name} sans toucher au code source.
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="font-semibold text-slate-600 block mb-1">Catalogue Jeux (GET)</label>
                  <input
                    type="text"
                    value={endpoints.getGamesPath}
                    onChange={(e) => setEndpoints({ ...endpoints, getGamesPath: e.target.value })}
                    className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-600 block mb-1">Produits par Jeu (GET)</label>
                  <input
                    type="text"
                    value={endpoints.getProductsPath}
                    onChange={(e) => setEndpoints({ ...endpoints, getProductsPath: e.target.value })}
                    className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-600 block mb-1">Création Commande (POST)</label>
                  <input
                    type="text"
                    value={endpoints.createOrderPath}
                    onChange={(e) => setEndpoints({ ...endpoints, createOrderPath: e.target.value })}
                    className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-600 block mb-1">Statut par Partner Order ID (GET)</label>
                  <input
                    type="text"
                    value={endpoints.orderStatusPath}
                    onChange={(e) => setEndpoints({ ...endpoints, orderStatusPath: e.target.value })}
                    className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-600 block mb-1">Suivi Commande Track (POST)</label>
                  <input
                    type="text"
                    value={endpoints.trackOrderPath}
                    onChange={(e) => setEndpoints({ ...endpoints, trackOrderPath: e.target.value })}
                    className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-600 block mb-1">Name Checker GoXtop (POST)</label>
                  <input
                    type="text"
                    value={endpoints.checkPlayerPath}
                    onChange={(e) => setEndpoints({ ...endpoints, checkPlayerPath: e.target.value })}
                    className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-mono"
                  />
                </div>
              </div>
            </div>

            {/* Dynamic Custom Parameters */}
            <div className="border border-slate-200 rounded-2xl p-4 space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-bold text-slate-800 block">
                    Autres paramètres requis par {currentProvider.name}
                  </span>
                  <span className="text-[11px] text-slate-500">
                    Ajoutez des paramètres personnalisés uniquement si la documentation officielle {currentProvider.name} les exige.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setCustomParams([...customParams, { key: '', value: '' }])}
                  className="px-2.5 py-1 bg-orange-50 text-orange-700 font-semibold rounded-lg text-xs"
                >
                  + Ajouter un paramètre
                </button>
              </div>

              {customParams.length > 0 && (
                <div className="space-y-2 pt-2">
                  {customParams.map((cp, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="Nom du paramètre (ex: region)"
                        value={cp.key}
                        onChange={(e) => {
                          const updated = [...customParams];
                          updated[idx].key = e.target.value;
                          setCustomParams(updated);
                        }}
                        className="flex-1 border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-mono"
                      />
                      <input
                        type="text"
                        placeholder="Valeur"
                        value={cp.value}
                        onChange={(e) => {
                          const updated = [...customParams];
                          updated[idx].value = e.target.value;
                          setCustomParams(updated);
                        }}
                        className="flex-1 border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => setCustomParams(customParams.filter((_, i) => i !== idx))}
                        className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Action Buttons: Save Configuration & Test Connection */}
            <div className="pt-2 flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-3 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white font-semibold rounded-xl text-xs shadow-sm transition-colors flex items-center gap-2"
              >
                <Save className="w-4 h-4" />
                <span>{saving ? 'Enregistrement...' : 'Enregistrer la configuration'}</span>
              </button>

              <button
                type="button"
                disabled={testingConnection}
                onClick={handleTestConnection}
                className="px-5 py-3 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-semibold rounded-xl text-xs shadow-sm transition-colors flex items-center gap-2"
              >
                <RefreshCw className={`w-4 h-4 ${testingConnection ? 'animate-spin' : ''}`} />
                <span>{testingConnection ? 'Appel réel vers GoXtop...' : 'Tester la connexion'}</span>
              </button>
            </div>
          </form>

          {/* Right Column: Live Connection Diagnostic Result & Security Status */}
          <div className="lg:col-span-4 space-y-6">
            {/* Real Connection Test Result Box */}
            <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-xs">
              <div className="flex items-center justify-between">
                <h4 className="font-display font-bold text-sm text-slate-900">
                  Diagnostic de Connexion en Direct
                </h4>
                <Activity className="w-4 h-4 text-orange-600" />
              </div>

              <p className="text-xs text-slate-500 leading-relaxed">
                Le test de connexion effectue un véritable appel HTTP depuis le backend PlayUp vers l’URL configurée. Aucun résultat n’est simulé.
              </p>

              {connectionResult ? (
                <div className={`p-4 rounded-2xl border space-y-3 text-xs ${
                  connectionResult.success
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                    : 'bg-red-50 border-red-200 text-red-950'
                }`}>
                  <div className="flex items-center justify-between">
                    <span className="font-extrabold text-sm flex items-center gap-1.5">
                      {connectionResult.success ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                      )}
                      <span>{connectionResult.label}</span>
                    </span>
                    <span className="font-mono text-[11px] font-bold px-2 py-0.5 rounded bg-white/80">
                      {connectionResult.httpStatus ? `HTTP ${connectionResult.httpStatus}` : 'NO HTTP'} · {connectionResult.latencyMs}ms
                    </span>
                  </div>

                  <p className="text-xs leading-relaxed opacity-90">
                    {connectionResult.details}
                  </p>

                  <div className="pt-2 border-t border-black/10 space-y-1.5 text-[11px] font-mono">
                    <div className="break-all">
                      <span className="opacity-70">Endpoint appelé :</span> <strong>GET {connectionResult.endpointCalled}</strong>
                    </div>
                    {typeof connectionResult.gamesCountDetected === 'number' && (
                      <div>
                        <span className="opacity-70">Catalogue GoXtop détecté :</span>{' '}
                        <strong>{connectionResult.gamesCountDetected} jeux actifs</strong>
                      </div>
                    )}
                    {connectionResult.authHeadersUsed && (
                      <div className="pt-1">
                        <span className="opacity-70 block mb-1">En-têtes d’authentification envoyés (masqués) :</span>
                        <pre className="p-2 rounded-lg bg-slate-900 text-emerald-400 text-[10px] overflow-x-auto">
                          {JSON.stringify(connectionResult.authHeadersUsed, null, 2)}
                        </pre>
                      </div>
                    )}
                    {connectionResult.responseSnippet && (
                      <div className="pt-1">
                        <span className="opacity-70 block mb-1">Extrait de la réponse réelle GoXtop :</span>
                        <pre className="p-2 rounded-lg bg-slate-950 text-slate-200 text-[10px] max-h-36 overflow-y-auto whitespace-pre-wrap break-all">
                          {formatJsonPretty(connectionResult.responseSnippet)}
                        </pre>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs text-slate-600 space-y-1.5">
                  <div className="font-semibold text-slate-800">
                    Dernier état connu : {currentProvider.lastPingLabel || 'Non testé'}
                  </div>
                  {currentProvider.lastPingAt && (
                    <div className="text-[11px] text-slate-400">
                      Testé le {new Date(currentProvider.lastPingAt).toLocaleString()} ({currentProvider.latencyMs}ms)
                    </div>
                  )}
                  <p className="text-[11px] text-slate-500 pt-1">
                    Cliquez sur « Tester la connexion » pour vérifier vos identifiants {currentProvider.name}.
                  </p>
                </div>
              )}

              {/* Diagnostic States Reference */}
              <div className="pt-3 border-t border-slate-100 space-y-1.5 text-[11px] text-slate-500">
                <span className="font-bold text-slate-700 block">États de diagnostic pris en charge :</span>
                <ul className="space-y-1 list-disc list-inside">
                  <li>Connexion réussie (HTTP 200 JSON)</li>
                  <li>API Key invalide (HTTP 401 / Clé absente)</li>
                  <li>Erreur d’authentification (HTTP 403)</li>
                  <li>URL incorrecte (HTTP 404 / URL malformée)</li>
                  <li>Erreur réseau (DNS / Timeout / Connexion refusée)</li>
                  <li>Réponse inattendue du fournisseur (HTML / 500+)</li>
                  <li>Échec de connexion</li>
                </ul>
              </div>
            </div>

            {/* Security Isolation Summary */}
            <div className="bg-slate-900 text-white rounded-2xl p-6 space-y-3">
              <div className="flex items-center gap-2 text-orange-400 text-xs font-bold uppercase tracking-wider">
                <Shield className="w-4 h-4" />
                <span>Isolation de Sécurité</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                Conformément à l'architecture de sécurité PlayUp :
              </p>
              <ul className="text-xs text-slate-300 space-y-1.5">
                <li className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>Clés stockées uniquement dans le coffre serveur</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>Zéro exposition dans le bundle JS public ou mobile</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>Masquage automatique dans tous les journaux API</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>Partner Order ID unique anti-doublon par commande</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================
          SUB-TAB 2: PAGE 'WEBHOOK DIAGNOSTIC' (TEMPS RÉEL & HMAC-SHA256)
         ========================================================= */}
      {subTab === 'webhook' && (() => {
        const selectedWhLog = webhookLogs.find(w => w.id === selectedWebhookLogId) || webhookLogs[0] || null;
        return (
          <div className="space-y-6">
            <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-6 shadow-xs">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-100">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-2.5 py-0.5 rounded bg-orange-100 text-orange-800 font-mono text-[11px] font-bold">
                      WEBHOOK DIAGNOSTIC
                    </span>
                    <h3 className="font-display text-lg font-bold text-slate-900">
                      Diagnostic Webhook en Temps Réel ({currentProvider.name})
                    </h3>
                    <button
                      type="button"
                      onClick={() => setLiveWebhookPolling(!liveWebhookPolling)}
                      className={`px-2.5 py-0.5 rounded text-[11px] font-bold flex items-center gap-1.5 transition-colors ${
                        liveWebhookPolling
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-slate-200 text-slate-700'
                      }`}
                    >
                      <span className={`w-2 h-2 rounded-full ${liveWebhookPolling ? 'bg-emerald-600 animate-ping' : 'bg-slate-500'}`} />
                      <span>{liveWebhookPolling ? 'Écoute Temps Réel Active (3s)' : 'Écoute Temps Réel en Pause'}</span>
                    </button>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    Visualisez en temps réel les événements entrants GoXtop, leur signature cryptographique <code className="font-mono text-slate-800">HMAC-SHA256</code> (si configurée) et le journal détaillé des étapes de traitement.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(fullWebhookUrl);
                      setCopiedWebhook(true);
                      setTimeout(() => setCopiedWebhook(false), 2000);
                    }}
                    className="px-3.5 py-2.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors"
                  >
                    {copiedWebhook ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4 text-slate-600" />}
                    <span>{copiedWebhook ? 'URL copiée !' : 'Copier l’URL Webhook'}</span>
                  </button>

                  <button
                    type="button"
                    disabled={testingWebhook}
                    onClick={() => handleTestWebhook(false)}
                    className="px-4 py-2.5 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold flex items-center gap-2 shadow-xs transition-colors"
                  >
                    <RefreshCw className={`w-4 h-4 ${testingWebhook ? 'animate-spin' : ''}`} />
                    <span>{testingWebhook ? 'Test en cours...' : 'Tester Webhook (HMAC Valide)'}</span>
                  </button>

                  {currentProvider.hasWebhookSecret && (
                    <button
                      type="button"
                      disabled={testingWebhook}
                      onClick={() => handleTestWebhook(true)}
                      className="px-3.5 py-2.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors"
                      title="Envoie une signature HMAC-SHA256 altérée pour vérifier que le serveur rejette bien l'événement avec HTTP 401"
                    >
                      <Shield className="w-3.5 h-3.5 text-amber-400" />
                      <span>Tester Rejet HMAC Invalide</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Webhook Details Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-1 lg:col-span-2">
                  <span className="text-[11px] font-bold uppercase text-slate-400 block">URL de Réception Webhook PlayUp</span>
                  <div className="font-mono text-xs font-bold text-slate-900 break-all">{fullWebhookUrl}</div>
                  <div className="text-[11px] text-slate-500 pt-1">
                    Méthode : <strong className="font-mono text-slate-800">POST</strong> · Corps vérifié : <strong className="font-mono text-slate-800">rawBody brut (non modifié)</strong> · Transmise automatiquement dans <code className="font-mono text-orange-700">partner_webhook_url</code>
                  </div>
                </div>

                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
                  <span className="text-[11px] font-bold uppercase text-slate-400 block">Dernier Événement Entrant</span>
                  <div className="font-mono font-bold text-slate-900">
                    {currentProvider.lastWebhookEvent || 'Aucun événement reçu'}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {currentProvider.lastWebhookReceivedAt
                      ? new Date(currentProvider.lastWebhookReceivedAt).toLocaleString()
                      : 'En attente de notification'}
                  </div>
                  <div className="text-[11px] font-mono font-bold text-slate-700">
                    Dernier statut HTTP : {currentProvider.lastWebhookHttpStatus ? `HTTP ${currentProvider.lastWebhookHttpStatus}` : 'N/A'}
                  </div>
                </div>

                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
                  <span className="text-[11px] font-bold uppercase text-slate-400 block">Sécurité Signature HMAC-SHA256</span>
                  <div className="font-bold text-slate-900">
                    Algorithme : <span className="font-mono text-orange-600">HMAC-SHA256</span>
                  </div>
                  <div className="text-[11px] text-slate-600">
                    Secret configuré :{' '}
                    <strong className={currentProvider.hasWebhookSecret ? 'text-emerald-700' : 'text-amber-700'}>
                      {currentProvider.hasWebhookSecret
                        ? 'Actif côté serveur'
                        : 'Optionnel (Non défini)'}
                    </strong>
                  </div>
                  <div className="text-[11px] text-emerald-700 font-semibold">
                    Validation : crypto.timingSafeEqual
                  </div>
                </div>
              </div>

              {/* Result of "Tester le webhook" button */}
              {webhookTestResult && (
                <div className={`p-4 rounded-2xl border text-xs space-y-3 ${
                  webhookTestResult.success
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                    : 'bg-amber-50 border-amber-300 text-amber-950'
                }`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-bold text-sm flex items-center gap-2">
                      {webhookTestResult.success ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      ) : (
                        <Shield className="w-4 h-4 text-amber-700" />
                      )}
                      <span>Diagnostic Test Webhook : {webhookTestResult.eventType} ({webhookTestResult.resultLabel})</span>
                    </div>
                    <span className="font-mono font-bold px-2.5 py-0.5 rounded bg-white/90">
                      HTTP {webhookTestResult.httpStatus} · {webhookTestResult.latencyMs}ms
                    </span>
                  </div>
                  <p>{webhookTestResult.message}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2 border-t border-black/10 font-mono text-[11px]">
                    <div>
                      Signature détectée : <strong>{webhookTestResult.signatureDetected ? `Oui (${webhookTestResult.signatureHeaderName || 'header'})` : 'Non'}</strong>
                    </div>
                    <div>
                      Signature HMAC reçue : <strong>{webhookTestResult.signatureValueMasked || '—'}</strong>
                    </div>
                    <div>
                      Statut HMAC-SHA256 : <strong>{webhookTestResult.hmacValidation}</strong>
                    </div>
                  </div>
                  {webhookTestResult.processingSteps && webhookTestResult.processingSteps.length > 0 && (
                    <div className="pt-2 border-t border-black/10 space-y-1">
                      <span className="font-bold text-[11px] uppercase tracking-wider opacity-75 block">
                        Logs de traitement exécutés :
                      </span>
                      <div className="bg-slate-900 text-emerald-400 p-3 rounded-xl font-mono text-[11px] space-y-1">
                        {webhookTestResult.processingSteps.map((step, i) => (
                          <div key={i}>{step}</div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Split View: Incoming Webhook Events Table + Detailed Processing & HMAC Inspector */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Left 7 cols: Incoming Events Table */}
              <div className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-xs">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
                  <div>
                    <h4 className="font-display text-base font-bold text-slate-900">
                      Flux des Événements Entrants ({webhookLogs.length})
                    </h4>
                    <p className="text-xs text-slate-500">
                      Cliquez sur un événement entrant pour inspecter sa signature HMAC-SHA256, son payload JSON et ses logs de traitement.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => loadProviderLogs(currentProvider.id)}
                    className="px-3.5 py-2 border border-slate-300 hover:bg-slate-50 rounded-xl text-xs font-semibold flex items-center gap-1.5 self-start shrink-0"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${loadingLogs ? 'animate-spin' : ''}`} />
                    <span>Actualiser</span>
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-100 text-slate-400 font-semibold">
                        <th className="py-2.5 px-2.5">Heure</th>
                        <th className="py-2.5 px-2.5">Événement</th>
                        <th className="py-2.5 px-2.5">partner_orderid</th>
                        <th className="py-2.5 px-2.5">HTTP</th>
                        <th className="py-2.5 px-2.5">HMAC-SHA256</th>
                        <th className="py-2.5 px-2.5 text-right">Diagnostic</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {webhookLogs.map((wlog) => {
                        const isSelected = selectedWhLog?.id === wlog.id;
                        return (
                          <tr
                            key={wlog.id}
                            onClick={() => setSelectedWebhookLogId(wlog.id)}
                            className={`cursor-pointer transition-colors ${
                              isSelected ? 'bg-orange-50/80' : 'hover:bg-slate-50'
                            }`}
                          >
                            <td className="py-2.5 px-2.5 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                              {new Date(wlog.timestamp).toLocaleTimeString()}
                            </td>
                            <td className="py-2.5 px-2.5 font-mono font-bold text-[11px] text-slate-900">
                              {wlog.eventType}
                            </td>
                            <td className="py-2.5 px-2.5 font-mono text-[11px] text-orange-600 font-semibold">
                              {wlog.partnerOrderId || '—'}
                            </td>
                            <td className="py-2.5 px-2.5 font-mono font-bold">
                              <span className={wlog.httpStatus >= 200 && wlog.httpStatus < 300 ? 'text-emerald-600' : 'text-red-600'}>
                                HTTP {wlog.httpStatus}
                              </span>
                            </td>
                            <td className="py-2.5 px-2.5">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                wlog.hmacValidation === 'Validée' || wlog.hmacValidation === 'Valide'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : wlog.hmacValidation === 'Échec' || wlog.hmacValidation === 'Invalide'
                                  ? 'bg-red-100 text-red-800'
                                  : 'bg-slate-100 text-slate-700'
                              }`}>
                                {wlog.hmacValidation}
                              </span>
                            </td>
                            <td className="py-2.5 px-2.5 text-right">
                              <span className="text-[11px] font-bold text-orange-600 hover:underline">
                                Inspecter →
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                      {webhookLogs.length === 0 && (
                        <tr>
                          <td colSpan={6} className="py-8 text-center text-slate-400">
                            Aucun événement webhook reçu. Cliquez sur « Tester Webhook (HMAC Valide) » ci-dessus pour générer un événement de diagnostic en temps réel.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Right 5 cols: Real-Time Webhook Event & HMAC-SHA256 Inspector */}
              <div className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-xs">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <div>
                    <h4 className="font-display font-bold text-sm text-slate-900">
                      Inspecteur Signature HMAC &amp; Logs de Traitement
                    </h4>
                    <p className="text-[11px] text-slate-500">
                      Détails complets du traitement serveur pour l’événement sélectionné
                    </p>
                  </div>
                  <Terminal className="w-4 h-4 text-orange-600 shrink-0" />
                </div>

                {selectedWhLog ? (
                  <div className="space-y-4 text-xs">
                    {/* Event Header Metadata */}
                    <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-bold text-slate-900">{selectedWhLog.eventType}</span>
                        <span className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold ${
                          selectedWhLog.httpStatus >= 200 && selectedWhLog.httpStatus < 300
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-red-100 text-red-800'
                        }`}>
                          HTTP {selectedWhLog.httpStatus} {selectedWhLog.latencyMs !== undefined ? `· ${selectedWhLog.latencyMs}ms` : ''}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono">
                        Horodatage : {new Date(selectedWhLog.timestamp).toLocaleString()}
                      </div>
                      <div className="text-[11px] text-slate-600 font-mono">
                        partner_orderid : <strong className="text-orange-600">{selectedWhLog.partnerOrderId || '—'}</strong> · Statut : <strong>{selectedWhLog.receivedStatus || '—'}</strong>
                      </div>
                    </div>

                    {/* HMAC-SHA256 Signature Verification Block */}
                    <div className="p-3.5 bg-slate-900 text-slate-200 rounded-xl space-y-2 font-mono text-[11px]">
                      <div className="flex items-center justify-between text-orange-400 font-sans font-bold text-xs">
                        <span>Vérification Signature HMAC-SHA256</span>
                        <span className={`px-2 py-0.5 rounded text-[10px] ${
                          selectedWhLog.hmacValidation === 'Validée' || selectedWhLog.hmacValidation === 'Valide'
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : selectedWhLog.hmacValidation === 'Échec'
                            ? 'bg-red-500/20 text-red-300'
                            : 'bg-slate-700 text-slate-300'
                        }`}>
                          {selectedWhLog.hmacValidation}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400">En-tête détecté :</span>{' '}
                        <span className="text-white">{selectedWhLog.signatureDetected ? (selectedWhLog.signatureHeaderName || 'x-goxtop-signature') : 'Aucun en-tête de signature'}</span>
                      </div>
                      <div>
                        <span className="text-slate-400">Signature entrante :</span>{' '}
                        <span className="text-emerald-400 break-all">{selectedWhLog.signatureValueMasked || 'Non fournie'}</span>
                      </div>
                      {selectedWhLog.computedHmacPreview && (
                        <div>
                          <span className="text-slate-400">HMAC calculé (rawBody) :</span>{' '}
                          <span className="text-blue-300 break-all">{selectedWhLog.computedHmacPreview}</span>
                        </div>
                      )}
                    </div>

                    {/* Step-by-Step Processing Logs */}
                    <div className="space-y-1.5">
                      <span className="font-bold text-slate-800 block">
                        Journal de traitement étape par étape :
                      </span>
                      <div className="p-3 bg-slate-950 text-emerald-400 rounded-xl font-mono text-[11px] space-y-1.5 max-h-48 overflow-y-auto">
                        {(selectedWhLog.processingSteps && selectedWhLog.processingSteps.length > 0
                          ? selectedWhLog.processingSteps
                          : [
                              `[1] Réception de l'événement ${selectedWhLog.eventType}`,
                              `[2] Vérification HMAC-SHA256 : ${selectedWhLog.hmacValidation}`,
                              `[3] Réponse PlayUp : HTTP ${selectedWhLog.httpStatus}`
                            ]
                        ).map((step, idx) => (
                          <div key={idx} className="leading-relaxed">{step}</div>
                        ))}
                      </div>
                    </div>

                    {/* Incoming Raw Payload */}
                    {selectedWhLog.rawPayload && (
                      <div className="space-y-1">
                        <span className="font-bold text-slate-800 block">
                          Payload JSON Entrant (Clés sensibles masquées) :
                        </span>
                        <pre className="p-3 bg-slate-100 border border-slate-200 rounded-xl font-mono text-[11px] text-slate-800 max-h-40 overflow-y-auto whitespace-pre-wrap break-all">
                          {formatJsonPretty(selectedWhLog.rawPayload)}
                        </pre>
                      </div>
                    )}

                    {/* PlayUp Backend Response */}
                    <div className="space-y-1">
                      <span className="font-bold text-slate-800 block">
                        Réponse HTTP retournée par PlayUp :
                      </span>
                      <pre className="p-3 bg-slate-100 border border-slate-200 rounded-xl font-mono text-[11px] text-slate-800 max-h-40 overflow-y-auto whitespace-pre-wrap break-all">
                        {formatJsonPretty(selectedWhLog.backendResponse)}
                      </pre>
                    </div>
                  </div>
                ) : (
                  <div className="py-10 text-center text-xs text-slate-400">
                    Sélectionnez un événement webhook dans le tableau ou cliquez sur « Tester Webhook » pour inspecter son traitement.
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* =========================================================
          SUB-TAB 3: GESTION DES PRODUITS & SYNCHRONISATION
         ========================================================= */}
      {subTab === 'products' && (
        <div className="space-y-6">
          {/* Sync Actions Bar */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-xs">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h3 className="font-display text-lg font-bold text-slate-900">
                  Synchronisation Catalogue & Tarifs ({currentProvider.name})
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Lancez une synchronisation directe avec l'API {currentProvider.name} ou configurez le mappage des identifiants produits et vos marges PlayUp.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  onClick={() => handleRunSync('games')}
                  disabled={syncingType !== null}
                  className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded-xl text-xs font-semibold flex items-center gap-2 transition-colors"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${syncingType === 'games' ? 'animate-spin' : ''}`} />
                  <span>Synchroniser les jeux</span>
                </button>

                <button
                  onClick={() => handleRunSync('products')}
                  disabled={syncingType !== null}
                  className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded-xl text-xs font-semibold flex items-center gap-2 transition-colors"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${syncingType === 'products' ? 'animate-spin' : ''}`} />
                  <span>Synchroniser les produits</span>
                </button>

                <button
                  onClick={() => handleRunSync('prices')}
                  disabled={syncingType !== null}
                  className="px-4 py-2.5 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold flex items-center gap-2 transition-colors"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${syncingType === 'prices' ? 'animate-spin' : ''}`} />
                  <span>Synchroniser les prix</span>
                </button>
              </div>
            </div>

            {syncFeedback && (
              <div className={`p-4 rounded-xl border text-xs space-y-2 ${
                syncFeedback.success ? 'bg-emerald-50 border-emerald-200 text-emerald-950' : 'bg-red-50 border-red-200 text-red-950'
              }`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="font-bold text-sm">
                      Résultat de synchronisation : {syncFeedback.statusLabel}{' '}
                      {syncFeedback.httpStatus ? `(Code HTTP ${syncFeedback.httpStatus} · ${syncFeedback.latencyMs}ms)` : '(Aucun code HTTP)'}
                    </div>
                    <p>{syncFeedback.details}</p>
                    {syncFeedback.providerErrorMessage && (
                      <p className="font-mono text-[11px] text-red-700 font-semibold">
                        Message d’erreur GoXtop : {syncFeedback.providerErrorMessage}
                      </p>
                    )}
                  </div>
                  <button onClick={() => setSyncFeedback(null)} className="text-slate-400 hover:text-slate-700">✕</button>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-2 border-t border-black/10 font-mono text-[11px]">
                  <div>Jeux récupérés : <strong>{syncFeedback.gamesRetrieved ?? 0}</strong></div>
                  <div>Produits récupérés : <strong>{syncFeedback.productsRetrieved ?? 0}</strong></div>
                  <div>Produits ajoutés : <strong>{syncFeedback.productsAdded ?? 0}</strong></div>
                  <div>Produits mis à jour : <strong>{syncFeedback.productsUpdated ?? 0}</strong></div>
                  <div>Produits désactivés : <strong>{syncFeedback.productsDeactivated ?? 0}</strong></div>
                </div>
              </div>
            )}
          </div>

          {/* Product Pricing, Margin & GoXtop ID Mapping Table */}
          <div className="space-y-6">
            {editableServices.map((srv, srvIdx) => {
              const game = games.find(g => g.id === srv.gameId);

              return (
                <div key={srv.id} className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-xs">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-orange-600 uppercase">{game?.name}</span>
                        <span className="text-xs text-slate-400">·</span>
                        <span className="text-xs font-mono text-slate-600">
                          GoXtop Game ID: <strong>{srv.externalGameId || game?.externalGameId || 'Non défini'}</strong>
                        </span>
                      </div>
                      <h4 className="font-display text-base font-bold text-slate-900 mt-0.5">
                        {srv.name}
                      </h4>
                    </div>

                    <div className="flex items-center gap-3">
                      <select
                        value={srv.providerId}
                        onChange={(e) => {
                          const copy = [...editableServices];
                          copy[srvIdx].providerId = e.target.value;
                          setEditableServices(copy);
                        }}
                        className="px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-semibold"
                      >
                        {providers.map(p => (
                          <option key={p.id} value={p.id}>Fournisseur : {p.name}</option>
                        ))}
                      </select>

                      <button
                        onClick={() => handleSaveServiceMapping(srv)}
                        disabled={savingCatalogId === srv.id}
                        className="px-4 py-1.5 bg-orange-600 hover:bg-orange-500 text-white rounded-lg text-xs font-semibold transition-colors"
                      >
                        {savingCatalogId === srv.id ? 'Sauvegarde...' : 'Enregistrer les tarifs & IDs'}
                      </button>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-100 text-slate-400 font-semibold">
                          <th className="py-2 px-2">Produit PlayUp</th>
                          <th className="py-2 px-2">ID Jeu GoXtop</th>
                          <th className="py-2 px-2">ID Produit GoXtop</th>
                          <th className="py-2 px-2">Prix Fournisseur ($)</th>
                          <th className="py-2 px-2">Prix Vente PlayUp ($)</th>
                          <th className="py-2 px-2">Prix Reseller ($)</th>
                          <th className="py-2 px-2">Marge PlayUp</th>
                          <th className="py-2 px-2">Champs Requis</th>
                          <th className="py-2 px-2">Disponibilité</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {srv.packages.map((pkg, pkgIdx) => {
                          const playupMargin = Number((pkg.publicPrice - pkg.supplierCost).toFixed(2));
                          return (
                            <tr key={pkg.id} className="hover:bg-slate-50/80">
                              <td className="py-2.5 px-2 font-semibold text-slate-900">{pkg.name}</td>
                              <td className="py-2.5 px-2">
                                <input
                                  type="text"
                                  value={pkg.externalGameId || srv.externalGameId || game?.externalGameId || ''}
                                  onChange={(e) => {
                                    const copy = [...editableServices];
                                    copy[srvIdx].packages[pkgIdx].externalGameId = e.target.value;
                                    setEditableServices(copy);
                                  }}
                                  placeholder="gox_game_id"
                                  className="w-28 border border-slate-200 rounded px-2 py-1 font-mono text-[11px]"
                                />
                              </td>
                              <td className="py-2.5 px-2">
                                <input
                                  type="text"
                                  value={pkg.externalProductId || ''}
                                  onChange={(e) => {
                                    const copy = [...editableServices];
                                    copy[srvIdx].packages[pkgIdx].externalProductId = e.target.value;
                                    setEditableServices(copy);
                                  }}
                                  placeholder="gox_prod_id"
                                  className="w-28 border border-slate-200 rounded px-2 py-1 font-mono text-[11px]"
                                />
                              </td>
                              <td className="py-2.5 px-2">
                                <input
                                  type="number"
                                  step="0.01"
                                  value={pkg.supplierCost}
                                  onChange={(e) => {
                                    const copy = [...editableServices];
                                    copy[srvIdx].packages[pkgIdx].supplierCost = Number(e.target.value);
                                    setEditableServices(copy);
                                  }}
                                  className="w-20 border border-slate-200 rounded px-2 py-1 font-mono text-xs"
                                />
                              </td>
                              <td className="py-2.5 px-2">
                                <input
                                  type="number"
                                  step="0.01"
                                  value={pkg.publicPrice}
                                  onChange={(e) => {
                                    const copy = [...editableServices];
                                    copy[srvIdx].packages[pkgIdx].publicPrice = Number(e.target.value);
                                    setEditableServices(copy);
                                  }}
                                  className="w-20 border border-slate-200 rounded px-2 py-1 font-mono text-xs font-bold text-slate-900"
                                />
                              </td>
                              <td className="py-2.5 px-2">
                                <input
                                  type="number"
                                  step="0.01"
                                  value={pkg.resellerPrice}
                                  onChange={(e) => {
                                    const copy = [...editableServices];
                                    copy[srvIdx].packages[pkgIdx].resellerPrice = Number(e.target.value);
                                    setEditableServices(copy);
                                  }}
                                  className="w-20 border border-slate-200 rounded px-2 py-1 font-mono text-xs text-orange-600 font-bold"
                                />
                              </td>
                              <td className="py-2.5 px-2 font-mono font-bold">
                                <span className={playupMargin >= 0 ? 'text-emerald-600' : 'text-red-600'}>
                                  {playupMargin >= 0 ? '+' : ''}${playupMargin.toFixed(2)}
                                </span>
                              </td>
                              <td className="py-2.5 px-2 font-mono text-[11px] text-slate-500">
                                {(pkg.requiredFields || game?.fields.map(f => f.name) || ['playerId']).join(', ')}
                              </td>
                              <td className="py-2.5 px-2">
                                <input
                                  type="checkbox"
                                  checked={pkg.isActive}
                                  onChange={(e) => {
                                    const copy = [...editableServices];
                                    copy[srvIdx].packages[pkgIdx].isActive = e.target.checked;
                                    setEditableServices(copy);
                                  }}
                                  className="rounded border-slate-300 text-orange-600"
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* =========================================================
          SUB-TAB 4: LOGS API (Administration → Fournisseurs → GoXtop → Logs API)
         ========================================================= */}
      {subTab === 'logs' && (() => {
        const filteredApiLogs = apiLogs.filter(log => {
          if (apiLogTypeFilter !== 'ALL' && log.requestType !== apiLogTypeFilter) return false;
          if (apiLogOnlyErrors && log.success) return false;
          if (apiLogSearch.trim()) {
            const q = apiLogSearch.toLowerCase();
            const matchEndpoint = (log.endpoint || '').toLowerCase().includes(q);
            const matchType = (log.requestType || '').toLowerCase().includes(q);
            const matchOrder = (log.orderId || '').toLowerCase().includes(q) || (log.partnerOrderId || '').toLowerCase().includes(q);
            const matchResp = (log.responsePreview || '').toLowerCase().includes(q) || (log.errorMessage || '').toLowerCase().includes(q);
            if (!matchEndpoint && !matchType && !matchOrder && !matchResp) return false;
          }
          return true;
        });
        const selectedLog = filteredApiLogs.find(l => l.id === selectedApiLogId) || filteredApiLogs[0] || apiLogs[0] || null;

        return (
          <div className="space-y-6">
            {/* Top Bar & Filters for GoXtop API Logs */}
            <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-xs">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-100">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-2.5 py-0.5 rounded bg-slate-900 text-orange-400 font-mono text-[11px] font-bold">
                      Administration → Fournisseurs → {currentProvider.name} → Logs API
                    </span>
                    <button
                      type="button"
                      onClick={() => setLiveApiLogsPolling(!liveApiLogsPolling)}
                      className={`px-2.5 py-0.5 rounded text-[11px] font-bold flex items-center gap-1.5 transition-colors ${
                        liveApiLogsPolling
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-slate-200 text-slate-700'
                      }`}
                    >
                      <span className={`w-2 h-2 rounded-full ${liveApiLogsPolling ? 'bg-emerald-600 animate-ping' : 'bg-slate-500'}`} />
                      <span>{liveApiLogsPolling ? 'Auto-Refresh 3s' : 'Pause'}</span>
                    </button>
                  </div>
                  <h3 className="font-display text-lg font-bold text-slate-900 mt-1">
                    Requêtes &amp; Réponses Réelles de l’API {currentProvider.name} (Clés Sensibles Masquées)
                  </h3>
                  <p className="text-xs text-slate-500">
                    Inspectez les en-têtes HTTP, payloads de requête et réponses JSON réelles de {currentProvider.name} pour diagnostiquer les erreurs de synchronisation et de commandes.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={testingConnection}
                    onClick={handleTestConnection}
                    className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 text-orange-400 ${testingConnection ? 'animate-spin' : ''}`} />
                    <span>Tester Connexion</span>
                  </button>

                  <button
                    onClick={() => loadProviderLogs(currentProvider.id)}
                    className="px-3.5 py-2 border border-slate-300 hover:bg-slate-50 rounded-xl text-xs font-semibold flex items-center gap-1.5"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${loadingLogs ? 'animate-spin' : ''}`} />
                    <span>Actualiser les logs</span>
                  </button>
                </div>
              </div>

              {/* Filter Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex flex-wrap items-center gap-1.5">
                  {(['ALL', 'TEST_CONNECTION', 'GET_GAMES', 'GET_PRODUCTS', 'CREATE_ORDER', 'GET_ORDER_STATUS', 'WEBHOOK_EVENT'] as const).map(type => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setApiLogTypeFilter(type)}
                      className={`px-3 py-1.5 rounded-xl font-mono text-[11px] font-bold transition-colors ${
                        apiLogTypeFilter === type
                          ? 'bg-orange-600 text-white'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      {type === 'ALL' ? `Tous (${apiLogs.length})` : type}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-1.5 cursor-pointer font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      checked={apiLogOnlyErrors}
                      onChange={(e) => setApiLogOnlyErrors(e.target.checked)}
                      className="rounded border-slate-300 text-red-600"
                    />
                    <span>Erreurs uniquement ({apiLogs.filter(l => !l.success).length})</span>
                  </label>

                  <input
                    type="text"
                    value={apiLogSearch}
                    onChange={(e) => setApiLogSearch(e.target.value)}
                    placeholder="Filtrer par endpoint, jeu, commande..."
                    className="border border-slate-300 rounded-xl px-3 py-1.5 text-xs font-mono w-64 focus:outline-none focus:border-orange-500"
                  />
                </div>
              </div>
            </div>

            {/* Side-by-Side Real Request & Response Inspector for Selected Log */}
            {selectedLog && (
              <div className="bg-slate-900 text-slate-100 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-md">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-800">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="px-2.5 py-1 rounded bg-orange-600 text-white font-mono text-xs font-bold">
                      {selectedLog.httpMethod}
                    </span>
                    <span className="font-mono text-xs sm:text-sm font-bold text-white break-all">
                      {selectedLog.endpoint}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-slate-800 text-orange-300 font-mono text-[11px] font-bold">
                      {selectedLog.requestType}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 font-mono text-xs">
                    <span className={`px-2.5 py-0.5 rounded font-bold ${
                      selectedLog.success ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'
                    }`}>
                      {selectedLog.httpStatus ? `HTTP ${selectedLog.httpStatus}` : 'NO HTTP'} · {selectedLog.latencyMs} ms
                    </span>
                    <span className="text-slate-400 text-[11px]">
                      {new Date(selectedLog.timestamp).toLocaleString()}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
                  {/* Left: Outgoing Request (Headers & Payload Masked) */}
                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-orange-400 uppercase tracking-wider text-[11px]">
                        1. Requête Sortante vers GoXtop (Clés Masquées)
                      </span>
                      <Lock className="w-3.5 h-3.5 text-emerald-400" />
                    </div>
                    {selectedLog.requestHeadersMasked && (
                      <div>
                        <span className="text-[11px] text-slate-400 block mb-1">En-têtes HTTP envoyés :</span>
                        <pre className="p-2.5 bg-slate-900/90 rounded-lg font-mono text-[11px] text-emerald-300 overflow-x-auto">
                          {formatJsonPretty(selectedLog.requestHeadersMasked)}
                        </pre>
                      </div>
                    )}
                    <div>
                      <span className="text-[11px] text-slate-400 block mb-1">Détails / Payload de la requête :</span>
                      <pre className="p-2.5 bg-slate-900/90 rounded-lg font-mono text-[11px] text-slate-200 max-h-52 overflow-y-auto whitespace-pre-wrap break-all">
                        {formatJsonPretty(selectedLog.requestPreview || {
                          method: selectedLog.httpMethod,
                          endpoint: selectedLog.endpoint,
                          orderId: selectedLog.orderId,
                          partnerOrderId: selectedLog.partnerOrderId
                        })}
                      </pre>
                    </div>
                  </div>

                  {/* Right: Real Incoming GoXtop Response */}
                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-emerald-400 uppercase tracking-wider text-[11px]">
                        2. Réponse Réelle de l’API GoXtop ({selectedLog.resultLabel})
                      </span>
                      <span className="font-mono text-[11px] text-slate-400">
                        {selectedLog.httpStatus ? `Code HTTP ${selectedLog.httpStatus}` : 'Erreur Réseau / Config'}
                      </span>
                    </div>
                    {selectedLog.errorMessage && !selectedLog.success && (
                      <div className="p-2.5 bg-red-950/60 border border-red-800/60 rounded-lg text-red-300 font-mono text-[11px]">
                        Diagnostic d’erreur : {selectedLog.errorMessage}
                      </div>
                    )}
                    <div>
                      <span className="text-[11px] text-slate-400 block mb-1">Corps JSON / Réponse brute reçue :</span>
                      <pre className="p-2.5 bg-slate-900/90 rounded-lg font-mono text-[11px] text-slate-200 max-h-64 overflow-y-auto whitespace-pre-wrap break-all">
                        {formatJsonPretty(selectedLog.responsePreview || selectedLog.errorMessage || 'Aucun corps de réponse')}
                      </pre>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* API Logs Table */}
            <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-xs">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-100 text-slate-400 font-semibold">
                      <th className="py-2.5 px-3">Date / Heure</th>
                      <th className="py-2.5 px-3">Type de requête</th>
                      <th className="py-2.5 px-3">Endpoint</th>
                      <th className="py-2.5 px-3">Commande</th>
                      <th className="py-2.5 px-3">Statut HTTP</th>
                      <th className="py-2.5 px-3">Latence</th>
                      <th className="py-2.5 px-3">Résultat</th>
                      <th className="py-2.5 px-3">Aperçu Réponse / Erreur</th>
                      <th className="py-2.5 px-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredApiLogs.map(log => {
                      const isSelected = selectedLog?.id === log.id;
                      return (
                        <tr
                          key={log.id}
                          onClick={() => setSelectedApiLogId(log.id)}
                          className={`cursor-pointer transition-colors ${
                            isSelected ? 'bg-orange-50/80' : 'hover:bg-slate-50'
                          }`}
                        >
                          <td className="py-3 px-3 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                            {new Date(log.timestamp).toLocaleString()}
                          </td>
                          <td className="py-3 px-3 font-mono font-bold text-[11px] text-slate-800">
                            {log.requestType}
                          </td>
                          <td className="py-3 px-3 font-mono text-[11px] text-slate-600 max-w-xs truncate" title={log.endpoint}>
                            <span className="font-bold text-slate-900">{log.httpMethod}</span> {log.endpoint}
                          </td>
                          <td className="py-3 px-3 font-mono text-[11px] text-slate-700">
                            {log.orderId ? (
                              <div>
                                <span className="font-bold">{log.orderId}</span>
                                {log.partnerOrderId && <span className="block text-[10px] text-slate-400">{log.partnerOrderId}</span>}
                              </div>
                            ) : '—'}
                          </td>
                          <td className="py-3 px-3 font-mono font-bold">
                            {log.httpStatus ? (
                              <span className={log.httpStatus >= 200 && log.httpStatus < 300 ? 'text-emerald-600' : 'text-red-600'}>
                                HTTP {log.httpStatus}
                              </span>
                            ) : (
                              <span className="text-slate-400">N/A</span>
                            )}
                          </td>
                          <td className="py-3 px-3 font-mono text-slate-700 whitespace-nowrap">
                            {log.latencyMs} ms
                          </td>
                          <td className="py-3 px-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              log.success ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
                            }`}>
                              {log.resultLabel}
                            </span>
                          </td>
                          <td className="py-3 px-3 font-mono text-[11px] text-slate-500 max-w-xs truncate" title={log.errorMessage || log.responsePreview}>
                            {log.errorMessage || log.responsePreview || '—'}
                          </td>
                          <td className="py-3 px-3 text-right whitespace-nowrap">
                            <span className="text-[11px] font-bold text-orange-600 hover:underline">
                              Inspecter →
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                    {filteredApiLogs.length === 0 && (
                      <tr>
                        <td colSpan={9} className="py-8 text-center text-slate-400">
                          Aucun appel API ne correspond aux filtres. Cliquez sur « Tester Connexion » pour générer un appel réel.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Table provider_orders */}
              <div className="pt-6 border-t border-slate-200 space-y-3">
                <div>
                  <h4 className="font-display text-base font-bold text-slate-900">
                    Table <code className="font-mono text-orange-600">provider_orders</code> (Traçabilité &amp; Idempotence GoXtop)
                  </h4>
                  <p className="text-xs text-slate-500">
                    Enregistre chaque commande fournisseur avec <code className="font-mono">partner_order_id</code> unique, payloads sécurisés et statuts GoXtop.
                  </p>
                </div>

                <div className="overflow-x-auto border border-slate-200 rounded-xl">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold">
                        <th className="py-2.5 px-3">ID Interne</th>
                        <th className="py-2.5 px-3">playup_order_id</th>
                        <th className="py-2.5 px-3">partner_order_id</th>
                        <th className="py-2.5 px-3">provider_order_id</th>
                        <th className="py-2.5 px-3">Fournisseur</th>
                        <th className="py-2.5 px-3">Statut</th>
                        <th className="py-2.5 px-3">Erreur / Payload</th>
                        <th className="py-2.5 px-3">Mise à jour</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {providerOrders.map((po) => (
                        <tr key={po.id} className="hover:bg-slate-50">
                          <td className="py-2.5 px-3 font-mono text-[11px] text-slate-500">{po.id}</td>
                          <td className="py-2.5 px-3 font-mono font-bold text-slate-900">{po.playup_order_id}</td>
                          <td className="py-2.5 px-3 font-mono text-[11px] text-orange-600 font-semibold">{po.partner_order_id}</td>
                          <td className="py-2.5 px-3 font-mono text-[11px] text-slate-700">{po.provider_order_id || '—'}</td>
                          <td className="py-2.5 px-3 font-semibold text-slate-700">{po.provider}</td>
                          <td className="py-2.5 px-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                              po.status === 'completed' ? 'bg-emerald-100 text-emerald-800' :
                              po.status === 'processing' ? 'bg-amber-100 text-amber-800' :
                              'bg-red-100 text-red-800'
                            }`}>
                              {po.status}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 font-mono text-[11px] text-slate-500 max-w-xs truncate" title={JSON.stringify(po.response_payload)}>
                            {po.error_message || JSON.stringify(po.response_payload)}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-[11px] text-slate-400">
                            {new Date(po.updated_at).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                      {providerOrders.length === 0 && (
                        <tr>
                          <td colSpan={8} className="py-6 text-center text-slate-400">
                            Aucune entrée dans provider_orders.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* =========================================================
          SUB-TAB 4: DOCUMENTATION D'INTÉGRATION GOXTOP
         ========================================================= */}
      {subTab === 'docs' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 space-y-6 shadow-xs">
          <div className="border-b border-slate-100 pb-4">
            <span className="text-xs font-bold uppercase tracking-wider text-orange-600">
              Spécification Technique Fournisseur
            </span>
            <h3 className="font-display text-xl font-bold text-slate-900 mt-1">
              Documentation d’Intégration GoXtop ↔ PlayUp
            </h3>
            <p className="text-xs text-slate-600 mt-1">
              Référence d’architecture pour la connexion entre le backend PlayUp et l’infrastructure GoXtop.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
            <div className="border border-slate-200 rounded-2xl p-5 space-y-3">
              <h4 className="font-bold text-slate-900 text-sm">1. Authentification & En-têtes Confirmés</h4>
              <p className="text-slate-600 leading-relaxed">
                L’API GoXtop utilise une clé d’API unique transmise dans l’en-tête HTTP :
              </p>
              <div className="bg-slate-900 text-emerald-400 p-3 rounded-xl font-mono text-[11px]">
                x-api-key: &lt;VOTRE_CLE_API_GOXTOP&gt;
              </div>
              <p className="text-slate-500 text-[11px]">
                Cette clé est stockée uniquement côté serveur dans <code className="font-mono">providerSecrets</code> et injectée par <code className="font-mono">GoXtopProvider</code> lors des requêtes sortantes.
              </p>
            </div>

            <div className="border border-slate-200 rounded-2xl p-5 space-y-3">
              <h4 className="font-bold text-slate-900 text-sm">2. Réception des Webhooks GoXtop</h4>
              <p className="text-slate-600 leading-relaxed">
                PlayUp expose un endpoint dédié pour recevoir les confirmations asynchrones de GoXtop :
              </p>
              <div className="bg-slate-900 text-orange-400 p-3 rounded-xl font-mono text-[11px]">
                POST {fullWebhookUrl}
              </div>
              <p className="text-slate-500 text-[11px]">
                Si un <code className="font-mono">Webhook Secret</code> est renseigné dans l’administration, le backend vérifie systématiquement la signature <code className="font-mono">HMAC-SHA256</code> avant de mettre à jour le statut de la commande.
              </p>
            </div>
          </div>

          {/* Explicit REQUIRES GOXTOP DOCUMENTATION section as mandated by Section 9 */}
          <div className="border border-amber-200 bg-amber-50/70 rounded-2xl p-5 space-y-4 text-xs">
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-amber-950 text-sm flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                <span>Chemins d’Endpoints & Paramètres Spécifiques au Compte</span>
              </h4>
              <span className="px-2.5 py-1 bg-amber-200/80 text-amber-950 font-mono text-[10px] font-bold rounded">
                REQUIRES GOXTOP DOCUMENTATION
              </span>
            </div>

            <p className="text-amber-900 leading-relaxed">
              Conformément aux règles d’intégrité de PlayUp, aucun nom de paramètre propriétaire non confirmé n’est codé en dur. Vous pouvez adapter les chemins exacts de votre compte GoXtop directement dans l’onglet <strong>1. Configuration API</strong> :
            </p>

            <div className="overflow-x-auto bg-white rounded-xl border border-amber-200">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-amber-100 text-slate-500">
                    <th className="py-2 px-3">Opération</th>
                    <th className="py-2 px-3">Statut Spécification</th>
                    <th className="py-2 px-3">Configuration dans PlayUp Admin</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-amber-100 font-mono text-[11px]">
                  <tr>
                    <td className="py-2.5 px-3 font-sans font-semibold text-slate-900">Catalogue des Jeux</td>
                    <td className="py-2.5 px-3 text-emerald-700 font-bold">GET /api/v.1/games</td>
                    <td className="py-2.5 px-3">Utilisé pour Test Connexion &amp; Sync Jeux</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-3 font-sans font-semibold text-slate-900">Catalogue des Produits par Jeu</td>
                    <td className="py-2.5 px-3 text-emerald-700 font-bold">GET /api/v.1/products/&#123;game&#125;</td>
                    <td className="py-2.5 px-3">Synchronise produits &amp; coût GoXtop (+ Marge PlayUp)</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-3 font-sans font-semibold text-slate-900">Création Commande GoXtop</td>
                    <td className="py-2.5 px-3 text-emerald-700 font-bold">POST /api/v.1/create</td>
                    <td className="py-2.5 px-3">Idempotent via partner_orderid unique</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-3 font-sans font-semibold text-slate-900">Vérification Statut Commande</td>
                    <td className="py-2.5 px-3 text-emerald-700 font-bold">GET /api/v.1/:partner_orderid</td>
                    <td className="py-2.5 px-3">Vérifié avant toute nouvelle tentative</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-3 font-sans font-semibold text-slate-900">Suivi / Track Commande</td>
                    <td className="py-2.5 px-3 text-emerald-700 font-bold">POST /api/v.1/:id/track</td>
                    <td className="py-2.5 px-3">Disponible dans Admin → Commandes</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-3 font-sans font-semibold text-slate-900">Name Checker (Free Fire, etc.)</td>
                    <td className="py-2.5 px-3 text-amber-800 font-bold">REQUIRES GOXTOP DOCUMENTATION</td>
                    <td className="py-2.5 px-3">Configurable via Endpoint Name Checker GoXtop</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: ADD INTERCHANGEABLE PROVIDER */}
      {showNewProviderModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <h3 className="font-display text-lg font-bold text-slate-900">
              Ajouter un fournisseur interchangeable
            </h3>
            <p className="text-xs text-slate-500">
              L'architecture PlayUp permet de connecter de nouveaux fournisseurs sans modifier le code source.
            </p>
            <form onSubmit={handleCreateNewProvider} className="space-y-3 text-xs">
              <div>
                <label className="font-semibold block mb-1">Nom du fournisseur</label>
                <input
                  type="text"
                  required
                  value={newProvName}
                  onChange={(e) => setNewProvName(e.target.value)}
                  placeholder="ex: GoXtop Backup / Autre Fournisseur"
                  className="w-full border border-slate-300 rounded-xl px-3 py-2"
                />
              </div>
              <div>
                <label className="font-semibold block mb-1">API Base URL</label>
                <input
                  type="url"
                  required
                  value={newProvUrl}
                  onChange={(e) => setNewProvUrl(e.target.value)}
                  placeholder="https://api.fournisseur.com"
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 font-mono"
                />
              </div>
              <div>
                <label className="font-semibold block mb-1">API Key (Stockée côté serveur)</label>
                <input
                  type="password"
                  value={newProvKey}
                  onChange={(e) => setNewProvKey(e.target.value)}
                  placeholder="Optionnel à la création"
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 font-mono"
                />
              </div>
              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowNewProviderModal(false)}
                  className="px-4 py-2 border border-slate-300 rounded-xl font-semibold"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-orange-600 text-white rounded-xl font-semibold"
                >
                  Créer le fournisseur
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
