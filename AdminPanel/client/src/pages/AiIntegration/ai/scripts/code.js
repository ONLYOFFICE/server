/*
 * (c) Copyright Ascensio System SIA 2010-2025
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

let settingsWindow = null;
let aiModelsListWindow = null; 
let aiModelEditWindow = null;
let customProvidersWindow = null;
let summarizationWindow = null;
let translateSettingsWindow = null;
let helperWindow = null;

window.getActionsInfo = function() {
	let actions = [];
	for (const action in AI.ActionType) {
		if (AI.ActionType.hasOwnProperty(action)) {
			let requestEngine = AI.Request.create(action, true);
			if (requestEngine)
				actions.push({ [action] : requestEngine.model });
		}		
	}
	return actions;
};

window.addSupportAgentMode = function(editorVersion) {
	var agentHistory = [];
	var agentDebug = false;

	if (!window.EditorHelper) {
		window.EditorHelper = new EditorHelperImpl();
	}

	var is91 = editorVersion >= 9001000;

	window.Asc.plugin.attachEditorEvent("onKeyDown", function(e) {
		if (e.keyCode === 27 && helperWindow) {
			helperWindow.close();
			helperWindow = null;
			Asc.Editor.callMethod("FocusEditor");
			return;
		}

		let isCtrl = e.ctrlKey || e.metaKey;
		let isClearHistory = isCtrl && e.altKey;

		let isAgentShow = false;
		if (isCtrl)
		{
			if (is91)
			{
				isAgentShow = e.key === "/";
			}
			else
			{
				isAgentShow = e.keyCode === 191 || e.keyCode === 111;
			}
		}		
		
		if (isAgentShow && isCtrl && !helperWindow) {
			if (isClearHistory)
				agentHistory = [];

			let variation = {
				url : 'helper.html',
				isVisual : true,
				buttons : [],
				isModal : false,
				isCustomWindow : true,
				EditorsSupport : ["word", "slide", "cell", "pdf"],
				size : [500, 50],
				isTargeted : true,
				transparent : true
			};
			helperWindow = new window.Asc.PluginWindow();

			helperWindow.attachEvent("onHelperShow", function() {
				helperWindow.activate(true);
			});

			helperWindow.attachEvent("onHelperClose", function() {
				helperWindow.close();
				helperWindow = null;
				Asc.Editor.callMethod("FocusEditor");
			});

			helperWindow.attachEvent("onHelperAction", async function(prompt) {
				//console.log("Helper action: " + prompt);

				helperWindow.close();
				helperWindow = null;
				Asc.Editor.callMethod("FocusEditor");

				let requestEngine = AI.Request.create(AI.ActionType.Chat);
				if (!requestEngine)
					return;

				let isSendedEndLongAction = false;
				async function checkEndAction() {
					if (!isSendedEndLongAction) {
						await Asc.Editor.callMethod("EndAction", ["Block", "AI (" + requestEngine.modelUI.name + ")"]);
						isSendedEndLongAction = true
					}
				}

				await Asc.Editor.callMethod("StartAction", ["Block", "AI (" + requestEngine.modelUI.name + ")"]);
				await Asc.Editor.callMethod("StartAction", ["GroupActions"]);

				let bufferWait = "[functionCalling";
				let checkBuffer = true;
				let buffer = "";

				if (0 === agentHistory.length) {
					let systemPrompt = window.EditorHelper.getSystemPrompt();
					if (systemPrompt !== "") {
						agentHistory.push({
							role: "system", content: systemPrompt
						});
					}
				}

				if (agentHistory.length > 0 && agentHistory[agentHistory.length - 1].role === "user") {
					agentHistory[agentHistory.length - 1].content += "\n" + prompt;
				} else {
					agentHistory.push({
						role: "user",
						content: prompt
					});
				}

				let copyMessages = [];
				for (let i = 0, len = agentHistory.length; i < len; i++) {
					let item = agentHistory[i];
					copyMessages.push({
						role: item.role,
						content: item.content
					});
				}

				let isSupportStreaming = window.EditorHelper.isSupportStreaming;
				let dataStream = "";
				async function onStreamEvent(data, end) {
					if (isSupportStreaming)
						await Asc.Library.PasteText(data);
					dataStream += data;
					if (true === end && "" !== dataStream) {
						await Asc.Library.PasteText(dataStream);
						dataStream = "";
					}
				}

				let result = await requestEngine.chatRequest(copyMessages, false, async function(data) {
					if (!data)
						return;

					if (isSupportStreaming)
						await checkEndAction();
					
					let oldBuffer = buffer;
					buffer += data;
					if (checkBuffer && buffer.length >= bufferWait.length) {
						if (!buffer.startsWith(bufferWait)) {
							data = oldBuffer + data;
							checkBuffer = false;
						}
					}

					if (!checkBuffer)
						await onStreamEvent(data);
				});

				if (checkBuffer && !buffer.startsWith(bufferWait)) {
					checkBuffer = false;
					await onStreamEvent(buffer, true);
				}

				if (!isSupportStreaming) {
					await onStreamEvent("", true);
				}

				await checkEndAction();

				if (checkBuffer) {
					if (agentDebug)
						console.log(buffer);

					let resultFunc = await window.EditorHelper.callFunc(buffer);
					if (resultFunc) {
						if (resultFunc.error) {
							agentHistory.push({
								role: "assistant",
								content: resultFunc.error
							});
						} else if (resultFunc.message !== undefined) {
							agentHistory.push({
								role: "assistant", content: resultFunc.message
							});
						}

						if (resultFunc.prompt !== undefined) {
							agentHistory.push({
								role: "user", content: resultFunc.prompt
							});
						}
					}
				} else {
					if (agentDebug)
						console.log(result);

					agentHistory.push({
						role: "assistant",
						content: result
					});
				}
				await Asc.Editor.callMethod("EndAction", ["GroupActions"]);
			});

			helperWindow.show(variation);
			helperWindow.isSkipClick = true;
			setTimeout(function() {
				if (helperWindow)
					helperWindow.isSkipClick = false;
			}, 500);
		}
	});
	
	window.Asc.plugin.attachEditorEvent("onClick", function(e) {
		if (helperWindow && !helperWindow.isSkipClick) {
			helperWindow.close();
			helperWindow = null;
		}
	});
}

let initCounter = 0;
async function initWithTranslate(counter) {
	initCounter |= counter;
	if (3 === initCounter) {
		initCounter = 5;
		registerButtons(window);
		Asc.Buttons.registerContextMenu();
		Asc.Buttons.registerToolbarMenu();

		if (Asc.Editor.getType() === "pdf") {
			window.Asc.plugin.attachEditorEvent("onChangeRestrictions", function(value){
				let disabled = (value & 0x80) !== 0;
				if (window.buttonOCRPage.disabled !== disabled)
					window.buttonOCRPage.disabled = disabled;
				Asc.Buttons.updateToolbarMenu(window.buttonMainToolbar.id, window.buttonMainToolbar.name, [window.buttonOCRPage]);
			});

			let restriction = Asc.plugin.info.restrictions;
			if (undefined === restriction)
				restriction = 0;

			let buttonOCRPage = new Asc.ButtonToolbar(null);
			buttonOCRPage.text = "OCR";
			buttonOCRPage.icons = window.getToolBarButtonIcons("ocr");
			window.buttonOCRPage = buttonOCRPage;

			if (0x80 & restriction)
				buttonOCRPage.disabled = true;

			buttonOCRPage.attachOnClick(async function(data){
				let requestEngine = AI.Request.create(AI.ActionType.OCR);
				if (!requestEngine)
					return;

				let pageIndex = await Asc.Editor.callMethod("GetCurrentPage");
				let content = await Asc.Editor.callMethod("GetPageImage", [pageIndex, {
					maxSize : 1024,
					annotations : true,
					fields : false,
					drawings : false
				}]);
				if (!content)
					return;

				let result = await requestEngine.imageOCRRequest(content);
				if (!result) return;

				await Asc.Editor.callMethod("ReplacePageContent", [pageIndex, {
					type : "html",
					options : {
						content : Asc.Library.ConvertMdToHTML(result, [Asc.PluginsMD.latex]),
						separateParagraphs : false
					}					
				}]);
			});

			Asc.Buttons.updateToolbarMenu(window.buttonMainToolbar.id, window.buttonMainToolbar.name, [buttonOCRPage]);
		}

		let editorVersion = await Asc.Library.GetEditorVersion();
		if (editorVersion >= 9000000) {
			window.Asc.plugin.attachEditorEvent("onAIRequest", async function(params){
				let data = {};
				let isFromMethod = params.isFromMethod === true;
				let isBlock = !isFromMethod;

				async function sendResult(data) {
					if (isFromMethod) {
						await Asc.Editor.callMethod("SendEventInternal", ["ai_onRequest", data]);	
					} else {
						await Asc.Editor.callMethod("onAIRequest", [data]);
					}
				}

				if ("Actions" === params.type) {
					data.Actions = window.getActionsInfo();
					return await sendResult(data);
				}
				
				if ("text" === params.type)
					params.type = AI.ActionType.Chat;

				let requestEngine = null;
				if (AI.Actions[params.type])
					requestEngine = AI.Request.create(params.type);

				if (!requestEngine) {
					data.type = "no-engine";
					data.text = "";
					data.error = "No model selected for chat action...";

					return await sendResult(data);
				}

				if (isFromMethod) {
					await Asc.Editor.callMethod("SendEventInternal", ["ai_onStartAction", {
						type : "Block",
						description : "AI (" + requestEngine.modelUI.name + ")"
					}]);
				}

				switch (params.type) {
					case AI.ActionType.Chat:
					{
						data.type = "text";
						data.text = await requestEngine.chatRequest(params.data, isBlock);
						break;
					}
					case AI.ActionType.Translation:
					{
						data.type = "text";
						let prompt = Asc.Prompts.getTranslatePrompt(params.data.text, params.data.lang);
						let result = await requestEngine.chatRequest(prompt, isBlock);
						data.text = result ? Asc.Library.getTranslateResult(result, params.data.text) : "";
						break;
					}
					case AI.ActionType.ImageGeneration:
					{
						data.type = AI.ActionType.ImageGeneration;
						let result = await requestEngine.imageGenerationRequest(params.data, isBlock);
						data.image = result || "";
						break;
					}
					case AI.ActionType.OCR:
					{
						data.type = AI.ActionType.OCR;
						let result = await requestEngine.imageOCRRequest(params.data, isBlock);
						if (result) {
							data.result = Asc.Library.ConvertMdToHTML(result, [Asc.PluginsMD.latex]);
						}
						break;
					}
					case AI.ActionType.Vision:
					{
						data.type = AI.ActionType.Vision;
						let result = await requestEngine.imageVisionRequest({
							prompt : Asc.Prompts.getImageDescription(),
							image : params.data
						}, isBlock);
						data.result = result || "";
						break;
					}
					default:
						break;
				}

				if (isFromMethod) {
					await Asc.Editor.callMethod("SendEventInternal", ["ai_onEndAction", {
						type : "Block",
						description : "AI (" + requestEngine.modelUI.name + ")"
					}]);
				}

				await sendResult(data);			
			});

			if ("cell" === window.Asc.plugin.info.editorType) {
				let AIFunc = {
					guid : "e8ea2fb288054deaa6b82158c04dee37",
					name : "AI",
					value : "\
	(function()\n\
	{\n\
		/**\n\
		 * Function that returns the AI answer.\n\
		 * @customfunction\n\
		 * @param {string} value Prompt.\n\
		 * @param {?boolean} isSaveAIFunction Indicator whether the AI function should be saved.\n\
		 * @returns {string} Answer value.\n\
		 */\n\
		async function AI(value, isSaveAIFunction) {\n\
			let systemMessage = \"As an Excel formula expert, your job is to provide advanced Excel formulas that perform complex calculations or data manipulations as described by the user. Keep your answers as brief as possible. If the user asks for formulas, return only the formula. If the user asks for something, answer briefly and only the result, without descriptions or reflections. If you received a request that is not based on Excel formulas, then simply answer the text request as briefly as possible, without descriptions or reflections\";\n\
			return new Promise(resolve => (function(){\n\
				Api.AI({ type : \"text\", data : [{role: \"system\", content: systemMessage}, {role:\"user\", content: value}] }, function(data){\n\
					if (data.error)\n\
						return resolve(data.error);\n\
					switch (data.type) {\n\
						case \"text\":\n\
						{\n\
							let result = data.text.trim();\n\
							if (isSaveAIFunction !== true)\n\
								result = \"@@\" + result;\n\
							resolve(result);\n\
							break;\n\
						}\n\
						default:\n\
						{\n\
							resolve(\"#ERROR\");\n\
						}\n\
					}\n\
					resolve(data)\n\
				});\n\
			})());\n\
		}\n\
		Api.AddCustomFunction(AI);\n\
	})();"
				};

				let oldCF = await GetOldCustomFunctions();
				let isFound = false;
				let isUpdate = false;

				for (let i = 0, len = oldCF.macrosArray.length; i < len; i++) {
					let item = oldCF.macrosArray[i];
					if (item.name === AIFunc.name) {
						isFound = true;

						if (item.guid === AIFunc.guid) {
							if (item.value !== AIFunc.value) {
								isUpdate = true;
								item.value = AIFunc.value;
							}
						}
					}
				}
				if (!isFound) {
					oldCF.macrosArray.push(AIFunc);
					isUpdate = true;
				}

				if (isUpdate)
					await Asc.Editor.callMethod("SetCustomFunctions", [JSON.stringify(oldCF)]);
			}
		}

		if (editorVersion >= 9000004)
			window.addSupportAgentMode(editorVersion);
	}
}

