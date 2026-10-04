import React, { useState, useEffect } from 'react';
import { 
  Home, Gamepad2, ShoppingBag, HelpCircle, User, ArrowLeft, 
  Check, CheckCircle2, AlertCircle, RefreshCw, Smartphone, 
  CreditCard, ShieldCheck, Zap, Bell, ChevronRight, Search, 
  ExternalLink, Sparkles 
} from 'lucide-react';
import { Game, Service, ServicePackage, Order, PlayerCheckResult, UserNotification } from '../../types';
import { apiClient } from '../../services/apiClient';
import { Language, translations } from '../../i18n';

interface PlayUpMobileAppProps {
  games: Game[];
  services: Service[];
  onClose: () => void;
  lang: Language;
}

export const PlayUpMobileApp: React.FC<PlayUpMobileAppProps> = ({
  games,
  services,
  onClose,
  lang
}) => {
  const t = translations[lang].mobileApp;

  // Active bottom navigation tab
  const [activeTab, setActiveTab] = useState<'home' | 'games' | 'orders' | 'support' | 'profile'>('home');

  // Device frame toggle (Phone Frame vs Expanded View)
  const [deviceFrameMode, setDeviceFrameMode] = useState<boolean>(true);

  // Purchase Flow State
  const [selectedGame, setSelectedGame] = useState<Game | null>(null);
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [selectedPackage, setSelectedPackage] = useState<ServicePackage | null>(null);
  const [gameProfileInputs, setGameProfileInputs] = useState<Record<string, string>>({});
  const [savedProfiles, setSavedProfiles] = useState<Array<{
    id: string;
    gameId: string;
    gameName: string;
    label: string;
    data: Record<string, string>;
  }>>([
    {
      id: 'prof_ff_01',
      gameId: 'game_ff',
      gameName: 'Free Fire',
      label: 'Compte Principal (Robenson)',
      data: { playerName: 'Robenson', playerId: '123456789' }
    }
  ]);

  // Order submission & GoXtop Name Checker + Payment step
  const [isOrdering, setIsOrdering] = useState(false);
  const [currentOrder, setCurrentOrder] = useState<Order | null>(null);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [isCheckingPlayer, setIsCheckingPlayer] = useState(false);
  const [playerCheckResult, setPlayerCheckResult] = useState<PlayerCheckResult | null>(null);
  const [showPaymentStep, setShowPaymentStep] = useState(false);
  const [pendingPartnerOrderId, setPendingPartnerOrderId] = useState<string>('');
  const [notifications, setNotifications] = useState<UserNotification[]>([]);

  // Recent user orders
  const [userOrders, setUserOrders] = useState<Order[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);

  // Search in Games tab
  const [gameSearch, setGameSearch] = useState('');

  // Support mini-ticket in app
  const [supportSubmitted, setSupportSubmitted] = useState(false);
  const [supportMessage, setSupportMessage] = useState('');

  // Notifications drawer
  const [showNotifications, setShowNotifications] = useState(false);

  useEffect(() => {
    loadUserOrders();
    loadNotifications();
  }, []);

  const loadNotifications = async () => {
    try {
      const list = await apiClient.getNotifications();
      setNotifications(list);
    } catch (e) {
      console.error(e);
    }
  };

  const loadUserOrders = async () => {
    setOrdersLoading(true);
    try {
      const orders = await apiClient.getRecentOrders();
      setUserOrders(orders);
    } catch (e) {
      console.error(e);
    } finally {
      setOrdersLoading(false);
    }
  };

  // Start purchase for a game
  const handleSelectGame = (game: Game) => {
    setSelectedGame(game);
    const gameServices = services.filter(s => s.gameId === game.id && s.isActive);
    setSelectedService(gameServices[0] || null);
    setSelectedPackage(null);
    setPlayerCheckResult(null);
    setShowPaymentStep(false);
    setPendingPartnerOrderId(`PTNR-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`);

    // Check if user has saved profile for this game to auto-fill
    const existing = savedProfiles.find(p => p.gameId === game.id);
    if (existing) {
      setGameProfileInputs({ ...existing.data });
    } else {
      const initialFields: Record<string, string> = {};
      game.fields.forEach(f => {
        if (f.type === 'select' && f.options && f.options.length > 0) {
          initialFields[f.name] = f.options[0];
        } else {
          initialFields[f.name] = '';
        }
      });
      setGameProfileInputs(initialFields);
    }
  };

  // Verify Player Name via GoXtop Name Checker (e.g. Free Fire)
  const handleVerifyPlayer = async () => {
    if (!selectedGame) return;
    setIsCheckingPlayer(true);
    setOrderError(null);
    try {
      const res = await apiClient.checkPlayer(selectedGame.id, gameProfileInputs);
      setPlayerCheckResult(res);
    } catch (err: any) {
      setPlayerCheckResult({
        supported: true,
        verified: false,
        message: err.message || 'Erreur lors de la vérification du joueur'
      });
    } finally {
      setIsCheckingPlayer(false);
    }
  };

  // Proceed to confirmation & payment step
  const handleProceedToPayment = () => {
    if (!selectedGame || !selectedService || !selectedPackage) return;

    const requiresPlayer = selectedPackage.requiresPlayerId !== false && selectedGame.requiresPlayerId !== false;
    if (requiresPlayer) {
      for (const field of selectedGame.fields) {
        if (selectedPackage.requiredFields && selectedPackage.requiredFields.length > 0 && !selectedPackage.requiredFields.includes(field.name)) {
          continue;
        }
        if (field.required && !gameProfileInputs[field.name]?.trim()) {
          setOrderError(`Veuillez renseigner "${field.label}"`);
          return;
        }
        if (field.validationRegex && gameProfileInputs[field.name]) {
          const regex = new RegExp(field.validationRegex);
          if (!regex.test(gameProfileInputs[field.name])) {
            setOrderError(`Format invalide pour "${field.label}" (${field.helperText || ''})`);
            return;
          }
        }
      }
    }

    setOrderError(null);
    if (!pendingPartnerOrderId) {
      setPendingPartnerOrderId(`PTNR-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`);
    }
    setShowPaymentStep(true);
  };

  // Submit order (Idempotent with partner_orderid)
  const handleConfirmOrder = async () => {
    if (!selectedGame || !selectedService || !selectedPackage || isOrdering) return;

    setIsOrdering(true);
    setOrderError(null);

    try {
      const order = await apiClient.createMobileOrder({
        gameId: selectedGame.id,
        serviceId: selectedService.id,
        packageId: selectedPackage.id,
        gameProfileData: gameProfileInputs,
        verifiedPlayerName: playerCheckResult?.verified ? playerCheckResult.playerName : undefined,
        paymentConfirmed: true,
        partnerOrderId: pendingPartnerOrderId || undefined
      });

      setCurrentOrder(order);
      setShowPaymentStep(false);

      // Save to savedProfiles if not already there
      const profKey = `${selectedGame.id}_${Object.values(gameProfileInputs).join('_')}`;
      if (!savedProfiles.some(p => p.id === profKey)) {
        setSavedProfiles(prev => [
          ...prev,
          {
            id: profKey,
            gameId: selectedGame.id,
            gameName: selectedGame.name,
            label: playerCheckResult?.playerName || gameProfileInputs.playerName || gameProfileInputs.playerId || 'Mon Profil',
            data: { ...gameProfileInputs }
          }
        ]);
      }

      await loadUserOrders();
      await loadNotifications();

      // Poll order status until complete
      pollOrderStatus(order.id);
    } catch (err: any) {
      setOrderError(err.message || 'Erreur lors du traitement de la commande');
    } finally {
      setIsOrdering(false);
    }
  };

  const pollOrderStatus = (orderId: string) => {
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      try {
        const refreshed = await apiClient.getMobileOrder(orderId);
        setCurrentOrder(refreshed);
        if (refreshed.status === 'completed' || refreshed.status === 'failed' || attempts > 10) {
          clearInterval(interval);
          loadUserOrders();
          loadNotifications();
        }
      } catch (e) {
        clearInterval(interval);
      }
    }, 1500);
  };

  const resetPurchaseFlow = () => {
    setSelectedGame(null);
    setSelectedService(null);
    setSelectedPackage(null);
    setCurrentOrder(null);
    setOrderError(null);
    setPlayerCheckResult(null);
    setShowPaymentStep(false);
    setPendingPartnerOrderId('');
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex flex-col items-center justify-center p-0 sm:p-4 overflow-y-auto">
      {/* Top Controller Bar */}
      <div className="w-full max-w-md sm:max-w-xl mx-auto flex items-center justify-between px-4 py-2 text-white text-xs mb-2">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="font-semibold">Simulateur Mobile PlayUp v2.4</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setDeviceFrameMode(!deviceFrameMode)}
            className="hover:text-orange-400 transition-colors hidden sm:block"
          >
            {deviceFrameMode ? 'Agrandir la vue' : 'Format Téléphone'}
          </button>
          <button
            onClick={onClose}
            className="px-3 py-1 bg-white/10 hover:bg-white/20 rounded-lg text-white font-semibold transition-colors"
          >
            Quitter le mode App ✕
          </button>
        </div>
      </div>

      {/* Main Smartphone Shell Container */}
      <div className={`w-full transition-all duration-300 ${
        deviceFrameMode 
          ? 'max-w-[420px] h-[860px] max-h-[92vh] rounded-[44px] border-[10px] border-slate-900 shadow-2xl relative overflow-hidden bg-white flex flex-col ring-1 ring-slate-700/50' 
          : 'max-w-2xl h-[92vh] rounded-3xl border border-slate-700 shadow-2xl bg-white flex flex-col overflow-hidden'
      }`}>
        {/* Phone Notch / Dynamic Island */}
        {deviceFrameMode && (
          <div className="w-full bg-slate-900 h-6 flex justify-center items-center shrink-0">
            <div className="w-24 h-4 bg-slate-950 rounded-full flex items-center justify-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-slate-800" />
              <span className="w-2 h-2 rounded-full bg-slate-700/80" />
            </div>
          </div>
        )}

        {/* Mobile App Header */}
        <div className="bg-white border-b border-slate-100 px-5 py-3 flex items-center justify-between shrink-0">
          {selectedGame ? (
            <button
              onClick={resetPurchaseFlow}
              className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 hover:text-orange-600 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Retour</span>
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-orange-600 flex items-center justify-center text-white font-black text-sm">
                P
              </div>
              <span className="font-display font-extrabold text-slate-900 text-lg tracking-tight">
                Play<span className="text-orange-600">Up</span>
              </span>
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowNotifications(!showNotifications)}
              className="relative p-1.5 text-slate-600 hover:text-slate-900 rounded-full hover:bg-slate-100"
            >
              <Bell className="w-4 h-4" />
              <span className="absolute top-1 right-1 w-2 h-2 bg-orange-600 rounded-full" />
            </button>

            <div className="px-2.5 py-1 bg-orange-50 border border-orange-200 rounded-lg text-xs font-bold text-orange-700">
              USD ($)
            </div>
          </div>
        </div>

        {/* Notifications Dropdown Modal */}
        {showNotifications && (
          <div className="absolute top-16 left-4 right-4 bg-white rounded-2xl shadow-xl border border-slate-200 p-4 z-40 text-xs space-y-3 max-h-72 overflow-y-auto animate-in fade-in">
            <div className="flex justify-between items-center font-bold text-slate-900">
              <span>Notifications PlayUp ({notifications.length})</span>
              <button onClick={() => setShowNotifications(false)} className="text-slate-400">✕</button>
            </div>
            {notifications.length > 0 ? (
              notifications.slice(0, 6).map(n => (
                <div
                  key={n.id}
                  onClick={() => {
                    apiClient.markNotificationRead(n.id);
                    loadNotifications();
                  }}
                  className={`p-2.5 rounded-xl space-y-1 cursor-pointer border ${
                    n.type === 'error'
                      ? 'bg-red-50 border-red-200 text-red-900'
                      : 'bg-orange-50/80 border-orange-200 text-slate-900'
                  }`}
                >
                  <div className="font-bold flex items-center justify-between">
                    <span>{n.title}</span>
                    {!n.read && <span className="w-2 h-2 rounded-full bg-orange-600" />}
                  </div>
                  <p className="text-[11px] leading-relaxed text-slate-600">{n.message}</p>
                </div>
              ))
            ) : (
              <div className="p-2.5 bg-orange-50 text-orange-950 rounded-xl space-y-1">
                <div className="font-semibold text-orange-800">Passerelle GoXtop connectée</div>
                <p className="text-[11px] leading-relaxed">
                  Vos notifications de commandes et livraisons en temps réel apparaîtront ici.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Mobile Viewport Content Area */}
        <div className="flex-1 overflow-y-auto bg-slate-50/50">
          {/* FLOW: ORDER IN PROGRESS / CONFIRMED */}
          {currentOrder ? (
            <div className="p-6 space-y-6">
              <div className="text-center space-y-2 pt-4">
                <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto ${
                  currentOrder.status === 'completed' ? 'bg-emerald-100 text-emerald-600' :
                  currentOrder.status === 'failed' ? 'bg-red-100 text-red-600' : 'bg-orange-100 text-orange-600 animate-pulse'
                }`}>
                  {currentOrder.status === 'completed' ? (
                    <CheckCircle2 className="w-8 h-8" />
                  ) : currentOrder.status === 'failed' ? (
                    <AlertCircle className="w-8 h-8" />
                  ) : (
                    <RefreshCw className="w-8 h-8 animate-spin" />
                  )}
                </div>

                <h3 className="font-display text-xl font-bold text-slate-900">
                  {currentOrder.status === 'completed' ? 'Recharge Livrée avec Succès !' :
                   currentOrder.status === 'failed' ? 'Échec de Livraison' :
                   'Commande en cours de traitement...'}
                </h3>

                <p className="text-xs text-slate-500 max-w-xs mx-auto">
                  {currentOrder.status === 'completed'
                    ? 'Les diamants ont été crédités directement sur le compte joueur.'
                    : currentOrder.status === 'failed'
                    ? currentOrder.errorMessage || 'Impossible de livrer sur cet identifiant'
                    : 'La passerelle contacte actuellement le serveur de jeu...'}
                </p>
              </div>

              {/* Order Status Timeline */}
              <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
                <div className="flex justify-between items-center pb-2 border-b border-slate-100 text-xs">
                  <span className="text-slate-400">N° Commande / Partner ID</span>
                  <div className="text-right font-mono">
                    <span className="font-bold text-slate-900 block">{currentOrder.orderNumber}</span>
                    <span className="text-[10px] text-orange-600">{currentOrder.partnerOrderId}</span>
                  </div>
                </div>

                <div className="space-y-2 text-xs">
                  {currentOrder.statusHistory.map((item, idx) => (
                    <div key={idx} className="flex items-start gap-2.5">
                      <div className="w-2 h-2 rounded-full bg-orange-600 mt-1.5 shrink-0" />
                      <div>
                        <div className="font-semibold text-slate-800 capitalize">{item.status}</div>
                        <div className="text-[11px] text-slate-500">{item.note}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Summary Details */}
              <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500">Jeu :</span>
                  <span className="font-semibold text-slate-900">{currentOrder.gameName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Pack :</span>
                  <span className="font-semibold text-slate-900">{currentOrder.packageName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Profil :</span>
                  <span className="font-mono text-slate-800">
                    {Object.entries(currentOrder.gameProfileData).map(([k, v]) => `${k}:${v}`).join(' ')}
                  </span>
                </div>
                <div className="flex justify-between pt-2 border-t border-slate-100">
                  <span className="font-bold text-slate-900">Total payé :</span>
                  <span className="font-mono font-bold text-orange-600 text-sm">
                    ${currentOrder.chargedAmount.toFixed(2)} USD
                  </span>
                </div>
              </div>

              <div className="space-y-2 pt-2">
                <button
                  onClick={resetPurchaseFlow}
                  className="w-full py-3 bg-orange-600 hover:bg-orange-500 text-white font-semibold text-xs rounded-xl shadow-xs transition-colors"
                >
                  Effectuer un nouvel achat
                </button>
                <button
                  onClick={() => {
                    setCurrentOrder(null);
                    setActiveTab('orders');
                  }}
                  className="w-full py-2.5 text-xs text-slate-600 hover:text-slate-900 font-medium"
                >
                  Voir mes commandes
                </button>
              </div>
            </div>
          ) : selectedGame ? (
            /* STEP 2-5: DYNAMIC PURCHASE FLOW FOR SELECTED GAME */
            <div className="p-4 sm:p-5 space-y-5">
              {/* Game Banner Header */}
              <div className="flex items-center gap-3.5 bg-white border border-slate-200 rounded-2xl p-3.5">
                <img 
                  src={selectedGame.logo} 
                  alt={selectedGame.name} 
                  className="w-14 h-14 rounded-xl object-cover"
                  referrerPolicy="no-referrer"
                />
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-orange-600">
                    {selectedGame.category}
                  </span>
                  <h3 className="font-display text-lg font-bold text-slate-900">
                    {selectedGame.name}
                  </h3>
                  <p className="text-[11px] text-slate-500">Créditation instantanée directe</p>
                </div>
              </div>

              {/* Step 2: Choose Package */}
              <div className="space-y-2.5">
                <label className="text-xs font-bold text-slate-800 uppercase tracking-tight block">
                  Étape 1 : Choisir le package
                </label>
                {selectedService && (
                  <div className="grid grid-cols-2 gap-2.5">
                    {selectedService.packages.map(pkg => {
                      const isSelected = selectedPackage?.id === pkg.id;
                      return (
                        <div
                          key={pkg.id}
                          onClick={() => setSelectedPackage(pkg)}
                          className={`cursor-pointer rounded-2xl p-3 border transition-all flex flex-col justify-between ${
                            isSelected
                              ? 'border-orange-600 bg-orange-50/60 shadow-xs ring-1 ring-orange-500'
                              : 'border-slate-200 bg-white hover:border-slate-300'
                          }`}
                        >
                          <div>
                            <span className="text-[10px] font-semibold text-slate-400 block uppercase">
                              {pkg.unit}
                            </span>
                            <div className="font-bold text-slate-900 text-sm mt-0.5">
                              {pkg.name}
                            </div>
                          </div>
                          <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between">
                            <span className="font-mono font-bold text-orange-600 text-xs">
                              ${pkg.publicPrice.toFixed(2)}
                            </span>
                            {isSelected && <Check className="w-3.5 h-3.5 text-orange-600" />}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Step 3: Dynamic Game Profile Fields & GoXtop Name Checker */}
              {(selectedPackage?.requiresPlayerId !== false && selectedGame.requiresPlayerId !== false) ? (
                <div className="space-y-3 bg-white border border-slate-200 rounded-2xl p-4">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-800 uppercase tracking-tight">
                      Étape 2 : Informations du joueur ({selectedGame.name})
                    </label>
                    <span className="text-[10px] text-slate-400">Sans mot de passe</span>
                  </div>

                  <div className="space-y-3">
                    {selectedGame.fields
                      .filter(f => !selectedPackage?.requiredFields?.length || selectedPackage.requiredFields.includes(f.name))
                      .map(field => (
                        <div key={field.id} className="space-y-1">
                          <label className="text-xs font-semibold text-slate-700 flex justify-between">
                            <span>{field.label} {field.required && <span className="text-orange-600">*</span>}</span>
                          </label>

                          {field.type === 'select' && field.options ? (
                            <select
                              value={gameProfileInputs[field.name] || field.options[0]}
                              onChange={(e) => {
                                setGameProfileInputs({ ...gameProfileInputs, [field.name]: e.target.value });
                                setPlayerCheckResult(null);
                              }}
                              className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-orange-500"
                            >
                              {field.options.map(opt => (
                                <option key={opt} value={opt}>{opt}</option>
                              ))}
                            </select>
                          ) : (
                            <input
                              type={field.type === 'number' ? 'number' : 'text'}
                              placeholder={field.placeholder}
                              value={gameProfileInputs[field.name] || ''}
                              onChange={(e) => {
                                setGameProfileInputs({ ...gameProfileInputs, [field.name]: e.target.value });
                                setPlayerCheckResult(null);
                              }}
                              className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-mono focus:outline-none focus:border-orange-500"
                            />
                          )}

                          {field.helperText && (
                            <p className="text-[10px] text-slate-400 leading-tight">
                              {field.helperText}
                            </p>
                          )}
                        </div>
                      ))}
                  </div>

                  {/* GoXtop Name Checker for Free Fire & supported games */}
                  {selectedGame.supportsNameCheck && (
                    <div className="pt-2 border-t border-slate-100 space-y-2">
                      <button
                        type="button"
                        disabled={isCheckingPlayer || !gameProfileInputs.playerId}
                        onClick={handleVerifyPlayer}
                        className="w-full py-2 px-3 bg-orange-50 hover:bg-orange-100 disabled:opacity-50 text-orange-700 border border-orange-200 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
                      >
                        {isCheckingPlayer ? (
                          <>
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            <span>Vérification GoXtop Name Checker...</span>
                          </>
                        ) : (
                          <>
                            <Search className="w-3.5 h-3.5" />
                            <span>Vérifier le Player ID ({selectedGame.name})</span>
                          </>
                        )}
                      </button>

                      {playerCheckResult && (
                        <div className={`p-2.5 rounded-xl border text-[11px] ${
                          playerCheckResult.verified
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                            : 'bg-amber-50 border-amber-200 text-amber-900'
                        }`}>
                          {playerCheckResult.verified ? (
                            <div className="font-bold flex items-center gap-1.5">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                              <span>Nom du joueur confirmé : {playerCheckResult.playerName}</span>
                            </div>
                          ) : (
                            <div>{playerCheckResult.message}</div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-3.5 bg-slate-100 border border-slate-200 rounded-2xl text-xs text-slate-600">
                  Ce produit ne nécessite pas de Player ID. Le code sera généré dès confirmation.
                </div>
              )}

              {/* Error message */}
              {orderError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
                  {orderError}
                </div>
              )}

              {/* Step 4 & 5: Confirmation -> Paiement -> Création Commande PlayUp & GoXtop */}
              {showPaymentStep && selectedPackage ? (
                <div className="bg-slate-900 text-white rounded-2xl p-4 space-y-3 border border-orange-500/40">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <span className="text-xs font-bold text-orange-400 uppercase">Étape 3 : Confirmation & Paiement</span>
                    <button
                      type="button"
                      onClick={() => setShowPaymentStep(false)}
                      className="text-[11px] text-slate-400 hover:text-white"
                    >
                      Modifier
                    </button>
                  </div>

                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Produit :</span>
                      <span className="font-semibold">{selectedGame.name} — {selectedPackage.name}</span>
                    </div>
                    {gameProfileInputs.playerId && (
                      <div className="flex justify-between">
                        <span className="text-slate-400">Player ID :</span>
                        <span className="font-mono">{gameProfileInputs.playerId}</span>
                      </div>
                    )}
                    {playerCheckResult?.verified && (
                      <div className="flex justify-between">
                        <span className="text-slate-400">Joueur confirmé :</span>
                        <span className="font-bold text-emerald-400">{playerCheckResult.playerName}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-slate-400">ID Idempotence :</span>
                      <span className="font-mono text-[10px] text-slate-300">{pendingPartnerOrderId}</span>
                    </div>
                    <div className="flex justify-between pt-2 border-t border-slate-800">
                      <span className="font-bold">Montant à régler :</span>
                      <span className="font-mono text-lg font-extrabold text-orange-400">
                        ${selectedPackage.publicPrice.toFixed(2)} USD
                      </span>
                    </div>
                  </div>

                  <button
                    disabled={isOrdering}
                    onClick={handleConfirmOrder}
                    className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold text-xs rounded-xl shadow-md transition-colors flex items-center justify-center gap-2"
                  >
                    {isOrdering ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Création commande PlayUp & GoXtop...</span>
                      </>
                    ) : (
                      <>
                        <CreditCard className="w-4 h-4" />
                        <span>Payer ${selectedPackage.publicPrice.toFixed(2)} & Exécuter la commande</span>
                      </>
                    )}
                  </button>
                </div>
              ) : (
                <div className="bg-slate-900 text-white rounded-2xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-400">Total à payer</span>
                    <span className="font-mono text-xl font-extrabold text-orange-400">
                      ${selectedPackage ? selectedPackage.publicPrice.toFixed(2) : '0.00'} USD
                    </span>
                  </div>

                  <button
                    disabled={!selectedPackage || isOrdering}
                    onClick={handleProceedToPayment}
                    className="w-full py-3 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white font-semibold text-xs rounded-xl shadow-md transition-colors flex items-center justify-center gap-2"
                  >
                    <ShieldCheck className="w-4 h-4" />
                    <span>Vérifier & Passer au paiement</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            /* TAB ROUTING INSIDE THE MOBILE APP */
            <div className="p-4 space-y-5">
              {/* TAB: ACCUEIL */}
              {activeTab === 'home' && (
                <div className="space-y-5">
                  {/* Hero promotion card */}
                  <div className="bg-gradient-to-r from-orange-600 to-amber-600 text-white rounded-2xl p-5 shadow-sm space-y-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-orange-200">
                      Recharges Directes
                    </span>
                    <h3 className="font-display text-lg font-bold">
                      Diamants & UC en 30 secondes
                    </h3>
                    <p className="text-[11px] text-orange-100">
                      Sélectionnez votre jeu, renseignez votre UID et recevez vos monnaies immédiatement.
                    </p>
                  </div>

                  {/* Popular Games Grid */}
                  <div>
                    <div className="flex justify-between items-center mb-3">
                      <h4 className="text-xs font-bold text-slate-900 uppercase tracking-tight">
                        Jeux Populaires
                      </h4>
                      <button 
                        onClick={() => setActiveTab('games')}
                        className="text-[11px] font-semibold text-orange-600"
                      >
                        Voir tout →
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      {games.slice(0, 4).map(game => (
                        <div
                          key={game.id}
                          onClick={() => handleSelectGame(game)}
                          className="bg-white border border-slate-200 hover:border-orange-500 rounded-2xl p-3 cursor-pointer shadow-2xs transition-all flex flex-col justify-between"
                        >
                          <div className="relative aspect-[4/3] rounded-xl overflow-hidden mb-2 bg-slate-100">
                            <img 
                              src={game.logo} 
                              alt={game.name}
                              className="w-full h-full object-cover"
                              referrerPolicy="no-referrer"
                            />
                          </div>
                          <div>
                            <span className="font-semibold text-xs text-slate-900 block truncate">
                              {game.name}
                            </span>
                            <span className="text-[10px] text-orange-600 font-medium">
                              Recharge UID
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Recent Activity */}
                  <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
                    <h4 className="text-xs font-bold text-slate-900 uppercase tracking-tight">
                      Dernières Recharges effectuées
                    </h4>
                    <div className="space-y-2 text-xs">
                      {userOrders.slice(0, 3).map(o => (
                        <div key={o.id} className="flex items-center justify-between py-1.5 border-b border-slate-50 last:border-0">
                          <div>
                            <span className="font-semibold text-slate-800">{o.gameName}</span>
                            <span className="text-slate-400 text-[10px] block">{o.packageName}</span>
                          </div>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            o.status === 'completed' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
                          }`}>
                            {o.status}
                          </span>
                        </div>
                      ))}
                      {userOrders.length === 0 && (
                        <p className="text-xs text-slate-400">Aucune commande pour le moment.</p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB: JEUX */}
              {activeTab === 'games' && (
                <div className="space-y-4">
                  <div className="relative">
                    <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Rechercher un jeu (Free Fire, PUBG...)"
                      value={gameSearch}
                      onChange={(e) => setGameSearch(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-orange-500"
                    />
                  </div>

                  <div className="space-y-2.5">
                    {games
                      .filter(g => g.name.toLowerCase().includes(gameSearch.toLowerCase()))
                      .map(game => (
                        <div
                          key={game.id}
                          onClick={() => handleSelectGame(game)}
                          className="bg-white border border-slate-200 hover:border-orange-500 rounded-2xl p-3.5 flex items-center justify-between cursor-pointer transition-all"
                        >
                          <div className="flex items-center gap-3">
                            <img 
                              src={game.logo} 
                              alt={game.name} 
                              className="w-12 h-12 rounded-xl object-cover"
                              referrerPolicy="no-referrer"
                            />
                            <div>
                              <h4 className="font-bold text-xs text-slate-900">{game.name}</h4>
                              <p className="text-[11px] text-slate-500">{game.category}</p>
                            </div>
                          </div>
                          <ChevronRight className="w-4 h-4 text-slate-400" />
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* TAB: COMMANDES */}
              {activeTab === 'orders' && (
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <h3 className="text-xs font-bold text-slate-800 uppercase tracking-tight">
                      Mes Commandes de Jeu
                    </h3>
                    <button onClick={loadUserOrders} className="text-xs text-orange-600">
                      Actualiser
                    </button>
                  </div>

                  <div className="space-y-2.5">
                    {userOrders.map(order => (
                      <div key={order.id} className="bg-white border border-slate-200 rounded-2xl p-3.5 space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-mono font-bold text-slate-900">{order.orderNumber}</span>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                            order.status === 'completed' ? 'bg-emerald-100 text-emerald-800' :
                            order.status === 'processing' ? 'bg-amber-100 text-amber-800' :
                            order.status === 'failed' ? 'bg-red-100 text-red-800' : 'bg-slate-100 text-slate-800'
                          }`}>
                            {order.status}
                          </span>
                        </div>

                        <div className="text-xs">
                          <span className="font-semibold text-slate-900">{order.gameName}</span> - {order.packageName}
                        </div>

                        <div className="text-[11px] text-slate-500 font-mono">
                          {Object.entries(order.gameProfileData).map(([k, v]) => `${k}: ${v}`).join(' · ')}
                        </div>

                        <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
                          <span className="text-slate-400 text-[10px]">
                            {new Date(order.createdAt).toLocaleDateString()}
                          </span>
                          <span className="font-mono font-bold text-orange-600">
                            ${order.chargedAmount.toFixed(2)}
                          </span>
                        </div>
                      </div>
                    ))}
                    {userOrders.length === 0 && (
                      <div className="text-center py-12 text-slate-400 text-xs">
                        Aucune commande effectuée pour le moment.
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB: SUPPORT */}
              {activeTab === 'support' && (
                <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
                  <h3 className="font-bold text-slate-900 text-xs uppercase tracking-tight">
                    Support en Jeu PlayUp
                  </h3>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Un souci avec une recharge ? Envoyez-nous un message directement depuis l'application.
                  </p>

                  {supportSubmitted ? (
                    <div className="p-4 bg-emerald-50 text-emerald-800 rounded-xl text-xs space-y-2">
                      <div className="font-bold">Message envoyé au support !</div>
                      <p>Notre agent prendra en charge votre demande dans les plus brefs délais.</p>
                      <button
                        onClick={() => setSupportSubmitted(false)}
                        className="text-xs underline text-emerald-900"
                      >
                        Envoyer un autre message
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3 text-xs">
                      <div>
                        <label className="font-semibold text-slate-700 block mb-1">Votre message</label>
                        <textarea
                          rows={3}
                          value={supportMessage}
                          onChange={(e) => setSupportMessage(e.target.value)}
                          placeholder="Décrivez votre question ou problème..."
                          className="w-full border border-slate-200 rounded-xl p-2.5 text-xs focus:outline-none focus:border-orange-500"
                        />
                      </div>
                      <button
                        onClick={() => {
                          if (supportMessage.trim()) {
                            setSupportSubmitted(true);
                            setSupportMessage('');
                          }
                        }}
                        className="w-full py-2.5 bg-orange-600 hover:bg-orange-500 text-white font-semibold rounded-xl text-xs transition-colors"
                      >
                        Contacter un agent PlayUp
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* TAB: PROFIL */}
              {activeTab === 'profile' && (
                <div className="space-y-4">
                  <div className="bg-white border border-slate-200 rounded-2xl p-4 flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-orange-100 flex items-center justify-center text-orange-600 font-bold text-lg">
                      G
                    </div>
                    <div>
                      <h4 className="font-bold text-sm text-slate-900">Joueur PlayUp</h4>
                      <p className="text-xs text-slate-500">Profil de jeu rapide actif</p>
                    </div>
                  </div>

                  <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
                    <h4 className="font-bold text-xs text-slate-900 uppercase tracking-tight">
                      Mes Profils Enregistrés (1-Click Reorder)
                    </h4>
                    <p className="text-[11px] text-slate-500">
                      Vos identifiants de jeu enregistrés pour recharger en un seul clic sans avoir à retaper votre ID.
                    </p>

                    <div className="space-y-2">
                      {savedProfiles.map(prof => (
                        <div key={prof.id} className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs flex items-center justify-between">
                          <div>
                            <div className="font-bold text-slate-900">{prof.gameName}</div>
                            <div className="text-[11px] text-slate-500 font-mono">
                              {Object.entries(prof.data).map(([k, v]) => `${k}: ${v}`).join(' · ')}
                            </div>
                          </div>
                          <span className="text-[10px] text-emerald-700 font-semibold bg-emerald-50 px-2 py-0.5 rounded">
                            Sauvegardé
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Mobile App Bottom Tab Bar */}
        <div className="bg-white border-t border-slate-200 px-3 py-2 flex items-center justify-around shrink-0">
          <button
            onClick={() => {
              resetPurchaseFlow();
              setActiveTab('home');
            }}
            className={`flex flex-col items-center gap-1 py-1 text-[10px] font-semibold transition-colors ${
              activeTab === 'home' && !selectedGame ? 'text-orange-600' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Home className="w-5 h-5" />
            <span>{t.tabHome}</span>
          </button>

          <button
            onClick={() => {
              resetPurchaseFlow();
              setActiveTab('games');
            }}
            className={`flex flex-col items-center gap-1 py-1 text-[10px] font-semibold transition-colors ${
              activeTab === 'games' || selectedGame ? 'text-orange-600' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Gamepad2 className="w-5 h-5" />
            <span>{t.tabGames}</span>
          </button>

          <button
            onClick={() => {
              resetPurchaseFlow();
              setActiveTab('orders');
            }}
            className={`flex flex-col items-center gap-1 py-1 text-[10px] font-semibold transition-colors ${
              activeTab === 'orders' ? 'text-orange-600' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <ShoppingBag className="w-5 h-5" />
            <span>{t.tabOrders}</span>
          </button>

          <button
            onClick={() => {
              resetPurchaseFlow();
              setActiveTab('support');
            }}
            className={`flex flex-col items-center gap-1 py-1 text-[10px] font-semibold transition-colors ${
              activeTab === 'support' ? 'text-orange-600' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <HelpCircle className="w-5 h-5" />
            <span>{t.tabSupport}</span>
          </button>

          <button
            onClick={() => {
              resetPurchaseFlow();
              setActiveTab('profile');
            }}
            className={`flex flex-col items-center gap-1 py-1 text-[10px] font-semibold transition-colors ${
              activeTab === 'profile' ? 'text-orange-600' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <User className="w-5 h-5" />
            <span>{t.tabProfile}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
