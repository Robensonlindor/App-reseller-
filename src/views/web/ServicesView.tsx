import React, { useState } from 'react';
import { 
  Smartphone, Download, ExternalLink, Info, Check, 
  ArrowRight, ShieldCheck, Zap, X, ChevronRight 
} from 'lucide-react';
import { Game, Service, ServicePackage } from '../../types';
import { Language, translations } from '../../i18n';

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
  const [activePackageModal, setActivePackageModal] = useState<{
    game: Game;
    service: Service;
    pkg: ServicePackage;
  } | null>(null);

  // Filter services by selected game if any
  const displayedServices = selectedGame
    ? services.filter(s => s.gameId === selectedGame.id)
    : services;

  const handlePackageClick = (service: Service, pkg: ServicePackage) => {
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
                  Packs & Tarifs indicatifs ({service.packages.length} options)
                </h3>

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3.5">
                  {service.packages.map(pkg => (
                    <div
                      key={pkg.id}
                      onClick={() => handlePackageClick(service, pkg)}
                      className="group cursor-pointer border border-slate-200 hover:border-orange-500 hover:shadow-md rounded-2xl p-4 transition-all bg-slate-50/50 hover:bg-white flex flex-col justify-between"
                    >
                      <div>
                        <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-tight">
                          {pkg.unit}
                        </span>
                        <div className="font-display text-lg font-bold text-slate-900 mt-0.5 group-hover:text-orange-600 transition-colors">
                          {pkg.name}
                        </div>
                      </div>

                      <div className="mt-4 pt-3 border-t border-slate-200/60 flex items-center justify-between">
                        <div>
                          <span className="text-[10px] text-slate-400 block">Prix indicatif</span>
                          <span className="font-mono text-sm font-semibold text-slate-900">
                            ${pkg.publicPrice.toFixed(2)}
                          </span>
                        </div>
                        <span className="text-orange-600 text-xs font-medium group-hover:translate-x-0.5 transition-transform">
                          →
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
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
                <span className="text-slate-500">Prix indicatif :</span>
                <span className="font-mono font-bold text-slate-900">
                  ${activePackageModal.pkg.publicPrice.toFixed(2)} USD
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Informations demandées :</span>
                <span className="text-slate-700">
                  {activePackageModal.game.fields.map(f => f.label).join(' & ')}
                </span>
              </div>
            </div>

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