function clearChatState() {
	let key = 'onlyoffice_ai_chat_state';
	if (window.localStorage.getItem(key))
		window.localStorage.removeItem(key);
}

async function GetOldCustomFunctions() {
	let data = await Asc.Editor.callMethod("GetCustomFunctions");
	let obj = {
		macrosArray : [],
		current : -1
	};
	if (data) {
		try {
			obj = JSON.parse(data);
		} catch (err) {
			obj = {
				macrosArray : [],
				current : -1
			};
		}
	}
	return obj;
}

window.Asc.plugin.init = async function() {
	// Check server settings
	if (window.Asc.plugin.info.aiPluginSettings) {
		try {
			AI.serverSettings = JSON.parse(window.Asc.plugin.info.aiPluginSettings);
		} catch (e) {
			AI.serverSettings = null;
		}
		delete window.Asc.plugin.info.aiPluginSettings;
	}

	if (this.sendEvent) {
		this.sendEvent("ai_onInit", {});
		this.attachEditorEvent("ai_onCustomProviders", function(providers) {
			
			for (let i = 0, len = providers.length; i < len; i++) {
				let item = providers[i];
				if (!item.name)
					continue;

				if (!item.content) {
					item.content = "\"use strict\";\n\
class Provider extends AI.Provider {\n\
	constructor() {\n\
		super(\"" + item.name + "\", \"[external]\", \"\", \"\");\n\
	}\n\
}";
					let isError = !AI.addCustomProvider(item.content);

					if (!isError) {
						customProvidersWindow && customProvidersWindow.command('onSetCustomProvider', AI.getCustomProviders());
						aiModelEditWindow && aiModelEditWindow.command('onProvidersUpdate', { providers : AI.serializeProviders() });
					}					
				}
			}

		});

		this.attachEditorEvent("ai_onCustomInit", function(obj) {
			
			if (obj.settingsLock !== undefined) {
				let isSettingsRemoved = obj.settingsLock === "removed";
				let isSettingsDisabled = obj.settingsLock === "disabled";

				if (window.buttonSettings) {
					if (window.buttonSettings.removed != isSettingsRemoved || 
						window.buttonSettings.disabled != isSettingsDisabled) {
						window.buttonSettings.removed = isSettingsRemoved;
						window.buttonSettings.disabled = isSettingsDisabled;

						Asc.Buttons.updateToolbarMenu(window.buttonMainToolbar.id, window.buttonMainToolbar.name, [window.buttonSettings]);
					}
				}
			}

			if (obj.actions) {
				let isActionsOverride = obj.actionsOverride === true;

				for (let type in obj.actions) {
					if (!AI.Actions[type])
						continue;
					
					if (!AI.Actions[type].model || isActionsOverride)
						AI.Actions[type].model = obj.actions[type].model;
				}

				AI.ActionsSave();
			}

			let isUpdate = false;
			if (obj.providers) {
				for (let type in obj.providers) {
					AI.Providers[type] = obj.providers[type];
				}
				isUpdate = true;
			}

			if (obj.models) {
				for (let i = 0, len = obj.models.length; i < len; i++) {
					let model = obj.models[i];
					let isFound = false;

					for (let j = 0, jLen = AI.Models.length; j < jLen; j++) {
						let testModel = AI.Models[j];

						if (testModel.name === model.name && 
							testModel.provider === model.provider &&
							testModel.id === model.id) {
							isFound = true;
							AI.Models[j] = model;
							break;
						}
					}

					if (!isFound) {
						AI.Models.push(model);
					}
				}
				isUpdate = true;
			}

			if (isUpdate)
				AI.Storage.save();
			
		});
	}

	await initWithTranslate(1 << 1);
	clearChatState();	
};

