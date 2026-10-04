/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Navbar } from './components/layout/Navbar';
import { Footer } from './components/layout/Footer';
import { HomeView } from './views/web/HomeView';
import { ServicesView } from './views/web/ServicesView';
import { DownloadView } from './views/web/DownloadView';
import { ApiDocsView } from './views/web/ApiDocsView';
import { ResellerPortalView } from './views/web/ResellerPortalView';
import { SupportView } from './views/web/SupportView';
import { PlayUpMobileApp } from './views/mobile/PlayUpMobileApp';
import { AdminDashboardView } from './views/admin/AdminDashboardView';
import { Game, Service, AppSettings } from './types';
import { apiClient } from './services/apiClient';
import { Language } from './i18n';
import { INITIAL_GAMES, INITIAL_SERVICES, INITIAL_SETTINGS } from './data/initialData';

export default function App() {
  const [currentTab, setCurrentTab] = useState<string>('home');
  const [lang, setLang] = useState<Language>('fr');

  // Shared platform state
  const [games, setGames] = useState<Game[]>(INITIAL_GAMES);
  const [services, setServices] = useState<Service[]>(INITIAL_SERVICES);
  const [settings, setSettings] = useState<AppSettings>(INITIAL_SETTINGS);
  const [selectedGame, setSelectedGame] = useState<Game | null>(null);

  // Mobile App Modal simulator
  const [isMobileAppOpen, setIsMobileAppOpen] = useState(false);
  // Admin Overlay
  const [isAdminOpen, setIsAdminOpen] = useState(false);

  useEffect(() => {
    // Fetch live backend data
    apiClient.getGames().then(data => {
      if (data && data.length > 0) setGames(data);
    }).catch(console.error);

    apiClient.getServices().then(data => {
      if (data && data.length > 0) setServices(data);
    }).catch(console.error);

    apiClient.getSettings().then(data => {
      if (data) setSettings(data);
    }).catch(console.error);
  }, []);

  const handleNavigate = (tab: string) => {
    if (tab === 'admin') {
      setIsAdminOpen(true);
      return;
    }
    setCurrentTab(tab);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen flex flex-col bg-white text-slate-900 selection:bg-orange-500 selection:text-white">
      {/* Top Banner Notice if in maintenance or announcement */}
      {settings.announcementNotice && (
        <div className="bg-slate-950 text-white text-[11px] py-1.5 px-4 text-center border-b border-slate-800">
          <span className="font-semibold text-orange-400">Information Système :</span>{' '}
          {settings.announcementNotice}
        </div>
      )}

      {/* Main Top Navigation Contract */}
      <Navbar
        currentTab={currentTab}
        onNavigate={handleNavigate}
        lang={lang}
        onLanguageChange={setLang}
        onOpenMobileApp={() => setIsMobileAppOpen(true)}
      />

      {/* Main Dynamic View Content */}
      <main className="flex-1">
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
      </main>

      {/* Footer */}
      <Footer
        onNavigate={handleNavigate}
        lang={lang}
      />

      {/* PLAYUP MOBILE APP MODAL SIMULATOR */}
      {isMobileAppOpen && (
        <PlayUpMobileApp
          games={games}
          services={services}
          onClose={() => setIsMobileAppOpen(false)}
          lang={lang}
        />
      )}

      {/* ADMIN CONTROL PANEL OVERLAY */}
      {isAdminOpen && (
        <AdminDashboardView
          onClose={() => setIsAdminOpen(false)}
        />
      )}
    </div>
  );
}
