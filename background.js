// background.js - Central State Manager
const VECTOR_CACHE_KEY = 'linky_vector_cache';
const QUEUE_KEY = 'activeQueue';
let lastSelection = null;

// 1. Unified Message Listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "get-browser-data") {
    chrome.storage.local.get(['retrievalOptions', VECTOR_CACHE_KEY]).then(async data => {
      const storedOpts = data.retrievalOptions || {
        maxHistoryResults: 150,
        currentWindowLimit: false,
        ignorePinnedTabs: true,
        localOnly: false
      };

      // Merge stored options with any request-specific overrides (from Link Inspector)
      const opts = {
        ...storedOpts,
        ...(request.options || {})
      };

      const cache = data[VECTOR_CACHE_KEY] || {};

      const tabsQuery = { windowType: 'normal' };
      if (opts.currentWindowLimit) tabsQuery.currentWindow = true;
      if (opts.ignorePinnedTabs) tabsQuery.pinned = false;

      // Get current active tab to exclude it
      const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const currentUrl = currentTab?.url;

      const [history, tabs] = await Promise.all([
        chrome.history.search({ text: '', maxResults: opts.maxHistoryResults }),
        chrome.tabs.query(tabsQuery)
      ]);

      // Filter out current tab by ID and matching current URL
      const filteredTabs = tabs.filter(t => t.id !== currentTab?.id && t.url !== currentUrl);
      const rawHistory = history.filter(h => h.url !== currentUrl);

      // --- Local History Tagging/Filtering ---
      const processedHistory = await Promise.all(rawHistory.map(async item => {
        // 1. Check Cache first
        if (cache[item.url] && cache[item.url].isLocal !== undefined) {
          item.isLocal = cache[item.url].isLocal;
        } else {
          // 2. Query History for visits if not in cache
          try {
            const visits = await chrome.history.getVisits({ url: item.url });
            if (visits && visits.length > 0) {
              item.isLocal = visits[visits.length - 1].isLocal;
              // 3. Cache the result
              cache[item.url] = { ...(cache[item.url] || {}), isLocal: item.isLocal };
            } else {
              item.isLocal = true; // Fallback to local if no visits (shouldn't happen)
            }
          } catch (e) {
            item.isLocal = true;
          }
        }

        // Return item if we don't care about local-only, or if it IS local
        if (!opts.localOnly) return item;
        return item.isLocal ? item : null;
      }));

      const filteredHistory = processedHistory.filter(h => h !== null);

      // Persist the updated cache with isLocal flags if we updated anything
      await chrome.storage.local.set({ [VECTOR_CACHE_KEY]: cache });

      sendResponse({ history: filteredHistory, tabs: filteredTabs });
    });
    return true; // Keep channel open for async
  }

  if (request.action === "cache-embedding") {
    saveToVectorCache(request.url, request);
  }

  if (request.action === "update-queue") {
    // Sync the badge count when the sidepanel changes the queue
    updateBadge(request.queue.length);
  }

  if (request.action === "text-selected") {
    lastSelection = {
      focus: request.selectedText,
      extra: request.ambientContext || ""
    };
    // Just store it. If the sidepanel is open, it will handle the event.
    // If it's closed, it will pull this when it opens.
  }

  if (request.action === "get-last-selection") {
    sendResponse(lastSelection);
    // Clear it after it's been "consumed" to prevent zombie states
    lastSelection = null;
  }

  if (request.action === "get-next-link") {
    handleCopyNext();
    sendResponse({ status: "started" });
  }
});

// 2. Command Listener (Alt+Shift+V)
chrome.commands.onCommand.addListener((command) => {
  if (command === "copy-next-link") {
    handleCopyNext();
  }
});

async function handleCopyNext() {
  // ALWAYS fetch fresh from storage to avoid Service Worker sleep issues
  const data = await chrome.storage.local.get([QUEUE_KEY]);
  let queue = data[QUEUE_KEY] || [];

  if (queue.length === 0) {
    console.warn("LinkStreak: Queue is empty or finished.");
    updateBadge(0);
    return;
  }

  const nextLink = queue[0];

  // Try to paste into active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (tab && tab.url?.startsWith('http')) {
    chrome.tabs.sendMessage(tab.id, {
      action: "insert-text",
      text: nextLink.url
    }).then(async (response) => {
      if (response?.status === "success") {
        // Success! Remove from queue and update storage
        queue.shift();
        await chrome.storage.local.set({ [QUEUE_KEY]: queue });
        updateBadge(queue.length);

        // Notify Sidepanel to animate the removal
        chrome.runtime.sendMessage({
          action: "update-queue",
          queue: queue
        }).catch(() => { /* Sidepanel closed */ });
      }
    }).catch(err => console.warn("Content script not reachable."));
  }

  // Fallback: Copy to clipboard regardless of paste success
  await copyToClipboard(nextLink.url);
}

// 3. Clipboard & Offscreen Logic
async function copyToClipboard(text) {
  const existing = await chrome.offscreen.hasDocument();
  if (!existing) {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: [chrome.offscreen.Reason.CLIPBOARD],
      justification: "Copying links to clipboard fallback."
    });
  }

  chrome.runtime.sendMessage({
    type: "copy-data", // Matches your offscreen.js listener
    target: "offscreen",
    data: text
  });
}

// 4. Utility: Badge UI
function updateBadge(count) {
  const text = count > 0 ? count.toString() : "";
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color: "#4285f4" });
}

// 5. Context Menu & Sidepanel Setup
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "openSidePanel",
    title: "Search LinkStreak for '%s'",
    contexts: ["selection"]
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "openSidePanel") {
    await chrome.sidePanel.open({ windowId: tab.windowId });
    setTimeout(() => {
      chrome.runtime.sendMessage({
        action: "text-selected",
        text: info.selectionText
      }).catch(() => { });
    }, 600);
  }
});

// 6. Indexing & Scraping
async function saveToVectorCache(url, data) {
  const result = await chrome.storage.local.get([VECTOR_CACHE_KEY]);
  const cache = result[VECTOR_CACHE_KEY] || {};
  cache[url] = { ...(cache[url] || {}), ...data, timestamp: Date.now() };

  const keys = Object.keys(cache);
  if (keys.length > 500) delete cache[keys[0]]; // Circular buffer

  await chrome.storage.local.set({ [VECTOR_CACHE_KEY]: cache });
}

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url?.startsWith('http')) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          // Collect H1, H2, H3
          const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
            .map(h => h.innerText.trim())
            .filter(t => t.length > 0)
            .slice(0, 10) // Cap to avoid massive strings
            .join(' | ');

          return {
            description: document.querySelector('meta[name="description"]')?.content || "",
            headings: headings
          };
        }
      });

      const metadata = results?.[0]?.result;
      if (metadata) {
        // Simple hash to detect content changes (using headings instead of h1)
        const contentStr = `${tab.title}|${metadata.description}|${metadata.headings}`;
        const contentHash = hashCode(contentStr);

        // PERSIST the metadata to the cache and WAIT for it to finish
        await saveToVectorCache(tab.url, {
          title: tab.title,
          description: metadata.description,
          headings: metadata.headings,
          contentHash
        });

        chrome.runtime.sendMessage({
          action: "index-new-page",
          url: tab.url,
          title: tab.title,
          contentHash,
          metadata
        }).catch(() => { });
      }
    } catch (e) {
      // Scripting might fail on restricted pages
    }
  }
});

function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32bit integer
  }
  return hash.toString(36);
}

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });