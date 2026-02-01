/**
 * 🔍 DEBUG CONTROL PANEL
 *
 * Ermöglicht Live-Debugging und Funktions-Kontrolle
 *
 * Features:
 * - Funktionen live aufrufen
 * - Parameter überschreiben
 * - Return-Values abfangen
 * - Breakpoints setzen
 * - Performance-Tracking
 * - Call-Stack visualisieren
 *
 * Usage:
 * 1. Include in index.html: <script src="debug-control-panel.js"></script>
 * 2. Press Ctrl+Shift+D to toggle Debug Panel
 * 3. Search functions, set breakpoints, monitor calls
 */

(function() {
    'use strict';

    // Global Debug State
    window.debugControlPanel = {
        enabled: false,
        breakpoints: new Set(),
        functionWrappers: new Map(),
        callHistory: [],
        maxHistory: 100,
        monitoring: new Set(),

        // Configuration
        config: {
            autoOpenOnError: true,
            trackPerformance: true,
            logAllCalls: false,
            showNotifications: true
        }
    };

    // Load functions index
    let functionsIndex = null;

    async function loadFunctionsIndex() {
        try {
            const response = await fetch('functions-index.json');
            const data = await response.json();
            functionsIndex = data;
            console.log('✅ Debug Control Panel: Functions Index loaded', data.total_functions, 'functions');
            return data;
        } catch (error) {
            console.error('❌ Debug Control Panel: Failed to load functions index', error);
            return null;
        }
    }

    // Initialize Debug Panel
    function initDebugPanel() {
        // Create UI
        const panelHTML = `
            <div id="debug-control-panel" style="
                position: fixed;
                bottom: 20px;
                right: 20px;
                width: 400px;
                max-height: 600px;
                background: rgba(15, 23, 42, 0.98);
                backdrop-filter: blur(20px);
                border: 1px solid rgba(59, 130, 246, 0.3);
                border-radius: 16px;
                box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
                color: #e2e8f0;
                font-family: 'Courier New', monospace;
                font-size: 12px;
                z-index: 99999;
                display: none;
                overflow: hidden;
            ">
                <div style="
                    padding: 16px;
                    background: rgba(59, 130, 246, 0.1);
                    border-bottom: 1px solid rgba(59, 130, 246, 0.3);
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                ">
                    <div style="font-weight: 700; font-size: 14px; color: #60a5fa;">
                        🔍 Debug Control Panel
                    </div>
                    <button onclick="window.debugControlPanel.toggle()" style="
                        background: none;
                        border: none;
                        color: #94a3b8;
                        font-size: 20px;
                        cursor: pointer;
                        padding: 0;
                        width: 24px;
                        height: 24px;
                        line-height: 1;
                    ">×</button>
                </div>

                <div style="padding: 16px; max-height: 500px; overflow-y: auto;">
                    <!-- Quick Actions -->
                    <div style="margin-bottom: 16px;">
                        <div style="color: #94a3b8; font-size: 10px; margin-bottom: 8px; text-transform: uppercase;">Quick Actions</div>
                        <div style="display: grid; gap: 8px;">
                            <button onclick="window.debugControlPanel.openFunctionExplorer()" style="
                                background: #3b82f6;
                                border: none;
                                color: white;
                                padding: 10px;
                                border-radius: 8px;
                                cursor: pointer;
                                font-size: 12px;
                                font-weight: 600;
                                transition: all 0.2s;
                            ">
                                🔍 Function Explorer öffnen
                            </button>
                            <button onclick="window.debugControlPanel.openLogViewer()" style="
                                background: rgba(255, 255, 255, 0.1);
                                border: none;
                                color: #e2e8f0;
                                padding: 10px;
                                border-radius: 8px;
                                cursor: pointer;
                                font-size: 12px;
                                font-weight: 600;
                                transition: all 0.2s;
                            ">
                                📝 Log Viewer öffnen
                            </button>
                            <button onclick="window.debugControlPanel.openChangeViewer()" style="
                                background: rgba(255, 255, 255, 0.1);
                                border: none;
                                color: #e2e8f0;
                                padding: 10px;
                                border-radius: 8px;
                                cursor: pointer;
                                font-size: 12px;
                                font-weight: 600;
                                transition: all 0.2s;
                            ">
                                📝 Change Viewer öffnen
                            </button>
                        </div>
                    </div>

                    <!-- Function Search -->
                    <div style="margin-bottom: 16px;">
                        <div style="color: #94a3b8; font-size: 10px; margin-bottom: 8px; text-transform: uppercase;">Funktion suchen</div>
                        <input
                            type="text"
                            id="debug-function-search"
                            placeholder="z.B. book, calculate, route..."
                            style="
                                width: 100%;
                                padding: 10px;
                                background: rgba(255, 255, 255, 0.1);
                                border: 1px solid rgba(255, 255, 255, 0.2);
                                border-radius: 8px;
                                color: #e2e8f0;
                                font-family: 'Courier New', monospace;
                                font-size: 12px;
                                outline: none;
                            "
                            oninput="window.debugControlPanel.searchFunctions(this.value)"
                        />
                        <div id="debug-search-results" style="
                            margin-top: 8px;
                            max-height: 200px;
                            overflow-y: auto;
                        "></div>
                    </div>

                    <!-- Monitoring -->
                    <div style="margin-bottom: 16px;">
                        <div style="color: #94a3b8; font-size: 10px; margin-bottom: 8px; text-transform: uppercase;">Überwachte Funktionen</div>
                        <div id="debug-monitoring-list" style="
                            background: rgba(0, 0, 0, 0.3);
                            padding: 12px;
                            border-radius: 8px;
                            min-height: 60px;
                        ">
                            <div style="color: #64748b; text-align: center; font-style: italic;">
                                Keine Funktionen überwacht
                            </div>
                        </div>
                    </div>

                    <!-- Call History -->
                    <div style="margin-bottom: 16px;">
                        <div style="
                            display: flex;
                            justify-content: space-between;
                            align-items: center;
                            margin-bottom: 8px;
                        ">
                            <div style="color: #94a3b8; font-size: 10px; text-transform: uppercase;">Letzte Aufrufe</div>
                            <button onclick="window.debugControlPanel.clearHistory()" style="
                                background: rgba(239, 68, 68, 0.2);
                                border: none;
                                color: #ef4444;
                                padding: 4px 8px;
                                border-radius: 4px;
                                cursor: pointer;
                                font-size: 10px;
                            ">Clear</button>
                        </div>
                        <div id="debug-call-history" style="
                            background: rgba(0, 0, 0, 0.3);
                            padding: 12px;
                            border-radius: 8px;
                            max-height: 150px;
                            overflow-y: auto;
                            font-size: 11px;
                        ">
                            <div style="color: #64748b; text-align: center; font-style: italic;">
                                Keine Aufrufe
                            </div>
                        </div>
                    </div>

                    <!-- Settings -->
                    <div>
                        <div style="color: #94a3b8; font-size: 10px; margin-bottom: 8px; text-transform: uppercase;">Einstellungen</div>
                        <div style="display: grid; gap: 8px; font-size: 11px;">
                            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                                <input type="checkbox" id="debug-auto-open-error" checked onchange="window.debugControlPanel.updateConfig('autoOpenOnError', this.checked)">
                                <span>Auto-Open bei Fehler</span>
                            </label>
                            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                                <input type="checkbox" id="debug-track-performance" checked onchange="window.debugControlPanel.updateConfig('trackPerformance', this.checked)">
                                <span>Performance tracken</span>
                            </label>
                            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                                <input type="checkbox" id="debug-log-all-calls" onchange="window.debugControlPanel.updateConfig('logAllCalls', this.checked)">
                                <span>Alle Aufrufe loggen</span>
                            </label>
                            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                                <input type="checkbox" id="debug-show-notifications" checked onchange="window.debugControlPanel.updateConfig('showNotifications', this.checked)">
                                <span>Notifications anzeigen</span>
                            </label>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Toggle Button -->
            <button id="debug-toggle-btn" onclick="window.debugControlPanel.toggle()" style="
                position: fixed;
                bottom: 20px;
                right: 20px;
                width: 50px;
                height: 50px;
                background: rgba(59, 130, 246, 0.9);
                border: 2px solid rgba(255, 255, 255, 0.2);
                border-radius: 50%;
                color: white;
                font-size: 20px;
                cursor: pointer;
                box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4);
                z-index: 99998;
                transition: all 0.2s;
                display: flex;
                align-items: center;
                justify-content: center;
            " onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform='scale(1)'">
                🔍
            </button>
        `;

        // Inject into DOM
        document.body.insertAdjacentHTML('beforeend', panelHTML);
    }

    // API Methods
    window.debugControlPanel.toggle = function() {
        const panel = document.getElementById('debug-control-panel');
        const btn = document.getElementById('debug-toggle-btn');

        if (panel.style.display === 'none') {
            panel.style.display = 'block';
            btn.style.display = 'none';
            this.enabled = true;
        } else {
            panel.style.display = 'none';
            btn.style.display = 'flex';
            this.enabled = false;
        }
    };

    window.debugControlPanel.openFunctionExplorer = function() {
        window.open('function-explorer.html', '_blank', 'width=1400,height=900');
    };

    window.debugControlPanel.openLogViewer = function() {
        window.open('log-viewer.html', '_blank', 'width=1400,height=900');
    };

    window.debugControlPanel.openChangeViewer = function() {
        window.open('change-viewer.html', '_blank', 'width=1400,height=900');
    };

    window.debugControlPanel.searchFunctions = function(query) {
        if (!functionsIndex || !query || query.length < 2) {
            document.getElementById('debug-search-results').innerHTML = '';
            return;
        }

        query = query.toLowerCase();
        const matches = functionsIndex.functions.filter(f =>
            f.name.toLowerCase().includes(query)
        ).slice(0, 10);

        const resultsHTML = matches.map(f => `
            <div style="
                padding: 8px;
                background: rgba(255, 255, 255, 0.05);
                border-radius: 6px;
                margin-bottom: 4px;
                cursor: pointer;
                transition: background 0.2s;
            " onmouseover="this.style.background='rgba(59, 130, 246, 0.1)'" onmouseout="this.style.background='rgba(255, 255, 255, 0.05)'" onclick="window.debugControlPanel.selectFunction('${f.name}', ${f.line})">
                <div style="color: #60a5fa; font-weight: 600; margin-bottom: 4px;">
                    ${f.name}
                    ${f.async ? '<span style="background: #10b981; color: white; padding: 1px 4px; border-radius: 3px; font-size: 9px; margin-left: 4px;">ASYNC</span>' : ''}
                </div>
                <div style="color: #94a3b8; font-size: 10px;">
                    📍 Zeile ${f.line} |
                    ${f.parameters ? f.parameters.length : 0} Parameter
                </div>
            </div>
        `).join('');

        document.getElementById('debug-search-results').innerHTML = resultsHTML || '<div style="color: #64748b; padding: 8px; text-align: center; font-style: italic;">Keine Ergebnisse</div>';
    };

    window.debugControlPanel.selectFunction = function(name, line) {
        const action = confirm(`Funktion: ${name} (Zeile ${line})\n\nWas möchtest du tun?\n\nOK = Überwachen\nAbbrechen = Zu Zeile springen`);

        if (action) {
            this.monitorFunction(name);
        } else {
            alert(`🔍 Öffne index.html und springe zu Zeile ${line}\n\nIn VS Code: Ctrl+G → ${line}`);
        }
    };

    window.debugControlPanel.monitorFunction = function(name) {
        if (this.monitoring.has(name)) {
            alert(`⚠️ Funktion "${name}" wird bereits überwacht!`);
            return;
        }

        // Check if function exists
        if (typeof window[name] !== 'function') {
            alert(`❌ Funktion "${name}" nicht im globalen Scope gefunden!`);
            return;
        }

        // Wrap function
        const originalFunc = window[name];
        this.functionWrappers.set(name, originalFunc);
        this.monitoring.add(name);

        const self = this;
        window[name] = function(...args) {
            const startTime = performance.now();

            // Log call
            console.log(`🔍 [DEBUG] ${name}() called with:`, args);

            // Add to history
            self.addToHistory(name, args, startTime);

            // Call original
            let result;
            let error = null;
            try {
                result = originalFunc.apply(this, args);

                // Handle async
                if (result && typeof result.then === 'function') {
                    return result.then(value => {
                        const duration = performance.now() - startTime;
                        console.log(`✅ [DEBUG] ${name}() resolved in ${duration.toFixed(2)}ms:`, value);
                        self.updateHistory(name, startTime, 'success', duration, value);
                        return value;
                    }).catch(err => {
                        const duration = performance.now() - startTime;
                        console.error(`❌ [DEBUG] ${name}() rejected in ${duration.toFixed(2)}ms:`, err);
                        self.updateHistory(name, startTime, 'error', duration, err);
                        throw err;
                    });
                } else {
                    const duration = performance.now() - startTime;
                    console.log(`✅ [DEBUG] ${name}() returned in ${duration.toFixed(2)}ms:`, result);
                    self.updateHistory(name, startTime, 'success', duration, result);
                    return result;
                }
            } catch (err) {
                const duration = performance.now() - startTime;
                console.error(`❌ [DEBUG] ${name}() error in ${duration.toFixed(2)}ms:`, err);
                self.updateHistory(name, startTime, 'error', duration, err);
                throw err;
            }
        };

        this.updateMonitoringList();

        if (this.config.showNotifications) {
            this.showNotification(`✅ Überwache jetzt: ${name}()`);
        }
    };

    window.debugControlPanel.stopMonitoring = function(name) {
        if (!this.monitoring.has(name)) return;

        // Restore original function
        const originalFunc = this.functionWrappers.get(name);
        if (originalFunc) {
            window[name] = originalFunc;
            this.functionWrappers.delete(name);
        }

        this.monitoring.delete(name);
        this.updateMonitoringList();

        if (this.config.showNotifications) {
            this.showNotification(`⏹️ Stopped: ${name}()`);
        }
    };

    window.debugControlPanel.updateMonitoringList = function() {
        const container = document.getElementById('debug-monitoring-list');

        if (this.monitoring.size === 0) {
            container.innerHTML = '<div style="color: #64748b; text-align: center; font-style: italic;">Keine Funktionen überwacht</div>';
            return;
        }

        const html = Array.from(this.monitoring).map(name => `
            <div style="
                padding: 6px 8px;
                background: rgba(16, 185, 129, 0.1);
                border-left: 2px solid #10b981;
                border-radius: 4px;
                margin-bottom: 4px;
                display: flex;
                justify-content: space-between;
                align-items: center;
            ">
                <span style="color: #10b981; font-weight: 600;">${name}()</span>
                <button onclick="window.debugControlPanel.stopMonitoring('${name}')" style="
                    background: rgba(239, 68, 68, 0.2);
                    border: none;
                    color: #ef4444;
                    padding: 2px 6px;
                    border-radius: 3px;
                    cursor: pointer;
                    font-size: 10px;
                ">Stop</button>
            </div>
        `).join('');

        container.innerHTML = html;
    };

    window.debugControlPanel.addToHistory = function(name, args, startTime) {
        this.callHistory.unshift({
            name,
            args,
            startTime,
            status: 'pending',
            timestamp: new Date()
        });

        if (this.callHistory.length > this.maxHistory) {
            this.callHistory = this.callHistory.slice(0, this.maxHistory);
        }

        this.updateHistoryDisplay();
    };

    window.debugControlPanel.updateHistory = function(name, startTime, status, duration, result) {
        const entry = this.callHistory.find(e => e.name === name && e.startTime === startTime);
        if (entry) {
            entry.status = status;
            entry.duration = duration;
            entry.result = result;
            this.updateHistoryDisplay();
        }
    };

    window.debugControlPanel.updateHistoryDisplay = function() {
        const container = document.getElementById('debug-call-history');

        if (this.callHistory.length === 0) {
            container.innerHTML = '<div style="color: #64748b; text-align: center; font-style: italic;">Keine Aufrufe</div>';
            return;
        }

        const html = this.callHistory.slice(0, 10).map(entry => {
            const statusIcon = entry.status === 'success' ? '✅' : entry.status === 'error' ? '❌' : '⏳';
            const statusColor = entry.status === 'success' ? '#10b981' : entry.status === 'error' ? '#ef4444' : '#f59e0b';

            return `
                <div style="
                    padding: 6px;
                    background: rgba(255, 255, 255, 0.03);
                    border-radius: 4px;
                    margin-bottom: 4px;
                    border-left: 2px solid ${statusColor};
                ">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
                        <span style="color: #60a5fa; font-weight: 600;">${statusIcon} ${entry.name}()</span>
                        ${entry.duration ? `<span style="color: #94a3b8;">${entry.duration.toFixed(1)}ms</span>` : ''}
                    </div>
                    <div style="color: #64748b; font-size: 10px;">
                        ${entry.timestamp.toLocaleTimeString('de-DE')}
                    </div>
                </div>
            `;
        }).join('');

        container.innerHTML = html;
    };

    window.debugControlPanel.clearHistory = function() {
        this.callHistory = [];
        this.updateHistoryDisplay();
    };

    window.debugControlPanel.updateConfig = function(key, value) {
        this.config[key] = value;
        console.log(`🔧 Debug Config: ${key} = ${value}`);
    };

    window.debugControlPanel.showNotification = function(message) {
        // Simple notification (could be enhanced with better UI)
        const notification = document.createElement('div');
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: rgba(59, 130, 246, 0.95);
            color: white;
            padding: 12px 20px;
            border-radius: 8px;
            font-family: 'Courier New', monospace;
            font-size: 13px;
            z-index: 100000;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            animation: slideIn 0.3s ease;
        `;

        document.body.appendChild(notification);

        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    };

    // Keyboard shortcut: Ctrl+Shift+D
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.shiftKey && e.key === 'D') {
            e.preventDefault();
            window.debugControlPanel.toggle();
        }
    });

    // Auto-open on error
    window.addEventListener('error', (e) => {
        if (window.debugControlPanel.config.autoOpenOnError && !window.debugControlPanel.enabled) {
            window.debugControlPanel.toggle();
            window.debugControlPanel.showNotification('❌ Fehler erkannt! Debug Panel geöffnet.');
        }
    });

    // Initialize on load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            initDebugPanel();
            loadFunctionsIndex();
        });
    } else {
        initDebugPanel();
        loadFunctionsIndex();
    }

    console.log('🔍 Debug Control Panel loaded! Press Ctrl+Shift+D to toggle.');
    console.log('📚 Available commands:');
    console.log('  - window.debugControlPanel.monitorFunction("functionName")');
    console.log('  - window.debugControlPanel.stopMonitoring("functionName")');
    console.log('  - window.debugControlPanel.openFunctionExplorer()');
    console.log('  - window.debugControlPanel.openLogViewer()');

})();
