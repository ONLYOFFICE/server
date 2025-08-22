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
            data: {
                "Name": "theme-white",
                "Type": "light",
                "RulersButton": false,
                "NavigationButtons": false,
                "BackgroundColor": "#f3f3f3",
                "PageOutline": "#cccccc",
                "RulerDark": "#d9d9d9",
                "RulerLight": "#ffffff",
                "RulerOutline": "#cbcbcb",
                "RulerMarkersOutlineColor": "#555555",
                "RulerMarkersOutlineColorOld": "#aaaaaa",
                "RulerMarkersFillColor": "#ffffff",
                "RulerMarkersFillColorOld": "#ffffff",
                "RulerTextColor": "#555555",
                "RulerTabsColor": "#000000",
                "RulerTabsColorOld": "#666666",
                "RulerTableColor1": "#ffffff",
                "RulerTableColor2": "#555555",
                "ScrollBackgroundColor": "#f3f3f3",
                "ScrollOutlineColor": "#cbcbcb",
                "ScrollOutlineHoverColor": "#cbcbcb",
                "ScrollOutlineActiveColor": "#adadad",
                "ScrollerColor": "#f7f7f7",
                "ScrollerHoverColor": "#c0c0c0",
                "ScrollerActiveColor": "#adadad",
                "ScrollArrowColor": "#adadad",
                "ScrollArrowHoverColor": "#f7f7f7",
                "ScrollArrowActiveColor": "#f7f7f7",
                "ScrollerTargetColor": "#c0c0c0",
                "ScrollerTargetHoverColor": "#f7f7f7",
                "ScrollerTargetActiveColor": "#f7f7f7",
                "STYLE_THUMBNAIL_WIDTH": 104,
                "STYLE_THUMBNAIL_HEIGHT": 40,
                "isNeedInvertOnActive": false,
                "ContentControlsBack": "#F1F1F1",
                "ContentControlsHover": "#D8DADC",
                "ContentControlsActive": "#7C838A",
                "ContentControlsText": "#444444",
                "ContentControlsTextActive": "#FFFFFF",
                "ContentControlsAnchorActive": "#CFCFCF",
                "FormsContentControlsOutlineHover": "rgba(0, 0, 0, 0.3)",
                "FormsContentControlsOutlineActive": "rgba(0, 0, 0, 0.3)",
                "FormsContentControlsOutlineBorderRadiusHover": 0,
                "FormsContentControlsOutlineBorderRadiusActive": 2,
                "FormsContentControlsMarkersBackground": "#FFFFFF",
                "FormsContentControlsMarkersBackgroundHover": "#E1E1E1",
                "FormsContentControlsMarkersBackgroundActive": "#CCCCCC",
                "FormsContentControlsOutlineMoverHover": "#444444",
                "FormsContentControlsOutlineMoverActive": "#444444",
                "BackgroundColorThumbnails": "#FFFFFF",
                "BackgroundColorThumbnailsActive": "#FFFFFF",
                "BackgroundColorThumbnailsHover": "#FFFFFF",
                "ThumbnailsPageOutlineActive": "#4A87E7",
                "ThumbnailsPageOutlineHover": "#92B7F0",
                "ThumbnailsPageNumberText": "#000000",
                "ThumbnailsPageNumberTextActive": "#000000",
                "ThumbnailsPageNumberTextHover": "#000000",
                "ThumbnailsLockColor": "#D34F4F",
                "BackgroundColorNotes": "#f3f3f3",
                "THEMES_THUMBNAIL_WIDTH": 88,
                "THEMES_THUMBNAIL_HEIGHT": 40,
                "THEMES_LAYOUT_THUMBNAIL_HEIGHT": 68,
                "BorderSplitterColor": "#cbcbcb",
                "SupportNotes": true,
                "SplitterWidthMM": 1,
                "ThumbnailScrollWidthNullIfNoScrolling": false,
                "AnimPaneBackground": "#f7f7f7",
                "AnimPaneItemFillSelected": "#cbcbcb",
                "AnimPaneItemFillHovered": "#e0e0e0",
                "AnimPaneButtonFill": "#e0e0e0",
                "AnimPaneButtonFillHovered": "#e0e0e0",
                "AnimPaneButtonFillDisabled": "#e0e0e0",
                "AnimPanePlayButtonFill": "#ffffff",
                "AnimPanePlayButtonOutline": "#c0c0c0",
                "AnimPaneEffectBarFillEntrance": "#77b583",
                "AnimPaneEffectBarOutlineEntrance": "#0e8a26",
                "AnimPaneEffectBarFillEmphasis": "#fbc37c",
                "AnimPaneEffectBarOutlineEmphasis": "#ff8e00",
                "AnimPaneEffectBarFillExit": "#f59a9a",
                "AnimPaneEffectBarOutlineExit": "#f23d3d",
                "AnimPaneEffectBarFillPath": "#a1cee3",
                "AnimPaneEffectBarOutlinePath": "#254662",
                "AnimPaneTimelineRulerOutline": "#cbcbcb",
                "AnimPaneTimelineRulerTick": "#cbcbcb",
                "AnimPaneTimelineScrollerFill": "#cbcbcb",
                "AnimPaneTimelineScrollerOutline": "#444444",
                "AnimPaneTimelineScrollerOpacity": 0,
                "AnimPaneTimelineScrollerOpacityHovered": 0.4,
                "AnimPaneTimelineScrollerOpacityActive": 1,
                "AnimPaneText": "#000000",
                "AnimPaneTextActive": "#000000",
                "AnimPaneTextHover": "#000000",
                "DemBackgroundColor": "#FFFFFF",
                "DemButtonBackgroundColor": "#ffffff",
                "DemButtonBackgroundColorHover": "#EAEAEA",
                "DemButtonBackgroundColorActive": "#E1E1E1",
                "DemButtonBorderColor": "#E1E1E1",
                "DemButtonTextColor": "#000000",
                "DemButtonTextColorActive": "#000000",
                "DemSplitterColor": "#EAEAEA",
                "DemTextColor": "#000000",
                "Background": "#f7f7f7",
                "BackgroundActive": "#cfcfcf",
                "BackgroundHighlighted": "#dfdfdf",
                "Border": "#d8d8d8",
                "BorderActive": "#bbbbbb",
                "BorderHighlighted": "#c9c9c9",
                "Color": "#444444",
                "ColorActive": "#444444",
                "ColorHighlighted": "#444444",
                "ColorFiltering": "#008636",
                "SheetViewCellBackground": "#73bf91",
                "SheetViewCellBackgroundPressed": "#aaffcc",
                "SheetViewCellBackgroundHover": "#97e3b6",
                "SheetViewCellTitleLabel": "#121212",
                "ColorDark": "#ffffff",
                "ColorDarkActive": "#ffffff",
                "ColorDarkHighlighted": "#c1c1c1",
                "ColorDarkFiltering": "#7AFFAF",
                "GroupDataBorder": "#000000",
                "EditorBorder": "#cbcbcb",
                "SelectAllIcon": "#999999",
                "SheetViewSelectAllIcon": "#3D664E",
                "toolbar-header-document": "#f3f3f3",
                "toolbar-header-spreadsheet": "#f3f3f3",
                "toolbar-header-presentation": "#f3f3f3",
                "toolbar-header-pdf": "#f3f3f3",
                "toolbar-header-visio": "#f3f3f3",
                "text-toolbar-header-on-background-document": "#FFFFFF",
                "text-toolbar-header-on-background-spreadsheet": "#FFFFFF",
                "text-toolbar-header-on-background-presentation": "#FFFFFF",
                "text-toolbar-header-on-background-pdf": "#FFFFFF",
                "text-toolbar-header-on-background-visio": "#FFFFFF",
                "background-normal": "#fff",
                "background-toolbar": "#FFFFFF",
                "background-toolbar-additional": "#efefef",
                "background-primary-dialog-button": "#4A87E7",
                "background-notification-popover": "#fcfed7",
                "background-notification-badge": "#ffd112",
                "background-scrim": "rgba(0, 0, 0, 0.2)",
                "background-loader": "rgba(24, 24, 24, 0.9)",
                "background-accent-button": "#4A87E7",
                "background-contrast-popover": "#fff",
                "shadow-contrast-popover": "rgba(0, 0, 0, 0.3)",
                "highlight-button-hover": "#EAEAEA",
                "highlight-button-pressed": "#E1E1E1",
                "highlight-button-pressed-hover": "#bababa",
                "highlight-primary-dialog-button-hover": "#2566D5",
                "highlight-header-button-hover": "#eaeaea",
                "highlight-header-button-pressed": "#e1e1e1",
                "highlight-text-select": "#3494fb",
                "highlight-accent-button-hover": "#375478",
                "highlight-accent-button-pressed": "#293f59",
                "highlight-toolbar-tab-underline-document": "#446995",
                "highlight-toolbar-tab-underline-spreadsheet": "#3A8056",
                "highlight-toolbar-tab-underline-presentation": "#B75B44",
                "highlight-toolbar-tab-underline-pdf": "#AA5252",
                "highlight-toolbar-tab-underline-visio": "#444796",
                "highlight-header-tab-underline-document": "#446995",
                "highlight-header-tab-underline-spreadsheet": "#3A8056",
                "highlight-header-tab-underline-presentation": "#B75B44",
                "highlight-header-tab-underline-pdf": "#AA5252",
                "highlight-header-tab-underline-visio": "#444796",
                "border-toolbar": "#cbcbcb",
                "border-divider": "#EAEAEA",
                "border-regular-control": "#E1E1E1",
                "border-toolbar-button-hover": "#eaeaea",
                "border-preview-hover": "#92B7F0",
                "border-preview-select": "#4A87E7",
                "border-control-focus": "#4A87E7",
                "border-color-shading": "rgba(0, 0, 0, 0.15)",
                "border-error": "#f62211",
                "border-contrast-popover": "#fff",
                "text-normal": "rgba(0, 0, 0, 0.8)",
                "text-normal-pressed": "rgba(0, 0, 0, 0.8)",
                "text-secondary": "rgba(0, 0, 0, 0.6)",
                "text-tertiary": "rgba(0, 0, 0, 0.4)",
                "text-link": "#445799",
                "text-link-hover": "#445799",
                "text-link-active": "#445799",
                "text-link-visited": "#445799",
                "text-inverse": "#fff",
                "text-toolbar-header": "rgba(0, 0, 0, 0.8)",
                "text-contrast-background": "#fff",
                "text-alt-key-hint": "rgba(0, 0, 0, 0.8)",
                "icon-normal": "#444",
                "icon-normal-pressed": "#444",
                "icon-inverse": "#444",
                "icon-toolbar-header": "#444",
                "icon-notification-badge": "#000",
                "icon-contrast-popover": "#fff",
                "icon-success": "#2e8b57",
                "canvas-background": "#f3f3f3",
                "canvas-content-background": "#fff",
                "canvas-page-border": "#ccc",
                "canvas-ruler-background": "#fff",
                "canvas-ruler-border": "#cbcbcb",
                "canvas-ruler-margins-background": "#d9d9d9",
                "canvas-ruler-mark": "#555",
                "canvas-ruler-handle-border": "#555",
                "canvas-ruler-handle-border-disabled": "#aaa",
                "canvas-high-contrast": "#000",
                "canvas-high-contrast-disabled": "#666",
                "canvas-cell-border": "rgba(0, 0, 0, 0.1)",
                "canvas-cell-title-background": "#f7f7f7",
                "canvas-cell-title-background-hover": "#dfdfdf",
                "canvas-cell-title-background-selected": "#cfcfcf",
                "canvas-cell-title-border": "#d8d8d8",
                "canvas-cell-title-border-hover": "#c9c9c9",
                "canvas-cell-title-border-selected": "#bbb",
                "canvas-cell-title-text": "#444",
                "canvas-dark-cell-title": "#666666",
                "canvas-dark-cell-title-hover": "#999",
                "canvas-dark-cell-title-selected": "#333",
                "canvas-dark-cell-title-border": "#3d3d3d",
                "canvas-dark-cell-title-border-hover": "#5c5c5c",
                "canvas-dark-cell-title-border-selected": "#0f0f0f",
                "canvas-dark-content-background": "#3a3a3a",
                "canvas-dark-page-border": "#2a2a2a",
                "canvas-scroll-thumb": "#f7f7f7",
                "canvas-scroll-thumb-hover": "#c0c0c0",
                "canvas-scroll-thumb-pressed": "#adadad",
                "canvas-scroll-thumb-border": "#cbcbcb",
                "canvas-scroll-thumb-border-hover": "#cbcbcb",
                "canvas-scroll-thumb-border-pressed": "#adadad",
                "canvas-scroll-arrow": "#adadad",
                "canvas-scroll-arrow-hover": "#f7f7f7",
                "canvas-scroll-arrow-pressed": "#f7f7f7",
                "canvas-scroll-thumb-target": "#c0c0c0",
                "canvas-scroll-thumb-target-hover": "#f7f7f7",
                "canvas-scroll-thumb-target-pressed": "#f7f7f7",
                "canvas-sheet-view-cell-background": "#73bf91",
                "canvas-sheet-view-cell-background-hover": "#97e3b6",
                "canvas-sheet-view-cell-background-pressed": "#aaffcc",
                "canvas-sheet-view-cell-title-label": "#121212",
                "canvas-freeze-line-1px": "#818182",
                "canvas-freeze-line-2px": "#aaaaaa",
                "canvas-select-all-icon": "#999",
                "canvas-anim-pane-background": "#f7f7f7",
                "canvas-anim-pane-item-fill-selected": "#cbcbcb",
                "canvas-anim-pane-item-fill-hovered": "#e0e0e0",
                "canvas-anim-pane-button-fill": "#e0e0e0",
                "canvas-anim-pane-button-fill-hovered": "#e0e0e0",
                "canvas-anim-pane-button-fill-disabled": "rgba(224, 224, 224, 0.4)",
                "canvas-anim-pane-play-button-fill": "#fff",
                "canvas-anim-pane-play-button-outline": "#c0c0c0",
                "canvas-anim-pane-effect-bar-entrance-fill": "#77b583",
                "canvas-anim-pane-effect-bar-entrance-outline": "#0e8a26",
                "canvas-anim-pane-effect-bar-emphasis-fill": "#fbc37c",
                "canvas-anim-pane-effect-bar-emphasis-outline": "#ff8e00",
                "canvas-anim-pane-effect-bar-exit-fill": "#f59a9a",
                "canvas-anim-pane-effect-bar-exit-outline": "#f23d3d",
                "canvas-anim-pane-effect-bar-path-fill": "#a1cee3",
                "canvas-anim-pane-effect-bar-path-outline": "#254662",
                "canvas-anim-pane-timeline-ruler-outline": "#cbcbcb",
                "canvas-anim-pane-timeline-ruler-tick": "#cbcbcb",
                "canvas-anim-pane-timeline-scroller-fill": "#cbcbcb",
                "canvas-anim-pane-timeline-scroller-outline": "#444",
                "canvas-anim-pane-timeline-scroller-opacity": "0",
                "canvas-anim-pane-timeline-scroller-opacity-hovered": "0.4",
                "canvas-anim-pane-timeline-scroller-opacity-active": "1",
                "toolbar-height-controls": "84px",
                "sprite-button-icons-uid": "mod25",
                "type": "light",
                "name": "theme-white"
            }
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
            case 'onChangeAction':
                if (settings.actions[message.data.id]) {
                    settings.actions[message.data.id].model = message.data.model;
                }
                break;
            case 'onOpenEditModal':
                tmpModel = message.data.model;
                AIIntegration.navigateToView('aiModelEdit');
                break;
            case 'onOpenAddModal':
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
