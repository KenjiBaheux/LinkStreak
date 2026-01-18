const fs = require('fs');
const path = require('path');
const https = require('https');

// Configuration
const ASSETS = [
    {
        url: 'https://storage.googleapis.com/mediapipe-models/text_embedder/universal_sentence_encoder/float32/1/universal_sentence_encoder.tflite',
        dest: 'models/universal_sentence_encoder.tflite'
    },
    // MediaPipe WASM (Using a specific version to ensure stability, e.g., 0.10.0 or latest)
    // Note: The file names in the CDN often match the internal names.
    // We will fetch from jsdelivr for @mediapipe/tasks-text
    {
        url: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-text@0.10.9/wasm/text_wasm_internal.js',
        dest: 'mediapipe_wasm/text_wasm_internal.js'
    },
    {
        url: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-text@0.10.9/wasm/text_wasm_internal.wasm',
        dest: 'mediapipe_wasm/text_wasm_internal.wasm'
    },
    {
        url: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-text@0.10.9/wasm/text_wasm_nosimd_internal.js',
        dest: 'mediapipe_wasm/text_wasm_nosimd_internal.js'
    },
    {
        url: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-text@0.10.9/wasm/text_wasm_nosimd_internal.wasm',
        dest: 'mediapipe_wasm/text_wasm_nosimd_internal.wasm'
    },
    // text_bundle.js isn't always standard, but let's assume it's the main index for the web.
    // Actually, for the tasks-text package, usually you import { TextEmbedder } from the package.
    // If 'text_bundle.js' is a custom bundle the user created, we might need to KEEP it in the repo.
    // Checking the previous file list, 'text_bundle.js' is small (52KB). It might be the bundled JS library itself.
    // We will SKIP downloading text_bundle.js and assume it should stay in the repo if it's the library code wrapper.
];

// Helper to download
function download(url, dest) {
    const dir = path.dirname(dest);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    const file = fs.createWriteStream(dest);
    console.log(`Downloading ${path.basename(dest)}...`);

    https.get(url, (response) => {
        if (response.statusCode !== 200) {
            console.error(`Failed to download ${url}: ${response.statusCode}`);
            file.close();
            fs.unlinkSync(dest);
            return;
        }

        response.pipe(file);

        file.on('finish', () => {
            file.close();
            console.log(`✓ ${path.basename(dest)} downloaded.`);
        });
    }).on('error', (err) => {
        fs.unlinkSync(dest);
        console.error(`Error downloading ${url}: ${err.message}`);
    });
}

// Check for Node environment
if (typeof process === 'undefined') {
    console.error('This script must be run with Node.js');
} else {
    console.log('Setting up Link Streak dependencies...');
    ASSETS.forEach(asset => {
        download(asset.url, asset.dest);
    });
}