window.Asc.plugin.onTranslate = async function() {
	await initWithTranslate(1);
};

window.Asc.plugin.button = function(id, windowId) {
	if (!windowId) {
		return
	}

	if (window.chatWindow && window.chatWindow.id === windowId)
	{
		clearChatState();
		delete window.chatWindow;
	}

	if (settingsWindow && windowId === settingsWindow.id) {
		settingsWindow.close();
		settingsWindow = null;
	} else if (aiModelsListWindow && windowId === aiModelsListWindow.id) {
		aiModelsListWindow.close();
		aiModelsListWindow = null;
		onOpenSettingsModal();
	} else if (translateSettingsWindow && windowId === translateSettingsWindow.id) {
		if (id == 0) {
			translateSettingsWindow.command('onKeepLang');
		}

		translateSettingsWindow.close();
		delete translateSettingsWindow;
	} else if (aiModelEditWindow && windowId === aiModelEditWindow.id) {
		if (id == 0) {
			aiModelEditWindow.command('onSubmit');
		} else {
			aiModelEditWindow.close();
			aiModelEditWindow = null;
		}
	} else if (customProvidersWindow && windowId === customProvidersWindow.id) {
		customProvidersWindow.close();
		customProvidersWindow = null;
	} else {
		window.Asc.plugin.executeMethod("CloseWindow", [windowId]);
	}
};

