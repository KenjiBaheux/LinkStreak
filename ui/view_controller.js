// view_controller.js - Unified UX Controller

window.LinkyUI_Controller = {
    // 1. UPDATE CHIP APPEARANCE
    updateChipUI(contextText, weight) {
        const chip = document.getElementById('context-chip');
        if (!contextText || contextText.trim() === "") {
            chip.classList.add('hidden');
            return;
        }

        chip.classList.remove('hidden');

        // Beginning and End Summary (e.g., "The quic...jumps")
        const start = contextText.substring(0, 8);
        const end = contextText.length > 5 ? contextText.substring(contextText.length - 5) : "";
        chip.querySelector('.chip-label').textContent = `${start}...${end}`;

        // Dynamic Color Mapping based on weight (0-100)
        // Transitions from a subtle blue to a vibrant cyan based on AI influence
        const hue = 200 + (weight * 0.4);
        const opacity = 0.1 + (weight / 200);
        chip.style.backgroundColor = `hsla(${hue}, 70%, 50%, ${opacity})`;
        chip.style.borderColor = `hsl(${hue}, 80%, 60%)`;
    },

    // 2. MODAL MANAGEMENT
    openAdvancedSettings(context, weight) {
        const overlay = document.getElementById('advanced-context-overlay');
        const textEdit = document.getElementById('modal-context-edit');
        const slider = document.getElementById('modal-weight-slider');
        const percentLabel = document.getElementById('modal-weight-percent');

        textEdit.value = context;
        slider.value = weight;
        percentLabel.textContent = `${weight}%`;

        overlay.classList.remove('hidden');
    },

    closeAdvancedSettings() {
        document.getElementById('advanced-context-overlay').classList.add('hidden');
    },

    // 3. UI STATE SYNC
    // Sets the focus text and updates the chip in one go
    syncUnifiedBar(focus, context, weight) {
        const editor = document.getElementById('focus-editor');
        editor.textContent = focus;
        this.updateChipUI(context, weight);
    }
};

// Initialize Modal Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    const slider = document.getElementById('modal-weight-slider');
    const percentLabel = document.getElementById('modal-weight-percent');
    const saveBtn = document.getElementById('modal-save');
    const closeBtn = document.getElementById('modal-close');

    // Live weight preview in modal
    slider.oninput = (e) => {
        percentLabel.textContent = `${e.target.value}%`;
    };

    // Modal Action Handlers
    closeBtn.onclick = () => window.LinkyUI_Controller.closeAdvancedSettings();

    saveBtn.onclick = () => {
        const newContext = document.getElementById('modal-context-edit').value;
        const newWeight = slider.value;

        // Update the visual chip and close
        window.LinkyUI_Controller.updateChipUI(newContext, newWeight);
        window.LinkyUI_Controller.closeAdvancedSettings();

        // Dispatch custom event so sidepanel.js knows to re-run the AI search
        window.dispatchEvent(new CustomEvent('context-updated', {
            detail: { context: newContext, weight: newWeight }
        }));
    };
});