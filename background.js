// background.js - Central State Manager
const VECTOR_CACHE_KEY = 'linky_vector_cache';
const QUEUE_KEY = 'activeQueue';
let lastSelection = null;

// 1. Unified Message Listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "get-browser-data") {
    chrome.storage.local.get(['retrievalOptions']).then(async data => {
      const opts = data.retrievalOptions || {
        maxHistoryResults: 150,
        currentWindowLimit: false,
        ignorePinnedTabs: true
      };

      const tabsQuery = { windowType: 'normal' };
      if (opts.currentWindowLimit) tabsQuery.currentWindow = true;
      if (opts.ignorePinnedTabs) tabsQuery.pinned = false;

      // Get current active tab to exclude it
      const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const currentUrl = currentTab?.url;

      Promise.all([
        chrome.history.search({ text: '', maxResults: opts.maxHistoryResults }),
        chrome.tabs.query(tabsQuery)
      ]).then(([history, tabs]) => {
        // Filter out current tab by ID and matching current URL
        const filteredTabs = tabs.filter(t => t.id !== currentTab?.id && t.url !== currentUrl);
        const filteredHistory = history.filter(h => h.url !== currentUrl);

        sendResponse({ history: filteredHistory, tabs: filteredTabs });
      });
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

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url?.startsWith('http')) {
    chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({
        description: document.querySelector('meta[name="description"]')?.content || "",
        h1: document.querySelector('h1')?.innerText || ""
      })
    }).then(results => {
      const metadata = results?.[0]?.result;
      if (metadata) {
        // Simple hash to detect content changes
        const contentStr = `${tab.title}|${metadata.description}|${metadata.h1}`;
        const contentHash = hashCode(contentStr);

        chrome.runtime.sendMessage({
          action: "index-new-page",
          url: tab.url,
          title: tab.title,
          contentHash,
          metadata
        }).catch(() => { });
      }
    }).catch(() => { });
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