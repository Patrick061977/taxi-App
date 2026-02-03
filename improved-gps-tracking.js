// ═══════════════════════════════════════════════════════════════════════════
// GPS BACKGROUND TRACKING - VERSION 7.1.0 mit KEEPALIVE SERVICE
// ═══════════════════════════════════════════════════════════════════════════

if (window.debugMode) {
    console.log('🔄 Lade improved-gps-tracking.js - VERSION 7.1.0 (mit KeepAlive)');
}

// Warte bis DOM geladen ist
document.addEventListener('DOMContentLoaded', function() {
    if (window.debugMode) {
        console.log('✅ DOM geladen - überschreibe GPS-Funktionen (v7.1.0)');
    }
    
    // Überschreibe startGPSTracking()
    window.startGPSTracking = async function() {
        console.log('═══════════════════════════════════════════════════════════');
        console.log('🚕 GPS-TRACKING STARTEN - VERSION 7.1.0');
        console.log('═══════════════════════════════════════════════════════════');
        
        const isNative = window.Capacitor && window.Capacitor.isNativePlatform();
        
        if (isNative) {
            console.log('✅ Native Android Plattform erkannt');
            await startNativeGPSTracking();
        } else {
            console.log('🌐 Web Plattform erkannt');
            startWebGPSTracking();
        }
    };
    
    // Überschreibe stopGPSTracking()
    window.stopGPSTracking = async function() {
        console.log('🛑 GPS-TRACKING STOPPEN');
        
        // Stoppe GPS Watcher
        if (window.gpsWatcherId) {
            const BackgroundGeolocation = window.Capacitor.Plugins.BackgroundGeolocation;
            if (BackgroundGeolocation) {
                await BackgroundGeolocation.removeWatcher({ id: window.gpsWatcherId });
                console.log('✅ GPS Watcher gestoppt');
            }
        }
        
        // Stoppe Keep-Alive
        if (window.keepAliveInterval) {
            clearInterval(window.keepAliveInterval);
            console.log('✅ Keep-Alive gestoppt');
        }
        
        // Stoppe KeepAlive Service
        if (window.KeepAliveService) {
            await window.KeepAliveService.stop();
            console.log('✅ KeepAlive Service gestoppt');
        }
    };
    
    if (window.debugMode) {
        console.log('✅ GPS-Funktionen erfolgreich überschrieben (v7.1.0)');
    }
});

// ═══════════════════════════════════════════════════════════════════════════
// NATIVE GPS TRACKING mit KEEPALIVE SERVICE
// ═══════════════════════════════════════════════════════════════════════════

