import React, { useState } from 'react';
import { 
  Menu, X, Smartphone, Globe, Shield, Terminal, ArrowUpRight, 
  Sparkles, Layers
} from 'lucide-react';
import { Language, translations } from '../../i18n';

interface NavbarProps {
  currentTab: string;
  onNavigate: (tab: string) => void;
  lang: Language;
  onLanguageChange: (l: Language) => void;
  onOpenMobileApp: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentTab,
  onNavigate,
  lang,
  onLanguageChange,
  onOpenMobileApp
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const t = translations[lang];

  const navLinks = [
    { id: 'home', label: t.nav.home },
    { id: 'services', label: t.nav.services },
    { id: 'reseller', label: t.nav.reseller },
    { id: 'api-docs', label: t.nav.apiDocs },
    { id: 'download', label: t.nav.download },
    { id: 'support', label: t.nav.support }
  ];

  const handleLinkClick = (id: string) => {
    onNavigate(id);
    setMobileMenuOpen(false);
  };

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200/80">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Zone 1: Single text element wordmark */}
          <div className="flex items-center gap-3">
            <button 
              onClick={() => onNavigate('home')}
              className="flex items-center gap-2 group text-left focus:outline-none"
            >
              <div className="w-9 h-9 rounded-lg bg-orange-600 flex items-center justify-center text-white font-black text-xl tracking-tighter shadow-sm transition-transform group-hover:scale-105">
                P
              </div>
              <div className="flex flex-col">
                <span className="font-display font-extrabold text-lg tracking-tight text-slate-900 group-hover:text-orange-600 transition-colors">
                  PlayUp <span className="text-orange-600 font-semibold text-base">Reseller</span>
                </span>
              </div>
            </button>
          </div>

          {/* Zone 2: 4-6 clean text navigation links */}
          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600">
            {navLinks.map(link => {
              const isActive = currentTab === link.id;
              return (
                <button
                  key={link.id}
                  onClick={() => handleLinkClick(link.id)}
                  className={`relative py-1 whitespace-nowrap transition-colors ${
                    isActive 
                      ? 'text-orange-600 font-semibold' 
                      : 'hover:text-slate-900'
                  }`}
                >
                  {link.label}
                  {isActive && (
                    <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-orange-600 rounded-full" />
                  )}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: 1-2 primary actions */}
          <div className="hidden lg:flex items-center gap-3">
            {/* Language Switcher */}
            <div className="flex items-center bg-slate-100 p-0.5 rounded-lg text-xs font-medium mr-1">
              <button
                onClick={() => onLanguageChange('fr')}
                className={`px-2 py-1 rounded-md transition-colors ${
                  lang === 'fr' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                FR
              </button>
              <button
                onClick={() => onLanguageChange('en')}
                className={`px-2 py-1 rounded-md transition-colors ${
                  lang === 'en' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                EN
              </button>
            </div>

            {/* Mobile App Launcher Button */}
            <button
              onClick={onOpenMobileApp}
              className="inline-flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold text-orange-700 bg-orange-50 border border-orange-200 rounded-lg hover:bg-orange-100 transition-colors"
              title="Tester l’application mobile PlayUp pour les joueurs"
            >
              <Smartphone className="w-3.5 h-3.5 text-orange-600" />
              <span>App Mobile PlayUp</span>
            </button>

            {/* Reseller Portal Login */}
            <button
              onClick={() => onNavigate('reseller')}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                currentTab === 'reseller'
                  ? 'bg-orange-600 text-white shadow-sm'
                  : 'text-slate-700 bg-slate-100 hover:bg-slate-200'
              }`}
            >
              Espace Reseller
            </button>

            {/* Admin Access Link */}
            <button
              onClick={() => onNavigate('admin')}
              className={`p-1.5 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors ${
                currentTab === 'admin' ? 'text-orange-600 bg-orange-50' : ''
              }`}
              title="Espace Administrateur"
            >
              <Shield className="w-4 h-4" />
            </button>
          </div>

          {/* Mobile hamburger */}
          <div className="flex md:hidden items-center gap-2">
            <button
              onClick={onOpenMobileApp}
              className="p-1.5 text-orange-600 bg-orange-50 rounded-md text-xs font-semibold flex items-center gap-1"
            >
              <Smartphone className="w-4 h-4" />
              <span>App</span>
            </button>
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 text-slate-600 hover:text-slate-900 focus:outline-none"
              aria-label="Toggle Menu"
            >
              {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Menu Drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden border-b border-slate-200 bg-white px-4 pt-2 pb-6 space-y-3">
          <div className="flex justify-between items-center pb-2 border-b border-slate-100">
            <span className="text-xs font-medium text-slate-500">Navigation</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => onLanguageChange('fr')}
                className={`px-2 py-0.5 text-xs rounded ${lang === 'fr' ? 'bg-orange-600 text-white font-bold' : 'text-slate-600'}`}
              >
                FR
              </button>
              <button
                onClick={() => onLanguageChange('en')}
                className={`px-2 py-0.5 text-xs rounded ${lang === 'en' ? 'bg-orange-600 text-white font-bold' : 'text-slate-600'}`}
              >
                EN
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-1">
            {navLinks.map(link => (
              <button
                key={link.id}
                onClick={() => handleLinkClick(link.id)}
                className={`text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  currentTab === link.id
                    ? 'bg-orange-50 text-orange-600 font-semibold'
                    : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                {link.label}
              </button>
            ))}
          </div>

          <div className="pt-3 border-t border-slate-100 space-y-2">
            <button
              onClick={() => {
                onOpenMobileApp();
                setMobileMenuOpen(false);
              }}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-orange-600 text-white rounded-lg text-sm font-semibold shadow-xs"
            >
              <Smartphone className="w-4 h-4" />
              <span>Ouvrir l’App Mobile PlayUp</span>
            </button>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => handleLinkClick('reseller')}
                className="py-2 px-3 text-center border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Espace Reseller
              </button>
              <button
                onClick={() => handleLinkClick('admin')}
                className="py-2 px-3 text-center border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Admin Panel
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
};