window.Asc.plugin.onThemeChanged = function(theme) {
	window.Asc.plugin.onThemeChangedBase(theme);

	settingsWindow && settingsWindow.command('onThemeChanged', theme);
	aiModelsListWindow && aiModelsListWindow.command('onThemeChanged', theme);
	aiModelEditWindow && aiModelEditWindow.command('onThemeChanged', theme);
	summarizationWindow && summarizationWindow.command('onThemeChanged', theme);
	translateSettingsWindow && translateSettingsWindow.command('onThemeChanged', theme);
	customProvidersWindow && customProvidersWindow.command('onThemeChanged', theme);
	window.chatWindow && window.chatWindow.command('onThemeChanged', theme);
	helperWindow && helperWindow.command('onThemeChanged', theme);
};

/**
 * ACTIONS WINDOW
 */
function updateModels() {
	if (!AI.Storage.onChangeStorage) {
		AI.Storage.onChangeStorage = function() {
			updateModels();
		};
	}

	let models = AI.Storage.serializeModels();
	if (settingsWindow)
		settingsWindow.command('onUpdateModels', models);
	if (aiModelsListWindow)
		aiModelsListWindow.command('onUpdateModels', models);
}
function updateActions() {
	if (settingsWindow)
		settingsWindow.command('onUpdateActions', AI.ActionsGetSorted());
}

