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

    // 5. Navigation
    setupNavigation();

    // 6. Init Retrieval Options
    initRetrievalOptions();

    // 7. Link Inspector Initialization
    initInspector();

    // 8. Handle Deep Links
    handleDeepLink();

    // 9. Poison Keywords Initialization
    const poisonKeywords = await window.LinkyStorage.getPoisonKeywords();
    renderPoisonList(poisonKeywords);
    setupPoisonInput();
});

function handleDeepLink() {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab');
    const query = params.get('query');

    if (tab === 'inspector') {
        const tabLinks = document.querySelectorAll('.settings-nav-item');
        const tabPanes = document.querySelectorAll('.tab-pane');
        const inspectorLink = Array.from(tabLinks).find(l => l.dataset.tab === 'inspector');

        if (inspectorLink) {
            tabLinks.forEach(l => l.classList.toggle('active', l === inspectorLink));
            tabPanes.forEach(p => p.classList.toggle('active', p.id === 'tab-inspector'));

            // Populate search if provided
            if (query) {
                const searchInput = document.getElementById('inspector-search');
                if (searchInput) {
                    // Prepend url: if no qualifier present to ensure precise matching for deep links
                    const finalQuery = (query.includes(':')) ? query : `url:${query}`;
                    searchInput.value = finalQuery;
                    renderLinkInspector(finalQuery.toLowerCase());
                }
            } else {
                renderLinkInspector();
            }
        }
    }
}

// --- Navigation & Tabs ---

