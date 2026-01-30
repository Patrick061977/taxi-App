/**
 * 🔍 LOGGING INTEGRATION EXAMPLES
 *
 * Diese Datei zeigt, wie Sie das Advanced Logger System
 * in Ihre bestehenden Funktionen integrieren können.
 *
 * Kopieren Sie die Beispiele und passen Sie sie an Ihre Funktionen an.
 */

// ═══════════════════════════════════════════════════════════════════════════
// BEISPIEL 1: ROUTENBERECHNUNG MIT OSRM LOGGEN
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ORIGINAL FUNKTION (Beispiel):
 *
 * async function calculateRoute(pickup, destination) {
 *     const url = `https://router.project-osrm.org/route/v1/driving/${pickup.lng},${pickup.lat};${destination.lng},${destination.lat}?overview=full&geometries=geojson`;
 *     const response = await fetch(url);
 *     const data = await response.json();
 *     return data.routes[0];
 * }
 */

// MIT LOGGING:
async function calculateRoute_WithLogging(pickup, destination, rideId) {
    // Start Transaction für kompletten Ablauf
    const txnId = window.advancedLogger.startTransaction(
        'Route Calculation',
        LOG_CATEGORIES.ROUTE,
        { rideId, pickup, destination }
    );

    try {
        // Schritt 1: URL vorbereiten
        window.advancedLogger.logTransactionStep(txnId, 'Preparing OSRM URL');

        const url = `https://router.project-osrm.org/route/v1/driving/${pickup.lng},${pickup.lat};${destination.lng},${destination.lat}?overview=full&geometries=geojson`;

        // Schritt 2: API-Aufruf
        window.advancedLogger.logTransactionStep(txnId, 'Calling OSRM API', { url });

        const startTime = Date.now();
        const response = await fetch(url);
        const apiDuration = Date.now() - startTime;

        // Log API Call
        window.advancedLogger.logAPICall(
            url,
            'GET',
            response.status,
            apiDuration,
            { rideId }
        );

        // Schritt 3: Daten parsen
        window.advancedLogger.logTransactionStep(txnId, 'Parsing response');
        const data = await response.json();

        if (!data.routes || data.routes.length === 0) {
            throw new Error('Keine Route gefunden');
        }

        const route = data.routes[0];

        // Schritt 4: Ergebnis
        window.advancedLogger.logTransactionStep(txnId, 'Route calculated', {
            distance: route.distance,
            duration: route.duration,
            legs: route.legs?.length
        });

        // Transaction erfolgreich beenden
        window.advancedLogger.endTransaction(txnId, 'success', {
            distance: route.distance,
            duration: route.duration
        });

        // Spezial-Log für Routen
        window.advancedLogger.logRouteCalculation(
            `${pickup.lat}, ${pickup.lng}`,
            `${destination.lat}, ${destination.lng}`,
            { distance: route.distance, duration: route.duration },
            apiDuration,
            { rideId }
        );

        return route;

    } catch (error) {
        // Transaction mit Fehler beenden
        window.advancedLogger.endTransaction(txnId, 'error', {
            error: error.message
        });

        window.advancedLogger.error(LOG_CATEGORIES.ROUTE,
            `Route calculation failed: ${error.message}`,
            { rideId, pickup, destination, error: error.stack }
        );

        throw error;
    }
}


// ═══════════════════════════════════════════════════════════════════════════
// BEISPIEL 2: PREISBERECHNUNG LOGGEN
// ═══════════════════════════════════════════════════════════════════════════

async function calculateAIPrice_WithLogging() {
    const txnId = window.advancedLogger.startTransaction(
        'Price Calculation',
        LOG_CATEGORIES.BOOKING
    );

    try {
        const pickup = document.getElementById('ai-booking-pickup').value.trim();
        const destination = document.getElementById('ai-booking-destination').value.trim();

        window.advancedLogger.logTransactionStep(txnId, 'Input validation', {
            pickup,
            destination
        });

        if (!pickup || !destination) {
            throw new Error('Pickup oder Destination fehlt');
        }

        // Geocoding
        window.advancedLogger.logTransactionStep(txnId, 'Geocoding addresses');
        const pickupCoords = await geocodeAddress(pickup);
        const destCoords = await geocodeAddress(destination);

        // Routenberechnung
        window.advancedLogger.logTransactionStep(txnId, 'Calculating route');
        const route = await calculateRoute_WithLogging(pickupCoords, destCoords, null);

        // Preisberechnung
        window.advancedLogger.logTransactionStep(txnId, 'Calculating price', {
            distance: route.distance,
            duration: route.duration
        });

        const basePrice = 3.50;
        const pricePerKm = 2.20;
        const distance = route.distance / 1000; // in km
        const price = basePrice + (distance * pricePerKm);
        const finalPrice = Math.round(price * 100) / 100;

        window.advancedLogger.logTransactionStep(txnId, 'Price calculated', {
            basePrice,
            pricePerKm,
            distance,
            finalPrice
        });

        // Update UI
        document.getElementById('ai-booking-price').textContent = finalPrice + ' €';

        window.advancedLogger.endTransaction(txnId, 'success', {
            price: finalPrice,
            distance,
            duration: route.duration
        });

    } catch (error) {
        window.advancedLogger.endTransaction(txnId, 'error', {
            error: error.message
        });

        window.advancedLogger.error(LOG_CATEGORIES.BOOKING,
            `Price calculation failed: ${error.message}`,
            { error: error.stack }
        );
    }
}


