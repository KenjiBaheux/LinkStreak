// settings.js - Settings Logic

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Load Data
    const blockedUrls = await window.LinkyStorage.getBlockedUrls();
    const patterns = await window.LinkyStorage.getIgnoredPatterns();
    const ranking = await window.LinkyStorage.getRankingWeights();

    // 2. Render Lists
    renderIgnoredList(blockedUrls);
    renderPatternsList(patterns);
    setupPatternInput();

    // 3. Init Sliders
    // Sources
    initSlider('source-tabs', ranking.sources.tabs, (val) => updateRanking('sources', 'tabs', val));
    initSlider('source-history', ranking.sources.history, (val) => updateRanking('sources', 'history', val));
    initSlider('source-bookmarks', ranking.sources.bookmarks, (val) => updateRanking('sources', 'bookmarks', val));

    // Signals
    initSlider('signal-recency', ranking.signals.recency, (val) => updateRanking('signals', 'recency', val));
    initSlider('signal-frequency', ranking.signals.frequency, (val) => updateRanking('signals', 'frequency', val));
    initSlider('signal-semantic', ranking.signals.semantic, (val) => updateRanking('signals', 'semantic', val));

    // 4. Init Presets
    setupPresets();

    // 5. Sidebar Navigation
    setupNavigation();

    // 6. Init Retrieval Options
    initRetrievalOptions();
});

// --- Sliders & Ranking ---

function initSlider(idSuffix, initialValue, onChange) {
    const slider = document.getElementById(`slider-${idSuffix}`);
    const label = document.getElementById(`label-${idSuffix}`);
    const valueDisplay = document.getElementById(`val-${idSuffix}`);

    if (!slider) return;

    // Set initial
    slider.value = initialValue;
    valueDisplay.textContent = initialValue;
    updateLabelStyle(label, initialValue);

    slider.oninput = (e) => {
        const val = parseInt(e.target.value);
        valueDisplay.textContent = val;
        updateLabelStyle(label, val);
        onChange(val);
    };
}

function updateLabelStyle(label, value) {
    if (value === 0) {
        label.classList.add('ignored');
    } else {
        label.classList.remove('ignored');
    }
}

async function updateRanking(category, key, value) {
    const weights = await window.LinkyStorage.getRankingWeights();
    if (!weights[category]) weights[category] = {};
    weights[category][key] = value;
    await window.LinkyStorage.saveRankingWeights(weights);

    // Notify Sidepanel
    chrome.runtime.sendMessage({ action: "settings-updated" }).catch(() => { });
}

async function initRetrievalOptions() {
    const opts = await window.LinkyStorage.getRetrievalOptions();

    // Elements
    const inputHistory = document.getElementById('input-history-max');
    const checkWindow = document.getElementById('check-tabs-window');
    const checkPinned = document.getElementById('check-tabs-pinned');

    // Init Values
    if (inputHistory) inputHistory.value = opts.maxHistoryResults;
    if (checkWindow) checkWindow.checked = opts.currentWindowLimit;
    if (checkPinned) checkPinned.checked = opts.ignorePinnedTabs;

    // Listeners
    const save = async () => {
        const newOpts = {
            maxHistoryResults: parseInt(inputHistory.value) || 150,
            currentWindowLimit: checkWindow.checked,
            ignorePinnedTabs: checkPinned.checked
        };
        await window.LinkyStorage.saveRetrievalOptions(newOpts);
    };

    if (inputHistory) inputHistory.onchange = save;
    if (checkWindow) checkWindow.onchange = save;
    if (checkPinned) checkPinned.onchange = save;
}

function setupPresets() {
    const btnFreshness = document.getElementById('preset-freshness');
    const btnDiscovery = document.getElementById('preset-discovery');
    const btnBalanced = document.getElementById('preset-balanced');

    btnFreshness.onclick = () => applyPreset({
        sources: { tabs: 100, history: 40, bookmarks: 20 },
        signals: { recency: 100, frequency: 30, semantic: 70 }
    });

    btnDiscovery.onclick = () => applyPreset({
        sources: { tabs: 30, history: 100, bookmarks: 80 },
        signals: { recency: 20, frequency: 50, semantic: 100 }
    });

    btnBalanced.onclick = () => applyPreset({
        sources: { tabs: 70, history: 50, bookmarks: 50 },
        signals: { recency: 80, frequency: 60, semantic: 90 }
    });
}

