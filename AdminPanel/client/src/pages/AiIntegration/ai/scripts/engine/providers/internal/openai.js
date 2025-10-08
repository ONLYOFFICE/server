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
			0 === model.id.indexOf("gpt-4"))			
			model.options.max_input_tokens = AI.InputMaxTokens["128k"];		
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
