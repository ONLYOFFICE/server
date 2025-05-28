(function(window, undefined)
{
	window.AI = window.AI || {};
	var AI = window.AI;

	if (!AI.isLocalDesktop)
		return;

	window.fetch = function(url, obj) {
		function TextResponse(text, isOk) {
			if (isOk)
				this.textResponse = text;
			else
				this.message = text;

			this.text = function() { return new Promise(function(resolve) {
				resolve(text)
			})};
			this.json = function() { return new Promise(function(resolve, reject) {
				try {
					resolve(JSON.parse(text));
				} catch (error) {
					reject(error);
				}
			})};
			this.ok = isOk;
		};

		return new Promise(function (resolve, reject) {
			var xhr = new XMLHttpRequest();
			xhr.open(obj.method, url, true);

			for (let h in obj.headers)
				if (obj.headers.hasOwnProperty(h))
					xhr.setRequestHeader(h, obj.headers[h]);

			xhr.onload = function() {
				if (this.status == 200 || this.status == 0)
					resolve(new TextResponse(this.response, true));
				else
					resolve(new TextResponse(this.response, false));
			};
			xhr.onerror = function() {
				reject(new TextResponse(this.response || "Failed to fetch.", false));
			};

			xhr.send(obj.body);
		});
	};
})(window);