async function applyPreset(preset) {
    await window.LinkyStorage.saveRankingWeights(preset);

    // Refresh UI
    const ranking = preset;

    // Helper to update UI without triggering save-loops
    const updateUI = (suffix, val) => {
        const slider = document.getElementById(`slider-${suffix}`);
        const label = document.getElementById(`label-${suffix}`);
        const valueDisplay = document.getElementById(`val-${suffix}`);

        slider.value = val;
        valueDisplay.textContent = val;
        updateLabelStyle(label, val);
    };

    updateUI('source-tabs', ranking.sources.tabs);
    updateUI('source-history', ranking.sources.history);
    updateUI('source-bookmarks', ranking.sources.bookmarks);

    updateUI('signal-recency', ranking.signals.recency);
    updateUI('signal-frequency', ranking.signals.frequency);
    updateUI('signal-semantic', ranking.signals.semantic);

    chrome.runtime.sendMessage({ action: "settings-updated" }).catch(() => { });
}


// --- Pattern Logic ---

function setupPatternInput() {
    const input = document.getElementById('pattern-input');
    const btn = document.getElementById('add-pattern-btn');

    btn.onclick = async () => {
        const val = input.value.trim();
        if (!val) return;

        const patterns = await window.LinkyStorage.getIgnoredPatterns();
        if (!patterns.includes(val)) {
            patterns.push(val);
            await window.LinkyStorage.saveIgnoredPatterns(patterns);
            renderPatternsList(patterns);
            input.value = '';

            // Notify Sidepanel
            chrome.runtime.sendMessage({ action: "settings-updated" }).catch(() => { });
        }
    };
}

function renderPatternsList(patterns) {
    const container = document.getElementById('patterns-list');
    container.innerHTML = '';

    if (patterns.length === 0) {
        container.innerHTML = `<div class="empty-state" style="padding: 20px; text-align: center; color: var(--text-dim);">No patterns set.</div>`;
        return;
    }

    patterns.forEach(pattern => {
        const div = document.createElement('div');
        div.className = 'data-item';
        div.innerHTML = `
            <div class="data-info">
                <div class="data-title" style="font-family: monospace;">${escapeHTML(pattern)}</div>
            </div>
            <button class="remove-pattern btn-restore" style="color: var(--danger); border-color: var(--danger);">Remove</button>
        `;

        div.querySelector('.remove-pattern').onclick = async () => {
            const current = await window.LinkyStorage.getIgnoredPatterns();
            const updated = current.filter(p => p !== pattern);
            await window.LinkyStorage.saveIgnoredPatterns(updated);
            renderPatternsList(updated);

            // Notify Sidepanel
            chrome.runtime.sendMessage({ action: "settings-updated" }).catch(() => { });
        };

        container.appendChild(div);
    });
}

// --- List Renderers ---

function renderIgnoredList(items) {
    const container = document.getElementById('ignored-list');
    container.innerHTML = '';

    if (items.length === 0) {
        container.innerHTML = `<div class="empty-state" style="padding: 20px; text-align: center; color: var(--text-dim);">No ignored links.</div>`;
        return;
    }

    items.forEach(item => {
        // Handle migration (if strictly string) or object
        const url = (typeof item === 'string') ? item : item.url;
        const title = (typeof item === 'string') ? 'Unknown Page' : (item.title || 'Unknown Page');

        const div = document.createElement('div');
        div.className = 'data-item';
        div.innerHTML = `
            <div class="data-info">
                <div class="data-title" title="${escapeHTML(title)}">${escapeHTML(title)}</div>
                <div class="data-url" title="${escapeHTML(url)}">${escapeHTML(url)}</div>
            </div>
            <button class="btn-restore">Restore</button>
        `;

        div.querySelector('.btn-restore').onclick = async () => {
            await window.LinkyStorage.restoreIgnoredLink(url);
            div.style.opacity = '0';
            div.style.transform = 'translateX(20px)';
            setTimeout(() => div.remove(), 300);

            // If empty after remove (check visual children count - 1)
            if (container.querySelectorAll('.data-item').length <= 1) {
                container.innerHTML = `<div class="empty-state" style="padding: 20px; text-align: center; color: var(--text-dim);">No ignored links.</div>`;
            }

            // Notify Sidepanel
            chrome.runtime.sendMessage({ action: "settings-updated" }).catch(() => { });
        };

        container.appendChild(div);
    });
}

function escapeHTML(str) {
    return str.replace(/[&<>'"]/g,
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag]));
}

function setupNavigation() {
    const links = document.querySelectorAll('.settings-nav-item');
    links.forEach(link => {
        link.onclick = () => {
            // UI Toggle
            links.forEach(l => l.classList.remove('active'));
            link.classList.add('active');

            // Scroll to section
            const targetId = link.getAttribute('data-target');
            document.getElementById(targetId).scrollIntoView({ behavior: 'smooth' });
        };
    });
}
