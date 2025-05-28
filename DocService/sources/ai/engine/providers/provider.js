"use strict";

(async function(){

	class Provider {
		/**
		 * Provider base class.
		 * @param {string} name  Provider name.
		 * @param {string} url   Url to service.
		 * @param {string} key   Key for service. This is an optional field. Some providers may require a key for access.
		 * @param {string} addon Addon for url. For example: v1 for many providers. 
		 */
		constructor(name, url, key, addon) {
			this.name  = name  || "";
			this.url   = url   || "";
			this.key   = key   || "";
			this.addon = addon || "";
	
			this.models = [];
			this.modelsUI = [];
		}

		/**
		 * If you add an implementation here, then no request will be made to the service.
		 * @returns {Object[] | undefined}
		 */
		getModels() {
			return undefined;
		}

		/**
		 * Correct received (*models* endpoint) model object.
		 */
		correctModelInfo(model) {
			if (undefined === model.id && model.name) {
				model.id = model.name;
				return;
			}
			model.name = model.id;
		}
	
		/**
		 * Return *true* if you do not want to work with a specific model (model.id). 
		 * The model will not be presented in the combo box with the list of models.
		 * @returns {boolean}
		 */
		checkExcludeModel(model) {
			return false;
		}
	
		/**
		 * Return enumeration with capabilities for this model (model.id). (Some providers does not get the information for this functionalities).
		 * Example: AI.CapabilitiesUI.Chat | AI.CapabilitiesUI.Image;
		 * @returns {number}
		 */
		checkModelCapability(model) {
			return AI.CapabilitiesUI.All;
		}
	
		/**
		 * Url for a specific endpoint.
		 * @returns {string}
		 */
		getEndpointUrl(endpoint, model) {
			let Types = AI.Endpoints.Types;
			switch (endpoint)
			{
			case Types.v1.Models:
				return "/models";

			case Types.v1.Chat_Completions:
				return "/chat/completions";
			case Types.v1.Completions:
				return "/completions";

			case Types.v1.Images_Generations:
				return "/images/generations";
			case Types.v1.Images_Edits:
				return "/images/edits";
			case Types.v1.Images_Variarions:
				return "/images/variations";

			case Types.v1.Embeddings:
				return "/embeddings";

			case Types.v1.Audio_Transcriptions:
				return "/audio/transcriptions";
			case Types.v1.Audio_Translations:
				return "/audio/translations";
			case Types.v1.Audio_Speech:
				return "/audio/speech";

			case Types.v1.Moderations:
				return "/moderations";

			case Types.v1.Language:
				return "/completions";
			case Types.v1.Code:
				return "/completions";

			case Types.v1.Realtime:
				return "/realtime";

			case Types.v1.OCR:
				return "/chat/completions";

			default:
				break;
			}

			return "";
		}
	
		/**
		 * An object-addition to the model. It is used, among other things, to configure the model parameters.
		 * Don't override this method unless you know what you're doing.
		 * @returns {Object}
		 */
		getRequestBodyOptions() {
			return {};
		}

		/**
		 * The returned object is an enumeration of all the headers for the requests.
		 * @returns {Object}
		 */
		getRequestHeaderOptions() {
			let headers = {
				"Content-Type" : "application/json"
			};
			if (this.key)
				headers["Authorization"] = "Bearer " + this.key;
			return headers;
		}
		
		/**
		 * This method returns whether a proxy server needs to be used to work with this provider.
		 * Don't override this method unless you know what you're doing.
		 * @returns {boolean}
		 */
		isUseProxy() {
			return false;
		}
	
		/**
		 * This method returns whether this provider is only supported in the desktop application.
		 * Don't override this method unless you know what you're doing.
		 * @returns {boolean}
		 */
		isOnlyDesktop() {
			return false;
		}

		/**
		 * Get request body object by message.
		 * @param {Object} message 
		 * *message* is in folowing format:
		 * {
		 *     messages: [
		 *         { role: "developer", content: "You are a helpful assistant." },
		 *         { role: "system", content: "You are a helpful assistant." },
		 *         { role: "user", content: "Hello" },
		 *         { role: "assistant", content: "Hey!" },
		 *         { role: "user", content: "Hello" },
		 *         { role: "assistant", content: "Hey again!" }
		 *     ]
		 * }
		 */
		getChatCompletions(message, model) {
			return {
				model : model.id,
				messages : message.messages
			}
		}

		/**
		 * Get request body object by message.
		 * @param {Object} message 
		 * *message* is in folowing format:
		 * {
		 *     text: "Please, calculate 2+2."
		 * }
		 */
		getCompletions(message, model) {
			return {
				model : model.id,
				prompt : message.text
			}
		}

		/**
		 * Convert *getChatCompletions* and *getCompletions* answer to result simple message.
		 * @returns {Object} result 
		 * *result* is in folowing format:
		 * {
		 *     content: ["Hello", "Hi"]
		 * }
		 */
		getChatCompletionsResult(message, model) {
			let result = {
				content : []
			};

			let arrResult = message.data.choices || message.data.content || message.data.candidates;
			if (!arrResult)
				return result;

			let choice = arrResult[0];
			if (!choice)
				return result;
			
			if (choice.message && choice.message.content)
				result.content.push(choice.message.content);
			if (choice.text)
				result.content.push(choice.text);
			if (choice.content) {
				if (typeof(choice.content) === "string")
					result.content.push(choice.content);
				else if (Array.isArray(choice.content.parts)) {
					for (let i = 0, len = choice.content.parts.length; i < len; i++) {
						result.content.push(choice.content.parts[i].text);
					}
				}
			}

			let trimArray = ["\n".charCodeAt(0)];
			for (let i = 0, len = result.content.length; i < len; i++) {
				let iEnd = result.content[i].length - 1;
				let iStart = 0;
				while (iStart < iEnd && trimArray.includes(result.content[i].charCodeAt(iStart)))
					iStart++;
				while (iEnd > iStart && trimArray.includes(result.content[i].charCodeAt(iEnd)))
					iEnd--;

				if (iEnd > iStart && ((0 !== iStart) || ((result.content[i].length - 1) !== iEnd)))
					result.content[i] = result.content[i].substring(iStart, iEnd + 1);
			}

			return result;
		}

		/**
		 * Get available sizes for input images.
		 * @returns {Array.<Object>} sizes 
		 */
		getImageSizesInput(model) {
			return [
				{ w: 256, h: 256 },
				{ w: 512, h: 512 },
				{ w: 1024, h: 1024 }
			];
		}

		/**
		 * Get available sizes for outpit images.
		 * @returns {Array.<Object>} sizes 
		 */
		getImageSizesOutput(model) {
			return [
				{ w: 256, h: 256 },
				{ w: 512, h: 512 },
				{ w: 1024, h: 1024 }
			];
		}

		/**
		 * Get request body object by message.
		 * @param {Object} message 
		 * *message* is in folowing format:
		 * {
		 *     prompt: "",
		 *     width:1024,
		 *     height:1024,
		 *     background: "transparent",
		 *     quality: "high"
		 * }
		 */
		getImageGeneration(message, model) {
			let sizes = this.getImageSizesOutput(model);
			let index = sizes.length - 1;

			return {
				model : model.id,
				width : message.width || sizes[index].w,
				height : message.width || sizes[index].h,
				n : 1,
				response_format : "b64_json",
				prompt : message.prompt
			};
		}

		/**
		 * Convert *getImageGeneration* answer to result base64 image.
		 * @returns {String} Image in base64 format 
		 */
		async getImageGenerationResult(message, model) {
			let imageUrl = "";
			let getProp = function(name) {
				if (message[name])
					return message[name];
				if (message.data && message.data[name])
					return message.data[name];
				return undefined;
			};

			if (!imageUrl) {
				let data = getProp("data");
				if (data && data[0] && data[0].b64_json)
					imageUrl = data[0].b64_json;
			}

			if (!imageUrl) {
				let artifacts = getProp("artifacts");
				if (artifacts && artifacts[0] && artifacts[0].base64)
					imageUrl = artifacts[0].base64;
			}

			if (!imageUrl) {
				let result = getProp("result");
				if (result && result.imageUrl)
					imageUrl = result.imageUrl;
			}

			if (!imageUrl) {
				let generations = getProp("generations");
				if (generations && generations[0] && generations[0].url)
					imageUrl = generations[0].url;
			}

			if (!imageUrl) {
				let candidates = getProp("candidates");
				if (candidates && candidates[0] && candidates[0].content)
					imageUrl = candidates[0].content;
			}

			if (!imageUrl) {
				let image = getProp("image");
				if (image)
					imageUrl = image;
			}

			if (!imageUrl) {
				let response = getProp("response");
				if (response) {
					let matches = response.match(/data:image\/[^;]+;base64,([^"'\s]+)/);
					if (matches && matches[1])
						imageUrl = matches[1];
				}
			}

			if (!imageUrl) {
				let content = getProp("content");
				if (content) {
					for (let i = 0, len = content.length; i < len; i++) {
						if (content[i].type === 'text') {
							let svgMatch = content[i].text.match(/<svg[\s\S]*?<\/svg>/);
							if (svgMatch) {
								imageUrl = svgMatch[0];
								break;
							}
						}
					}
				}

				if (imageUrl) {
					imageUrl = "data:image/svg+xml;base64," + btoa(imageUrl);
				}
			}
			
			if (!imageUrl)
				return "";

			return await AI.ImageEngine.getBase64FromUrl(imageUrl);
		}

		/**
		 * Get request body object by message.
		 * @param {Object} message 
		 * *message* is in folowing format:
		 * {
		 *     image: "base64...",
		 *     prompt: "text"
		 * }
		 */
		async getImageVision(message, model) {
			return {
				model : model.id,
				messages : [
					{
						role: "user",
						content: [
							{							
								type: "text",
								text: message.prompt
							},
							{
								type: "image_url", 
								image_url: {
									url: message.image
								}
							}
						]
					}
				]
			}
		}

		getImageVisionResult(message, model) {
			let result = this.getChatCompletionsResult(message, model);

			if (result.content.length === 0)
				return "";

			if (0 === result.content[0].indexOf("<think>")) {
				let end = result.content[0].indexOf("</think>");
				if (end !== -1)
					result.content[0] = result.content[0].substring(end + 8);
			}

			return result.content[0];

		}

		/**
		 * Get request body object by message.
		 * @param {Object} message 
		 * *message* is in folowing format:
		 * {
		 *     image: "base64..."
		 * }
		 */
		async getImageOCR(message, model) {
			return await this.getImageVision({
				image : message.image,
				prompt : Asc.Prompts.getImagePromptOCR()
			}, model);
		}

		getImageOCRResult(message, model) {
			return this.getImageVisionResult(message, model);
		}

		/**
		 * ========================================================================================
		 * The following are methods for internal work. There is no need to overload these methods.
		 * ========================================================================================
		 */	
		createInstance(name, url, key, addon) {
			//let inst   = Object.create(Object.getPrototypeOf(this));
			let inst   = new this.constructor();
			inst.name  = name;
			inst.url   = url;
			inst.key   = key;
			inst.addon = addon || "";
			return inst;
		}

		checkModelsUI() {
			for (let i = 0, len = this.models.length; i < len; i++) {
				let model = this.models[i];
				let modelUI = new window.AI.UI.Model(model.name, model.id, model.provider);
				modelUI.capabilities = this.checkModelCapability(model);
				this.modelsUI.push(modelUI);
			}
		}

		getSystemMessage(message, isRemove) {
			let messages = message.messages;
			let isFound = false;
			if (!messages)
				return "";
			let result = "";
			for (let i = 0; i < messages.length; ++i) {
				if (messages[i].role === "system") {
					if (isFound) {
						messages.splice(i, 1);
					} else {
						isFound = true;
						result = messages[i].content;
						if (isRemove === true) {
							messages.splice(i, 1);
						}
					}
				}
			}
			return result;
		}

		getImageGenerationWithChat(message, model, addon) {
			let prompt = "Please generate image. ";
			if (addon)
				prompt += addon;
			// TODO: sizes
			prompt += "Here is the description for the image content:\"";
			prompt += message.prompt;
			prompt += "\"";
		
			let data = {
				messages : [
					{
						role: "user",
						content: prompt
					}
				]
			};

			return this.getChatCompletions(data, model);
		}

		getImageVisionWithChat(message, model) {
			let prompt = "Please generate image. ";
			if (addon)
				prompt += addon;
		
			let data = {
				messages : [
					{
						role: "user",
						content: message.prompt
					}
				]
			};

			return this.getChatCompletions(data, model);
		}

	}
	
	window.AI.Provider = Provider;
	await AI.loadInternalProviders();	
	
})();
