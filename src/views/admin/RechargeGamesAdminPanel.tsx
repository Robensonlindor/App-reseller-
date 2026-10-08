import React, { useState, useEffect, useCallback } from 'react';
import {
  Shield,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Wifi,
  Package,
  DollarSign,
  Webhook,
  Terminal,
  Play,
  Lock,
  Globe,
  Clock,
  Layers,
  Sliders,
  Check,
  Search,
  Activity
} from 'lucide-react';
import {
  ConnectionTestResult,
  ManualPaymentValidationRecord,
  OrderRetryAttemptRecord,
  PriceChangeHistoryEntry,
  ProviderApiLog,
  RechargeGamesConfigState,
  RechargeGamesMode,
  RechargeGamesOrderRecord,
  RechargeGamesProduct,
  RechargeGamesTestStepResult,
  RechargeGamesWebhookEvent,
  RefundRecord
} from '../../types';
import { apiClient } from '../../services/apiClient';
import { syncWebhookEventIdempotencyToFirestore } from '../../lib/firebase';

interface RechargeGamesAdminPanelProps {
  token: string;
  onRefreshParent?: () => void;
}

export const RechargeGamesAdminPanel: React.FC<RechargeGamesAdminPanelProps> = ({
  token,
  onRefreshParent
}) => {
  const [subTab, setSubTab] = useState<
    'overview' | 'catalog' | 'margins' | 'orders' | 'webhooks' | 'logs' | 'tests'
  >('overview');

  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<RechargeGamesConfigState | null>(null);
  const [metrics, setMetrics] = useState({
    totalProducts: 0,
    activeProducts: 0,
    unavailableProducts: 0,
    pendingOrders: 0,
    deliveredOrders: 0,
    failedOrders: 0,
    totalProfitUsd: 0,
    apiErrorsCount: 0
  });
  const [products, setProducts] = useState<RechargeGamesProduct[]>([]);
  const [orders, setOrders] = useState<RechargeGamesOrderRecord[]>([]);
  const [refunds, setRefunds] = useState<RefundRecord[]>([]);
  const [manualValidations, setManualValidations] = useState<ManualPaymentValidationRecord[]>([]);
  const [retryAttempts, setRetryAttempts] = useState<OrderRetryAttemptRecord[]>([]);
  const [webhookEvents, setWebhookEvents] = useState<RechargeGamesWebhookEvent[]>([]);
  const [apiLogs, setApiLogs] = useState<ProviderApiLog[]>([]);

  // Form states for Config
  const [modeInput, setModeInput] = useState<RechargeGamesMode>('TEST');
  const [baseUrlInput, setBaseUrlInput] = useState('');
  const [newApiKeyInput, setNewApiKeyInput] = useState('');
  const [newWebhookSecretInput, setNewWebhookSecretInput] = useState('');
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(true);
  const [savingConfig, setSavingConfig] = useState(false);
  const [statusBanner, setStatusBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Connection Test
  const [testingConn, setTestingConn] = useState(false);
  const [connResult, setConnResult] = useState<ConnectionTestResult | null>(null);

  // Sync Catalog
  const [syncingCatalog, setSyncingCatalog] = useState(false);

  // Catalog Filters (Brazil 🇧🇷, USA 🇺🇸, Global 🌐, etc.)
  const [regionFilter, setRegionFilter] = useState<string>('all');
  const [gameFilter, setGameFilter] = useState<string>('all');
  const [catalogSearch, setCatalogSearch] = useState<string>('');

  // Margins & USD -> HTG Reference Currency state
  const [usdToHtgRateInput, setUsdToHtgRateInput] = useState<string>('132');
  const [savingExchangeRate, setSavingExchangeRate] = useState<boolean>(false);
  const [inlineProductPricesHtg, setInlineProductPricesHtg] = useState<Record<string, string>>({});
  const [savingProductKeyHtg, setSavingProductKeyHtg] = useState<string | null>(null);
  const [priceHistory, setPriceHistory] = useState<PriceChangeHistoryEntry[]>([]);
  const [globalMargin, setGlobalMargin] = useState<number>(20);
  const [gameMargins, setGameMargins] = useState<Record<string, number>>({});
  const [regionMargins, setRegionMargins] = useState<Record<string, number>>({});
  const [productMargins, setProductMargins] = useState<Record<string, number>>({});
  const [savingMargins, setSavingMargins] = useState(false);
  const [customProductKey, setCustomProductKey] = useState('');
  const [customProductMargin, setCustomProductMargin] = useState('25');

  // Webhook Test
  const [testingWebhook, setTestingWebhook] = useState(false);
  const [selectedOrderForWebhook, setSelectedOrderForWebhook] = useState<string>('');

  // Order status check, Manual Payment Validation, Retry & Strict Refund Modal
  const [checkingOrderId, setCheckingOrderId] = useState<string | null>(null);
  const [validatingOrderId, setValidatingOrderId] = useState<string | null>(null);
  const [retryingOrderId, setRetryingOrderId] = useState<string | null>(null);
  const [refundModalPreview, setRefundModalPreview] = useState<{
    orderId: string;
    buyerRef: string;
    providerOrderId: string;
    amount: number;
    currency: string;
    userId: string;
    userName: string;
    userEmail: string;
    productName: string;
    reason: string;
    refundMethod: string;
  } | null>(null);
  const [executingRefund, setExecutingRefund] = useState(false);

  // Live 12-Test Suite
  const [runningSuite, setRunningSuite] = useState(false);
  const [suiteResults, setSuiteResults] = useState<RechargeGamesTestStepResult[] | null>(null);

  const loadDashboard = useCallback(async () => {
    try {
      const [data, historyRes] = await Promise.all([
        apiClient.getRechargeGamesAdminDashboard(token),
        apiClient.getPricingHistory(token, { limit: 100 }).catch(() => null)
      ]);
      setConfig(data.config);
      setMetrics(data.metrics);
      setProducts(data.products || []);
      setOrders(data.orders || []);
      setRefunds(data.refunds || []);
      setManualValidations(data.manualPaymentValidations || []);
      setRetryAttempts(data.orderRetryAttempts || []);
      setWebhookEvents(data.webhookEvents || []);
      setApiLogs(data.apiLogs || []);

      if (historyRes) {
        setPriceHistory(historyRes.history || []);
      }

      if (Array.isArray((data as any).firestoreIdempotencyLocks)) {
        for (const lock of (data as any).firestoreIdempotencyLocks.slice(0, 15)) {
          syncWebhookEventIdempotencyToFirestore(lock).catch(() => {});
        }
      }

      setModeInput(data.config.mode);
      setBaseUrlInput(data.config.baseUrl);
      setAutoSyncEnabled(data.config.syncStats.autoSyncEnabled);

      const activeRate =
        historyRes?.usdToHtgExchangeRate ||
        data.config.margins?.usdToHtgExchangeRate ||
        data.config.margins?.usdToHtgRate ||
        132;
      setUsdToHtgRateInput(String(activeRate));

      const nextInlinePrices: Record<string, string> = {};
      for (const p of data.products || []) {
        const htgVal =
          typeof p.playup_price_htg === 'number' && p.playup_price_htg > 0
            ? p.playup_price_htg
            : Number((Number(p.playup_price || 0) * activeRate).toFixed(2));
        nextInlinePrices[p.product_key] = String(htgVal);
      }
      setInlineProductPricesHtg(nextInlinePrices);

      if (data.config.margins) {
        setGlobalMargin(data.config.margins.globalMarginPercent ?? 20);
        setGameMargins(data.config.margins.gameMargins || {});
        setRegionMargins(data.config.margins.regionMargins || {});
        setProductMargins(data.config.margins.productMargins || {});
      }
    } catch (err: any) {
      console.error('[RechargeGamesAdminPanel] Load error:', err);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingConfig(true);
    setStatusBanner(null);
    try {
      const res = await apiClient.updateRechargeGamesConfig(token, {
        mode: modeInput,
        baseUrl: baseUrlInput,
        ...(newApiKeyInput.trim() ? { apiKey: newApiKeyInput.trim() } : {}),
        ...(newWebhookSecretInput.trim() ? { webhookSecret: newWebhookSecretInput.trim() } : {}),
        autoSyncEnabled
      });
      setNewApiKeyInput('');
      setNewWebhookSecretInput('');
      setStatusBanner({ type: 'success', text: res.message });
      await loadDashboard();
      if (onRefreshParent) onRefreshParent();
    } catch (err: any) {
      setStatusBanner({ type: 'error', text: err.message || 'Erreur lors de la sauvegarde' });
    } finally {
      setSavingConfig(false);
    }
  };

  const handleTestConnection = async () => {
    setTestingConn(true);
    setStatusBanner(null);
    try {
      const res = await apiClient.testRechargeGamesConnection(token);
      setConnResult(res);
      await loadDashboard();
    } catch (err: any) {
      setStatusBanner({ type: 'error', text: err.message || 'Erreur test de connexion' });
    } finally {
      setTestingConn(false);
    }
  };

  const handleSyncNow = async () => {
    setSyncingCatalog(true);
    setStatusBanner(null);
    try {
      const res = await apiClient.syncRechargeGamesCatalog(token);
      setStatusBanner({
        type: res.success ? 'success' : 'error',
        text: res.message
      });
      await loadDashboard();
      if (onRefreshParent) onRefreshParent();
    } catch (err: any) {
      setStatusBanner({ type: 'error', text: err.message || 'Erreur de synchronisation' });
    } finally {
      setSyncingCatalog(false);
    }
  };

  const handleUpdateExchangeRate = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const numRate = Number(usdToHtgRateInput);
    if (!Number.isFinite(numRate) || numRate <= 0) {
      setStatusBanner({
        type: 'error',
        text: 'Veuillez saisir un taux de change USD → HTG valide (supérieur à 0).'
      });
      return;
    }
    setSavingExchangeRate(true);
    setStatusBanner(null);
    try {
      const res = await apiClient.updateUsdToHtgExchangeRate(token, {
        usdToHtgExchangeRate: numRate,
        reason: `Modification du taux de change USD → HTG depuis le panneau RechargeGames (1 USD = ${numRate} HTG)`
      });
      setStatusBanner({ type: 'success', text: res.message });
      window.dispatchEvent(new CustomEvent('playup:pricing-updated'));
      await loadDashboard();
      if (onRefreshParent) onRefreshParent();
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        text: err.message || 'Erreur lors de la mise à jour du taux de change USD → HTG'
      });
    } finally {
      setSavingExchangeRate(false);
    }
  };

  const handleSaveManualProductPriceHtg = async (prod: RechargeGamesProduct) => {
    const rawVal = inlineProductPricesHtg[prod.product_key];
    const numPriceHtg = Number(rawVal);
    if (!Number.isFinite(numPriceHtg) || numPriceHtg <= 0) {
      setStatusBanner({
        type: 'error',
        text: 'Veuillez saisir un prix de vente final en HTG valide (supérieur à 0).'
      });
      return;
    }
    setSavingProductKeyHtg(prod.product_key);
    setStatusBanner(null);
    try {
      const res = await apiClient.updateManualServicePriceHtg(token, {
        productKey: prod.product_key,
        sellingPriceHtg: numPriceHtg
      });
      setStatusBanner({ type: 'success', text: res.message });
      window.dispatchEvent(new CustomEvent('playup:pricing-updated'));
      await loadDashboard();
      if (onRefreshParent) onRefreshParent();
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        text: err.message || 'Erreur lors de la sauvegarde du prix de vente final en HTG'
      });
    } finally {
      setSavingProductKeyHtg(null);
    }
  };

  const handleSaveMargins = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingMargins(true);
    setStatusBanner(null);
    try {
      const res = await apiClient.updateRechargeGamesMargins(token, {
        globalMarginPercent: Number(globalMargin),
        usdToHtgExchangeRate: Number(usdToHtgRateInput) > 0 ? Number(usdToHtgRateInput) : 132,
        gameMargins,
        regionMargins,
        productMargins
      } as any);
      setStatusBanner({ type: 'success', text: res.message });
      window.dispatchEvent(new CustomEvent('playup:pricing-updated'));
      await loadDashboard();
      if (onRefreshParent) onRefreshParent();
    } catch (err: any) {
      setStatusBanner({ type: 'error', text: err.message || 'Erreur sauvegarde marges' });
    } finally {
      setSavingMargins(false);
    }
  };

  const handleCheckOrderStatus = async (orderId: string) => {
    setCheckingOrderId(orderId);
    try {
      const res = await apiClient.checkRechargeGamesOrderStatus(orderId);
      setStatusBanner({
        type: res.success ? 'success' : 'error',
        text: `Statut réel vérifié (GET /v1/orders/${orderId}) → ${res.status.toUpperCase()} (${res.message}). Vous pouvez maintenant déclencher une action manuelle si nécessaire.`
      });
      await loadDashboard();
    } catch (err: any) {
      setStatusBanner({ type: 'error', text: err.message || 'Erreur vérification statut' });
    } finally {
      setCheckingOrderId(null);
    }
  };

  const handleValidatePaymentManually = async (orderId: string) => {
    if (validatingOrderId) return;
    setValidatingOrderId(orderId);
    setStatusBanner(null);
    try {
      const res = await apiClient.validateRechargeGamesPaymentManually(token, orderId);
      setStatusBanner({
        type: res.success ? 'success' : 'error',
        text: res.message
      });
      await loadDashboard();
      if (onRefreshParent) onRefreshParent();
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        text: err.message || 'Erreur lors de la validation manuelle du paiement'
      });
    } finally {
      setValidatingOrderId(null);
    }
  };

  const handleManualRetryOrder = async (orderId: string) => {
    if (retryingOrderId) return;
    setRetryingOrderId(orderId);
    setStatusBanner(null);
    try {
      const res = await apiClient.retryRechargeGamesOrder(token, orderId, {
        triggerType: 'manual_admin',
        requirePriorAdminStatusCheck: true
      });
      setStatusBanner({
        type: res.success ? 'success' : 'error',
        text: res.message
      });
      await loadDashboard();
      if (onRefreshParent) onRefreshParent();
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        text: err.message || 'Erreur lors de la nouvelle tentative manuelle'
      });
    } finally {
      setRetryingOrderId(null);
    }
  };

  const handleOpenRefundModal = async (orderId: string) => {
    setStatusBanner(null);
    try {
      const check = await apiClient.getRechargeGamesRefundEligibility(token, orderId);
      if (!check.eligible) {
        setStatusBanner({
          type: 'error',
          text: check.reason
        });
        return;
      }
      setRefundModalPreview({
        orderId: check.preview.orderId,
        buyerRef: check.preview.buyerRef,
        providerOrderId: check.preview.providerOrderId,
        amount: check.preview.amount,
        currency: check.preview.currency,
        userId: check.preview.userId,
        userName: check.preview.userName,
        userEmail: check.preview.userEmail,
        productName: check.preview.productName,
        reason: check.preview.defaultReason,
        refundMethod: check.preview.refundMethod || 'wallet'
      });
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        text: err.message || 'Impossible de préparer le remboursement manuel'
      });
    }
  };

  const handleConfirmManualRefund = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!refundModalPreview || executingRefund) return;
    setExecutingRefund(true);
    setStatusBanner(null);
    try {
      const res = await apiClient.executeRechargeGamesManualRefund(token, refundModalPreview.orderId, {
        reason: refundModalPreview.reason,
        refundMethod: refundModalPreview.refundMethod
      });
      setStatusBanner({
        type: res.success ? 'success' : 'error',
        text: res.message
      });
      setRefundModalPreview(null);
      await loadDashboard();
      if (onRefreshParent) onRefreshParent();
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        text: err.message || 'Échec du remboursement manuel'
      });
    } finally {
      setExecutingRefund(false);
    }
  };

  const handleSimulateWebhook = async (
    eventType: 'webhook.test' | 'order.delivered' | 'order.refunded' | 'order.failed',
    options?: {
      simulateInvalidSignature?: boolean;
      simulateDuplicateEvent?: boolean;
      simulateInvalidPayload?: boolean;
    }
  ) => {
    setTestingWebhook(true);
    setStatusBanner(null);
    try {
      const res = await apiClient.testRechargeGamesWebhook(token, {
        eventType,
        orderId: selectedOrderForWebhook || orders[0]?.id,
        simulateInvalidSignature: options?.simulateInvalidSignature,
        simulateDuplicateEvent: options?.simulateDuplicateEvent,
        simulateInvalidPayload: options?.simulateInvalidPayload
      });
      const isExpectedRejection =
        (options?.simulateInvalidSignature && res.httpStatus === 401) ||
        (options?.simulateInvalidPayload && res.httpStatus === 400);
      setStatusBanner({
        type: res.httpStatus === 200 || isExpectedRejection ? 'success' : 'error',
        text: options?.simulateInvalidSignature
          ? `Test sécurité HMAC réussi sur POST /rechargegames-webhook : signature invalide rejetée avec HTTP ${res.httpStatus} (${res.webhookEvent?.error_message})`
          : options?.simulateInvalidPayload
          ? `Test données invalides réussi sur POST /rechargegames-webhook : payload invalide rejeté avec HTTP ${res.httpStatus} (${res.webhookEvent?.error_message})`
          : options?.simulateDuplicateEvent
          ? `Test anti-rejeu réussi sur POST /rechargegames-webhook : événement déjà traité ignoré (HTTP ${res.httpStatus}, status=${res.webhookEvent?.processing_status})`
          : `Webhook "${eventType}" traité sur POST /rechargegames-webhook avec HTTP ${res.httpStatus} (event_id: ${res.webhookEvent?.event_id})`
      });
      await loadDashboard();
      if (onRefreshParent) onRefreshParent();
    } catch (err: any) {
      setStatusBanner({ type: 'error', text: err.message || 'Erreur test webhook' });
    } finally {
      setTestingWebhook(false);
    }
  };

  const handleRunTestSuite = async () => {
    setRunningSuite(true);
    setStatusBanner(null);
    try {
      const res = await apiClient.runRechargeGamesTestSuite(token);
      setSuiteResults(res.results);
      setStatusBanner({
        type: res.allPassed ? 'success' : 'error',
        text: `Suite de tests RechargeGames terminée : ${res.passedCount}/${res.totalCount} tests réussis.`
      });
      await loadDashboard();
      if (onRefreshParent) onRefreshParent();
    } catch (err: any) {
      setStatusBanner({ type: 'error', text: err.message || 'Erreur lors de l’exécution des tests' });
    } finally {
      setRunningSuite(false);
    }
  };

  const getRegionBadge = (region: string) => {
    const r = (region || '').toLowerCase();
    if (r === 'brazil' || r === 'br') return '🇧🇷 Brazil';
    if (r === 'usa' || r === 'us') return '🇺🇸 USA';
    if (r === 'global') return '🌐 Global';
    return `🌍 ${region || 'Global'}`;
  };

  const filteredProducts = products.filter(p => {
    if (regionFilter !== 'all' && (p.region || '').toLowerCase() !== (regionFilter || '').toLowerCase()) return false;
    if (gameFilter !== 'all' && (p.game || '').toLowerCase() !== (gameFilter || '').toLowerCase()) return false;
    if (catalogSearch.trim()) {
      const q = catalogSearch.toLowerCase();
      return (
        (p.product_key || '').toLowerCase().includes(q) ||
        (p.name || '').toLowerCase().includes(q) ||
        (p.game || '').toLowerCase().includes(q) ||
        (p.region || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  if (loading && !config) {
    return (
      <div className="p-8 text-center text-slate-400 flex items-center justify-center gap-2">
        <RefreshCw className="w-5 h-5 animate-spin text-orange-400" />
        <span>Chargement du module RechargeGames...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Header & Quick Actions */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <span className="px-2.5 py-1 rounded-md text-xs font-bold bg-orange-500/20 text-orange-400 border border-orange-500/30">
              API OFFICIELLE v1
            </span>
            <h2 className="text-xl font-black text-white tracking-tight">
              Intégration RechargeGames — PlayUp Backend
            </h2>
            <span
              className={`px-2.5 py-1 rounded-md text-xs font-bold border ${
                config?.mode === 'PRODUCTION'
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                  : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
              }`}
            >
              MODE : {config?.mode || 'TEST'}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1.5">
            Architecture 100% serveur • Clés stockées côté backend • Catalogue régional (Brazil 🇧🇷, USA 🇺🇸, Global 🌐) • Anti-duplication <code className="text-orange-300">buyer_ref</code> • Webhook HMAC-SHA256 & Fallback <code className="text-orange-300">GET /v1/orders/&#123;order_id&#125;</code>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={handleTestConnection}
            disabled={testingConn}
            className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold flex items-center gap-2 border border-slate-700 transition-colors cursor-pointer"
          >
            <Wifi className={`w-4 h-4 text-emerald-400 ${testingConn ? 'animate-pulse' : ''}`} />
            <span>{testingConn ? 'Test en cours...' : 'Tester la connexion'}</span>
          </button>

          <button
            onClick={handleSyncNow}
            disabled={syncingCatalog}
            className="px-3.5 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold flex items-center gap-2 transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${syncingCatalog ? 'animate-spin' : ''}`} />
            <span>{syncingCatalog ? 'Synchronisation...' : 'Synchroniser maintenant'}</span>
          </button>

          <button
            onClick={() => {
              setSubTab('tests');
              handleRunTestSuite();
            }}
            disabled={runningSuite}
            className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-2 transition-colors cursor-pointer"
          >
            <Play className="w-4 h-4" />
            <span>Exécuter les 12 Tests Officiels</span>
          </button>
        </div>
      </div>

      {/* Status Alert Banner */}
      {statusBanner && (
        <div
          className={`p-4 rounded-xl border text-xs font-semibold flex items-center justify-between gap-3 ${
            statusBanner.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
          }`}
        >
          <div className="flex items-center gap-2.5">
            {statusBanner.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            )}
            <span>{statusBanner.text}</span>
          </div>
          <button
            onClick={() => setStatusBanner(null)}
            className="text-slate-400 hover:text-white text-xs underline"
          >
            Fermer
          </button>
        </div>
      )}

      {/* Live Connection Test Diagnostic Card */}
      {connResult && (
        <div
          className={`p-5 rounded-2xl border ${
            connResult.success
              ? 'bg-emerald-950/30 border-emerald-500/40'
              : 'bg-rose-950/30 border-rose-500/40'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              {connResult.success ? (
                <CheckCircle2 className="w-6 h-6 text-emerald-400" />
              ) : (
                <XCircle className="w-6 h-6 text-rose-400" />
              )}
              <div>
                <div className="text-sm font-black text-white flex items-center gap-2">
                  <span>Résultat du test : {connResult.label}</span>
                  {connResult.httpStatus && (
                    <span className="px-2 py-0.5 rounded bg-slate-800 text-xs font-mono text-slate-300">
                      HTTP {connResult.httpStatus}
                    </span>
                  )}
                  <span className="px-2 py-0.5 rounded bg-slate-800 text-xs font-mono text-orange-300">
                    {connResult.latencyMs} ms
                  </span>
                </div>
                <p className="text-xs text-slate-300 mt-0.5">{connResult.details}</p>
              </div>
            </div>
            <div className="text-right text-[11px] text-slate-400 font-mono">
              <div>Endpoint: {connResult.endpointCalled}</div>
              <div>Horodatage: {new Date(connResult.timestamp).toLocaleTimeString()}</div>
            </div>
          </div>
        </div>
      )}

      {/* Key Metrics Bar (Section 18 Requirements) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5">
          <div className="text-[11px] text-slate-400">État Connexion</div>
          <div className="text-sm font-black text-emerald-400 mt-1 truncate">
            {config?.lastConnectionLabel || 'Prêt'}
          </div>
        </div>
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5">
          <div className="text-[11px] text-slate-400">Produits Total</div>
          <div className="text-lg font-black text-white mt-0.5">{metrics.totalProducts}</div>
        </div>
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5">
          <div className="text-[11px] text-slate-400">Produits Actifs</div>
          <div className="text-lg font-black text-emerald-400 mt-0.5">{metrics.activeProducts}</div>
        </div>
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5">
          <div className="text-[11px] text-slate-400">Indisponibles</div>
          <div className="text-lg font-black text-amber-400 mt-0.5">{metrics.unavailableProducts}</div>
        </div>
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5">
          <div className="text-[11px] text-slate-400">En attente (Pending)</div>
          <div className="text-lg font-black text-amber-300 mt-0.5">{metrics.pendingOrders}</div>
        </div>
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5">
          <div className="text-[11px] text-slate-400">Livrées (Delivered)</div>
          <div className="text-lg font-black text-emerald-400 mt-0.5">{metrics.deliveredOrders}</div>
        </div>
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5">
          <div className="text-[11px] text-slate-400">Échouées (Failed)</div>
          <div className="text-lg font-black text-rose-400 mt-0.5">{metrics.failedOrders}</div>
        </div>
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5">
          <div className="text-[11px] text-slate-400">Erreurs API</div>
          <div className="text-lg font-black text-rose-300 mt-0.5">{metrics.apiErrorsCount}</div>
        </div>
      </div>

      {/* Sub-navigation Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-slate-800 pb-3">
        {[
          { id: 'overview', label: 'Configuration & Sécurité', icon: Shield },
          { id: 'catalog', label: `Catalogue Régional (${products.length})`, icon: Package },
          { id: 'margins', label: 'Prix & Marges PlayUp', icon: DollarSign },
          { id: 'orders', label: `Commandes & Statuts (${orders.length})`, icon: Layers },
          { id: 'webhooks', label: `Webhooks HMAC-SHA256 (${webhookEvents.length})`, icon: Webhook },
          { id: 'logs', label: `Logs API (${apiLogs.length})`, icon: Terminal },
          { id: 'tests', label: 'Tests Finaux (1-12)', icon: CheckCircle2 }
        ].map(t => {
          const Icon = t.icon;
          const active = subTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setSubTab(t.id as any)}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-colors cursor-pointer ${
                active
                  ? 'bg-orange-500 text-white'
                  : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* TAB 1: CONFIGURATION & SECURITY */}
      {subTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <form
            onSubmit={handleSaveConfig}
            className="lg:col-span-2 bg-slate-900/90 border border-slate-800 rounded-2xl p-6 space-y-5"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Lock className="w-4 h-4 text-orange-400" />
                  <span>Configuration Serveur RechargeGames</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Les clés sont stockées uniquement côté backend. Elles ne sont jamais affichées en clair ni exposées au frontend/APK.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1.5">
                  Environnement d’exécution
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(['TEST', 'PRODUCTION'] as RechargeGamesMode[]).map(m => (
                    <button
                      type="button"
                      key={m}
                      onClick={() => setModeInput(m)}
                      className={`py-2.5 px-3 rounded-xl text-xs font-black border transition-all cursor-pointer ${
                        modeInput === m
                          ? m === 'PRODUCTION'
                            ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300'
                            : 'bg-amber-500/20 border-amber-500 text-amber-300'
                          : 'bg-slate-950 border-slate-800 text-slate-400'
                      }`}
                    >
                      {m === 'TEST' ? '🧪 MODE TEST' : '🚀 PRODUCTION'}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1.5">
                  RECHARGEGAMES_BASE_URL
                </label>
                <input
                  type="text"
                  value={baseUrlInput}
                  onChange={e => setBaseUrlInput(e.target.value)}
                  placeholder="https://api.rechargegames.com"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-bold text-slate-300">RECHARGEGAMES_API_KEY</label>
                  <span className="text-[11px] font-mono text-emerald-400">
                    Actuelle : {config?.apiKeyMasked || 'Non configurée'}
                  </span>
                </div>
                <input
                  type="password"
                  value={newApiKeyInput}
                  onChange={e => setNewApiKeyInput(e.target.value)}
                  placeholder="Laisser vide pour conserver la clé actuelle"
                  autoComplete="new-password"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs font-mono"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-bold text-slate-300">RECHARGEGAMES_WEBHOOK_SECRET</label>
                  <span className="text-[11px] font-mono text-emerald-400">
                    Actuel : {config?.webhookSecretMasked || 'Non configuré'}
                  </span>
                </div>
                <input
                  type="password"
                  value={newWebhookSecretInput}
                  onChange={e => setNewWebhookSecretInput(e.target.value)}
                  placeholder="Laisser vide pour conserver le secret HMAC actuel"
                  autoComplete="new-password"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs font-mono"
                />
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between">
              <div>
                <div className="text-xs font-bold text-white">Synchronisation automatique régulière du catalogue</div>
                <div className="text-[11px] text-slate-400">
                  Met à jour automatiquement les produits, prix fournisseurs et disponibilités depuis GET /v1/products
                </div>
              </div>
              <input
                type="checkbox"
                checked={autoSyncEnabled}
                onChange={e => setAutoSyncEnabled(e.target.checked)}
                className="w-4 h-4 accent-orange-500"
              />
            </div>

            <div className="p-4 rounded-xl bg-slate-950 border border-orange-500/40 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-orange-400 uppercase tracking-wider">
                  Your webhook address (https) — RechargeGames
                </span>
                <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-bold">
                  POST • ACTIVE • HMAC-SHA256
                </span>
              </div>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={`${typeof window !== 'undefined' ? window.location.origin : 'https://ais-pre-x2ludovvteawsky54uj7vr-266949098099.europe-west2.run.app'}/rechargegames-webhook`}
                  className="flex-1 px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-emerald-300 font-mono text-xs select-all"
                />
                <button
                  type="button"
                  onClick={() => {
                    const url = `${typeof window !== 'undefined' ? window.location.origin : 'https://ais-pre-x2ludovvteawsky54uj7vr-266949098099.europe-west2.run.app'}/rechargegames-webhook`;
                    navigator.clipboard?.writeText(url);
                    setStatusBanner({ type: 'success', text: `URL Webhook copiée : ${url}` });
                  }}
                  className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold cursor-pointer shrink-0"
                >
                  Copier l’URL Webhook
                </button>
              </div>
              <div className="text-[11px] text-slate-400 font-mono">
                URL Publique Partagée :{' '}
                <span className="text-slate-200 select-all">
                  https://ais-pre-x2ludovvteawsky54uj7vr-266949098099.europe-west2.run.app/rechargegames-webhook
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <div className="text-[11px] text-slate-400 font-mono">
                Endpoint Webhook : <span className="text-orange-400">POST /rechargegames-webhook</span>
              </div>
              <button
                type="submit"
                disabled={savingConfig}
                className="px-5 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold transition-colors cursor-pointer"
              >
                {savingConfig ? 'Enregistrement...' : 'Enregistrer la configuration'}
              </button>
            </div>
          </form>

          {/* Sync Status Summary Card */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 space-y-4">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Clock className="w-4 h-4 text-orange-400" />
              <span>État de la Synchronisation</span>
            </h3>

            <div className="space-y-2.5 text-xs">
              <div className="flex justify-between py-2 border-b border-slate-800">
                <span className="text-slate-400">Dernière synchronisation :</span>
                <span className="font-mono text-white">
                  {config?.syncStats.lastSyncedAt
                    ? new Date(config.syncStats.lastSyncedAt).toLocaleString()
                    : 'Jamais'}
                </span>
              </div>
              <div className="flex justify-between py-2 border-b border-slate-800">
                <span className="text-slate-400">Nombre de produits :</span>
                <span className="font-bold text-white">{metrics.totalProducts}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-slate-800">
                <span className="text-slate-400">Produits actifs :</span>
                <span className="font-bold text-emerald-400">{metrics.activeProducts}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-slate-800">
                <span className="text-slate-400">Produits indisponibles :</span>
                <span className="font-bold text-amber-400">{metrics.unavailableProducts}</span>
              </div>
              <div className="py-2 border-b border-slate-800">
                <div className="text-slate-400 mb-1.5">Régions détectées :</div>
                <div className="flex flex-wrap gap-1.5">
                  {(config?.syncStats.regionsAvailable || ['Brazil', 'USA', 'Global']).map(r => (
                    <span
                      key={r}
                      className="px-2 py-0.5 rounded-md bg-slate-800 text-slate-200 text-[11px] font-bold"
                    >
                      {getRegionBadge(r)}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {config?.syncStats.syncErrors && config.syncStats.syncErrors.length > 0 && (
              <div className="p-3 rounded-xl bg-rose-950/30 border border-rose-500/30 text-[11px] text-rose-300 space-y-1">
                <div className="font-bold">Erreurs de synchronisation récentes :</div>
                {config.syncStats.syncErrors.slice(0, 3).map((err, i) => (
                  <div key={i} className="truncate font-mono">
                    {err}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: CATALOGUE REGIONAL (Brazil 🇧🇷, USA 🇺🇸, Global 🌐) */}
      {subTab === 'catalog' && (
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 space-y-5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Globe className="w-4 h-4 text-orange-400" />
                <span>Catalogue RechargeGames par Région (product_key officiels)</span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Chaque produit utilise strictement son <code className="text-orange-300">product_key</code> et sa région d’origine (Brazil 🇧🇷, USA 🇺🇸, Global 🌐).
              </p>
            </div>

            {/* Region Filter Buttons */}
            <div className="flex flex-wrap items-center gap-2">
              {[
                { key: 'all', label: 'Toutes les régions' },
                { key: 'Brazil', label: 'Brazil 🇧🇷' },
                { key: 'USA', label: 'USA 🇺🇸' },
                { key: 'Global', label: 'Global 🌐' }
              ].map(rf => (
                <button
                  key={rf.key}
                  onClick={() => setRegionFilter(rf.key)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
                    regionFilter.toLowerCase() === rf.key.toLowerCase()
                      ? 'bg-orange-500 text-white border-orange-500'
                      : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  {rf.label}
                </button>
              ))}
            </div>
          </div>

          {/* Search & Game Filter */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2 relative">
              <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
              <input
                type="text"
                value={catalogSearch}
                onChange={e => setCatalogSearch(e.target.value)}
                placeholder="Rechercher par product_key (ex: ff_br_100, ff_us_100), nom ou jeu..."
                className="w-full pl-10 pr-4 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
              />
            </div>
            <select
              value={gameFilter}
              onChange={e => setGameFilter(e.target.value)}
              className="px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
            >
              <option value="all">Tous les jeux</option>
              {(config?.syncStats.gamesAvailable || []).map(g => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>

          {/* Products Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-3 px-3">product_key</th>
                  <th className="py-3 px-3">Jeu &amp; Région</th>
                  <th className="py-3 px-3">Nom du produit</th>
                  <th className="py-3 px-3">Prix Fournisseur (USD — Fixe)</th>
                  <th className="py-3 px-3">Coût Fournisseur Auto (HTG)</th>
                  <th className="py-3 px-3">Prix Vente Final PlayUp (HTG — Manuel)</th>
                  <th className="py-3 px-3">Bénéfice &amp; Marge (HTG)</th>
                  <th className="py-3 px-3">Disponibilité</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filteredProducts.map(prod => {
                  const activeRate = Number(usdToHtgRateInput) > 0 ? Number(usdToHtgRateInput) : (prod.exchange_rate_usd_htg || 132);
                  const supplierUsd = Number((prod.provider_price_usd ?? prod.provider_price ?? 0).toFixed(2));
                  const autoSupplierCostHtg = Number((supplierUsd * activeRate).toFixed(2));
                  const currentInputStr =
                    inlineProductPricesHtg[prod.product_key] !== undefined
                      ? inlineProductPricesHtg[prod.product_key]
                      : String(
                          typeof prod.playup_price_htg === 'number' && prod.playup_price_htg > 0
                            ? prod.playup_price_htg
                            : Number((Number(prod.playup_price || 0) * activeRate).toFixed(2))
                        );
                  const effectiveSellingHtg = Number(currentInputStr) > 0 ? Number(currentInputStr) : 0;
                  const autoProfitHtg = Number((effectiveSellingHtg - autoSupplierCostHtg).toFixed(2));
                  const autoMarginPct =
                    autoSupplierCostHtg > 0
                      ? Number(((autoProfitHtg / autoSupplierCostHtg) * 100).toFixed(2))
                      : 0;

                  return (
                    <tr key={prod.product_key} className="hover:bg-slate-800/30">
                      <td className="py-3 px-3 font-mono font-bold text-orange-300">
                        {prod.product_key}
                      </td>
                      <td className="py-3 px-3">
                        <div className="font-semibold text-white">{prod.game}</div>
                        <span className="inline-block mt-0.5 px-2 py-0.5 rounded bg-slate-800 text-slate-200 font-bold text-[10px]">
                          {getRegionBadge(prod.region)}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-slate-200">
                        <div>{prod.name}</div>
                        <div className="text-[10px] text-slate-400 font-mono">{prod.topup_value}</div>
                      </td>
                      <td className="py-3 px-3 font-mono text-slate-200">
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-950 border border-slate-800 font-bold" title="Prix fournisseur RechargeGames en USD — Ne jamais modifier">
                          <Lock className="w-3 h-3 text-slate-500" />
                          ${supplierUsd.toFixed(2)} USD
                        </span>
                      </td>
                      <td className="py-3 px-3 font-mono text-slate-300">
                        <div className="font-bold text-white">{autoSupplierCostHtg.toFixed(2)} HTG</div>
                        <div className="text-[10px] text-slate-500">
                          (${supplierUsd.toFixed(2)} × {activeRate})
                        </div>
                      </td>
                      <td className="py-3 px-3 font-mono">
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            step="1"
                            min="1"
                            value={currentInputStr}
                            onChange={e =>
                              setInlineProductPricesHtg(prev => ({
                                ...prev,
                                [prod.product_key]: e.target.value
                              }))
                            }
                            className="w-24 px-2 py-1 rounded-lg bg-slate-950 border border-orange-500/50 text-orange-300 font-mono font-bold text-xs"
                          />
                          <span className="text-[10px] font-bold text-slate-400">HTG</span>
                          <button
                            type="button"
                            disabled={savingProductKeyHtg === prod.product_key}
                            onClick={() => handleSaveManualProductPriceHtg(prod)}
                            className="px-2.5 py-1 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-sans font-bold text-[11px] cursor-pointer"
                          >
                            {savingProductKeyHtg === prod.product_key ? '...' : 'Sauver'}
                          </button>
                        </div>
                      </td>
                      <td className="py-3 px-3 font-mono">
                        <div className={`font-bold ${autoProfitHtg >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {autoProfitHtg >= 0 ? '+' : ''}{autoProfitHtg.toFixed(2)} HTG
                        </div>
                        <div className="text-[10px] text-slate-400">
                          Marge : {autoMarginPct >= 0 ? '+' : ''}{autoMarginPct.toFixed(1)}%
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        {prod.active ? (
                          <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold text-[11px]">
                            Actif
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 font-bold text-[11px]">
                            Indisponible
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: PRIX ET MARGE PLAYUP (Section 15 + Devise de référence USD -> HTG) */}
      {subTab === 'margins' && (
        <div className="space-y-6">
          {/* Configurable USD -> HTG Exchange Rate Box */}
          <div className="bg-slate-900/90 border border-orange-500/40 rounded-2xl p-6 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded-full bg-orange-500/20 text-orange-300 text-[10px] font-bold uppercase">
                    Devise Fournisseur RechargeGames : USD (Immuable)
                  </span>
                  <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-bold uppercase">
                    Devise de Vente PlayUp : HTG
                  </span>
                </div>
                <h3 className="text-base font-bold text-white">
                  Taux de Change USD → HTG &amp; Calcul Automatique des Coûts / Marges
                </h3>
                <p className="text-xs text-slate-400 max-w-3xl">
                  Les prix fournisseurs RechargeGames restent strictement en <strong>USD</strong>. Le système calcule automatiquement le coût fournisseur en <strong>HTG</strong>, le bénéfice en <strong>HTG</strong> et la marge. Le client voit uniquement le prix final PlayUp en <strong>HTG</strong>.
                </p>
              </div>

              <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 flex flex-wrap items-center gap-3">
                <div>
                  <label className="text-[10px] font-bold uppercase text-slate-400 block mb-1">
                    Taux USD → HTG
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-bold text-slate-300">1 USD =</span>
                    <input
                      type="number"
                      step="0.01"
                      min="1"
                      value={usdToHtgRateInput}
                      onChange={e => setUsdToHtgRateInput(e.target.value)}
                      className="w-28 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-700 text-orange-400 font-mono font-bold text-sm"
                    />
                    <span className="text-xs font-mono font-bold text-emerald-400">HTG</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleUpdateExchangeRate()}
                  disabled={savingExchangeRate}
                  className="px-4 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold cursor-pointer"
                >
                  {savingExchangeRate ? 'Application...' : 'Appliquer en Temps Réel'}
                </button>
              </div>
            </div>
          </div>

          <form
            onSubmit={handleSaveMargins}
            className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 space-y-6"
          >
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Sliders className="w-4 h-4 text-orange-400" />
                <span>Système de Marges PlayUp Côté Serveur</span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Ordre de priorité : <strong>Prix de vente manuel en HTG</strong> → <strong>Marge par produit (product_key)</strong> → <strong>Marge par région</strong> → <strong>Marge par jeu</strong> → <strong>Marge globale</strong>.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Global Margin */}
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                <div className="text-xs font-bold text-orange-400 uppercase">1. Marge Globale (%)</div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Pourcentage appliqué par défaut
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    max="200"
                    value={globalMargin}
                    onChange={e => setGlobalMargin(Number(e.target.value))}
                    className="w-full px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white font-mono text-sm"
                  />
                </div>
                <div className="text-[11px] text-slate-400 bg-slate-900 p-2.5 rounded-lg font-mono">
                  Exemple ($1.00 USD × {Number(usdToHtgRateInput) || 132} HTG) + {globalMargin}% ={' '}
                  <span className="text-emerald-400 font-bold">
                    {((Number(usdToHtgRateInput) || 132) * (1 + globalMargin / 100)).toFixed(2)} HTG
                  </span>
                </div>
              </div>

              {/* Region Margins */}
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                <div className="text-xs font-bold text-orange-400 uppercase">2. Marge par Région (%)</div>
                {['Brazil', 'USA', 'Global'].map(reg => (
                  <div key={reg} className="flex items-center justify-between gap-2">
                    <span className="text-xs text-slate-200 font-semibold">{getRegionBadge(reg)}</span>
                    <input
                      type="number"
                      step="0.5"
                      value={regionMargins[reg] ?? globalMargin}
                      onChange={e =>
                        setRegionMargins(prev => ({
                          ...prev,
                          [reg]: Number(e.target.value)
                        }))
                      }
                      className="w-24 px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-white font-mono text-xs text-right"
                    />
                  </div>
                ))}
              </div>

              {/* Game Margins */}
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                <div className="text-xs font-bold text-orange-400 uppercase">3. Marge par Jeu (%)</div>
                {['Free Fire', 'PUBG Mobile', 'Mobile Legends: Bang Bang', 'Call of Duty: Mobile', 'Roblox (Codes Digitaux / Vouchers)'].map(
                  gm => (
                    <div key={gm} className="flex items-center justify-between gap-2">
                      <span className="text-xs text-slate-200 truncate">{gm}</span>
                      <input
                        type="number"
                        step="0.5"
                        value={gameMargins[gm] ?? globalMargin}
                        onChange={e =>
                          setGameMargins(prev => ({
                            ...prev,
                            [gm]: Number(e.target.value)
                          }))
                        }
                        className="w-24 px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-white font-mono text-xs text-right"
                      />
                    </div>
                  )
                )}
              </div>
            </div>

            {/* Per-Product Margin Override */}
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
              <div className="text-xs font-bold text-orange-400 uppercase">
                4. Marge spécifique par Produit (product_key)
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <select
                  value={customProductKey}
                  onChange={e => setCustomProductKey(e.target.value)}
                  className="px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white"
                >
                  <option value="">Sélectionner un product_key...</option>
                  {products.map(p => (
                    <option key={p.product_key} value={p.product_key}>
                      {p.product_key} — {p.name} ({p.region})
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  step="0.5"
                  value={customProductMargin}
                  onChange={e => setCustomProductMargin(e.target.value)}
                  placeholder="Marge %"
                  className="w-28 px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white font-mono"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (!customProductKey) return;
                    setProductMargins(prev => ({
                      ...prev,
                      [customProductKey]: Number(customProductMargin)
                    }));
                    setCustomProductKey('');
                  }}
                  className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-white cursor-pointer"
                >
                  Ajouter règle produit
                </button>
              </div>

              {Object.keys(productMargins).length > 0 && (
                <div className="flex flex-wrap gap-2 pt-2">
                  {Object.entries(productMargins).map(([pk, mVal]) => (
                    <span
                      key={pk}
                      className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-700 text-xs font-mono text-orange-300 flex items-center gap-2"
                    >
                      <span>
                        {pk}: +{mVal}%
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          const next = { ...productMargins };
                          delete next[pk];
                          setProductMargins(next);
                        }}
                        className="text-rose-400 hover:text-rose-300"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={savingMargins}
                className="px-5 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold cursor-pointer"
              >
                {savingMargins ? 'Recalcul en cours...' : 'Enregistrer et recalculer les prix PlayUp en HTG'}
              </button>
            </div>
          </form>

          {/* Price & Exchange Rate History Table */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-bold text-white">
                  Historique des Modifications (Taux USD → HTG &amp; Prix de Vente HTG)
                </h4>
                <p className="text-xs text-slate-400">
                  Journal immuable de toutes les modifications du taux de change et des prix HTG appliquées en temps réel.
                </p>
              </div>
              <span className="px-2.5 py-1 rounded-full bg-slate-800 text-orange-300 text-xs font-mono font-bold">
                {priceHistory.length} entrée(s)
              </span>
            </div>

            {priceHistory.length === 0 ? (
              <div className="text-xs text-slate-500 py-4">
                Aucune modification enregistrée pour le moment.
              </div>
            ) : (
              <div className="overflow-x-auto max-h-72 overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400">
                      <th className="py-2 px-3">Horodatage</th>
                      <th className="py-2 px-3">Type</th>
                      <th className="py-2 px-3">Service / Produit</th>
                      <th className="py-2 px-3">Taux USD → HTG</th>
                      <th className="py-2 px-3">Fournisseur (USD)</th>
                      <th className="py-2 px-3">Coût Auto (HTG)</th>
                      <th className="py-2 px-3">Prix Vente (HTG)</th>
                      <th className="py-2 px-3">Bénéfice &amp; Marge (HTG)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {priceHistory.map(entry => (
                      <tr key={entry.id} className="hover:bg-slate-800/30">
                        <td className="py-2 px-3 font-mono text-[11px] text-slate-400">
                          {new Date(entry.timestamp).toLocaleString('fr-FR')}
                        </td>
                        <td className="py-2 px-3">
                          <span className="px-2 py-0.5 rounded bg-slate-800 text-orange-300 text-[10px] font-bold uppercase">
                            {entry.changeType === 'exchange_rate'
                              ? 'Taux USD → HTG'
                              : entry.changeType === 'manual_price_htg'
                              ? 'Prix Manuel HTG'
                              : 'Marge'}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-white font-semibold">
                          {entry.packageName || entry.reason}
                        </td>
                        <td className="py-2 px-3 font-mono text-slate-300">
                          {entry.previousExchangeRate && entry.previousExchangeRate !== entry.newExchangeRate
                            ? `${entry.previousExchangeRate} → ${entry.newExchangeRate} HTG`
                            : `1 USD = ${entry.newExchangeRate || usdToHtgRateInput} HTG`}
                        </td>
                        <td className="py-2 px-3 font-mono text-slate-300">
                          {typeof entry.supplierCostUsd === 'number'
                            ? `$${entry.supplierCostUsd.toFixed(2)} USD`
                            : '—'}
                        </td>
                        <td className="py-2 px-3 font-mono text-slate-200">
                          {typeof entry.newSupplierCostHtg === 'number'
                            ? `${entry.newSupplierCostHtg.toFixed(2)} HTG`
                            : '—'}
                        </td>
                        <td className="py-2 px-3 font-mono font-bold text-orange-400">
                          {typeof entry.newSellingPriceHtg === 'number'
                            ? `${entry.newSellingPriceHtg} HTG`
                            : '—'}
                        </td>
                        <td className="py-2 px-3 font-mono font-bold text-emerald-400">
                          {typeof entry.profitHtg === 'number'
                            ? `+${entry.profitHtg.toFixed(2)} HTG (${entry.marginPercent?.toFixed(1) || 0}%)`
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 4: COMMANDES, VALIDATION MANUELLE, RETRIES (MAX 3) & REMBOURSEMENTS STRICTS */}
      {subTab === 'orders' && (
        <div className="space-y-6">
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-white">
                  Commandes PlayUp / RechargeGames — Validation Manuelle, Retries (Max 3) & Remboursements Stricts
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Flux obligatoire : <code className="text-orange-300">Validation manuelle → payment_verified → order_pending → sent_to_rechargegames → suivi réel → delivered/failed</code> • Limite stricte : <code className="text-amber-300">3 tentatives auto (1m, 5m, 15m) → manual_review</code> • Remboursement : <code className="text-sky-300">refund_status != refunded</code>
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="py-3 px-2.5">Commande & buyer_ref</th>
                    <th className="py-3 px-2.5">provider_order_id</th>
                    <th className="py-3 px-2.5">Produit & Player ID</th>
                    <th className="py-3 px-2.5">Montant</th>
                    <th className="py-3 px-2.5">Paiement</th>
                    <th className="py-3 px-2.5">Statut Commande & Retries</th>
                    <th className="py-3 px-2.5">Statut Remboursement</th>
                    <th className="py-3 px-2.5">Actions Administrateur</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {orders.map(ord => {
                    const isAwaitingManualPayment =
                      (ord.payment_status === 'payment_pending' || ord.payment_status === 'payment_processing') &&
                      ord.dispatch_status === 'awaiting_payment';
                    const isRefunded = ord.status === 'refunded' || ord.refund_status === 'refunded';
                    const isDelivered = ord.status === 'delivered' || ord.lifecycle_status === 'order_delivered';
                    const isEligibleForManualRefund =
                      !isRefunded &&
                      !isDelivered &&
                      (ord.payment_status === 'payment_succeeded' || ord.payment_status === 'payment_verified') &&
                      (ord.status === 'failed' || ord.status === 'manual_review');
                    const canRetryManually =
                      !isDelivered &&
                      !isRefunded &&
                      (ord.payment_status === 'payment_succeeded' || ord.payment_status === 'payment_verified') &&
                      Boolean(ord.real_status_verified_before_manual_retry_at);

                    return (
                      <tr key={ord.id} className="hover:bg-slate-800/30">
                        <td className="py-3 px-2.5">
                          <div className="font-mono font-bold text-white">
                            #{ord.id}
                            {ord.test_mode && (
                              <span className="ml-1.5 px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[10px]">
                                TEST
                              </span>
                            )}
                          </div>
                          <div className="font-mono text-[11px] text-orange-300">{ord.buyer_ref}</div>
                        </td>
                        <td className="py-3 px-2.5 font-mono text-slate-400 text-[11px]">
                          {ord.provider_order_id}
                        </td>
                        <td className="py-3 px-2.5">
                          <div className="font-semibold text-white">{ord.product_name}</div>
                          <div className="text-[11px] text-slate-400 font-mono">
                            {ord.product_key} • {getRegionBadge(ord.region)} • ID: {ord.player_id}
                          </div>
                        </td>
                        <td className="py-3 px-2.5 font-mono">
                          <div className="text-white font-bold">
                            ${ord.customer_price.toFixed(2)} {ord.currency}
                          </div>
                          <div className="text-[10px] text-emerald-400">
                            Profit: +${ord.profit.toFixed(2)}
                          </div>
                        </td>
                        <td className="py-3 px-2.5">
                          <span
                            className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold ${
                              ord.payment_status === 'payment_verified' ||
                              ord.payment_status === 'payment_succeeded'
                                ? 'bg-emerald-500/20 text-emerald-300'
                                : ord.payment_status === 'payment_refunded'
                                ? 'bg-sky-500/20 text-sky-300'
                                : ord.payment_status === 'payment_failed' ||
                                  ord.payment_status === 'payment_cancelled'
                                ? 'bg-rose-500/20 text-rose-300'
                                : 'bg-amber-500/20 text-amber-300'
                            }`}
                          >
                            {ord.payment_status || 'payment_succeeded'}
                          </span>
                        </td>
                        <td className="py-3 px-2.5">
                          {ord.status === 'delivered' ? (
                            <span className="px-2.5 py-1 rounded-md bg-emerald-500/20 text-emerald-300 font-bold text-[11px]">
                              delivered
                            </span>
                          ) : ord.status === 'manual_review' ? (
                            <div>
                              <span className="px-2.5 py-1 rounded-md bg-purple-500/20 text-purple-300 font-bold text-[11px] border border-purple-500/40">
                                manual_review (3/3 échecs)
                              </span>
                              <div className="text-[10px] text-purple-300 mt-1">
                                Retries auto arrêtés
                              </div>
                            </div>
                          ) : ord.status === 'sent_to_rechargegames' ? (
                            <span className="px-2.5 py-1 rounded-md bg-blue-500/20 text-blue-300 font-bold text-[11px]">
                              sent_to_rechargegames
                            </span>
                          ) : ord.status === 'refunded' ? (
                            <span className="px-2.5 py-1 rounded-md bg-sky-500/20 text-sky-300 font-bold text-[11px]">
                              refunded
                            </span>
                          ) : ord.status === 'failed' ? (
                            <div>
                              <span className="px-2.5 py-1 rounded-md bg-rose-500/20 text-rose-300 font-bold text-[11px]">
                                failed
                              </span>
                              {ord.failure_reason && (
                                <div className="text-[10px] text-rose-400 mt-1 max-w-[160px] truncate">
                                  {ord.failure_reason}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="px-2.5 py-1 rounded-md bg-amber-500/20 text-amber-300 font-bold text-[11px]">
                              {ord.status}
                            </span>
                          )}
                          <div className="text-[10px] font-mono text-slate-400 mt-1">
                            Tentatives: {ord.retry_count ?? 0}/{ord.max_retries ?? 3}
                            {ord.real_status_verified_before_manual_retry_at && (
                              <span className="ml-1.5 text-emerald-400">• Statut vérifié ✓</span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-2.5">
                          <span
                            className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold ${
                              ord.refund_status === 'refunded' || ord.status === 'refunded'
                                ? 'bg-sky-500/20 text-sky-300'
                                : ord.refund_status === 'refund_pending'
                                ? 'bg-amber-500/20 text-amber-300'
                                : ord.refund_status === 'refund_failed'
                                ? 'bg-rose-500/20 text-rose-300'
                                : 'bg-slate-800 text-slate-400'
                            }`}
                          >
                            {ord.refund_status || (ord.status === 'refunded' ? 'refunded' : 'none')}
                          </span>
                          {ord.refund_transaction_id && (
                            <div className="text-[10px] text-sky-400 font-mono mt-0.5">
                              {ord.refund_transaction_id}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-2.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {/* 1. Vérifier statut réel auprès de RechargeGames */}
                            <button
                              onClick={() => handleCheckOrderStatus(ord.id)}
                              disabled={checkingOrderId === ord.id}
                              title="Vérifier l'état réel de la commande auprès de RechargeGames"
                              className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-[11px] font-mono flex items-center gap-1 cursor-pointer"
                            >
                              <RefreshCw
                                className={`w-3 h-3 ${checkingOrderId === ord.id ? 'animate-spin' : ''}`}
                              />
                              <span>Vérifier statut</span>
                            </button>

                            {/* 2. Valider le paiement manuellement (Request #9) */}
                            {isAwaitingManualPayment && (
                              <button
                                onClick={() => handleValidatePaymentManually(ord.id)}
                                disabled={validatingOrderId === ord.id}
                                className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold cursor-pointer"
                              >
                                {validatingOrderId === ord.id ? 'Validation...' : 'Valider le paiement'}
                              </button>
                            )}

                            {/* 3. Nouvelle tentative manuelle (Request #10: uniquement après vérification du statut réel) */}
                            {!isDelivered && !isRefunded && !isAwaitingManualPayment && (
                              <button
                                onClick={() => handleManualRetryOrder(ord.id)}
                                disabled={!canRetryManually || retryingOrderId === ord.id}
                                title={
                                  canRetryManually
                                    ? 'Relancer manuellement avec le même buyer_ref'
                                    : 'Cliquez d’abord sur « Vérifier statut » avant de relancer manuellement'
                                }
                                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold ${
                                  canRetryManually
                                    ? 'bg-orange-500 hover:bg-orange-600 text-white cursor-pointer'
                                    : 'bg-slate-800/50 text-slate-500 cursor-not-allowed'
                                }`}
                              >
                                {retryingOrderId === ord.id ? 'Retry...' : 'Retry manuel'}
                              </button>
                            )}

                            {/* 4. Rembourser manuellement (Request #8: uniquement si les conditions strictes sont respectées) */}
                            {isEligibleForManualRefund && (
                              <button
                                onClick={() => handleOpenRefundModal(ord.id)}
                                className="px-2.5 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-[11px] font-bold cursor-pointer"
                              >
                                Rembourser
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {orders.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-slate-500">
                        Aucune commande RechargeGames enregistrée.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Historique des Tentatives de Commande (Request #10) & Remboursements Vérifiables (Request #8) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-3">
              <h4 className="text-sm font-bold text-white flex items-center justify-between">
                <span>Historique des Tentatives (Max 3 • 1 min, 5 min, 15 min)</span>
                <span className="text-xs font-mono text-orange-400">{retryAttempts.length} tentatives</span>
              </h4>
              <div className="max-h-64 overflow-y-auto space-y-2">
                {retryAttempts.slice(0, 12).map(att => (
                  <div
                    key={att.id}
                    className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between font-mono">
                      <span className="text-orange-300 font-bold">
                        #{att.order_id} ({att.buyer_ref}) — Tentative #{att.attempt_number} ({att.trigger_type})
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          att.status === 'succeeded'
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : att.status === 'escalated_manual_review'
                            ? 'bg-purple-500/20 text-purple-300'
                            : 'bg-rose-500/20 text-rose-300'
                        }`}
                      >
                        {att.status}
                      </span>
                    </div>
                    <div className="text-slate-300">{att.result}</div>
                    <div className="text-[10px] text-slate-500 font-mono flex justify-between">
                      <span>Motif: {att.reason}</span>
                      <span>{new Date(att.timestamp).toLocaleString()}</span>
                    </div>
                  </div>
                ))}
                {retryAttempts.length === 0 && (
                  <div className="text-xs text-slate-500 py-4 text-center">
                    Aucune tentative enregistrée.
                  </div>
                )}
              </div>
            </div>

            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-3">
              <h4 className="text-sm font-bold text-white flex items-center justify-between">
                <span>Registre des Remboursements & Validations Manuelles</span>
                <span className="text-xs font-mono text-sky-400">{refunds.length} remboursements</span>
              </h4>
              <div className="max-h-64 overflow-y-auto space-y-2">
                {refunds.slice(0, 8).map(rf => (
                  <div
                    key={rf.id}
                    className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between font-mono">
                      <span className="text-sky-300 font-bold">
                        refund_id: {rf.refund_id || rf.id} • Commande #{rf.orderId}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 text-[10px] font-bold">
                        {rf.refund_status || rf.status} (${rf.amount.toFixed(2)} {rf.currency})
                      </span>
                    </div>
                    <div className="text-slate-300">Raison : {rf.reason}</div>
                    <div className="text-[10px] text-slate-500 font-mono flex justify-between">
                      <span>
                        admin_id: {rf.admin_id || 'system_auto'} • Méthode: {rf.refundMethod || 'wallet'}
                      </span>
                      <span>{new Date(rf.createdAt).toLocaleString()}</span>
                    </div>
                  </div>
                ))}
                {manualValidations.slice(0, 5).map(mv => (
                  <div
                    key={mv.id}
                    className="p-3 rounded-xl bg-slate-950 border border-emerald-500/30 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between font-mono">
                      <span className="text-emerald-300 font-bold">
                        Validation manuelle #{mv.order_id} ({mv.buyer_ref})
                      </span>
                      <span className="text-white font-bold">
                        ${mv.amount.toFixed(2)} {mv.currency}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-300 font-mono">
                      {mv.previous_status} → {mv.payment_status} → {mv.new_status} ({mv.provider_order_id})
                    </div>
                    <div className="text-[10px] text-slate-500 font-mono flex justify-between">
                      <span>Admin: {mv.admin_email || mv.admin_id}</span>
                      <span>{new Date(mv.timestamp).toLocaleString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Modale de Confirmation de Remboursement Manuel (Request #8) */}
          {refundModalPreview && (
            <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
              <form
                onSubmit={handleConfirmManualRefund}
                className="bg-slate-900 border border-slate-700 rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl"
              >
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <h3 className="text-base font-black text-white">
                    Confirmer le Remboursement Manuel PlayUp
                  </h3>
                  <button
                    type="button"
                    onClick={() => setRefundModalPreview(null)}
                    className="text-slate-400 hover:text-white text-sm"
                  >
                    ✕
                  </button>
                </div>

                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Montant à rembourser :</span>
                    <span className="font-mono font-black text-emerald-400 text-sm">
                      ${refundModalPreview.amount.toFixed(2)} {refundModalPreview.currency}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Commande concernée :</span>
                    <span className="font-mono font-bold text-white">
                      #{refundModalPreview.orderId} ({refundModalPreview.buyerRef})
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Utilisateur :</span>
                    <span className="text-slate-200 font-semibold">
                      {refundModalPreview.userName} ({refundModalPreview.userEmail})
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Produit :</span>
                    <span className="text-slate-300">{refundModalPreview.productName}</span>
                  </div>
                </div>

                <div className="space-y-3 text-xs">
                  <div>
                    <label className="block font-bold text-slate-300 mb-1">
                      Méthode de remboursement
                    </label>
                    <select
                      value={refundModalPreview.refundMethod}
                      onChange={e =>
                        setRefundModalPreview(prev =>
                          prev ? { ...prev, refundMethod: e.target.value } : null
                        )
                      }
                      className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white"
                    >
                      <option value="wallet">Solde Portefeuille PlayUp (wallet)</option>
                      <option value="moncash">MonCash Digicel</option>
                      <option value="natcash">NatCash Natcom</option>
                      <option value="card">Carte Bancaire d’origine</option>
                    </select>
                  </div>

                  <div>
                    <label className="block font-bold text-slate-300 mb-1">
                      Raison du remboursement (obligatoire)
                    </label>
                    <input
                      type="text"
                      required
                      value={refundModalPreview.reason}
                      onChange={e =>
                        setRefundModalPreview(prev =>
                          prev ? { ...prev, reason: e.target.value } : null
                        )
                      }
                      className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setRefundModalPreview(null)}
                    className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-bold cursor-pointer"
                  >
                    Annuler
                  </button>
                  <button
                    type="submit"
                    disabled={executingRefund}
                    className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold cursor-pointer"
                  >
                    {executingRefund ? 'Remboursement en cours...' : 'Confirmer et Exécuter le Remboursement'}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      )}

      {/* TAB 5: WEBHOOKS HMAC-SHA256 (webhook_events) */}
      {subTab === 'webhooks' && (
        <div className="space-y-6">
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Webhook className="w-4 h-4 text-orange-400" />
                  <span>Webhook Public HTTPS, HMAC-SHA256 & Idempotence Firestore</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Endpoint : <code className="text-orange-300">POST /rechargegames-webhook</code> • Idempotence : <code className="text-emerald-300">/webhook_events/&#123;eventId&#125;</code> (Firestore) • En-têtes : <code className="text-slate-300">webhook-id</code>, <code className="text-slate-300">webhook-timestamp</code>, <code className="text-slate-300">webhook-signature</code>
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={selectedOrderForWebhook}
                  onChange={e => setSelectedOrderForWebhook(e.target.value)}
                  className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
                >
                  <option value="">Commande cible (automatique)</option>
                  {orders.map(o => (
                    <option key={o.id} value={o.id}>
                      #{o.id} ({o.buyer_ref}) — {o.status}
                    </option>
                  ))}
                </select>

                <button
                  onClick={() => handleSimulateWebhook('webhook.test')}
                  disabled={testingWebhook}
                  className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold cursor-pointer"
                >
                  1. webhook.test (Valide)
                </button>
                <button
                  onClick={() => handleSimulateWebhook('order.delivered')}
                  disabled={testingWebhook}
                  className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer"
                >
                  2. order.delivered
                </button>
                <button
                  onClick={() => handleSimulateWebhook('order.refunded')}
                  disabled={testingWebhook}
                  className="px-3 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold cursor-pointer"
                >
                  3. order.refunded (Remboursement)
                </button>
                <button
                  onClick={() => handleSimulateWebhook('order.failed')}
                  disabled={testingWebhook}
                  className="px-3 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold cursor-pointer"
                >
                  4. order.failed
                </button>
                <button
                  onClick={() => handleSimulateWebhook('order.delivered', { simulateInvalidSignature: true })}
                  disabled={testingWebhook}
                  className="px-3 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold cursor-pointer"
                >
                  5. Signature Invalide (401)
                </button>
                <button
                  onClick={() => handleSimulateWebhook('webhook.test', { simulateDuplicateEvent: true })}
                  disabled={testingWebhook}
                  className="px-3 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold cursor-pointer"
                >
                  6. Événement Déjà Traité
                </button>
                <button
                  onClick={() => handleSimulateWebhook('webhook.test', { simulateInvalidPayload: true })}
                  disabled={testingWebhook}
                  className="px-3 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-white text-xs font-bold cursor-pointer"
                >
                  7. Données Invalides (400)
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="py-3 px-2.5">Date & Heure</th>
                    <th className="py-3 px-2.5">ID Événement (event_id)</th>
                    <th className="py-3 px-2.5">Type d’événement</th>
                    <th className="py-3 px-2.5">ID RechargeGames</th>
                    <th className="py-3 px-2.5">ID PlayUp / buyer_ref</th>
                    <th className="py-3 px-2.5">Idempotence Firestore</th>
                    <th className="py-3 px-2.5">Signature HMAC-SHA256</th>
                    <th className="py-3 px-2.5">Résultat & Erreur éventuelle</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {webhookEvents.map((ev, idx) => (
                    <tr key={`${ev.event_id}_${idx}`} className="hover:bg-slate-800/30">
                      <td className="py-3 px-2.5 font-mono text-slate-400 whitespace-nowrap">
                        {new Date(ev.received_at).toLocaleString()}
                      </td>
                      <td className="py-3 px-2.5 font-mono text-orange-300">{ev.event_id}</td>
                      <td className="py-3 px-2.5 font-mono font-bold text-white">{ev.event_type}</td>
                      <td className="py-3 px-2.5 font-mono text-slate-300">
                        {ev.provider_order_id || ev.order_id || '—'}
                      </td>
                      <td className="py-3 px-2.5 font-mono text-slate-300">
                        {ev.playup_order_id || ev.order_id || '—'}{' '}
                        {ev.buyer_ref ? <span className="text-slate-500">({ev.buyer_ref})</span> : ''}
                      </td>
                      <td className="py-3 px-2.5">
                        {ev.firestore_idempotency_status === 'stored' || ev.processing_status === 'processed' ? (
                          <div>
                            <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono text-[10px] font-bold">
                              🔒 Verrouillé Firestore
                            </span>
                            <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                              {ev.firestore_doc_path || `webhook_events/${ev.event_id}`}
                            </div>
                          </div>
                        ) : ev.firestore_idempotency_status === 'duplicate_blocked' || ev.processing_status === 'duplicate_ignored' ? (
                          <div>
                            <span className="px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 font-mono text-[10px] font-bold">
                              🛡️ Doublon bloqué (Firestore)
                            </span>
                            <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                              {ev.firestore_doc_path || `webhook_events/${ev.event_id}`}
                            </div>
                          </div>
                        ) : (
                          <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-400 font-mono text-[10px]">
                            Non verrouillé (Rejeté)
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-2.5">
                        {ev.signature_valid ? (
                          <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono text-[11px]">
                            ✓ Validée ({ev.computed_hmac_preview})
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 font-mono text-[11px]">
                            ✗ Rejetée (HMAC invalide)
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-2.5">
                        <span
                          className={`px-2 py-0.5 rounded font-mono text-[11px] font-bold ${
                            ev.processing_status === 'processed'
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : ev.processing_status === 'duplicate_ignored'
                              ? 'bg-purple-500/20 text-purple-300'
                              : 'bg-rose-500/20 text-rose-300'
                          }`}
                        >
                          {ev.processing_status}
                        </span>
                        {ev.error_message && (
                          <div className="text-[11px] text-rose-400 mt-1">{ev.error_message}</div>
                        )}
                      </td>
                    </tr>
                  ))}
                  {webhookEvents.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-slate-500">
                        Aucun événement webhook enregistré dans webhook_events.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 6: LOGS API RECHARGEGAMES */}
      {subTab === 'logs' && (
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 space-y-4">
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <Terminal className="w-4 h-4 text-orange-400" />
            <span>Logs API RechargeGames (Clés et secrets masqués)</span>
          </h3>
          <div className="space-y-3">
            {apiLogs.map(log => (
              <div
                key={log.id}
                className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2 text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded font-bold ${
                        log.success
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : 'bg-rose-500/20 text-rose-300'
                      }`}
                    >
                      {log.httpMethod} {log.httpStatus || 'ERR'}
                    </span>
                    <span className="font-mono text-white font-bold">{log.actionType}</span>
                    <span className="font-mono text-slate-400">{log.endpoint}</span>
                  </div>
                  <div className="font-mono text-slate-400">
                    {log.latencyMs} ms • {new Date(log.timestamp).toLocaleTimeString()}
                  </div>
                </div>
                <div className="text-slate-300">{log.resultLabel}</div>
                {log.responsePreview && (
                  <pre className="p-2.5 rounded-lg bg-slate-900 text-[11px] font-mono text-emerald-300 overflow-x-auto max-h-40">
                    {log.responsePreview}
                  </pre>
                )}
                {log.errorMessage && (
                  <pre className="p-2.5 rounded-lg bg-rose-950/40 text-[11px] font-mono text-rose-300 overflow-x-auto">
                    {log.errorMessage}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 7: SUITE DE TESTS FINAUX (Tests 1 à 12) */}
      {subTab === 'tests' && (
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Activity className="w-4 h-4 text-emerald-400" />
                <span>Vérification de Bout en Bout RechargeGames (Tests Officiels 1 à 12)</span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Exécute réellement chaque test contre le backend PlayUp et la passerelle RechargeGames v1.
              </p>
            </div>
            <button
              onClick={handleRunTestSuite}
              disabled={runningSuite}
              className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-2 cursor-pointer"
            >
              <Play className="w-4 h-4" />
              <span>{runningSuite ? 'Exécution en cours...' : 'Relancer tous les tests'}</span>
            </button>
          </div>

          {suiteResults ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {suiteResults.map(t => (
                <div
                  key={t.testNumber}
                  className={`p-4 rounded-xl border ${
                    t.passed
                      ? 'bg-emerald-950/20 border-emerald-500/30'
                      : 'bg-rose-950/20 border-rose-500/30'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 font-bold text-xs text-white">
                      {t.passed ? (
                        <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                      ) : (
                        <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
                      )}
                      <span>{t.name}</span>
                    </div>
                    <span className="text-[11px] font-mono text-slate-400">{t.durationMs} ms</span>
                  </div>
                  <p className="text-xs text-slate-300 mt-1.5">{t.details}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-8 text-center text-slate-400 text-xs">
              Cliquez sur « Exécuter les 12 Tests Officiels » pour lancer la validation complète.
            </div>
          )}
        </div>
      )}
    </div>
  );
};
