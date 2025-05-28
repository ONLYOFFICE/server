let settingsWindow = null;
let aiModelsListWindow = null; 
let aiModelEditWindow = null;
let customProvidersWindow = null;
let summarizationWindow = null;
let translateSettingsWindow = null;

let initCounter = 0;
async function initWithTranslate() {
	initCounter++;
	if (2 === initCounter) {
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
	await initWithTranslate();
	clearChatState();

	let editorVersion = await Asc.Library.GetEditorVersion();
	if (editorVersion >= 9000000) {
		window.Asc.plugin.attachEditorEvent("onAIRequest", async function(params){
			let data = {};
			switch (params.type) {
				case "text":
				{
					let requestEngine = AI.Request.create(AI.ActionType.Chat);
					if (requestEngine)
					{
						let result = await requestEngine.chatRequest(params.data);
						if (!result) result = "";

						data.type = "text";
						data.text = result;
					}
					else
					{
						data.type = "no-engine";
						data.text = "";
						data.error = "No model selected for chat action..."
					}
				}
				default:
					break;
			}

			await Asc.Editor.callMethod("onAIRequest", [data]);
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
};

window.Asc.plugin.onTranslate = async function() {
	await initWithTranslate();
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
		settingsWindow.attachEvent('onChangeAction', function(data){
			AI.ActionsChange(data.id, data.model);
		});
		settingsWindow.attachEvent('onOpenAiModelsModal', onOpenAiModelsModal);
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
			{ text: window.Asc.plugin.tr('Back'), primary: false },
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
		size : [320, 375]
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
