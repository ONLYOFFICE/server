/**
 * ASC Plugin Stub
 * 
 * This script creates a stub implementation of window.Asc.plugin for the iframe environment
 * to prevent JavaScript errors when the AI HTML files are loaded in iframes.
 * 
 * @author ONLYOFFICE
 * @version 1.0.0
 */

(function(window, undefined) {
    // Check if window.Asc already exists
    if (!window.Asc) {
        window.Asc = {};
    }
    
    // Create mock event handlers storage
    const eventHandlers = {};
    
    // Create stub plugin object if it doesn't exist
    if (window.Asc.plugin) {
        let stub = {
            /**
             * Initialize the plugin
             * 
             * @returns {void}
             */
            init: function() {
                //console.log("[ASC Plugin Stub] init called");
                // Call onInit after initialization
                if (typeof this.sendToPlugin === 'function') {
                    this.sendToPlugin("onInit");
                }
            },
            
            /**
             * Send a message to the plugin
             * 
             * @param {string} name - The name of the event
             * @param {*} [data] - Optional data
             * @returns {void}
             */
            sendToPlugin: function(name, data) {
                //console.log("[ASC Plugin Stub] sendToPlugin called:", data);
                window.parent.postMessage({name, data}, "*")
            },
            
            /**
             * Attach an event handler
             * 
             * @param {string} eventName - The event name
             * @param {Function} handler - The event handler
             * @returns {void}
             */
            attachEvent: function(eventName, handler) {
                //console.log("[ASC Plugin Stub] attachEvent:", eventName);
                
                // Create event handler array if it doesn't exist
                if (!eventHandlers[eventName]) {
                    eventHandlers[eventName] = [];
                }
                
                // Register the handler
                eventHandlers[eventName].push(handler);
            },
            
            /**
             * Fire an event to all registered handlers
             * 
             * @param {string} eventName - The event name
             * @param {Array} args - Arguments to pass to the handlers
             * @returns {void}
             */
            fireEvent: function(eventName, args) {
                //console.log("[ASC Plugin Stub] fireEvent:", eventName, args);
                
                // Call registered handlers
                if (eventHandlers[eventName]) {
                    eventHandlers[eventName].forEach(handler => {
                        try {
                            handler.call(null, args);
                        } catch (e) {
                            console.error("[ASC Plugin Stub] Error in event handler:", e);
                        }
                    });
                }
            },
            
            /**
             * Base theme changed handler
             * 
             * @param {Object} theme - Theme information
             * @returns {void}
             */
            onThemeChangedBase: function(theme) {
                //console.log("[ASC Plugin Stub] onThemeChangedBase:", theme);
            },
            
            /**
             * Theme changed handler
             * 
             * @param {Object} theme - Theme information
             * @returns {void}
             */
            onThemeChanged: function(theme) {
                //console.log("[ASC Plugin Stub] onThemeChanged:", theme);
            },
            
            /**
             * Translation handler
             * 
             * @returns {void}
             */
            onTranslate: function() {
                //console.log("[ASC Plugin Stub] onTranslate called");
            },
            
            /**
             * Translation function
             * 
             * @param {string} text - Text to translate
             * @returns {string} Translated text
             */
            tr: function(text) {
                // Just return the original text in the stub
                return text;
            },
            theme: {}
        };

        window.Asc.plugin = {...window.Asc.plugin, ...stub}
        
        // Define comprehensive AI stubs for the iframe environment
        let stubAI = {};
        if (window.AI) {
            stubAI = {
                // Capabilities enum
                CapabilitiesUI: {
                    None: 0,
                    Chat: 1,
                    Image: 2,
                    Embeddings: 4,
                    Audio: 8,
                    Moderations: 16,
                    Realtime: 32,
                    Code: 64,
                    Vision: 128,
                    All: 255 // All capabilities combined
                },
                
                // Token limits
                InputMaxTokens: {
                    "4k": 4096,
                    "8k": 8192,
                    "16k": 16384,
                    "32k": 32768,
                    "64k": 65536,
                    "128k": 131072,
                    "200k": 204800,
                    "256k": 262144,
                    keys: ["4k", "8k", "16k", "32k", "64k", "128k", "200k", "256k"],
                    
                    getFloor: function(value) {
                        let result;
                        for (let i = 0; i < this.keys.length; i++) {
                            if (this[this.keys[i]] <= value) {
                                result = this[this.keys[i]];
                            }
                        }
                        return result;
                    }
                },
                
                // Endpoints definitions
                Endpoints: {
                    Types: {
                        Undefined: -1,
                        v1: {
                            Models: 0x00,
                            Chat_Completions: 0x01,
                            Completions: 0x02,
                            Images_Generations: 0x11,
                            Images_Edits: 0x12,
                            Images_Variarions: 0x13,
                            Embeddings: 0x21,
                            Audio_Transcriptions: 0x31,
                            Audio_Translations: 0x32,
                            Audio_Speech: 0x33,
                            Moderations: 0x41,
                            Realtime: 0x51,
                            Language: 0x61,
                            Code: 0x62
                        }
                    }
                },
                
                // UI classes
                UI: {
                    Model: function(name, id, provider, capabilities) {
                        this.capabilities = capabilities || window.AI.CapabilitiesUI.None;
                        this.provider = provider || "";
                        this.name = name || "";
                        this.id = id || "";
                    },
                    
                    Provider: function(name, key, url) {
                        this.name = name || "";
                        this.key = key || "";
                        this.url = url || "";
                    },
                    
                    Action: function(name, icon, model) {
                        this.name = name || "";
                        this.icon = icon || "";
                        this.model = model || "";
                    }
                },
                
                // Provider management
                InternalProviders: [],
                InternalCustomProviders: [],
                InternalCustomProvidersSources: {},
                
                // Provider functions
                createProviderInstance: function(name, url, key, addon) {
                    //console.log("[AI Stub] createProviderInstance:", name, url, key);
                    return new this.Provider(name, url, key);
                },
                
                isInternalProvider: function(name) {
                    //console.log("[AI Stub] isInternalProvider:", name);
                    return false;
                },
                
                loadInternalProviders: async function() {
                    //console.log("[AI Stub] loadInternalProviders");
                    setTimeout(() => {
                        if (typeof this.onLoadInternalProviders === 'function') {
                            this.onLoadInternalProviders();
                        }
                    }, 100);
                    return Promise.resolve();
                },
                
                onLoadInternalProviders: function() {
                    //console.log("[AI Stub] onLoadInternalProviders");
                },
                
                loadCustomProviders: function() {
                    //console.log("[AI Stub] loadCustomProviders");
                    this.InternalCustomProviders = [
                        { name: "Custom Provider 1", url: "", key: "" },
                        { name: "Custom Provider 2", url: "", key: "" }
                    ];
                },
                
                addCustomProvider: function(providerContent, isRegister) {
                    //console.log("[AI Stub] addCustomProvider");
                    return true;
                },
                
                removeCustomProvider: function(name) {
                    //console.log("[AI Stub] removeCustomProvider:", name);
                    return true;
                },
                
                getCustomProviders: function() {
                    //console.log("[AI Stub] getCustomProviders");
                    return this.InternalCustomProviders;
                },
                
                // Storage stub
                Storage: {
                    save: function() {
                        //console.log("[AI Stub] Storage.save");
                        return true;
                    },
                    load: function() {
                        //console.log("[AI Stub] Storage.load");
                        return true;
                    }
                },
                
                // Utility functions
                loadResourceAsText: async function(url) {
                    //console.log("[AI Stub] loadResourceAsText:", url);
                    return Promise.resolve("");
                },
                
                // Provider class
                Provider: function(name, url, key) {
                    this.name = name || "";
                    this.url = url || "";
                    this.key = key || "";
                    this.addon = null;
                    this.capabilities = window.AI.CapabilitiesUI.All;
                    
                    this.createInstance = function(name, url, key, addon) {
                        return new window.AI.Provider(name, url, key);
                    };
                    
                    this.isOnlyDesktop = function() {
                        return false;
                    };
                    
                    this.getModels = function() {
                        return [
                            { id: "model1", name: "Model 1", capabilities: window.AI.CapabilitiesUI.Chat },
                            { id: "model2", name: "Model 2", capabilities: window.AI.CapabilitiesUI.Image },
                            { id: "model3", name: "Model 3", capabilities: window.AI.CapabilitiesUI.Code }
                        ];
                    };
                }
            };
        }
        window.AI = {...window.AI, ...stubAI}
        
        // Auto-initialize when document is ready
        if (document.readyState === "complete" || document.readyState === "interactive") {
            setTimeout(function() {
                if (typeof window.Asc.plugin.init === 'function') {
                    window.Asc.plugin.init();
                }
            }, 100);
        } else {
            document.addEventListener("DOMContentLoaded", function() {
                if (typeof window.Asc.plugin.init === 'function') {
                    window.Asc.plugin.init();
                }
            });
        }
    }

    function receiveMessage(event) {
        const message = event.data;
        //console.log('Received message:', message);
        window.Asc.plugin.fireEvent(message.name, message.data);
    }
    // Add event listener for messages from iframes
    window.addEventListener('message', receiveMessage);
})(window);
