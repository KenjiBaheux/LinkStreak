# Link Streak 🔗

Link Streak is a Chrome Extension that transforms your browser history and tabs into a semantic knowledge base. Instead of remembering exact keywords, you can find links based on *concepts* and *context*. 

With this extension, you can quickly build a list of links based on your current context (e.g. selected text and surrounding text) which you can then paste sequentially. This is a lot more efficient than having to juggle between tabs to search and copy links one by one. 

## Example with Gmail 
 1. Start by writing your draft email
 2. Select the first sentence/words you want to linkify.
 3. Call the extension (Alt Shift L).
 4. Build a streak of links you want to add to your email from the suggested items. Feel free to edit the context, and play with the filters to refine the list.
 5. Go back to Gmail, hit ctrl K to insert a link, followed by Alt Shift V to paste the next link in the streak.
 6. Repeat step 5 to clear your link streak.


## Features

-   **🧠 Semantic Search**: Uses a local AI model (Universal Sentence Encoder) to understand the meaning of your queries, not just keyword matching.
-   **🔥 Link Streak**: A drag-and-drop queue to build a collection of relevant links for your current browsing session.
-   **⚡ Contextual Awareness**: Select text on any web page to instantly find related links from your history and open tabs.
-   **🎛️ Fine-Tuned Control**: Adjust weights for "Semantic Match", "Recency", and "Frequency" to tailor recommendations to your needs.
-   **🔒 Privacy First**: All AI processing happens locally on your device. Your data never leaves your browser.

## Installation

1.  Clone this repository.
2.  Install [Node.js](https://nodejs.org/) if you haven't already.
3.  Run the setup script to download the required AI models and WASM files:
    ```bash
    node setup.js
    ```
4.  Open Chrome and navigate to `chrome://extensions/`.
5.  Enable **Developer mode** (toggle in the top right).
6.  Click **Load unpacked** and select the folder containing this repository.

## How it Works

Link Streak runs a lightweight AI model directly in your browser side panel. It indexes your history and tabs, generating vector embeddings that allow for "fuzzy" conceptual matching.

## Disclaimer

> [!WARNING]
> **This project was largely "vibe coded"** ⚡
>
> It is provided as-is, with no guarantees of stability, performance, or code hygiene. Use at your own risk, and feel free to refactor!
