"use strict";

class Provider extends AI.Provider {

	constructor() {
		super("ZhiPu", "https://open.bigmodel.cn/api/paas/v4", "");
	}

	getModels() {
		return [
			{"id":"glm-4","name":"glm-4","provider":"ZhiPu","endpoints":[AI.Endpoints.Types.v1.Chat_Completions],"options":{"max_input_tokens":8192}},
			{"id":"glm-4-0520","name":"glm-4-0520","provider":"ZhiPu","endpoints":[AI.Endpoints.Types.v1.Chat_Completions],"options":{}},
			{"id":"glm-4-air","name":"glm-4-air","provider":"ZhiPu","endpoints":[AI.Endpoints.Types.v1.Chat_Completions],"options":{}},
			{"id":"glm-4-airx","name":"glm-4-airx","provider":"ZhiPu","endpoints":[AI.Endpoints.Types.v1.Chat_Completions],"options":{}},
			{"id":"glm-4-flash","name":"glm-4-flash","provider":"ZhiPu","endpoints":[AI.Endpoints.Types.v1.Chat_Completions],"options":{}},
			{"id":"glm-4-plus","name":"glm-4-plus","provider":"ZhiPu","endpoints":[AI.Endpoints.Types.v1.Chat_Completions],"options":{}},
			{"id":"glm-4-long","name":"glm-4-long","provider":"ZhiPu","endpoints":[AI.Endpoints.Types.v1.Chat_Completions],"options":{}},
			{"id":"glm-4-alltools","name":"glm-4-alltools","provider":"ZhiPu","endpoints":[AI.Endpoints.Types.v1.Chat_Completions],"options":{}},
			{"id":"cogview-3","name":"cogview-3","provider":"ZhiPu","endpoints":[AI.Endpoints.Types.v1.Images_Generations],"options":{}}
		];
	}

	correctModelInfo(model) {
		model.id = model.name = model.id || model.name;
	}

	checkExcludeModel(model) {
		return false;
	}

	checkModelCapability(model) {
		if (model.id === "glm-4") {
			model.endpoints = [AI.Endpoints.Types.v1.Chat_Completions];
			return AI.CapabilitiesUI.Chat;
		} else if (model.id === "cogview-3") {
			model.endpoints = [AI.Endpoints.Types.v1.Images_Generations];
			return AI.CapabilitiesUI.Image;
		}
		return AI.CapabilitiesUI.All;
	}

	getRequestHeaderOptions() {
		return {
			"Authorization": `Bearer ${this.key}`,
			"Content-Type": "application/json"
		};
	}

	getChatCompletions(message, model) {
		const messages = message.messages.map(m => ({
			role: m.role,
			content: m.content
		}));

		const system = this.getSystemMessage(message, true);
		if (system) {
			messages.unshift({ role: "system", content: system });
		}

		return {
			model: model.id,
			messages,
			stream: false
		};
	}

	getChatCompletionsResult(message, model) {
		const result = { content: [] };
		const choices = message?.data?.choices;
		if (!choices || !choices[0]) return result;

		if (choices[0].message?.content) result.content.push(choices[0].message.content);
		else if (choices[0].delta?.content) result.content.push(choices[0].delta.content);

		return result;
	}

	getImageGeneration(message, model) {
		return {
			model: model.id,
			prompt: message.prompt
		};
	}

	async getImageGenerationResult(message, model) {
		const url = message?.data?.[0]?.url || message?.url;
		console.log("ZhiPu image URL:", url);
		return url || "";
	}
	
}