function setupNavigation() {
    // 1. Top-level Tabs (Preferences vs Inspector)
    const tabLinks = document.querySelectorAll('.settings-nav-item');
    const tabPanes = document.querySelectorAll('.tab-pane');

    tabLinks.forEach(link => {
        link.onclick = () => {
            const targetTab = link.dataset.tab;

            tabLinks.forEach(l => l.classList.toggle('active', l === link));
            tabPanes.forEach(p => p.classList.toggle('active', p.id === `tab-${targetTab}`));

            if (targetTab === 'inspector') {
                renderLinkInspector();
            }
        };
    });

    // 2. Sub-navigation (Inside Preferences)
    const subNavLinks = document.querySelectorAll('.sub-nav-item');
    subNavLinks.forEach(link => {
        link.onclick = () => {
            subNavLinks.forEach(l => l.classList.remove('active'));
            link.classList.add('active');

            const targetId = link.dataset.target;
            const targetEl = document.getElementById(targetId);
            if (targetEl) {
                targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        };
    });
}

// --- Link Inspector ---

let inspectorData = {};
let currentEditingUrl = null;
let isDrawerDirty = false;
let currentSort = { key: 'lastVisitTime', direction: 'desc' };

async function initInspector() {
    const refreshBtn = document.getElementById('refresh-inspector');
    const searchInput = document.getElementById('inspector-search');
    const closeDrawerBtn = document.getElementById('close-drawer');
    const saveBtn = document.getElementById('save-metadata');

    if (refreshBtn) {
        refreshBtn.onclick = () => {
            const query = searchInput?.value.toLowerCase() || "";
            renderLinkInspector(query);
        };
    }

    if (searchInput) {
        searchInput.oninput = () => {
            const query = searchInput.value.toLowerCase();
            renderLinkInspector(query);
        };
    }

    if (closeDrawerBtn) {
        closeDrawerBtn.onclick = () => {
            document.getElementById('inspector-drawer').classList.add('hidden');
        };
    }

    const showIgnoredToggle = document.getElementById('show-ignored-toggle');
    if (showIgnoredToggle) {
        showIgnoredToggle.onchange = () => {
            const searchInput = document.getElementById('inspector-search');
            renderLinkInspector(searchInput?.value.toLowerCase() || "");
        };
    }

    const sourceFilter = document.getElementById('inspector-source-filter');
    if (sourceFilter) {
        sourceFilter.onchange = () => {
            const localContainer = document.getElementById('inspector-local-container');
            if (localContainer) {
                // Show local-only toggle for 'all' or 'history'
                const val = sourceFilter.value;
                localContainer.style.display = (val === 'all' || val === 'history') ? 'flex' : 'none';
            }
            const searchInput = document.getElementById('inspector-search');
            renderLinkInspector(searchInput?.value.toLowerCase() || "");
        };
    }

    const localFilter = document.getElementById('inspector-local-only');
    if (localFilter) {
        localFilter.onchange = () => {
            const searchInput = document.getElementById('inspector-search');
            renderLinkInspector(searchInput?.value.toLowerCase() || "");
        };
    }

    // Table Sorting Listeners
    const headers = document.querySelectorAll('#inspector-table th.sortable');
    headers.forEach(header => {
        header.onclick = () => {
            const key = header.dataset.sort;
            if (currentSort.key === key) {
                currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
            } else {
                currentSort.key = key;
                currentSort.direction = 'asc';
            }

            // Update Header UI
            headers.forEach(h => {
                h.classList.remove('sort-asc', 'sort-desc');
                if (h === header) {
                    h.classList.add(currentSort.direction === 'asc' ? 'sort-asc' : 'sort-desc');
                }
            });

            const searchInput = document.getElementById('inspector-search');
            renderLinkInspector(searchInput?.value.toLowerCase() || "");
        };
    });

    // Initial Sort UI Highlight
    const defaultHeader = Array.from(headers).find(h => h.dataset.sort === currentSort.key);
    if (defaultHeader) {
        defaultHeader.classList.add(currentSort.direction === 'asc' ? 'sort-asc' : 'sort-desc');
    }

    if (saveBtn) {
        saveBtn.onclick = handleSaveMetadata;
    }

    // Live Metadata & Experiment Listeners
    ['edit-title', 'edit-description', 'edit-headings'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.oninput = () => {
            isDrawerDirty = true;
            clearTimeout(window.expDebounce);
            window.expDebounce = setTimeout(() => runSemanticExperiment(), 400);
        };
    });

    // Experiment Listeners
    ['exp-focus', 'exp-ambient'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.oninput = () => {
                clearTimeout(window.expDebounce);
                window.expDebounce = setTimeout(() => runSemanticExperiment(), 400);
            };
        }
    });

    // Auto-sync listener
    chrome.runtime.onMessage.addListener((request) => {
        if (request.action === 'index-new-page') {
            const query = searchInput?.value.toLowerCase() || "";
            renderLinkInspector(query);

            if (request.url === currentEditingUrl && !isDrawerDirty) {
                // Use data from request if possible to avoid storage race
                const meta = {
                    title: request.title,
                    description: request.metadata.description,
                    headings: request.metadata.headings,
                    contentHash: request.contentHash
                };
                inspectorData[request.url] = meta;
                openInspectorDrawer(request.url, meta);
            }
        }
    });
}

