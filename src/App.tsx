/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, AlertCircle } from 'lucide-react';
import { Navbar } from './components/layout/Navbar';
import { Footer } from './components/layout/Footer';
import { HomeView } from './views/web/HomeView';
import { ServicesView } from './views/web/ServicesView';
import { DownloadView } from './views/web/DownloadView';
import { ApiDocsView } from './views/web/ApiDocsView';
import { ResellerPortalView } from './views/web/ResellerPortalView';
import { SupportView } from './views/web/SupportView';
import { UserAccountView } from './views/web/UserAccountView';
import { PlayUpMobileApp } from './views/mobile/PlayUpMobileApp';
import { AdminDashboardView } from './views/admin/AdminDashboardView';
import { Game, Service, AppSettings, AppUser } from './types';
import { apiClient } from './services/apiClient';
import { Language } from './i18n';
import { INITIAL_GAMES, INITIAL_SERVICES, INITIAL_SETTINGS } from './data/initialData';
import { safeStorage } from './lib/safeStorage';

const VALID_TABS = new Set(['home', 'services', 'reseller', 'api-docs', 'download', 'support', 'account']);

export default function App() {
  const [currentTab, setCurrentTab] = useState<string>('home');
  const [lang, setLang] = useState<Language>('fr');
  const [authUser, setAuthUser] = useState<AppUser | null>(null);

  // Shared platform state initialized immediately with local fallback catalog
  const [games, setGames] = useState<Game[]>(INITIAL_GAMES);
  const [services, setServices] = useState<Service[]>(INITIAL_SERVICES);
  const [settings, setSettings] = useState<AppSettings>(INITIAL_SETTINGS);
  const [selectedGame, setSelectedGame] = useState<Game | null>(null);

  // Non-blocking backend synchronization state
  const [isSyncingBackend, setIsSyncingBackend] = useState<boolean>(true);
  const [backendError, setBackendError] = useState<string | null>(null);

  // Mobile App Modal simulator
  const [isMobileAppOpen, setIsMobileAppOpen] = useState(false);
  // Admin Overlay
  const [isAdminOpen, setIsAdminOpen] = useState(false);

  // Verify any existing local token against the backend on startup
  const verifyCurrentSession = useCallback(async () => {
    const token = safeStorage.getItem('playup_user_token');
    if (!token) {
      safeStorage.removeItem('playup_user_profile');
      safeStorage.removeItem('playup_admin_token');
      setAuthUser(null);
      setIsAdminOpen(false);
      return;
    }
    try {
      const res = await apiClient.getUserProfile(token);
      if (res && res.user) {
        setAuthUser(res.user);
        safeStorage.setItem('playup_user_profile', JSON.stringify(res.user));
        if (res.user.role !== 'ADMIN') {
          safeStorage.removeItem('playup_admin_token');
          setIsAdminOpen(false);
        }
      } else {
        safeStorage.removeItem('playup_user_token');
        safeStorage.removeItem('playup_user_profile');
        safeStorage.removeItem('playup_admin_token');
        setAuthUser(null);
        setIsAdminOpen(false);
      }
    } catch {
      safeStorage.removeItem('playup_user_token');
      safeStorage.removeItem('playup_user_profile');
      safeStorage.removeItem('playup_admin_token');
      setAuthUser(null);
      setIsAdminOpen(false);
    }
  }, []);

  const loadBackendCatalog = useCallback(async () => {
    setIsSyncingBackend(true);
    setBackendError(null);
    try {
      const [gamesRes, servicesRes, settingsRes] = await Promise.allSettled([
        apiClient.getGames(),
        apiClient.getServices(),
        apiClient.getSettings()
      ]);

      let anySucceeded = false;

      if (gamesRes.status === 'fulfilled' && Array.isArray(gamesRes.value) && gamesRes.value.length > 0) {
        setGames(gamesRes.value);
        anySucceeded = true;
      }

      if (servicesRes.status === 'fulfilled' && Array.isArray(servicesRes.value) && servicesRes.value.length > 0) {
        setServices(servicesRes.value);
        anySucceeded = true;
      }

      if (settingsRes.status === 'fulfilled' && settingsRes.value && settingsRes.value.platformName) {
        setSettings(settingsRes.value);
        anySucceeded = true;
      }

      if (!anySucceeded) {
        setBackendError('Service temporairement indisponible — Affichage du catalogue de secours.');
      }
    } catch (err) {
      console.warn('[PlayUp App] Backend sync fallback:', err);
      setBackendError('Service temporairement indisponible — Mode autonome actif.');
    } finally {
      setIsSyncingBackend(false);
    }
  }, []);

  useEffect(() => {
    loadBackendCatalog();
    verifyCurrentSession();
  }, [loadBackendCatalog, verifyCurrentSession]);

  const handleNavigate = (tab: string) => {
    if (tab === 'admin') {
      // Only allow opening Admin Panel if authenticated with role === 'ADMIN'
      if (authUser && authUser.role === 'ADMIN') {
        setIsAdminOpen(true);
      } else {
        setCurrentTab('account');
      }
      return;
    }
    if (tab === 'mobile-app') {
      setIsMobileAppOpen(true);
      return;
    }
    const targetTab = VALID_TABS.has(tab) ? tab : 'home';
    setCurrentTab(targetTab);
    try {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      // Ignore scroll errors in older mobile webviews
    }
  };

  return (
    <div className="min-h-screen w-full overflow-x-hidden flex flex-col bg-white text-slate-900 selection:bg-orange-500 selection:text-white">
      {/* Top Banner Notice if in maintenance or announcement */}
      {settings?.announcementNotice && (
        <div className="bg-slate-950 text-white text-[11px] py-1.5 px-4 text-center border-b border-slate-800">
          <span className="font-semibold text-orange-400">Information Système :</span>{' '}
          {settings.announcementNotice}
        </div>
      )}

      {/* Non-blocking Backend Warning / Retry Banner if backend is unreachable */}
      {backendError && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-xs text-amber-900 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>{backendError}</span>
          </div>
          <button
            onClick={loadBackendCatalog}
            disabled={isSyncingBackend}
            className="px-2.5 py-1 bg-amber-100 hover:bg-amber-200 text-amber-900 font-semibold rounded-lg flex items-center gap-1 shrink-0 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncingBackend ? 'animate-spin' : ''}`} />
            <span>Réessayer</span>
          </button>
        </div>
      )}

      {/* Main Top Navigation Contract */}
      <Navbar
        currentTab={currentTab}
        onNavigate={handleNavigate}
        lang={lang}
        onLanguageChange={setLang}
        onOpenMobileApp={() => setIsMobileAppOpen(true)}
        authUser={authUser}
      />

      {/* Main Dynamic View Content */}
      <main className="flex-1 w-full">
        {currentTab === 'home' && (
          <HomeView
            games={games}
            onNavigate={handleNavigate}
            onOpenMobileApp={() => setIsMobileAppOpen(true)}
            onSelectGame={(g) => {
              setSelectedGame(g);
              setCurrentTab('services');
            }}
            lang={lang}
          />
        )}

        {currentTab === 'services' && (
          <ServicesView
            games={games}
            services={services}
            selectedGame={selectedGame}
            onSelectGame={setSelectedGame}
            onNavigate={handleNavigate}
            onOpenMobileApp={() => setIsMobileAppOpen(true)}
            lang={lang}
          />
        )}

        {currentTab === 'reseller' && (
          <ResellerPortalView
            onNavigate={handleNavigate}
            lang={lang}
          />
        )}

        {currentTab === 'api-docs' && (
          <ApiDocsView
            onNavigate={handleNavigate}
            lang={lang}
          />
        )}

        {currentTab === 'download' && (
          <DownloadView
            settings={settings}
            onOpenMobileApp={() => setIsMobileAppOpen(true)}
            lang={lang}
          />
        )}

        {currentTab === 'support' && (
          <SupportView
            lang={lang}
          />
        )}

        {currentTab === 'account' && (
          <UserAccountView
            onOpenMobileApp={() => setIsMobileAppOpen(true)}
            onNavigate={handleNavigate}
            onAuthChange={(user) => setAuthUser(user)}
          />
        )}
      </main>

      {/* Footer */}
      <Footer
        onNavigate={handleNavigate}
        lang={lang}
        authUser={authUser}
      />

      {/* PLAYUP MOBILE APP MODAL SIMULATOR */}
      {isMobileAppOpen && (
        <PlayUpMobileApp
          games={games}
          services={services}
          onClose={() => {
            setIsMobileAppOpen(false);
            loadBackendCatalog();
            verifyCurrentSession();
          }}
          lang={lang}
          onAuthChange={(user) => setAuthUser(user)}
        />
      )}

      {/* ADMIN CONTROL PANEL OVERLAY (Only accessible to verified ADMIN role) */}
      {isAdminOpen && authUser?.role === 'ADMIN' && (
        <AdminDashboardView
          onClose={() => {
            setIsAdminOpen(false);
            loadBackendCatalog();
            verifyCurrentSession();
          }}
        />
      )}
    </div>
  );
}
