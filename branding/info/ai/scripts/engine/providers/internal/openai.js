"use strict";

class Provider extends AI.Provider {

	constructor() {
		super("OpenAI", "https://api.openai.com", "", "v1");
	}

	checkExcludeModel(model) {
		if (-1 !== model.id.indexOf("babbage-002") ||
			-1 !== model.id.indexOf("davinci-002"))
			return true;
		return false;
	}

	checkModelCapability(model) {
		if (-1 !== model.id.indexOf("whisper-1"))
		{
			model.endpoints.push(AI.Endpoints.Types.v1.Audio_Transcriptions);
			model.endpoints.push(AI.Endpoints.Types.v1.Audio_Translations);
			return AI.CapabilitiesUI.Audio;
		}
		if (-1 !== model.id.indexOf("tts-1"))
		{
			model.endpoints.push(AI.Endpoints.Types.v1.Audio_Speech);
			return AI.CapabilitiesUI.Audio;
		}
		if (-1 !== model.id.indexOf("babbage-002") ||
			-1 !== model.id.indexOf("davinci-002"))
		{
			model.options.max_input_tokens = AI.InputMaxTokens["16k"];
			model.endpoints.push(AI.Endpoints.Types.v1.Completions);
			return AI.CapabilitiesUI.Chat;
		}
		if (-1 !== model.id.indexOf("embedding"))
		{
			model.endpoints.push(AI.Endpoints.Types.v1.Embeddings);
			return AI.CapabilitiesUI.Embeddings;
		}
		if (-1 !== model.id.indexOf("moderation"))
		{
			model.endpoints.push(AI.Endpoints.Types.v1.Moderations);
			return AI.CapabilitiesUI.Moderations;
		}
		if (-1 !== model.id.indexOf("realtime"))
		{
			model.endpoints.push(AI.Endpoints.Types.v1.Realtime);
			return AI.CapabilitiesUI.Realtime;
		}
		if ("dall-e-2" === model.id)
		{
			model.endpoints.push(AI.Endpoints.Types.v1.Images_Generations);
			model.endpoints.push(AI.Endpoints.Types.v1.Images_Edits);
			model.endpoints.push(AI.Endpoints.Types.v1.Images_Variarions);
			return AI.CapabilitiesUI.Image;
		}
		if ("dall-e-3" === model.id)
		{
			model.endpoints.push(AI.Endpoints.Types.v1.Images_Generations);
			return AI.CapabilitiesUI.Image;
		}
		
		if (0 === model.id.indexOf("gpt-4o") ||
			0 === model.id.indexOf("o1-") ||
			0 === model.id.indexOf("gpt-4-turbo"))
			model.options.max_input_tokens = AI.InputMaxTokens["128k"];
		else if (0 === model.id.indexOf("gpt-4"))
			model.options.max_input_tokens = AI.InputMaxTokens["8k"];
		else if (-1 != model.id.indexOf("gpt-3.5-turbo-instruct")) {
			model.options.max_input_tokens = AI.InputMaxTokens["4k"];
			model.endpoints.push(AI.Endpoints.Types.v1.Completions);
			return AI.CapabilitiesUI.Chat;
		}
		else if (0 === model.id.indexOf("gpt-3.5-turbo"))
			model.options.max_input_tokens = AI.InputMaxTokens["16k"];

		model.endpoints.push(AI.Endpoints.Types.v1.Chat_Completions);
		return AI.CapabilitiesUI.Chat | AI.CapabilitiesUI.Vision;
	};

	getImageGeneration(message, model) {
		let result = super.getImageGeneration(message, model);
		result.size = result.width + "x" + result.height;
		delete result.width;
		delete result.height;
		return result;
	}

}
