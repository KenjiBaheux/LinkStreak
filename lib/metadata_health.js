// metadata_health.js - Shared utility for assessing metadata quality

window.LinkyHealth = {
    calculate(meta) {
        let score = 0;
        const notes = [];

        if (!meta) return { score: 0, notes: [{ type: 'fail', text: 'No metadata found' }] };

        // Title Check (max 30)
        if (meta.title && meta.title.length > 10) {
            score += 30;
            notes.push({ type: 'pass', text: 'Good title length' });
        } else if (meta.title) {
            score += 15;
            notes.push({ type: 'warn', text: 'Title is a bit short' });
        } else {
            notes.push({ type: 'fail', text: 'Title is missing' });
        }

        // Description Check (max 40)
        if (meta.description && meta.description.length > 50) {
            score += 40;
            notes.push({ type: 'pass', text: 'Rich meta description' });
        } else if (meta.description && meta.description.length > 0) {
            score += 20;
            notes.push({ type: 'warn', text: 'Description is too brief' });
        } else {
            notes.push({ type: 'fail', text: 'Missing description' });
        }

        // Headings Check (max 30) - Checks for presence of H1-H3
        const hasHeadings = (meta.headings && meta.headings.length > 0) || (meta.h1 && meta.h1.length > 0);
        if (hasHeadings) {
            score += 30;
            notes.push({ type: 'pass', text: 'Main headings detected' });
        } else {
            notes.push({ type: 'warn', text: 'No headings (H1-H3) found' });
        }

        return { score, notes };
    }
};
