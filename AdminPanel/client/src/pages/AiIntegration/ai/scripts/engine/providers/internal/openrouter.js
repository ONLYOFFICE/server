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
		super("OpenRouter", "https://openrouter.ai/api", "", "v1");
	}

	checkModelCapability(model) {
		if (!model.architecture) {
			model.endpoints.push(AI.Endpoints.Types.v1.Chat_Completions);
			return AI.CapabilitiesUI.Chat; 
		}

		const input = model.architecture.input_modalities || [];
  		const output = model.architecture.output_modalities || [];
  		const modality = model.architecture.modality || "";
  		const context_length = model.context_length || 0;
		
		const modIn = modality.split("->")[0].split("+");
  		const modOut = modality.split("->")[1].split("+");

		let capabilitiesUI = 0;

		let inputText = modIn.includes("text");
		let inputImage = modIn.includes("image");
		let inputAudio = modIn.includes("audio");
		let inputEmbedding = modIn.includes("embedding");

		let outText = modOut.includes("text");
		let outImage = modOut.includes("image");
		let outAudio = modOut.includes("audio");
		let outEmbedding = modOut.includes("embedding");

		model.options.max_input_tokens = context_length || AI.InputMaxTokens["128k"];

		if (inputEmbedding || outEmbedding) {
			model.endpoints.push(AI.Endpoints.Types.v1.Embeddings);
			capabilitiesUI |= AI.CapabilitiesUI.Embeddings;
			return;
		}

		let isChat = false;
		let isImageGen = false;
		let isImageEdit = false;
		let isVision = false;
		let isAudio = false;		

		if (outText) {
			if (inputText || inputImage || inputAudio) {
				model.endpoints.push(AI.Endpoints.Types.v1.Chat_Completions);
				capabilitiesUI |= AI.CapabilitiesUI.Chat;
			}
			if (inputImage) {
				capabilitiesUI |= AI.CapabilitiesUI.Vision;
			}
			if (inputAudio) {
				capabilitiesUI |= AI.CapabilitiesUI.Audio;
			}
		}

		if (outImage) {
			if (inputText) {
				model.endpoints.push(AI.Endpoints.Types.v1.Chat_Completions);
				capabilitiesUI |= AI.CapabilitiesUI.Vision;
			}
			if (inputImage) {
				model.endpoints.push(AI.Endpoints.Types.v1.Images_Generations);
				capabilitiesUI |= AI.CapabilitiesUI.Image;
			}
		}

		if (isChat || isVision) {
			model.endpoints.push(AI.Endpoints.Types.v1.Chat_Completions);
			capabilitiesUI |= AI.CapabilitiesUI.Chat;
			if (isVision)
				capabilitiesUI |= AI.CapabilitiesUI.Vision;			
		}
		if (isImageGen) {
			model.endpoints.push(AI.Endpoints.Types.v1.Images_Generations);
			capabilitiesUI |= AI.CapabilitiesUI.Image;
		}
		if (isImageEdit) {
			model.endpoints.push(AI.Endpoints.Types.v1.Images_Edits);
			model.endpoints.push(AI.Endpoints.Types.v1.Images_Variarions);
			capabilitiesUI |= AI.CapabilitiesUI.Image;
		}
		if (isVision) {
			model.endpoints.push(AI.Endpoints.Types.v1.Vision_Chat);
			capabilitiesUI |= AI.CapabilitiesUI.Vision;
		}
		if (isAudio) {
			model.endpoints.push(AI.Endpoints.Types.v1.Audio_Speech);
			model.endpoints.push(AI.Endpoints.Types.v1.Audio_Transcriptions);
			model.endpoints.push(AI.Endpoints.Types.v1.Audio_Translations);
			capabilitiesUI |= AI.CapabilitiesUI.Audio;
		}

		return capabilitiesUI;
	};

}
