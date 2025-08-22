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

function registerButtons(window, undefined)
{
	window.AI = window.AI || {};
	var AI = window.AI;
	
	function getToolBarButtonIcons(icon) {
		return "resources/icons/%theme-type%(light|dark)/big/" + icon + "%scale%(default).png";
	}

	function getContextMenuButtonIcons(icon) {
		return "resources/icons/%theme-type%(light|dark)/" + icon + "%scale%(default).png";
	}

	// register contextmenu buttons
	let buttonMain = new Asc.ButtonContextMenu();
	buttonMain.text = "AI";
	buttonMain.icons = getContextMenuButtonIcons("general-ai");
	buttonMain.addCheckers("All");

	function chatWindowShow(attachedText)
	{
		if (window.chatWindow) {
			window.chatWindow.activate();
			return;
		}

		let requestEngine = AI.Request.create(AI.ActionType.Chat);
		if (!requestEngine)
			return;

		let variation = {
			url : "chat.html",
			description : window.Asc.plugin.tr("Chatbot"),
			isVisual : true,
			buttons : [],
			icons: "resources/icons/%theme-name%(theme-default|theme-system|theme-classic-light)/%theme-type%(light|dark)/ask-ai%state%(normal|active)%scale%(default).png",
			isModal : false,
			isCanDocked: true,
			type: window.localStorage.getItem("onlyoffice_ai_chat_placement") || "window",
			EditorsSupport : ["word", "slide", "cell", "pdf"],
			size : [ 400, 400 ]
		};

		let hasOpenedOnce = false;

		var chatWindow = new window.Asc.PluginWindow();
		chatWindow.attachEvent("onWindowReady", function() {
			Asc.Editor.callMethod("ResizeWindow", [chatWindow.id, [400, 400], [400, 400], [0, 0]]);
			if(!hasOpenedOnce && attachedText && attachedText.trim()) {
				chatWindow.command("onAttachedText", attachedText);
			}
			hasOpenedOnce = true;
		});
		chatWindow.attachEvent("onChatMessage", async function(message) {
			let requestEngine = AI.Request.create(AI.ActionType.Chat);
			if (!requestEngine)
				return;

			let result = await requestEngine.chatRequest(message);
			if (!result) result = "";

			//result = result.replace(/\n\n/g, '\n');
			chatWindow.command("onChatReply", result);
		});
		chatWindow.attachEvent("onChatReplace", async function(data) {
			switch (data.type) {
				case "review": {
					if (Asc.plugin.info.editorType === "word")
						await Asc.Library.InsertAsReview(data.data, true);
					else
						await Asc.Library.InsertAsComment(data.data);
					break;
				}
				case "comment": {
					await Asc.Library.InsertAsComment(data.data);
					break;
				}
				case "insert": {
					await Asc.Library.InsertAsHTML(data.data);
					break;
				}
				case "replace": {
					await Asc.Library.ReplaceTextSmart([data.data]);
					break;
				}
			}
		});	
		chatWindow.attachEvent("onDockedChanged", async function(type) {
			window.localStorage.setItem("onlyoffice_ai_chat_placement", type);

			async function waitSaveSettings()
			{
				return new Promise(resolve => (function(){
					chatWindow.attachEvent("onUpdateState", function(type) {
						resolve();
					});
					chatWindow.command("onUpdateState");
				})());
			};
			
			await waitSaveSettings();
			Asc.Editor.callMethod("OnWindowDockChangedCallback", [chatWindow.id]);
		});
		chatWindow.show(variation);

		window.chatWindow = chatWindow;
	}

	// Submenu summarize:
	if (Asc.Editor.getType() !== "pdf")
	{
		let button = new Asc.ButtonContextMenu(buttonMain);
		button.text = "Summarization";
		button.icons = getContextMenuButtonIcons("summarization");
		button.editors = ["word"];
		button.addCheckers("Selection");
		button.attachOnClick(async function(data){
			let requestEngine = AI.Request.create(AI.ActionType.Summarization);
			if (!requestEngine)
				return;

			let content = await Asc.Library.GetSelectedText();
			let prompt = Asc.Prompts.getSummarizationPrompt(content);
			let result = await requestEngine.chatRequest(prompt);
			if (!result) return;

			result = "Summary:\n\n" + result;
			await Asc.Library.InsertAsText(result);
		});
	}

	// Submenu Text Analysis
	if (true)
	{
		let button1 = new Asc.ButtonContextMenu(buttonMain);
		button1.text = "Text analysis";
		button1.icons = getContextMenuButtonIcons("text-analysis-ai");
		button1.editors = ["word"];
		button1.addCheckers("Target", "Selection");

		let button2 = new Asc.ButtonContextMenu(button1);
		button2.text = "Rewrite differently";
		button2.editors = ["word"];
		button2.addCheckers("Selection");
		button2.attachOnClick(async function(){
			let requestEngine = AI.Request.create(AI.ActionType.TextAnalyze);
			if (!requestEngine)
				return;

			let content = await Asc.Library.GetSelectedText();
			let prompt = Asc.Prompts.getTextRewritePrompt(content);
			let result = await requestEngine.chatRequest(prompt);
			if (!result) return;

			result = result.replace(/\n\n/g, '\n');
			await Asc.Library.PasteText(result);
		});

		let button3 = new Asc.ButtonContextMenu(button1);
		button3.text = "Make longer";
		button3.editors = ["word"];
		button3.addCheckers("Selection");
		button3.attachOnClick(async function(data){
			let requestEngine = AI.Request.create(AI.ActionType.TextAnalyze);
			if (!requestEngine)
				return;

			let content = await Asc.Library.GetSelectedText();
			let prompt = Asc.Prompts.getTextLongerPrompt(content);
			let result = await requestEngine.chatRequest(prompt);
			if (!result) return;

			result = result.replace(/\n\n/g, '\n');
			await Asc.Library.PasteText(result);
		});

		let button4 = new Asc.ButtonContextMenu(button1);
		button4.text = "Make shorter";
		button4.editors = ["word"];
		button4.addCheckers("Selection");
		button4.attachOnClick(async function(data){
			let requestEngine = AI.Request.create(AI.ActionType.TextAnalyze);
			if (!requestEngine)
				return;

			let content = await Asc.Library.GetSelectedText();
			let prompt = Asc.Prompts.getTextShorterPrompt(content);
			let result = await requestEngine.chatRequest(prompt);
			if (!result) return;

			result = result.replace(/\n\n/g, '\n');
			await Asc.Library.PasteText(result);
		});

		let button5 = new Asc.ButtonContextMenu(button1);
		button5.text = "Explain text in comment";
		button5.separator = true;
		button5.editors = ["word"];
		button5.addCheckers("Target", "Selection");
		button5.attachOnClick(async function(){
			let requestEngine = AI.Request.create(AI.ActionType.TextAnalyze);
			if (!requestEngine)
				return;

			let content = await Asc.Library.GetSelectedText();
			if (!content)
				content = await Asc.Library.GetCurrentWord();

			if (!content)
				return;

			let prompt = Asc.Prompts.getExplainPrompt(content);
			let result = await requestEngine.chatRequest(prompt);
			if (!result) return;

			result = result.replace(/\n\n/g, '\n');
			await Asc.Library.InsertAsComment(result);
		});

		let button6 = new Asc.ButtonContextMenu(button1);
		button6.text = "Explain text in hyperlink";
		button6.separator = true;
		button6.editors = ["word"];
		button6.addCheckers("Selection");
		button6.attachOnClick(async function(){
			let requestEngine = AI.Request.create(AI.ActionType.TextAnalyze);
			if (!requestEngine)
				return;

			let content = await Asc.Library.GetSelectedText();
			let prompt = Asc.Prompts.getExplainAsLinkPrompt(content);
			let result = await requestEngine.chatRequest(prompt);
			if (!result) return;

			result = result.replace(/\n\n/g, '\n');
			await Asc.Library.InsertAsHyperlink(result);
		});

		let button7 = new Asc.ButtonContextMenu(button1);
		button7.text = "Fix spelling & grammar";
		button7.separator = true;
		button7.editors = ["word"];
		button7.addCheckers("Selection");
		button7.attachOnClick(async function(){
			let requestEngine = AI.Request.create(AI.ActionType.TextAnalyze);
			if (!requestEngine)
				return;

			let content = await Asc.Library.GetSelectedText();
			let prompt = Asc.Prompts.getFixAndSpellPrompt(content);

			let result = await requestEngine.chatRequest(prompt);
			if (!result) return;

			if (result !== 'The text is correct, there are no errors in it.')
			   await Asc.Library.ReplaceTextSmart([result]);
			else
				console.log('The text is correct, there are no errors in it.');
		});

		let button8 = new Asc.ButtonContextMenu(button1);
		button8.text = "Keywords";
		button8.editors = ["word"];
		button8.addCheckers("Selection");
		button8.attachOnClick(async function(){
			let requestEngine = AI.Request.create(AI.ActionType.TextAnalyze);
			if (!requestEngine)
				return;

			let content = await Asc.Library.GetSelectedText();
			let prompt = Asc.Prompts.getTextKeywordsPrompt(content);
			let result = await requestEngine.chatRequest(prompt);
			if (!result) return;

			await Asc.Library.InsertAsText(result);
		});
	}

	// Submenu Translate
	if (true)
	{
		let button1 = new Asc.ButtonContextMenu(buttonMain);
		button1.text = "Translate";
		button1.icons = getContextMenuButtonIcons("translation");
		button1.editors = ["word", "slide", "cell"];
		button1.addCheckers("Selection");

		let button2 = new Asc.ButtonContextMenu(button1);
		button2.text = "English";
		button2.editors = ["word", "slide", "cell"];
		button2.addCheckers("Selection");
		button2.data = "English";
		button2.attachOnClick(async function(data){
			let requestEngine = AI.Request.create(AI.ActionType.Translation);
			if (!requestEngine)
				return;

			let lang = data;
			let content = await Asc.Library.GetSelectedText();
			if (!content)
				return;

			let prompt = Asc.Prompts.getTranslatePrompt(content, lang);
			let result = await requestEngine.chatRequest(prompt);
			if (!result) return;

			result = Asc.Library.getTranslateResult(result, content);

			await Asc.Library.PasteText(result);
		});

		let button3 = button2.copy();
		button3.text = "French";
		button3.data = "French";

		let button4 = button2.copy();
		button4.text = "German";
		button4.data = "German";

		let button5 = button2.copy();
		button5.text = "Chinese";
		button5.data = "Chinese";

		let button6 = button2.copy();
		button6.text = "Japanese";
		button6.data = "Japanese";

		let button7 = button2.copy();
		button7.text = "Russian";
		button7.data = "Russian";

		let button8 = button2.copy();
		button8.text = "Korean";
		button8.data = "Korean";

		let button9 = button2.copy();
		button9.text = "Spanish";
		button9.data = "Spanish";

		let button10 = button2.copy();
		button10.text = "Italian";
		button10.data = "Italian";
	}

	if (true)
	{
		let button1 = new Asc.ButtonContextMenu(buttonMain);
		button1.text = "Show hyperlink content";
		button1.addCheckers("Hyperlink");

		button1.onContextMenuShowExtendItem = function(options, item)
		{
			item.data = options.value;
		};

		button1.attachOnClick(function(data){
			let variation = {
				url : "hyperlink.html",
				description : window.Asc.plugin.tr("Hyperlink"),
				isVisual : true,
				buttons : [],
				isModal : false,
				EditorsSupport : ["word", "slide", "cell", "pdf"],
				size : [ 1000, 1000 ]
			};

			var linkWindow = new window.Asc.PluginWindow();
			linkWindow.attachEvent("onGetLink", async function(){
				let link = data;
				if (!link)
					link = await Asc.Library.GetSelectedText();
				link = link.replace(/\n/g, '');
				link = link.replace(/\r/g, '');
				linkWindow.command("onSetLink", link);
			});
			linkWindow.show(variation);
		});
	}

	const on_click_ocr = async function () {
		let requestEngine = AI.Request.create(AI.ActionType.OCR);
		if (!requestEngine)
			return;

		let content = await Asc.Library.GetSelectedImage();
		if (!content) {
			console.log("you need to select an image to use ocr")
			return;
		}

		let result = await requestEngine.imageOCRRequest(content);
		if (!result) return;

		await Asc.Library.InsertAsMD(result, [Asc.PluginsMD.latex]);
	}

	const on_click_text_to_image = async function (params) {
		let requestEngine = AI.Request.create(AI.ActionType.ImageGeneration);
		if (!requestEngine)
			return;

		let content = await Asc.Library.GetSelectedText();
		if (!content) {
			console.log("you need to select text to generate image")
			return;
		}

		let result = await requestEngine.imageGenerationRequest(content);
		if (!result) return;

			if (Asc.plugin.info.editorSubType === "pdf")
				return await Asc.Library.AddGeneratedImage(result);
			await Asc.Library.AddOleObject(result, content);
	}

	if (true)
	{
		let buttonImages = new Asc.ButtonContextMenu(buttonMain);
		buttonImages.text = "Image";
		buttonImages.icons = getContextMenuButtonIcons("image-ai");
		buttonImages.addCheckers("Selection", "Image", "OleObject");

		let buttonGen = new Asc.ButtonContextMenu(buttonImages);
		buttonGen.text = "Text to Image";
		buttonGen.addCheckers("Selection");
		buttonGen.attachOnClick(async function(){
			let requestEngine = AI.Request.create(AI.ActionType.ImageGeneration);
			if (!requestEngine)
				return;

			let content = await Asc.Library.GetSelectedText();
			if (!content)
				return;

			let result = await requestEngine.imageGenerationRequest(content);
			if (!result) return;

			if (Asc.plugin.info.editorSubType === "pdf")
				return await Asc.Library.AddGeneratedImage(result);
			await Asc.Library.AddOleObject(result, content);
		});

		let buttonOCR = new Asc.ButtonContextMenu(buttonImages);
		buttonOCR.text = "OCR";
		buttonOCR.addCheckers("Image", "OleObject");
		buttonOCR.attachOnClick(on_click_ocr);

		let buttonExplainImage = new Asc.ButtonContextMenu(buttonImages);
		buttonExplainImage.text = "Image to Text";
		buttonExplainImage.addCheckers("Image", "OleObject");
		buttonExplainImage.attachOnClick(async function(){
			let requestEngine = AI.Request.create(AI.ActionType.Vision);
			if (!requestEngine)
				return;

			let content = await Asc.Library.GetSelectedImage();
			if (!content)
				return;

			let result = await requestEngine.imageVisionRequest({
				prompt : Asc.Prompts.getImageDescription(),
				image : content
			});
			if (!result) return;

			await Asc.Library.InsertAsMD(result);
		});
	}

	if (true)
	{
		let button1 = new Asc.ButtonContextMenu(buttonMain);
		button1.text = "Chatbot";
		button1.separator = true;
		button1.icons = getContextMenuButtonIcons("ask-ai");
		button1.addCheckers("All");
		button1.attachOnClick(async function(){
			let selectedText = await Asc.Library.GetSelectedText();
			chatWindowShow(selectedText);
		});
	}

	if (false)
	{
		let button1 = new Asc.ButtonContextMenu(buttonMain);
		button1.text = "Settings";
		button1.separator = true;
		button1.addCheckers("All");
		button1.attachOnClick(function(){
			onOpenSettingsModal();
		});
	}

	// register toolbar buttons
	let buttonMainToolbar = new Asc.ButtonToolbar();
	buttonMainToolbar.text = "AI";

	window.buttonMainToolbar = buttonMainToolbar;
	window.getToolBarButtonIcons = getToolBarButtonIcons;

	if (!AI.serverSettings)
	{
		let button1 = new Asc.ButtonToolbar(buttonMainToolbar);
		button1.text = "Settings";
		button1.icons = getToolBarButtonIcons("settings");
		button1.attachOnClick(function(data){
			onOpenSettingsModal();
		});
	}

	if (true)
	{
		let button1 = new Asc.ButtonToolbar(buttonMainToolbar);

		if (!AI.serverSettings)
			button1.separator = true;
		
		button1.text = "Chatbot";
		button1.icons = getToolBarButtonIcons("ask-ai");
		button1.attachOnClick(function(data){
			chatWindowShow();
		});

		if (Asc.Editor.getType() !== "pdf") {
			let button2 = new Asc.ButtonToolbar(buttonMainToolbar);
			button2.text = "Summarization";
			button2.icons = getToolBarButtonIcons("summarization");
			button2.attachOnClick(async function(data){
				let requestEngine = AI.Request.create(AI.ActionType.Summarization);
				if (!requestEngine)
					return;

				onOpenSummarizationModal();
			});
		}

		if (false) {
			let button3 = new Asc.ButtonToolbar(buttonMainToolbar);
			button3.text = "Text to Image";
			button3.icons = getToolBarButtonIcons("text-to-image");
			button3.attachOnClick(on_click_text_to_image);
		}

		let button4 = new Asc.ButtonToolbar(buttonMainToolbar);
		button4.text = "Translation";
		button4.icons = getToolBarButtonIcons("translation");
		button4.menu = [{
				text:'Settings',
				id:'t10n-settings',
				onclick: () => {
					onTranslateSettingsModal();
				}}];
		button4.split = true;
		button4.attachOnClick(async function(){
			let requestEngine = AI.Request.create(AI.ActionType.Translation);
			if (!requestEngine)
				return;

			const ls_lang_key = "onlyoffice_ai_plugin_translate_lang";
			const currLang = window.localStorage.getItem(ls_lang_key);

			let lang = !!currLang ? currLang : "english";
			let content = await Asc.Library.GetSelectedText();
			if (!content)
				return;

			let prompt = Asc.Prompts.getTranslatePrompt(content, lang);
			let result = await requestEngine.chatRequest(prompt);
			if (!result) return;

			result = Asc.Library.getTranslateResult(result, content);
			await Asc.Library.PasteText(result);
		});

		if (false && Asc.Editor.getType() !== "pdf")
		{
			let button2 = new Asc.ButtonToolbar(buttonMainToolbar);
			button2.text = "OCR";
			button2.icons = getToolBarButtonIcons("ocr");
			button2.attachOnClick(on_click_ocr);
		}
	}

	// register actions

	AI.ActionType = {
		Chat             : "Chat",
		Summarization    : "Summarization",
		Translation      : "Translation",
		TextAnalyze      : "TextAnalyze",
		ImageGeneration  : "ImageGeneration",
		OCR              : "OCR",
		Vision           : "Vision"
	};

	AI.Actions = {};

	function ActionUI(name, icon, modelId, capabilities) {
		this.name = name || "";
		this.icon = icon || "";
		this.model = modelId || "";
		this.capabilities = (capabilities === undefined) ? AI.CapabilitiesUI.Chat : capabilities;
	}

	AI.Actions[AI.ActionType.Chat]            = new ActionUI("Chatbot", "ask-ai");
	AI.Actions[AI.ActionType.Summarization]   = new ActionUI("Summarization", "summarization");
	AI.Actions[AI.ActionType.Translation]     = new ActionUI("Translation", "translation");
	AI.Actions[AI.ActionType.TextAnalyze]     = new ActionUI("Text analysis", "text-analysis-ai");
	AI.Actions[AI.ActionType.ImageGeneration] = new ActionUI("Image generation", "image-ai", "", AI.CapabilitiesUI.Image);
	AI.Actions[AI.ActionType.OCR]             = new ActionUI("OCR", "ocr", "", AI.CapabilitiesUI.Vision);
	AI.Actions[AI.ActionType.Vision]          = new ActionUI("Vision", "vision-ai", "", AI.CapabilitiesUI.Vision);

	AI.ActionsGetKeys = function()
	{
		return [
			AI.ActionType.Chat,
			AI.ActionType.Summarization,
			AI.ActionType.Translation,
			AI.ActionType.TextAnalyze,
			AI.ActionType.ImageGeneration,
			AI.ActionType.OCR,
			AI.ActionType.Vision
		];
	};

	AI.ActionsGetSorted = function()
	{
		let keys = AI.ActionsGetKeys();
		let count = keys.length;
		let actions = new Array(count);
		for (let i = 0; i < count; i++)
		{
			let src = AI.Actions[keys[i]];
			actions[i] = {
				id : keys[i],
				name : Asc.plugin.tr(src.name),
				icon : src.icon,
				model : src.model,
				capabilities : src.capabilities
			}
		}
		return actions;
	};

	var actions_key = "onlyoffice_ai_actions_key";
	AI.ActionsSave = function()
	{
		try
		{
			window.localStorage.setItem(actions_key, JSON.stringify(AI.Actions));
			return true;
		}
		catch (e)
		{
		}
		return false;
	};

	AI.ActionsLoad = function()
	{
		let obj = null;
		try
		{
			if (AI.serverSettings) {
				obj = AI.serverSettings.actions;
			} else {
				obj = JSON.parse(window.localStorage.getItem(actions_key));
			}
		}
		catch (e)
		{
			obj = (AI.DEFAULT_SERVER_SETTINGS && AI.DEFAULT_SERVER_SETTINGS.actions) ? AI.DEFAULT_SERVER_SETTINGS.actions : null;
		}
		
		if (obj)
		{
			for (let i in obj)
			{
				if (AI.Actions[i] && obj[i].model)
					AI.Actions[i].model = obj[i].model;
			}
			return true;
		}
		return false;
	};

	AI.ActionsChange = function(id, model)
	{
		if (AI.Actions[id])
		{
			AI.Actions[id].model = model;
			AI.ActionsSave();
		}
	};

	AI.ActionsLoad();
}