async function renderLinkInspector(filterQuery = "") {
    const container = document.getElementById('inspector-body');
    if (!container) return;

    const sourceFilterVal = document.getElementById('inspector-source-filter')?.value || 'all';
    const localOnly = document.getElementById('inspector-local-only')?.checked || false;
    const showIgnored = document.getElementById('show-ignored-toggle')?.checked || false;

    // 1. Fetch live and cached data
    const [cache, browserData] = await Promise.all([
        window.LinkyStorage.getMetadataIndex(),
        chrome.runtime.sendMessage({
            action: "get-browser-data",
            options: { localOnly: localOnly } // Let background do the heavy lifting
        })
    ]);

    // 2. Merge Data
    const sources = {
        tabs: (browserData.tabs || []).map(t => ({ ...t, sourceType: 'tabs' })),
        history: (browserData.history || []).map(h => ({ ...h, sourceType: 'history' })),
        bookmarks: (browserData.bookmarks || []).map(b => ({ ...b, sourceType: 'bookmarks' }))
    };

    inspectorData = cache;
    container.innerHTML = '';

    // Create a unified set of URLs based on source filter
    let liveLinks = [];
    if (sourceFilterVal === 'all') {
        // Prioritize History for better metadata, then Tabs, then Bookmarks
        liveLinks = [...sources.history, ...sources.tabs, ...sources.bookmarks];
    } else {
        liveLinks = sources[sourceFilterVal] || [];
    }

    // Create a Map for O(1) lookup of live data
    const liveMap = new Map();
    liveLinks.forEach(l => {
        if (!liveMap.has(l.url)) liveMap.set(l.url, l);
    });

    const allUrls = new Set();
    if (sourceFilterVal === 'all') {
        Object.keys(cache).forEach(url => allUrls.add(url));
    }
    liveLinks.forEach(l => allUrls.add(l.url));

    const filteredResults = [];
    const query = filterQuery.trim().toLowerCase();

    for (const url of allUrls) {
        let isMatch = false;
        const live = liveMap.get(url) || {};
        // Prefer cache, then live data
        const meta = cache[url] || live || { url };

        const title = (meta.title || "").toLowerCase();
        const description = (meta.description || "").toLowerCase();
        const headings = (meta.headings || meta.h1 || "").toLowerCase();
        const lowUrl = url.toLowerCase();

        if (!query) {
            isMatch = true;
        } else if (query.startsWith('url:')) {
            isMatch = lowUrl.includes(query.replace('url:', '').trim());
        } else if (query.startsWith('title:')) {
            isMatch = title.includes(query.replace('title:', '').trim());
        } else if (query.startsWith('desc:') || query.startsWith('description:')) {
            const term = query.startsWith('desc:') ? query.replace('desc:', '') : query.replace('description:', '');
            isMatch = description.includes(term.trim());
        } else if (query.startsWith('head:') || query.startsWith('heading:') || query.startsWith('h1:')) {
            const term = query.replace(/^(head:|heading:|h1:)/, '');
            isMatch = headings.includes(term.trim());
        } else {
            isMatch = lowUrl.includes(query) || title.includes(query) || description.includes(query) || headings.includes(query);
        }

        if (!isMatch) continue;

        const isIgnored = await window.LinkyStorage.isUrlIgnored(url);
        if (isIgnored && !showIgnored) continue;

        // Apply Local Only Filter manually for cached items not in current live results
        if (localOnly) {
            const cacheStatus = cache[url]?.isLocal;
            const liveStatus = live.isLocal;
            // If we have data saying it is NOT local, skip it
            if (cacheStatus === false || liveStatus === false) continue;
        }

        const lastVisitTime = live.lastVisitTime || 0;
        const visitCount = live.visitCount || 0;

        filteredResults.push({
            url,
            meta,
            isIgnored,
            isTracked: !!cache[url],
            health: window.LinkyHealth.calculate(meta),
            lastVisitTime,
            visitCount
        });
    }

    // 3. Sort Results
    filteredResults.sort((a, b) => {
        let valA, valB;

        switch (currentSort.key) {
            case 'status':
                valA = a.isTracked ? (a.isIgnored ? 0 : a.health.score) : -1;
                valB = b.isTracked ? (b.isIgnored ? 0 : b.health.score) : -1;
                break;
            case 'title':
                valA = (a.meta.title || "Untitled").toLowerCase();
                valB = (b.meta.title || "Untitled").toLowerCase();
                break;
            case 'url':
                valA = a.url.toLowerCase();
                valB = b.url.toLowerCase();
                break;
            case 'lastVisitTime':
                valA = a.lastVisitTime || 0;
                valB = b.lastVisitTime || 0;
                break;
            case 'visitCount':
                valA = a.visitCount || 0;
                valB = b.visitCount || 0;
                break;
            case 'health':
                valA = a.health.score;
                valB = b.health.score;
                break;
            default:
                valA = a.url;
                valB = b.url;
        }

        if (valA < valB) return currentSort.direction === 'asc' ? -1 : 1;
        if (valA > valB) return currentSort.direction === 'asc' ? 1 : -1;
        return 0;
    });

    if (filteredResults.length === 0) {
        container.innerHTML = `<tr><td colspan="4" style="text-align:center; padding: 40px; color: var(--text-dim);">No links found matching your query.</td></tr>`;
        return;
    }

    filteredResults.forEach(({ url, meta, isIgnored, isTracked, health, lastVisitTime, visitCount }) => {
        let statusClass = 'untracked';

        if (isTracked) {
            statusClass = isIgnored ? 'ignored-status' : (health.score > 80 ? 'green' : (health.score > 40 ? 'yellow' : 'red'));
        }

        const tr = document.createElement('tr');
        if (isIgnored) tr.classList.add('row-ignored');
        if (!isTracked) tr.classList.add('row-untracked');

        tr.innerHTML = `
            <td class="col-status"><span class="status-dot ${statusClass}" title="${isTracked ? 'Tracked' : 'Untracked'}"></span></td>
            <td class="col-last-visited">${lastVisitTime ? new Date(lastVisitTime).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : '--'}</td>
            <td class="col-title">
                ${isIgnored ? '<span class="label-ignored">IGNORED</span> ' : ''}
                ${!isTracked ? '<span class="label-untracked">UNTRACKED</span> ' : ''}
                ${escapeHTML(meta.title || "Untitled")}
            </td>
            <td class="col-url">
                <div class="url-with-actions">
                    <span class="url-text">${escapeHTML(url)}</span>
                    <div class="split-ignore-container">
                        <button class="feedback-btn btn-ignore-main" title="Ignore options">🚫</button>
                        <div class="split-ignore-menu">
                            <button class="ignore-action-btn btn-ignore-site" title="Ignore all results from this site">🌐</button>
                            <button class="ignore-action-btn btn-ignore-page" title="Never show this specific page again">📄</button>
                        </div>
                    </div>
                </div>
            </td>
            <td class="col-visits">${visitCount || '--'}</td>
            <td class="col-health" style="color: ${!isTracked || isIgnored ? 'var(--text-dim)' : (statusClass === 'green' ? 'var(--accent-green)' : (statusClass === 'yellow' ? '#fbbf24' : 'var(--danger)'))}">
                ${!isTracked || isIgnored ? '--' : health.score + '%'}
            </td>
        `;

        // Blocking Logic for Table
        const btnIgnoreMain = tr.querySelector('.btn-ignore-main');
        const btnIgnorePage = tr.querySelector('.btn-ignore-page');
        const btnIgnoreSite = tr.querySelector('.btn-ignore-site');

        if (btnIgnoreMain) btnIgnoreMain.onclick = (e) => e.stopPropagation();

        if (btnIgnorePage) {
            btnIgnorePage.onclick = async (e) => {
                e.stopPropagation();
                await window.LinkyStorage.blockUrl(url);
                renderLinkInspector(document.getElementById('inspector-search')?.value.toLowerCase() || "");
                chrome.runtime.sendMessage({ action: "settings-updated" }).catch(() => { });
            };
        }

        if (btnIgnoreSite) {
            btnIgnoreSite.onclick = async (e) => {
                e.stopPropagation();
                await window.LinkyStorage.blockDomain({ url });
                renderLinkInspector(document.getElementById('inspector-search')?.value.toLowerCase() || "");
                chrome.runtime.sendMessage({ action: "settings-updated" }).catch(() => { });
            };
        }

        tr.onclick = (e) => {
            if (e.target.closest('.split-ignore-container')) return;
            openInspectorDrawer(url, meta);
        };
        container.appendChild(tr);
    });
}


