// ═══════════════════════════════════════════════════════════════════════════
// 🎛️ DRIVER SETTINGS MANAGER - v5.24.0
// Pro-Fahrer Einstellungen für Screen-Aus, Power-Modi, etc.
// ═══════════════════════════════════════════════════════════════════════════

const DriverSettingsManager = {
    currentSettings: null,
    
    // Default-Einstellungen für neue Fahrer
    DEFAULT_SETTINGS: {
        screenOffMethod: 'triple-tap',      // triple-tap, two-buttons, long-press, four-corners, disabled
        defaultPowerMode: 'eco',             // normal, eco, power-save
        darkMode: 'auto',                    // auto, always-on, always-off
        vibrationEnabled: true,
        gpsInterval: 10,
        createdAt: Date.now(),
        updatedAt: Date.now()
    },
    
    // Initialisierung
    init: async function(vehicleId) {
        console.log('🎛️ Lade Fahrer-Einstellungen für:', vehicleId);
        
        if (!isFirebaseReady || !vehicleId) {
            console.log('⚠️ Firebase nicht bereit oder keine Vehicle-ID');
            this.currentSettings = {...this.DEFAULT_SETTINGS};
            this.applySettings();
            return;
        }
        
        try {
            // Lade Einstellungen aus Firebase
            const snapshot = await db.ref(`drivers/${vehicleId}/settings`).once('value');
            const settings = snapshot.val();
            
            if (settings) {
                console.log('✅ Einstellungen geladen:', settings);
                this.currentSettings = settings;
            } else {
                console.log('📝 Keine Einstellungen gefunden - erstelle Defaults');
                this.currentSettings = {...this.DEFAULT_SETTINGS};
                // Speichere Defaults in Firebase
                await db.ref(`drivers/${vehicleId}/settings`).set(this.currentSettings);
            }
            
            // Wende Einstellungen an
            this.applySettings();
            
            // Aktiviere Screen-Aus Geste
            this.activateScreenOffGesture();
            
        } catch (error) {
            console.error('❌ Fehler beim Laden der Einstellungen:', error);
            this.currentSettings = {...this.DEFAULT_SETTINGS};
            this.applySettings();
        }
    },
    
    // Wende Einstellungen an
    applySettings: function() {
        const settings = this.currentSettings;
        
        // Power-Save Modus
        if (settings.defaultPowerMode && window.PowerSaveManager) {
            PowerSaveManager.setMode(settings.defaultPowerMode.toUpperCase(), 'settings');
        }
        
        // Dark Mode
        if (settings.darkMode === 'always-on' && PowerSaveManager) {
            PowerSaveManager.enableDarkMode();
        } else if (settings.darkMode === 'always-off' && PowerSaveManager) {
            PowerSaveManager.disableDarkMode();
        }
        
        // GPS-Intervall
        if (settings.gpsInterval) {
            window.currentGPSInterval = settings.gpsInterval;
        }
        
        console.log('✅ Einstellungen angewendet:', settings);
    },
    
    // Speichere Einstellungen in Firebase
    saveSettings: async function(newSettings) {
        if (!isFirebaseReady || !currentVehicle) {
            console.error('❌ Kann nicht speichern - Firebase nicht bereit oder kein Fahrzeug');
            return false;
        }
        
        try {
            // Update Timestamp
            newSettings.updatedAt = Date.now();
            
            // Speichere in Firebase
            await db.ref(`drivers/${currentVehicle}/settings`).update(newSettings);
            
            // Update lokal
            this.currentSettings = {...this.currentSettings, ...newSettings};
            
            // Wende an
            this.applySettings();
            
            // Aktiviere neue Screen-Aus Geste
            this.activateScreenOffGesture();
            
            console.log('✅ Einstellungen gespeichert für:', currentVehicle);
            return true;
            
        } catch (error) {
            console.error('❌ Fehler beim Speichern:', error);
            return false;
        }
    },
    
    // ═══════════════════════════════════════════════════════════════════════
    // 📱 SCREEN-AUS GESTEN
    // ═══════════════════════════════════════════════════════════════════════
    
    activateScreenOffGesture: function() {
        const method = this.currentSettings?.screenOffMethod || 'disabled';
        
        console.log('🎯 Aktiviere Screen-Aus Methode:', method);
        
        // Deaktiviere alle bestehenden Listener
        this.deactivateAllGestures();
        
        // Aktiviere gewählte Methode
        switch(method) {
            case 'triple-tap':
                this.activateTripleTap();
                break;
            case 'two-buttons':
                this.activateTwoButtons();
                break;
            case 'long-press':
                this.activateLongPress();
                break;
            case 'four-corners':
                this.activateFourCorners();
                break;
            case 'disabled':
                console.log('📵 Screen-Aus deaktiviert');
                break;
            default:
                console.log('⚠️ Unbekannte Methode:', method);
        }
    },
    
    deactivateAllGestures: function() {
        // Entferne alle Event Listener
        // (Werden neu hinzugefügt je nach Methode)
        if (this._gestureListeners) {
            this._gestureListeners.forEach(({element, event, handler}) => {
                element.removeEventListener(event, handler);
            });
        }
        this._gestureListeners = [];
    },
    
    // ─────────────────────────────────────────────────────────────────────
    // METHODE 1: TRIPLE-TAP (3x auf Batterie tippen)
    // ─────────────────────────────────────────────────────────────────────
    activateTripleTap: function() {
        const batteryDisplay = document.getElementById('battery-display');
        if (!batteryDisplay) return;
        
        let tapCount = 0;
        let tapTimer = null;
        
        const handleTap = () => {
            tapCount++;
            
            // Vibration Feedback
            if (this.currentSettings?.vibrationEnabled && navigator.vibrate) {
                navigator.vibrate(50);
            }
            
            console.log(`👆 Tap ${tapCount}/3`);
            
            if (tapCount === 3) {
                // ERKANNT!
                console.log('✅ Triple-Tap erkannt!');
                this.showScreenOffConfirmation();
                tapCount = 0;
            }
            
            // Reset nach 1 Sekunde
            clearTimeout(tapTimer);
            tapTimer = setTimeout(() => {
                tapCount = 0;
            }, 1000);
        };
        
        batteryDisplay.addEventListener('click', handleTap);
        this._gestureListeners.push({
            element: batteryDisplay,
            event: 'click',
            handler: handleTap
        });
        
        console.log('✅ Triple-Tap aktiviert (3x auf 🔋)');
    },
    
    // ─────────────────────────────────────────────────────────────────────
    // METHODE 2: ZWEI BUTTONS GLEICHZEITIG (🔋 + 💤)
    // ─────────────────────────────────────────────────────────────────────
    activateTwoButtons: function() {
        const batteryBtn = document.getElementById('battery-display');
        const powerBtn = document.getElementById('power-save-btn');
        
        if (!batteryBtn || !powerBtn) return;
        
        let batteryTouched = false;
        let powerTouched = false;
        
        const checkCombo = () => {
            if (batteryTouched && powerTouched) {
                console.log('✅ Zwei-Button-Kombo erkannt!');
                
                // Vibration
                if (this.currentSettings?.vibrationEnabled && navigator.vibrate) {
                    navigator.vibrate(200);
                }
                
                this.showScreenOffConfirmation();
                
                // Reset
                batteryTouched = false;
                powerTouched = false;
            }
        };
        
        const batteryTouchStart = () => {
            batteryTouched = true;
            checkCombo();
        };
        
        const powerTouchStart = () => {
            powerTouched = true;
            checkCombo();
        };
        
        const resetTouch = () => {
            batteryTouched = false;
            powerTouched = false;
        };
        
        batteryBtn.addEventListener('touchstart', batteryTouchStart);
        powerBtn.addEventListener('touchstart', powerTouchStart);
        document.addEventListener('touchend', resetTouch);
        
        this._gestureListeners.push(
            {element: batteryBtn, event: 'touchstart', handler: batteryTouchStart},
            {element: powerBtn, event: 'touchstart', handler: powerTouchStart},
            {element: document, event: 'touchend', handler: resetTouch}
        );
        
        console.log('✅ Zwei-Button aktiviert (🔋 + 💤 gleichzeitig)');
    },
    
    // ─────────────────────────────────────────────────────────────────────
    // METHODE 3: LANGE DRÜCKEN (💤 3 Sekunden halten)
    // ─────────────────────────────────────────────────────────────────────
    activateLongPress: function() {
        const powerBtn = document.getElementById('power-save-btn');
        if (!powerBtn) return;
        
        let pressTimer = null;
        let progressBar = null;
        
        const startPress = () => {
            console.log('⏱️ Lange drücken gestartet');
            
            // Zeige Progress Bar
            progressBar = document.createElement('div');
            progressBar.style.cssText = `
                position: fixed;
                bottom: 20px;
                left: 50%;
                transform: translateX(-50%);
                width: 200px;
                height: 6px;
                background: rgba(255,255,255,0.3);
                border-radius: 3px;
                overflow: hidden;
                z-index: 9999;
            `;
            progressBar.innerHTML = `
                <div style="
                    height: 100%;
                    background: #f59e0b;
                    width: 0%;
                    transition: width 3s linear;
                "></div>
            `;
            document.body.appendChild(progressBar);
            
            // Animiere
            setTimeout(() => {
                progressBar.querySelector('div').style.width = '100%';
            }, 10);
            
            // Nach 3 Sekunden
            pressTimer = setTimeout(() => {
                console.log('✅ Lange drücken erkannt!');
                if (progressBar) progressBar.remove();
                
                // Vibration
                if (this.currentSettings?.vibrationEnabled && navigator.vibrate) {
                    navigator.vibrate([100, 50, 100]);
                }
                
                this.showScreenOffConfirmation();
            }, 3000);
        };
        
        const endPress = () => {
            clearTimeout(pressTimer);
            if (progressBar) progressBar.remove();
        };
        
        powerBtn.addEventListener('touchstart', startPress);
        powerBtn.addEventListener('touchend', endPress);
        
        this._gestureListeners.push(
            {element: powerBtn, event: 'touchstart', handler: startPress},
            {element: powerBtn, event: 'touchend', handler: endPress}
        );
        
        console.log('✅ Lange-Drücken aktiviert (💤 3 Sek halten)');
    },
    
    // ─────────────────────────────────────────────────────────────────────
    // METHODE 4: 4-ECKEN-TOUCH
    // ─────────────────────────────────────────────────────────────────────
    activateFourCorners: function() {
        const corners = [];
        let cornerTimer = null;
        
        const handleTouch = (e) => {
            const touch = e.touches[0];
            const x = touch.clientX;
            const y = touch.clientY;
            const w = window.innerWidth;
            const h = window.innerHeight;
            
            // Definiere Ecken (50px Radius)
            const isTopLeft = x < 50 && y < 50;
            const isTopRight = x > w - 50 && y < 50;
            const isBottomRight = x > w - 50 && y > h - 50;
            const isBottomLeft = x < 50 && y > h - 50;
            
            if (isTopLeft || isTopRight || isBottomRight || isBottomLeft) {
                const corner = isTopLeft ? 'TL' : isTopRight ? 'TR' : isBottomRight ? 'BR' : 'BL';
                
                if (!corners.includes(corner)) {
                    corners.push(corner);
                    console.log(`🎯 Ecke berührt (${corners.length}/4):`, corner);
                    
                    // Vibration
                    if (navigator.vibrate) navigator.vibrate(30);
                }
                
                // Alle 4 Ecken?
                if (corners.length === 4) {
                    console.log('✅ 4-Ecken erkannt!');
                    this.showScreenOffConfirmation();
                    corners.length = 0;
                }
                
                // Reset nach 3 Sekunden
                clearTimeout(cornerTimer);
                cornerTimer = setTimeout(() => {
                    corners.length = 0;
                }, 3000);
            }
        };
        
        document.addEventListener('touchstart', handleTouch);
        this._gestureListeners.push({
            element: document,
            event: 'touchstart',
            handler: handleTouch
        });
        
        console.log('✅ 4-Ecken aktiviert (alle 4 Ecken antippen)');
    },
    
    // ═══════════════════════════════════════════════════════════════════════
    // 💬 BESTÄTIGUNGS-DIALOG
    // ═══════════════════════════════════════════════════════════════════════
    
    showScreenOffConfirmation: function() {
        // Entferne alten Dialog falls vorhanden
        const oldDialog = document.getElementById('screen-off-confirmation');
        if (oldDialog) oldDialog.remove();
        
        const dialog = document.createElement('div');
        dialog.id = 'screen-off-confirmation';
        dialog.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.8);
            z-index: 99999;
            display: flex;
            align-items: center;
            justify-content: center;
        `;
        
        dialog.innerHTML = `
            <div style="
                background: white;
                border-radius: 16px;
                padding: 24px;
                max-width: 320px;
                text-align: center;
                box-shadow: 0 8px 24px rgba(0,0,0,0.3);
            ">
                <div style="font-size: 48px; margin-bottom: 16px;">⚠️</div>
                <h2 style="margin: 0 0 12px 0; font-size: 20px; color: #1f2937;">
                    Screen ausschalten?
                </h2>
                <div style="font-size: 14px; color: #6b7280; margin-bottom: 20px; line-height: 1.6;">
                    Im Hintergrund läuft weiter:<br>
                    ✅ GPS-Tracking<br>
                    ✅ Position-Updates<br>
                    ✅ Neue Aufträge (Vibration)
                    <br><br>
                    <strong>👆 Button unten zum Aufwecken</strong>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                    <button onclick="DriverSettingsManager.cancelScreenOff()" style="
                        padding: 14px;
                        background: #f3f4f6;
                        border: 2px solid #d1d5db;
                        border-radius: 10px;
                        font-size: 15px;
                        font-weight: 600;
                        color: #374151;
                        cursor: pointer;
                    ">❌ Abbrechen</button>
                    <button onclick="DriverSettingsManager.confirmScreenOff()" style="
                        padding: 14px;
                        background: #ef4444;
                        border: none;
                        border-radius: 10px;
                        font-size: 15px;
                        font-weight: 600;
                        color: white;
                        cursor: pointer;
                    ">✅ Ausschalten</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(dialog);
    },
    
    cancelScreenOff: function() {
        const dialog = document.getElementById('screen-off-confirmation');
        if (dialog) dialog.remove();
        console.log('❌ Screen-Aus abgebrochen');
    },
    
    confirmScreenOff: function() {
        console.log('✅ Screen wird ausgeschaltet');
        
        // Entferne Dialog
        const dialog = document.getElementById('screen-off-confirmation');
        if (dialog) dialog.remove();
        
        // 🔒 IMMERSIVE MODE - Vollbild aktivieren
        const enterFullscreen = () => {
            const elem = document.documentElement;
            if (elem.requestFullscreen) {
                elem.requestFullscreen().catch(err => console.log('Fullscreen nicht möglich:', err));
            } else if (elem.webkitRequestFullscreen) {
                elem.webkitRequestFullscreen();
            }
        };
        enterFullscreen();
        
        // Screen komplett schwarz
        const blackScreen = document.createElement('div');
        blackScreen.id = 'black-screen';
        blackScreen.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: #000;
            z-index: 999999;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
        `;
        
        blackScreen.innerHTML = `
            <div style="
                color: #222;
                text-align: center;
                font-size: 12px;
                padding: 20px;
                flex: 1;
                display: flex;
                align-items: center;
                pointer-events: none;
            ">
                📍 GPS aktiv...
            </div>
            
            <!-- Wake-Up Zone - NUR dieser Button weckt auf -->
            <div id="wake-up-zone" style="
                width: 200px;
                height: 60px;
                background: rgba(255,255,255,0.1);
                border: 2px solid rgba(255,255,255,0.3);
                border-radius: 30px;
                display: flex;
                align-items: center;
                justify-content: center;
                margin-bottom: 50px;
                cursor: pointer;
            ">
                <span style="color: rgba(255,255,255,0.5); font-size: 14px;">
                    👆 Aufwecken
                </span>
            </div>
        `;
        
        document.body.appendChild(blackScreen);
        
        // Wake-Up Funktion
        const wakeUp = () => {
            // Entferne Visibility-Listener
            document.removeEventListener('visibilitychange', onVisibilityChange);
            
            // Beende Fullscreen
            if (document.exitFullscreen) {
                document.exitFullscreen().catch(() => {});
            } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            }
            
            blackScreen.remove();
            console.log('✅ Screen aufgeweckt');
            if (navigator.vibrate) navigator.vibrate(50);
        };
        
        // NUR der Wake-Up Button reagiert auf Touch
        const wakeZone = document.getElementById('wake-up-zone');
        wakeZone.addEventListener('touchstart', (e) => {
            e.stopPropagation();
            wakeUp();
        });
        
        // 🔋 POWER BUTTON PROTECTION
        // Wenn User Power drückt und zurückkommt → schwarzer Screen bleibt!
        const onVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                console.log('📱 App wieder sichtbar - schwarzer Screen bleibt aktiv');
                
                // Fullscreen erneut aktivieren (falls verloren)
                setTimeout(() => {
                    if (document.getElementById('black-screen')) {
                        enterFullscreen();
                    }
                }, 100);
                
                // Wake Lock reaktivieren
                if (typeof requestWakeLock === 'function') {
                    requestWakeLock();
                }
            }
        };
        
        document.addEventListener('visibilitychange', onVisibilityChange);
        
        // GPS läuft weiter!
        // Wake Lock bleibt aktiv!
        // Neue Aufträge kommen an (Vibration)
        console.log('🔒 Sleep-Mode aktiv - Power-Button wird abgefangen');
    },
    
    // ═══════════════════════════════════════════════════════════════════════
    // ⚙️ EINSTELLUNGEN-DIALOG
    // ═══════════════════════════════════════════════════════════════════════
    
    showSettingsDialog: function() {
        const settings = this.currentSettings || this.DEFAULT_SETTINGS;
        
        const dialog = document.createElement('div');
        dialog.id = 'driver-settings-dialog';
        dialog.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.7);
            z-index: 99998;
            overflow-y: auto;
            padding: 20px;
        `;
        
        dialog.innerHTML = `
            <div style="
                background: white;
                border-radius: 16px;
                max-width: 500px;
                margin: 0 auto;
                padding: 20px;
            ">
                <h2 style="margin: 0 0 8px 0; font-size: 20px;">⚙️ Einstellungen</h2>
                <div style="font-size: 13px; color: #6b7280; margin-bottom: 20px;">
                    Fahrer: ${currentVehicle || 'Nicht eingeloggt'}
                </div>
                
                <!-- Screen-Aus Methode -->
                <div style="margin-bottom: 24px;">
                    <div style="font-weight: 600; font-size: 15px; margin-bottom: 12px;">
                        🎯 Screen-Aus Methode
                    </div>
                    
                    <label style="display: block; padding: 12px; background: #f9fafb; border-radius: 8px; margin-bottom: 8px; cursor: pointer;">
                        <input type="radio" name="screenOffMethod" value="triple-tap" ${settings.screenOffMethod === 'triple-tap' ? 'checked' : ''}>
                        <strong>Triple-Tap</strong><br>
                        <small style="color: #6b7280;">3x schnell auf 🔋 Batterie tippen</small><br>
                        <small style="color: #10b981;">✅ Sehr einfach • ✅ Eine Hand</small>
                    </label>
                    
                    <label style="display: block; padding: 12px; background: #f9fafb; border-radius: 8px; margin-bottom: 8px; cursor: pointer;">
                        <input type="radio" name="screenOffMethod" value="two-buttons" ${settings.screenOffMethod === 'two-buttons' ? 'checked' : ''}>
                        <strong>Zwei Buttons gleichzeitig</strong><br>
                        <small style="color: #6b7280;">🔋 Batterie + 💤 Power-Save zusammen</small><br>
                        <small style="color: #10b981;">✅ Sicher • ✅ Empfohlen für Fahrt</small>
                    </label>
                    
                    <label style="display: block; padding: 12px; background: #f9fafb; border-radius: 8px; margin-bottom: 8px; cursor: pointer;">
                        <input type="radio" name="screenOffMethod" value="long-press" ${settings.screenOffMethod === 'long-press' ? 'checked' : ''}>
                        <strong>Lange Drücken (3 Sek)</strong><br>
                        <small style="color: #6b7280;">💤 Power-Save Button 3 Sekunden halten</small><br>
                        <small style="color: #f59e0b;">⚠️ Nicht zu lange (Handy-Power!)</small>
                    </label>
                    
                    <label style="display: block; padding: 12px; background: #f9fafb; border-radius: 8px; margin-bottom: 8px; cursor: pointer;">
                        <input type="radio" name="screenOffMethod" value="four-corners" ${settings.screenOffMethod === 'four-corners' ? 'checked' : ''}>
                        <strong>4-Ecken-Touch</strong><br>
                        <small style="color: #6b7280;">Alle 4 Screen-Ecken schnell antippen</small><br>
                        <small style="color: #10b981;">✅ Sehr sicher</small>
                    </label>
                    
                    <label style="display: block; padding: 12px; background: #f9fafb; border-radius: 8px; cursor: pointer;">
                        <input type="radio" name="screenOffMethod" value="disabled" ${settings.screenOffMethod === 'disabled' ? 'checked' : ''}>
                        <strong>Deaktiviert</strong><br>
                        <small style="color: #6b7280;">Screen-Aus Funktion ausschalten</small>
                    </label>
                </div>
                
                <!-- Power-Save Standard -->
                <div style="margin-bottom: 24px;">
                    <div style="font-weight: 600; font-size: 15px; margin-bottom: 12px;">
                        ⚡ Power-Save Standard
                    </div>
                    
                    <label style="display: block; padding: 10px; background: #f9fafb; border-radius: 8px; margin-bottom: 6px; cursor: pointer;">
                        <input type="radio" name="defaultPowerMode" value="normal" ${settings.defaultPowerMode === 'normal' ? 'checked' : ''}>
                        <strong>☀️ Normal</strong>
                        <small style="color: #6b7280;">(100% Screen, 10m GPS)</small>
                    </label>
                    
                    <label style="display: block; padding: 10px; background: #f9fafb; border-radius: 8px; margin-bottom: 6px; cursor: pointer;">
                        <input type="radio" name="defaultPowerMode" value="eco" ${settings.defaultPowerMode === 'eco' ? 'checked' : ''}>
                        <strong>🌤️ Eco</strong>
                        <small style="color: #6b7280;">(60% Screen, 30m GPS)</small>
                    </label>
                    
                    <label style="display: block; padding: 10px; background: #f9fafb; border-radius: 8px; cursor: pointer;">
                        <input type="radio" name="defaultPowerMode" value="power-save" ${settings.defaultPowerMode === 'power-save' ? 'checked' : ''}>
                        <strong>💤 Power-Save</strong>
                        <small style="color: #6b7280;">(10% Screen, 50m GPS)</small>
                    </label>
                </div>
                
                <!-- Dark Mode -->
                <div style="margin-bottom: 24px;">
                    <div style="font-weight: 600; font-size: 15px; margin-bottom: 12px;">
                        🌙 Dark Mode
                    </div>
                    
                    <label style="display: block; padding: 10px; background: #f9fafb; border-radius: 8px; margin-bottom: 6px; cursor: pointer;">
                        <input type="radio" name="darkMode" value="auto" ${settings.darkMode === 'auto' ? 'checked' : ''}>
                        <strong>Auto</strong>
                        <small style="color: #6b7280;">(bei Power-Save)</small>
                    </label>
                    
                    <label style="display: block; padding: 10px; background: #f9fafb; border-radius: 8px; margin-bottom: 6px; cursor: pointer;">
                        <input type="radio" name="darkMode" value="always-on" ${settings.darkMode === 'always-on' ? 'checked' : ''}>
                        <strong>Immer An</strong>
                    </label>
                    
                    <label style="display: block; padding: 10px; background: #f9fafb; border-radius: 8px; cursor: pointer;">
                        <input type="radio" name="darkMode" value="always-off" ${settings.darkMode === 'always-off' ? 'checked' : ''}>
                        <strong>Immer Aus</strong>
                    </label>
                </div>
                
                <!-- Vibration -->
                <div style="margin-bottom: 24px;">
                    <label style="display: flex; align-items: center; gap: 10px; padding: 10px; background: #f9fafb; border-radius: 8px; cursor: pointer;">
                        <input type="checkbox" id="vibrationEnabled" ${settings.vibrationEnabled ? 'checked' : ''} style="width: 20px; height: 20px;">
                        <div>
                            <div style="font-weight: 600;">📳 Vibration</div>
                            <small style="color: #6b7280;">Bei Gesten-Erkennung & neuen Aufträgen</small>
                        </div>
                    </label>
                </div>
                
                <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
                
                <!-- Test Button -->
                <button onclick="DriverSettingsManager.testScreenOffMethod()" style="
                    width: 100%;
                    padding: 14px;
                    background: #f3f4f6;
                    border: 2px solid #d1d5db;
                    border-radius: 10px;
                    font-size: 15px;
                    font-weight: 600;
                    color: #374151;
                    cursor: pointer;
                    margin-bottom: 12px;
                ">
                    🧪 Aktuelle Methode testen
                </button>
                
                <!-- Buttons -->
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                    <button onclick="DriverSettingsManager.closeSettingsDialog()" style="
                        padding: 14px;
                        background: #f3f4f6;
                        border: 2px solid #d1d5db;
                        border-radius: 10px;
                        font-size: 15px;
                        font-weight: 600;
                        color: #374151;
                        cursor: pointer;
                    ">❌ Abbrechen</button>
                    <button onclick="DriverSettingsManager.saveSettingsFromDialog()" style="
                        padding: 14px;
                        background: #10b981;
                        border: none;
                        border-radius: 10px;
                        font-size: 15px;
                        font-weight: 600;
                        color: white;
                        cursor: pointer;
                    ">✅ Speichern</button>
                </div>
                
                <div style="margin-top: 12px; text-align: center; font-size: 12px; color: #6b7280;">
                    Wird gespeichert für: ${currentVehicle || 'Nicht eingeloggt'}
                </div>
            </div>
        `;
        
        document.body.appendChild(dialog);
    },
    
    closeSettingsDialog: function() {
        const dialog = document.getElementById('driver-settings-dialog');
        if (dialog) dialog.remove();
    },
    
    saveSettingsFromDialog: async function() {
        const newSettings = {
            screenOffMethod: document.querySelector('input[name="screenOffMethod"]:checked')?.value || 'triple-tap',
            defaultPowerMode: document.querySelector('input[name="defaultPowerMode"]:checked')?.value || 'eco',
            darkMode: document.querySelector('input[name="darkMode"]:checked')?.value || 'auto',
            vibrationEnabled: document.getElementById('vibrationEnabled')?.checked || true
        };
        
        const success = await this.saveSettings(newSettings);
        
        if (success) {
            alert('✅ Einstellungen gespeichert für ' + currentVehicle);
            this.closeSettingsDialog();
        } else {
            alert('❌ Fehler beim Speichern!');
        }
    },
    
    testScreenOffMethod: function() {
        this.closeSettingsDialog();
        
        alert('🧪 Probiere jetzt die gewählte Geste aus!\n\nScreen geht kurz aus (5 Sek Test)');
        
        // Test-Modus
        setTimeout(() => {
            this.showScreenOffConfirmation();
        }, 1000);
    }
};

console.log('✅ Driver Settings Manager geladen (v5.24.0)');
