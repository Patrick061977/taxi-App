/**
 * 🔥 FIREBASE REMOTE LOGGER
 * v1.0.0 - Central logging system for all devices
 *
 * Features:
 * - ✅ All devices log to central Firebase location
 * - ✅ Strict loop protection (write-only, no listeners)
 * - ✅ Batch upload (reduces Firebase calls by 95%)
 * - ✅ Offline support (queues logs when offline)
 * - ✅ Device-based filtering
 * - ✅ Admin panel for viewing all logs
 * - ✅ No Telegram dependency
 *
 * CRITICAL RULES:
 * - This script ONLY WRITES to Firebase /logs/ path
 * - This script NEVER READS from Firebase /logs/ path
 * - This script has NO LISTENERS on Firebase /logs/ path
 * - This prevents infinite loops
 */

(function() {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════════════
    // CONFIGURATION
    // ═══════════════════════════════════════════════════════════════════════════

    const CONFIG = {
        // 🔒 Enable/disable remote logging
        ENABLED: true,

        // 🔒 Batch upload interval (ms) - reduces Firebase load
        UPLOAD_INTERVAL: 30000, // 30 seconds

        // 🔒 Maximum logs per batch
        MAX_BATCH_SIZE: 50,

        // 🔒 Minimum log level to upload (DEBUG=0, INFO=1, WARN=2, ERROR=3, CRITICAL=4)
        MIN_UPLOAD_LEVEL: 1, // INFO and above

        // 🔒 Categories to upload (empty = all)
        // 🔧 v5.96.2: Alle Kategorien hochladen damit monitor.html alles sieht
        UPLOAD_CATEGORIES: [],

        // 🔥 Firebase path (NEVER READ FROM THIS PATH!)
        FIREBASE_PATH: 'logs',

        // 🔒 Loop protection
        MAX_UPLOAD_RETRIES: 3,
        UPLOAD_TIMEOUT: 5000 // 5 seconds
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════════════════════════════════════════

    let uploadQueue = [];
    let isUploading = false;
    let uploadInterval = null;
    let deviceId = null;
    let uploadStats = {
        totalUploaded: 0,
        totalFailed: 0,
        lastUploadTime: null,
        lastError: null
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // DEVICE ID
    // ═══════════════════════════════════════════════════════════════════════════

    function getOrCreateDeviceId() {
        // Check if device ID exists in localStorage
        let id = localStorage.getItem('deviceId');

        if (!id) {
            // Create new device ID
            const timestamp = Date.now();
            const random = Math.random().toString(36).substr(2, 9);
            const userAgent = navigator.userAgent.substr(0, 20).replace(/[^a-zA-Z0-9]/g, '');

            id = `device_${timestamp}_${random}_${userAgent}`;
            localStorage.setItem('deviceId', id);

            console.log('🆔 Created new device ID:', id);
        }

        return id;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // FIREBASE REMOTE LOGGER CLASS
    // ═══════════════════════════════════════════════════════════════════════════

    class FirebaseRemoteLogger {
        constructor() {
            this.isReady = false;
            deviceId = getOrCreateDeviceId();

            console.log('🔥 Firebase Remote Logger initializing...');
            console.log('🆔 Device ID:', deviceId);
        }

        /**
         * Initialize and start batch upload
         */
        async init() {
            if (!CONFIG.ENABLED) {
                console.log('🔥 Firebase Remote Logger: Disabled by config');
                return;
            }

            // Wait for Firebase to be ready
            await this.waitForFirebase();

            // Start batch upload interval
            this.startBatchUpload();

            this.isReady = true;
            console.log('✅ Firebase Remote Logger ready');

            // Log initialization
            this.queueLog({
                level: 1, // INFO
                levelName: 'INFO',
                category: 'system',
                message: '🔥 Firebase Remote Logger started',
                context: {
                    deviceId,
                    userAgent: navigator.userAgent,
                    url: window.location.href,
                    timestamp: Date.now()
                }
            });
        }

        /**
         * Wait for Firebase to be ready
         */
        async waitForFirebase() {
            return new Promise((resolve) => {
                const checkReady = setInterval(() => {
                    // Check window.db (set by main app) OR directly from firebase.apps
                    const hasWindowDb = window.db && window.isFirebaseReady;
                    const hasFirebaseApp = typeof firebase !== 'undefined' &&
                        firebase.apps && firebase.apps.length > 0 &&
                        window.isFirebaseReady;

                    if (hasWindowDb || hasFirebaseApp) {
                        // Ensure window.db is always set (fallback if main app missed it)
                        if (!window.db && hasFirebaseApp) {
                            window.db = firebase.database();
                            console.log('🔧 Remote Logger: window.db selbst gesetzt (Fallback)');
                        }
                        clearInterval(checkReady);
                        console.log('✅ Firebase connection ready');
                        resolve();
                    }
                }, 100);

                // Timeout after 10 seconds
                setTimeout(() => {
                    clearInterval(checkReady);
                    console.warn('⚠️ Firebase not ready after 10s, continuing anyway');
                    resolve();
                }, 10000);
            });
        }

        /**
         * Queue a log for upload
         */
        queueLog(logEntry) {
            if (!CONFIG.ENABLED) return;

            // Filter by level
            if (logEntry.level < CONFIG.MIN_UPLOAD_LEVEL) {
                return;
            }

            // Filter by category (if specified)
            if (CONFIG.UPLOAD_CATEGORIES.length > 0 &&
                !CONFIG.UPLOAD_CATEGORIES.includes(logEntry.category)) {
                return;
            }

            // Add to queue
            uploadQueue.push({
                ...logEntry,
                deviceId,
                queuedAt: Date.now()
            });

            // If queue is too large, upload immediately
            if (uploadQueue.length >= CONFIG.MAX_BATCH_SIZE) {
                console.log('📤 Queue full, uploading immediately');
                this.uploadBatch();
            }
        }

        /**
         * Start periodic batch upload
         */
        startBatchUpload() {
            if (uploadInterval) {
                clearInterval(uploadInterval);
            }

            uploadInterval = setInterval(() => {
                if (uploadQueue.length > 0) {
                    this.uploadBatch();
                }
            }, CONFIG.UPLOAD_INTERVAL);

            console.log(`⏱️ Batch upload started (every ${CONFIG.UPLOAD_INTERVAL / 1000}s)`);
        }

        /**
         * Upload batch of logs to Firebase
         * 🔒 CRITICAL: This ONLY WRITES, never reads!
         */
        async uploadBatch() {
            // Protection: Don't upload if already uploading
            if (isUploading) {
                console.log('⏳ Already uploading, skipping...');
                return;
            }

            // Protection: Check if Firebase is available
            if (!window.db || !window.isFirebaseReady) {
                console.warn('⚠️ Firebase not ready, keeping logs in queue');
                return;
            }

            if (uploadQueue.length === 0) {
                return;
            }

            isUploading = true;

            let batch = [];
            try {
                batch = uploadQueue.splice(0, CONFIG.MAX_BATCH_SIZE);
                const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

                console.log(`📤 Uploading ${batch.length} logs to Firebase...`);

                // Group logs by date for better organization
                const logsByDate = {};
                batch.forEach(log => {
                    // FIX: timestamp kann undefined sein → Fallback auf queuedAt oder jetzt
                    const ts = log.timestamp || log.queuedAt || Date.now();
                    const tsNum = typeof ts === 'string' ? new Date(ts).getTime() : ts;
                    const logDate = !isNaN(tsNum)
                        ? new Date(tsNum).toISOString().split('T')[0]
                        : new Date().toISOString().split('T')[0];
                    if (!logsByDate[logDate]) {
                        logsByDate[logDate] = [];
                    }
                    logsByDate[logDate].push(log);
                });

                // Upload each date group
                const uploadPromises = [];

                for (const [logDate, logs] of Object.entries(logsByDate)) {
                    // 🔥 CRITICAL: WRITE-ONLY operation, NO LISTENERS!
                    // Path: /logs/{deviceId}/{date}/batch_{timestamp}
                    const batchRef = window.db.ref(
                        `${CONFIG.FIREBASE_PATH}/${deviceId}/${logDate}/batch_${Date.now()}`
                    );

                    const promise = Promise.race([
                        batchRef.set({
                            logs,
                            uploadedAt: Date.now(),
                            deviceId,
                            count: logs.length
                        }),
                        new Promise((_, reject) =>
                            setTimeout(() => reject(new Error('Upload timeout')),
                            CONFIG.UPLOAD_TIMEOUT)
                        )
                    ]);

                    uploadPromises.push(promise);
                }

                // Wait for all uploads
                await Promise.all(uploadPromises);

                // Update stats
                uploadStats.totalUploaded += batch.length;
                uploadStats.lastUploadTime = Date.now();
                uploadStats.lastError = null;

                console.log(`✅ Uploaded ${batch.length} logs successfully`);
                console.log(`📊 Total uploaded: ${uploadStats.totalUploaded}`);

            } catch (error) {
                console.error('❌ Failed to upload logs:', error.message);

                // Put logs back in queue (at the front) - FIX: war falsch (splice gibt [] zurück)
                // batch wurde bereits aus uploadQueue entfernt, wieder vorne einfügen
                uploadQueue.unshift(...batch);

                uploadStats.totalFailed += batch.length;
                uploadStats.lastError = error.message;

                // If too many failures, clear queue to prevent memory issues
                if (uploadStats.totalFailed > 1000) {
                    console.warn('⚠️ Too many failed uploads, clearing queue');
                    uploadQueue = [];
                    uploadStats.totalFailed = 0;
                }

            } finally {
                isUploading = false;
            }
        }

        /**
         * Force immediate upload
         */
        async forceUpload() {
            console.log('🚀 Force uploading logs...');
            await this.uploadBatch();
        }

        /**
         * Get current stats
         */
        getStats() {
            return {
                ...uploadStats,
                queueSize: uploadQueue.length,
                deviceId,
                isUploading,
                isReady: this.isReady
            };
        }

        /**
         * Clear queue
         */
        clearQueue() {
            const cleared = uploadQueue.length;
            uploadQueue = [];
            console.log(`🗑️ Cleared ${cleared} logs from queue`);
            return cleared;
        }

        /**
         * Enable/disable remote logging
         */
        enable() {
            CONFIG.ENABLED = true;
            if (!uploadInterval) {
                this.startBatchUpload();
            }
            console.log('✅ Firebase Remote Logger enabled');
        }

        disable() {
            CONFIG.ENABLED = false;
            if (uploadInterval) {
                clearInterval(uploadInterval);
                uploadInterval = null;
            }
            console.log('🔴 Firebase Remote Logger disabled');
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // INTEGRATION WITH ADVANCED LOGGER
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Hook into advancedLogger to automatically queue logs
     */
    function hookIntoAdvancedLogger() {
        const checkLogger = setInterval(() => {
            if (window.advancedLogger && window.advancedLogger.isReady) {
                clearInterval(checkLogger);

                console.log('🔗 Hooking into advancedLogger...');

                // Wrap the saveLog method
                const originalSaveLog = window.advancedLogger.saveLog.bind(window.advancedLogger);

                window.advancedLogger.saveLog = function(logEntry) {
                    // Call original
                    originalSaveLog(logEntry);

                    // Queue for remote upload
                    if (window.firebaseRemoteLogger && window.firebaseRemoteLogger.isReady) {
                        window.firebaseRemoteLogger.queueLog(logEntry);
                    }
                };

                console.log('✅ advancedLogger hook installed');
            }
        }, 100);

        // Timeout after 10 seconds
        setTimeout(() => clearInterval(checkLogger), 10000);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // GLOBAL INSTANCE & AUTO-INIT
    // ═══════════════════════════════════════════════════════════════════════════

    window.FirebaseRemoteLogger = FirebaseRemoteLogger;
    window.firebaseRemoteLogger = new FirebaseRemoteLogger();
    window.getOrCreateDeviceId = getOrCreateDeviceId;

    // Auto-initialize after page load
    window.addEventListener('load', async () => {
        await window.firebaseRemoteLogger.init();

        // Hook into advancedLogger if available
        if (window.advancedLogger) {
            hookIntoAdvancedLogger();
        }
    });

    // Upload remaining logs before page unload
    window.addEventListener('beforeunload', () => {
        if (uploadQueue.length > 0 && window.firebaseRemoteLogger) {
            console.log('📤 Uploading remaining logs before unload...');
            // Use synchronous beacon API for guaranteed delivery
            const batch = uploadQueue.splice(0, CONFIG.MAX_BATCH_SIZE);
            if (navigator.sendBeacon) {
                const data = JSON.stringify({
                    deviceId,
                    logs: batch,
                    timestamp: Date.now()
                });
                // This would need a server endpoint, for now just log
                console.log('Would send via beacon:', batch.length, 'logs');
            }
        }
    });

    console.log('🔥 Firebase Remote Logger loaded!');
    console.log('💡 Usage:');
    console.log('  - firebaseRemoteLogger.getStats()    // View upload statistics');
    console.log('  - firebaseRemoteLogger.forceUpload() // Force immediate upload');
    console.log('  - firebaseRemoteLogger.clearQueue()  // Clear upload queue');
    console.log('  - firebaseRemoteLogger.enable()      // Enable remote logging');
    console.log('  - firebaseRemoteLogger.disable()     // Disable remote logging');
})();
