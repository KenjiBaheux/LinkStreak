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

            let textToEmbed = (typeof input === 'string') ? input :
                `Title: ${input.title || ''} Headings: ${input.headings || input.h1 || ''} Description: ${input.description || ''}`.trim();

            if (!textToEmbed) return null;

            textToEmbed = textToEmbed
                .replace(/[\x00-\x1F\x7F-\x9F]/g, "") // Remove non-printable control chars
                .replace(/["']/g, " ")               // Replace quotes with spaces to avoid grouping errors
                .replace(/\s+/g, " ")                // Collapse all whitespace to single spaces
                .trim();

            if (!taskType) {
                taskType = (typeof input === 'object') ? 'retrieval-document' : 'retrieval-query';
            }

            try {
                const result = await this.embedder.embed(textToEmbed, { taskType });

                if (result?.embeddings?.[0]) {
                    const vector = result.embeddings[0].values || result.embeddings[0].floatEmbedding;
                    return vector ? Array.from(vector) : null;
                }
            } catch (err) {
                console.error("AI Embedding Error:", err);
            }
            return null;
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

            const scoredLinks = [];

            for (const item of filteredLinks) {
                try {
                    let linkVector = item.embedding || this.embeddingCache.get(item.url);

                    if (!linkVector) {
                        const res = await this.getEmbedding(item);
                        if (res) {
                            linkVector = res; // This is a plain array
                            this.embeddingCache.set(item.url, linkVector);
                            chrome.runtime.sendMessage({
                                action: "cache-embedding",
                                url: item.url,
                                title: item.title,
                                embedding: linkVector
                            });
                        }
                    }

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

            for (const item of targetLinks) {
                let linkVector = item.embedding || this.embeddingCache.get(item.url);

                if (!linkVector) {
                    linkVector = await this.getEmbedding(item);
                    if (linkVector) {
                        this.embeddingCache.set(item.url, linkVector);
                    } else {
                        console.log(`[LinkStreak AI] No embedding available for: ${item.url}`);
                    }
                }

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