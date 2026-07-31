// ai_engine.js - Optimized for Stability

try {
    class AIEngine {
        constructor() {
            this.embedder = null;
            this.embeddingCache = new Map();
            this.lastError = null;
            this.lastErrorType = null; // 'downloadable' or 'unavailable'
            this.TextEmbedder = {
                cosineSimilarity: (vecA, vecB) => {
                    const a = vecA?.values || vecA?.floatEmbedding || vecA;
                    const b = vecB?.values || vecB?.floatEmbedding || vecB;
                    if (!a || !b || a.length !== b.length) return 0;
                    let dotProduct = 0, normA = 0, normB = 0;
                    for (let i = 0; i < a.length; i++) {
                        dotProduct += a[i] * b[i];
                        normA += a[i] * a[i];
                        normB += b[i] * b[i];
                    }
                    if (normA === 0 || normB === 0) return 0;
                    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
                }
            };
        }

        async checkAvailability() {
            const api = typeof SemanticEmbedder !== 'undefined' ? SemanticEmbedder : (typeof chrome !== 'undefined' && chrome.semanticEmbedder ? chrome.semanticEmbedder : null);
            if (!api) {
                return { status: 'unavailable', message: 'Semantic Embedder API not found. Ensure Chrome flag is enabled.' };
            }
            try {
                const availability = await api.availability();
                if (availability === 'readily' || availability === 'available') {
                    return { status: 'available' };
                } else if (availability === 'after-download' || availability === 'downloadable') {
                    return { status: 'downloadable' };
                } else {
                    return { status: 'unavailable', message: `Semantic Embedder API not available on this device (Status: ${availability})` };
                }
            } catch (e) {
                return { status: 'unavailable', message: e.message };
            }
        }

        async init(triggerDownload = false) {
            if (this.embedder) return true;

            const statusEl = document.getElementById('ai-status');
            if (statusEl) {
                statusEl.textContent = "Initializing AI...";
            }

            try {
                const availabilityResult = await this.checkAvailability();
                if (availabilityResult.status === 'unavailable') {
                    throw new Error(availabilityResult.message);
                }

                if (availabilityResult.status === 'downloadable' && !triggerDownload) {
                    if (statusEl) {
                        statusEl.textContent = "AI Download Required";
                    }
                    this.lastError = "AI Model Download Required";
                    this.lastErrorType = "downloadable";
                    return false;
                }

                const api = typeof SemanticEmbedder !== 'undefined' ? SemanticEmbedder : (typeof chrome !== 'undefined' && chrome.semanticEmbedder ? chrome.semanticEmbedder : null);

                this.embedder = await api.create({
                    monitor(m) {
                        m.addEventListener('downloadprogress', (e) => {
                            const pct = Math.round(e.loaded * 100);
                            console.log(`[LinkStreak] Downloading model: ${pct}%`);
                            if (statusEl) {
                                statusEl.textContent = `Downloading AI Model: ${pct}%`;
                            }
                            window.dispatchEvent(new CustomEvent('ai-download-progress', { detail: { percentage: pct } }));
                        });
                    }
                });

                console.log("LinkStreak: Semantic Embedder Model Loaded Successfully.");
                this.lastError = null;
                this.lastErrorType = null;
                if (statusEl) {
                    statusEl.textContent = "AI Ready";
                }

                // Release resources on window unload
                window.addEventListener('unload', () => {
                    if (this.embedder && typeof this.embedder.destroy === 'function') {
                        try {
                            this.embedder.destroy();
                        } catch (err) {
                            console.error("Error destroying embedder:", err);
                        }
                    }
                });

                return true;
            } catch (e) {
                console.error("LinkStreak: Initialization Error.", e);
                this.lastError = e.message;
                this.lastErrorType = "unavailable";
                if (statusEl) {
                    statusEl.textContent = `AI Error: ${e.message}`;
                }
                return false;
            }
        }

        async getEmbedding(input, taskType = null) {
            if (!this.embedder) await this.init();
            if (!this.embedder) return null;

            const isArray = Array.isArray(input);
            const items = isArray ? input : [input];

            const textsToEmbed = items.map(item => {
                let text = (typeof item === 'string') ? item :
                    `Title: ${item.title || ''} Headings: ${item.headings || item.h1 || ''} Description: ${item.description || ''}`.trim();

                return text
                    .replace(/[\x00-\x1F\x7F-\x9F]/g, "") // Remove non-printable control chars
                    .replace(/["']/g, " ")               // Replace quotes with spaces to avoid grouping errors
                    .replace(/\s+/g, " ")                // Collapse all whitespace to single spaces
                    .trim();
            });

            const cleanTexts = textsToEmbed.map(t => t || " ");

            if (!taskType) {
                const sample = isArray ? input[0] : input;
                taskType = (typeof sample === 'object') ? 'retrieval-document' : 'retrieval-query';
            }

            try {
                const result = await this.embedder.embed(isArray ? cleanTexts : cleanTexts[0], { taskType });

                if (result?.embeddings) {
                    const vectors = result.embeddings.map(emb => {
                        const vector = emb.values || emb.floatEmbedding;
                        return vector ? Array.from(vector) : null;
                    });
                    return isArray ? vectors : vectors[0];
                }
            } catch (err) {
                console.error("AI Embedding Error:", err);
            }
            return isArray ? new Array(items.length).fill(null) : null;
        }

        async findRelevantLinks(query, links, options = {}) {
            const blockedUrls = options.blockedUrls || [];

            // 1. HARD FILTER: Remove blocked URLs and system pages immediately
            const filteredLinks = links.filter(item => {
                const isBlocked = blockedUrls.includes(item.url);
                const isSystemPage = item.url.startsWith('chrome://') ||
                    item.url.startsWith('about:');
                return !isBlocked && !isSystemPage;
            });

            if (!this.embedder) await this.init();
            if (!this.embedder) return [];

            // 1. Get query embedding
            let queryEmbedding = null;
            try {
                const queryResult = await this.embedder.embed(query, { taskType: "retrieval-query" });
                if (queryResult?.embeddings?.[0]) {
                    queryEmbedding = queryResult.embeddings[0];
                }
            } catch (err) {
                console.error("AI Query Embedding Error:", err);
            }

            if (!queryEmbedding) return [];

            // 2. Identify which items need embeddings
            const uncachedItems = [];
            filteredLinks.forEach(item => {
                const cached = item.embedding || this.embeddingCache.get(item.url);
                if (!cached) {
                    uncachedItems.push(item);
                }
            });

            // 3. Batch embed uncached items
            if (uncachedItems.length > 0) {
                console.log(`[LinkStreak AI] Batch embedding ${uncachedItems.length} uncached items in findRelevantLinks...`);
                const vectors = await this.getEmbedding(uncachedItems, "retrieval-document");
                
                vectors.forEach((vec, idx) => {
                    if (vec) {
                        const item = uncachedItems[idx];
                        this.embeddingCache.set(item.url, vec);
                        chrome.runtime.sendMessage({
                            action: "cache-embedding",
                            url: item.url,
                            title: item.title,
                            embedding: vec
                        });
                        item.embedding = vec;
                    }
                });
            }

            const scoredLinks = [];

            for (const item of filteredLinks) {
                try {
                    const linkVector = item.embedding || this.embeddingCache.get(item.url);

                    if (linkVector) {
                        // THE TRICK: We wrap the cached array into a dummy Embedding object 
                        // that mimics the exact structure the library expects.
                        const mockEmbedding = {
                            floatEmbedding: new Float32Array(linkVector),
                            headIndex: 0,
                            headName: "default"
                        };

                        // Use the internal similarity logic that compares Objects, not just Arrays
                        const score = this.TextEmbedder.cosineSimilarity(queryEmbedding, mockEmbedding);
                        scoredLinks.push({ link: item, score });
                    } else {
                        console.log(`[LinkStreak] Missing linkVector for ${item.url}`);
                    }
                } catch (err) {
                    console.error("LinkStreak: Math clash", err);
                }
            }

            return scoredLinks.sort((a, b) => b.score - a.score).slice(0, 100);
        }

        async summarizePage(text, options = {}) {
            if (window.LinkySummarizer) {
                return await window.LinkySummarizer.summarize(text, options);
            }
            return text.substring(0, 200);
        }

        async searchWithContext(focus, ambient, options = {}) {
            // Use dynamic weights from options, falling back to defaults
            const focusWeight = options.focusWeight !== undefined ? options.focusWeight : 0.7;
            const contextWeight = options.contextWeight !== undefined ? options.contextWeight : 0.3;

            if (!this.embedder) await this.init();

            const focusVec = await this.getEmbedding(focus);
            const ambientVec = await this.getEmbedding(ambient);

            if (!focusVec && !ambientVec) return [];

            // Adjust weights if one is missing to avoid dilution
            let fW = focusWeight;
            let aW = contextWeight;

            if (!focusVec) {
                fW = 0;
                aW = 1.0;
            } else if (!ambientVec) {
                fW = 1.0;
                aW = 0;
            }

            // Blend vectors using the provided weights
            const compositeVector = (focusVec || ambientVec).map((_, i) => {
                const fVal = focusVec ? focusVec[i] : 0;
                const aVal = ambientVec ? ambientVec[i] : 0;
                return (fVal * fW) + (aVal * aW);
            });

            return this._searchByVector(compositeVector, options.links);
        }

        // Helper to search using a pre-computed vector
        async _searchByVector(vector, links = []) {
            const scoredLinks = [];
            const queryEmbedding = { floatEmbedding: new Float32Array(vector) };

            // Ensure we have browser data if links weren't passed
            const targetLinks = links.length > 0 ? links : await this._getUniqueLinks();

            console.log(`[LinkStreak AI] Searching across ${targetLinks.length} target links.`);

            // 1. Identify which items need embeddings
            const uncachedItems = [];
            targetLinks.forEach(item => {
                const cached = item.embedding || this.embeddingCache.get(item.url);
                if (!cached) {
                    uncachedItems.push(item);
                }
            });

            // 2. Batch embed uncached items
            if (uncachedItems.length > 0) {
                console.log(`[LinkStreak AI] Batch embedding ${uncachedItems.length} uncached items in _searchByVector...`);
                const vectors = await this.getEmbedding(uncachedItems, "retrieval-document");
                
                vectors.forEach((vec, idx) => {
                    if (vec) {
                        const item = uncachedItems[idx];
                        this.embeddingCache.set(item.url, vec);
                        item.embedding = vec;
                    }
                });
            }

            // 3. Score links synchronously
            for (const item of targetLinks) {
                const linkVector = item.embedding || this.embeddingCache.get(item.url);
                if (linkVector) {
                    const mockLinkEmbedding = { floatEmbedding: new Float32Array(linkVector) };
                    const score = this.TextEmbedder.cosineSimilarity(queryEmbedding, mockLinkEmbedding);
                    scoredLinks.push({ link: item, score });
                }
            }

            return scoredLinks.sort((a, b) => b.score - a.score).slice(0, 100);
        }

        async _getUniqueLinks() {
            const data = await chrome.runtime.sendMessage({ action: "get-browser-data" });
            const all = [...(data.tabs || []), ...(data.history || [])];
            return all.filter((v, i, a) => a.findIndex(t => t.url === v.url) === i);
        }
    }

    window.linkyAIEngine = new AIEngine();
} catch (e) {
    console.error("LinkStreak: AI Engine failed to load:", e);
}