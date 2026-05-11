// v6.62.612: Universal "App installieren" — 1 Button, funktioniert ueberall.
//   Patrick (11.05. 13:23): "ich will was was ueberall funktioniert"
//
// Strategie: APK ist plug-and-play auf Android, daher universal nutzen.
//   - Android (jeder Browser): Klick → direkter APK-Download
//   - iOS: Klick → Modal mit "Teilen → Home-Bildschirm"-Anleitung
//   - Desktop: Klick → Modal "Diese App ist fuer Smartphones — bitte vom Handy aus aufrufen"
//
// Anchor #pwa-install-anchor → Button DA gross.
// Fallback: floating bottom-right.

(function() {
    'use strict';

    let buttonInjected = false;
    const UA = navigator.userAgent || '';
    const isIOS = /iPad|iPhone|iPod/.test(UA) && !window.MSStream;
    const isAndroid = /Android/.test(UA);
    const apkUrl = 'https://umwelt-taxi-insel-usedom.de/app/taxi-app-latest.apk';

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
            #pwa-install-modal .pwa-cta {
                display: block; margin-top: 8px; padding: 18px;
                background: #16a34a; color: white; text-decoration: none;
                border-radius: 12px; text-align: center; font-weight: 800; font-size: 18px;
                box-shadow: 0 6px 16px rgba(22,163,74,0.4);
            }
        `;
        document.head.appendChild(style);
    }

    function injectButton() {
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
        btn.addEventListener('click', handleClick);
        (anchor || document.body).appendChild(btn);
    }

    function handleClick() {
        if (isAndroid) {
            // Direkt APK runterladen — funktioniert in JEDEM Android-Browser
            window.location.href = apkUrl;
            return;
        }
        // iOS / Desktop: Anleitung
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
            html += '<div class="pwa-step">1. Tipp unten in der Symbolleiste auf <strong>Teilen ↑</strong></div>';
            html += '<div class="pwa-step">2. Scrolle und wähle <strong>"Zum Home-Bildschirm"</strong></div>';
            html += '<div class="pwa-step">3. Oben rechts auf <strong>"Hinzufügen"</strong> tippen</div>';
            html += '<div class="pwa-step" style="background:#fef3c7;color:#92400e;">💡 Funktioniert nur in <strong>Safari</strong>, nicht im Chrome auf iPhone.</div>';
        } else {
            // Desktop oder unbekanntes Geraet
            html += '<div class="pwa-step">Diese App ist für <strong>Smartphones</strong> gedacht.</div>';
            html += '<div class="pwa-step">📱 Bitte rufe diese Seite mit deinem <strong>Handy</strong> auf — dann erscheint hier ein Knopf zum 1-Klick-Installieren.</div>';
            html += '<div class="pwa-step">Direkter Android-Download:</div>';
            html += '<a class="pwa-cta" href="' + apkUrl + '">📥 Funk-Taxi.apk</a>';
        }
        html += '<button class="pwa-close" type="button">Verstanden</button>';
        card.innerHTML = html;
        overlay.appendChild(card);
        document.body.appendChild(overlay);
        card.querySelector('.pwa-close').addEventListener('click', function() { overlay.remove(); });
        overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
    }

    // Init: nur wenn nicht schon installiert
    window.addEventListener('load', function() {
        if (isStandalone() || buttonInjected) return;
        injectStyle();
        injectButton();
        buttonInjected = true;
    });

    // Wenn appinstalled feuert → Button weg
    window.addEventListener('appinstalled', function() {
        const btn = document.getElementById('pwa-install-btn');
        if (btn) btn.style.display = 'none';
    });

})();
