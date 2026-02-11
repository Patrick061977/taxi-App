/**
 * 🛡️ SAFE FUNCTION LOGGER
 * v1.0.0 - Loop-Protected Function Call Logging
 *
 * Features:
 * - ✅ Multiple loop protection mechanisms
 * - ✅ Whitelist-based (only logs specific functions)
 * - ✅ Can be enabled/disabled globally
 * - ✅ No Firebase operations triggered
 * - ✅ Only logs to IndexedDB via advancedLogger
 * - ✅ Automatic recursion detection
 */

(function() {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════════════
    // CONFIGURATION
    // ═══════════════════════════════════════════════════════════════════════════

    const CONFIG = {
        // 🔒 Master switch - set to false to disable ALL function logging
        ENABLED: true,

        // 🔒 Maximum call depth before stopping (prevents deep recursion)
        MAX_CALL_DEPTH: 3,

        // 🔒 Minimum time between logs (ms) - prevents spam
        MIN_LOG_INTERVAL: 100,

        // 📋 Whitelist of functions to log (only these will be logged)
        FUNCTIONS_TO_LOG: [
            'updateDriverStatusIndicator',
            'updateDriverView',
            'updateDriverViewV295',
            'updateOnlineDriversList',
            'checkDriverAvailability',
            'checkOnlineDrivers',
            'sendTelegramToDriver',
            'assignVehicleUnified'
        ]
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // LOOP PROTECTION STATE
    // ═══════════════════════════════════════════════════════════════════════════

    let currentCallDepth = 0;
    let lastLogTime = 0;
    let activeLogging = false;
    let loggedFunctionsCache = new Set();

    // ═══════════════════════════════════════════════════════════════════════════
    // SAFE LOGGER
    // ═══════════════════════════════════════════════════════════════════════════

    class SafeFunctionLogger {
        constructor() {
            this.wrappedFunctions = new Map();
            this.callStats = new Map();
        }

        /**
         * 🔒 SAFE LOG - Multiple protection layers
         */
        safeLog(level, category, message, context = {}) {
            // Protection 1: Check if logging is globally enabled
            if (!CONFIG.ENABLED) return;

            // Protection 2: Check if advancedLogger exists and is ready
            if (!window.advancedLogger || !window.advancedLogger.isReady) {
                return;
            }

            // Protection 3: Check if already logging (recursive call)
            if (activeLogging) {
                return;
            }

            // Protection 4: Check call depth
            if (currentCallDepth > CONFIG.MAX_CALL_DEPTH) {
                console.warn('🔒 SafeFunctionLogger: Max call depth reached, skipping log');
                return;
            }

            // Protection 5: Rate limiting
            const now = Date.now();
            if (now - lastLogTime < CONFIG.MIN_LOG_INTERVAL) {
                return;
            }

            try {
                activeLogging = true;
                currentCallDepth++;
                lastLogTime = now;

                // Call advancedLogger
                window.advancedLogger[level](category, message, context);

            } catch (error) {
                // Silent fail - don't spam console
                console.error('SafeFunctionLogger error:', error.message);
            } finally {
                activeLogging = false;
                currentCallDepth--;
            }
        }

        /**
         * Wrap a function with safe logging
         */
        wrapFunction(functionName, originalFunction) {
            if (!originalFunction || typeof originalFunction !== 'function') {
                console.warn(`Cannot wrap ${functionName} - not a function`);
                return originalFunction;
            }

            const self = this;

            const wrapped = function(...args) {
                const callId = `${functionName}_${Date.now()}`;
                const startTime = performance.now();

                // Log function call START
                self.safeLog('debug', 'system', `🔵 ${functionName}() called`, {
                    functionName,
                    callId,
                    argsCount: args.length,
                    timestamp: Date.now()
                });

                // Update stats
                if (!self.callStats.has(functionName)) {
                    self.callStats.set(functionName, { count: 0, totalTime: 0 });
                }
                const stats = self.callStats.get(functionName);
                stats.count++;

                let result;
                let error;

                try {
                    // Call original function
                    result = originalFunction.apply(this, args);

                    // If it's a promise, handle async
                    if (result && typeof result.then === 'function') {
                        return result
                            .then(asyncResult => {
                                const duration = performance.now() - startTime;
                                stats.totalTime += duration;

                                self.safeLog('debug', 'system', `✅ ${functionName}() completed (async)`, {
                                    functionName,
                                    callId,
                                    duration: Math.round(duration),
                                    success: true,
                                    totalCalls: stats.count,
                                    avgTime: Math.round(stats.totalTime / stats.count)
                                });

                                return asyncResult;
                            })
                            .catch(asyncError => {
                                const duration = performance.now() - startTime;
                                stats.totalTime += duration;

                                self.safeLog('error', 'system', `❌ ${functionName}() failed (async)`, {
                                    functionName,
                                    callId,
                                    duration: Math.round(duration),
                                    error: asyncError.message,
                                    stack: asyncError.stack
                                });

                                throw asyncError;
                            });
                    }

                    // Sync function completed
                    const duration = performance.now() - startTime;
                    stats.totalTime += duration;

                    self.safeLog('debug', 'system', `✅ ${functionName}() completed`, {
                        functionName,
                        callId,
                        duration: Math.round(duration),
                        success: true,
                        totalCalls: stats.count,
                        avgTime: Math.round(stats.totalTime / stats.count)
                    });

                    return result;

                } catch (err) {
                    error = err;
                    const duration = performance.now() - startTime;
                    stats.totalTime += duration;

                    self.safeLog('error', 'system', `❌ ${functionName}() failed`, {
                        functionName,
                        callId,
                        duration: Math.round(duration),
                        error: err.message,
                        stack: err.stack
                    });

                    throw err;
                }
            };

            // Preserve function properties
            Object.defineProperty(wrapped, 'name', { value: originalFunction.name });
            wrapped._original = originalFunction;
            wrapped._wrapped = true;

            return wrapped;
        }

        /**
         * Install logging on whitelisted functions
         */
        install() {
            if (!CONFIG.ENABLED) {
                console.log('🔒 SafeFunctionLogger: Disabled by config');
                return;
            }

            console.log('🔍 SafeFunctionLogger: Installing on whitelisted functions...');

            let installedCount = 0;

            CONFIG.FUNCTIONS_TO_LOG.forEach(functionName => {
                try {
                    // Check if function exists in window
                    if (typeof window[functionName] === 'function' && !window[functionName]._wrapped) {
                        const original = window[functionName];
                        const wrapped = this.wrapFunction(functionName, original);

                        window[functionName] = wrapped;
                        this.wrappedFunctions.set(functionName, original);

                        installedCount++;
                        console.log(`  ✅ Wrapped: ${functionName}()`);
                    }
                } catch (error) {
                    console.warn(`  ⚠️ Failed to wrap ${functionName}:`, error.message);
                }
            });

            console.log(`🔍 SafeFunctionLogger: Installed on ${installedCount} functions`);

            // Log installation success
            this.safeLog('info', 'system', `SafeFunctionLogger installed on ${installedCount} functions`, {
                functions: Array.from(this.wrappedFunctions.keys())
            });
        }

        /**
         * Uninstall logging (restore original functions)
         */
        uninstall() {
            console.log('🔍 SafeFunctionLogger: Uninstalling...');

            this.wrappedFunctions.forEach((original, functionName) => {
                try {
                    if (window[functionName] && window[functionName]._wrapped) {
                        window[functionName] = original;
                        console.log(`  ✅ Restored: ${functionName}()`);
                    }
                } catch (error) {
                    console.warn(`  ⚠️ Failed to restore ${functionName}:`, error.message);
                }
            });

            this.wrappedFunctions.clear();
            console.log('🔍 SafeFunctionLogger: Uninstalled');
        }

        /**
         * Get statistics about function calls
         */
        getStats() {
            const stats = {};
            this.callStats.forEach((value, key) => {
                stats[key] = {
                    calls: value.count,
                    totalTime: Math.round(value.totalTime),
                    avgTime: Math.round(value.totalTime / value.count)
                };
            });
            return stats;
        }

        /**
         * Enable/disable logging
         */
        enable() {
            CONFIG.ENABLED = true;
            console.log('🔍 SafeFunctionLogger: Enabled');
        }

        disable() {
            CONFIG.ENABLED = false;
            console.log('🔍 SafeFunctionLogger: Disabled');
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // GLOBAL INSTANCE
    // ═══════════════════════════════════════════════════════════════════════════

    window.SafeFunctionLogger = SafeFunctionLogger;
    window.safeFunctionLogger = new SafeFunctionLogger();

    // Auto-install after page load (when advancedLogger is ready)
    window.addEventListener('load', () => {
        // Wait for advancedLogger to be ready
        const checkReady = setInterval(() => {
            if (window.advancedLogger && window.advancedLogger.isReady) {
                clearInterval(checkReady);

                // Wait 2 more seconds to ensure all functions are defined
                setTimeout(() => {
                    window.safeFunctionLogger.install();
                }, 2000);
            }
        }, 100);
    });

    console.log('🛡️ Safe Function Logger loaded!');
    console.log('💡 Usage:');
    console.log('  - safeFunctionLogger.enable()   // Enable logging');
    console.log('  - safeFunctionLogger.disable()  // Disable logging');
    console.log('  - safeFunctionLogger.getStats() // Get call statistics');
    console.log('  - safeFunctionLogger.uninstall() // Remove all wrappers');
})();
