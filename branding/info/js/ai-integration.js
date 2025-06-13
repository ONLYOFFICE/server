/**
 * AI Integration Module
 * Manages the integration of AI settings iframes in the main index page
 */

const AIIntegration = {
    // Current state
    currentView: 'settings',
    isCollapsed: true,
    
    // Callback functions
    onSave: null,
    onOk: null,
    onResetActions: null,
    onResetAllSettings: null,
    
    // Initialize the AI integration
    init() {
        this.createAISection();
        this.bindEvents();
        this.loadCurrentView();
    },
    
    /**
     * Create the AI settings section in the DOM
     */
    createAISection() {
        const targetElement = document.getElementById('ai-settings-section');
        if (!targetElement) return;
        
        targetElement.innerHTML = `
            <div class="ai-spoiler collapsed" id="ai-spoiler">
                AI Models Configuration
            </div>
            <div class="ai-content collapsed" id="ai-content">
                <div class="ai-iframe-container">
                    <iframe class="ai-iframe" id="ai-iframe-settings" src="ai/settings.html"></iframe>
                    <iframe class="ai-iframe hidden" id="ai-iframe-edit" src="ai/aiModelEdit.html"></iframe>
                    <iframe class="ai-iframe hidden" id="ai-iframe-list" src="ai/aiModelsList.html"></iframe>
                    <div class="ai-iframe-overlay loading" id="ai-overlay">
                        <div class="ai-loading-text">Loading...</div>
                    </div>
                </div>
                <div class="ai-controls" id="ai-controls">
                    <button class="ai-btn" id="ai-btn-back" style="display: none;">Back</button>
                    <button class="ai-btn" id="ai-btn-cancel" style="display: none;">Cancel</button>
                    <button class="ai-btn" id="ai-btn-reset-all-settings" style="display: none;">Restore Defaults</button>
                    <button class="ai-btn" id="ai-btn-reset-actions" style="display: none;">Reset Tasks</button>
                    <button class="ai-btn primary" id="ai-btn-save" style="display: none;">Save</button>
                    <button class="ai-btn primary" id="ai-btn-ok" style="display: none;">OK</button>
                </div>
            </div>
        `;
    },
    
    /**
     * Bind event handlers
     */
    bindEvents() {
        const spoiler = document.getElementById('ai-spoiler');
        const btnBack = document.getElementById('ai-btn-back');
        const btnCancel = document.getElementById('ai-btn-cancel');
        const btnSave = document.getElementById('ai-btn-save');
        const btnOk = document.getElementById('ai-btn-ok');
        const btnResetActions = document.getElementById('ai-btn-reset-actions');
        const btnResetAllSettings = document.getElementById('ai-btn-reset-all-settings');
        const iframeSettings = document.getElementById('ai-iframe-settings');
        const iframeEdit = document.getElementById('ai-iframe-edit');
        const iframeList = document.getElementById('ai-iframe-list');
        
        if (spoiler) {
            spoiler.addEventListener('click', () => this.toggleSpoiler());
        }
        
        if (btnBack) {
            btnBack.addEventListener('click', () => this.goBack());
        }
        
        if (btnCancel) {
            btnCancel.addEventListener('click', () => this.cancel());
        }
        
        if (btnSave) {
            btnSave.addEventListener('click', () => this.save());
        }
        
        if (btnOk) {
            btnOk.addEventListener('click', () => this.ok());
        }

        if (btnResetActions) {
            btnResetActions.addEventListener('click', () => this.resetActions());
        }

        if (btnResetAllSettings) {
            btnResetAllSettings.addEventListener('click', () => this.resetAllSettings());
        }
        
        if (iframeSettings) {
            iframeSettings.addEventListener('load', () => this.onIframeLoad());
        }
        
        if (iframeEdit) {
            iframeEdit.addEventListener('load', () => this.onIframeLoad());
        }
        
        if (iframeList) {
            iframeList.addEventListener('load', () => this.onIframeLoad());
        }
    },
    
    /**
     * Toggle the spoiler visibility
     */
    toggleSpoiler() {
        const spoiler = document.getElementById('ai-spoiler');
        const content = document.getElementById('ai-content');
        
        if (!spoiler || !content) return;
        
        this.isCollapsed = !this.isCollapsed;
        
        if (this.isCollapsed) {
            spoiler.classList.add('collapsed');
            content.classList.add('collapsed');
        } else {
            spoiler.classList.remove('collapsed');
            content.classList.remove('collapsed');
            this.loadCurrentView();
        }
    },
    
    /**
     * Load the current view in the iframe
     * @returns {void} No return value
     */
    loadCurrentView() {
        if (this.isCollapsed) return;
        
        const iframeSettings = document.getElementById('ai-iframe-settings');
        const iframeEdit = document.getElementById('ai-iframe-edit');
        const iframeList = document.getElementById('ai-iframe-list');
        
        if (!iframeSettings || !iframeEdit || !iframeList) return;
        
        // Hide all iframes first
        [iframeSettings, iframeEdit, iframeList].forEach(iframe => {
            iframe.classList.add('hidden');
        });
        
        // Show loading overlay
        const overlay = document.getElementById('ai-overlay');
        if (overlay) {
            overlay.classList.add('loading');
        }
        
        // Always reassign src to force reload, then show the appropriate iframe
        switch (this.currentView) {
            case 'settings':
                iframeSettings.src = 'ai/settings.html';
                iframeSettings.classList.remove('hidden');
                break;
            case 'aiModelEdit':
                iframeEdit.src = 'ai/aiModelEdit.html';
                iframeEdit.classList.remove('hidden');
                break;
            case 'aiModelsList':
                iframeList.src = 'ai/aiModelsList.html';
                iframeList.classList.remove('hidden');
                break;
            default:
                iframeSettings.src = 'ai/settings.html';
                iframeSettings.classList.remove('hidden');
        }
        
        this.updateControls();
    },
    
    /**
     * Update control buttons visibility based on current view
     */
    updateControls() {
        const btnBack = document.getElementById('ai-btn-back');
        const btnCancel = document.getElementById('ai-btn-cancel');
        const btnSave = document.getElementById('ai-btn-save');
        const btnOk = document.getElementById('ai-btn-ok');
        const btnResetActions = document.getElementById('ai-btn-reset-actions');
        const btnResetAllSettings = document.getElementById('ai-btn-reset-all-settings');
        
        // Hide all buttons first
        [btnBack, btnCancel, btnSave, btnOk, btnResetActions, btnResetAllSettings].forEach(btn => {
            if (btn) btn.style.display = 'none';
        });
        
        // Show buttons based on current view
        switch (this.currentView) {
            case 'settings':
                if (btnSave) btnSave.style.display = 'inline-block';
                if (btnResetActions) btnResetActions.style.display = 'inline-block';
                if (btnResetAllSettings) btnResetAllSettings.style.display = 'inline-block';
                break;
            case 'aiModelEdit':
                if (btnOk) btnOk.style.display = 'inline-block';
                if (btnCancel) btnCancel.style.display = 'inline-block';
                break;
            case 'aiModelsList':
                if (btnBack) btnBack.style.display = 'inline-block';
                break;
        }
    },
    
    /**
     * Handle iframe load event
     * @returns {void} No return value
     */
    onIframeLoad() {
        const overlay = document.getElementById('ai-overlay');
        if (overlay) {
            // Hide loading overlay after a short delay
            setTimeout(() => {
                overlay.classList.remove('loading');
            }, 300);
        }
    },
    
    /**
     * Navigate to a specific view
     * @param {string} view - The view to navigate to ('settings', 'aiModelEdit', 'aiModelsList')
     */
    navigateToView(view) {
        this.currentView = view;
        this.loadCurrentView();
    },
    

    save() {
        if (this.onSave) {
            this.onSave().then((res) => {
                const btnSave = document.getElementById('ai-btn-save');
                if (btnSave) {
                    const originalText = btnSave.textContent;
                    btnSave.textContent = res ? 'Saved!' : 'Save failed!';
                    btnSave.disabled = true;
                    setTimeout(() => {
                        btnSave.textContent = originalText;
                        btnSave.disabled = false;
                    }, 2000);
                }
            });
        }
    },

    goBack() {
        this.navigateToView('settings');

        if (this.onBack) {
            this.onBack();
        }
    },
    
    ok() {
        this.navigateToView('aiModelsList');

        if (this.onOk) {
            this.onOk();
        }
    },

    cancel() {
        this.navigateToView('aiModelsList');
    },

    resetActions() {
        if (this.onResetActions) {
            this.onResetActions().then((res) => {
                const btnResetActions = document.getElementById('ai-btn-reset-actions');
                if (btnResetActions) {
                    const originalText = btnResetActions.textContent;
                    btnResetActions.textContent = res ? 'Actions Reset!' : 'Reset Failed!';
                    btnResetActions.disabled = true;
                    setTimeout(() => {
                        btnResetActions.textContent = originalText;
                        btnResetActions.disabled = false;
                    }, 2000);
                }
            });
        }
    },

    resetAllSettings() {
        if (this.onResetAllSettings) {
            this.onResetAllSettings().then((res) => {
                const btnResetAllSettings = document.getElementById('ai-btn-reset-all-settings');
                if (btnResetAllSettings) {
                    const originalText = btnResetAllSettings.textContent;
                    btnResetAllSettings.textContent = res ? 'Settings Reset!' : 'Reset Failed!';
                    btnResetAllSettings.disabled = true;
                    setTimeout(() => {
                        btnResetAllSettings.textContent = originalText;
                        btnResetAllSettings.disabled = false;
                    }, 2000);
                }
            });
        }
    }
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    AIIntegration.init();
});
