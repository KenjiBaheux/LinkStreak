// sidepanel.js - Main Logic Controller
let currentBrowserData = { history: [], tabs: [] };
let activeContext = { text: "", weight: 30 };

document.addEventListener('DOMContentLoaded', async () => {
    // 1. AI Engine Warmup
    if (window.linkyAIEngine) await window.linkyAIEngine.init();

    // 2. Initial Data Load
    const lastData = await chrome.runtime.sendMessage({ action: "get-last-selection" });
    const prefs = await window.LinkyStorage.getSearchPreferences();
    const uiPrefs = await window.LinkyStorage.getSidepanelUIPrefs();

    // Restore persistent weight
    activeContext.weight = prefs.weight;

    // Restore UI Prefs
    applyUIPrefs(uiPrefs);

    if (lastData && lastData.focus) {
        updateUnifiedSearch(lastData.focus, lastData.extra, activeContext.weight);
    }

    setupUnifiedListeners();

    // 3. Initialize Drag & Drop AND Resizer
    LinkyUI.initDragListeners(handleDropReorder);
    LinkyUI.setupResizer();
});

function applyUIPrefs(uiPrefs) {
    // 1. Filters
    const buttons = document.querySelectorAll('.filter-btn');
    buttons.forEach(btn => {
        const source = btn.dataset.source;
        if (uiPrefs.filters && uiPrefs.filters[source] !== undefined) {
            btn.classList.toggle('active', uiPrefs.filters[source]);
        }
    });

    // 2. Sort Order
    const sortSelect = document.getElementById('sort-order');
    if (sortSelect && uiPrefs.sortOrder) {
        sortSelect.value = uiPrefs.sortOrder;
    }
}

function setupUnifiedListeners() {
    const editor = document.getElementById('focus-editor');
    const chip = document.getElementById('context-chip');

    // Handle inline focus editing
    editor.oninput = () => {
        clearTimeout(window.searchDebounce);
        window.searchDebounce = setTimeout(() => triggerUnifiedSearch(), 500);
    };

    // Chip Interactions
    chip.onclick = () => {
        // Use the currently active (and potentially saved) weight
        window.LinkyUI_Controller.openAdvancedSettings(activeContext.text, activeContext.weight);
    };

    chip.querySelector('.chip-remove').onclick = (e) => {
        e.stopPropagation();
        updateActiveContext("", activeContext.weight);
        triggerUnifiedSearch();
    };

    // Listen for updates from the modal
    window.addEventListener('context-updated', async (e) => {
        const { context, weight } = e.detail;

        // Save the new weight as a preference
        await window.LinkyStorage.saveSearchPreferences({ weight: parseInt(weight) });

        // Update state and UI
        updateActiveContext(context, parseInt(weight));

        // Changing settings implies a new search
        triggerUnifiedSearch();
    });

    // Source Filters
    setupSourceFilters();

    const clearQueueBtn = document.getElementById('clear-queue');
    if (clearQueueBtn) {
        clearQueueBtn.onclick = handleClearQueue;
    }

    // Settings Button
    const settingsBtn = document.getElementById('open-settings');
    if (settingsBtn) {
        settingsBtn.onclick = () => {
            if (chrome.runtime.openOptionsPage) {
                chrome.runtime.openOptionsPage();
            } else {
                window.open(chrome.runtime.getURL('ui/settings.html'));
            }
        };
    }
}

function setupSourceFilters() {
    const buttons = document.querySelectorAll('.filter-btn');
    buttons.forEach(btn => {
        btn.onclick = async () => {
            btn.classList.toggle('active');

            // Save state
            const source = btn.dataset.source;
            const isActive = btn.classList.contains('active');
            const uiPrefs = await window.LinkyStorage.getSidepanelUIPrefs();
            uiPrefs.filters[source] = isActive;
            await window.LinkyStorage.saveSidepanelUIPrefs(uiPrefs);

            // Debounced Search
            clearTimeout(window.filterDebounce);
            window.filterDebounce = setTimeout(() => {
                triggerUnifiedSearch();
            }, 300);
        };
    });

    const sortSelect = document.getElementById('sort-order');
    if (sortSelect) {
        sortSelect.onchange = async () => {
            // Save state
            const uiPrefs = await window.LinkyStorage.getSidepanelUIPrefs();
            uiPrefs.sortOrder = sortSelect.value;
            await window.LinkyStorage.saveSidepanelUIPrefs(uiPrefs);

            applySortAndRender();
        };
    }
}

// --- CENTRALIZED STATE MANAGEMENT ---

