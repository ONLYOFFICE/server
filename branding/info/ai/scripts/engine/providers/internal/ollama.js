"use strict";

class Provider extends AI.Provider {

	constructor() {
		super("Ollama", "http://127.0.0.1:11434", "", "v1");
	}

	getImageGeneration(message, model) {
		let result = super.getImageGeneration(message, model);
		result.options = {};
		if (result.width)
			result.options.width = result.width;
		if (result.height)
			result.options.height = result.height;
		delete result.width;
		delete result.height;
		delete result.n;
		return result;
	}

}
