"use strict";

class Provider extends AI.Provider {

	constructor() {
		super("Mistral", "https://api.mistral.ai", "", "v1");
	}

	checkModelCapability = function(model) {
		if (-1 !== model.id.indexOf("mistral-embed"))
		{
			model.options.max_input_tokens = AI.InputMaxTokens["8k"];
			model.endpoints.push(AI.Endpoints.Types.v1.Embeddings);
			return AI.CapabilitiesUI.Embeddings;
		}
		if (-1 !== model.id.indexOf("mistral-moderation"))
		{
			model.options.max_input_tokens = AI.InputMaxTokens["8k"];
			model.endpoints.push(AI.Endpoints.Types.v1.Moderations);
			return AI.CapabilitiesUI.Moderations;
		}
		if (-1 !== model.id.indexOf("pixtral"))
		{
			model.options.max_input_tokens = AI.InputMaxTokens["128k"];
			model.endpoints.push(AI.Endpoints.Types.v1.Images_Generations);
			model.endpoints.push(AI.Endpoints.Types.v1.Images_Edits);
			model.endpoints.push(AI.Endpoints.Types.v1.Images_Variarions);
			return AI.CapabilitiesUI.Image;
		}
		if (-1 !== model.id.indexOf("mistral-small"))
		{
			model.options.max_input_tokens = AI.InputMaxTokens["32k"];
			model.endpoints.push(AI.Endpoints.Types.v1.Chat_Completions);
			return AI.CapabilitiesUI.Chat;
		}
		if (-1 !== model.id.indexOf("mistral-medium"))
		{
			model.options.max_input_tokens = AI.InputMaxTokens["32k"];
			model.endpoints.push(AI.Endpoints.Types.v1.Chat_Completions);
			return AI.CapabilitiesUI.Chat;
		}
		if (-1 !== model.id.indexOf("codestral"))
		{
			model.options.max_input_tokens = AI.InputMaxTokens["256k"];
			model.endpoints.push(AI.Endpoints.Types.v1.Code);
			return AI.CapabilitiesUI.Code | AI.CapabilitiesUI.Chat;
		}

		model.options.max_input_tokens = AI.InputMaxTokens["128k"];
		model.endpoints.push(AI.Endpoints.Types.v1.Chat_Completions);

		let capUI = AI.CapabilitiesUI.Chat;
		if (model.capabilities && model.capabilities.vision)
			capUI = AI.CapabilitiesUI.Vision;
		return capUI;
	}

	getEndpointUrl(endpoint, model) {
		let Types = AI.Endpoints.Types;
		let url = "";
		switch (endpoint)
		{
		case Types.v1.OCR:
			url = "/ocr";
			break;
		default:
			break;
		}
		if (!url)
			return super.getEndpointUrl(endpoint, model);
		return url;
	}

	async getImageOCR(message, model) {
		let result = {
			model: model.id,
			document: {
				type: "image_url",
				image_url: message.image
			}
		};
		//result.output_format = "markdown";
		result.include_image_base64 = true;
		return result;
	}

	getImageOCRResult(messageInput, model) {
		let message = messageInput.data ? messageInput.data : messageInput;
		let images = [];
		let markdownContent = "";
		if (!message.pages)
			return markdownContent;

		for (let i = 0, len = message.pages.length; i < len; i++) {
			let page = message.pages[i];

			let images = page.images;
			let md = page.markdown;

			for (let j = 0, imagesCount = images.length; j < imagesCount; j++) {
				let src = "](" + images[j].id + ")";
				let dst = "](" + images[j].image_base64 + ")";

				src = src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
				md = md.replace(new RegExp(src, "g"), dst);
			}

			markdownContent += md;
			markdownContent += "\n\n";
		}
		
		return markdownContent;
	}

}