function checkRedundancy(focus, context) {
    if (!context || !focus) return context;

    // Normalize for "almost identical" check (ignore case, punctuation, whitespace)
    const clean = (str) => str.toLowerCase().replace(/[^a-z0-9]/g, '');

    const nFocus = clean(focus);
    const nContext = clean(context);

    // Safety check for empty strings after cleaning
    if (!nFocus || !nContext) return context;

    // 1. Exact Match (ignoring punctuation/case)
    if (nFocus === nContext) return null;

    // 2. Subset Match: If the Focus *contains* the Context, the Context adds no value.
    if (nFocus.includes(nContext)) return null;

    return context;
}

function updateActiveContext(rawText, weight) {
    const focus = document.getElementById('focus-editor').textContent;
    const cleanText = checkRedundancy(focus, rawText);

    activeContext.text = cleanText || "";
    activeContext.weight = weight;

    // Direct UI update
    window.LinkyUI_Controller.updateChipUI(activeContext.text, activeContext.weight);
}

// Global update for both selection and modal changes
function updateUnifiedSearch(focus, extra, weight = 30) {
    document.getElementById('focus-editor').textContent = focus;
    updateActiveContext(extra, weight);
    triggerUnifiedSearch();
}

async function triggerUnifiedSearch() {
    const query = document.getElementById('focus-editor').textContent;
    const ambient = activeContext.text; // Use trusted state

    // Dynamic Complementary Weights
    // Context Weight = slider value / 100 (e.g. 30 -> 0.3)
    // Focus Weight = 1.0 - Context Weight (e.g. 0.7)
    const contextW = activeContext.weight / 100;
    const focusW = 1.0 - contextW;

    const weights = {
        focusWeight: parseFloat(focusW.toFixed(2)),
        contextWeight: parseFloat(contextW.toFixed(2))
    };

    await performSearch(query, ambient, weights);
}

