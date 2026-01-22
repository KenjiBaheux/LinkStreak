// ui_manager.js - Final Modular Version

function escapeHTML(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

window.LinkyUI = {
    dragSrcIndex: null,
    dropIndicator: null,

    initDragListeners(onDropCallback) {
        const list = document.getElementById('queue-list');
        list.addEventListener('dragover', this.handleDragOver.bind(this));
        list.addEventListener('dragleave', this.handleDragLeave.bind(this));
        list.addEventListener('drop', (e) => this.handleDrop(e, onDropCallback));
    },

    handleDragOver(e) {
        e.preventDefault();
        const queueList = document.getElementById('queue-list');
        const items = [...queueList.querySelectorAll('.queue-item:not(.dragging)')];

        const nextItem = items.find(item => {
            const rect = item.getBoundingClientRect();
            return e.clientY < (rect.top + rect.height / 2);
        });

        if (!this.dropIndicator) {
            this.dropIndicator = document.createElement('div');
            this.dropIndicator.className = 'drop-indicator';
        }

        if (nextItem) queueList.insertBefore(this.dropIndicator, nextItem);
        else queueList.appendChild(this.dropIndicator);
    },

    handleDragLeave(e) {
        if (e.relatedTarget && !document.getElementById('queue-list').contains(e.relatedTarget)) {
            this.removeIndicator();
        }
    },

    async handleDrop(e, callback) {
        e.preventDefault();
        const rawData = e.dataTransfer.getData('application/json');
        if (!rawData) return;

        const data = JSON.parse(rawData);
        const queueList = document.getElementById('queue-list');
        const children = [...queueList.children];
        const indicatorPos = children.indexOf(this.dropIndicator);

        let targetIndex = 0;
        for (let i = 0; i < indicatorPos; i++) {
            if (children[i].classList.contains('queue-item') && !children[i].classList.contains('dragging')) {
                targetIndex++;
            }
        }

        this.removeIndicator();
        callback(data, targetIndex);
    },

    removeIndicator() {
        if (this.dropIndicator?.parentNode) this.dropIndicator.remove();
    },

    renderResults(items, onAdd, onIgnore, sortType = 'finalScore') {
        const list = document.getElementById('results-list');
        list.innerHTML = '';
        items.forEach(({ link, score, components, componentWeights }) => {
            // Pass components explicitly to avoid reference mutation issues
            const div = this.createResultCard(link, score, onAdd, onIgnore, components, componentWeights, sortType);
            list.appendChild(div);
        });
    },

    createResultCard(link, score, onAdd, onIgnore, components, weights, sortType) {
        const div = document.createElement('div');
        div.className = 'linky-result-item';
        div.draggable = true;

        // Determine displayed metric
        let displayValue = score;
        let displayLabel = "AI Score";

        if (sortType !== 'finalScore' && components) {
            displayValue = components[sortType];
            displayLabel = sortType.charAt(0).toUpperCase() + sortType.slice(1);
        }

        const confidence = Math.round(displayValue * 100);
        const hue = 30 + (displayValue * 112); // Use display value for color heat
        const matchColor = `hsl(${hue}, 85%, 65%)`;

        // Safe access helper for components
        const getComp = (key) => components && components[key] ? Math.round(components[key] * 100) : 0;

        // Helper for styling disabled rows
        const getStyle = (key) => (weights && weights[key] === 0) ? 'ignored-factor' : '';

        div.innerHTML = `
            <div class="linky-title">
                <img src="https://www.google.com/s2/favicons?domain=${new URL(link.url).hostname}&sz=32" class="queue-favicon" alt="">
                <span>${escapeHTML(link.title || 'Untitled')}</span>
            </div>
            <div class="linky-url">${escapeHTML(link.url)}</div>
            <div class="linky-match-container">
                <div class="linky-match-label" style="color: ${matchColor}">
                    <span>${displayLabel}</span>
                    <span>${confidence}</span>
                </div>
                <div class="linky-match-track">
                    <div class="linky-match-bar" style="width: ${confidence}%; background-color: ${matchColor};"></div>
                </div>
            </div>
            
            <!-- Detailed Breakdown (Visible on Hover) -->
            ${components ? `
            <div class="result-details">
                <div class="details-grid">
                    ${sortType !== 'finalScore' ?
                    `<div class="detail-row"><span>AI Score</span> <span class="detail-val">${Math.round(score * 100)}</span></div>`
                    : ''}
                    
                    ${sortType !== 'semantic' ? `
                        <div class="detail-row ${getStyle('semantic')}">
                            <span>Semantic</span> 
                            <span class="detail-val ${components.densityMultiplier < 1 ? 'penalty-text' : ''}" 
                                  title="${components.densityMultiplier < 1 ? `Reduced by ${Math.round((1 - components.densityMultiplier) * 100)}% due to sparse metadata` : ''}">
                                ${getComp('semantic')}% ${components.densityMultiplier < 1 ? '⚠' : ''}
                            </span>
                        </div>` : ''}
                    ${sortType !== 'recency' ? `<div class="detail-row ${getStyle('recency')}"><span>Recency</span> <span class="detail-val">${getComp('recency')}%</span></div>` : ''}
                    ${sortType !== 'frequency' ? `<div class="detail-row ${getStyle('frequency')}"><span>Frequency</span> <span class="detail-val">${getComp('frequency')}%</span></div>` : ''}
                    <div class="detail-row ${getStyle('source')}"><span>Source</span> <span class="detail-val">${link.sourceType}</span></div>
                </div>
                <div class="details-actions">
                    <button class="feedback-btn btn-debug" title="Inspect link health and metadata">🐞</button>
                    <button class="feedback-btn btn-ignore" title="Never show again">🚫</button>
                </div>
            </div>` : ''}
        `;

        div.addEventListener('dragstart', (e) => {
            div.classList.add('dragging'); // helper for global state if needed
            e.dataTransfer.setData('application/json', JSON.stringify({ type: 'new-link', link: link }));

            // Immediately hide details on drag
            const details = div.querySelector('.result-details');
            if (details) details.classList.remove('visible');
        });

        div.addEventListener('dragend', () => {
            div.classList.remove('dragging');
        });

        // Hover Delay Logic
        let hoverTimer = null;
        div.addEventListener('mouseenter', () => {
            if (div.classList.contains('dragging')) return;

            hoverTimer = setTimeout(() => {
                const details = div.querySelector('.result-details');
                if (details && !div.classList.contains('dragging')) {
                    details.classList.add('visible');
                }
            }, 800); // 600ms Delay
        });

        div.addEventListener('mouseleave', () => {
            if (hoverTimer) clearTimeout(hoverTimer);
            const details = div.querySelector('.result-details');
            if (details) details.classList.remove('visible');
        });

        div.querySelector('.btn-debug').onclick = (e) => {
            e.stopPropagation();
            const targetUrl = chrome.runtime.getURL(`ui/settings.html?tab=inspector&query=${encodeURIComponent(link.url)}`);
            window.open(targetUrl, '_blank');
        };

        div.querySelector('.btn-ignore').onclick = (e) => {
            e.stopPropagation();
            onIgnore(link, div);
        };

        div.onclick = () => onAdd(link);
        return div;
    },

    triggerPulse(url) {
        setTimeout(() => {
            const items = document.querySelectorAll('.queue-item');
            items.forEach(item => {
                if (item.textContent.includes(url)) {
                    item.classList.add('pulse-success');
                    setTimeout(() => item.classList.remove('pulse-success'), 600);
                }
            });
        }, 50);
    },

    async animateRemoval(element) {
        element.classList.add('removing');
        return new Promise(resolve => {
            setTimeout(resolve, 310);
        });
    },

    updateQueueUI(queue, onRemove) {
        const queueList = document.getElementById('queue-list');
        const queueStatus = document.getElementById('queue-status-bar');
        const clearBtn = document.getElementById('clear-queue');

        if (clearBtn) clearBtn.disabled = (queue.length === 0);

        queueList.innerHTML = '';

        if (queue.length === 0) {
            queueList.innerHTML = `<div class="empty-state"><p>Click on recommended items to build your link streak.</p></div>`;
            queueStatus.textContent = "🧊 Empty link streak";
            return;
        }

        queue.forEach((link, idx) => {
            const div = document.createElement('div');
            div.className = 'queue-item';
            div.draggable = true;
            div.dataset.index = idx;

            div.innerHTML = `
                <span class="drag-handle">⠿</span>
                <img src="https://www.google.com/s2/favicons?domain=${new URL(link.url).hostname}&sz=32" class="queue-favicon" alt="">
                <div class="queue-content">
                    <div class="queue-text">${escapeHTML(link.title || 'Untitled')}</div>
                    <div class="queue-url">${escapeHTML(link.url)}</div>
                </div>
                <button class="remove-btn">×</button>
            `;

            div.addEventListener('dragstart', (e) => {
                this.dragSrcIndex = idx;
                e.dataTransfer.setData('application/json', JSON.stringify({ type: 'reorder', index: idx }));
                div.classList.add('dragging');
            });

            div.addEventListener('dragend', () => div.classList.remove('dragging'));

            div.querySelector('.remove-btn').onclick = (e) => {
                e.stopPropagation();
                onRemove(idx, div);
            };

            queueList.appendChild(div);
        });

        queueStatus.textContent = queue.length > 1 ? `🔥 ${queue.length} Links Streak` : `🐥 ${queue.length} Link Streak`;
    },

    scrollToBottom() {
        const list = document.getElementById('queue-list');
        if (list) list.scrollTop = list.scrollHeight;
    },

    setupResizer() {
        const resizer = document.getElementById('resizer');
        const resultsContainer = document.getElementById('results-container');
        const queueSection = document.getElementById('queue-section');
        if (!resizer || !resultsContainer || !queueSection) return;

        let isResizing = false;
        resizer.addEventListener('mousedown', () => {
            isResizing = true;
            document.body.style.cursor = 'ns-resize';
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            const containerHeight = document.body.clientHeight;
            const resizerY = e.clientY;
            const resultsHeight = resizerY - resultsContainer.getBoundingClientRect().top;
            const queueHeight = containerHeight - resizerY - 20;

            if (resultsHeight > 100 && queueHeight > 100) {
                resultsContainer.style.flex = 'none';
                resultsContainer.style.height = `${resultsHeight}px`;
                queueSection.style.height = `${queueHeight}px`;
            }
        });

        document.addEventListener('mouseup', () => {
            isResizing = false;
            document.body.style.cursor = 'default';
        });
    }
};