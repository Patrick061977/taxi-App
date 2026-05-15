// v6.62.615: Universal "App installieren" — PWA only, kein APK-Download mehr.
//   Patrick (11.05. 14:07): "APK runterladen nicht, das ist Quatsch. Die sollen
//   das Lesezeichen / PWA installieren wie auf iPhone."
//
// 🛑 v6.62.629: Throttle — Patrick (11.05. 20:18): "ist wieder das Zeichen gekommen,
//   App installieren. Wie oft kommt denn das? Jetzt habe ich zwei Icons auf meinem
//   Handy." Bisher feuerte der Button bei JEDEM Browser-Tab-Aufruf, auch wenn schon
//   installiert (Safari/Chrome erkennen die installierte PWA nicht zuverlaessig).
//   Fix: localStorage-Flags persistent + Modal mit "Nicht mehr fragen" Button.
//
// Strategie: 1 Knopf, Modal mit browser-spezifischer Anleitung.
//   - Chrome / Edge Android: Browser-natives Install-Prompt (1-Klick)
//   - Firefox Android: Modal "Menue → Zur Startseite hinzufuegen"
//   - iOS Safari: Modal "Teilen → Zum Home-Bildschirm" (4 Schritte)
//   - Desktop: Modal "Bitte vom Handy aus aufrufen"
//
// Anchor #pwa-install-anchor → Button DA gross.
// Fallback: floating bottom-right.

