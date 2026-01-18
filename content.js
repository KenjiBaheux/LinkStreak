// content.js - Selection and Paste Logic

// 1. Listen for Paste Command from Extension
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "ping") {
        sendResponse({ status: "alive" });
    } else if (request.action === "insert-text") {
        insertTextAtCursor(request.text);
        sendResponse({ status: "success" });
    }
    return true;
});

// 2. SMART SELECTION LISTENER
// This now uses your context-aware logic to send both Anchor + Field
document.addEventListener('mouseup', () => {
    const contextData = getContextAwareSelection();

    if (contextData && contextData.selectedText.length > 2) {
        chrome.runtime.sendMessage({
            action: "text-selected",
            selectedText: contextData.selectedText,
            ambientContext: contextData.ambientContext
        });
    }
});

// 3. KEYBOARD SHORTCUT (Alt + Shift + V)
// Allows the user to trigger the paste without leaving the keyboard
// content.js - Updated Shortcut Listener
document.addEventListener('keydown', (e) => {
    if (e.altKey && e.shiftKey && e.code === 'KeyV') {
        e.preventDefault();
        e.stopImmediatePropagation(); // Prevent Gmail from seeing this

        console.log("LinkStreak: Shortcut detected, requesting link...");

        chrome.runtime.sendMessage({ action: "get-next-link" }, (response) => {
            // Check for errors or empty responses
            if (chrome.runtime.lastError) {
                console.warn("LinkStreak: Sidepanel likely closed. Shortcut requires sidepanel to be open.");
                return;
            }

            if (response && response.link) {
                console.log("LinkStreak: Injecting:", response.link.url);
                insertTextAtCursor(response.link.url);
            } else {
                console.log("LinkStreak: Queue is empty.");
            }
        });
    }
}, true); // The 'true' here is vital—it uses the "Capture" phase

// --- HELPER FUNCTIONS ---

function getContextAwareSelection() {
    const selection = window.getSelection();
    const selectedText = selection.toString().trim();
    if (!selectedText) return null;

    let node = selection.anchorNode;
    if (!node) return { selectedText, ambientContext: "" };

    // 1. Find the nearest block container
    let container = node.nodeType === 3 ? node.parentElement : node;
    while (container && container.parentElement &&
        window.getComputedStyle(container).display === 'inline') {
        container = container.parentElement;
    }

    // 2. SMART EXTRACTION: Handle Textareas vs standard HTML
    let rawContext = "";

    // Check if the selection is happening inside a form field
    const activeEl = document.activeElement;
    const isField = activeEl && (activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'INPUT');

    if (isField) {
        // For textareas, the "context" is simply the full value of the field
        rawContext = activeEl.value;
    } else {
        // For standard Gmail/ContentEditable, use innerText
        rawContext = container ? (container.innerText || container.textContent) : "";
    }

    // ESCAPING FOR CAPTURE:
    // 1. Remove script and style tags entirely
    // 2. Convert HTML entities (like &nbsp;) to standard spaces
    const cleanContext = rawContext
        .replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gim, "")
        .replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gim, "")
        .replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    return {
        selectedText: selectedText,
        ambientContext: cleanContext.slice(0, 1000)
    };
}



function insertTextAtCursor(text) {
    const el = document.activeElement;
    if (!el) return;

    let success = false;

    // 1. Try Native way (Preserves Undo)
    try {
        el.focus();
        success = document.execCommand('insertText', false, text);
    } catch (e) {
        success = false;
    }

    // 2. Fallback for manual value setting
    if (!success) {
        if (el.isContentEditable) {
            const selection = window.getSelection();
            if (selection.rangeCount > 0) {
                const range = selection.getRangeAt(0);
                range.deleteContents();
                const textNode = document.createTextNode(text);
                range.insertNode(textNode);
                range.setStartAfter(textNode);
                selection.removeAllRanges();
                selection.addRange(range);
            }
        } else if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
            const start = el.selectionStart;
            const end = el.selectionEnd;
            el.value = el.value.slice(0, start) + text + el.value.slice(end);
            el.selectionStart = el.selectionEnd = start + text.length;
        }
    }

    // 3. Wake up Gmail's listeners
    const eventOptions = { bubbles: true, cancelable: true };
    el.dispatchEvent(new Event('input', eventOptions));
    el.dispatchEvent(new Event('change', eventOptions));
    el.dispatchEvent(new InputEvent('input', {
        data: text,
        inputType: 'insertText',
        ...eventOptions
    }));
}