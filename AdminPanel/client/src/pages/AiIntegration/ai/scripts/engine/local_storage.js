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

				let url = AI.Providers[i].url;
				if (url.endsWith("/"))
					url = url.substring(0, url.length - 1);
				if ("" !== AI.Providers[i].addon)
				{
					let plus = "/" + AI.Providers[i].addon;
					let pos = url.lastIndexOf(plus);
					if (pos === -1 || pos !== (url.length - plus.length))
						url += plus;
				}

				result.push({
					name : AI.Providers[i].name,
					url : url,
					key : AI.Providers[i].key,
					models : AI.Providers[i].models
				});
			}
		}

		result.sort(function(a, b) {
			const weightA = AI.providersWeights[a.name] !== undefined ? AI.providersWeights[a.name] : 100000;
			const weightB = AI.providersWeights[b.name] !== undefined ? AI.providersWeights[b.name] : 100000;
			return weightA - weightB;
		});
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
			if (AI.serverSettings) {
				obj = AI.serverSettings;
			} else {
				obj = JSON.parse(window.localStorage.getItem(localStorageKey));
			}
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

				// correct old models information
				for (let pr in AI.Providers)
				{
					if (AI.Providers[pr] && AI.Providers[pr].name === "OpenAI")
					{
						let models = AI.Providers[pr].models;
						for (let i = 0, len = models.length; i < len; i++) {
							if (models[i].name.startsWith("gpt-4")) {
								if (models[i].options && 
									undefined !== models[i].options.max_input_tokens &&
									models[i].options.max_input_tokens < AI.InputMaxTokens["128k"]) {
									models[i].options.max_input_tokens = AI.InputMaxTokens["128k"];
								}
							}
						}
					}						
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
			let pr = AI.InternalProviders[i].createDuplicate();
			AI.Providers[pr.name] = pr;
		}
		AI.Storage.load();
	};

})(window);
