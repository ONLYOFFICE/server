/*
 * (c) Copyright Ascensio System SIA 2010-2024
 *
 * This program is a free software product. You can redistribute it and/or
 * modify it under the terms of the GNU Affero General Public License (AGPL)
 * version 3 as published by the Free Software Foundation. In accordance with
 * Section 7(a) of the GNU AGPL its Section 15 shall be amended to the effect
 * that Ascensio System SIA expressly excludes the warranty of non-infringement
 * of any third-party rights.
 *
 * This program is distributed WITHOUT ANY WARRANTY; without even the implied
 * warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR  PURPOSE. For
 * details, see the GNU AGPL at: http://www.gnu.org/licenses/agpl-3.0.html
 *
 * You can contact Ascensio System SIA at 20A-6 Ernesta Birznieka-Upish
 * street, Riga, Latvia, EU, LV-1050.
 *
 * The  interactive user interfaces in modified source and object code versions
 * of the Program must display Appropriate Legal Notices, as required under
 * Section 5 of the GNU AGPL version 3.
 *
 * Pursuant to Section 7(b) of the License you must retain the original Product
 * logo when distributing the program. Pursuant to Section 7(e) we decline to
 * grant you any rights under trademark law for use of our trademarks.
 *
 * All the Product's GUI elements, including illustrations and icon sets, as
 * well as technical writing content are licensed under the terms of the
 * Creative Commons Attribution-ShareAlike 4.0 International. See the License
 * terms at http://creativecommons.org/licenses/by-sa/4.0/legalcode
 *
 */