// ═══════════════════════════════════════════════════════════════════════════
// BEISPIEL 3: BUCHUNGSABLAUF KOMPLETT LOGGEN
// ═══════════════════════════════════════════════════════════════════════════

async function book_WithLogging() {
    const txnId = window.advancedLogger.startTransaction(
        'Complete Booking Flow',
        LOG_CATEGORIES.BOOKING
    );

    try {
        // Schritt 1: Formulardaten sammeln
        window.advancedLogger.logTransactionStep(txnId, 'Collecting form data');

        const bookingData = {
            pickup: document.getElementById('pickup').value,
            destination: document.getElementById('destination').value,
            date: document.getElementById('booking-date').value,
            time: document.getElementById('booking-time').value,
            customerName: localStorage.getItem('loggedInUserName'),
            customerPhone: localStorage.getItem('loggedInPhone')
        };

        window.advancedLogger.debug(LOG_CATEGORIES.BOOKING,
            'Booking data collected',
            bookingData
        );

        // Schritt 2: Validation
        window.advancedLogger.logTransactionStep(txnId, 'Validating booking data');

        if (!bookingData.pickup || !bookingData.destination) {
            throw new Error('Pickup oder Destination fehlt');
        }

        // Schritt 3: Slot-Check
        window.advancedLogger.logTransactionStep(txnId, 'Checking availability');

        const slotCheckResult = await checkSlotAvailability(bookingData);

        window.advancedLogger.info(LOG_CATEGORIES.BOOKING,
            `Slot check result: ${slotCheckResult.available ? 'Available' : 'Conflict'}`,
            { slotCheckResult }
        );

        if (!slotCheckResult.available) {
            window.advancedLogger.warn(LOG_CATEGORIES.BOOKING,
                'Slot conflict detected',
                { slotCheckResult }
            );
            // Show alternatives...
        }

        // Schritt 4: Ride in Firebase speichern
        window.advancedLogger.logTransactionStep(txnId, 'Saving to Firebase');

        const dbStartTime = Date.now();
        const rideId = 'ride_' + Date.now();
        await db.ref(window.dbPrefix + 'rides/' + rideId).set(bookingData);
        const dbDuration = Date.now() - dbStartTime;

        window.advancedLogger.logDatabaseOperation(
            'SET',
            `rides/${rideId}`,
            bookingData,
            dbDuration,
            { rideId }
        );

        // Schritt 5: Fahrzeug zuweisen
        window.advancedLogger.logTransactionStep(txnId, 'Auto-assigning vehicle');

        const assignResult = await assignVehicleUnified(rideId, null, { auto: true });

        // Success!
        window.advancedLogger.endTransaction(txnId, 'success', {
            rideId,
            vehicleId: assignResult.vehicleId,
            price: bookingData.price
        });

        window.advancedLogger.logBooking(bookingData, {
            success: true,
            rideId,
            vehicleId: assignResult.vehicleId
        }, { transactionId: txnId });

        return { success: true, rideId };

    } catch (error) {
        window.advancedLogger.endTransaction(txnId, 'error', {
            error: error.message
        });

        window.advancedLogger.error(LOG_CATEGORIES.BOOKING,
            `Booking failed: ${error.message}`,
            { error: error.stack }
        );

        return { success: false, error: error.message };
    }
}


// ═══════════════════════════════════════════════════════════════════════════
// BEISPIEL 4: GPS-TRACKING LOGGEN
// ═══════════════════════════════════════════════════════════════════════════

function updateVehicleLocation_WithLogging(vehicleId, position) {
    // Performance Mark für GPS Update
    const markId = window.advancedLogger.startPerformanceMark('GPS Update');

    try {
        const location = {
            lat: position.coords.latitude,
            lng: position.coords.longitude
        };
        const accuracy = position.coords.accuracy;

        // Log GPS Update (DEBUG Level - wird viele Logs erzeugen)
        window.advancedLogger.logGPSUpdate(location, accuracy, {
            vehicleId,
            speed: position.coords.speed,
            heading: position.coords.heading,
            timestamp: position.timestamp
        });

        // Firebase Update
        db.ref(window.dbPrefix + `vehicles/${vehicleId}/location`).set(location);

        // Performance Mark beenden
        const duration = window.advancedLogger.endPerformanceMark(markId, {
            vehicleId,
            accuracy
        });

        // Warnung bei langsamer GPS-Verarbeitung
        if (duration > 1000) {
            window.advancedLogger.warn(LOG_CATEGORIES.GPS,
                `Slow GPS update: ${duration}ms`,
                { vehicleId, duration }
            );
        }

    } catch (error) {
        window.advancedLogger.error(LOG_CATEGORIES.GPS,
            `GPS update failed: ${error.message}`,
            { vehicleId, error: error.stack }
        );
    }
}


