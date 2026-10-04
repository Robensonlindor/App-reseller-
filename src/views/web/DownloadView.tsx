import React, { useState } from 'react';
import { 
  Download, Smartphone, Apple, CheckCircle2, ShieldCheck, 
  ExternalLink, QrCode, FileText, ArrowRight, HelpCircle 
} from 'lucide-react';
import { AppSettings } from '../../types';
import { Language, translations } from '../../i18n';

interface DownloadViewProps {
  settings: AppSettings;
  onOpenMobileApp: () => void;
  lang: Language;
}

export const DownloadView: React.FC<DownloadViewProps> = ({
  settings,
  onOpenMobileApp,
  lang
}) => {
  const t = translations[lang];
  const [downloadTriggered, setDownloadTriggered] = useState(false);

  const links = settings.downloadLinks;

  const handleDownloadApk = () => {
    setDownloadTriggered(true);
    // Trigger download of APK via dynamic admin configured URL
    const a = document.createElement('a');
    a.href = links.androidApkUrl;
    a.download = 'PlayUp_Latest.apk';
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-16">
      {/* Header */}
      <div className="text-center max-w-3xl mx-auto space-y-4">
        <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-orange-600 bg-orange-50 px-3 py-1 rounded-full">
          <span>Application Mobile Officielle</span>
          <span aria-hidden="true">·</span>
          <span>{links.appVersion}</span>
        </div>
        <h1 className="font-display text-4xl sm:text-5xl font-extrabold tracking-tight text-slate-900">
          {t.download.title}
        </h1>
        <p className="text-base text-slate-600 max-w-2xl mx-auto leading-relaxed">
          {t.download.subtitle}
        </p>
      </div>

      {/* Main Download Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
        {/* 1. Android Direct APK */}
        <div className="bg-white border-2 border-orange-500/80 rounded-3xl p-6 sm:p-8 flex flex-col justify-between shadow-lg relative overflow-hidden">
          <div className="absolute top-0 right-0 bg-orange-600 text-white text-[11px] font-bold px-3 py-1 rounded-bl-xl uppercase tracking-wider">
            Recommandé
          </div>

          <div className="space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-orange-100 flex items-center justify-center text-orange-600">
              <Download className="w-6 h-6" />
            </div>

            <div>
              <h3 className="font-display text-xl font-bold text-slate-900">Android APK Direct</h3>
              <p className="text-xs text-slate-500 mt-1">
                Installation directe sans compte Google. Mises à jour automatiques intégrées.
              </p>
            </div>

            <div className="space-y-2 py-2 text-xs text-slate-600 border-t border-slate-100">
              <div className="flex justify-between">
                <span>Version actuelle :</span>
                <span className="font-semibold text-slate-900">{links.appVersion}</span>
              </div>
              <div className="flex justify-between">
                <span>Taille du fichier :</span>
                <span className="font-mono text-slate-900">{links.apkFileSize}</span>
              </div>
              <div className="flex justify-between">
                <span>Système requis :</span>
                <span className="text-slate-900">Android 7.0+</span>
              </div>
            </div>
          </div>

          <div className="pt-6 space-y-2">
            <button
              onClick={handleDownloadApk}
              className="w-full py-3.5 px-4 bg-orange-600 hover:bg-orange-500 text-white font-semibold text-xs sm:text-sm rounded-xl shadow-md transition-all flex items-center justify-center gap-2"
            >
              <Download className="w-4 h-4" />
              <span>{t.download.androidApk}</span>
            </button>
            <p className="text-[11px] text-center text-slate-500">
              Fichier vérifié sans malware par PlayUp Core
            </p>
          </div>
        </div>

        {/* 2. Google Play Store */}
        <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 flex flex-col justify-between shadow-xs">
          <div className="space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-800">
              <Smartphone className="w-6 h-6" />
            </div>

            <div>
              <h3 className="font-display text-xl font-bold text-slate-900">Google Play</h3>
              <p className="text-xs text-slate-500 mt-1">
                Téléchargement via la boutique officielle Google Play pour smartphones et tablettes Android.
              </p>
            </div>

            <div className="space-y-2 py-2 text-xs text-slate-600 border-t border-slate-100">
              <div className="flex justify-between">
                <span>Plateforme :</span>
                <span className="text-slate-900">Google Play Store</span>
              </div>
              <div className="flex justify-between">
                <span>Protection :</span>
                <span className="text-emerald-700 font-medium">Google Play Protect</span>
              </div>
            </div>
          </div>

          <div className="pt-6 space-y-2">
            <a
              href={links.googlePlayUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full py-3.5 px-4 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs sm:text-sm rounded-xl transition-colors flex items-center justify-center gap-2 text-center"
            >
              <span>{t.download.googlePlay}</span>
              <ExternalLink className="w-4 h-4" />
            </a>
            <p className="text-[11px] text-center text-slate-400">
              Lien officiel configuré dans l’administration
            </p>
          </div>
        </div>

        {/* 3. Apple iOS / App Store */}
        <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 flex flex-col justify-between shadow-xs">
          <div className="space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-800">
              <Apple className="w-6 h-6" />
            </div>

            <div>
              <h3 className="font-display text-xl font-bold text-slate-900">Apple App Store</h3>
              <p className="text-xs text-slate-500 mt-1">
                Version iOS compatible iPhone et iPad avec authentification biométrique Face ID.
              </p>
            </div>

            <div className="space-y-2 py-2 text-xs text-slate-600 border-t border-slate-100">
              <div className="flex justify-between">
                <span>Plateforme :</span>
                <span className="text-slate-900">iOS / iPadOS</span>
              </div>
              <div className="flex justify-between">
                <span>Compatibilité :</span>
                <span className="text-slate-900">iOS 15.0 ou ultérieur</span>
              </div>
            </div>
          </div>

          <div className="pt-6 space-y-2">
            <a
              href={links.iosAppStoreUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full py-3.5 px-4 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs sm:text-sm rounded-xl transition-colors flex items-center justify-center gap-2 text-center"
            >
              <span>{t.download.appStore}</span>
              <ExternalLink className="w-4 h-4" />
            </a>
            <p className="text-[11px] text-center text-slate-400">
              Certifié par Apple App Store Connect
            </p>
          </div>
        </div>
      </div>

      {/* Simulator Direct Access */}
      <div className="max-w-3xl mx-auto bg-slate-900 text-white rounded-3xl p-8 flex flex-col sm:flex-row items-center justify-between gap-6 shadow-xl">
        <div className="space-y-2">
          <span className="text-xs font-semibold text-orange-400 uppercase tracking-wider">
            Test instantané dans votre navigateur
          </span>
          <h3 className="font-display text-xl font-bold">
            Envie d’essayer l’application tout de suite ?
          </h3>
          <p className="text-xs text-slate-300">
            Vous pouvez tester le flux complet d’achat (Free Fire, PUBG, MLBB, etc.) directement dans le simulateur web intégré.
          </p>
        </div>
        <button
          onClick={onOpenMobileApp}
          className="px-6 py-3.5 bg-orange-600 hover:bg-orange-500 text-white text-xs sm:text-sm font-semibold rounded-xl shrink-0 transition-colors flex items-center gap-2"
        >
          <Smartphone className="w-4 h-4" />
          <span>Ouvrir le simulateur PlayUp</span>
        </button>
      </div>

      {/* Guide Installation APK Android */}
      <div className="max-w-4xl mx-auto bg-slate-50 border border-slate-200 rounded-3xl p-8 space-y-6">
        <div className="flex items-center gap-3">
          <HelpCircle className="w-6 h-6 text-orange-600" />
          <h3 className="font-display text-xl font-bold text-slate-900">
            Guide d’installation du fichier APK Android
          </h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 text-xs text-slate-600">
          <div className="space-y-2">
            <span className="font-bold text-slate-900 block text-sm">Étape 1 : Téléchargement</span>
            <p className="leading-relaxed">
              Cliquez sur « Télécharger l'APK Android » ci-dessus. Si Android vous demande confirmation, acceptez le téléchargement.
            </p>
          </div>
          <div className="space-y-2">
            <span className="font-bold text-slate-900 block text-sm">Étape 2 : Autoriser la source</span>
            <p className="leading-relaxed">
              Ouvrez le fichier téléchargé. Si le système vous le demande, activez l’option « Autoriser cette source » dans les paramètres de sécurité.
            </p>
          </div>
          <div className="space-y-2">
            <span className="font-bold text-slate-900 block text-sm">Étape 3 : Lancez PlayUp</span>
            <p className="leading-relaxed">
              Cliquez sur « Installer ». Une fois terminé, lancez PlayUp et commencez à recharger vos jeux favoris instantanément !
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