(function(window, undefined)
{
	async function requestWrapper(message) {
		return new Promise(function (resolve, reject) {
			if (AI.isLocalDesktop && (AI.isLocalUrl(message.url) || message.isUseProxy)) {
				window.AscSimpleRequest.createRequest({
					url: message.url,
					method: message.method,
					headers: message.headers,
					body: message.isBlob ? message.body : (message.body ? JSON.stringify(message.body) : ""),
					complete: function(e, status) {
						let data = JSON.parse(e.responseText);
						resolve({error: 0, data: data.data ? data.data : data});
					},
					error: function(e, status, error) {
						if ( e.statusCode == -102 ) e.statusCode = 404;
						resolve({error: e.statusCode, message: "Internal error"});
					}
				});
			} else {
				let request = {
					method: message.method,
					headers: message.headers
				};
				if (request.method != "GET") {
					request.body = message.isBlob ? message.body : (message.body ? JSON.stringify(message.body) : "");

					if (message.isUseProxy) {
						request = {
							"method" : request.method,
							"body" : JSON.stringify({
								"target" : message.url,
								"method" : request.method,
								"headers" : request.headers,
								"data" : request.body
							})
						}
						message.url = AI.PROXY_URL;					
					}
				}				

				fetch(message.url, request)
					.then(function(response) {
						return response.json()
					})
					.then(function(data) {
						if (data.error)
							resolve({error: 1, message: data.error.message ? data.error.message : ((typeof data.error === "string") ? data.error : "")});
						else
							resolve({error: 0, data: data.data ? data.data : data});
					})
					.catch(function(error) {
						resolve({error: 1, message: error.message ? error.message : ""});                        
					});
			}
		});
	}

	AI.TmpProviderForModels = null;

	AI.PROXY_URL = "https://plugins-services.onlyoffice.com/proxy";

	AI._getHeaders = function(_provider) {
		let provider = _provider.createInstance ? _provider : AI.Storage.getProvider(_provider.name);
		if (!provider) provider = new AI.Provider();
		return provider.getRequestHeaderOptions();
	};

	AI._getModelsSync = function(_provider) {
		let provider = _provider.createInstance ? _provider : AI.Storage.getProvider(_provider.name);
		if (!provider) provider = new AI.Provider();
		return provider.getModels();
	};

	AI._extendBody = function(_provider, body) {
		let provider = _provider.createInstance ? _provider : AI.Storage.getProvider(_provider.name);
		if (!provider) provider = new AI.Provider();
		let bodyPr = provider.getRequestBodyOptions();

		if (provider.isUseProxy())
			bodyPr.target = provider.url;

		for (let i in bodyPr) {
			if (!body[i])
				body[i] = bodyPr[i];
		}

		return provider.isUseProxy();
	};

	AI._getEndpointUrl = function(_provider, endpoint, model) {
		let provider = _provider.createInstance ? _provider : AI.Storage.getProvider(_provider.name);
		if (!provider) provider = new AI.Provider(_provider.name, _provider.url, _provider.key);

		if (_provider.key)
			provider.key = _provider.key;

		let url = provider.url;
		if (url.endsWith("/"))
			url = url.substring(0, url.length - 1);
		if ("" !== provider.addon)
		{
			let plus = "/" + provider.addon;
			let pos = url.lastIndexOf(plus);
			if (pos === -1 || pos !== (url.length - plus.length))
				url += plus;
		}

		return url + provider.getEndpointUrl(endpoint, model);
	};

	AI.getModels = async function(provider)
	{
		AI.TmpProviderForModels = null;
		return new Promise(function (resolve, reject) {

			function resolveRequest(data) {
				if (data.error)
					resolve({
						error : 1,
						message : data.message,
						models : []
					});
				else {
					AI.TmpProviderForModels = AI.createProviderInstance(provider.name, provider.url, provider.key);
					let models = data.data;
					if (data.data.models)
						models = data.data.models;
					for (let i = 0, len = models.length; i < len; i++)
					{
						let model = models[i];
						AI.TmpProviderForModels.correctModelInfo(model);
						
						if (!model.id)
							continue;

						model.endpoints = [];
						model.options = {};						

						if (AI.TmpProviderForModels.checkExcludeModel(model))
							continue;

						let modelUI = new AI.UI.Model(model.name, model.id, 
							provider.name, AI.TmpProviderForModels.checkModelCapability(model));
						AI.TmpProviderForModels.models.push(model);
						AI.TmpProviderForModels.modelsUI.push(modelUI);
					}

					resolve({
						error : 0,
						message : "",
						models : AI.TmpProviderForModels.modelsUI
					});
				}
			}

			let syncModels = AI._getModelsSync(provider);
			if (Array.isArray(syncModels))
			{
				resolveRequest({
					error : 0,
					data : syncModels
				});
				return;
			}

			let headers = AI._getHeaders(provider);
			requestWrapper({
				url : AI._getEndpointUrl(provider, AI.Endpoints.Types.v1.Models),
				headers : headers,
				method : "GET"
			}).then(function(data) {
				resolveRequest(data);
			});
		});
	};

	AI.Request = function(model) {
		this.modelUI = model;
		this.model = null;
		this.errorHandler = null;

		if ("" !== model.provider) {
			let provider = null;
			for (let i in AI.Providers) {
				if (model.provider === AI.Providers[i].name) {
					provider = AI.Providers[i];
					break;
				}
			}

			if (provider) {
				for (let i = 0, len = provider.models.length; i < len; i++) {
					if (model.id === provider.models[i].id ||
						model.id === provider.models[i].name)
					{
						this.model = provider.models[i];
					}
				}
			}
		}
	};

	AI.Request.create = function(action) {
		let model = AI.Storage.getModelById(AI.Actions[action].model);
		if (!model) {
			onOpenSettingsModal();
			return null;
		}
		return new AI.Request(model);
	};

	AI.Request.prototype.setErrorHandler = function(callback) {
		this.errorHandler = callback;
	};

	AI.Request.prototype._wrapRequest = async function(func, data, block) {
		if (block)
			await Asc.Editor.callMethod("StartAction", ["Block", "AI (" + this.modelUI.name + ")"]);
		let result = undefined;
		try {
			result = await func.call(this, data);
		} catch (err) {
			if (err.error) {
				if (block)
					await Asc.Editor.callMethod("EndAction", ["Block", "AI (" + this.modelUI.name + ")"]);
				if (this.errorHandler)
					this.errorHandler(err);
				else {
					if (true) {
						await Asc.Library.SendError(err.message, -1);
					} else {
						// since 8.3.0!!!
						await Asc.Editor.callMethod("ShowError", [err.message, -1]);
					}
				}
				return;
			}
		}
		if (block)
			await Asc.Editor.callMethod("EndAction", ["Block", "AI (" + this.modelUI.name + ")"]);
		return result;
	};

	// CHAT REQUESTS
	AI.Request.prototype.chatRequest = async function(content, block) {
		return await this._wrapRequest(this._chatRequest, content, block !== false);
	};

	AI.Request.prototype._chatRequest = async function(content) {
		let provider = null;
		if (this.modelUI)
			provider = AI.Storage.getProvider(this.modelUI.provider);

		if (!provider) {
			throw { 
				error : 1, 
				message : "Please select the correct model for action." 
			};
			return;
		}

		let isUseCompletionsInsteadChat = false;
		if (this.model) {
			let isFoundChatCompletions = false;
			let isFoundCompletions = false;
			for (let i = 0, len = this.model.endpoints.length; i < len; i++) {
				if (this.model.endpoints[i] === AI.Endpoints.Types.v1.Chat_Completions) {
					isFoundChatCompletions = true;
					break;
				}
				if (this.model.endpoints[i] === AI.Endpoints.Types.v1.Completions) {
					isFoundCompletions = true;
					break;
				}
			}

			if (isFoundCompletions && !isFoundChatCompletions)
				isUseCompletionsInsteadChat = true;
		}

		let isNoSplit = false;
		let max_input_tokens = AI.InputMaxTokens["32k"];
		if (this.model && this.model.options && undefined !== this.model.options.max_input_tokens)
			max_input_tokens = this.model.options.max_input_tokens;

		let header_footer_overhead = 500;
		// for test chunks:
		if (false) {
			max_input_tokens = 50;
			let header_footer_overhead = 0;
		}

		if (max_input_tokens < header_footer_overhead)
			max_input_tokens = header_footer_overhead + 1000;

		let headers = AI._getHeaders(provider);

		let isMessages = Array.isArray(content);

		if (isUseCompletionsInsteadChat && isMessages) {
			content = content[content.length - 1].content;
			isMessages = false;
		}

		if (isMessages)
			isNoSplit = true;

		let input_len = content.length;
		let input_tokens = isMessages ? 0 : Asc.OpenAIEncode(content).length;
		
		let messages = [];
		if (input_tokens < max_input_tokens || isNoSplit) {
			messages.push(content);
		} else {
			let chunkLen = (((max_input_tokens - header_footer_overhead) / input_tokens) * input_len) >> 0;
			let currentLen = 0;
			while (currentLen != input_len) {
				let endSymbol = currentLen + chunkLen;
				if (endSymbol >= input_len)
					endSymbol = undefined;
				messages.push(content.substring(currentLen, endSymbol));
				if (undefined === endSymbol)
					currentLen = input_len;
				else
					currentLen = endSymbol;
			}
		}

		let objRequest = {
			headers : headers,
			method : "POST"
		};

		let endpointType = isUseCompletionsInsteadChat ? AI.Endpoints.Types.v1.Completions :
			AI.Endpoints.Types.v1.Chat_Completions;
		objRequest.url = AI._getEndpointUrl(provider, endpointType, this.model);

		let requestBody = {};
		let model = this.model;
		let processResult = function(data) {
			let result = provider.getChatCompletionsResult(data, model);
			if (result.content.length === 0)
				return "";

			if (0 === result.content[0].indexOf("<think>")) {
				let end = result.content[0].indexOf("</think>");
				if (end !== -1)
					result.content[0] = result.content[0].substring(end + 8);
			}

			return result.content[0];
		};

		if (1 === messages.length) {
			if (!isUseCompletionsInsteadChat) {
				if (isMessages)
					requestBody.messages = messages[0];
				else
					requestBody.messages = [{role:"user",content:messages[0]}];
				objRequest.body = provider.getChatCompletions(requestBody, this.model);
			} else {
				objRequest.body = provider.getCompletions({ text : messages[0] });
			}

			objRequest.isUseProxy = AI._extendBody(provider, objRequest.body);

			let result = await requestWrapper(objRequest);
			if (result.error) {
				throw {
					error : result.error, 
					message : result.message
				};
				return;
			} else {
				return processResult(result);
			}

		} else {

			let lastFooterForOldModels = "";
			let indexTask = content.indexOf(": \"");
			if (-1 != indexTask && indexTask < 100) {
				lastFooterForOldModels = content.substring(0, indexTask);
			}

			function getHeader(part, partsCount) {
				let header = "[START PART " + part + "/" + partsCount + "]\n";
				if (part != partsCount) {
					header = "Do not answer yet. This is just another part of the text I want to send you. Just receive and acknowledge as \"Part " + part + "/" + partsCount + " received\" and wait for the next part.\n" + header;
				}
				return header;
			}

			function getFooter(part, partsCount) {
				let footer = "\n[END PART " + part + "/" + partsCount + "]\n";
				if (part != partsCount) {
					footer += "Remember not answering yet. Just acknowledge you received this part with the message \"Part " + part + "/" + partsCount + " received\" and wait for the next part.";
				} else {
					footer += "ALL PARTS SENT. Now you can continue processing the request." + lastFooterForOldModels;
				}
				return footer;
			}

			for (let i = 0, len = messages.length; i < len; i++) {
				
				let message = getHeader(i + 1, len) + messages[i] + getFooter(i + 1, len);
				if (!isUseCompletionsInsteadChat) {
					objRequest.body = provider.getChatCompletions({ messages : [{role:"user",content:message}] });
				} else {
					objRequest.body = provider.getCompletions( { text : message });
				}

				objRequest.isUseProxy = AI._extendBody(provider, objRequest.body);

				let result = await requestWrapper(objRequest);
				if (result.error) {
					throw {
						error : result.error, 
						message : result.message
					};
					return;
				} else if (i === (len - 1)) {
					return processResult(result);
				}

			}
		}
	};

	// IMAGE REQUESTS
	AI.Request.prototype.imageGenerationRequest = async function(data, block) {
		return await this._wrapRequest(this._imageGenerationRequest, data, block !== false);
	};

	AI.Request.prototype._imageGenerationRequest = async function(data) {
		let provider = null;
		if (this.modelUI)
			provider = AI.Storage.getProvider(this.modelUI.provider);

		if (!provider) {
			throw { 
				error : 1, 
				message : "Please select the correct model for action." 
			};
			return;
		}

		let message = {
			prompt : data
		};

		let objRequest = {
			headers : AI._getHeaders(provider),
			method : "POST",
			url : AI._getEndpointUrl(provider, AI.Endpoints.Types.v1.Images_Generations, this.model),
			body : provider.getImageGeneration(message, this.model)
		};

		if (objRequest.body instanceof FormData)
			objRequest.isBlob = true;

		let requestBody = {};
		let model = this.model;
		let processResult = function(data) {
			return provider.getImageGenerationResult(data, model);			
		};

		objRequest.isUseProxy = AI._extendBody(provider, objRequest.body);

		let result = await requestWrapper(objRequest);
		if (result.error) {
			throw {
				error : result.error, 
				message : result.message
			};
			return;
		}
		if (result.data && result.data.errors) {
			throw {
				error : 1, 
				message : result.data.errors[0]
			};
			return;
		}
		return processResult(result);
	};

	AI.Request.prototype.imageVisionRequest = async function(data, block) {
		return await this._wrapRequest(this._imageVisionRequest, data, block !== false);
	};

	AI.Request.prototype._imageVisionRequest = async function(data) {
		let provider = null;
		if (this.modelUI)
			provider = AI.Storage.getProvider(this.modelUI.provider);

		if (!provider) {
			throw { 
				error : 1, 
				message : "Please select the correct model for action." 
			};
			return;
		}

		let message = {
			prompt : data.prompt,
			image : await AI.ImageEngine.getBase64FromAny(data.image)
		};

		let objRequest = {
			headers : AI._getHeaders(provider),
			method : "POST",
			url : AI._getEndpointUrl(provider, AI.Endpoints.Types.v1.Chat_Completions, this.model),
			body : await provider.getImageVision(message, this.model)
		};

		if (objRequest.body instanceof FormData)
			objRequest.isBlob = true;

		let requestBody = {};
		let model = this.model;
		let processResult = function(data) {
			return provider.getImageVisionResult(data, model);
		};

		objRequest.isUseProxy = AI._extendBody(provider, objRequest.body);

		let result = await requestWrapper(objRequest);
		if (result.error) {
			throw {
				error : result.error, 
				message : result.message
			};
			return;
		}
		if (result.data && result.data.errors) {
			throw {
				error : 1, 
				message : result.data.errors[0]
			};
			return;
		}
		return processResult(result);
	};

	AI.Request.prototype.imageOCRRequest = async function(data, block) {
		return await this._wrapRequest(this._imageOCRRequest, data, block !== false);
	};

	AI.Request.prototype._imageOCRRequest = async function(data) {
		let provider = null;
		if (this.modelUI)
			provider = AI.Storage.getProvider(this.modelUI.provider);

		if (!provider) {
			throw { 
				error : 1, 
				message : "Please select the correct model for action." 
			};
			return;
		}

		let message = {
			image : await AI.ImageEngine.getBase64FromAny(data)
		};

		let objRequest = {
			headers : AI._getHeaders(provider),
			method : "POST",
			url : AI._getEndpointUrl(provider, AI.Endpoints.Types.v1.OCR, this.model),
			body : await provider.getImageOCR(message, this.model)
		};

		if (objRequest.body instanceof FormData)
			objRequest.isBlob = true;

		let requestBody = {};
		let model = this.model;
		let processResult = function(data) {
			return provider.getImageOCRResult(data, model);
		};

		objRequest.isUseProxy = AI._extendBody(provider, objRequest.body);

		let result = await requestWrapper(objRequest);
		if (result.error) {
			throw {
				error : result.error, 
				message : result.message
			};
			return;
		}
		if (result.data && result.data.errors) {
			throw {
				error : 1, 
				message : result.data.errors[0]
			};
			return;
		}
		return processResult(result);
	};
	
	AI.ImageEngine = {};

	AI.ImageEngine.getNearestImageSize = function(w, h, sizes) {
		if (!sizes) {
			return {
				w : sizes[i].w,
				h : sizes[i].h
			};
		}

		let dist = 100000;
		let index = 0;

		for (let i = 0, len = sizes.length; i < len; i++) {
			let tmpDist = Math.abs(w - sizes[i].w) + Math.abs(h - sizes[i].h);
			if (tmpDist < dist) {
				dist = tmpDist;
				index = i;
			}
		}

		return {
			w : sizes[i].w,
			h : sizes[i].h
		};
	};

	AI.ImageEngine.getNearestImage = async function(input, sizes) {
		let canvas = document.createElement('canvas');
		if (input instanceof HTMLImageElement || input instanceof HTMLCanvasElement) {
			let dstSize = AI.ImageEngine.getNearestImageSize(input.width, input.height, sizes);
			canvas.width  = dstSize.w;
			canvas.height = dstSize.h;
			canvas.getContext('2d').drawImage(input, 0, 0, canvas.width, canvas.height);
			return canvas;
		}
		if (image instanceof String) {
			return new Promise(function(resolve) {
				let image = new Image();
				image.onload = function() {
					resolve(AI.ImageEngine.getNearestImage(image, sizes));
				};
				image.onerror = function() {
					return resolve(null);
				};
				image.src = input;
			});
		}
		return null;
	};

	AI.ImageEngine.getBlob = async function(canvas) {
		return new Promise(function(resolve) {
			var canvas_size = {
				width: canvas.width,
				height: canvas.height,
				str: canvas.width + "x" + canvas.height
			};
			canvas.toBlob(function(blob) {resolve({blob, size: canvas_size})}, 'image/png');
		});
	};

	AI.ImageEngine.getBase64 = function(canvas) {
		return canvas.toDataURL("image/png");
	};

	AI.ImageEngine.getBase64FromAny = async function(image) {
		if (image instanceof HTMLImageElement) {
			let canvas = document.createElement('canvas');
			canvas.width = image.width;
			canvas.height = image.height;
			canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
			return canvas.toDataURL("image/png");
		} 
		if (image instanceof HTMLCanvasElement) {
			return canvas.toDataURL("image/png");
		}
		if (image.startsWith("data:image"))
			return image;
		
		let canvas = await AI.ImageEngine.getNearestImage(image);
		if (!canvas)
			return "";

		return AI.ImageEngine.getBase64(canvas);
	};

	AI.ImageEngine.getBase64FromUrl = async function(url) {
		if (url.startsWith("data:image"))
			return url;

		if (url.startsWith("iVBOR"))
			return "data:image/png;base64," + url;

		if (url.startsWith("/9j/"))
			return "data:image/jpeg;base64," + url;

		let canvas = await AI.ImageEngine.getNearestImage(url);
		if (!canvas)
			return "";

		return AI.ImageEngine.getBase64(canvas);
	};

	AI.ImageEngine.getMimeTypeFromBase64 = async function(url) {
		let index = url.indexOf(";");
		return url.substring(5, index);
	};

	AI.ImageEngine.getContentFromBase64 = async function(url) {
		let index = url.indexOf(",");
		return url.substring(index + 1);
	};

})(window);
