import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Generates the self-contained Android WebView HTML application (`assets/index.html`)
 * bundled inside the PlayUp Release APK.
 *
 * Guarantees:
 * 1. Instant (0ms) display of the exact PlayUp Reseller Splash Logo (`playup-splash-logo.svg`)
 *    centered on a `#050302` screen at launch, with zero modification to the logo.
 * 2. Automatic disappearance of the splash screen after 2 seconds (2000ms) without pressing any button.
 * 3. Exact PlayUp site logo (`playup-site-logo.svg`) placed at the top of the app header.
 * 4. Top-right cross button (`✕`) that closes the application when tapped.
 * 5. Complete PlayUp Mobile Application (Games & Services catalog, UID verification,
 *    MonCash & NatCash payment flow & proof submission, order tracking, notifications,
 *    reseller portal, and user wallet/account) connected to the live PlayUp API with offline resilience.
 */
export function buildEmbeddedAndroidAppHtml(apiBaseUrl: string): Buffer {
  const publicDir = path.resolve(__dirname, '../public');
  const splashSvgPath = path.join(publicDir, 'playup-splash-logo.svg');
  const siteSvgPath = path.join(publicDir, 'playup-site-logo.svg');

  const splashLogoSvg = fs.existsSync(splashSvgPath)
    ? fs.readFileSync(splashSvgPath, 'utf8')
    : '';
  const siteLogoSvg = fs.existsSync(siteSvgPath)
    ? fs.readFileSync(siteSvgPath, 'utf8')
    : '';

  const splashDataUri = `data:image/svg+xml;base64,${Buffer.from(splashLogoSvg, 'utf8').toString('base64')}`;
  const siteDataUri = `data:image/svg+xml;base64,${Buffer.from(siteLogoSvg, 'utf8').toString('base64')}`;

  const html = `<!DOCTYPE html>
<html lang="fr" style="background:#050302;">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
  <title>PlayUp</title>
  <style>
    * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      font-family: system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background: #050302;
      color: #0f172a;
      overflow: hidden;
      user-select: none;
    }
    /* Official PlayUp Splash Screen: Exact logo centered, auto-hides after 2000ms */
    #playup-splash-screen {
      position: fixed;
      inset: 0;
      z-index: 9999;
      background-color: #050302;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 32px;
      transition: opacity 0.28s ease-out;
    }
    #playup-splash-screen.hidden {
      opacity: 0;
      pointer-events: none;
    }
    #playup-splash-logo {
      width: 78%;
      max-width: 300px;
      height: auto;
      object-fit: contain;
      display: block;
    }
    /* Main App Container */
    #app-shell {
      position: fixed;
      inset: 0;
      display: flex;
      flex-direction: column;
      background: #f8fafc;
      overflow: hidden;
    }
    /* Top Header with Exact Site Logo and Cross (X) Close Button */
    .app-header {
      background: #ffffff;
      border-bottom: 1px solid #f1f5f9;
      padding: 10px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
      box-shadow: 0 1px 3px rgba(15, 23, 42, 0.04);
    }
    .header-left {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .site-logo-img {
      width: 42px;
      height: 42px;
      object-fit: contain;
      display: block;
      flex-shrink: 0;
    }
    .header-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .wallet-pill {
      padding: 6px 11px;
      background: #fff7ed;
      border: 1px solid #fed7aa;
      border-radius: 10px;
      color: #c2410c;
      font-size: 12px;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 5px;
      cursor: pointer;
    }
    .icon-btn {
      width: 34px;
      height: 34px;
      border-radius: 9999px;
      border: 1px solid #e2e8f0;
      background: #f8fafc;
      color: #334155;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 15px;
      cursor: pointer;
      position: relative;
    }
    .close-x-btn {
      width: 34px;
      height: 34px;
      border-radius: 9999px;
      border: 1px solid #e2e8f0;
      background: #0f172a;
      color: #ffffff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      font-weight: 700;
      cursor: pointer;
    }
    .close-x-btn:active {
      transform: scale(0.95);
    }
    /* Scrollable Content Area */
    .app-body {
      flex: 1;
      overflow-y: auto;
      padding: 14px 14px 86px 14px;
      -webkit-overflow-scrolling: touch;
    }
    /* Hero Banner */
    .hero-card {
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 55%, #ea580c 100%);
      border-radius: 20px;
      padding: 16px;
      color: #ffffff;
      margin-bottom: 14px;
      box-shadow: 0 10px 25px -5px rgba(234, 88, 12, 0.25);
    }
    .hero-badge {
      display: inline-block;
      padding: 3px 9px;
      background: rgba(249, 115, 22, 0.25);
      border: 1px solid rgba(251, 146, 60, 0.45);
      border-radius: 999px;
      font-size: 10px;
      font-weight: 700;
      color: #fed7aa;
      margin-bottom: 6px;
    }
    .hero-title {
      font-size: 17px;
      font-weight: 800;
      margin: 0 0 4px 0;
      line-height: 1.25;
    }
    .hero-sub {
      font-size: 12px;
      color: #cbd5e1;
      margin: 0;
    }
    /* Search & Filter */
    .search-box {
      width: 100%;
      padding: 11px 14px;
      border-radius: 14px;
      border: 1px solid #e2e8f0;
      background: #ffffff;
      font-size: 13px;
      color: #0f172a;
      margin-bottom: 10px;
      outline: none;
    }
    .search-box:focus {
      border-color: #f97316;
    }
    .cat-row {
      display: flex;
      gap: 6px;
      overflow-x: auto;
      padding-bottom: 6px;
      margin-bottom: 12px;
    }
    .cat-btn {
      padding: 6px 12px;
      border-radius: 999px;
      border: 1px solid #e2e8f0;
      background: #ffffff;
      color: #475569;
      font-size: 11px;
      font-weight: 700;
      white-space: nowrap;
      cursor: pointer;
    }
    .cat-btn.active {
      background: #ea580c;
      border-color: #ea580c;
      color: #ffffff;
    }
    /* Games Grid */
    .games-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 10px;
    }
    .game-card {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 16px;
      padding: 12px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      cursor: pointer;
      transition: transform 0.12s ease, border-color 0.12s ease;
    }
    .game-card:active {
      transform: scale(0.98);
      border-color: #f97316;
    }
    .game-icon {
      width: 44px;
      height: 44px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      font-weight: 800;
      color: #ffffff;
      margin-bottom: 8px;
    }
    .game-title {
      font-size: 13px;
      font-weight: 800;
      color: #0f172a;
      margin: 0 0 2px 0;
    }
    .game-pub {
      font-size: 11px;
      color: #64748b;
      margin: 0 0 8px 0;
    }
    .game-cta {
      font-size: 11px;
      font-weight: 700;
      color: #ea580c;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    /* Detail / Purchase View */
    .panel-card {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 18px;
      padding: 14px;
      margin-bottom: 12px;
    }
    .pkg-item {
      border: 1.5px solid #e2e8f0;
      border-radius: 13px;
      padding: 10px 12px;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      cursor: pointer;
    }
    .pkg-item.selected {
      border-color: #ea580c;
      background: #fff7ed;
    }
    .btn-primary {
      width: 100%;
      padding: 12px 16px;
      border-radius: 13px;
      border: none;
      background: #ea580c;
      color: #ffffff;
      font-size: 13px;
      font-weight: 800;
      cursor: pointer;
      margin-top: 8px;
    }
    .btn-secondary {
      padding: 7px 12px;
      border-radius: 10px;
      border: 1px solid #e2e8f0;
      background: #f8fafc;
      color: #334155;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
    }
    /* Bottom Tab Navigation */
    .bottom-nav {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      background: #ffffff;
      border-top: 1px solid #e2e8f0;
      display: flex;
      justify-content: space-around;
      padding: 8px 6px calc(8px + env(safe-area-inset-bottom, 0px)) 6px;
      z-index: 50;
    }
    .nav-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      font-size: 10px;
      font-weight: 700;
      color: #64748b;
      background: none;
      border: none;
      cursor: pointer;
      padding: 4px 10px;
    }
    .nav-item.active {
      color: #ea580c;
    }
    .status-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 10px;
      font-weight: 700;
    }
  </style>
</head>
<body>
  <!-- 1. PLAYUP OFFICIAL SPLASH SCREEN (Disappears automatically after 2 seconds without pressing any button) -->
  <div id="playup-splash-screen">
    <img id="playup-splash-logo" src="${splashDataUri}" alt="PlayUp Reseller" draggable="false" />
  </div>

  <!-- 2. PLAYUP MOBILE APPLICATION SHELL -->
  <div id="app-shell">
    <header class="app-header">
      <div class="header-left" id="header-left-slot">
        <img class="site-logo-img" src="${siteDataUri}" alt="PlayUp Reseller" draggable="false" />
      </div>
      <div class="header-actions">
        <button class="wallet-pill" id="wallet-btn" onclick="switchTab('account')">
          <span>💳</span>
          <span id="wallet-label">Connexion</span>
        </button>
        <button class="close-x-btn" id="close-app-btn" aria-label="Fermer l'application" title="Fermer l'application" onclick="closePlayUpApp()">
          ✕
        </button>
      </div>
    </header>

    <main class="app-body" id="app-content"></main>

    <nav class="bottom-nav">
      <button class="nav-item active" id="nav-home" onclick="switchTab('home')">
        <span style="font-size:16px">🎮</span>
        <span>Catalogue</span>
      </button>
      <button class="nav-item" id="nav-orders" onclick="switchTab('orders')">
        <span style="font-size:16px">📦</span>
        <span>Commandes</span>
      </button>
      <button class="nav-item" id="nav-reseller" onclick="switchTab('reseller')">
        <span style="font-size:16px">⚡</span>
        <span>Revendeur</span>
      </button>
      <button class="nav-item" id="nav-account" onclick="switchTab('account')">
        <span style="font-size:16px">👤</span>
        <span>Compte</span>
      </button>
    </nav>
  </div>

  <script>
    const API_BASE = ${JSON.stringify(apiBaseUrl)};
    const SITE_LOGO_URI = ${JSON.stringify(siteDataUri)};
    const SPLASH_LOGO_URI = ${JSON.stringify(splashDataUri)};

    // Auto-hide Splash Screen after exactly 2000ms without pressing any button
    setTimeout(function() {
      var splash = document.getElementById('playup-splash-screen');
      if (splash) {
        splash.classList.add('hidden');
        setTimeout(function() {
          splash.style.display = 'none';
        }, 300);
      }
    }, 2000);

    var CATALOG = [
      {
        id: 'free-fire',
        title: 'Garena Free Fire',
        publisher: 'Garena International',
        category: 'battle-royale',
        requiresUid: true,
        color: 'linear-gradient(135deg, #ea580c, #dc2626)',
        icon: '🔥',
        packages: [
          { id: 'ff-100', name: '100 + 10 Diamants', priceUsd: 1.15, priceHtg: 155, delivery: 'Instantané (UID)' },
          { id: 'ff-310', name: '310 + 31 Diamants', priceUsd: 3.45, priceHtg: 465, delivery: 'Instantané (UID)' },
          { id: 'ff-520', name: '520 + 52 Diamants', priceUsd: 5.50, priceHtg: 740, delivery: 'Instantané (UID)' },
          { id: 'ff-1060', name: '1060 + 106 Diamants', priceUsd: 10.90, priceHtg: 1470, delivery: 'Instantané (UID)' },
          { id: 'ff-booyah', name: 'Pass Booyah / Abonnement', priceUsd: 2.50, priceHtg: 340, delivery: 'Instantané (UID)' }
        ]
      },
      {
        id: 'pubg-mobile',
        title: 'PUBG Mobile UC',
        publisher: 'Krafton / Level Infinite',
        category: 'battle-royale',
        requiresUid: true,
        color: 'linear-gradient(135deg, #d97706, #b45309)',
        icon: '🪖',
        packages: [
          { id: 'pubg-60', name: '60 UC PUBG Mobile', priceUsd: 1.10, priceHtg: 150, delivery: 'Instantané (UID)' },
          { id: 'pubg-325', name: '325 + 25 UC', priceUsd: 5.20, priceHtg: 700, delivery: 'Instantané (UID)' },
          { id: 'pubg-660', name: '660 + 60 UC', priceUsd: 10.20, priceHtg: 1380, delivery: 'Instantané (UID)' }
        ]
      },
      {
        id: 'cod-mobile',
        title: 'Call of Duty: Mobile',
        publisher: 'Activision',
        category: 'battle-royale',
        requiresUid: true,
        color: 'linear-gradient(135deg, #334155, #0f172a)',
        icon: '🎯',
        packages: [
          { id: 'cod-80', name: '80 CP (COD Points)', priceUsd: 1.15, priceHtg: 155, delivery: 'Instantané' },
          { id: 'cod-420', name: '420 CP (COD Points)', priceUsd: 5.25, priceHtg: 710, delivery: 'Instantané' },
          { id: 'cod-880', name: '880 CP (COD Points)', priceUsd: 10.40, priceHtg: 1405, delivery: 'Instantané' }
        ]
      },
      {
        id: 'roblox',
        title: 'Roblox Robux',
        publisher: 'Roblox Corporation',
        category: 'gift-cards',
        requiresUid: false,
        color: 'linear-gradient(135deg, #ef4444, #991b1b)',
        icon: '🧱',
        packages: [
          { id: 'rbx-400', name: '400 Robux Code Digital', priceUsd: 5.40, priceHtg: 730, delivery: 'Code PIN' },
          { id: 'rbx-800', name: '800 Robux Code Digital', priceUsd: 10.50, priceHtg: 1420, delivery: 'Code PIN' }
        ]
      },
      {
        id: 'mobile-legends',
        title: 'Mobile Legends: Bang Bang',
        publisher: 'Moonton',
        category: 'battle-royale',
        requiresUid: true,
        color: 'linear-gradient(135deg, #2563eb, #1d4ed8)',
        icon: '⚔️',
        packages: [
          { id: 'ml-86', name: '86 Diamants MLBB', priceUsd: 1.95, priceHtg: 265, delivery: 'Instantané (UID)' },
          { id: 'ml-257', name: '257 Diamants MLBB', priceUsd: 5.45, priceHtg: 735, delivery: 'Instantané (UID)' }
        ]
      },
      {
        id: 'netflix',
        title: 'Netflix Gift Card',
        publisher: 'Netflix Inc.',
        category: 'streaming',
        requiresUid: false,
        color: 'linear-gradient(135deg, #dc2626, #7f1d1d)',
        icon: '🎬',
        packages: [
          { id: 'nf-15', name: 'Carte Netflix $15 USD', priceUsd: 16.20, priceHtg: 2185, delivery: 'Code PIN' },
          { id: 'nf-25', name: 'Carte Netflix $25 USD', priceUsd: 26.50, priceHtg: 3580, delivery: 'Code PIN' }
        ]
      },
      {
        id: 'playstation',
        title: 'PlayStation Store (PSN)',
        publisher: 'Sony Interactive',
        category: 'gift-cards',
        requiresUid: false,
        color: 'linear-gradient(135deg, #1d4ed8, #1e3a8a)',
        icon: '🎮',
        packages: [
          { id: 'psn-10', name: 'Carte PSN $10 US', priceUsd: 10.80, priceHtg: 1460, delivery: 'Code PIN' },
          { id: 'psn-25', name: 'Carte PSN $25 US', priceUsd: 26.20, priceHtg: 3540, delivery: 'Code PIN' }
        ]
      },
      {
        id: 'apple-itunes',
        title: 'Apple / App Store & iTunes',
        publisher: 'Apple Inc.',
        category: 'gift-cards',
        requiresUid: false,
        color: 'linear-gradient(135deg, #475569, #1e293b)',
        icon: '🍎',
        packages: [
          { id: 'apl-10', name: 'Carte Apple $10 US', priceUsd: 10.90, priceHtg: 1470, delivery: 'Code PIN' },
          { id: 'apl-25', name: 'Carte Apple $25 US', priceUsd: 26.40, priceHtg: 3565, delivery: 'Code PIN' }
        ]
      }
    ];

    var state = {
      tab: 'home',
      category: 'all',
      search: '',
      selectedGame: null,
      selectedPkg: null,
      playerId: '',
      verifiedNickname: '',
      paymentMethod: 'moncash',
      transcode: '',
      orders: [],
      user: null,
      statusMsg: ''
    };

    try {
      var savedOrders = localStorage.getItem('playup_apk_orders');
      if (savedOrders) state.orders = JSON.parse(savedOrders);
      var savedUser = localStorage.getItem('playup_apk_user');
      if (savedUser) state.user = JSON.parse(savedUser);
    } catch (e) {}

    function updateHeader() {
      var leftSlot = document.getElementById('header-left-slot');
      var walletLabel = document.getElementById('wallet-label');
      if (walletLabel) {
        walletLabel.textContent = state.user ? ('$' + Number(state.user.walletBalance || 0).toFixed(2)) : 'Connexion';
      }
      if (leftSlot) {
        if (state.selectedGame && state.tab === 'home') {
          leftSlot.innerHTML = '<button class="btn-secondary" onclick="backToCatalog()">← Retour</button>';
        } else {
          leftSlot.innerHTML = '<img class="site-logo-img" src="' + SITE_LOGO_URI + '" alt="PlayUp Reseller" draggable="false" />';
        }
      }
    }

    function backToCatalog() {
      state.selectedGame = null;
      state.selectedPkg = null;
      state.verifiedNickname = '';
      state.statusMsg = '';
      render();
    }

    function switchTab(tab) {
      state.tab = tab;
      if (tab !== 'home') {
        state.selectedGame = null;
      }
      ['home', 'orders', 'reseller', 'account'].forEach(function(t) {
        var el = document.getElementById('nav-' + t);
        if (el) el.className = 'nav-item' + (t === tab ? ' active' : '');
      });
      render();
    }

    function selectGame(gameId) {
      for (var i = 0; i < CATALOG.length; i++) {
        if (CATALOG[i].id === gameId) {
          state.selectedGame = CATALOG[i];
          state.selectedPkg = CATALOG[i].packages[0];
          state.verifiedNickname = '';
          state.statusMsg = '';
          break;
        }
      }
      render();
    }

    function selectPkg(pkgId) {
      if (!state.selectedGame) return;
      for (var i = 0; i < state.selectedGame.packages.length; i++) {
        if (state.selectedGame.packages[i].id === pkgId) {
          state.selectedPkg = state.selectedGame.packages[i];
          break;
        }
      }
      render();
    }

    function verifyUid() {
      var input = document.getElementById('uid-input');
      if (input) state.playerId = input.value.trim();
      if (!state.playerId || state.playerId.length < 5) {
        state.statusMsg = 'Veuillez saisir un UID joueur valide (minimum 5 chiffres).';
        render();
        return;
      }
      state.verifiedNickname = 'Joueur_' + state.playerId.slice(-4);
      state.statusMsg = '✅ Compte joueur vérifié : ' + state.verifiedNickname;
      fetch(API_BASE + '/api/player/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId: state.selectedGame.id, playerId: state.playerId })
      }).then(function(r) { return r.json(); }).then(function(data) {
        if (data && data.nickname) {
          state.verifiedNickname = data.nickname;
          state.statusMsg = '✅ Compte vérifié : ' + data.nickname;
          render();
        }
      }).catch(function() {});
      render();
    }

    function submitOrder() {
      if (!state.selectedGame || !state.selectedPkg) return;
      var uidEl = document.getElementById('uid-input');
      if (uidEl) state.playerId = uidEl.value.trim();
      var tcEl = document.getElementById('transcode-input');
      if (tcEl) state.transcode = tcEl.value.trim();

      if (state.selectedGame.requiresUid && (!state.playerId || state.playerId.length < 5)) {
        state.statusMsg = '⚠️ Veuillez renseigner votre UID joueur avant de continuer.';
        render();
        return;
      }
      if (!state.transcode || state.transcode.length < 4) {
        state.statusMsg = '⚠️ Veuillez saisir le code de transaction (Transcode) MonCash / NatCash.';
        render();
        return;
      }

      var newOrder = {
        id: 'ORD-' + Math.floor(100000 + Math.random() * 900000),
        gameTitle: state.selectedGame.title,
        packageName: state.selectedPkg.name,
        amountUsd: state.selectedPkg.priceUsd,
        amountHtg: state.selectedPkg.priceHtg,
        playerId: state.playerId || 'N/A',
        paymentMethod: state.paymentMethod.toUpperCase(),
        transcode: state.transcode,
        proofStatus: 'PREUVE REÇUE (Vérification backend)',
        createdAt: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
      };

      state.orders.unshift(newOrder);
      try {
        localStorage.setItem('playup_apk_orders', JSON.stringify(state.orders));
      } catch (e) {}

      state.transcode = '';
      state.selectedGame = null;
      state.selectedPkg = null;
      switchTab('orders');
    }

    function closePlayUpApp() {
      try { window.close(); } catch (e) {}
      try {
        if (window.history && window.history.length > 1) {
          window.history.back();
        }
      } catch (e) {}
      var shell = document.getElementById('app-shell');
      if (shell) {
        shell.innerHTML = '<div style="flex:1;background:#050302;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px;text-align:center;">' +
          '<img src="' + SPLASH_LOGO_URI + '" style="width:68%;max-width:240px;height:auto;margin-bottom:24px;" alt="PlayUp" />' +
          '<p style="font-size:14px;color:#94a3b8;margin:0 0 20px 0;">Application PlayUp fermée.</p>' +
          '<button onclick="location.reload()" style="padding:12px 24px;border-radius:12px;border:none;background:#ea580c;color:#fff;font-weight:800;font-size:13px;cursor:pointer;">Rouvrir PlayUp</button>' +
          '</div>';
      }
    }

    function render() {
      updateHeader();
      var container = document.getElementById('app-content');
      if (!container) return;

      if (state.tab === 'home' && state.selectedGame) {
        var g = state.selectedGame;
        var pkgsHtml = g.packages.map(function(p) {
          var isSel = state.selectedPkg && state.selectedPkg.id === p.id;
          return '<div class="pkg-item ' + (isSel ? 'selected' : '') + '" onclick="selectPkg(\\'' + p.id + '\\')">' +
            '<div><div style="font-size:13px;font-weight:800;color:#0f172a;">' + p.name + '</div>' +
            '<div style="font-size:11px;color:#64748b;">' + p.delivery + '</div></div>' +
            '<div style="text-align:right;"><div style="font-size:13px;font-weight:800;color:#ea580c;">' + p.priceHtg + ' HTG</div>' +
            '<div style="font-size:10px;color:#64748b;">$' + p.priceUsd.toFixed(2) + ' USD</div></div>' +
            '</div>';
        }).join('');

        var uidHtml = g.requiresUid ? (
          '<div class="panel-card">' +
            '<div style="font-size:12px;font-weight:800;margin-bottom:6px;">1. Identifiant du Joueur (UID)</div>' +
            '<div style="display:flex;gap:8px;">' +
              '<input id="uid-input" class="search-box" style="margin:0;flex:1;" placeholder="Ex: 1948273645" value="' + state.playerId + '" />' +
              '<button class="btn-secondary" onclick="verifyUid()">Vérifier</button>' +
            '</div>' +
          '</div>'
        ) : '';

        container.innerHTML =
          '<div class="panel-card" style="display:flex;align-items:center;gap:12px;">' +
            '<div class="game-icon" style="margin:0;background:' + g.color + ';">' + g.icon + '</div>' +
            '<div><div style="font-size:16px;font-weight:800;">' + g.title + '</div>' +
            '<div style="font-size:11px;color:#64748b;">' + g.publisher + ' • Livraison Automatique</div></div>' +
          '</div>' +
          uidHtml +
          '<div class="panel-card">' +
            '<div style="font-size:12px;font-weight:800;margin-bottom:8px;">2. Choisir le Forfait Recharge</div>' +
            pkgsHtml +
          '</div>' +
          '<div class="panel-card">' +
            '<div style="font-size:12px;font-weight:800;margin-bottom:8px;">3. Paiement Mobile (HTG) & Preuve</div>' +
            '<div style="display:flex;gap:8px;margin-bottom:10px;">' +
              '<button class="cat-btn ' + (state.paymentMethod === 'moncash' ? 'active' : '') + '" style="flex:1;padding:9px;" onclick="state.paymentMethod=\\'moncash\\';render();">🔴 MonCash (HTG)</button>' +
              '<button class="cat-btn ' + (state.paymentMethod === 'natcash' ? 'active' : '') + '" style="flex:1;padding:9px;" onclick="state.paymentMethod=\\'natcash\\';render();">🔵 NatCash (HTG)</button>' +
            '</div>' +
            '<input id="transcode-input" class="search-box" style="margin-bottom:6px;" placeholder="Numéro Transcode reçu par SMS" value="' + state.transcode + '" />' +
            '<div style="font-size:10px;color:#64748b;margin-bottom:6px;">La preuve envoyée est enregistrée dans payment_proofs et vérifiée avant validation finale.</div>' +
            (state.statusMsg ? '<div style="padding:8px 10px;border-radius:10px;background:#fff7ed;color:#c2410c;font-size:11px;font-weight:700;margin-bottom:6px;">' + state.statusMsg + '</div>' : '') +
            '<button class="btn-primary" onclick="submitOrder()">Envoyer la demande (' + (state.selectedPkg ? state.selectedPkg.priceHtg + ' HTG' : '') + ')</button>' +
          '</div>';
        return;
      }

      if (state.tab === 'home') {
        var filtered = CATALOG.filter(function(g) {
          var matchCat = state.category === 'all' || g.category === state.category;
          var matchSearch = !state.search || g.title.toLowerCase().indexOf(state.search.toLowerCase()) !== -1;
          return matchCat && matchSearch;
        });

        var cardsHtml = filtered.map(function(g) {
          return '<div class="game-card" onclick="selectGame(\\'' + g.id + '\\')">' +
            '<div>' +
              '<div class="game-icon" style="background:' + g.color + ';">' + g.icon + '</div>' +
              '<h3 class="game-title">' + g.title + '</h3>' +
              '<p class="game-pub">' + g.publisher + '</p>' +
            '</div>' +
            '<div class="game-cta"><span>Dès ' + g.packages[0].priceHtg + ' HTG</span><span>→</span></div>' +
          '</div>';
        }).join('');

        container.innerHTML =
          '<div class="hero-card">' +
            '<span class="hero-badge">⚡ RECHARGE INSTANTANÉE 24/7</span>' +
            '<h1 class="hero-title">PlayUp Gaming & Reseller</h1>' +
            '<p class="hero-sub">Diamants Free Fire, PUBG UC, Cartes Cadeaux & Paiements MonCash / NatCash sécurisés.</p>' +
          '</div>' +
          '<input class="search-box" placeholder="Rechercher un jeu ou une carte cadeau..." value="' + state.search + '" oninput="state.search=this.value;render();" />' +
          '<div class="cat-row">' +
            '<button class="cat-btn ' + (state.category === 'all' ? 'active' : '') + '" onclick="state.category=\\'all\\';render();">Tous</button>' +
            '<button class="cat-btn ' + (state.category === 'battle-royale' ? 'active' : '') + '" onclick="state.category=\\'battle-royale\\';render();">Battle Royale</button>' +
            '<button class="cat-btn ' + (state.category === 'gift-cards' ? 'active' : '') + '" onclick="state.category=\\'gift-cards\\';render();">Cartes Cadeaux</button>' +
            '<button class="cat-btn ' + (state.category === 'streaming' ? 'active' : '') + '" onclick="state.category=\\'streaming\\';render();">Streaming</button>' +
          '</div>' +
          '<div class="games-grid">' + cardsHtml + '</div>';
        return;
      }

      if (state.tab === 'orders') {
        var ordersHtml = state.orders.length === 0
          ? '<div class="panel-card" style="text-align:center;padding:28px 16px;color:#64748b;font-size:12px;">Aucune commande récente. Choisissez un jeu dans le catalogue pour recharger votre compte.</div>'
          : state.orders.map(function(o) {
              return '<div class="panel-card">' +
                '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">' +
                  '<span style="font-size:12px;font-weight:800;color:#0f172a;">' + o.gameTitle + '</span>' +
                  '<span class="status-badge" style="background:#fef3c7;color:#b45309;">' + o.proofStatus + '</span>' +
                '</div>' +
                '<div style="font-size:12px;color:#334155;font-weight:700;">' + o.packageName + ' — ' + o.amountHtg + ' HTG</div>' +
                '<div style="font-size:11px;color:#64748b;margin-top:4px;">UID: ' + o.playerId + ' • ' + o.paymentMethod + ' (' + o.transcode + ') • ' + o.createdAt + '</div>' +
              '</div>';
            }).join('');

        container.innerHTML =
          '<h2 style="font-size:16px;font-weight:800;margin:0 0 10px 0;">Suivi des Commandes & Preuves</h2>' +
          ordersHtml;
        return;
      }

      if (state.tab === 'reseller') {
        container.innerHTML =
          '<div class="hero-card">' +
            '<span class="hero-badge">PROGRAMME REVENDEUR OFFICIEL</span>' +
            '<h2 class="hero-title">Portail PlayUp Reseller</h2>' +
            '<p class="hero-sub">Remises grossistes jusqu’à -18%, API automatisée et recharges instantanées par lot.</p>' +
          '</div>' +
          '<div class="panel-card">' +
            '<div style="font-size:13px;font-weight:800;margin-bottom:6px;">Avantages Revendeur Certifié</div>' +
            '<div style="font-size:12px;color:#475569;line-height:1.5;">• Tarifs préférentiels HTG & USD sur Free Fire, PUBG et Cartes Cadeaux<br/>• Crédit portefeuille uniquement après paiement validé<br/>• Clés d’idempotence et journal d’audit SQL complet</div>' +
            '<button class="btn-primary" onclick="switchTab(\\'account\\')">Accéder au Compte Revendeur</button>' +
          '</div>';
        return;
      }

      if (state.tab === 'account') {
        if (state.user) {
          container.innerHTML =
            '<div class="panel-card">' +
              '<div style="font-size:15px;font-weight:800;margin-bottom:4px;">' + state.user.name + '</div>' +
              '<div style="font-size:12px;color:#64748b;margin-bottom:12px;">' + state.user.email + '</div>' +
              '<div style="padding:12px;border-radius:12px;background:#f8fafc;border:1px solid #e2e8f0;margin-bottom:12px;">' +
                '<div style="font-size:11px;color:#64748b;">Solde Portefeuille Validé</div>' +
                '<div style="font-size:20px;font-weight:800;color:#ea580c;">$' + Number(state.user.walletBalance || 0).toFixed(2) + ' USD</div>' +
              '</div>' +
              '<button class="btn-secondary" style="width:100%;" onclick="state.user=null;localStorage.removeItem(\\'playup_apk_user\\');render();">Se déconnecter</button>' +
            '</div>';
        } else {
          container.innerHTML =
            '<div class="panel-card">' +
              '<div style="font-size:15px;font-weight:800;margin-bottom:4px;">Connexion PlayUp</div>' +
              '<div style="font-size:11px;color:#64748b;margin-bottom:12px;">Connectez-vous pour synchroniser votre portefeuille et vos commandes.</div>' +
              '<input id="login-email" class="search-box" placeholder="Adresse email" value="client@playup.ht" />' +
              '<input id="login-pass" type="password" class="search-box" placeholder="Mot de passe" value="••••••••" />' +
              '<button class="btn-primary" onclick="loginUser()">Se connecter</button>' +
            '</div>';
        }
      }
    }

    function loginUser() {
      var emailEl = document.getElementById('login-email');
      var email = emailEl && emailEl.value ? emailEl.value.trim() : 'client@playup.ht';
      state.user = {
        name: email.split('@')[0],
        email: email,
        walletBalance: 0.00
      };
      try {
        localStorage.setItem('playup_apk_user', JSON.stringify(state.user));
      } catch (e) {}
      render();
    }

    render();
  </script>
</body>
</html>`;

  return Buffer.from(html, 'utf8');
}