function onOpenSettingsModal() {
	let variation = {
		url : 'settings.html',
		description : window.Asc.plugin.tr('AI configuration'),
		isVisual : true,
		buttons : [
			{ text: window.Asc.plugin.tr('OK'), primary: true }
		],
		isModal : true,
		EditorsSupport : ["word", "slide", "cell", "pdf"],
		size : [320, 350]
	};

	if (!settingsWindow) {
		settingsWindow = new window.Asc.PluginWindow();
		settingsWindow.attachEvent("onInit", function() {
			updateActions();
			updateModels();
		});
		settingsWindow.attachEvent("onUpdateHeight", function(height) {
			if(height > variation.size[1]) {
				Asc.Editor.callMethod("ResizeWindow", [settingsWindow.id, [variation.size[0] - 2, height]]);	//2 is the border-width at the window
			}
		});
		settingsWindow.attachEvent('onChangeAction', function(data){
			AI.ActionsChange(data.id, data.model);
		});
		settingsWindow.attachEvent('onOpenAiModelsModal', onOpenAiModelsModal);
		settingsWindow.attachEvent('onOpenAddModal', function () {
			onOpenEditModal({ type: 'add' })
		});

		settingsWindow.attachEvent('onClose', function(){
			if (settingsWindow) {
				settingsWindow.close();
				settingsWindow = null;
			}
		});
	}
	settingsWindow.show(variation);
}