function openInspectorDrawer(url, meta) {
    currentEditingUrl = url;
    isDrawerDirty = false; // Reset dirty state on open/refresh
    const drawer = document.getElementById('inspector-drawer');
    drawer.classList.remove('hidden');

    const urlDisplayContainer = drawer.querySelector('.url-display-container');
    if (urlDisplayContainer) {
        // Setup Blocking Logic for Drawer (Static HTML now)
        urlDisplayContainer.querySelector('.btn-ignore-main').onclick = (e) => e.stopPropagation();
        urlDisplayContainer.querySelector('.btn-ignore-page').onclick = async (e) => {
            e.stopPropagation();
            await window.LinkyStorage.blockUrl(currentEditingUrl);
            renderLinkInspector(document.getElementById('inspector-search')?.value.toLowerCase() || "");
            chrome.runtime.sendMessage({ action: "settings-updated" }).catch(() => { });
            drawer.classList.add('hidden'); // Close drawer on block
        };
        urlDisplayContainer.querySelector('.btn-ignore-site').onclick = async (e) => {
            e.stopPropagation();
            await window.LinkyStorage.blockDomain({ url: currentEditingUrl });
            renderLinkInspector(document.getElementById('inspector-search')?.value.toLowerCase() || "");
            chrome.runtime.sendMessage({ action: "settings-updated" }).catch(() => { });
            drawer.classList.add('hidden'); // Close drawer on block
        };
    }

    const linkEl = document.getElementById('drawer-url-link');
    if (linkEl) {
        linkEl.textContent = url;
        linkEl.href = url;
    }

    document.getElementById('edit-title').value = meta.title || "";
    document.getElementById('edit-description').value = meta.description || "";
    document.getElementById('edit-headings').value = meta.headings || meta.h1 || "";

    // Reset Experiment
    document.getElementById('exp-focus').value = "";
    document.getElementById('exp-ambient').value = "";
    document.getElementById('exp-result-container').classList.add('hidden');

    // Warm up AI if needed
    if (window.linkyAIEngine) window.linkyAIEngine.init();

    const health = window.LinkyHealth.calculate(meta);
    const checklist = document.getElementById('health-checklist');
    checklist.innerHTML = '';

    health.notes.forEach(note => {
        const li = document.createElement('li');
        li.className = 'checklist-item';
        const icon = note.type === 'pass' ? '✓' : (note.type === 'warn' ? '!' : '✗');
        li.innerHTML = `
            <span class="check-icon ${note.type}">${icon}</span>
            <span>${note.text}</span>
        `;
        checklist.appendChild(li);
    });
}

