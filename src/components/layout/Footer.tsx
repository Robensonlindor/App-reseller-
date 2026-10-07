import React from 'react';
import { ShieldCheck, Zap, Download, Terminal, Mail, Phone } from 'lucide-react';
import { Language, translations } from '../../i18n';
import { AppUser } from '../../types';

interface FooterProps {
  onNavigate: (tab: string) => void;
  lang: Language;
  authUser?: AppUser | null;
}

export const Footer: React.FC<FooterProps> = ({ onNavigate, lang, authUser }) => {
  const t = translations[lang];
  const isAdmin = authUser?.role === 'ADMIN';

  return (
    <footer className="bg-slate-900 text-slate-300 border-t border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-12">
          {/* Col 1: Identity */}
          <div className="space-y-4 md:col-span-1">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-orange-600 flex items-center justify-center text-white font-black text-lg">
                P
              </div>
              <span className="font-display font-extrabold text-white text-lg tracking-tight">
                PlayUp <span className="text-orange-500 font-semibold text-base">Reseller</span>
              </span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Infrastructure centrale et API de distribution de monnaies gaming officielles. Connectivité directe aux éditeurs et passerelles de pointe.
            </p>
            <div className="flex items-center gap-2 text-xs text-emerald-400">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>Passerelles opérationnelles (99.9% disponibilité)</span>
            </div>
          </div>

          {/* Col 2: Navigation rapide */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-200 mb-3">
              Plateforme Web
            </h4>
            <ul className="space-y-2 text-xs text-slate-400">
              <li>
                <button onClick={() => onNavigate('home')} className="hover:text-white transition-colors">
                  {t.nav.home}
                </button>
              </li>
              <li>
                <button onClick={() => onNavigate('services')} className="hover:text-white transition-colors">
                  {t.nav.services}
                </button>
              </li>
              <li>
                <button onClick={() => onNavigate('download')} className="hover:text-white transition-colors">
                  {t.nav.download}
                </button>
              </li>
              <li>
                <button onClick={() => onNavigate('support')} className="hover:text-white transition-colors">
                  Centre d’Aide & Support
                </button>
              </li>
            </ul>
          </div>

          {/* Col 3: Développeurs & B2B */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-200 mb-3">
              Développeurs & Resellers
            </h4>
            <ul className="space-y-2 text-xs text-slate-400">
              <li>
                <button onClick={() => onNavigate('reseller')} className="hover:text-white transition-colors">
                  Espace Revendeur
                </button>
              </li>
              <li>
                <button onClick={() => onNavigate('api-docs')} className="hover:text-white transition-colors">
                  Documentation API REST
                </button>
              </li>
              <li>
                <button onClick={() => onNavigate('api-docs')} className="hover:text-white transition-colors">
                  Spécification Webhooks
                </button>
              </li>
              {isAdmin && (
                <li>
                  <button onClick={() => onNavigate('admin')} className="hover:text-white transition-colors">
                    Accès Administrateur
                  </button>
                </li>
              )}
            </ul>
          </div>

          {/* Col 4: Conformité & Application mobile */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-200 mb-3">
              Application PlayUp
            </h4>
            <p className="text-xs text-slate-400 leading-relaxed mb-3">
              Les achats finaux pour joueurs s'effectuent sur l'application mobile PlayUp pour Android et iOS.
            </p>
            <div className="flex flex-col gap-2">
              <button 
                onClick={() => onNavigate('download')}
                className="inline-flex items-center justify-center gap-2 px-3 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-lg text-xs font-medium transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Télécharger l'APK v2.4</span>
              </button>
            </div>
          </div>
        </div>

        <div className="pt-8 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <p>© {new Date().getFullYear()} PlayUp Technologies Inc. Tous droits réservés.</p>
          <div className="flex items-center gap-6">
            <span>Tous les jeux et marques cités appartiennent à leurs éditeurs respectifs.</span>
          </div>
        </div>
      </div>
    </footer>
  );
};
