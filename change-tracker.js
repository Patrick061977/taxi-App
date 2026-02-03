/**
 * 📝 CHANGE TRACKER SYSTEM
 *
 * Automatisches Tracking aller Änderungen für bessere Dokumentation
 *
 * Features:
 * - Änderungen automatisch in CHANGELOG.md schreiben
 * - IndexedDB für Change-History
 * - Erfolg/Fehler-Tracking
 * - Rollback-Informationen
 * - Versions-Management
 *
 * Usage:
 * window.changeTracker.addChange({
 *     type: 'added|changed|fixed|removed|deprecated|security',
 *     category: 'booking|gps|route|payment|ui|database|...',
 *     title: 'Kurze Beschreibung',
 *     description: 'Detaillierte Beschreibung',
 *     files: ['file1.js', 'file2.html'],
 *     success: true/false,
 *     rollbackInfo: 'Wie rückgängig machen'
 * })
 */

(function() {
    'use strict';

    // Global Change Tracker
    window.changeTracker = {
        version: '1.0.0',
        db: null,
        changes: [],
        currentVersion: '5.90.880',

        // Change Types
        types: {
            ADDED: 'added',
            CHANGED: 'changed',
            FIXED: 'fixed',
            REMOVED: 'removed',
            DEPRECATED: 'deprecated',
            SECURITY: 'security'
        },

        // Categories
        categories: {
            BOOKING: 'booking',
            GPS: 'gps',
            ROUTE: 'route',
            PAYMENT: 'payment',
            UI: 'ui',
            DATABASE: 'database',
            NETWORK: 'network',
            AUTH: 'auth',
            PERFORMANCE: 'performance',
            DEBUG: 'debug',
            SYSTEM: 'system'
        }
    };

    // Initialize IndexedDB
    function initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('TaxiAppChanges', 1);

            request.onerror = () => {
                console.error('❌ Change Tracker: Failed to open IndexedDB');
                reject(request.error);
            };

            request.onsuccess = () => {
                window.changeTracker.db = request.result;
                console.log('✅ Change Tracker: IndexedDB ready');
                resolve(request.result);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // Changes Store
                if (!db.objectStoreNames.contains('changes')) {
                    const store = db.createObjectStore('changes', { keyPath: 'id', autoIncrement: true });
                    store.createIndex('timestamp', 'timestamp', { unique: false });
                    store.createIndex('version', 'version', { unique: false });
                    store.createIndex('type', 'type', { unique: false });
                    store.createIndex('category', 'category', { unique: false });
                    store.createIndex('success', 'success', { unique: false });
                }

                // Versions Store
                if (!db.objectStoreNames.contains('versions')) {
                    const versionStore = db.createObjectStore('versions', { keyPath: 'version' });
                    versionStore.createIndex('timestamp', 'timestamp', { unique: false });
                }
            };
        });
    }

    // Add Change
    window.changeTracker.addChange = async function(changeData) {
        if (!this.db) {
            await initDB();
        }

        const change = {
            timestamp: Date.now(),
            date: new Date().toISOString(),
            version: this.currentVersion,
            type: changeData.type || this.types.CHANGED,
            category: changeData.category || this.categories.SYSTEM,
            title: changeData.title || 'Unbenannte Änderung',
            description: changeData.description || '',
            files: changeData.files || [],
            success: changeData.success !== undefined ? changeData.success : true,
            error: changeData.error || null,
            rollbackInfo: changeData.rollbackInfo || '',
            author: changeData.author || 'System',
            sessionId: window.advancedLogger?.sessionId || 'unknown',
            metadata: changeData.metadata || {}
        };

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['changes'], 'readwrite');
            const store = transaction.objectStore('changes');
            const request = store.add(change);

            request.onsuccess = () => {
                change.id = request.result;
                this.changes.unshift(change);

                console.log('✅ Change tracked:', change.title);

                // Log to Advanced Logger
                if (window.advancedLogger) {
                    window.advancedLogger.info(
                        this.categories.SYSTEM,
                        `Change tracked: ${change.title}`,
                        {
                            type: change.type,
                            category: change.category,
                            files: change.files,
                            success: change.success
                        }
                    );
                }

                // Show notification
                this.showNotification(`✅ ${this.getTypeIcon(change.type)} ${change.title}`);

                resolve(change);
            };

            request.onerror = () => {
                console.error('❌ Failed to track change:', request.error);
                reject(request.error);
            };
        });
    };

    // Get All Changes
    window.changeTracker.getChanges = async function(filters = {}) {
        if (!this.db) {
            await initDB();
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['changes'], 'readonly');
            const store = transaction.objectStore('changes');
            const request = store.getAll();

            request.onsuccess = () => {
                let changes = request.result;

                // Apply filters
                if (filters.type) {
                    changes = changes.filter(c => c.type === filters.type);
                }
                if (filters.category) {
                    changes = changes.filter(c => c.category === filters.category);
                }
                if (filters.success !== undefined) {
                    changes = changes.filter(c => c.success === filters.success);
                }
                if (filters.version) {
                    changes = changes.filter(c => c.version === filters.version);
                }
                if (filters.startDate) {
                    changes = changes.filter(c => c.timestamp >= new Date(filters.startDate).getTime());
                }
                if (filters.endDate) {
                    changes = changes.filter(c => c.timestamp <= new Date(filters.endDate).getTime());
                }

                // Sort by timestamp desc
                changes.sort((a, b) => b.timestamp - a.timestamp);

                resolve(changes);
            };

            request.onerror = () => reject(request.error);
        });
    };

    // Get Statistics
    window.changeTracker.getStatistics = async function() {
        const changes = await this.getChanges();

        return {
            total: changes.length,
            byType: {
                added: changes.filter(c => c.type === this.types.ADDED).length,
                changed: changes.filter(c => c.type === this.types.CHANGED).length,
                fixed: changes.filter(c => c.type === this.types.FIXED).length,
                removed: changes.filter(c => c.type === this.types.REMOVED).length,
                deprecated: changes.filter(c => c.type === this.types.DEPRECATED).length,
                security: changes.filter(c => c.type === this.types.SECURITY).length
            },
            byCategory: this.groupBy(changes, 'category'),
            bySuccess: {
                successful: changes.filter(c => c.success === true).length,
                failed: changes.filter(c => c.success === false).length
            },
            today: changes.filter(c => {
                const today = new Date().toDateString();
                return new Date(c.timestamp).toDateString() === today;
            }).length,
            thisWeek: changes.filter(c => {
                const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
                return c.timestamp >= weekAgo;
            }).length
        };
    };

    // Export to CHANGELOG.md format
    window.changeTracker.exportToChangelog = async function(version) {
        const changes = await this.getChanges({ version: version || this.currentVersion });

        if (changes.length === 0) {
            return '## [' + (version || this.currentVersion) + '] - ' + new Date().toISOString().split('T')[0] + '\n\nKeine Änderungen dokumentiert.\n\n---\n\n';
        }

        // Group by type
        const grouped = {
            [this.types.ADDED]: [],
            [this.types.CHANGED]: [],
            [this.types.FIXED]: [],
            [this.types.REMOVED]: [],
            [this.types.DEPRECATED]: [],
            [this.types.SECURITY]: []
        };

        changes.forEach(change => {
            grouped[change.type].push(change);
        });

        // Build markdown
        let md = `## [${version || this.currentVersion}] - ${new Date().toISOString().split('T')[0]}\n\n`;

        // Added
        if (grouped[this.types.ADDED].length > 0) {
            md += '### ✅ Hinzugefügt\n';
            grouped[this.types.ADDED].forEach(change => {
                md += `- **${change.title}**`;
                if (change.description) {
                    md += `\n  - ${change.description}`;
                }
                if (change.files && change.files.length > 0) {
                    md += `\n  - Files: ${change.files.join(', ')}`;
                }
                if (!change.success) {
                    md += `\n  - ⚠️ Status: Fehlgeschlagen - ${change.error || 'Unbekannter Fehler'}`;
                }
                md += '\n';
            });
            md += '\n';
        }

        // Changed
        if (grouped[this.types.CHANGED].length > 0) {
            md += '### 🔧 Geändert\n';
            grouped[this.types.CHANGED].forEach(change => {
                md += `- **${change.title}**`;
                if (change.description) {
                    md += `\n  - ${change.description}`;
                }
                if (!change.success) {
                    md += `\n  - ⚠️ Status: Fehlgeschlagen`;
                }
                md += '\n';
            });
            md += '\n';
        }

        // Fixed
        if (grouped[this.types.FIXED].length > 0) {
            md += '### 🐛 Behoben\n';
            grouped[this.types.FIXED].forEach(change => {
                md += `- ${change.title}`;
                if (change.description) {
                    md += `\n  - ${change.description}`;
                }
                md += '\n';
            });
            md += '\n';
        }

        // Removed
        if (grouped[this.types.REMOVED].length > 0) {
            md += '### 🗑️ Entfernt\n';
            grouped[this.types.REMOVED].forEach(change => {
                md += `- ${change.title}`;
                if (change.rollbackInfo) {
                    md += `\n  - Rollback: ${change.rollbackInfo}`;
                }
                md += '\n';
            });
            md += '\n';
        }

        // Deprecated
        if (grouped[this.types.DEPRECATED].length > 0) {
            md += '### ⚠️ Veraltet\n';
            grouped[this.types.DEPRECATED].forEach(change => {
                md += `- ${change.title}\n`;
            });
            md += '\n';
        }

        // Security
        if (grouped[this.types.SECURITY].length > 0) {
            md += '### 🔒 Security\n';
            grouped[this.types.SECURITY].forEach(change => {
                md += `- ${change.title}\n`;
            });
            md += '\n';
        }

        md += '---\n\n';

        return md;
    };

    // Download CHANGELOG update
    window.changeTracker.downloadChangelogUpdate = async function(version) {
        const md = await this.exportToChangelog(version);

        const blob = new Blob([md], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `CHANGELOG-${version || this.currentVersion}.md`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        this.showNotification('✅ CHANGELOG heruntergeladen!');
    };

    // Export Changes to JSON
    window.changeTracker.exportJSON = async function(filters = {}) {
        const changes = await this.getChanges(filters);

        if (changes.length === 0) {
            alert('⚠️ Keine Changes zum Exportieren gefunden!');
            return;
        }

        const content = JSON.stringify(changes, null, 2);
        const filename = `change-logs-${new Date().toISOString().split('T')[0]}.json`;
        const mimeType = 'application/json';

        this.downloadFile(content, filename, mimeType);
        this.showNotification(`✅ ${changes.length} Changes als JSON exportiert!`);
    };

    // Export Changes to CSV
    window.changeTracker.exportCSV = async function(filters = {}) {
        const changes = await this.getChanges(filters);

        if (changes.length === 0) {
            alert('⚠️ Keine Changes zum Exportieren gefunden!');
            return;
        }

        // CSV Headers
        const headers = ['Timestamp', 'Date', 'Version', 'Type', 'Category', 'Title', 'Description', 'Files', 'Success', 'Error'];

        // CSV Rows
        const rows = changes.map(c => [
            new Date(c.timestamp).toISOString(),
            c.date,
            c.version,
            c.type,
            c.category,
            `"${(c.title || '').replace(/"/g, '""')}"`,
            `"${(c.description || '').replace(/"/g, '""')}"`,
            `"${(c.files || []).join(', ')}"`,
            c.success ? 'Yes' : 'No',
            `"${(c.error || '').replace(/"/g, '""')}"`
        ]);

        const content = [headers, ...rows].map(row => row.join(',')).join('\n');
        const filename = `change-logs-${new Date().toISOString().split('T')[0]}.csv`;
        const mimeType = 'text/csv';

        this.downloadFile(content, filename, mimeType);
        this.showNotification(`✅ ${changes.length} Changes als CSV exportiert!`);
    };

    // Export Changes to TXT
    window.changeTracker.exportTXT = async function(filters = {}) {
        const changes = await this.getChanges(filters);

        if (changes.length === 0) {
            alert('⚠️ Keine Changes zum Exportieren gefunden!');
            return;
        }

        const content = changes.map(c => {
            const time = new Date(c.timestamp).toISOString();
            const icon = this.getTypeIcon(c.type);
            let text = `[${time}] ${icon} ${c.type.toUpperCase()} - ${c.category}\n`;
            text += `Title: ${c.title}\n`;
            if (c.description) {
                text += `Description: ${c.description}\n`;
            }
            if (c.files && c.files.length > 0) {
                text += `Files: ${c.files.join(', ')}\n`;
            }
            text += `Version: ${c.version}\n`;
            text += `Status: ${c.success ? 'Success ✅' : 'Failed ❌'}\n`;
            if (c.error) {
                text += `Error: ${c.error}\n`;
            }
            text += '\n---\n\n';
            return text;
        }).join('');

        const filename = `change-logs-${new Date().toISOString().split('T')[0]}.txt`;
        const mimeType = 'text/plain';

        this.downloadFile(content, filename, mimeType);
        this.showNotification(`✅ ${changes.length} Changes als TXT exportiert!`);
    };

    // Helper: Download File
    window.changeTracker.downloadFile = function(content, filename, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    // Helper: Group by property
    window.changeTracker.groupBy = function(array, key) {
        return array.reduce((result, item) => {
            const value = item[key];
            result[value] = (result[value] || 0) + 1;
            return result;
        }, {});
    };

    // Helper: Get type icon
    window.changeTracker.getTypeIcon = function(type) {
        const icons = {
            [this.types.ADDED]: '✅',
            [this.types.CHANGED]: '🔧',
            [this.types.FIXED]: '🐛',
            [this.types.REMOVED]: '🗑️',
            [this.types.DEPRECATED]: '⚠️',
            [this.types.SECURITY]: '🔒'
        };
        return icons[type] || '📝';
    };

    // Helper: Show notification
    window.changeTracker.showNotification = function(message) {
        if (!window.debugControlPanel?.config.showNotifications) return;

        const notification = document.createElement('div');
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 80px;
            right: 20px;
            background: rgba(16, 185, 129, 0.95);
            color: white;
            padding: 12px 20px;
            border-radius: 8px;
            font-family: 'Courier New', monospace;
            font-size: 13px;
            z-index: 100001;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            animation: slideIn 0.3s ease;
        `;

        document.body.appendChild(notification);

        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    };

    // Quick Add Methods
    window.changeTracker.added = function(title, description, files = []) {
        return this.addChange({
            type: this.types.ADDED,
            title,
            description,
            files,
            success: true
        });
    };

    window.changeTracker.changed = function(title, description, files = []) {
        return this.addChange({
            type: this.types.CHANGED,
            title,
            description,
            files,
            success: true
        });
    };

    window.changeTracker.fixed = function(title, description, files = []) {
        return this.addChange({
            type: this.types.FIXED,
            title,
            description,
            files,
            success: true
        });
    };

    window.changeTracker.failed = function(title, error, files = []) {
        return this.addChange({
            type: this.types.FIXED,
            title,
            description: 'Versuch zu beheben',
            files,
            success: false,
            error
        });
    };

    // Initialize on load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            initDB();
        });
    } else {
        initDB();
    }

    console.log('📝 Change Tracker loaded!');
    console.log('Usage:');
    console.log('  - window.changeTracker.added("Title", "Description", ["file.js"])');
    console.log('  - window.changeTracker.changed("Title", "Description")');
    console.log('  - window.changeTracker.fixed("Bug Title", "How fixed")');
    console.log('  - window.changeTracker.exportToChangelog()');
    console.log('  - window.changeTracker.downloadChangelogUpdate()');

})();