async function handleSaveMetadata() {
    if (!currentEditingUrl) return;

    const newMeta = {
        ...inspectorData[currentEditingUrl],
        title: document.getElementById('edit-title').value,
        description: document.getElementById('edit-description').value,
        headings: document.getElementById('edit-headings').value
        // New values overwrite old ones from the spread
    };

    // Update Storage
    await window.LinkyStorage.updateMetadata(currentEditingUrl, newMeta);

    // Notify Background to Re-Index
    // We send the full data so background doesn't need to re-fetch/re-parse the page, just re-embed
    chrome.runtime.sendMessage({
        action: "reindex-url",
        url: currentEditingUrl,
        metadata: newMeta
    });

    // Refresh UI
    await renderLinkInspector(document.getElementById('inspector-search')?.value.toLowerCase() || "");
    document.getElementById('inspector-drawer').classList.add('hidden');
}

async function runSemanticExperiment() {
    if (!currentEditingUrl || !window.linkyAIEngine) return;

    const focusText = document.getElementById('exp-focus').value.trim();
    const ambientText = document.getElementById('exp-ambient').value.trim();
    const resultContainer = document.getElementById('exp-result-container');

    if (!focusText && !ambientText) {
        resultContainer.classList.add('hidden');
        return;
    }

    resultContainer.classList.remove('hidden');
    resultContainer.style.opacity = '0.7'; // Indicate loading

    // 1. Get Embeddings
    const liveMeta = {
        title: document.getElementById('edit-title').value,
        description: document.getElementById('edit-description').value,
        headings: document.getElementById('edit-headings').value
    };

    const [focusVec, ambientVec, pageVec] = await Promise.all([
        focusText ? window.linkyAIEngine.getEmbedding(focusText) : null,
        ambientText ? window.linkyAIEngine.getEmbedding(ambientText) : null,
        window.linkyAIEngine.getEmbedding(liveMeta)
    ]);

    if (!pageVec) return;

    // 2. Calculate Components
    // We use the same weights logic as the search (0.7 / 0.3)
    let focusWeight = 0.7;
    let ambientWeight = 0.3;

    // Adjust weights if one is missing to avoid score dilution
    if (!focusText) {
        focusWeight = 0;
        ambientWeight = 1.0;
    } else if (!ambientText) {
        focusWeight = 1.0;
        ambientWeight = 0;
    }

    let focusScore = 0;
    let ambientScore = 0;

    if (focusVec) {
        const mockPage = { floatEmbedding: new Float32Array(pageVec) };
        const mockFocus = { floatEmbedding: new Float32Array(focusVec) };
        focusScore = window.linkyAIEngine.TextEmbedder.cosineSimilarity(mockFocus, mockPage);
    }

    if (ambientVec) {
        const mockPage = { floatEmbedding: new Float32Array(pageVec) };
        const mockAmbient = { floatEmbedding: new Float32Array(ambientVec) };
        ambientScore = window.linkyAIEngine.TextEmbedder.cosineSimilarity(mockAmbient, mockPage);
    }

    // 3. Blend & Apply Penalties (Aligned with sidepanel.js)
    let semanticScore = (focusScore * focusWeight) + (ambientScore * ambientWeight);

    const poisonKeywords = await window.LinkyStorage.getPoisonKeywords();
    const metaText = (liveMeta.title || "") + (liveMeta.description || "") + (liveMeta.headings || "");
    const metaLower = metaText.toLowerCase();

    let densityMultiplier = 1.0;
    let poisonMultiplier = 1.0;
    let penaltyDetails = [];

    // 1. Density Checks
    if (metaText.length < 60) {
        densityMultiplier *= 0.6;
        penaltyDetails.push("Sparse Metadata (-40%)");
    }
    if (!liveMeta.description || liveMeta.description.trim().length === 0) {
        densityMultiplier *= 0.8;
        penaltyDetails.push("No Description (-20%)");
    }

    // 2. Poison Checks
    for (const k of poisonKeywords) {
        if (metaLower.includes(k.word.toLowerCase())) {
            if (k.level === 'muted') {
                poisonMultiplier = 0;
                penaltyDetails.push(`Muted: contains "${k.word}"`);
                break;
            }
            if (k.level === 'hard') {
                poisonMultiplier *= 0.1;
                penaltyDetails.push(`Major Noise: "${k.word}" (-90%)`);
            }
            if (k.level === 'soft') {
                poisonMultiplier *= 0.3;
                penaltyDetails.push(`Minor Noise: "${k.word}" (-70%)`);
            }
        }
    }

    // 3. Quality / Health Checks (Aligned with sidepanel.js)
    const health = window.LinkyHealth.calculate(liveMeta);
    const qualityScalar = Math.max(0.1, health.score / 100);

    if (qualityScalar < 1.0) {
        penaltyDetails.push(`Health Penalty: ${health.score}% result quality (-${Math.round((1 - qualityScalar) * 100)}%)`);
    }

    const finalScore = semanticScore * densityMultiplier * poisonMultiplier * qualityScalar;

    // 4. Update UI
    resultContainer.style.opacity = '1';
    const scoreValEl = document.getElementById('exp-score-val');
    const penaltyIcon = document.getElementById('exp-penalty-icon');

    scoreValEl.textContent = `${Math.round(finalScore * 100)}%`;

    // Visual indicator of penalty
    const totalMultiplier = densityMultiplier * poisonMultiplier * qualityScalar;
    if (totalMultiplier < 1.0) {
        scoreValEl.style.color = 'var(--danger)';
        penaltyIcon.classList.remove('hidden');

        const reduction = Math.round((1 - totalMultiplier) * 100);
        const tooltip = `Penalty Applied: ${reduction}% total reduction\n• ` + penaltyDetails.join('\n• ');

        scoreValEl.title = tooltip;
        penaltyIcon.title = tooltip;
    } else {
        scoreValEl.style.color = 'var(--accent-blue)';
        scoreValEl.title = "";
        penaltyIcon.classList.add('hidden');
    }

    const focusPct = Math.round(focusScore * 100);
    const ambientPct = Math.round(ambientScore * 100);

    document.getElementById('val-focus').textContent = focusPct;
    document.getElementById('val-ambient').textContent = ambientPct;

    // Relative visual breakdown (shares of the total influence)
    const focusShare = (focusScore * focusWeight);
    const ambientShare = (ambientScore * ambientWeight);
    const totalShare = focusShare + ambientShare || 1;

    document.getElementById('bar-focus').style.width = `${(focusShare / totalShare) * 100}%`;
    document.getElementById('bar-ambient').style.width = `${(ambientShare / totalShare) * 100}%`;
}

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
    if (!label) return;
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
    const checkLocal = document.getElementById('check-history-local');

    // Init Values
    if (inputHistory) inputHistory.value = opts.maxHistoryResults;
    if (checkWindow) checkWindow.checked = opts.currentWindowLimit;
    if (checkPinned) checkPinned.checked = opts.ignorePinnedTabs;
    if (checkLocal) checkLocal.checked = opts.localOnly;

    // Listeners
    const save = async () => {
        const newOpts = {
            maxHistoryResults: parseInt(inputHistory.value) || 150,
            currentWindowLimit: checkWindow.checked,
            ignorePinnedTabs: checkPinned.checked,
            localOnly: checkLocal ? checkLocal.checked : false
        };
        await window.LinkyStorage.saveRetrievalOptions(newOpts);
    };

    if (inputHistory) inputHistory.onchange = save;
    if (checkWindow) checkWindow.onchange = save;
    if (checkPinned) checkPinned.onchange = save;
    if (checkLocal) checkLocal.onchange = save;
}

