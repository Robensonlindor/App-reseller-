import React from 'react';
import { 
  ArrowRight, Download, Server, Cpu, Key, Smartphone, 
  CheckCircle2, Zap, Shield, ExternalLink 
} from 'lucide-react';
import { Game } from '../../types';
import { Language, translations } from '../../i18n';

interface HomeViewProps {
  games: Game[];
  onNavigate: (tab: string) => void;
  onOpenMobileApp: () => void;
  onSelectGame: (game: Game) => void;
  lang: Language;
}

export const HomeView: React.FC<HomeViewProps> = ({
  games,
  onNavigate,
  onOpenMobileApp,
  onSelectGame,
  lang
}) => {
  const t = translations[lang];

  return (
    <div className="space-y-20 pb-20">
      {/* 1. HERO SECTION */}
      <section className="relative overflow-hidden bg-slate-950 text-white">
        {/* Ambient background with hero image */}
        <div className="absolute inset-0 z-0 opacity-25">
          <img 
            src="/src/assets/images/playup_hero_banner_1790988865970.jpg" 
            alt="PlayUp Gaming Infrastructure" 
            className="w-full h-full object-cover object-center"
            referrerPolicy="no-referrer"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/80 to-transparent" />
        </div>

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-24 lg:pt-28 lg:pb-32">
          <div className="max-w-3xl space-y-6">
            <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-orange-400">
              <span>Plateforme B2B & Distribution API</span>
              <span aria-hidden="true">·</span>
              <span>Écosystème Gaming Centralisé</span>
            </div>

            <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-white leading-tight text-balance">
              PlayUp Reseller
            </h1>

            <p className="text-lg sm:text-xl text-slate-300 font-normal leading-relaxed text-balance">
              L’infrastructure de référence qui fournit des services gaming directs et une API haute disponibilité pour les revendeurs, intégrateurs et applications mobiles.
            </p>

            {/* CTAs */}
            <div className="pt-4 flex flex-wrap items-center gap-4">
              <button
                onClick={() => onNavigate('services')}
                className="px-6 py-3.5 bg-orange-600 hover:bg-orange-500 text-white font-semibold text-sm rounded-xl shadow-lg shadow-orange-950/40 transition-all hover:translate-y-[-1px] flex items-center gap-2"
              >
                <span>{t.hero.btnServices}</span>
                <ArrowRight className="w-4 h-4" />
              </button>

              <button
                onClick={() => onNavigate('reseller')}
                className="px-6 py-3.5 bg-white text-slate-900 hover:bg-slate-100 font-semibold text-sm rounded-xl transition-all hover:translate-y-[-1px]"
              >
                {t.hero.btnReseller}
              </button>

              <button
                onClick={() => onNavigate('download')}
                className="px-5 py-3.5 border border-slate-700 hover:border-slate-500 text-slate-200 hover:text-white font-medium text-sm rounded-xl transition-colors flex items-center gap-2"
              >
                <Download className="w-4 h-4 text-orange-400" />
                <span>{t.hero.btnDownload}</span>
              </button>

              <button
                onClick={onOpenMobileApp}
                className="px-4 py-3.5 bg-orange-500/10 hover:bg-orange-500/20 text-orange-300 border border-orange-500/30 text-xs font-semibold rounded-xl transition-colors flex items-center gap-2"
              >
                <Smartphone className="w-4 h-4 text-orange-400" />
                <span>Tester l’App PlayUp Joueurs</span>
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* 2. ARCHITECTURE OVERVIEW (As requested in prompt section 2) */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <span className="text-xs font-semibold uppercase tracking-wider text-orange-600">
            Architecture Centrale
          </span>
          <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 mt-2">
            Un backend unique, deux expériences dédiées
          </h2>
          <p className="text-sm text-slate-600 mt-3 leading-relaxed">
            Le site web public, l’application mobile PlayUp, l’espace revendeur et l’API sont synchronisés sur la même base de données centrale.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs">
            <div className="w-10 h-10 rounded-xl bg-orange-50 flex items-center justify-center text-orange-600 mb-4">
              <Server className="w-5 h-5" />
            </div>
            <h3 className="font-semibold text-slate-900 text-base mb-2">Web PlayUp Reseller</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Vitrine officielle, catalogue interactif, documentation API exhaustive et portail d’onboarding pour revendeurs B2B.
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs">
            <div className="w-10 h-10 rounded-xl bg-orange-50 flex items-center justify-center text-orange-600 mb-4">
              <Smartphone className="w-5 h-5" />
            </div>
            <h3 className="font-semibold text-slate-900 text-base mb-2">Application PlayUp</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Application mobile pour les joueurs finaux. Saisie instantanée du profil joueur sans inscription complexe et livraison immédiate.
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs">
            <div className="w-10 h-10 rounded-xl bg-orange-50 flex items-center justify-center text-orange-600 mb-4">
              <Key className="w-5 h-5" />
            </div>
            <h3 className="font-semibold text-slate-900 text-base mb-2">PlayUp API Engine</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              API REST sécurisée par clés d’API, rate limiting, signature HMAC et webhooks automatiques lors des changements de statut.
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs">
            <div className="w-10 h-10 rounded-xl bg-orange-50 flex items-center justify-center text-orange-600 mb-4">
              <Cpu className="w-5 h-5" />
            </div>
            <h3 className="font-semibold text-slate-900 text-base mb-2">Passerelles Fournisseurs</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Couche d’abstraction connectée à plusieurs fournisseurs externes (SmileOne, MooGold, UniPin) avec bascule automatique.
            </p>
          </div>
        </div>
      </section>

      {/* 3. POPULAR GAMES SHOWCASE */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between mb-8 gap-4">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-orange-600">
              Services & Jeux
            </span>
            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 mt-1">
              Titres compatibles pris en charge
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 mt-1">
              Configuration dynamique des champs (ID Joueur, Serveur, Zone) selon chaque jeu.
            </p>
          </div>
          <button
            onClick={() => onNavigate('services')}
            className="text-xs font-semibold text-orange-600 hover:text-orange-700 flex items-center gap-1.5"
          >
            <span>Voir tous les services</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {games.map(game => (
            <div 
              key={game.id}
              onClick={() => {
                onSelectGame(game);
                onNavigate('services');
              }}
              className="group cursor-pointer bg-white border border-slate-200 rounded-2xl overflow-hidden hover:border-orange-300 hover:shadow-md transition-all flex flex-col"
            >
              <div className="relative aspect-[4/3] bg-slate-100 overflow-hidden">
                <img 
                  src={game.logo} 
                  alt={game.name}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    // Fallback
                    (e.target as HTMLElement).style.display = 'none';
                  }}
                />
                <div className="absolute top-3 left-3 bg-slate-950/80 backdrop-blur-xs text-white text-[11px] font-medium px-2.5 py-1 rounded-md">
                  {game.category}
                </div>
              </div>

              <div className="p-5 flex-1 flex flex-col justify-between">
                <div>
                  <h3 className="font-display text-lg font-bold text-slate-900 group-hover:text-orange-600 transition-colors">
                    {game.name}
                  </h3>
                  <p className="text-xs text-slate-500 mt-1 line-clamp-2 leading-relaxed">
                    {game.description}
                  </p>
                </div>

                <div className="pt-4 mt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Recharge instantanée</span>
                  </div>
                  <span className="font-semibold text-orange-600 group-hover:underline">
                    Détails du service →
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 4. NOTICE SITE !== BOUTIQUE DIRECTE (Section 6 & 42 of prompt) */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-orange-50 border border-orange-200 rounded-3xl p-8 sm:p-10 flex flex-col md:flex-row items-center justify-between gap-8">
          <div className="space-y-3 max-w-2xl">
            <span className="text-xs font-bold uppercase tracking-wider text-orange-700">
              Information Importante
            </span>
            <h3 className="font-display text-2xl font-bold text-slate-950">
              Comment acheter des diamants ou recharges ?
            </h3>
            <p className="text-sm text-slate-700 leading-relaxed">
              Pour des raisons de rapidité et de sécurité, <strong>le site web public ne réalise pas d’achats directs de monnaies</strong>. Les joueurs effectuent leurs recharges directement dans l’application mobile <strong>PlayUp</strong>. Les professionnels et développeurs utilisent l’<strong>API PlayUp Reseller</strong>.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 shrink-0">
            <button
              onClick={() => onNavigate('download')}
              className="px-5 py-3 bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold rounded-xl shadow-xs transition-colors flex items-center justify-center gap-2"
            >
              <Download className="w-4 h-4" />
              <span>Télécharger l’App PlayUp</span>
            </button>
            <button
              onClick={onOpenMobileApp}
              className="px-5 py-3 bg-white border border-orange-300 text-orange-800 text-xs font-semibold rounded-xl hover:bg-orange-100 transition-colors flex items-center justify-center gap-2"
            >
              <Smartphone className="w-4 h-4" />
              <span>Tester dans le simulateur</span>
            </button>
          </div>
        </div>
      </section>

      {/* 5. APP PROMOTION BANNER */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-slate-900 text-white rounded-3xl overflow-hidden grid grid-cols-1 lg:grid-cols-12 items-center">
          <div className="p-8 sm:p-12 lg:col-span-7 space-y-6">
            <div className="inline-flex items-center gap-2 text-xs font-semibold text-orange-400">
              <Smartphone className="w-4 h-4" />
              <span>Application Officielle PlayUp</span>
            </div>
            <h2 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight leading-tight">
              Achetez vos monnaies de jeu en un clin d’œil
            </h2>
            <p className="text-slate-300 text-sm leading-relaxed">
              Pas de formulaires interminables. Indiquez simplement votre ID joueur, choisissez votre pack (100, 310, 520 diamants Free Fire, ou UC PUBG), et recevez vos crédits directement dans votre boîte de réception en jeu.
            </p>
            <div className="space-y-2 text-xs text-slate-300">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>Profils de jeu dynamiques enregistrables pour commander en 1 clic</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>Suivi de commande et notifications en temps réel</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>Compatible Android (APK & Google Play) et iOS</span>
              </div>
            </div>

            <div className="pt-2 flex flex-wrap gap-4">
              <button
                onClick={() => onNavigate('download')}
                className="px-6 py-3 bg-orange-600 hover:bg-orange-500 text-white text-xs font-semibold rounded-xl transition-colors flex items-center gap-2"
              >
                <Download className="w-4 h-4" />
                <span>Télécharger PlayUp (APK / Stores)</span>
              </button>
              <button
                onClick={onOpenMobileApp}
                className="px-5 py-3 border border-slate-700 hover:border-slate-500 text-slate-200 text-xs font-semibold rounded-xl transition-colors"
              >
                Ouvrir le simulateur mobile
              </button>
            </div>
          </div>

          <div className="p-8 lg:col-span-5 flex justify-center">
            <div className="relative w-64 h-64 sm:w-80 sm:h-80 rounded-2xl overflow-hidden shadow-2xl border-4 border-slate-800">
              <img 
                src="/src/assets/images/playup_app_mockup_1790988907631.jpg" 
                alt="PlayUp Mobile Interface" 
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
