"use strict";

(function(){

	window.AI = window.AI || {};
	var AI = window.AI;

	// Tokens
	AI.InputMaxTokens = {
		"4k" : 4096,
		"8k" : 8192,
		"16k" : 16384,
		"32k" : 32768,
		"64k" : 65536,
		"128k" : 131072,
		"200k" : 204800,
		"256k" : 262144
	};
	
	let keys = [];
	for (let i in AI.InputMaxTokens)
		keys.push(i);
	
	AI.InputMaxTokens.keys = keys;
	AI.InputMaxTokens.getFloor = function(value) {
		let result = undefined;
		for (let i = 0, len = AI.InputMaxTokens.keys.length; i < len; i++) {
			if (AI.InputMaxTokens[AI.InputMaxTokens.keys[i]] <= value)
				result = AI.InputMaxTokens[AI.InputMaxTokens.keys[i]];
		}
		return result;
	};

	// UI	
	AI.UI = AI.UI || {};

	AI.UI.Model = function(name, id, provider, capabilities) {
		this.capabilities = capabilities || AI.CapabilitiesUI.None;
		this.provider     = provider || "";
		this.name         = name || "";
		this.id           = id || "";		
	};
	
	AI.UI.Provider = function(name, key, url) {
		this.name  = name || "";
		this.key   = key || "";
		this.url   = url || "";
	};
	
	AI.UI.Action = function(name, icon, model) {
		this.name = name || "";
		this.icon = icon || "";
		this.model = model || "";
	};

	// Endpoints
	AI.Endpoints = {

		Types : {

			Undefined                  : -1,

			v1 : {

				Models                 : 0x00,

				Chat_Completions       : 0x01,
				Completions            : 0x02,

				Images_Generations     : 0x11,
				Images_Edits           : 0x12,
				Images_Variarions      : 0x13,

				Embeddings             : 0x21,

				Audio_Transcriptions   : 0x31,
				Audio_Translations     : 0x32,
				Audio_Speech           : 0x33,

				Moderations            : 0x41,

				Realtime               : 0x51,

				Language               : 0x61,
				Code                   : 0x62,

				OCR                    : 0x70
			}

		}
	};

	AI.CapabilitiesUI = {

		None            : 0x00,

		Chat            : 0x01,
		
		Image           : 0x02,

		Embeddings      : 0x04,

		Audio           : 0x08,

		Moderations     : 0x10,

		Realtime        : 0x20,

		Code            : 0x40,

		Vision          : 0x80

	};

	let capabilitiesAll = 0;
	for (let item in AI.CapabilitiesUI)
		capabilitiesAll |= AI.CapabilitiesUI[item];
	AI.CapabilitiesUI.All = capabilitiesAll;

	AI.InternalProviders = [];
	AI.createProviderInstance = function(name, url, key, addon) {
		for (let i = 0, len = window.AI.InternalCustomProviders.length; i < len; i++) {
			if (name === AI.InternalCustomProviders[i].name)
				return AI.InternalCustomProviders[i].createInstance(name, url, key, addon || AI.InternalCustomProviders[i].addon);
		}
		for (let i = 0, len = window.AI.InternalProviders.length; i < len; i++) {
			if (name === AI.InternalProviders[i].name)
				return AI.InternalProviders[i].createInstance(name, url, key, addon || AI.InternalProviders[i].addon);
		}
		return new AI.Provider(name, url, key);
	};

	AI.isInternalProvider = function(name) {
		for (let i = 0, len = AI.InternalProviders.length; i < len; i++) {
			if (name === AI.InternalProviders[i].name)
				return true;
		}
		return false;
	};

	AI.loadInternalProviders = async function() {
		let providersText = await AI.loadResourceAsText("./scripts/engine/providers/config.json");
		if ("" === providersText)
			return;

		try {
			let providers = JSON.parse(providersText);
			for (let i = 0, len = providers.length; i < len; i++) {
				let providerContent = await AI.loadResourceAsText("./scripts/engine/providers/internal/" + providers[i] + ".js");
				if (providerContent !== "") {
					let content = "(function(){\n" + providerContent + "\nreturn new Provider();})();";
					let provider = eval(content);

					if (provider.isOnlyDesktop() && (-1 === navigator.userAgent.indexOf("AscDesktopEditor")))
						continue;

					window.AI.InternalProviders.push(provider);
				}
			}
		} catch(err) {			
		}

		AI.onLoadInternalProviders();
	};

	AI.InternalCustomProvidersSources = {};
	AI.InternalCustomProviders = [];

	AI.loadCustomProviders = function() {

		AI.InternalCustomProviders = [];
		for (let name in AI.InternalCustomProvidersSources) {
			AI.addCustomProvider(AI.InternalCustomProvidersSources[name], true); 
		}

	};

	AI.addCustomProvider = function(providerContent, isRegister) {

		try {
			let content = "(function(){\n" + providerContent + "\nreturn new Provider();})();";
			let provider = eval(content);

			if (!provider.name)
				return false;

			if (provider.isOnlyDesktop() && (-1 === navigator.userAgent.indexOf("AscDesktopEditor")))
				return false;

			AI.InternalCustomProvidersSources[provider.name] = providerContent;

			for (let i = 0, len = AI.InternalCustomProviders.length; i < len; i++) {
				if (AI.InternalCustomProviders[i].name === provider.name) {
					AI.InternalCustomProviders.splice(i, 1);
					break;
				}
			}

			AI.InternalCustomProviders.push(provider);

			if (!isRegister)
			{
				AI.Storage.save();
				AI.Storage.load();
			}

			return true;

		} catch(err) {			
		}

		return false;

	};

	AI.removeCustomProvider = function(name) {

		if (AI.InternalCustomProvidersSources[name])
			delete AI.InternalCustomProvidersSources[name];

		for (let i = 0, len = AI.InternalCustomProviders.length; i < len; i++) {
			if (AI.InternalCustomProviders[i].name === name) {
				AI.InternalCustomProviders.splice(i, 1);

				if (!AI.isInternalProvider(name) && AI.Providers[name]) {
					delete AI.Providers[name];
				}

				AI.Storage.save();
				AI.Storage.load();
				break;
			}				
		}

	};

	AI.getCustomProviders = function() {

		let names = [];
		for (let i = 0, len = AI.InternalCustomProviders.length; i < len; i++) {
			names.push(AI.InternalCustomProviders[i].name);
		}
		return names;

	};

})();