function setupPresets() {
    const btnFreshness = document.getElementById('preset-freshness');
    const btnDiscovery = document.getElementById('preset-discovery');
    const btnBalanced = document.getElementById('preset-balanced');

    if (btnFreshness) {
        btnFreshness.onclick = () => applyPreset({
            sources: { tabs: 100, history: 40, bookmarks: 20 },
            signals: { recency: 100, frequency: 30, semantic: 70 }
        });
    }

    if (btnDiscovery) {
        btnDiscovery.onclick = () => applyPreset({
            sources: { tabs: 30, history: 100, bookmarks: 80 },
            signals: { recency: 20, frequency: 50, semantic: 100 }
        });
    }

    if (btnBalanced) {
        btnBalanced.onclick = () => applyPreset({
            sources: { tabs: 70, history: 50, bookmarks: 50 },
            signals: { recency: 80, frequency: 60, semantic: 90 }
        });
    }
}

async function applyPreset(preset) {
    await window.LinkyStorage.saveRankingWeights(preset);

    // Helper to update UI without triggering save-loops
    const updateUI = (suffix, val) => {
        const slider = document.getElementById(`slider-${suffix}`);
        const label = document.getElementById(`label-${suffix}`);
        const valueDisplay = document.getElementById(`val-${suffix}`);

        if (slider) slider.value = val;
        if (valueDisplay) valueDisplay.textContent = val;
        if (label) updateLabelStyle(label, val);
    };

    updateUI('source-tabs', preset.sources.tabs);
    updateUI('source-history', preset.sources.history);
    updateUI('source-bookmarks', preset.sources.bookmarks);

    updateUI('signal-recency', preset.signals.recency);
    updateUI('signal-frequency', preset.signals.frequency);
    updateUI('signal-semantic', preset.signals.semantic);

    chrome.runtime.sendMessage({ action: "settings-updated" }).catch(() => { });
}