(function() {
    'use strict';

    let deferredPrompt = null;
    let buttonInjected = false;
    const UA = navigator.userAgent || '';
    const isIOS = /iPad|iPhone|iPod/.test(UA) && !window.MSStream;
    const isAndroid = /Android/.test(UA);
    const isFirefox = /Firefox/.test(UA);
    const isChromiumOnAndroid = isAndroid && /Chrome|CriOS|Edg|SamsungBrowser|OPR/.test(UA) && !isFirefox;

    // 🆕 v6.62.629: Persistente Throttle-Flags
    const LS_KEY_INSTALLED = 'pwa_installed_v1';
    const LS_KEY_DISMISSED = 'pwa_dismissed_until';
    const DISMISS_COOLDOWN_MS = 30 * 24 * 3600 * 1000; // 30 Tage

    function lsGet(k) { try { return localStorage.getItem(k); } catch(_) { return null; } }
    function lsSet(k, v) { try { localStorage.setItem(k, v); } catch(_) {} }

    function alreadyInstalledOrDismissed() {
        if (lsGet(LS_KEY_INSTALLED) === '1') return 'installed';
        const until = parseInt(lsGet(LS_KEY_DISMISSED) || '0', 10);
        if (until && Date.now() < until) return 'dismissed';
        return null;
    }

    window.addEventListener('beforeinstallprompt', function(e) {
        e.preventDefault();
        deferredPrompt = e;
    });

    window.addEventListener('appinstalled', function() {
        // 🆕 v6.62.629: Flag fuer immer — Button kommt nie wieder.
        lsSet(LS_KEY_INSTALLED, '1');
        const btn = document.getElementById('pwa-install-btn');
        if (btn) btn.style.display = 'none';
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
                position: fixed; inset: 0;
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
            #pwa-install-modal h3 { font-size: 22px; margin: 0 0 16px; color: #0f172a; }
            #pwa-install-modal .pwa-step {
                background: #f1f5f9; padding: 14px 16px; border-radius: 10px;
                margin-bottom: 10px; font-size: 16px; color: #1e293b; line-height: 1.5;
            }
            #pwa-install-modal .pwa-step strong { color: #0f4c81; }
            #pwa-install-modal .pwa-close {
                margin-top: 12px; width: 100%; padding: 16px;
                background: #0f4c81; color: white; border: none; border-radius: 12px;
                font-size: 17px; font-weight: 700; cursor: pointer;
            }
        `;
        document.head.appendChild(style);
    }

    function injectButton() {
        if (document.getElementById('pwa-install-btn')) return;
        // v6.62.747 (Patrick 15.05. 21:21): Auf Desktop ausblenden — passt nicht zur Customer-Mobile-Story
        const _isMobileDevice = isAndroid || isIOS;
        if (!_isMobileDevice) {
            console.log('[PWA-Install] Desktop erkannt — Knopf ausgeblendet');
            return;
        }
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
        btn.addEventListener('click', handleClick);
        (anchor || document.body).appendChild(btn);
    }

    async function handleClick() {
        // 1) Chrome / Edge Android: nativer Install-Prompt verfuegbar?
        if (deferredPrompt) {
            try {
                deferredPrompt.prompt();
                const choice = await deferredPrompt.userChoice;
                if (choice && choice.outcome === 'accepted') {
                    // 🆕 v6.62.629: gleich beim accept lokal mitschreiben — appinstalled-Event
                    // kommt manchmal verzoegert oder gar nicht (iOS-PWAs).
                    lsSet(LS_KEY_INSTALLED, '1');
                    const btn = document.getElementById('pwa-install-btn');
                    if (btn) btn.style.display = 'none';
                } else if (choice && choice.outcome === 'dismissed') {
                    // User hat aktiv "Nein" gesagt → 30 Tage nicht mehr nerven.
                    lsSet(LS_KEY_DISMISSED, String(Date.now() + DISMISS_COOLDOWN_MS));
                    const btn = document.getElementById('pwa-install-btn');
                    if (btn) btn.style.display = 'none';
                }
            } catch (e) { console.warn('Install-Prompt fehlgeschlagen:', e); }
            deferredPrompt = null;
            return;
        }
        // 2) Sonst: Anleitung-Modal je Browser
        showModal();
    }

    function showModal() {
        if (document.getElementById('pwa-install-modal')) return;
        const overlay = document.createElement('div');
        overlay.id = 'pwa-install-modal';
        const card = document.createElement('div');
        card.className = 'pwa-modal-card';
        let html = '<h3>📱 Funk Taxi App installieren</h3>';

        if (isIOS) {
            html += '<div class="pwa-step">1. Tipp unten in der Symbolleiste auf <strong>Teilen ↑</strong> (Quadrat mit Pfeil)</div>';
            html += '<div class="pwa-step">2. Scrolle in der Liste nach unten — falls <strong>"Zum Home-Bildschirm"</strong> nicht sichtbar ist: tipp auf <strong>"Mehr anzeigen"</strong> (Pfeil ▼) ganz unten</div>';
            html += '<div class="pwa-step">3. Tipp auf <strong>"Zum Home-Bildschirm"</strong></div>';
            html += '<div class="pwa-step">4. Oben rechts auf <strong>"Hinzufügen"</strong> tippen — fertig!</div>';
            html += '<div class="pwa-step" style="background:#fef3c7;color:#92400e;">💡 Funktioniert nur in <strong>Safari</strong>, nicht im Chrome auf iPhone.</div>';
        } else if (isAndroid && isFirefox) {
            html += '<div class="pwa-step">1. Tipp oben rechts auf das <strong>Menü</strong> (3 Punkte)</div>';
            html += '<div class="pwa-step">2. Wähle <strong>"Installieren"</strong> oder <strong>"Zur Startseite hinzufügen"</strong></div>';
            html += '<div class="pwa-step">3. Bestätige mit <strong>"Hinzufügen"</strong> — fertig!</div>';
        } else if (isAndroid) {
            // Chrome/Edge/Samsung ohne beforeinstallprompt → Modal
            html += '<div class="pwa-step">1. Tipp oben rechts auf das <strong>Menü</strong> (3 Punkte)</div>';
            html += '<div class="pwa-step">2. Wähle <strong>"App installieren"</strong> oder <strong>"Zur Startseite hinzufügen"</strong></div>';
            html += '<div class="pwa-step">3. Bestätige mit <strong>"Installieren"</strong> — fertig!</div>';
            html += '<div class="pwa-step" style="background:#fef3c7;color:#92400e;">💡 Falls der Knopf nicht erscheint: Browser kennt diese Webseite vielleicht noch nicht gut genug — einfach 2-3 mal besuchen, dann erscheint die Install-Option automatisch.</div>';
        } else {
            html += '<div class="pwa-step">Diese App ist für <strong>Smartphones</strong> gedacht.</div>';
            html += '<div class="pwa-step">📱 Bitte rufe diese Seite mit deinem <strong>Handy</strong> auf (iPhone/Android) — dann erscheint dort die Installations-Anleitung.</div>';
        }
        // 🆕 v6.62.629: 2 Buttons — "Verstanden" (Modal zu, Button bleibt) und
        // "Schon installiert / nicht mehr fragen" (30 Tage Cooldown + Button weg)
        html += '<div style="display:flex;flex-direction:column;gap:8px;margin-top:14px;">';
        html += '<button class="pwa-close" type="button">Verstanden — ich versuche es</button>';
        html += '<button class="pwa-dismiss" type="button" style="width:100%;padding:14px;background:#e2e8f0;color:#475569;border:none;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;">Nicht mehr fragen / schon installiert</button>';
        html += '</div>';
        card.innerHTML = html;
        overlay.appendChild(card);
        document.body.appendChild(overlay);
        card.querySelector('.pwa-close').addEventListener('click', function() { overlay.remove(); });
        card.querySelector('.pwa-dismiss').addEventListener('click', function() {
            lsSet(LS_KEY_DISMISSED, String(Date.now() + DISMISS_COOLDOWN_MS));
            const btn = document.getElementById('pwa-install-btn');
            if (btn) btn.style.display = 'none';
            overlay.remove();
        });
        overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
    }

    // Init: Button erscheint nur wenn nicht installiert / nicht dismissed.
    window.addEventListener('load', function() {
        setTimeout(function() {
            if (isStandalone() || buttonInjected) return;
            // 🆕 v6.62.629: Throttle — installiert (jemals) oder kuerzlich dismissed → kein Button
            const skip = alreadyInstalledOrDismissed();
            if (skip) {
                console.log('PWA-Install Button uebersprungen:', skip);
                return;
            }
            injectStyle();
            injectButton();
            buttonInjected = true;
        }, 1500);
    });

})();