// --- CORE LOGIC ---
async function performSearch(query, ambient = null, params = null) {
    const resultsList = document.getElementById('results-list');
    if (!query?.trim()) {
        resultsList.innerHTML = `<div class="empty-state"><p>Select text to begin.</p></div>`;
        return;
    }

    resultsList.innerHTML = `<div class="analyzing-text">AI is mapping context...</div>`;

    // 0. Load Weights & Data
    const weights = await window.LinkyStorage.getRankingWeights();
    const [cache, poisonKeywords, _] = await Promise.all([
        window.LinkyStorage.getMetadataIndex(),
        window.LinkyStorage.getPoisonKeywords(),
        refreshBrowserData()
    ]);

    // flattened list with source type tagged and METADATA merged
    const allLinks = [
        ...currentBrowserData.tabs.map(t => ({ ...t, sourceType: 'tabs' })),
        ...currentBrowserData.history.map(h => ({ ...h, sourceType: 'history' })),
        ...(currentBrowserData.bookmarks || []).map(b => ({ ...b, sourceType: 'bookmarks' }))
    ].map(link => {
        const meta = cache[link.url];
        return meta ? { ...link, ...meta, isTracked: true } : { ...link, isTracked: false };
    });

    // 1. Filter by Active Sources & Source Weights first
    // This prevents a disabled source (e.g. Tabs) from "blocking" an enabled source (e.g. History) during dedup
    const sourceMatchedLinks = allLinks.filter(link => {
        // Check UI Toggle
        const filterBtn = document.querySelector(`.filter-btn[data-source="${link.sourceType}"]`);
        if (filterBtn && !filterBtn.classList.contains('active')) return false;

        // Check Source Weight
        const sourceWeight = weights.sources[link.sourceType] || 0;
        if (sourceWeight === 0) return false;

        return true;
    });

    // 2. Dedup (keeps the first occurrence, which respects the [Tabs, History, Bookmarks] priority order)
    const uniqueLinks = sourceMatchedLinks.filter((v, i, a) => a.findIndex(t => (t.url === v.url)) === i);

    // 3. Filter Ignored & Indexed-Only
    const checks = await Promise.all(uniqueLinks.map(async link => {
        const isIgnored = await window.LinkyStorage.isUrlIgnored(link.url);

        // Check "Indexed" filter
        const trackedOnlyBtn = document.querySelector('.filter-btn[data-source="trackedOnly"]');
        if (trackedOnlyBtn && trackedOnlyBtn.classList.contains('active') && !link.isTracked) return null;

        return isIgnored ? null : link;
    }));

    const validLinks = checks.filter(link => link !== null);

    if (validLinks.length === 0) {
        resultsList.innerHTML = `<div class="empty-state"><p>No results match your filters.</p></div>`;
        return;
    }

    // 4. AI Semantic Search
    let aiResults;
    if (ambient) {
        aiResults = await window.linkyAIEngine.searchWithContext(query, ambient, {
            links: validLinks,
            focusWeight: params?.focusWeight,
            contextWeight: params?.contextWeight
        });
    } else {
        // Keyword / Zero-Shot
        aiResults = await window.linkyAIEngine.findRelevantLinks(query, validLinks);
    }

    // 4. Weighted Re-Ranking
    const rankedResults = aiResults.map(item => {
        const link = item.link;
        const semanticScore = item.score; // 0 to 1

        // Normalize Recency (0 to 1) - Exponential decay
        const now = Date.now();
        const daysSince = (now - (link.lastVisitTime || now)) / (1000 * 60 * 60 * 24);
        const recencyScore = Math.exp(-0.2 * daysSince);

        // Normalize Frequency (0 to 1) - Log scale
        const visits = link.visitCount || 1;
        const freqScore = Math.min(Math.log10(visits) / 2, 1);

        // Apply User Weights (0-100 mapped to 0-1 multipliers)
        const wSemantic = (weights.signals.semantic / 100);
        const wRecency = (weights.signals.recency / 100);
        const wFreq = (weights.signals.frequency / 100);
        const wSource = (weights.sources[link.sourceType] || 0) / 100;

        // --- NEW: Density Penalty ---
        const metaText = (link.title || "") + (link.description || "") + (link.headings || link.h1 || "");
        let densityMultiplier = 1.0;
        if (metaText.length < 60) densityMultiplier *= 0.6; // 40% penalty
        if (!link.description || link.description.trim().length === 0) densityMultiplier *= 0.8; // 20% penalty

        // --- NEW: Poison Multiplier ---
        let poisonMultiplier = 1.0;
        const metaLower = metaText.toLowerCase();
        for (const k of poisonKeywords) {
            if (metaLower.includes(k.word.toLowerCase())) {
                if (k.level === 'muted') { poisonMultiplier = 0; break; }
                if (k.level === 'hard') poisonMultiplier *= 0.1;
                if (k.level === 'soft') poisonMultiplier *= 0.3;
            }
        }

        if (poisonMultiplier === 0) return null;

        // --- NEW: Quality Penalization ---
        const health = window.LinkyHealth.calculate(link);
        const qualityScalar = Math.max(0.1, health.score / 100); // Minimum 10% score even for junk

        // Calculate Final (Normalized to 0-1)
        const totalWeight = wSemantic + wRecency + wFreq + 0.5; // source boost is max 0.5
        const finalScore = (
            (semanticScore * wSemantic * densityMultiplier * poisonMultiplier) +
            (recencyScore * wRecency) +
            (freqScore * wFreq) +
            (wSource * 0.5)
        ) / totalWeight * qualityScalar;

        return {
            ...item,
            finalScore,
            components: {
                semanticRaw: semanticScore,
                semantic: semanticScore * densityMultiplier,
                densityMultiplier: densityMultiplier,
                recency: recencyScore,
                frequency: freqScore,
                sourceBoost: wSource
            },
            componentWeights: {
                semantic: weights.signals.semantic,
                recency: weights.signals.recency,
                frequency: weights.signals.frequency,
                source: weights.sources[link.sourceType] || 0
            }
        };
    });

    // 5. Store & Sort
    window.lastSearchResults = rankedResults.filter(r => r !== null);
    applySortAndRender();
}

function applySortAndRender() {
    if (!window.lastSearchResults) return;

    const sortVal = document.getElementById('sort-order')?.value || 'finalScore';
    const list = document.getElementById('results-list');

    // Sort
    const sorted = [...window.lastSearchResults].sort((a, b) => {
        const valA = (sortVal === 'finalScore') ? a[sortVal] : (a.components[sortVal] || 0);
        const valB = (sortVal === 'finalScore') ? b[sortVal] : (b.components[sortVal] || 0);
        return valB - valA;
    }).slice(0, 50);

    // Render with sort context
    if (sorted.length === 0) {
        list.innerHTML = `<div class="empty-state"><p>No results match your filters.</p></div>`;
    } else {
        window.LinkyUI.renderResults(sorted, handleAddToQueue, handleIgnoreLink, sortVal);
    }
}

// --- UI TRIGGERS ---