// --- Pattern Logic ---

function setupPatternInput() {
    const input = document.getElementById('pattern-input');
    const btn = document.getElementById('add-pattern-btn');

    if (btn) {
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
}

function renderPatternsList(patterns) {
    const container = document.getElementById('patterns-list');
    if (!container) return;
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
    if (!container) return;
    container.innerHTML = '';

    if (items.length === 0) {
        container.innerHTML = `<div class="empty-state" style="padding: 20px; text-align: center; color: var(--text-dim);">No ignored links.</div>`;
        return;
    }

    items.forEach(item => {
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
            setTimeout(() => {
                div.remove();
                if (container.querySelectorAll('.data-item').length === 0) {
                    container.innerHTML = `<div class="empty-state" style="padding: 20px; text-align: center; color: var(--text-dim);">No ignored links.</div>`;
                }
            }, 300);

            // Notify Sidepanel
            chrome.runtime.sendMessage({ action: "settings-updated" }).catch(() => { });
        };

        container.appendChild(div);
    });
}

function escapeHTML(str) {
    if (!str) return "";
    return str.replace(/[&<>'"]/g,
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag]));
}
// --- Poison Keywords Logic ---

function setupPoisonInput() {
    const input = document.getElementById('poison-input');
    const levelSelect = document.getElementById('poison-level');
    const btn = document.getElementById('add-poison-btn');

    if (btn) {
        btn.onclick = async () => {
            const word = input.value.trim().toLowerCase();
            const level = levelSelect.value;
            if (!word) return;

            const keywords = await window.LinkyStorage.getPoisonKeywords();
            if (!keywords.find(k => k.word === word)) {
                keywords.push({ word, level });
                await window.LinkyStorage.savePoisonKeywords(keywords);
                renderPoisonList(keywords);
                input.value = '';
                chrome.runtime.sendMessage({ action: "settings-updated" }).catch(() => { });
            }
        };
    }
}

