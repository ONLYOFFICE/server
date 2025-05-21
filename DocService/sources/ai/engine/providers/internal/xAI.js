"use strict";

class Provider extends AI.Provider {

	constructor() {
		super("xAI", "https://api.x.ai", "", "v1");
	}

	checkExcludeModel(model) {
		if (-1 !== model.id.indexOf("-beta"))
			return true;
		return false;
	}

	checkModelCapability = function(model) {
		if (-1 != model.id.indexOf("vision"))
		{
			model.options.max_input_tokens = AI.InputMaxTokens["32k"];
			model.endpoints.push(AI.Endpoints.Types.v1.Chat_Completions);
			return AI.CapabilitiesUI.Chat | AI.CapabilitiesUI.Vision;
		}

		if (-1 != model.id.indexOf("image"))
		{
			model.endpoints.push(AI.Endpoints.Types.v1.Image_Generation | AI.Endpoints.Types.v1.Images_Edits);
			return AI.CapabilitiesUI.Image;
		}

		model.options.max_input_tokens = AI.InputMaxTokens["128k"];
		model.endpoints.push(AI.Endpoints.Types.v1.Chat_Completions);
		return AI.CapabilitiesUI.Chat;
	}

}
