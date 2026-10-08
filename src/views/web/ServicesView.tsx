import React, { useState } from 'react';
import { 
  Smartphone, Download, ExternalLink, Info, Check, 
  ArrowRight, ShieldCheck, Zap, X, ChevronRight, TrendingDown
} from 'lucide-react';
import { Game, Service, ServicePackage } from '../../types';
import { Language, translations } from '../../i18n';
import { ProductPriceHistoryChart } from '../../components/ProductPriceHistoryChart';

interface ServicesViewProps {
  games: Game[];
  services: Service[];
  selectedGame: Game | null;
  onSelectGame: (g: Game | null) => void;
  onNavigate: (tab: string) => void;
  onOpenMobileApp: () => void;
  lang: Language;
}

export const ServicesView: React.FC<ServicesViewProps> = ({
  games,
  services,
  selectedGame,
  onSelectGame,
  onNavigate,
  onOpenMobileApp,
  lang
}) => {
  const t = translations[lang];
  const [selectedPackagesByService, setSelectedPackagesByService] = useState<Record<string, ServicePackage>>({});
  const [activePackageModal, setActivePackageModal] = useState<{
    game: Game;
    service: Service;
    pkg: ServicePackage;
  } | null>(null);

  // Filter services by selected game if any
  const displayedServices = selectedGame
    ? services.filter(s => s.gameId === selectedGame.id)
    : services;

  const getPackagePriceHtg = (pkg?: ServicePackage | null): number => {
    if (!pkg) return 0;
    if (typeof pkg.publicPriceHtg === 'number' && pkg.publicPriceHtg > 0) {
      return Number(pkg.publicPriceHtg.toFixed(2));
    }
    return Number((Number(pkg.publicPrice || 0) * 132).toFixed(2));
  };

  const formatHtg = (val: number): string => {
    const num = Number(val || 0);
    return `${Number.isInteger(num) ? num : num.toFixed(2)} HTG`;
  };

  const handlePackageClick = (service: Service, pkg: ServicePackage) => {
    setSelectedPackagesByService(prev => ({ ...prev, [service.id]: pkg }));
    const parentGame = games.find(g => g.id === service.gameId);
    if (!parentGame) return;
    setActivePackageModal({
      game: parentGame,
      service,
      pkg
    });
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-10">
      {/* Header */}
      <div className="max-w-3xl">
        <span className="text-xs font-semibold uppercase tracking-wider text-orange-600">
          Services Gaming Officiels
        </span>
        <h1 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900 mt-1">
          {t.services.title}
        </h1>
        <p className="text-sm text-slate-600 mt-2 leading-relaxed">
          {t.services.subtitle} Découvrez les recharges disponibles et leurs packages.
        </p>
      </div>

      {/* Game Filter Bar */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
        <button
          onClick={() => onSelectGame(null)}
          className={`px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors ${
            selectedGame === null
              ? 'bg-slate-900 text-white shadow-xs'
              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
          }`}
        >
          Tous les jeux ({games.length})
        </button>
        {games.map(game => (
          <button
            key={game.id}
            onClick={() => onSelectGame(game)}
            className={`px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors flex items-center gap-2 ${
              selectedGame?.id === game.id
                ? 'bg-orange-600 text-white shadow-xs'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <span>{game.name}</span>
          </button>
        ))}
      </div>

      {/* Services List */}
      <div className="space-y-12">
        {displayedServices.map(service => {
          const game = games.find(g => g.id === service.gameId);

          return (
            <div 
              key={service.id}
              className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 space-y-6 shadow-xs"
            >
              {/* Service Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-100">
                <div className="flex items-center gap-4">
                  {game?.logo && (
                    <img 
                      src={game.logo} 
                      alt={game.name} 
                      className="w-16 h-16 rounded-2xl object-cover border border-slate-200 shadow-xs"
                      referrerPolicy="no-referrer"
                    />
                  )}
                  <div>
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <span className="font-semibold text-orange-600">{game?.name}</span>
                      <span aria-hidden="true">·</span>
                      <span>{service.category.toUpperCase()}</span>
                      <span aria-hidden="true">·</span>
                      <span>Livraison directe UID</span>
                    </div>
                    <h2 className="font-display text-xl sm:text-2xl font-bold text-slate-900 mt-0.5">
                      {service.name}
                    </h2>
                    <p className="text-xs sm:text-sm text-slate-600 mt-1 max-w-2xl">
                      {service.description}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-xs text-slate-500 self-start sm:self-auto">
                  <span className="px-3 py-1 bg-emerald-50 text-emerald-700 font-medium rounded-lg">
                    Passerelle connectée
                  </span>
                </div>
              </div>

              {/* Packages Grid */}
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-4">
                  Packs & Tarifs indicatifs ({service.packages.length} options) — Cliquez sur un produit pour analyser son tarif
                </h3>

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3.5">
                  {service.packages.map(pkg => {
                    const currentSelectedPkg = selectedPackagesByService[service.id] || service.packages[0];
                    const isSelected = currentSelectedPkg?.id === pkg.id;
                    return (
                      <div
                        key={pkg.id}
                        onClick={() => setSelectedPackagesByService(prev => ({ ...prev, [service.id]: pkg }))}
                        className={`group cursor-pointer border rounded-2xl p-4 transition-all flex flex-col justify-between ${
                          isSelected
                            ? 'border-orange-600 bg-orange-50/50 shadow-sm ring-1 ring-orange-500'
                            : 'border-slate-200 hover:border-orange-500 hover:shadow-md bg-slate-50/50 hover:bg-white'
                        }`}
                      >
                        <div>
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-tight">
                              {pkg.unit}
                            </span>
                            {isSelected && (
                              <span className="px-1.5 py-0.5 rounded bg-orange-600 text-white text-[9px] font-bold uppercase">
                                Sélectionné
                              </span>
                            )}
                          </div>
                          <div className="font-display text-lg font-bold text-slate-900 mt-0.5 group-hover:text-orange-600 transition-colors">
                            {pkg.name}
                          </div>
                        </div>

                        <div className="mt-4 pt-3 border-t border-slate-200/60 flex items-center justify-between">
                          <div>
                            <span className="text-[10px] text-slate-400 block">Prix PlayUp</span>
                            <span className="font-mono text-sm font-semibold text-slate-900">
                              {formatHtg(getPackagePriceHtg(pkg))}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handlePackageClick(service, pkg);
                            }}
                            className="text-orange-600 hover:text-orange-700 text-xs font-semibold group-hover:translate-x-0.5 transition-transform"
                          >
                            Commander →
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Selected Product Price Detail + 30-Day Recharts Price Evolution */}
                {(() => {
                  const selectedPkg = selectedPackagesByService[service.id] || service.packages[0];
                  if (!selectedPkg) return null;
                  const finalPriceHtg = getPackagePriceHtg(selectedPkg);
                  return (
                    <div className="mt-5 bg-slate-50/90 border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-4">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200/80">
                        <div>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-orange-600 block">
                            Produit sélectionné · Tarif Officiel PlayUp
                          </span>
                          <h4 className="font-display text-base sm:text-lg font-bold text-slate-900">
                            {game?.name} — {selectedPkg.name}
                          </h4>
                        </div>
                        <div className="flex flex-wrap items-center gap-4">
                          <div>
                            <span className="text-[10px] text-slate-500 block">Prix Final PlayUp (HTG)</span>
                            <span className="font-mono text-lg font-extrabold text-orange-600">
                              {formatHtg(finalPriceHtg)}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handlePackageClick(service, selectedPkg)}
                            className="px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white text-xs font-semibold rounded-xl shadow-2xs transition-colors"
                          >
                            Ouvrir ce pack →
                          </button>
                        </div>
                      </div>

                      {/* Recharts 30-Day Price Evolution Chart directly underneath the selected product price */}
                      <ProductPriceHistoryChart pkg={selectedPkg} theme="light" />
                    </div>
                  );
                })()}
              </div>

              {/* Dynamic Game Profile Fields Info */}
              {game && (
                <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-4 text-xs text-slate-600 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Info className="w-4 h-4 text-orange-600 shrink-0" />
                    <span>
                      Champs requis lors de la recharge pour <strong>{game.name}</strong> :{' '}
                      {game.fields.map(f => f.label).join(', ')}.
                    </span>
                  </div>
                  <span className="text-slate-500 text-[11px]">
                    Validé automatiquement à la commande
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* CRITICAL COMPLIANCE MODAL (Section 6 & 42 of prompt) */}
      {activePackageModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-8 space-y-6 shadow-2xl relative animate-in fade-in zoom-in-95 duration-150">
            {/* Close button */}
            <button
              onClick={() => setActivePackageModal(null)}
              className="absolute top-5 right-5 p-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Modal Content */}
            <div className="space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-orange-100 flex items-center justify-center text-orange-600">
                <Smartphone className="w-6 h-6" />
              </div>

              <div className="inline-flex items-center gap-2 text-xs font-semibold text-orange-600">
                <span>{activePackageModal.game.name}</span>
                <span aria-hidden="true">·</span>
                <span>{activePackageModal.pkg.name}</span>
              </div>

              <h3 className="font-display text-2xl font-bold text-slate-900">
                {t.services.modalNoticeTitle}
              </h3>

              <div className="bg-orange-50 border border-orange-200/80 rounded-2xl p-4 text-xs sm:text-sm text-slate-800 leading-relaxed">
                <p className="font-medium text-orange-950 mb-1">
                  « {t.services.modalNoticeText} »
                </p>
                <p className="text-xs text-orange-900/80">
                  Le site web public sert de catalogue et d’infrastructure d’intégration. Les commandes destinées aux joueurs s’effectuent en toute simplicité dans l’application mobile <strong>PlayUp</strong>.
                </p>
              </div>
            </div>

            {/* Selected package summary */}
            <div className="border border-slate-200 rounded-2xl p-4 bg-slate-50 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Service :</span>
                <span className="font-semibold text-slate-900">{activePackageModal.service.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Pack sélectionné :</span>
                <span className="font-semibold text-slate-900">{activePackageModal.pkg.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Prix final PlayUp :</span>
                <span className="font-mono font-bold text-orange-600">
                  {formatHtg(getPackagePriceHtg(activePackageModal.pkg))}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Informations demandées :</span>
                <span className="text-slate-700">
                  {activePackageModal.game.fields.map(f => f.label).join(' & ')}
                </span>
              </div>
            </div>

            {/* 30-Day Price Evolution Chart under the selected product price in modal */}
            <ProductPriceHistoryChart pkg={activePackageModal.pkg} theme="light" compact />

            {/* Actions */}
            <div className="space-y-2.5 pt-2">
              <button
                onClick={() => {
                  setActivePackageModal(null);
                  onNavigate('download');
                }}
                className="w-full py-3.5 px-4 bg-orange-600 hover:bg-orange-500 text-white font-semibold text-sm rounded-xl shadow-md transition-colors flex items-center justify-center gap-2"
              >
                <Download className="w-4 h-4" />
                <span>{t.services.btnDownloadApp}</span>
              </button>

              <button
                onClick={() => {
                  setActivePackageModal(null);
                  onOpenMobileApp();
                }}
                className="w-full py-3.5 px-4 bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 font-semibold text-sm rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                <Smartphone className="w-4 h-4 text-orange-600" />
                <span>{t.services.btnOpenApp}</span>
              </button>

              <button
                onClick={() => setActivePackageModal(null)}
                className="w-full py-2 text-xs text-slate-500 hover:text-slate-800 transition-colors"
              >
                {t.services.btnCancel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
