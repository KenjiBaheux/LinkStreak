// ai_engine.js - Optimized for Stability

try {
    class AIEngine {
        constructor() {
            this.embedder = null;
            this.embeddingCache = new Map();
        }

        async init() {
            if (this.embedder) return true;
            try {
                const bundleURL = chrome.runtime.getURL('mediapipe_wasm/text_bundle.js');
                const mediapipe = await import(bundleURL);
                this.TextEmbedder = mediapipe.TextEmbedder;
                this.FilesetResolver = mediapipe.FilesetResolver;

                const wasmFolder = chrome.runtime.getURL("mediapipe_wasm");
                const textFiles = await this.FilesetResolver.forTextTasks(wasmFolder);

                this.embedder = await this.TextEmbedder.createFromOptions(textFiles, {
                    baseOptions: {
                        modelAssetPath: chrome.runtime.getURL("models/universal_sentence_encoder.tflite"),
                        delegate: "CPU"
                    },
                    quantize: false
                });
                console.log("LinkStreak: USE Model Loaded Successfully.");
                return true;
            } catch (e) {
                console.error("LinkStreak: Initialization Error.", e);
                return false;
            }
        }

        async getEmbedding(input) {
            if (!this.embedder) await this.init();

            let textToEmbed = (typeof input === 'string') ? input :
                `Title: ${input.title || ''} Description: ${input.description || ''}`.trim();

            if (!textToEmbed) return null;

            textToEmbed = textToEmbed
                .replace(/[\x00-\x1F\x7F-\x9F]/g, "") // Remove non-printable control chars
                .replace(/["']/g, " ")               // Replace quotes with spaces to avoid grouping errors
                .replace(/\s+/g, " ")                // Collapse all whitespace to single spaces
                .trim();

            try {
                const result = this.embedder.embed(textToEmbed);

                if (result?.embeddings?.[0]) {
                    const vector = result.embeddings[0].floatEmbedding;
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

            // 1. Get query embedding
            const queryResult = this.embedder.embed(query);
            if (!queryResult?.embeddings?.[0]) return [];

            // KEEP the original embedding object from the library for the query
            const queryEmbedding = queryResult.embeddings[0];

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
                    }
                } catch (err) {
                    console.error("LinkStreak: Math clash", err);
                }
            }

            return scoredLinks.sort((a, b) => b.score - a.score).slice(0, 10);
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

            if (!focusVec) return [];

            // Blend vectors using the provided weights
            const compositeVector = focusVec.map((val, i) => {
                const ambientVal = ambientVec ? ambientVec[i] : val;
                return (val * focusWeight) + (ambientVal * contextWeight);
            });

            return this._searchByVector(compositeVector, options.links);
        }

        // Helper to search using a pre-computed vector
        async _searchByVector(vector, links = []) {
            const scoredLinks = [];
            const queryEmbedding = { floatEmbedding: new Float32Array(vector) };

            // Ensure we have browser data if links weren't passed
            const targetLinks = links.length > 0 ? links : await this._getUniqueLinks();

            for (const item of targetLinks) {
                let linkVector = item.embedding || this.embeddingCache.get(item.url);

                if (!linkVector) {
                    linkVector = await this.getEmbedding(item);
                    if (linkVector) this.embeddingCache.set(item.url, linkVector);
                }

                if (linkVector) {
                    const mockLinkEmbedding = { floatEmbedding: new Float32Array(linkVector) };
                    const score = this.TextEmbedder.cosineSimilarity(queryEmbedding, mockLinkEmbedding);
                    scoredLinks.push({ link: item, score });
                }
            }

            return scoredLinks.sort((a, b) => b.score - a.score).slice(0, 10);
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