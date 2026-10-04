import React, { useState, useEffect } from 'react';
import {
  Shield, Key, Eye, EyeOff, CheckCircle2, AlertTriangle, RefreshCw,
  Server, Copy, Check, Plus, Trash2, Activity, Terminal, BookOpen,
  Layers, ArrowRight, Lock, Globe, Sliders, Save
} from 'lucide-react';
import {
  Provider, Game, Service, ProviderApiLog, ConnectionTestResult, ProviderCustomParam,
  ProviderEndpointsConfig, ProviderOrder
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
  const [subTab, setSubTab] = useState<'config' | 'products' | 'logs' | 'docs'>('config');

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
  } | null>(null);

  // Editable catalog mapping state
  const [editableServices, setEditableServices] = useState<Service[]>([]);
  const [savingCatalogId, setSavingCatalogId] = useState<string | null>(null);

  // Logs & ProviderOrders state
  const [apiLogs, setApiLogs] = useState<ProviderApiLog[]>([]);
  const [providerOrders, setProviderOrders] = useState<ProviderOrder[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

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
    if (subTab === 'logs' && currentProvider) {
      loadProviderLogs(currentProvider.id);
    }
  }, [subTab, currentProvider?.id]);

  const loadProviderLogs = async (provId: string) => {
    setLoadingLogs(true);
    try {
      const [logs, pOrders] = await Promise.all([
        apiClient.getProviderApiLogs(token, provId),
        apiClient.getProviderOrders(token)
      ]);
      setApiLogs(logs);
      setProviderOrders(pOrders);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingLogs(false);
    }
  };

  const fullWebhookUrl = `${window.location.origin}${currentProvider?.webhookUrl || '/api/webhooks/goxtop'}`;

  const handleToggleRevealApiKey = async () => {
    if (!currentProvider) return;
    if (isApiKeyRevealed) {
      setIsApiKeyRevealed(false);
      if (currentProvider.hasApiKey && (!apiKeyInput || apiKeyInput === '')) {
        setApiKeyInput('••••••••••••••••');
      }
      return;
    }

    if (currentProvider.hasApiKey && apiKeyInput.includes('••••')) {
      try {
        const res = await apiClient.revealProviderSecret(token, currentProvider.id, 'apiKey');
        setApiKeyInput(res.value);
        setIsApiKeyRevealed(true);
      } catch (err: any) {
        setSaveErrorMsg(err.message || 'Impossible de révéler la clé');
      }
    } else {
      setIsApiKeyRevealed(true);
    }
  };

  const handleToggleRevealWebhookSecret = async () => {
    if (!currentProvider) return;
    if (isWebhookSecretRevealed) {
      setIsWebhookSecretRevealed(false);
      if (currentProvider.hasWebhookSecret && (!webhookSecretInput || webhookSecretInput === '')) {
        setWebhookSecretInput('••••••••••••••••');
      }
      return;
    }

    if (currentProvider.hasWebhookSecret && webhookSecretInput.includes('••••')) {
      try {
        const res = await apiClient.revealProviderSecret(token, currentProvider.id, 'webhookSecret');
        setWebhookSecretInput(res.value);
        setIsWebhookSecretRevealed(true);
      } catch (err: any) {
        setSaveErrorMsg(err.message || 'Impossible de révéler le secret webhook');
      }
    } else {
      setIsWebhookSecretRevealed(true);
    }
  };

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
    } catch (err: any) {
      alert(err.message || 'Erreur de sauvegarde');
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
      alert(err.message);
    }
  };

  if (!currentProvider) return null;

  return (
    <div className="space-y-6">
      {/* Breadcrumb & Interchangeable Provider Selector */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-xs text-slate-500 font-medium">
            <span>Paramètres</span>
            <span>→</span>
            <span>Fournisseurs</span>
            <span>→</span>
            <span className="text-orange-600 font-semibold">{currentProvider.name}</span>
            <span>→</span>
            <span className="text-slate-900 font-semibold">
              {subTab === 'config' && 'Configuration API'}
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
            onClick={() => setShowNewProviderModal(true)}
            className="px-3 py-2 border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors"
            title="Ajouter un nouveau fournisseur interchangeable"
          >
            <Plus className="w-3.5 h-3.5 text-orange-600" />
            <span>Nouveau fournisseur</span>
          </button>
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
          onClick={() => setSubTab('products')}
          className={`px-4 py-2.5 text-xs font-semibold border-b-2 whitespace-nowrap flex items-center gap-2 transition-colors ${
            subTab === 'products'
              ? 'border-orange-600 text-orange-600 bg-orange-50/50 rounded-t-xl'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>2. Gestion des Produits & Synchronisation</span>
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
          <span>3. Logs API ({currentProvider.name})</span>
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
          <span>4. Documentation d’intégration</span>
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
                    type={isApiKeyRevealed ? 'text' : 'password'}
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    placeholder="Collez votre API Key GoXtop ici..."
                    className="flex-1 bg-white border border-slate-300 rounded-xl px-3 py-2.5 text-xs font-mono text-slate-900 focus:outline-none focus:border-orange-500"
                  />
                  <button
                    type="button"
                    onClick={handleToggleRevealApiKey}
                    className="px-3 py-2.5 bg-white border border-slate-300 hover:bg-slate-100 rounded-xl text-xs font-semibold text-slate-700 flex items-center gap-1.5 shrink-0 transition-colors"
                    title="Afficher / Masquer la clé (Réservé Admin)"
                  >
                    {isApiKeyRevealed ? (
                      <>
                        <EyeOff className="w-3.5 h-3.5 text-slate-600" />
                        <span>Masquer</span>
                      </>
                    ) : (
                      <>
                        <Eye className="w-3.5 h-3.5 text-orange-600" />
                        <span>Afficher</span>
                      </>
                    )}
                  </button>
                </div>
                <span className="text-[11px] text-slate-500 mt-1 block">
                  Stockée uniquement dans le coffre serveur. Jamais transmise au frontend public.
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
                  <label className="font-bold text-slate-900 block mb-1">
                    Webhook Secret / Signing Secret (Optionnel — uniquement si {currentProvider.name} fournit un secret HMAC)
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type={isWebhookSecretRevealed ? 'text' : 'password'}
                      value={webhookSecretInput}
                      onChange={(e) => setWebhookSecretInput(e.target.value)}
                      placeholder="Laisser vide si non utilisé par votre compte GoXtop"
                      className="flex-1 bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-mono text-slate-900 focus:outline-none focus:border-orange-500"
                    />
                    <button
                      type="button"
                      onClick={handleToggleRevealWebhookSecret}
                      className="px-3 py-2 bg-white border border-slate-300 hover:bg-slate-100 rounded-xl text-xs font-semibold text-slate-700 flex items-center gap-1.5 shrink-0"
                    >
                      {isWebhookSecretRevealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5 text-orange-600" />}
                      <span>{isWebhookSecretRevealed ? 'Masquer' : 'Afficher'}</span>
                    </button>
                  </div>
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
                <div className={`p-4 rounded-2xl border space-y-2.5 text-xs ${
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

                  <div className="pt-2 border-t border-black/10 text-[11px] font-mono break-all opacity-75">
                    Endpoint : {connectionResult.endpointCalled}
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
          SUB-TAB 2: GESTION DES PRODUITS & SYNCHRONISATION
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
              <div className={`p-4 rounded-xl border text-xs flex items-start justify-between gap-4 ${
                syncFeedback.success ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-amber-50 border-amber-200 text-amber-900'
              }`}>
                <div className="space-y-1">
                  <div className="font-bold">
                    Résultat : {syncFeedback.statusLabel} {syncFeedback.httpStatus ? `(HTTP ${syncFeedback.httpStatus} - ${syncFeedback.latencyMs}ms)` : ''}
                  </div>
                  <p>{syncFeedback.details}</p>
                </div>
                <button onClick={() => setSyncFeedback(null)} className="text-slate-400 hover:text-slate-700">✕</button>
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
          SUB-TAB 3: LOGS API (Administration → Fournisseurs → GoXtop → Logs API)
         ========================================================= */}
      {subTab === 'logs' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
            <div>
              <h3 className="font-display text-lg font-bold text-slate-900">
                Journal des Appels API & Webhooks ({currentProvider.name})
              </h3>
              <p className="text-xs text-slate-500">
                Historique d'audit en temps réel. Les clés API et secrets sont systématiquement masqués avant l'enregistrement.
              </p>
            </div>

            <button
              onClick={() => loadProviderLogs(currentProvider.id)}
              className="px-3.5 py-2 border border-slate-300 hover:bg-slate-50 rounded-xl text-xs font-semibold flex items-center gap-1.5 self-start"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingLogs ? 'animate-spin' : ''}`} />
              <span>Actualiser les logs</span>
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-slate-400 font-semibold">
                  <th className="py-2.5 px-3">Date / Heure</th>
                  <th className="py-2.5 px-3">Type de requête</th>
                  <th className="py-2.5 px-3">Endpoint</th>
                  <th className="py-2.5 px-3">Commande concernée</th>
                  <th className="py-2.5 px-3">Statut HTTP</th>
                  <th className="py-2.5 px-3">Temps de réponse</th>
                  <th className="py-2.5 px-3">Résultat</th>
                  <th className="py-2.5 px-3">Détail / Erreur éventuelle</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {apiLogs.map(log => (
                  <tr key={log.id} className="hover:bg-slate-50">
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
                    <td className="py-3 px-3 font-mono text-slate-700">
                      {log.latencyMs} ms
                    </td>
                    <td className="py-3 px-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        log.success ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
                      }`}>
                        {log.resultLabel}
                      </span>
                    </td>
                    <td className="py-3 px-3 font-mono text-[11px] text-slate-500 max-w-sm truncate" title={log.errorMessage || log.responsePreview}>
                      {log.errorMessage || log.responsePreview || '—'}
                    </td>
                  </tr>
                ))}
                {apiLogs.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-400">
                      Aucun appel API enregistré pour {currentProvider.name}. Cliquez sur « Tester la connexion » pour générer votre premier test réel.
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
                Table <code className="font-mono text-orange-600">provider_orders</code> (Traçabilité & Idempotence GoXtop)
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
      )}

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
