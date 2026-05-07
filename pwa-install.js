// 🆕 v6.62.405: PWA-Install-Button + Browser-Anleitungs-Modal
// Wird auf kunden.html, buchen.html, landing.html, hotel.html eingebunden.
// Zeigt schwebenden Button rechts unten an, versteckt sich wenn App schon
// installiert (display-mode: standalone). Klick:
//   - Chromium-Browser: nativer beforeinstallprompt-Dialog
//   - Firefox / Safari / Sonstige: Modal mit Browser-spezifischer Anleitung

(function() {
    'use strict';

    let deferredPrompt = null;

    // beforeinstallprompt cachen (Chrome / Edge / Brave / Opera / Samsung)
    window.addEventListener('beforeinstallprompt', function(e) {
        e.preventDefault();
        deferredPrompt = e;
    });

    // Wenn schon installiert, Button verstecken
    window.addEventListener('appinstalled', function() {
        const btn = document.getElementById('pwa-install-btn');
        if (btn) btn.style.display = 'none';
    });

    function isStandalone() {
        return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
            || window.navigator.standalone === true;
    }

    function detectBrowser() {
        const ua = navigator.userAgent;
        const isIOS = /iPad|iPhone|iPod/.test(ua);
        const isAndroid = /Android/.test(ua);
        const isFirefox = /Firefox/.test(ua);
        const isEdge = /Edg/.test(ua);
        const isChromium = !isFirefox && /(Chrome|Edg|OPR|Brave)/.test(ua);
        const isSafari = /Safari/.test(ua) && !isChromium && !isFirefox;
        return { isIOS, isAndroid, isFirefox, isEdge, isChromium, isSafari };
    }

    function injectStyle() {
        if (document.getElementById('pwa-install-style')) return;
        const style = document.createElement('style');
        style.id = 'pwa-install-style';
        style.textContent = `
            #pwa-install-btn {
                position: fixed; bottom: 14px; right: 14px;
                background: linear-gradient(135deg, #0f4c81, #1e6091);
                color: white; border: none; border-radius: 24px;
                padding: 10px 16px; font-size: 13px; font-weight: 700;
                cursor: pointer; box-shadow: 0 4px 14px rgba(0,0,0,0.28);
                z-index: 9999; font-family: inherit;
                display: flex; align-items: center; gap: 6px;
                transition: transform 0.15s, opacity 0.2s;
            }
            #pwa-install-btn:active { transform: scale(0.96); }
            #pwa-install-btn:hover { opacity: 0.92; }

            #pwa-install-modal {
                position: fixed; inset: 0; background: rgba(0,0,0,0.55);
                z-index: 10000; display: none; align-items: center; justify-content: center;
                padding: 16px; animation: pwafadein 0.18s;
            }
            #pwa-install-modal.show { display: flex; }
            @keyframes pwafadein { from { opacity: 0; } to { opacity: 1; } }
            #pwa-install-modal .pwa-modal-card {
                background: white; max-width: 440px; width: 100%;
                border-radius: 14px; padding: 22px; box-shadow: 0 10px 40px rgba(0,0,0,0.3);
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
                color: #1f2937;
            }
            #pwa-install-modal h3 {
                font-size: 17px; font-weight: 700; color: #0f4c81;
                margin: 0 0 12px 0;
            }
            #pwa-install-modal .pwa-step {
                display: flex; gap: 10px; align-items: flex-start;
                margin-bottom: 10px; font-size: 14px; line-height: 1.45;
            }
            #pwa-install-modal .pwa-step-num {
                background: #0f4c81; color: white; width: 22px; height: 22px;
                border-radius: 50%; display: flex; align-items: center; justify-content: center;
                font-size: 12px; font-weight: 700; flex-shrink: 0;
            }
            #pwa-install-modal .pwa-fallback-note {
                background: #fef3c7; border: 1px solid #fde68a;
                padding: 10px 12px; border-radius: 8px; font-size: 13px;
                color: #92400e; margin-top: 12px; line-height: 1.5;
            }
            #pwa-install-modal button.pwa-close-btn {
                width: 100%; margin-top: 14px; padding: 10px;
                background: #f3f4f6; color: #374151; border: none;
                border-radius: 9px; font-weight: 600; font-size: 14px; cursor: pointer;
                font-family: inherit;
            }
        `;
        document.head.appendChild(style);
    }

    function injectButton() {
        if (document.getElementById('pwa-install-btn')) return;
        const btn = document.createElement('button');
        btn.id = 'pwa-install-btn';
        btn.type = 'button';
        btn.innerHTML = '<span style="font-size:15px;">📱</span> App installieren';
        btn.setAttribute('aria-label', 'App auf Ihrem Gerät installieren');
        btn.addEventListener('click', handleInstallClick);
        document.body.appendChild(btn);
    }

    async function handleInstallClick() {
        // Native Installation, wenn beforeinstallprompt verfügbar
        if (deferredPrompt) {
            try {
                deferredPrompt.prompt();
                const choice = await deferredPrompt.userChoice;
                if (choice && choice.outcome === 'accepted') {
                    const btn = document.getElementById('pwa-install-btn');
                    if (btn) btn.style.display = 'none';
                }
            } catch (e) {
                console.warn('Install-Prompt fehlgeschlagen:', e);
                showInstructionsModal();
            }
            deferredPrompt = null;
            return;
        }
        // Fallback: manuelle Anleitung je Browser
        showInstructionsModal();
    }

    function buildInstructions() {
        const b = detectBrowser();
        let title = 'App auf Ihr Gerät hinzufügen';
        let steps = [];
        let note = '';

        if (b.isIOS && b.isSafari) {
            title = '📱 iPhone / iPad — Safari';
            steps = [
                'Tippen Sie unten auf das Teilen-Symbol &#x2934;',
                'Wählen Sie „Zum Home-Bildschirm" aus der Liste',
                'Tippen Sie auf „Hinzufügen"'
            ];
        } else if (b.isIOS) {
            title = '📱 iPhone / iPad';
            steps = [
                'Öffnen Sie diese Seite in Safari (App-Installation geht nur dort)',
                'Tippen Sie auf das Teilen-Symbol unten',
                'Wählen Sie „Zum Home-Bildschirm hinzufügen"'
            ];
        } else if (b.isAndroid && b.isFirefox) {
            title = '🦊 Firefox auf Android';
            steps = [
                'Tippen Sie oben rechts auf das ⋮ Menü',
                'Wählen Sie „Installieren" oder „Zum Startbildschirm hinzufügen"'
            ];
        } else if (b.isFirefox) {
            title = '🦊 Firefox am Computer';
            steps = [];
            note = 'Firefox am Desktop unterstützt die Installation als App leider nicht. ' +
                   'Bitte öffnen Sie diese Seite in Chrome, Edge oder Brave — dort erscheint oben in der Adressleiste ein Installations-Symbol.';
        } else if (b.isAndroid) {
            title = '📱 Android';
            steps = [
                'Tippen Sie oben rechts auf das ⋮ Menü',
                'Wählen Sie „App installieren" oder „Zum Startbildschirm hinzufügen"'
            ];
        } else {
            title = '💻 Am Computer';
            steps = [
                'Schauen Sie oben rechts in die Adressleiste — dort erscheint ein Installations-Symbol',
                'Klicken Sie darauf und bestätigen Sie',
                'Alternative: Browser-Menü → „App installieren"'
            ];
        }

        return { title, steps, note };
    }

    function showInstructionsModal() {
        let modal = document.getElementById('pwa-install-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'pwa-install-modal';
            document.body.appendChild(modal);
        }
        const { title, steps, note } = buildInstructions();
        let html = '<div class="pwa-modal-card"><h3>' + title + '</h3>';
        steps.forEach(function(s, i) {
            html += '<div class="pwa-step"><div class="pwa-step-num">' + (i + 1) + '</div><div>' + s + '</div></div>';
        });
        if (note) {
            html += '<div class="pwa-fallback-note">' + note + '</div>';
        }
        html += '<button type="button" class="pwa-close-btn" onclick="document.getElementById(\'pwa-install-modal\').classList.remove(\'show\')">Schließen</button></div>';
        modal.innerHTML = html;
        modal.classList.add('show');
        modal.addEventListener('click', function(e) {
            if (e.target === modal) modal.classList.remove('show');
        });
    }

    function init() {
        if (isStandalone()) return; // schon installiert → keinen Button zeigen
        injectStyle();
        injectButton();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