function renderPoisonList(keywords) {
    const container = document.getElementById('poison-list');
    if (!container) return;
    container.innerHTML = '';

    if (keywords.length === 0) {
        container.innerHTML = `<div class="empty-state" style="padding: 20px; text-align: center; color: var(--text-dim);">No poison keywords set.</div>`;
        return;
    }

    keywords.forEach(item => {
        const div = document.createElement('div');
        div.className = 'data-item poison-item';
        div.innerHTML = `
            <div class="data-info">
                <div class="data-title">${escapeHTML(item.word)}</div>
                <div class="data-url">Toxicity: ${item.level.charAt(0).toUpperCase() + item.level.slice(1)}</div>
            </div>
            <div class="poison-actions" style="display: flex; gap: 8px;">
                <button class="btn-toggle-toxic" title="Change Toxicity Level" style="background: none; border: 1px solid var(--border); border-radius: 4px; color: var(--text); padding: 2px 8px; cursor: pointer; transition: all 0.2s;">☣️</button>
                <button class="btn-remove" style="background: none; border: 1px solid var(--danger); border-radius: 4px; color: var(--danger); padding: 2px 8px; cursor: pointer; transition: all 0.2s;">Remove</button>
            </div>
        `;

        const toggleBtn = div.querySelector('.btn-toggle-toxic');
        toggleBtn.onclick = async () => {
            const levels = ['soft', 'hard', 'muted'];
            const currentIndex = levels.indexOf(item.level);
            item.level = levels[(currentIndex + 1) % levels.length];
            await window.LinkyStorage.savePoisonKeywords(keywords);
            renderPoisonList(keywords);
            chrome.runtime.sendMessage({ action: "settings-updated" }).catch(() => { });
        };
        // Add hover effects via JS since these are dynamic styles for now
        toggleBtn.onmouseenter = () => toggleBtn.style.backgroundColor = 'var(--bg-card)';
        toggleBtn.onmouseleave = () => toggleBtn.style.backgroundColor = 'transparent';

        const removeBtn = div.querySelector('.btn-remove');
        removeBtn.onclick = async () => {
            const index = keywords.indexOf(item);
            keywords.splice(index, 1);
            await window.LinkyStorage.savePoisonKeywords(keywords);
            renderPoisonList(keywords);
            chrome.runtime.sendMessage({ action: "settings-updated" }).catch(() => { });
        };
        removeBtn.onmouseenter = () => { removeBtn.style.backgroundColor = 'var(--danger)'; removeBtn.style.color = 'white'; };
        removeBtn.onmouseleave = () => { removeBtn.style.backgroundColor = 'transparent'; removeBtn.style.color = 'var(--danger)'; };

        container.appendChild(div);
    });
}
