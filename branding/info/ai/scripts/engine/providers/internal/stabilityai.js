"use strict";

class Provider extends AI.Provider {

	constructor() {
		super("Stability AI", "https://api.stability.ai", "", "");
	}

	getModels() {
		return [
			{
				id: "Stable Diffusion"
			},
			{
				id: "Stable Image Core"
			},
			{
				id: "Stable Image Ultra"
			}
		];
	}

	checkModelCapability(model) {
		model.endpoints.push(AI.Endpoints.Types.v1.Images_Generations);
		return AI.CapabilitiesUI.Image;		
	};

	getImageGeneration(message, model) {
		let formData = new FormData();
		formData.append("prompt", message.prompt);
		formData.append("output_format", "png");
		return formData;
	}

	getEndpointUrl(endpoint, model) {
		let Types = AI.Endpoints.Types;
		let url = "";
		switch (endpoint)
		{
		case Types.v1.Images_Generations:
			if (model.id === "Stable Diffusion")
				return "/v2beta/stable-image/generate/sd3";
			if (model.id === "Stable Image Core")
				return "/v2beta/stable-image/generate/core";
			if (model.id === "Stable Image Ultra")
				return "/v2beta/stable-image/generate/ultra";
			break;
		default:
			break;
		}

		return super.getEndpointUrl(endpoint, model);
	}

	getRequestHeaderOptions() {
		let headers = {
			"Accept": "application/json"
		};
		if (this.key)
			headers["Authorization"] = "Bearer " + this.key;
		return headers;
	}

}
