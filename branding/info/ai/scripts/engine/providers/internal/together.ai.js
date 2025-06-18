"use strict";

class Provider extends AI.Provider {

	constructor() {
		super("Together AI", "https://api.together.xyz", "", "v1");
	}

	checkModelCapability = function(model) {
		if (model.context_length)
			model.options.max_input_tokens = AI.InputMaxTokens.getFloor(model.context_length);

		if ("chat" === model.type) {
			model.endpoints.push(AI.Endpoints.Types.v1.Chat_Completions);
			let result = AI.CapabilitiesUI.Chat;

			if (-1 !== model.id.toLowerCase().indexOf("vision")) {
				model.endpoints.push(AI.Endpoints.Types.v1.Vision);
				result |= AI.CapabilitiesUI.Vision;
			}
			return result;
		}

		if ("image" === model.type) {
			model.endpoints.push(AI.Endpoints.Types.v1.Images_Generations);
			model.endpoints.push(AI.Endpoints.Types.v1.Images_Edits);
			model.endpoints.push(AI.Endpoints.Types.v1.Images_Variarions);
			return AI.CapabilitiesUI.Image;
		}

		if ("moderation" === model.type) {
			model.endpoints.push(AI.Endpoints.Types.v1.Moderations);
			return AI.CapabilitiesUI.Moderations;
		}

		if ("embedding" === model.type) {
			model.endpoints.push(AI.Endpoints.Types.v1.Embeddings);
			return AI.CapabilitiesUI.Embeddings;
		}

		if ("language" === model.type) {
			model.endpoints.push(AI.Endpoints.Types.v1.Language);
			return AI.CapabilitiesUI.Language;
		}

		if ("code" === model.type) {
			model.endpoints.push(AI.Endpoints.Types.v1.Code);
			return AI.CapabilitiesUI.Code | AI.CapabilitiesUI.Chat;
		}

		if ("rerank" === model.type) {
			return AI.CapabilitiesUI.None;
		}		

		model.endpoints.push(AI.Endpoints.Types.v1.Chat_Completions);
		return AI.CapabilitiesUI.Chat;
	}

	isUseProxy() {
		return true;
	}

}