function onTranslateSettingsModal() {
	let variation = {
		url : 'translationsettings.html',
		description : window.Asc.plugin.tr('Translation settings'),
		isVisual : true,
		buttons : [
			{ text: window.Asc.plugin.tr('OK'), primary: true },
			{ text: window.Asc.plugin.tr('Cancel'), primary: false },
		],
		isModal : true,
		EditorsSupport : ["word", "slide", "cell", "pdf"],
		size : [320, 200]
	};

	translateSettingsWindow = new window.Asc.PluginWindow();
	translateSettingsWindow.show(variation);
}

/**
 * MODELS WINDOW
 */
function onOpenAiModelsModal() {
	if (settingsWindow) {
		settingsWindow.close();
		settingsWindow = null;
	}

	let variation = {
		url : 'aiModelsList.html',
		description : window.Asc.plugin.tr('AI Models list'),
		isVisual : true,
		buttons : [
			{ text: window.Asc.plugin.tr('OK'), primary: false },
		],
		isModal : true,
		EditorsSupport : ["word", "slide", "cell", "pdf"],
		size : [320, 230]
	};

	if (!aiModelsListWindow) {
		aiModelsListWindow = new window.Asc.PluginWindow();
		aiModelsListWindow.attachEvent("onInit", function() {
			updateModels();
		});
		aiModelsListWindow.attachEvent("onOpenEditModal", onOpenEditModal);
		aiModelsListWindow.attachEvent("onDeleteAiModel", function(data) {
			AI.Storage.removeModel(data.id);
		});
	}
	aiModelsListWindow.show(variation);
}

/**
 * ADD/EDIT WINDOW
 */
function onOpenEditModal(data) {
	let variation = {
		url : 'aiModelEdit.html',
		description : data.type == 'add' ? window.Asc.plugin.tr('Add AI Model') : window.Asc.plugin.tr('Edit AI Model'),
		isVisual : true,
		buttons : [ 
			{ text: window.Asc.plugin.tr('OK'), primary: true },
			{ text: window.Asc.plugin.tr('Cancel'), primary: false },
		],
		isModal : true,
		EditorsSupport : ["word", "slide", "cell", "pdf"],
		size : [365, 425]
	};

	if (!aiModelEditWindow) {
		aiModelEditWindow = new window.Asc.PluginWindow();
		aiModelEditWindow.attachEvent("onChangeModel", function(model){
			AI.Storage.addModel(model);
			aiModelEditWindow.close();
			aiModelEditWindow = null;
		});
		aiModelEditWindow.attachEvent("onGetModels", async function(provider){
			let models = await AI.getModels(provider);
			aiModelEditWindow && aiModelEditWindow.command("onGetModels", models);
		});

		aiModelEditWindow.attachEvent("onInit", function() {
			aiModelEditWindow.command('onModelInfo', {
				model : data.model ? AI.Storage.getModelByName(data.model.name) : null,
				providers : AI.serializeProviders()
			});
		});
		aiModelEditWindow.attachEvent("onUpdateHeight", function(height) {
			if(height > variation.size[1]) {
				Asc.Editor.callMethod("ResizeWindow", [aiModelEditWindow.id, [variation.size[0] - 2, height]]);	//2 is the border-width at the window
			}
		});
		aiModelEditWindow.attachEvent('onOpenCustomProvidersModal', onOpenCustomProvidersModal);
	}
	aiModelEditWindow.show(variation);
}