async function startNativeGPSTracking() {
    try {
        if (window.debugMode) {
            console.log('─────────────────────────────────────────────────────────');
            console.log('SCHRITT 1: KeepAlive Foreground Service starten');
            console.log('─────────────────────────────────────────────────────────');
        }
        
        // WICHTIG: Starte KeepAlive Service ZUERST!
        if (window.KeepAliveService) {
            await window.KeepAliveService.start();
            console.log('✅ KeepAlive Service läuft');
            console.log('🔔 Permanente Benachrichtigung sollte JETZT sichtbar sein!');
        } else {
            console.warn('⚠️ KeepAlive Service nicht verfügbar - fahre trotzdem fort');
        }
        
        console.log('─────────────────────────────────────────────────────────');
        console.log('SCHRITT 2: BackgroundGeolocation GPS-Watcher starten');
        console.log('─────────────────────────────────────────────────────────');
        
        const BackgroundGeolocation = window.Capacitor.Plugins.BackgroundGeolocation;
        const uid = firebase.auth().currentUser.uid;
        
        console.log('📱 Starte BackgroundGeolocation.addWatcher()...');
        console.log('👤 User ID:', uid);
        
        // 🔋 Dynamisches GPS-Intervall basierend auf Power-Save Modus
        const gpsInterval = window.currentGPSInterval || 10;
        console.log(`📍 GPS-Intervall: ${gpsInterval}m (Power-Save: ${window.PowerSaveManager?.mode || 'NORMAL'})`);
        
        // Starte Background Geolocation Watcher
        const watcherId = await BackgroundGeolocation.addWatcher(
            {
                backgroundMessage: "🚕 GPS läuft im Hintergrund",
                backgroundTitle: "Funk Taxi Heringsdorf",
                requestPermissions: true,
                stale: false,
                distanceFilter: gpsInterval,
                backgroundMode: true
            },
            function callback(location, error) {
                if (error) {
                    if (error.code === "NOT_AUTHORIZED") {
                        console.error('❌ GPS-Berechtigung nicht erteilt!');
                        alert('GPS-Berechtigung fehlt! Bitte in Einstellungen "Immer erlauben" aktivieren.');
                    }
                    return console.error('❌ GPS-Error:', error);
                }
                
                if (location) {
                    // Throttling: Nur alle 5 Sekunden senden
                    const now = Date.now();
                    if (window._lastGPSUpdate && (now - window._lastGPSUpdate) < 5000) {
                        return; // Skip - zu früh
                    }
                    window._lastGPSUpdate = now;

                    // Nur bei Debug-Modus loggen
                    if (window.debugMode) {
                        console.log('📍 GPS-Update:', {
                            lat: location.latitude.toFixed(6),
                            lng: location.longitude.toFixed(6),
                            accuracy: Math.round(location.accuracy) + 'm',
                            time: new Date(location.time).toLocaleTimeString()
                        });
                    }

                    // Position zu Firebase senden mit Error-Handling
                    firebase.database().ref('drivers/' + uid + '/location').set({
                        latitude: location.latitude,
                        longitude: location.longitude,
                        accuracy: location.accuracy,
                        timestamp: firebase.database.ServerValue.TIMESTAMP
                    }).catch(error => {
                        console.error('❌ GPS Firebase-Fehler:', error.code);
                        if (typeof debugLog === 'function') {
                            debugLog('error', 'GPS: Firebase set failed: ' + error.code);
                        }
                    });
                }
            }
        );
        
        window.gpsWatcherId = watcherId;
        if (window.debugMode) {
            console.log('✅ GPS Watcher gestartet! ID:', watcherId);
            console.log('─────────────────────────────────────────────────────────');
            console.log('SCHRITT 3: Firebase Keep-Alive starten');
            console.log('─────────────────────────────────────────────────────────');
        }
        
        // Firebase Keep-Alive
        startFirebaseKeepAlive(uid);
        
        console.log('═══════════════════════════════════════════════════════════');
        console.log('🎉 GPS-TRACKING VOLLSTÄNDIG GESTARTET!');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('✅ KeepAlive Service: Läuft');
        console.log('✅ GPS Watcher: Aktiv');
        console.log('✅ Firebase Keep-Alive: Aktiv');
        console.log('🔔 Benachrichtigung: Sollte sichtbar sein!');
        console.log('═══════════════════════════════════════════════════════════');
        
    } catch (error) {
        console.error('❌ FEHLER beim Starten des GPS:', error);
        alert('GPS konnte nicht gestartet werden: ' + error.message);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// FIREBASE KEEP-ALIVE
// ═══════════════════════════════════════════════════════════════════════════

function startFirebaseKeepAlive(uid) {
    console.log('💓 Starte Firebase Keep-Alive (Heartbeat alle 30 Sek)');

    // Fehler-Tracking für Exponential Backoff
    let consecutiveErrors = 0;
    const maxRetries = 5;

    // Heartbeat alle 30 Sekunden
    window.keepAliveInterval = setInterval(() => {
        // Bei zu vielen Fehlern: Interval pausieren
        if (consecutiveErrors >= maxRetries) {
            if (window.debugMode) {
                console.warn('⚠️ Heartbeat: Zu viele Fehler, pausiere für 5 Minuten');
            }
            consecutiveErrors = 0;
            return;
        }

        firebase.database().ref('drivers/' + uid + '/heartbeat').set({
            timestamp: firebase.database.ServerValue.TIMESTAMP,
            status: 'online',
            version: '7.1.0',
            keepalive: true
        }).then(() => {
            consecutiveErrors = 0; // Reset bei Erfolg
            if (window.debugMode) {
                console.log('💓 Heartbeat gesendet');
            }
        }).catch(error => {
            consecutiveErrors++;
            const backoffTime = Math.min(1000 * Math.pow(2, consecutiveErrors), 60000);
            console.error(`❌ Heartbeat-Fehler #${consecutiveErrors}:`, error.code);

            if (typeof debugLog === 'function') {
                debugLog('error', `Heartbeat failed (${consecutiveErrors}/${maxRetries}): ${error.code}`);
            }

            // Bei Permission-Fehler: Interval komplett stoppen
            if (error.code === 'PERMISSION_DENIED') {
                console.error('🛑 PERMISSION_DENIED - Stoppe Heartbeat komplett');
                clearInterval(window.keepAliveInterval);
                if (typeof debugLog === 'function') {
                    debugLog('error', 'Heartbeat: PERMISSION_DENIED - Gestoppt');
                }
            }
        });
    }, 30000);
    
    // Überwache Firebase-Verbindung
    const connectedRef = firebase.database().ref('.info/connected');
    connectedRef.on('value', (snapshot) => {
        if (snapshot.val() === true) {
            if (window.debugMode) {
                console.log('✅ Firebase verbunden');
            }
        } else {
            console.warn('⚠️ Firebase-Verbindung verloren - versuche Reconnect...');
            if (typeof debugLog === 'function') {
                debugLog('warn', 'GPS Tracking: Firebase-Verbindung verloren - versuche Reconnect');
            }
            setTimeout(() => {
                firebase.database().goOnline();
                if (window.debugMode) {
                    console.log('🔄 Reconnect-Versuch gestartet');
                }
            }, 1000);
        }
    }, (error) => {
        console.error('❌ GPS Tracking: Firebase Verbindungs-Fehler:', error);

        // CRITICAL FIX: Bei PERMISSION_DENIED Listener stoppen um Endlosschleife zu vermeiden
        if (error.code === 'PERMISSION_DENIED') {
            console.error('🛑 PERMISSION_DENIED - Stoppe Connection-Listener um Endlosschleife zu vermeiden');
            connectedRef.off();
            if (typeof debugLog === 'function') {
                debugLog('error', 'GPS Tracking: PERMISSION_DENIED - Connection-Listener gestoppt');
            }
        }

        if (typeof debugLog === 'function') {
            debugLog('error', 'GPS Tracking: Firebase Verbindungs-Fehler: ' + error.message);
        }
        if (typeof logActivity === 'function') {
            logActivity('system', 'firebase_error', '❌ GPS Tracking Firebase Fehler: ' + error.message, { code: error.code });
        }
    });

    if (window.debugMode) {
        console.log('✅ Keep-Alive gestartet');
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// WEB GPS TRACKING (Fallback)
// ═══════════════════════════════════════════════════════════════════════════

function startWebGPSTracking() {
    if (window.debugMode) {
        console.log('🌐 Starte Web-GPS (Browser-Modus)');
    }
    
    if (!navigator.geolocation) {
        console.error('❌ Geolocation wird nicht unterstützt');
        return;
    }
    
    const uid = firebase.auth().currentUser.uid;
    
    window.gpsWatcherId = navigator.geolocation.watchPosition(
        function(position) {
            // Throttling: Nur alle 5 Sekunden senden
            const now = Date.now();
            if (window._lastGPSUpdate && (now - window._lastGPSUpdate) < 5000) {
                return; // Skip - zu früh
            }
            window._lastGPSUpdate = now;

            if (window.debugMode) {
                console.log('📍 GPS-Update (Web):', {
                    lat: position.coords.latitude.toFixed(6),
                    lng: position.coords.longitude.toFixed(6),
                    accuracy: Math.round(position.coords.accuracy) + 'm'
                });
            }

            firebase.database().ref('drivers/' + uid + '/location').set({
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
                accuracy: position.coords.accuracy,
                timestamp: firebase.database.ServerValue.TIMESTAMP
            }).catch(error => {
                console.error('❌ Web-GPS Firebase-Fehler:', error.code);
                if (typeof debugLog === 'function') {
                    debugLog('error', 'Web-GPS: Firebase set failed: ' + error.code);
                }
            });
        },
        function(error) {
            console.error('❌ GPS-Error:', error.message);
            if (typeof debugLog === 'function') {
                debugLog('error', 'Web-GPS Error: ' + error.message);
            }
        },
        {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0
        }
    );

    if (window.debugMode) {
        console.log('✅ Web-GPS gestartet');
    }
}

if (window.debugMode) {
    console.log('📦 improved-gps-tracking.js geladen (v7.1.0)');
}
