/**
 * 🔍 ADVANCED PERFORMANCE & TRANSACTION LOGGER
 * v1.0.0 - Comprehensive logging system for Taxi App
 *
 * Features:
 * - Transaction Tracing (track complete workflows from start to end)
 * - Performance Metrics (measure execution times)
 * - Context-based Logging (Ride-ID, User-ID, Vehicle-ID)
 * - Category-based Organization (GPS, Booking, Route, Payment, etc.)
 * - IndexedDB Storage (7 days retention)
 * - Advanced Search & Filtering
 * - Export functionality
 */

(function() {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════════════
    // CONFIGURATION
    // ═══════════════════════════════════════════════════════════════════════════

    const CONFIG = {
        DB_NAME: 'TaxiAppAdvancedLogs',
        DB_VERSION: 1,
        STORE_NAME: 'transactions',
        RETENTION_DAYS: 7,
        MAX_MEMORY_LOGS: 1000,
        AUTO_CLEANUP_INTERVAL: 3600000, // 1 hour
    };

    const LOG_LEVELS = {
        DEBUG: 0,
        INFO: 1,
        WARN: 2,
        ERROR: 3,
        CRITICAL: 4
    };

    const LOG_CATEGORIES = {
        SYSTEM: 'system',
        GPS: 'gps',
        ROUTE: 'route',
        BOOKING: 'booking',
        PAYMENT: 'payment',
        AUTH: 'auth',
        DATABASE: 'database',
        UI: 'ui',
        PERFORMANCE: 'performance',
        NETWORK: 'network'
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // LOGGER CLASS
    // ═══════════════════════════════════════════════════════════════════════════

    class AdvancedLogger {
        constructor() {
            this.db = null;
            this.memoryLogs = [];
            this.activeTransactions = new Map();
            this.performanceMarks = new Map();
            this.sessionId = this.generateSessionId();
            this.isReady = false;
            this.isLogging = false; // 🔒 Prevents infinite loops

            this.init();
        }

        generateSessionId() {
            return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        }

        generateTransactionId() {
            return `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        }

        async init() {
            try {
                await this.initDatabase();
                this.startAutoCleanup();
                this.isReady = true;
                console.log('✅ Advanced Logger initialized');
                console.log('📊 Session ID:', this.sessionId);
            } catch (error) {
                console.error('💾 Advanced Logger init failed:', error);
            }
        }

        // ═══════════════════════════════════════════════════════════════════════
        // DATABASE OPERATIONS
        // ═══════════════════════════════════════════════════════════════════════

        async initDatabase() {
            return new Promise((resolve, reject) => {
                const request = indexedDB.open(CONFIG.DB_NAME, CONFIG.DB_VERSION);

                request.onerror = () => reject(request.error);

                request.onsuccess = () => {
                    this.db = request.result;
                    console.log('✅ Advanced Logger DB opened');
                    resolve(this.db);
                };

                request.onupgradeneeded = (event) => {
                    const db = event.target.result;

                    if (!db.objectStoreNames.contains(CONFIG.STORE_NAME)) {
                        const store = db.createObjectStore(CONFIG.STORE_NAME, {
                            keyPath: 'id',
                            autoIncrement: true
                        });

                        // Indices for fast querying
                        store.createIndex('timestamp', 'timestamp', { unique: false });
                        store.createIndex('date', 'date', { unique: false });
                        store.createIndex('sessionId', 'sessionId', { unique: false });
                        store.createIndex('transactionId', 'transactionId', { unique: false });
                        store.createIndex('category', 'category', { unique: false });
                        store.createIndex('level', 'level', { unique: false });
                        store.createIndex('rideId', 'context.rideId', { unique: false });
                        store.createIndex('userId', 'context.userId', { unique: false });
                        store.createIndex('vehicleId', 'context.vehicleId', { unique: false });

                        console.log('✅ Advanced Logger Store created');
                    }
                };
            });
        }

        async saveLog(logEntry) {
            try {
                // Add to memory cache
                this.memoryLogs.push(logEntry);
                if (this.memoryLogs.length > CONFIG.MAX_MEMORY_LOGS) {
                    this.memoryLogs.shift();
                }

                // Save to IndexedDB
                if (this.db) {
                    const transaction = this.db.transaction([CONFIG.STORE_NAME], 'readwrite');
                    const store = transaction.objectStore(CONFIG.STORE_NAME);
                    store.add(logEntry);
                }

                // 🔒 FIREBASE SYNC DISABLED - Caused infinite loops
                // Firebase operations were being logged, which triggered more Firebase writes,
                // which triggered more logs, etc. = infinite loop
                // To re-enable: implement proper recursion detection or separate log queue

                /* DISABLED - Firebase Sync
                const shouldSyncToFirebase =
                    logEntry.level >= LOG_LEVELS.WARN ||
                    (logEntry.level === LOG_LEVELS.INFO &&
                     ['gps', 'route', 'booking', 'payment', 'auth', 'database'].includes(logEntry.category));

                if (shouldSyncToFirebase && typeof window !== 'undefined' && window.db && window.isFirebaseReady) {
                    try {
                        const firebaseEntry = {
                            timestamp: logEntry.timestamp,
                            date: logEntry.date,
                            sessionId: logEntry.sessionId,
                            level: logEntry.level,
                            levelName: logEntry.levelName,
                            category: logEntry.category,
                            message: logEntry.message,
                            context: logEntry.context,
                            transactionId: logEntry.transactionId
                        };

                        window.db.ref('advancedLogs').push(firebaseEntry).catch(() => {
                            // Ignoriere Firebase-Fehler um Loops zu vermeiden
                        });
                    } catch (e) {
                        // Ignoriere Fehler um Loops zu vermeiden
                    }
                }
                */
            } catch (error) {
                // Silent fail to prevent console spam
            }
        }

        async getLogs(filters = {}) {
            return new Promise((resolve, reject) => {
                if (!this.db) {
                    resolve(this.memoryLogs);
                    return;
                }

                const transaction = this.db.transaction([CONFIG.STORE_NAME], 'readonly');
                const store = transaction.objectStore(CONFIG.STORE_NAME);
                const request = store.getAll();

                request.onsuccess = () => {
                    let logs = request.result;

                    // Apply filters
                    if (filters.category) {
                        logs = logs.filter(l => l.category === filters.category);
                    }
                    if (filters.level !== undefined) {
                        logs = logs.filter(l => l.level >= filters.level);
                    }
                    if (filters.transactionId) {
                        logs = logs.filter(l => l.transactionId === filters.transactionId);
                    }
                    if (filters.rideId) {
                        logs = logs.filter(l => l.context?.rideId === filters.rideId);
                    }
                    if (filters.startDate) {
                        logs = logs.filter(l => new Date(l.timestamp) >= new Date(filters.startDate));
                    }
                    if (filters.endDate) {
                        logs = logs.filter(l => new Date(l.timestamp) <= new Date(filters.endDate));
                    }

                    resolve(logs);
                };

                request.onerror = () => reject(request.error);
            });
        }

        async cleanOldLogs() {
            return new Promise((resolve, reject) => {
                if (!this.db) {
                    resolve();
                    return;
                }

                const cutoffDate = new Date();
                cutoffDate.setDate(cutoffDate.getDate() - CONFIG.RETENTION_DAYS);
                const cutoffTime = cutoffDate.getTime();

                const transaction = this.db.transaction([CONFIG.STORE_NAME], 'readwrite');
                const store = transaction.objectStore(CONFIG.STORE_NAME);
                const index = store.index('timestamp');
                const request = index.openCursor();

                let deletedCount = 0;

                request.onsuccess = (event) => {
                    const cursor = event.target.result;
                    if (cursor) {
                        if (cursor.value.timestamp < cutoffTime) {
                            store.delete(cursor.primaryKey);
                            deletedCount++;
                        }
                        cursor.continue();
                    } else {
                        if (deletedCount > 0) {
                            console.log(`🗑️ Cleaned ${deletedCount} old logs (>${CONFIG.RETENTION_DAYS} days)`);
                        }
                        resolve(deletedCount);
                    }
                };

                request.onerror = () => reject(request.error);
            });
        }

        startAutoCleanup() {
            setInterval(() => {
                this.cleanOldLogs().catch(err =>
                    console.error('💾 Auto cleanup failed:', err)
                );
            }, CONFIG.AUTO_CLEANUP_INTERVAL);
        }

        // ═══════════════════════════════════════════════════════════════════════
        // LOGGING METHODS
        // ═══════════════════════════════════════════════════════════════════════

        log(level, category, message, context = {}) {
            // 🔒 Prevent infinite loops - if already logging, skip
            if (this.isLogging) {
                return null;
            }

            try {
                this.isLogging = true;

                const timestamp = Date.now();
                const date = new Date(timestamp).toISOString().split('T')[0];

                // 🆕 Hol Device-ID (falls getOrCreateDeviceId verfügbar)
                let deviceId = null;
                try {
                    if (typeof window.getOrCreateDeviceId === 'function') {
                        deviceId = window.getOrCreateDeviceId();
                    }
                } catch (e) {
                    // Funktion noch nicht verfügbar
                }

                const logEntry = {
                    timestamp,
                    date,
                    sessionId: this.sessionId,
                    deviceId,  // 🆕 Device-ID hinzufügen
                    level,
                    levelName: Object.keys(LOG_LEVELS).find(k => LOG_LEVELS[k] === level),
                    category,
                    message,
                    context: {
                        ...context,
                        userAgent: navigator.userAgent,
                        url: window.location.href
                    },
                    transactionId: this.getCurrentTransactionId(context)
                };

                // Save asynchronously
                this.saveLog(logEntry);

                // Console output with formatting
                this.consoleOutput(logEntry);

                return logEntry;
            } finally {
                this.isLogging = false;
            }
        }

        debug(category, message, context = {}) {
            return this.log(LOG_LEVELS.DEBUG, category, message, context);
        }

        info(category, message, context = {}) {
            return this.log(LOG_LEVELS.INFO, category, message, context);
        }

        warn(category, message, context = {}) {
            return this.log(LOG_LEVELS.WARN, category, message, context);
        }

        error(category, message, context = {}) {
            return this.log(LOG_LEVELS.ERROR, category, message, context);
        }

        critical(category, message, context = {}) {
            return this.log(LOG_LEVELS.CRITICAL, category, message, context);
        }

        consoleOutput(logEntry) {
            const icons = {
                0: '🔍', // DEBUG
                1: '✅', // INFO
                2: '⚠️', // WARN
                3: '❌', // ERROR
                4: '🚨'  // CRITICAL
            };

            const colors = {
                0: '#6b7280', // DEBUG
                1: '#10b981', // INFO
                2: '#f59e0b', // WARN
                3: '#ef4444', // ERROR
                4: '#dc2626'  // CRITICAL
            };

            const time = new Date(logEntry.timestamp).toLocaleTimeString('de-DE', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                fractionalSecondDigits: 3
            });

            const prefix = `${icons[logEntry.level]} [${time}] [${logEntry.category.toUpperCase()}]`;
            const style = `color: ${colors[logEntry.level]}; font-weight: bold;`;

            console.log(`%c${prefix}`, style, logEntry.message, logEntry.context);

            // 🔗 BRIDGE: Send to Debug Panel if available
            // Maps advancedLogger levels to debugLog types
            if (typeof window.debugLog === 'function') {
                const debugType = logEntry.level >= LOG_LEVELS.ERROR ? 'error' :
                                 logEntry.level >= LOG_LEVELS.WARN ? 'warn' : 'info';
                const debugMessage = `[${logEntry.category.toUpperCase()}] ${logEntry.message}`;
                window.debugLog(debugType, debugMessage);
            }
        }

        getCurrentTransactionId(context) {
            // If context has explicit transactionId, use it
            if (context.transactionId) {
                return context.transactionId;
            }

            // If we're in an active transaction, use that
            for (const [txnId, txn] of this.activeTransactions.entries()) {
                if (txn.active) {
                    return txnId;
                }
            }

            return null;
        }

        // ═══════════════════════════════════════════════════════════════════════
        // TRANSACTION TRACING
        // ═══════════════════════════════════════════════════════════════════════

        startTransaction(name, category, context = {}) {
            const transactionId = this.generateTransactionId();
            const startTime = Date.now();

            const transaction = {
                id: transactionId,
                name,
                category,
                context,
                startTime,
                active: true,
                steps: []
            };

            this.activeTransactions.set(transactionId, transaction);

            this.info(category, `🚀 Transaction started: ${name}`, {
                transactionId,
                ...context
            });

            return transactionId;
        }

        logTransactionStep(transactionId, stepName, data = {}) {
            const transaction = this.activeTransactions.get(transactionId);
            if (!transaction) {
                console.warn('⚠️ Transaction not found:', transactionId);
                return;
            }

            const stepTime = Date.now();
            const step = {
                name: stepName,
                timestamp: stepTime,
                duration: stepTime - transaction.startTime,
                data
            };

            transaction.steps.push(step);

            this.debug(transaction.category, `  ➜ ${stepName}`, {
                transactionId,
                stepDuration: step.duration,
                ...transaction.context,
                ...data
            });
        }

        endTransaction(transactionId, result = 'success', data = {}) {
            const transaction = this.activeTransactions.get(transactionId);
            if (!transaction) {
                console.warn('⚠️ Transaction not found:', transactionId);
                return;
            }

            const endTime = Date.now();
            const duration = endTime - transaction.startTime;

            transaction.active = false;
            transaction.endTime = endTime;
            transaction.duration = duration;
            transaction.result = result;
            transaction.resultData = data;

            const level = result === 'success' ? LOG_LEVELS.INFO : LOG_LEVELS.ERROR;
            const icon = result === 'success' ? '✅' : '❌';

            this.log(level, transaction.category,
                `${icon} Transaction ${result}: ${transaction.name} (${duration}ms)`, {
                transactionId,
                duration,
                steps: transaction.steps.length,
                result,
                ...transaction.context,
                ...data
            });

            // Remove from active transactions after logging
            setTimeout(() => {
                this.activeTransactions.delete(transactionId);
            }, 1000);

            return {
                transactionId,
                duration,
                steps: transaction.steps,
                result
            };
        }

        // ═══════════════════════════════════════════════════════════════════════
        // PERFORMANCE TRACKING
        // ═══════════════════════════════════════════════════════════════════════

        startPerformanceMark(name, context = {}) {
            const markId = `${name}_${Date.now()}`;
            this.performanceMarks.set(markId, {
                name,
                startTime: Date.now(),
                context
            });
            return markId;
        }

        endPerformanceMark(markId, additionalContext = {}) {
            const mark = this.performanceMarks.get(markId);
            if (!mark) {
                console.warn('⚠️ Performance mark not found:', markId);
                return;
            }

            const endTime = Date.now();
            const duration = endTime - mark.startTime;

            this.info(LOG_CATEGORIES.PERFORMANCE,
                `⏱️ ${mark.name}: ${duration}ms`, {
                duration,
                ...mark.context,
                ...additionalContext
            });

            this.performanceMarks.delete(markId);

            return duration;
        }

        // ═══════════════════════════════════════════════════════════════════════
        // SPECIALIZED LOGGING METHODS
        // ═══════════════════════════════════════════════════════════════════════

        logRouteCalculation(pickup, destination, result, duration, context = {}) {
            this.info(LOG_CATEGORIES.ROUTE,
                `🗺️ Route calculated: ${pickup} → ${destination}`, {
                pickup,
                destination,
                distance: result?.distance,
                routeDuration: result?.duration,
                calculationTime: duration,
                ...context
            });
        }

        logBooking(bookingData, result, context = {}) {
            const level = result.success ? LOG_LEVELS.INFO : LOG_LEVELS.ERROR;
            this.log(level, LOG_CATEGORIES.BOOKING,
                `📋 Booking ${result.success ? 'created' : 'failed'}: ${bookingData.pickup} → ${bookingData.destination}`, {
                rideId: result.rideId,
                bookingData,
                result,
                ...context
            });
        }

        logGPSUpdate(location, accuracy, context = {}) {
            this.debug(LOG_CATEGORIES.GPS,
                `📍 GPS Update: ${location.lat.toFixed(6)}, ${location.lng.toFixed(6)} (±${accuracy}m)`, {
                location,
                accuracy,
                ...context
            });
        }

        logDatabaseOperation(operation, path, data, duration, context = {}) {
            this.debug(LOG_CATEGORIES.DATABASE,
                `💾 Firebase ${operation}: ${path}`, {
                operation,
                path,
                dataSize: JSON.stringify(data).length,
                duration,
                ...context
            });
        }

        logAPICall(url, method, status, duration, context = {}) {
            const level = status >= 400 ? LOG_LEVELS.WARN : LOG_LEVELS.DEBUG;
            this.log(level, LOG_CATEGORIES.NETWORK,
                `🌐 ${method} ${url} → ${status} (${duration}ms)`, {
                url,
                method,
                status,
                duration,
                ...context
            });
        }

        // ═══════════════════════════════════════════════════════════════════════
        // EXPORT FUNCTIONALITY
        // ═══════════════════════════════════════════════════════════════════════

        async exportLogs(filters = {}, format = 'json') {
            const logs = await this.getLogs(filters);

            if (logs.length === 0) {
                alert('Keine Logs zum Exportieren gefunden!');
                return;
            }

            let content, filename, mimeType;

            if (format === 'json') {
                content = JSON.stringify(logs, null, 2);
                filename = `taxi-logs-${new Date().toISOString().split('T')[0]}.json`;
                mimeType = 'application/json';
            } else if (format === 'csv') {
                content = this.logsToCSV(logs);
                filename = `taxi-logs-${new Date().toISOString().split('T')[0]}.csv`;
                mimeType = 'text/csv';
            } else if (format === 'txt') {
                content = logs.map(l =>
                    `[${new Date(l.timestamp).toISOString()}] [${l.levelName}] [${l.category}] ${l.message}\n` +
                    `  Context: ${JSON.stringify(l.context)}\n`
                ).join('\n');
                filename = `taxi-logs-${new Date().toISOString().split('T')[0]}.txt`;
                mimeType = 'text/plain';
            }

            const blob = new Blob([content], { type: mimeType });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            console.log(`✅ Exported ${logs.length} logs as ${format.toUpperCase()}`);
        }

        logsToCSV(logs) {
            const headers = ['Timestamp', 'Date', 'Level', 'Category', 'Message', 'TransactionID', 'RideID', 'UserID', 'VehicleID'];
            const rows = logs.map(l => [
                new Date(l.timestamp).toISOString(),
                l.date,
                l.levelName,
                l.category,
                `"${l.message.replace(/"/g, '""')}"`,
                l.transactionId || '',
                l.context?.rideId || '',
                l.context?.userId || '',
                l.context?.vehicleId || ''
            ]);

            return [headers, ...rows].map(row => row.join(',')).join('\n');
        }

        async getStatistics() {
            const logs = await this.getLogs();

            const stats = {
                total: logs.length,
                byLevel: {},
                byCategory: {},
                byDate: {},
                averageDuration: 0,
                errors: logs.filter(l => l.level >= LOG_LEVELS.ERROR).length,
                transactions: new Set(logs.map(l => l.transactionId).filter(Boolean)).size
            };

            logs.forEach(log => {
                // By level
                const level = log.levelName;
                stats.byLevel[level] = (stats.byLevel[level] || 0) + 1;

                // By category
                const cat = log.category;
                stats.byCategory[cat] = (stats.byCategory[cat] || 0) + 1;

                // By date
                const date = log.date;
                stats.byDate[date] = (stats.byDate[date] || 0) + 1;
            });

            return stats;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // GLOBAL INSTANCE
    // ═══════════════════════════════════════════════════════════════════════════

    window.AdvancedLogger = AdvancedLogger;
    window.LOG_LEVELS = LOG_LEVELS;
    window.LOG_CATEGORIES = LOG_CATEGORIES;

    // Auto-initialize
    window.advancedLogger = new AdvancedLogger();

    console.log('🔍 Advanced Logger loaded!');
})();
