// 🔧 v6.62.433: PWA-Install-Button NUR noch wenn Browser nativ installieren kann.
//   Patrick (08.05.2026): „Da sehe ich nicht durch und die Kunden auch — gestern hat
//   das wunderbar funktioniert, da habe ich drauf gedrückt auf App installieren und
//   da hat er die wunderbar installiert. Das installiert keiner."
//   Konsequenz: Modal mit Browser-Anleitung komplett raus. Button erscheint nur,
//   wenn `beforeinstallprompt` gefeuert hat (Chrome/Edge/Brave/Opera/Samsung).
//   Auf iOS/Firefox/Safari kein Button — der Browser bringt den Nutzer nicht ans Ziel.
// Wird auf kunden.html, buchen.html, landing.html, hotel.html eingebunden.

(function() {
    'use strict';

    let deferredPrompt = null;
    let buttonInjected = false;

    // beforeinstallprompt cachen (Chrome / Edge / Brave / Opera / Samsung).
    // Erst HIER wird der Button injiziert — auf Browsern ohne Event taucht er nie auf.
    window.addEventListener('beforeinstallprompt', function(e) {
        e.preventDefault();
        deferredPrompt = e;
        if (!buttonInjected && !isStandalone()) {
            injectStyle();
            injectButton();
            buttonInjected = true;
        }
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
        // Button existiert nur wenn deferredPrompt vorhanden ist — trotzdem doppelt absichern.
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
