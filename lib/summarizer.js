// summarizer.js - Wrapper for Chrome's built-in AI Summarizer API with progress tracking

class LinkySummarizer extends EventTarget {
    constructor() {
        super();
        this.instance = null;
        this.status = 'idle'; // 'idle', 'downloading', 'ready', 'failed'
        this.progress = { loaded: 0, total: 0 };
        this._initPromise = null;
    }

    async isAvailable() {
        if (typeof Summarizer === 'undefined') return 'no';
        try {
            return await Summarizer.availability();
        } catch (e) {
            console.warn("LinkySummarizer: Availability check failed", e);
            return 'no';
        }
    }

    async init(options = {}) {
        // If already initializing, return the same promise
        if (this._initPromise) return this._initPromise;

        this._initPromise = this._performInit(options);
        return this._initPromise;
    }

    async _performInit(options) {
        const availability = await this.isAvailable();

        if (availability === 'no') {
            this._updateStatus('failed');
            return false;
        }

        try {
            if (availability === 'after-download') {
                this._updateStatus('downloading');
            }

            // Create with monitor to track progress
            this.instance = await Summarizer.create({
                ...options,
                monitor: (m) => {
                    m.addEventListener('downloadprogress', (e) => {
                        this.progress = { loaded: e.loaded, total: e.total };
                        this.dispatchEvent(new CustomEvent('progress', { detail: this.progress }));
                    });
                }
            });

            this._updateStatus('ready');
            return true;
        } catch (e) {
            console.error("LinkySummarizer: Initialization failed", e);
            this._updateStatus('failed');
            return false;
        }
    }

    _updateStatus(newStatus) {
        if (this.status !== newStatus) {
            this.status = newStatus;
            this.dispatchEvent(new CustomEvent('statuschange', { detail: { status: this.status } }));
        }
    }

    async summarize(text, options = {}) {
        // If failed or no API, return truncation
        const availability = await this.isAvailable();
        if (availability === 'no' || this.status === 'failed') {
            return text.substring(0, 200);
        }

        // If idle, start initialization
        if (this.status === 'idle') {
            this.init(options.config || {});
        }

        // If downloading/initializing, wait for it
        if (this._initPromise) {
            const success = await this._initPromise;
            if (!success) return text.substring(0, 200);
        }

        try {
            if (options.context) {
                return await this.instance.summarize(text, { context: options.context });
            }
            return await this.instance.summarize(text);
        } catch (e) {
            console.warn("LinkySummarizer: Summarization failed", e);
            return text.substring(0, 200);
        }
    }

    async destroy() {
        if (this.instance) {
            this.instance.destroy();
            this.instance = null;
            this._updateStatus('idle');
            this._initPromise = null;
            this.progress = { loaded: 0, total: 0 };
        }
    }
}

window.LinkySummarizer = new LinkySummarizer();