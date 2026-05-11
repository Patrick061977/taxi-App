// v6.62.611: PWA-Install fuer ALLE Browser — auch iPhone/Firefox.
//   Patrick (11.05. 13:21): "wie koennen die Leute die App dann installieren"
//     (auf Browsern ohne beforeinstallprompt).
// Strategie:
//   - Chrome / Edge / Samsung: nativer Browser-Install-Prompt
//   - iPhone (Safari/Chrome iOS): Modal mit "Teilen → Zum Home-Bildschirm"
//   - Firefox Android: Modal mit "Menue → App installieren"
//   - Android (Chrome ohne beforeinstallprompt) ODER Desktop: APK-Direkt-Download
//   - Wenn schon installiert: Button versteckt
//
// Anchor #pwa-install-anchor → Button DA gross.
// Fallback: floating bottom-right.

(function() {
    'use strict';

    let deferredPrompt = null;
    let buttonInjected = false;

    // Detect platform
    const UA = navigator.userAgent || '';
    const isIOS = /iPad|iPhone|iPod/.test(UA) && !window.MSStream;
    const isAndroid = /Android/.test(UA);
    const isFirefox = /Firefox/.test(UA);
    const isChromium = /Chrome|CriOS|Edg|SamsungBrowser|OPR/.test(UA) && !isFirefox;
    const apkUrl = 'https://umwelt-taxi-insel-usedom.de/app/taxi-app-latest.apk';

    window.addEventListener('beforeinstallprompt', function(e) {
        e.preventDefault();
        deferredPrompt = e;
        if (!buttonInjected && !isStandalone()) {
            injectStyle();
            injectButton('chrome-prompt');
            buttonInjected = true;
        }
    });

    window.addEventListener('appinstalled', function() {
        const btn = document.getElementById('pwa-install-btn');
        if (btn) btn.style.display = 'none';
    });

    // Auch wenn beforeinstallprompt nicht feuert: nach 1 sec ploetzlich
    // immer den Button zeigen — er fuehrt dann zur Anleitung
    window.addEventListener('load', function() {
        setTimeout(function() {
            if (isStandalone() || buttonInjected) return;
            injectStyle();
            injectButton('manual');
            buttonInjected = true;
        }, 1500);
    });

    function isStandalone() {
        return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
            || window.navigator.standalone === true;
    }

    function injectStyle() {
        if (document.getElementById('pwa-install-style')) return;
        const style = document.createElement('style');
        style.id = 'pwa-install-style';
        style.textContent = `
            #pwa-install-btn {
                background: linear-gradient(135deg, #0f4c81, #1e6091);
                color: white; border: none; cursor: pointer;
                font-family: inherit; font-weight: 800;
                transition: transform 0.15s, box-shadow 0.2s, opacity 0.2s;
            }
            #pwa-install-btn:active { transform: scale(0.97); }
            #pwa-install-btn:hover { opacity: 0.92; }
            #pwa-install-btn.prominent {
                display: flex; align-items: center; justify-content: center; gap: 10px;
                width: 100%; max-width: 400px; margin: 0 auto;
                padding: 18px 28px; font-size: 18px;
                border-radius: 14px;
                box-shadow: 0 8px 20px rgba(15, 76, 129, 0.45);
            }
            #pwa-install-btn.prominent .pwa-icon { font-size: 24px; }
            #pwa-install-btn.floating {
                position: fixed; bottom: 14px; right: 14px;
                border-radius: 24px;
                padding: 10px 16px; font-size: 13px;
                box-shadow: 0 4px 14px rgba(0,0,0,0.28);
                z-index: 9999;
                display: flex; align-items: center; gap: 6px;
            }
            #pwa-install-modal {
                position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(15, 23, 42, 0.85); z-index: 99999;
                display: flex; align-items: center; justify-content: center;
                padding: 20px; font-family: inherit;
            }
            #pwa-install-modal .pwa-modal-card {
                background: white; max-width: 480px; width: 100%;
                border-radius: 16px; padding: 24px;
                box-shadow: 0 20px 40px rgba(0,0,0,0.4);
                max-height: 90vh; overflow-y: auto;
            }
            #pwa-install-modal h3 {
                font-size: 20px; margin: 0 0 14px; color: #0f172a;
            }
            #pwa-install-modal .pwa-step {
                background: #f1f5f9; padding: 12px 14px; border-radius: 10px;
                margin-bottom: 10px; font-size: 15px; color: #1e293b; line-height: 1.5;
            }
            #pwa-install-modal .pwa-step strong { color: #0f4c81; }
            #pwa-install-modal .pwa-modal-close {
                margin-top: 8px; width: 100%; padding: 14px;
                background: #0f4c81; color: white; border: none; border-radius: 10px;
                font-size: 16px; font-weight: 700; cursor: pointer;
            }
            #pwa-install-modal .pwa-apk-btn {
                display: block; margin-top: 12px; padding: 14px;
                background: #16a34a; color: white; text-decoration: none;
                border-radius: 10px; text-align: center; font-weight: 800; font-size: 16px;
            }
        `;
        document.head.appendChild(style);
    }

    function injectButton(mode) {
        if (document.getElementById('pwa-install-btn')) return;
        const btn = document.createElement('button');
        btn.id = 'pwa-install-btn';
        btn.type = 'button';
        const anchor = document.getElementById('pwa-install-anchor');
        if (anchor) {
            btn.className = 'prominent';
            btn.innerHTML = '<span class="pwa-icon">📱</span> Taxi-App installieren';
        } else {
            btn.className = 'floating';
            btn.innerHTML = '<span style="font-size:15px;">📱</span> App installieren';
        }
        btn.setAttribute('aria-label', 'Funk Taxi App installieren');
        btn.addEventListener('click', function() { handleInstallClick(mode); });
        (anchor || document.body).appendChild(btn);
    }

    async function handleInstallClick(mode) {
        // Wenn nativer Prompt verfuegbar → direkt nutzen
        if (deferredPrompt) {
            try {
                deferredPrompt.prompt();
                const choice = await deferredPrompt.userChoice;
                if (choice && choice.outcome === 'accepted') {
                    const btn = document.getElementById('pwa-install-btn');
                    if (btn) btn.style.display = 'none';
                }
            } catch (e) { console.warn('Install-Prompt fehlgeschlagen:', e); }
            deferredPrompt = null;
            return;
        }
        // Sonst: Anleitung-Modal je nach Browser
        showInstallModal();
    }

    function showInstallModal() {
        if (document.getElementById('pwa-install-modal')) return;
        const overlay = document.createElement('div');
        overlay.id = 'pwa-install-modal';
        const card = document.createElement('div');
        card.className = 'pwa-modal-card';

        let html = '<h3>📱 Funk Taxi App installieren</h3>';

        if (isIOS) {
            html += '<div class="pwa-step">1. Tipp unten auf <strong>Teilen-Symbol</strong> (Quadrat mit Pfeil ↑)</div>';
            html += '<div class="pwa-step">2. Scrolle nach unten zu <strong>"Zum Home-Bildschirm"</strong></div>';
            html += '<div class="pwa-step">3. Oben rechts auf <strong>"Hinzufügen"</strong></div>';
            html += '<div class="pwa-step" style="background:#fef3c7;color:#92400e;">💡 Geht nur in Safari, nicht in Chrome iOS!</div>';
        } else if (isAndroid && isFirefox) {
            html += '<div class="pwa-step">1. Tipp oben rechts auf das <strong>Menü (3 Punkte)</strong></div>';
            html += '<div class="pwa-step">2. Wähle <strong>"App installieren"</strong> oder <strong>"Zur Startseite hinzufügen"</strong></div>';
        } else if (isAndroid) {
            html += '<div class="pwa-step">📦 Direkter APK-Download (empfohlen für Android):</div>';
            html += '<a class="pwa-apk-btn" href="' + apkUrl + '">📥 Funk-Taxi.apk herunterladen</a>';
            html += '<div class="pwa-step" style="margin-top:14px;">Oder als Web-App:</div>';
            html += '<div class="pwa-step">1. Menü (3 Punkte) → <strong>"App installieren"</strong></div>';
        } else {
            html += '<div class="pwa-step">PWA-Installation wird in deinem Browser nicht direkt unterstützt.</div>';
            html += '<div class="pwa-step">💡 Empfehlung: <strong>Chrome</strong>, <strong>Edge</strong> oder <strong>Brave</strong> verwenden — die zeigen einen Install-Knopf an.</div>';
        }

        html += '<button class="pwa-modal-close" type="button">Verstanden</button>';
        card.innerHTML = html;
        overlay.appendChild(card);
        document.body.appendChild(overlay);
        const closeBtn = card.querySelector('.pwa-modal-close');
        if (closeBtn) closeBtn.addEventListener('click', function() { overlay.remove(); });
        overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
    }

})();
