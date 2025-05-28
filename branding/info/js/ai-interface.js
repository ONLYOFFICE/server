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
    var urlSettings = 'plugin/settings';
    var urlModels = 'plugin/models';
    
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
    });

    function onInit(source) {
        if(framesToInit) {
            framesToInit.push(source);
            return;
        }
        updateActions(source);
        updateModels(source);
        sendMessageToSettings({
            name: 'onThemeChanged',
            data: {type:'light', name: 'theme-light'}
        }, source);
    }

    /**
     * Get configuration from server
     * @returns {Promise<Object|null>} Configuration object or null if error
     */
    /**
     * Get configuration from server
     * @returns {Promise<Object|null>} Configuration object or null if error
     */
    function getSettings() {     
        var baseUrl = window.location.href.substring(0, window.location.href.lastIndexOf('/') + 1);
        return fetch(baseUrl + urlSettings).then(function(response) {
            if (!response.ok) throw new Error('Failed to load: ' + response.status);
            return response.json();
        });
    }

    /**
     * Save configuration to server
     * @param {Object} config - Configuration object to save
     * @returns {Promise<void>}
     */
    /**
     * Save configuration to server
     * @param {Object} config - Configuration object to save
     * @returns {Promise<void>}
     */
    function putConfig(config) { 
        var baseUrl = window.location.href.substring(0, window.location.href.lastIndexOf('/') + 1);
        return fetch(baseUrl + 'config', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        }).then(function(response) {
            if (!response.ok) throw new Error('Failed to save: ' + response.status);
            console.log('Configuration saved successfully');
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
        
        console.log('Received message:', message);
        
        // Handle different message types
        switch (message.name) {
            case 'onInit':
                onInit(event.source);
                break;
            case 'onChangeAction':
                updateActions(event.source);
                break;
            case 'onOpenAiModelsModal':
                updateModels(event.source);
                break;
            case 'onThemeChanged':
                sendMessageToSettings({
                    name: 'onThemeChanged',
                    data: {type:'light', name: 'theme-light'}
                }, event.source);
                break;
            case 'onChangeAction':
                for (let id in settings.actions) {
                    if (settings.actions[id].id == message.data.id) {
                        settings.actions[id].model = message.data.model;
                    }
                }
                break;
            case 'onOpenAiModelsModal':
                //todo
                break;
            case 'onOpenEditModal':
                var aiModelEditWindow = findIframeBySrcPart('aiModelEdit');
                if(aiModelEditWindow) {
                    var model = null;
                    if (message.data.model) {
                        model = settings.models.find(function(model) { return model.name === message.data.model.name; });
                    }
                    var data = {
                        model : model,
                        providers : Object.keys(settings.providers).map(function(key) { return settings.providers[key]; })
                    }
                    sendMessageToSettings({
                        name: 'onModelInfo',
                        data: data
                    }, aiModelEditWindow.contentWindow);
                }
                break;
            case 'onDeleteAiModel':
                for (let id in settings.models) {
                    if (settings.models[id].id == message.data.id) {
                        delete settings.models[id];
                    }
                }
                break;
            case 'onUpdateModels':
                break;
            case 'onGetModels':
                onGetModels(message.data, event.source);
                break;
            case 'onThemeChanged':
                sendMessageToSettings({
                    name: 'onThemeChanged',
                    data: {type:'light', name: 'theme-light'}
                }, event.source);
                break;
            default:
                console.log('Unknown message action:', message.name);
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
     * @param {Window} targetWindow - The target window to send models to
     */
    function updateModels(targetWindow) {
        let models = [];
        if (settings && settings.models) {
            models = settings.models;
        }
        sendMessageToSettings({
            name: 'onUpdateModels',
            data: models
        }, targetWindow);
    }
    
    /**
     * Fetches AI models from server and sends to source window
     * @param {Object} data - Request data for models
     * @param {Window} source - The source window to send models to
     * @returns {Promise<void>}
     */
    function onGetModels(data, source) {
        const baseUrl = window.location.href.substring(0, window.location.href.lastIndexOf('/') + 1);
        return fetch(baseUrl + urlModels, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        }).then(function(response) {
            if (!response.ok) throw new Error('Failed to save: ' + response.status);
            console.log('Configuration saved successfully');
            return response.json();
        }).then(function(models) {
            sendMessageToSettings({
                name: 'onGetModels',
                data: models
            }, source);
        });
    }

})(window, undefined);