// ═══════════════════════════════════════════════════════════════════════════
// BEISPIEL 5: FIREBASE OPERATIONEN WRAPPEN
// ═══════════════════════════════════════════════════════════════════════════

// Original Firebase Calls mit automatischem Logging wrappen
function wrapFirebaseRef(originalRef) {
    return {
        set: async function(data) {
            const startTime = Date.now();
            const path = this.toString();

            try {
                const result = await originalRef.set(data);
                const duration = Date.now() - startTime;

                window.advancedLogger.logDatabaseOperation(
                    'SET',
                    path,
                    data,
                    duration
                );

                return result;
            } catch (error) {
                window.advancedLogger.error(LOG_CATEGORIES.DATABASE,
                    `Firebase SET failed: ${path}`,
                    { path, error: error.message }
                );
                throw error;
            }
        },

        update: async function(data) {
            const startTime = Date.now();
            const path = this.toString();

            try {
                const result = await originalRef.update(data);
                const duration = Date.now() - startTime;

                window.advancedLogger.logDatabaseOperation(
                    'UPDATE',
                    path,
                    data,
                    duration
                );

                return result;
            } catch (error) {
                window.advancedLogger.error(LOG_CATEGORIES.DATABASE,
                    `Firebase UPDATE failed: ${path}`,
                    { path, error: error.message }
                );
                throw error;
            }
        }

        // ... weitere Firebase-Methoden ...
    };
}


// ═══════════════════════════════════════════════════════════════════════════
// BEISPIEL 6: SLOT-CHECK MIT DETAILLIERTEM LOGGING
// ═══════════════════════════════════════════════════════════════════════════

async function triggerSlotCheck_WithLogging() {
    const txnId = window.advancedLogger.startTransaction(
        'Slot Availability Check',
        LOG_CATEGORIES.BOOKING
    );

    try {
        window.advancedLogger.logTransactionStep(txnId, 'Reading current bookings');

        const bookings = await db.ref(window.dbPrefix + 'rides').once('value');
        const allBookings = Object.values(bookings.val() || {});

        window.advancedLogger.logTransactionStep(txnId, 'Analyzing conflicts', {
            totalBookings: allBookings.length
        });

        const requestedTime = new Date(/* ... */);
        const conflicts = [];

        for (const booking of allBookings) {
            // Konflikt-Check Logik...
            if (/* conflict detected */) {
                conflicts.push(booking);

                window.advancedLogger.debug(LOG_CATEGORIES.BOOKING,
                    `Slot conflict detected with booking #${booking.id}`,
                    {
                        transactionId: txnId,
                        conflictingBooking: booking
                    }
                );
            }
        }

        const result = {
            available: conflicts.length === 0,
            conflicts: conflicts
        };

        window.advancedLogger.endTransaction(txnId, 'success', result);

        return result;

    } catch (error) {
        window.advancedLogger.endTransaction(txnId, 'error', {
            error: error.message
        });
        throw error;
    }
}


// ═══════════════════════════════════════════════════════════════════════════
// HELPER: LOGGING FÜR ALLE FETCH-CALLS AUTOMATISCH
// ═══════════════════════════════════════════════════════════════════════════

// Original fetch überschreiben für automatisches API-Logging
(function() {
    const originalFetch = window.fetch;

    window.fetch = async function(url, options = {}) {
        const method = options.method || 'GET';
        const startTime = Date.now();

        try {
            const response = await originalFetch(url, options);
            const duration = Date.now() - startTime;

            // Log nur externe APIs (nicht Firebase)
            if (typeof url === 'string' && !url.includes('firebaseio.com')) {
                window.advancedLogger.logAPICall(
                    url,
                    method,
                    response.status,
                    duration
                );
            }

            return response;
        } catch (error) {
            const duration = Date.now() - startTime;

            window.advancedLogger.error(LOG_CATEGORIES.NETWORK,
                `API call failed: ${method} ${url}`,
                { url, method, duration, error: error.message }
            );

            throw error;
        }
    };
})();


// ═══════════════════════════════════════════════════════════════════════════
// ANWENDUNGSBEISPIEL: INTEGRATION IN BESTEHENDE FUNKTIONEN
// ═══════════════════════════════════════════════════════════════════════════

/**
 * So fügen Sie Logging zu Ihren bestehenden Funktionen hinzu:
 *
 * 1. Für komplette Abläufe (Buchung, Route, etc.):
 *    - startTransaction() am Anfang
 *    - logTransactionStep() für jeden wichtigen Schritt
 *    - endTransaction() am Ende (success oder error)
 *
 * 2. Für einzelne Ereignisse:
 *    - Einfach logger.info/warn/error/debug verwenden
 *
 * 3. Für Performance-Messung:
 *    - startPerformanceMark() am Anfang
 *    - endPerformanceMark() am Ende
 *
 * 4. Für spezielle Events:
 *    - logRouteCalculation()
 *    - logBooking()
 *    - logGPSUpdate()
 *    - logDatabaseOperation()
 *    - logAPICall()
 */

console.log('📚 Logging Integration Examples loaded!');
console.log('👉 Kopieren Sie die Beispiele in Ihre Funktionen');
