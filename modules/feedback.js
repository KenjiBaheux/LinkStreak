// feedback.js
window.LinkyFeedback = {
    async ignoreUrl(url) {
        const blocked = await window.LinkyStorage.getBlockedUrls();
        if (!blocked.includes(url)) {
            blocked.push(url);
            await chrome.storage.local.set({ blockedUrls: blocked });
        }
    },

    isSystemPage(url) {
        const systemProtocols = ['chrome://', 'edge://', 'about:', 'brave://'];
        return systemProtocols.some(p => url.startsWith(p));
    }
};