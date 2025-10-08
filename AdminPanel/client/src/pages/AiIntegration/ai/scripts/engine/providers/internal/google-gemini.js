/*
 * (c) Copyright Ascensio System SIA 2010-2025
 *
 * This program is a free software product. You can redistribute it and/or
 * modify it under the terms of the GNU Affero General Public License (AGPL)
 * version 3 as published by the Free Software Foundation. In accordance with
 * Section 7(a) of the GNU AGPL its Section 15 shall be amended to the effect
 * that Ascensio System SIA expressly excludes the warranty of non-infringement
 * of any third-party rights.
 *
 * This program is distributed WITHOUT ANY WARRANTY; without even the implied
 * warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR  PURPOSE. For
 * details, see the GNU AGPL at: http://www.gnu.org/licenses/agpl-3.0.html
 *
 * You can contact Ascensio System SIA at 20A-6 Ernesta Birznieka-Upish
 * street, Riga, Latvia, EU, LV-1050.
 *
 * The  interactive user interfaces in modified source and object code versions
 * of the Program must display Appropriate Legal Notices, as required under
 * Section 5 of the GNU AGPL version 3.
 *
 * Pursuant to Section 7(b) of the License you must retain the original Product
 * logo when distributing the program. Pursuant to Section 7(e) we decline to
 * grant you any rights under trademark law for use of our trademarks.
 *
 * All the Product's GUI elements, including illustrations and icon sets, as
 * well as technical writing content are licensed under the terms of the
 * Creative Commons Attribution-ShareAlike 4.0 International. See the License
 * terms at http://creativecommons.org/licenses/by-sa/4.0/legalcode
 *
 */

"use strict";

class Provider extends AI.Provider {

	constructor() {
		super("Google-Gemini", "https://generativelanguage.googleapis.com", "", "v1beta");
	}

	correctModelInfo(model) {
		model.id = model.name;
		let index = model.name.indexOf("models/");
		if (index === 0)
			model.name = model.name.substring(7);
	}

	checkExcludeModel(model) {
		if (model.id === "models/chat-bison-001" ||
			model.id === "models/text-bison-001")
			return true;
		
		if (-1 !== model.id.indexOf("gemini-1.0"))
			return true;

		return false;
	}

	checkModelCapability(model) {
		if (model.inputTokenLimit)
			model.options.max_input_tokens = model.inputTokenLimit;

		if (Array.isArray(model.supportedGenerationMethods) && 
			model.supportedGenerationMethods.includes("generateContent"))
		{
			model.endpoints.push(AI.Endpoints.Types.v1.Chat_Completions);
			let caps = AI.CapabilitiesUI.Chat;
			if (-1 !== model.id.indexOf("vision"))
				caps |= AI.CapabilitiesUI.Vision;
			
			return AI.CapabilitiesUI.Chat | AI.CapabilitiesUI.Vision;
		}

		if (Array.isArray(model.supportedGenerationMethods) && 
			model.supportedGenerationMethods.includes("embedContent"))
		{
			model.endpoints.push(AI.Endpoints.Types.v1.Embeddings);
			return AI.CapabilitiesUI.Embeddings;
		}

		return AI.CapabilitiesUI.All;
	}

	getEndpointUrl(endpoint, model, options) {
		let Types = AI.Endpoints.Types;
		let url = "";
		switch (endpoint)
		{
		case Types.v1.Models:
			url = "/models";
			break;
		default:
			let addon = ":generateContent";
			if (options && options.streaming) {
				addon = ":streamGenerateContent";
				options.streamingBody = false;
			}
			if (endpoint === Types.v1.Images_Generations) {
				if (-1 != model.id.indexOf("imagen-"))
					addon = ":predict";
			}
			url = "/" + model.id + addon;
			break;
		}
		if (this.key)
			url += "?key=" + this.key;
		return url;
	}

	getRequestHeaderOptions() {
		let headers = {
			"Content-Type" : "application/json"
		};
		return headers;
	}

	getChatCompletions(message, model) {
		let body = { contents : [] };
		for (let i = 0, len = message.messages.length; i < len; i++) {
			let rec = {
				role : message.messages[i].role,
				parts : [ { text : message.messages[i].content } ]
			};
			if (rec.role === "assistant")
				rec.role = "model";
			else if (rec.role === "system") {
				body.system_instruction = rec;
				continue;
			}
			body.contents.push(rec);
		}
		return body;
	}

	getImageGeneration(message, model) {
		if (-1 != model.id.indexOf("flash")) {
			let result = this.getImageGenerationWithChat(message, model);
			result.generationConfig = {"responseModalities":["TEXT","IMAGE"]};
			return result;
		}
		if (-1 != model.id.indexOf("imagen-")) {
			return {
				instances: [
					{
						prompt: message.prompt
					}
				],
				parameters: {
					"sampleCount": 1
				}
			};
		}

		return {};
	}

	async getImageVision(message, model) {
		return {
			contents : [
				{
					role: "user",
					parts: [
						{ text: message.prompt },
						{ 
							inline_data: {
								mime_type: AI.ImageEngine.getMimeTypeFromBase64(message.image),
								data: AI.ImageEngine.getContentFromBase64(message.image)
							}
						}
					]
				}
			]
		}		
	}

}
