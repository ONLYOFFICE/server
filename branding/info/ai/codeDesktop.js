(function(window, undefined){

	function GetSystemPrompt() {
		let systemPrompt = "\
You are an assistant that calls functions in a strict format **only when needed**.\n\
\n\
Function calling format:\n\
\n\
If a function call is required based on the user's request, respond exactly as follows:\n\
[functionCalling (functionName)]: parameters\n\
where\n\
- functionName is the name of the function to call,\n\
- parameters is a JSON object containing all the parameters.\n\
\n\
When calling a function:\n\
- Do not include any explanations or extra text outside the function call.\n\
- Always follow the exact format — no deviations are allowed.\n\
\n\
Only use function calls when they are explicitly required by the user's request.\n\
If the user's request doesn't require any function, respond with normal helpful text.\n\
\n\
Available functions:\n";

		systemPrompt += AscDesktopEditor.getToolFunctions();
		systemPrompt += "\nIf no function call is needed, respond with normal text.\n";

		return systemPrompt;
	}

	function callSystemFunc(data, options) {

		let index1 = data.indexOf("(");
		let index2 = data.indexOf(")");
		let index3 = data.indexOf("{");

		options.name = data.substring(index1 + 1, index2).trim();
		options.params = data.substring(index3).trim();

		return AscDesktopEditor.callToolFunction(options.name, options.params);
	}

	function registerActions() {
		// register actions
		window.AI = window.AI || {};
		var AI = window.AI;

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
		AI.Actions[AI.ActionType.OCR]             = new ActionUI("OCR", "text-analysis-ai", "", AI.CapabilitiesUI.Vision);
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
				obj = JSON.parse(window.localStorage.getItem(actions_key));
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

	window.addEventListener("load", function() {
		if (window.Asc.plugin) {
			window.Asc.plugin.init();
		}
	});

	function loadJSONSync(url) {
		const xhr = new XMLHttpRequest();
		xhr.open("GET", url, false); // false — делает запрос синхронным
		xhr.send(null);

		if (xhr.status === 200) {
			return JSON.parse(xhr.responseText);
		} else {
			return {};
		}
	}

	function showLoader() {
		document.getElementById('loaderId').style.marginLeft = getComputedStyle(document.body).marginLeft;
  		document.getElementById('loaderOverlay').style.display = 'flex';
	}

	function hideLoader(message) {
		document.getElementById('loaderId').style.marginLeft = "0px";
  		document.getElementById('loaderOverlay').style.display = 'none';		
	}

	LAST_INPUT_INDEX = 0;
	function getInputMessage() {
		const textarea = document.getElementById('chatInput');
		const message = textarea.value.substring(LAST_INPUT_INDEX).trim();
		return message;
	}

	function appendAnswer(message) {
		const textarea = document.getElementById('chatInput');
		textarea.value = textarea.value + "\n" + window.Asc.plugin.tr("Agent") + ": " + message;
		textarea.style.height = 'auto';
		textarea.style.height = textarea.scrollHeight + 'px';

		LAST_INPUT_INDEX = textarea.value.length;
	}

	window.Asc = window.Asc || {};
	window.Asc.Editor = {};
	window.Asc.Editor.callMethod = function(method, params) {
		if (method === "StartAction")
			showLoader();
		else if (method === "EndAction")
			hideLoader();
	};

	window.Asc.Library = {};
	window.Asc.Library.SendError = async function(text, errorLevel)
	{
		console.error(text);
	};

	window.Asc.OpenAIEncode = function(text) {
		return [1, 2, 3];
	};

	function trimResult(data, posStart, isSpaces, extraCharacters) {
		let pos = posStart || 0;
		if (-1 != pos) {
			let trimC = ["\"", "'", "\n", "\r", "`"];
			if (extraCharacters)
				trimC = trimC.concat(extraCharacters);
			if (true === isSpaces)
				trimC.push(" ");
			while (pos < data.length && trimC.includes(data[pos]))
				pos++;

			let posEnd = data.length - 1;
			while (posEnd > 0 && trimC.includes(data[posEnd]))
				posEnd--;

			if (posEnd > pos)
				return data.substring(pos, posEnd + 1);				
		}
		return data;
	};

	function getFullTrimResult(data) {
		return trimResult(data, 0, true);
	};

	var SYSTEM_MESSAGE = "";
	var SYSTEM_AGENT_TOOLS = {};
	var MESSAGES = [];

	var GLOBAL_INIT = false;
	function initializeCode() 
	{
		registerActions();
		const textarea = document.getElementById('chatInput');

		textarea.addEventListener('input', () => {
			textarea.style.height = 'auto';
			textarea.style.height = textarea.scrollHeight + 'px';
		});

		textarea.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				GO();
			}
		});

		async function GO() {
			const message = getInputMessage();
			if (message === "") 
				return;

			let requestEngine = AI.Request.create(AI.ActionType.Chat);
			if (!requestEngine) {
				console.error("Request engine is not initialized.");
				hideLoader();
				return;
			}

			if (SYSTEM_MESSAGE === "") {
				SYSTEM_MESSAGE = GetSystemPrompt();

				MESSAGES.push({
					role: "system",
					content: SYSTEM_MESSAGE
				});
			}

			if (MESSAGES.length > 0 && MESSAGES[MESSAGES.length - 1].role === "user") {
				MESSAGES[MESSAGES.length - 1].content += "\n" + message;
			} else {
				MESSAGES.push({
					role: "user",
					content: message
				});
			}

			let result = await requestEngine.chatRequest(MESSAGES);
			if (!result) result = "";

			result = getFullTrimResult(result, message);
			let shownResult = result;
			let promptResult = "";

			if (0 === result.indexOf("[functionCalling (")) {
				showLoader();
				let options = {};
				let systemResult = callSystemFunc(result, options);
				hideLoader();

				if (result === "") {
					shownResult = "System tool wasn't foundSystem tool not found. Please clarify your question.";
				} else {
					let resultMessageIndex = systemResult.indexOf("]");
					let resultMessageType = systemResult.substring(1, resultMessageIndex);
					let resultMessage = systemResult.substring(resultMessageIndex + 1);

					switch (resultMessageType) {
						case "prompt": {
							promptResult = resultMessage;
							shownResult = "System tool [" + options.name + "] was called.";
							break;
						}
						case "file": {
							shownResult = "File was created. Openining it...";

							AscDesktopEditor.openTemplate(resultMessage, "new");
							break;
						}
						default: {
							shownResult = "System tool wasn't foundSystem tool not found. Please clarify your question.";
							break;
						}
					}
				}
			}

			MESSAGES.push({
				role: "assistant",
				content: result
			});

			if (promptResult !== "") {
				MESSAGES.push({
					role: "user",
					content: promptResult
				});
			}

			appendAnswer(shownResult);
			console.log("AI answer: " + result);
		}		

		document.getElementById("goId").onclick = GO;

		function getURLParameter(name) {
			const urlParams = new URLSearchParams(window.location.search);
			return urlParams.get(name);
		}
		window.Asc.plugin.tr = function(val) { return val; };

		try {
			const lang = getURLParameter("lang");
			if (!lang)
				lang = "en";
			if (2 == lang.length)
				lang = lang + "-" + lang.toUpperCase();

			const allLangs = loadJSONSync("./translations/langs.json") || [];
			let isFound = false;
			for (let i = 0; i < allLangs.length; i++) {
				if (allLangs[i] === lang) {
					isFound = true;
					break;
				}
			}

			if (isFound) {
				const curLang = loadJSONSync("./translations/" + lang + ".json");
				window.Asc.plugin.tr_init = true;
				window.Asc.plugin.translateManager = curLang || {};
				window.Asc.plugin.tr_init = true;
				window.Asc.plugin.tr = function(val) {
					if (!window.Asc.plugin.translateManager || !window.Asc.plugin.translateManager[val])
						return val;
					return window.Asc.plugin.translateManager[val];
				};

				if (window.Asc.plugin.onTranslate)
					window.Asc.plugin.onTranslate();
			}
		} catch (e) {
			console.error("Error loading translation file: ", e);
		}	
		window.Asc.plugin.onTranslate();
	}

	window.Asc.plugin.init = function(obj)
	{
		if (!GLOBAL_INIT)
		{
			GLOBAL_INIT = true;
			initializeCode();
		}

		if (!obj)
			return;
	};

	window.Asc.plugin.button = function(id)
	{
		this.executeCommand("close", "");
	};

	window.Asc.plugin.onTranslate = function()
	{
		document.getElementById("header").innerHTML = window.Asc.plugin.tr("ONLYOFFICE AI Agent");
		document.getElementById("chatInput").placeholder = window.Asc.plugin.tr("Enter message") + "...";
		document.getElementById("goId").innerHTML = window.Asc.plugin.tr("Go");
	};

})(window, undefined);
