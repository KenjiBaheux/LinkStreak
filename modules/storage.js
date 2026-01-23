// storage.js - Central Data Management
window.LinkyStorage = {
    async getQueue() {
        const data = await chrome.storage.local.get(['activeQueue']);
        return data.activeQueue || [];
    },

    async saveQueue(queue) {
        await chrome.storage.local.set({ activeQueue: queue });
        // Notify background script to update badge/commands
        chrome.runtime.sendMessage({ action: "update-queue", queue }).catch(() => { });
    },

    async getBlockedUrls() {
        // Returns array of { url: string, title: string }
        const data = await chrome.storage.local.get(['blockedUrls']);
        if (!data.blockedUrls) return [];

        // Migration: If any item is a string, convert to object
        const normalized = data.blockedUrls.map(item => {
            if (typeof item === 'string') {
                return { url: item, title: 'Unknown Page' };
            }
            return item;
        });

        return normalized;
    },

    async blockUrl(link) {
        // Accepts link object or url string
        const urlToCheck = typeof link === 'string' ? link : link.url;
        const titleToSave = typeof link === 'string' ? 'Unknown Page' : (link.title || 'Unknown Page');

        const blocked = await this.getBlockedUrls();
        // Remove the pattern if it already exists so we can "move" it to the top
        blocked = blocked.filter(item => item.url !== urlToCheck);
        // Prepend the new pattern to the beginning of the array
        blocked.unshift({ url: urlToCheck, title: titleToSave });
        await chrome.storage.local.set({ blockedUrls: blocked });
    },

    async blockDomain(link) {
        const urlToBlock = typeof link === 'string' ? link : link.url;
        try {
            const urlObj = new URL(urlToBlock);
            const domainPattern = `*://${urlObj.hostname}/*`;

            const patterns = await this.getIgnoredPatterns();
            // Remove the pattern if it already exists so we can "move" it to the top
            patterns = patterns.filter(p => p !== domainPattern);
            // Prepend the new pattern to the beginning of the array
            patterns.unshift(domainPattern);
            await this.saveIgnoredPatterns(patterns);
        } catch (e) {
            console.error("Failed to block domain for URL:", urlToBlock, e);
        }
    },

    async getSearchPreferences() {
        const data = await chrome.storage.local.get(['searchPrefs']);
        return data.searchPrefs || { weight: 30 };
    },

    async saveSearchPreferences(prefs) {
        const current = await this.getSearchPreferences();
        const updated = { ...current, ...prefs };
        await chrome.storage.local.set({ searchPrefs: updated });
    },

    // --- Settings Page Support ---

    async getSettings() {
        const defaults = {
            sources: {
                tabs: true,
                history: true,
                bookmarks: true,
                tabGroups: false
            },
            behavior: {
                persistStreak: true,
                contextRadius: 3
            }
        };
        const data = await chrome.storage.local.get(['userSettings']);
        return { ...defaults, ...data.userSettings };
    },

    async saveSettings(settings) {
        await chrome.storage.local.set({ userSettings: settings });
    },

    async restoreIgnoredLink(url) {
        const blocked = await this.getBlockedUrls();
        const newBlocked = blocked.filter(item => item.url !== url);
        await chrome.storage.local.set({ blockedUrls: newBlocked });
    },

    // --- Pattern Matching ---

    async getIgnoredPatterns() {
        const data = await chrome.storage.local.get(['ignoredPatterns']);
        // Defaults if not set
        if (!data.ignoredPatterns) {
            const defaults = [
                'chrome://*',
                'chrome-extension://*',
                'edge://*',
                'about:*',
                '*google.com/search*',
                '*bing.com/search*',
                '*duckduckgo.com/*',
                'file://*'
            ];
            await this.saveIgnoredPatterns(defaults);
            return defaults;
        }
        return data.ignoredPatterns;
    },

    async saveIgnoredPatterns(patterns) {
        await chrome.storage.local.set({ ignoredPatterns: patterns });
    },

    async isUrlIgnored(url) {
        // 1. Check specific blocklist
        const blocked = await this.getBlockedUrls();
        if (blocked.some(item => item.url === url)) return true;

        // 2. Check patterns
        const patterns = await this.getIgnoredPatterns();
        return patterns.some(pattern => this._matchPattern(pattern, url));
    },

    _matchPattern(pattern, url) {
        // Simple wildcard matcher (* = anything)
        const regexInfo = pattern.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        const regex = new RegExp(`^${regexInfo.join('.*')}$`);
        return regex.test(url);
    },

    async getRankingWeights() {
        const data = await chrome.storage.local.get(['pref_ranking_weights']);
        const defaults = {
            sources: {
                tabs: 70,
                history: 50,
                bookmarks: 50
            },
            signals: {
                recency: 80,
                frequency: 60,
                semantic: 90
            }
        };
        // Deep merge defaults with stored data
        if (!data.pref_ranking_weights) return defaults;
        return {
            sources: { ...defaults.sources, ...data.pref_ranking_weights.sources },
            signals: { ...defaults.signals, ...data.pref_ranking_weights.signals }
        };
    },

    async saveRankingWeights(weights) {
        await chrome.storage.local.set({ pref_ranking_weights: weights });
    },

    async getRetrievalOptions() {
        const data = await chrome.storage.local.get(['retrievalOptions']);
        const defaults = {
            maxHistoryResults: 150,
            currentWindowLimit: false,
            ignorePinnedTabs: true,
            localOnly: false
        };
        return { ...defaults, ...data.retrievalOptions };
    },

    async saveRetrievalOptions(options) {
        await chrome.storage.local.set({ retrievalOptions: options });
    },

    async getMetadataIndex() {
        const data = await chrome.storage.local.get(['linky_vector_cache']);
        return data.linky_vector_cache || {};
    },

    async updateMetadata(url, newData) {
        const index = await this.getMetadataIndex();
        if (index[url]) {
            index[url] = { ...index[url], ...newData };
            await chrome.storage.local.set({ linky_vector_cache: index });
        }
    },

    async getSidepanelUIPrefs() {
        const data = await chrome.storage.local.get(['sidepanelUIPrefs']);
        const defaults = {
            filters: {
                tabs: true,
                history: true,
                bookmarks: true,
                trackedOnly: false
            },
            sortOrder: 'finalScore'
        };
        return { ...defaults, ...data.sidepanelUIPrefs };
    },

    async saveSidepanelUIPrefs(prefs) {
        const current = await this.getSidepanelUIPrefs();
        const updated = { ...current, ...prefs };
        await chrome.storage.local.set({ sidepanelUIPrefs: updated });
    },

    async getPoisonKeywords() {
        const data = await chrome.storage.local.get(['poison_keywords']);
        if (!data.poison_keywords) {
            const defaults = [
                { word: 'login', level: 'soft' },
                { word: 'ログイン', level: 'soft' },
                { word: 'sign in', level: 'soft' }
            ];
            await this.savePoisonKeywords(defaults);
            return defaults;
        }
        return data.poison_keywords;
    },

    async savePoisonKeywords(keywords) {
        await chrome.storage.local.set({ poison_keywords: keywords });
    }
};