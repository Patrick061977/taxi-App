// v6.62.610: PWA-Install-Button GROESSER + im Hero statt floating-bubble.
//   Patrick (11.05.): "plug and play muss alles sein, app installieren auch
//   ein bischen groesser, die Blase unten weg".
// Strategy:
//   - Wenn ein Element #pwa-install-anchor existiert → Button DA reinhaengen (im Hero, gross)
//   - Sonst Fallback: floating bottom-right (legacy fuer andere Seiten)
//
// Wird auf kunden.html, buchen.html, landing.html, hotel.html eingebunden.

(function() {
    'use strict';

    let deferredPrompt = null;
    let buttonInjected = false;

    window.addEventListener('beforeinstallprompt', function(e) {
        e.preventDefault();
        deferredPrompt = e;
        if (!buttonInjected && !isStandalone()) {
            injectStyle();
            injectButton();
            buttonInjected = true;
        }
    });

    window.addEventListener('appinstalled', function() {
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
        // Zwei Varianten: prominent (im Anchor) und floating (Fallback).
        style.textContent = `
            #pwa-install-btn {
                background: linear-gradient(135deg, #0f4c81, #1e6091);
                color: white; border: none; cursor: pointer;
                font-family: inherit; font-weight: 800;
                transition: transform 0.15s, box-shadow 0.2s, opacity 0.2s;
            }
            #pwa-install-btn:active { transform: scale(0.97); }
            #pwa-install-btn:hover { opacity: 0.92; }
            /* prominent (im hero-anchor) */
            #pwa-install-btn.prominent {
                display: flex; align-items: center; justify-content: center; gap: 10px;
                width: 100%; max-width: 400px; margin: 0 auto;
                padding: 18px 28px; font-size: 18px;
                border-radius: 14px;
                box-shadow: 0 8px 20px rgba(15, 76, 129, 0.45);
            }
            #pwa-install-btn.prominent .pwa-icon { font-size: 24px; }
            /* floating (Fallback fuer alte Seiten ohne Anchor) */
            #pwa-install-btn.floating {
                position: fixed; bottom: 14px; right: 14px;
                border-radius: 24px;
                padding: 10px 16px; font-size: 13px;
                box-shadow: 0 4px 14px rgba(0,0,0,0.28);
                z-index: 9999;
                display: flex; align-items: center; gap: 6px;
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
            // Prominent-Variante im Hero
            btn.className = 'prominent';
            btn.innerHTML = '<span class="pwa-icon">📱</span> Taxi-App installieren';
            btn.setAttribute('aria-label', 'Funk Taxi App auf Ihrem Gerät installieren');
            anchor.appendChild(btn);
        } else {
            // Fallback: Floating bottom-right (alte Seiten)
            btn.className = 'floating';
            btn.innerHTML = '<span style="font-size:15px;">📱</span> App installieren';
            btn.setAttribute('aria-label', 'App auf Ihrem Gerät installieren');
            document.body.appendChild(btn);
        }
        btn.addEventListener('click', handleInstallClick);
    }

    async function handleInstallClick() {
        if (!deferredPrompt) return;
        try {
            deferredPrompt.prompt();
            const choice = await deferredPrompt.userChoice;
            if (choice && choice.outcome === 'accepted') {
                const btn = document.getElementById('pwa-install-btn');
                if (btn) btn.style.display = 'none';
            }
        } catch (e) {
            console.warn('Install-Prompt fehlgeschlagen:', e);
        }
        deferredPrompt = null;
    }

})();
