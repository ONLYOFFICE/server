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
