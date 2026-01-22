// metadata_health.js - Shared utility for assessing metadata quality

window.LinkyHealth = {
    calculate(meta) {
        let score = 0;
        const notes = [];

        if (!meta) return { score: 0, notes: [{ type: 'fail', text: 'No metadata found' }] };

        const title = meta.title || "";
        const description = meta.description || "";
        const headings = meta.headings || meta.h1 || "";
        const totalLength = title.length + description.length + headings.length;

        // 1. Identity (Title - max 20)
        if (title.length > 10) {
            score += 20;
            notes.push({ type: 'pass', text: 'Strong title' });
        } else if (title.length > 0) {
            score += 10;
            notes.push({ type: 'warn', text: 'Short title' });
        } else {
            notes.push({ type: 'fail', text: 'Missing title' });
        }

        // 2. Depth (Description - max 30) - Aligned with 20% penalty impact
        if (description.length > 50) {
            score += 30;
            notes.push({ type: 'pass', text: 'Rich description' });
        } else if (description.length > 0) {
            score += 15;
            notes.push({ type: 'warn', text: 'Brief description' });
        } else {
            notes.push({ type: 'fail', text: 'Missing description' });
        }

        // 3. Context (Headings - max 20)
        if (headings.length > 0) {
            score += 20;
            notes.push({ type: 'pass', text: 'Headings detected' });
        } else {
            notes.push({ type: 'warn', text: 'No headings (H1-H3)' });
        }

        // 4. NEW: Density Alignment (max 30) - Aligned with 40% penalty threshold
        if (totalLength >= 60) {
            score += 30;
            notes.push({ type: 'pass', text: 'Sufficient metadata density' });
        } else {
            notes.push({ type: 'fail', text: 'Sparse metadata (< 60 chars)' });
        }

        return { score, notes };
    }
};
