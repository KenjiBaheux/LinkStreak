// offscreen.js - Clipboard Bridge

chrome.runtime.onMessage.addListener((message) => {
    // Only handle messages meant for this offscreen document
    if (message.target !== "offscreen") return;

    if (message.type === "copy-data") {
        copyToClipboard(message.data);
    }
});

function copyToClipboard(text) {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.select();
    try {
        document.execCommand("copy");
        console.log("LinkStreak: Clipboard fallback successful.");
    } catch (err) {
        console.error("LinkStreak: Clipboard fallback failed:", err);
    }
    document.body.removeChild(textArea);
}