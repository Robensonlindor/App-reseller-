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
import { PlayUpSplashLogo } from './components/common/PlayUpSplashLogo';
import { Game, Service, AppSettings, AppUser } from './types';
import { apiClient } from './services/apiClient';
import { Language } from './i18n';
import { INITIAL_GAMES, INITIAL_SERVICES, INITIAL_SETTINGS } from './data/initialData';
import { safeStorage } from './lib/safeStorage';
import { consumeGoogleRedirectResult } from './lib/firebase';

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

  // Mobile App Modal simulator (automatically opens when launched with ?mode=mobile_app or ?source=android_app)
  const [isMobileAppOpen, setIsMobileAppOpen] = useState(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      return (
        params.get('mode') === 'mobile_app' ||
        params.get('source') === 'android_app' ||
        params.get('source') === 'ios_app'
      );
    } catch {
      return false;
    }
  });
  // Admin Overlay
  const [isAdminOpen, setIsAdminOpen] = useState(false);
  // Automatic startup splash screen — minimum 2500ms duration to prevent UI race conditions on slow Android hardware
  const [showStartupSplash, setShowStartupSplash] = useState(true);
  const [minSplashElapsed, setMinSplashElapsed] = useState(false);

  useEffect(() => {
    const MIN_SPLASH_DURATION_MS = 2500;
    const timer = setTimeout(() => {
      setMinSplashElapsed(true);
      setShowStartupSplash(false);
    }, MIN_SPLASH_DURATION_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (minSplashElapsed && showStartupSplash) {
      setShowStartupSplash(false);
    }
  }, [minSplashElapsed, showStartupSplash]);

  // Verify any existing local token against the backend on startup & keep session alive
  const verifyCurrentSession = useCallback(async () => {
    let token = safeStorage.getItem('playup_user_token') || safeStorage.getItem('playup_admin_token');

    // Check if returning from a Google OAuth redirect flow
    if (!token) {
      const redirectResult = await consumeGoogleRedirectResult();
      if (redirectResult && redirectResult.email) {
        try {
          const socialRes = await apiClient.socialLoginUser({
            provider: 'google',
            uid: redirectResult.uid,
            email: redirectResult.email,
            name: redirectResult.name,
            avatarUrl: redirectResult.avatarUrl,
            idToken: redirectResult.idToken,
            accessToken: redirectResult.accessToken
          });
          if (socialRes?.user && socialRes?.token) {
            safeStorage.setItem('playup_user_token', socialRes.token);
            safeStorage.setItem('playup_user_profile', JSON.stringify(socialRes.user));
            if (socialRes.user.role === 'ADMIN') {
              safeStorage.setItem('playup_admin_token', socialRes.token);
            }
            setAuthUser(socialRes.user);
            return;
          }
        } catch {
          // ignore redirect error
        }
      }
      setAuthUser(null);
      return;
    }

    try {
      const res = await apiClient.getUserProfile(token);
      if (res && res.user) {
        setAuthUser(res.user);
        safeStorage.setItem('playup_user_token', token);
        safeStorage.setItem('playup_user_profile', JSON.stringify(res.user));
        if (res.user.role === 'ADMIN') {
          safeStorage.setItem('playup_admin_token', token);
        } else {
          safeStorage.removeItem('playup_admin_token');
          setIsAdminOpen(false);
        }
      }
    } catch (err: any) {
      // Only clear session if backend explicitly rejected the token with 401 Unauthorized
      if (err?.status === 401) {
        safeStorage.removeItem('playup_user_token');
        safeStorage.removeItem('playup_user_profile');
        safeStorage.removeItem('playup_admin_token');
        setAuthUser(null);
        setIsAdminOpen(false);
      }
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

    const handleAuthSync = () => {
      verifyCurrentSession();
    };
    window.addEventListener('playup:auth-updated', handleAuthSync);
    const sessionHeartbeat = setInterval(() => {
      verifyCurrentSession();
    }, 90000);

    return () => {
      window.removeEventListener('playup:auth-updated', handleAuthSync);
      clearInterval(sessionHeartbeat);
    };
  }, [loadBackendCatalog, verifyCurrentSession]);

  // Real-time subscription to USD->HTG exchange rate & HTG price updates
  useEffect(() => {
    const handlePricingEvent = () => {
      loadBackendCatalog();
    };
    window.addEventListener('playup:pricing-updated', handlePricingEvent);

    let es: EventSource | null = null;
    if (typeof window !== 'undefined' && 'EventSource' in window) {
      try {
        es = new EventSource('/api/pricing/stream');
        es.onmessage = (evt) => {
          try {
            const parsed = JSON.parse(evt.data);
            if (parsed && parsed.type === 'PRICING_UPDATED') {
              loadBackendCatalog();
              window.dispatchEvent(new CustomEvent('playup:pricing-updated', { detail: parsed }));
            }
          } catch {
            // ignore
          }
        };
      } catch {
        // ignore if SSE unavailable
      }
    }

    return () => {
      window.removeEventListener('playup:pricing-updated', handlePricingEvent);
      if (es) {
        try {
          es.close();
        } catch {
          // ignore
        }
      }
    };
  }, [loadBackendCatalog]);

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
      {/* Startup Splash Screen — Appears at app opening and disappears automatically after 2 seconds */}
      {showStartupSplash && (
        <div className="fixed inset-0 z-[100] bg-[#050302] flex items-center justify-center p-8 select-none pointer-events-none transition-opacity duration-300">
          <PlayUpSplashLogo className="w-[75%] max-w-[280px] h-auto" />
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
      <main className="flex-1 w-full max-w-full overflow-x-hidden">
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
            authUser={authUser}
            onAuthChange={(user) => setAuthUser(user)}
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