(function(window, undefined){

    'use strict';

    var settings = null;
    var framesToInit = [];
    var tempModels = null;
    var urlSettings = 'plugin/settings';
    var urlModels = 'plugin/models';
    var urlConfig = 'config';

    var tmpModel = null;
    
        // Initialize AI functionality when DOM is loaded
    document.addEventListener('DOMContentLoaded', function() {
        window.addEventListener('message', receiveMessage);
        getSettings().then(function(data) {
            settings = data;

            var tmp = framesToInit;
            framesToInit = null;
            for(var i = 0; i < tmp.length; i++) {
                onInit(tmp[i]);
            }
        });
        AIIntegration.onSave = function() {
            var config = {aiSettings: settings};
            return putConfig(config).then(function() {
                return true;
            }).catch(function() {
                return false;
            });
        };
        AIIntegration.onResetActions = function() {
            try {
                if (settings && settings.actions) {
                    for (let id in settings.actions) {
                        if (settings.actions[id]) {
                            settings.actions[id].model = "";
                        }
                    }
                }
                var settingsWindow = findIframeBySrcPart('settings');
                if (settingsWindow && settingsWindow.contentWindow) {
                    updateActions(settingsWindow.contentWindow);
                }
                updateModels();
                return AIIntegration.onSave();
            } catch (error) {
                console.error('Reset actions error:', error);
            }
            return Promise.resolve(false);
        };
        AIIntegration.onResetAllSettings = function() {
            try {
                if (settings) {
                    // Reset actions models
                    if (settings.actions) {
                        for (let id in settings.actions) {
                            if (settings.actions[id]) {
                                settings.actions[id].model = "";
                            }
                        }
                    }

                    // Reset models array
                    settings.models = [];

                    // Reset custom providers
                    settings.customProviders = {};

                    // Reset providers
                    if (settings.providers) {
                        for (let id in settings.providers) {
                            if (settings.providers[id]) {
                                settings.providers[id].key = "";
                                settings.providers[id].models = [];
                            }
                        }
                    }

                    // Update UI
                    var settingsWindow = findIframeBySrcPart('settings');
                    if (settingsWindow && settingsWindow.contentWindow) {
                        updateActions(settingsWindow.contentWindow);
                    }
                    updateModels();

                    return AIIntegration.onSave();
                }
            } catch (error) {
                console.error('Reset all settings error:', error);
            }
            return Promise.resolve(false);
        };
        AIIntegration.onOk = function() {
            var aiModelEditWindow = findIframeBySrcPart('aiModelEdit');
            if(aiModelEditWindow) {
                sendMessageToSettings({
                    name: 'onSubmit'
                }, aiModelEditWindow.contentWindow);
            }
            return;
        };
        AIIntegration.onBack = function() {
            var settingsWindow = findIframeBySrcPart('settings');
            if(settingsWindow) {
                updateActions(settingsWindow.contentWindow);
                updateModels();
            }
        };
    });

    function onInit(source) {
        if(framesToInit) {
            framesToInit.push(source);
            return;
        }
        updateActions(source);
        updateModels();
        sendMessageToSettings({
            name: 'onThemeChanged',
            data: {type:'light', name: 'theme-light'}
        }, source);
        const providers = Object.keys(settings.providers).map(function(key) { return settings.providers[key]; });
        var model = {id: "", name: "", provider: "", capabilities: 0};
        if (tmpModel) {
            model = settings.models.find(function(model) { return model.name === tmpModel.name; });
            tmpModel = null;
        }
        var data = {
            model : model,
            providers : providers
        }
        sendMessageToSettings({
            name: 'onModelInfo',
            data: data
        }, source);
    }

    /**
     * Get configuration from server
     * @returns {Promise<Object|null>} Configuration object or null if error
     */
    function getSettings() {     
        return fetch(urlSettings).then(function(response) {
            if (!response.ok) throw new Error('Failed to load: ' + response.status);
            return response.json();
        });
    }

    /**
     * Save configuration to server
     * @param {Object} config - Configuration object to save
     * @returns {Promise<void>}
     */
    function putConfig(config) { 
        return fetch(urlConfig, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        }).then(function(response) {
            if (!response.ok) throw new Error('Failed to save: ' + response.status);
            //console.log('Configuration saved successfully');
        });
    }

    /**
     * Sends a message to settings iframes
     * @param {Object} message - The message object to send to the settings iframe(s)
     * @param {Window} targetWindow - The target window to send the message to
     */
    function sendMessageToSettings(message, targetWindow) {
        targetWindow.postMessage(message, '*'); 
    }

    /**
     * Finds an iframe element by partial match of its src attribute
     * @param {string} srcPart - Partial string to match against iframe src attributes
     * @returns {HTMLIFrameElement|null} - Returns the matching iframe or null if none found
     */
    function findIframeBySrcPart(srcPart) {
        var iframes = document.querySelectorAll('iframe');
        for (var i = 0; i < iframes.length; i++) {
            var iframe = iframes[i];
            if (iframe.src && iframe.src.indexOf(srcPart) !== -1) {
                return iframe;
            }
        }
        return null;
    }

    /**
     * Receives messages from iframe content windows
     * 
     * @param {MessageEvent} event - The message event from the iframe
     * @returns {void}
     */
    function receiveMessage(event) {
        // Validate message origin for security
        // Add origin validation if needed
        
        const message = event.data;
        if (!message || typeof message !== 'object') return;
        
        // console.log('Received message:', message);
        
        // Handle different message types
        switch (message.name) {
            case 'onInit':
                onInit(event.source);
                break;
            case 'onOpenAiModelsModal':
                AIIntegration.navigateToView('aiModelsList');
                break;
            case 'onThemeChanged':
                sendMessageToSettings({
                    name: 'onThemeChanged',
                    data: {type:'light', name: 'theme-light'}
                }, event.source);
                break;
            case 'onChangeAction':
                if (settings.actions[message.data.id]) {
                    settings.actions[message.data.id].model = message.data.model;
                }
                break;
            case 'onOpenEditModal':
                tmpModel = message.data.model;
                AIIntegration.navigateToView('aiModelEdit');
                break;
            case 'onDeleteAiModel':
                for (var i = 0; i < settings.models.length; i++) {
                    if (settings.models[i].id == message.data.id) {
                        settings.models.splice(i, 1);
                        break;
                    }
                }
                updateModels();
                break;
            case 'onGetModels':
                onGetModels(message.data, event.source);
                break;
            case 'onChangeModel':
                onChangeModel(message.data);
                break;
            case 'onThemeChanged':
                sendMessageToSettings({
                    name: 'onThemeChanged',
                    data: {type:'light', name: 'theme-light'}
                }, event.source);
                break;
            default:
                // console.log('Unknown message action:', message.name);
        }
    }
    /**
     * Updates action list and sends to target window
     * @param {Window} targetWindow - The target window to send actions to
     */
    function updateActions(targetWindow) {
        let actions = [];
        if (settings && settings.actions) {
            for(let id in settings.actions) {
                let action = settings.actions[id];
                let newAction = Object.assign({id: id}, action);
                actions.push(newAction);
            }
        }
        sendMessageToSettings({
            name: 'onUpdateActions',
            data: actions
        }, targetWindow);
    }

    /**
     * Updates model list and sends to target window
     */
    function updateModels() {
        let models = [];
        if (settings && settings.models) {
            models = settings.models;
        }
        var settingsWindow = findIframeBySrcPart('settings');
        if (settingsWindow) {
            sendMessageToSettings({
                name: 'onUpdateModels',
                data: models
            }, settingsWindow.contentWindow);
        }
        var aiModelsListWindow = findIframeBySrcPart('aiModelsList');
        if (aiModelsListWindow) {
            sendMessageToSettings({
                name: 'onUpdateModels',
                data: models
            }, aiModelsListWindow.contentWindow);
        }
    }
    
    /**
     * Fetches AI models from server and sends to source window
     * @param {Object} data - Request data for models
     * @param {Window} source - The source window to send models to
     * @returns {Promise<void>}
     */
    function onGetModels(data, source) {
        return fetch(urlModels, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        }).then(function(response) {
            if (!response.ok) throw new Error('Failed to save: ' + response.status);
            // console.log('Configuration saved successfully');
            return response.json();
        }).then(function(models) {
            tempModels = models.modelsApi;
            delete models.modelsApi;
            sendMessageToSettings({
                name: 'onGetModels',
                data: models
            }, source);
        });
    }

    function onChangeModel(data) {
        settings.providers[data.provider.name] = data.provider;
        if (tempModels) {
            settings.providers[data.provider.name].models = tempModels;
            tempModels = null;
        }

        let isFoundModel = false;
        for(let id in settings.models) {
            if(settings.models[id].id == data.id) {
                settings.models[id].provider = data.provider.name;
                settings.models[id].name = data.name;
                settings.models[id].capabilities = data.capabilities;
                isFoundModel = true;
            }
        }

        if (!isFoundModel) {
            if(data.capabilities === undefined)
                data.capabilities = 0xffff;
            settings.models.push({id: data.id, name: data.name, provider: data.provider.name, capabilities: data.capabilities});
        }

        updateModels();
    }

})(window, undefined);
