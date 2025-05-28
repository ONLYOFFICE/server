(function(exports, undefined)
{
	exports.AI = exports.AI || {};
	var AI = exports.AI;

	AI.DEFAULT_SERVER_SETTINGS = null;
	
	var localStorageKey = "onlyoffice_ai_plugin_storage_key";

	AI.Providers = {};
	
	AI.serializeProviders = function() {
		let result = [];
		for (let i in AI.Providers) {
			if (AI.Providers[i].name) {
				result.push({
					name : AI.Providers[i].name,
					url : AI.Providers[i].url,
					key : AI.Providers[i].key,
					models : AI.Providers[i].models
				});
			}
		}
		return result;
	};

	AI.Models = [];

	AI.Storage.save = function() {
		try {
			let obj = {
				version : AI.Storage.Version,
				providers : {},
				models : AI.Models,
				customProviders : AI.InternalCustomProvidersSources
			};

			for (let pr in AI.Providers)
			{
				obj.providers[pr] = {};
				obj.providers[pr].name = AI.Providers[pr].name;
				obj.providers[pr].url = AI.Providers[pr].url;
				obj.providers[pr].key = AI.Providers[pr].key;
				obj.providers[pr].models = AI.Providers[pr].models;
			}

			window.localStorage.setItem(localStorageKey, JSON.stringify(obj));

			if (this.onChangeStorage)
				this.onChangeStorage();
			return true;
		}
		catch (e) {
		}
		return false;
	};

	AI.Storage.load = function() {
		let obj = null;
		try {
			obj = JSON.parse(window.localStorage.getItem(localStorageKey));
		} catch (e) {
			obj = AI.DEFAULT_SERVER_SETTINGS;

			if (obj) {
				AI.DEFAULT_SERVER_SETTINGS.version = AI.Storage.Version;
			}
		}

		if (obj) {
			let fixVersion2 = false;
			switch (obj.version)
			{
			case undefined:
			case 1:
				obj = null;
				break;
			case 2:
				// redesign provider url: add /v1
				fixVersion2 = true;
				break;
			case 3:
			default:
				break;
			}
			
			if (obj) {
				let oldProviders = AI.Providers;
				AI.Providers = {};

				AI.InternalCustomProvidersSources = obj.customProviders || {};
				AI.loadCustomProviders();

				for (let i = 0, len = AI.InternalCustomProviders.length; i < len; i++) {
					let pr = AI.InternalCustomProviders[i];
					oldProviders[pr.name] = pr;
				}

				for (let i = 0, len = AI.InternalCustomProviders.length; i < len; i++) {
					if (AI.InternalCustomProviders[i].name === name) {
						AI.InternalCustomProviders.splice(i, 1);
						break;
					}				
				}

				for (let i in obj.providers) {
					let pr = obj.providers[i];
					AI.Providers[i] = AI.createProviderInstance(pr.name, pr.url, pr.key, pr.addon);
					AI.Providers[i].models = pr.models || [];

					if (fixVersion2) {
						if (!AI.isInternalProvider(pr.name))
							AI.Providers[i].addon = "v1";
					}
				}

				for (let pr in oldProviders)
				{
					if (!AI.Providers[pr])
						AI.Providers[pr] = oldProviders[pr];
				}

				AI.Models = obj.models;
			}

			return true;
		}
		return false;
	};

	AI.Storage.addModel = function(model) {

		if (AI.Providers[model.provider.name]) {
			AI.Providers[model.provider.name].name = model.provider.name;
			AI.Providers[model.provider.name].url = model.provider.url;
			AI.Providers[model.provider.name].key = model.provider.key;
		} else {
			AI.Providers[model.provider.name] = 
				AI.createProviderInstance(model.provider.name, model.provider.url, model.provider.key);
		}

		if (AI.TmpProviderForModels && 
			model.provider.name === AI.TmpProviderForModels.name && 
			AI.TmpProviderForModels.models.length > 0) {
			AI.Providers[model.provider.name].models = AI.TmpProviderForModels.models;
		}

		let isFoundModel = false;
		for (let i = 0, len = AI.Models.length; i < len; i++)
		{
			if (AI.Models[i].id === model.id)
			{
				AI.Models[i].provider = model.provider.name;
				AI.Models[i].name = model.name;
				AI.Models[i].capabilities = model.capabilities;
				isFoundModel = true;
			}
		}

		if (!isFoundModel)
			AI.Models.push(new AI.UI.Model(model.name, model.id, model.provider.name, 
				model.capabilities === undefined ? AI.CapabilitiesUI.All : model.capabilities));

		this.save();
	};

	AI.Storage.removeModel = function(modelId) {
		for (let i = 0, len = AI.Models.length; i < len; i++)
		{
			if (AI.Models[i].id === modelId)
			{
				AI.Models.splice(i, 1);
				this.save();
				return;
			}
		}
	};

	AI.Storage.getModelByName = function(name) {
		for (let i in AI.Models) {
			if (AI.Models[i].name === name)
				return AI.Models[i];
		}
		return null;
	};

	AI.Storage.getModelById = function(id) {
		for (let i in AI.Models) {
			if (AI.Models[i].id === id)
				return AI.Models[i];
		}
		return null;
	};

	AI.Storage.serializeModels = function() {
		let result = [];
		for (let i in AI.Models) {
			if (AI.Models[i].id) {
				result.push({
					name : AI.Models[i].name,
					id : AI.Models[i].id,
					provider : AI.Models[i].provider,
					capabilities : AI.Models[i].capabilities,
				});
			}
		}
		return result;
	};

	AI.Storage.getProvider = function(name) {
		if (AI.Providers[name])
			return AI.Providers[name];
		return null;
	};

	AI.onLoadInternalProviders = function() {
		for (let i = 0, len = AI.InternalProviders.length; i < len; i++) {
			let pr = AI.InternalProviders[i];
			AI.Providers[pr.name] = pr;
		}
		AI.Storage.load();
	};

})(window);
