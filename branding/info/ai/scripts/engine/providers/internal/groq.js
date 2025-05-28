"use strict";

class Provider extends AI.Provider {

	constructor() {
		super("Groq", "https://api.groq.com/openai", "", "v1");
	}

	checkModelCapability = function(model) {
		if (model.context_length)
			model.options.max_input_tokens = AI.InputMaxTokens.getFloor(model.context_length);

		if (-1 !== model.id.toLowerCase().indexOf("vision")) {
			model.endpoints.push(AI.Endpoints.Types.v1.Chat_Completions);
			model.endpoints.push(AI.Endpoints.Types.v1.Vision);
			return AI.CapabilitiesUI.Chat | AI.CapabilitiesUI.Vision;
		}

		if (-1 !== model.id.toLowerCase().indexOf("whisper")) {
			model.endpoints.push(AI.Endpoints.Types.v1.Audio_Transcriptions);
			model.endpoints.push(AI.Endpoints.Types.v1.Audio_Translations);
			return AI.CapabilitiesUI.Audio;
		}
		
		model.endpoints.push(AI.Endpoints.Types.v1.Chat_Completions);
		return AI.CapabilitiesUI.Chat;
	}

}
