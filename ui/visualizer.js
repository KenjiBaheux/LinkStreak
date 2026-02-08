/**
 * visualizer.js
 * 
 * Responsible for rendering the vector signature heatmap.
 * Decoupled from data fetching - just draws what it's given.
 */

const LinkyVisualizer = {
    /**
     * Renders a heatmap of the embedding vector onto the provided canvas.
     * @param {HTMLCanvasElement} canvas - The canvas element to draw on.
     * @param {number[]|Float32Array} vector - The embedding vector (1D array of floats).
     */
    renderHeatmap: (canvas, vector) => {
        if (!canvas || !vector || vector.length === 0) return;

        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;

        // Clear canvas
        ctx.clearRect(0, 0, width, height);

        // 1. Calculate Grid Dimensions (Square Root Logic)
        const totalCells = vector.length;
        const root = Math.sqrt(totalCells);

        // Try to find factors close to the root for a near-square rectangle
        // For standard powers of 2 (512, 768), this works well.
        // e.g., 512 -> sqrt 22.6 -> 16 * 32
        // e.g., 768 -> sqrt 27.7 -> 24 * 32
        // e.g., 100 -> sqrt 10 -> 10 * 10

        let cols = Math.ceil(root);
        let rows = Math.ceil(totalCells / cols);

        // Simple heuristic: if we can find a cleaner factor pair nearby, use it?
        // For now, simple ceil(sqrt) is robust for ANY length.

        const cellWidth = width / cols;
        const cellHeight = height / rows;

        // 2. Auto-Range Calculation
        // Embeddings are often normalized, but their distribution can be sparse.
        // We want to highlight the "nuance closer to 0" while handling outliers.
        // Strategy: Sort squared values to find the 98th percentile energy, use that as max range.
        const sortedSq = Float32Array.from(vector).map(v => v * v).sort();
        const p98Index = Math.floor(sortedSq.length * 0.98);
        const p98Sq = sortedSq[p98Index];

        // If vector is all zeros or extremely small, default to 1.0 scale (no amplify)
        // Otherwise, scale such that P98 maps to ~1.0
        let scale = 15.0; // Default fallback
        if (p98Sq > 0.000001) {
            const p98 = Math.sqrt(p98Sq);
            // We want p98 to be roughly at 1.0 (full saturation).
            scale = 1.0 / p98;
        }

        // 3. Draw Cells
        requestAnimationFrame(() => {
            for (let i = 0; i < totalCells; i++) {
                const val = vector[i];
                const col = i % cols;
                const row = Math.floor(i / cols);

                const x = col * cellWidth;
                const y = row * cellHeight;

                ctx.fillStyle = getColorForValue(val, scale);
                ctx.fillRect(x, y, cellWidth, cellHeight);
            }
        });

        return `${cols} × ${rows} (${totalCells}d)`;
    }
};

/**
 * Maps a float value to a CSS color string using a dynamic scale.
 * @param {number} val - The raw float value.
 * @param {number} scale - The amplification factor determined by auto-ranging.
 */
function getColorForValue(val, scale) {
    // Apply dynamic scale
    const amplified = val * scale;
    // Clamp to -1..1 for color mixing
    const clamped = Math.max(-1, Math.min(1, amplified));

    // Uses project colors:
    // - Positive (> 0): Cyan (var(--accent-cyan) / #22d3ee)
    // - Zero (~0): Deep Slate (var(--bg-card) / #1e293b)
    // - Negative (< 0): Amber (contrasting)

    if (clamped > 0) {
        // Cyan intensity
        // #22d3ee is approx 34, 211, 238
        // We'll fade from slate (#1e293b) to cyan
        const r = interpolate(30, 34, clamped);
        const g = interpolate(41, 211, clamped);
        const b = interpolate(59, 238, clamped);
        return `rgb(${r}, ${g}, ${b})`;
    } else {
        // Negative: Amber (#f59e0b => 245, 158, 11)
        const absVal = Math.abs(clamped);
        const r = interpolate(30, 245, absVal);
        const g = interpolate(41, 158, absVal);
        const b = interpolate(59, 11, absVal);
        return `rgb(${r}, ${g}, ${b})`;
    }
}

function interpolate(start, end, factor) {
    return Math.round(start + (end - start) * factor);
}

window.LinkyVisualizer = LinkyVisualizer;