function showContextualUI(focus, extra) {
    // 1. Set Focus
    document.getElementById('focus-editor').textContent = focus;

    // 2. Update Context (runs redundancy check inside updateActiveContext)
    // Use current stored weight
    updateActiveContext(extra, activeContext.weight);

    // 3. Trigger
    triggerUnifiedSearch();
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.action) {
        case "text-selected":
            showContextualUI(request.selectedText, request.ambientContext);
            break;
        case "update-queue":
            window.LinkyUI.updateQueueUI(request.queue, handleRemoveFromQueue);
            break;
        case "settings-updated":
            // Debounced re-run
            clearTimeout(window.settingsDebounce);
            window.settingsDebounce = setTimeout(() => {
                triggerUnifiedSearch();
            }, 750);
            break;
        case "index-new-page":
            handlePageIndexing(request);
            break;
        case "reindex-url":
            handleReindexRequest(request);
            break;
    }
});

async function handleReindexRequest(request) {
    if (!window.linkyAIEngine) return;

    const embedding = await window.linkyAIEngine.getEmbedding({
        title: request.metadata.title,
        description: request.metadata.description,
        headings: request.metadata.headings || request.metadata.h1 || ""
    });

    if (embedding) {
        chrome.runtime.sendMessage({
            action: "cache-embedding",
            url: request.url,
            title: request.metadata.title,
            embedding: embedding,
            description: request.metadata.description,
            headings: request.metadata.headings || request.metadata.h1 || ""
        });
    }
}

async function handleAddToQueue(link) {
    const currentQueue = await window.LinkyStorage.getQueue();
    // Allow duplicates as per user request
    currentQueue.push(link);
    await window.LinkyStorage.saveQueue(currentQueue);
    window.LinkyUI.updateQueueUI(currentQueue, handleRemoveFromQueue);
    window.LinkyUI.triggerPulse(link.url);
    window.LinkyUI.scrollToBottom();
}

async function handleIgnoreLink(link, element, actionType = 'page') {
    await window.LinkyUI.animateRemoval(element);

    if (actionType === 'site') {
        await window.LinkyStorage.blockDomain(link);

        // Instant Cleanup: Remove all links from the same domain from current results
        if (window.lastSearchResults) {
            try {
                const domainToBlock = new URL(link.url).hostname;
                window.lastSearchResults = window.lastSearchResults.filter(item => {
                    try {
                        return new URL(item.link.url).hostname !== domainToBlock;
                    } catch (e) { return true; }
                });
                applySortAndRender();
            } catch (e) {
                console.error("Cleanup failed:", e);
            }
        }
    } else {
        await window.LinkyStorage.blockUrl(link);
    }
}

async function handleRemoveFromQueue(index, element) {
    if (element) await window.LinkyUI.animateRemoval(element);
    const queue = await window.LinkyStorage.getQueue();
    queue.splice(index, 1);
    await window.LinkyStorage.saveQueue(queue);
    window.LinkyUI.updateQueueUI(queue, handleRemoveFromQueue);
}

async function handleClearQueue() {
    await window.LinkyStorage.saveQueue([]);
    window.LinkyUI.updateQueueUI([], handleRemoveFromQueue);
}

async function handleDropReorder(data, newIndex) {
    if (data.type === 'reorder') {
        const queue = await window.LinkyStorage.getQueue();
        const oldIndex = data.index;
        const [movedItem] = queue.splice(oldIndex, 1);
        queue.splice(newIndex, 0, movedItem);
        await window.LinkyStorage.saveQueue(queue);
        window.LinkyUI.updateQueueUI(queue, handleRemoveFromQueue);
    } else if (data.type === 'new-link') {
        // Handle dropping a new link from results to queue
        await handleAddToQueue(data.link);
    }
}

async function refreshBrowserData() {
    const browserData = await chrome.runtime.sendMessage({ action: "get-browser-data" });
    currentBrowserData.tabs = browserData.tabs || [];
    currentBrowserData.history = browserData.history || [];
    currentBrowserData.bookmarks = browserData.bookmarks || [];
}

async function handlePageIndexing(request) {
    const cacheData = await chrome.storage.local.get(['linky_vector_cache']);
    const cache = cacheData.linky_vector_cache || {};
    const existing = cache[request.url];

    if (existing && existing.contentHash === request.contentHash) return;

    if (window.linkyAIEngine) {
        const embedding = await window.linkyAIEngine.getEmbedding({
            title: request.title,
            description: request.metadata.description,
            h1: request.metadata.h1
        });

        if (embedding) {
            chrome.runtime.sendMessage({
                action: "cache-embedding",
                url: request.url,
                title: request.title,
                embedding: embedding,
                contentHash: request.contentHash,
                description: request.metadata.description
            });
        }
    }
}