/**
 * CUSTOM PROVIDERS WINDOW
 */
function onOpenCustomProvidersModal() {
	let variation = {
		url : 'customProviders.html',
		description : window.Asc.plugin.tr('Custom providers'),
		isVisual : true,
		buttons : [ 
			{ text: window.Asc.plugin.tr('Back'), primary: false },
		],
		isModal : true,
		EditorsSupport : ["word", "slide", "cell", "pdf"],
		size : [350, 222]
	};

	if (!customProvidersWindow) {
		customProvidersWindow = new window.Asc.PluginWindow();
		customProvidersWindow.attachEvent("onInit", function() {
			customProvidersWindow.command('onSetCustomProvider', AI.getCustomProviders());
		});
		customProvidersWindow.attachEvent("onAddCustomProvider", function(item) {
			let isError = !AI.addCustomProvider(item.content);
			if (isError) {
				customProvidersWindow.command('onErrorCustomProvider');
			} else {
				customProvidersWindow.command('onSetCustomProvider', AI.getCustomProviders());

				if (aiModelEditWindow)
					aiModelEditWindow.command('onProvidersUpdate', { providers : AI.serializeProviders() });
			}
		});
		customProvidersWindow.attachEvent("onDeleteCustomProvider", function(item) {
			AI.removeCustomProvider(item.name);

			if (aiModelEditWindow)
				aiModelEditWindow.command('onProvidersUpdate', { providers : AI.serializeProviders() });
		});
	}
	customProvidersWindow.show(variation);
}

/**
 * SUMMARIZATION WINDOW
 */
function onOpenSummarizationModal() {
	let variation = {
		url : 'summarization.html',
		description : window.Asc.plugin.tr('Summarization'),
		isVisual : true,
		buttons : [],
		isModal : true,
		EditorsSupport : ["word", "slide", "cell", "pdf"],
		size : [720, 310]
	};

	summarizationWindow = new window.Asc.PluginWindow();
	summarizationWindow.attachEvent("onInit", async function() {
		let content = await Asc.Library.GetSelectedText();
		summarizationWindow && summarizationWindow.command("onGetSelection", content);
	});
	summarizationWindow.attachEvent("Summarize", async function(content) {
		let requestEngine = AI.Request.create(AI.ActionType.Summarization);
		if (!requestEngine) {
			summarizationWindow.command("onSummarize", {
				error : 1,
				message : "Please, select the model for this action."
			});
			return;
		}

		let isError = false;
		requestEngine.setErrorHandler(function(data){
			summarizationWindow && summarizationWindow.command("onSummarize", data);
			isError = true;
		});

		let prompt = Asc.Prompts.getSummarizationPrompt(content.data, content.lang);
		let result = await requestEngine.chatRequest(prompt);

		if (isError)
			return;

		if (!result) {
			summarizationWindow.command("onSummarize", {
				error : 1,
				message : "Empty result"
			});
			return;
		}

		summarizationWindow && summarizationWindow.command("onSummarize", {
			error : 0,
			data : result
		});
	});
	summarizationWindow.attachEvent("onSummarize", async function(data) {
		switch (data.type) {
		case "review": {
			if (Asc.plugin.info.editorType === "word")
				await Asc.Library.InsertAsReview(data.data);
			else
				await Asc.Library.InsertAsComment(data.data);
			break;
		}
		case "comment": {
			await Asc.Library.InsertAsComment(data.data);
			break;
		}
		case "replace": {
			await Asc.Library.PasteText(data.data);
			break;
		}
		case "end": {
			await Asc.Library.InsertAsText(data.data);
			break;
		}
		}
	});	

	summarizationWindow.show(variation);
}
