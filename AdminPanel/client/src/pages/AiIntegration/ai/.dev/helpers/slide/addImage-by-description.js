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

(function(){
	let func = new RegisteredFunction({
		"name": "addImageByDescription",
		"description": "Adds an image on the slide in the presentation",
		"parameters": {
			"type": "object",
			"properties": {
				"slideNumber": {
					"type": "number",
					"description": "the slide number to add generated image to",
					"minimum": 1
				},
				"description": {
					"type": "string",
					"description": "text description of the image to generate"
				},
				"width": {
					"type": "number",
					"description": "image width in mm"
				},
				"height": {
					"type": "number",
					"description": "image height in mm"
				},
				"style": {
					"type": "string",
					"description": "image style (realistic, cartoon, abstract, etc.)"
				}
			},
			"required": []
		},
		"examples": [
			{
				"prompt": "add an image of a sunset over mountains to slide 1",
				"arguments": { "slideNumber": 1, "description": "beautiful sunset over mountain range with orange and purple sky"}
			},
			{
				"prompt": "add a cartoon style image of office workers with custom size",
				"arguments": {"description": "team of diverse office workers collaborating around a table", "style": "cartoon" }
			}
		]
	});
	
	func.call = async function(params) {
		Asc.scope.params = params;
		Asc.scope.description = params.description;

		let widthMm = params.width || 100;
		let heightMm = params.height || 100;
		Asc.scope.width = widthMm * 36000;
		Asc.scope.height = heightMm * 36000;
		Asc.scope.style = params.style || "realistic";

		let widthPx = Math.round((widthMm / 25.4) * 96);
		let heightPx = Math.round((heightMm / 25.4) * 96);

		let requestEngine = null;
		requestEngine = AI.Request.create(AI.ActionType.ImageGeneration);
		if (!requestEngine) {
			return;
		}

		let fullPrompt = Asc.scope.description;
		if (Asc.scope.style && Asc.scope.style !== "realistic") {
			fullPrompt = Asc.scope.style + " style, " + fullPrompt;
		}

		fullPrompt += ", image size " + widthPx + "x" + heightPx + " pixels";

		let aspectRatio = widthPx / heightPx;
		if (aspectRatio > 1.8) {
			fullPrompt += ", wide panoramic format";
		}
		else if (aspectRatio < 0.6) {
			fullPrompt += ", tall vertical format";
		}
		else if (aspectRatio > 0.9 && aspectRatio < 1.1) {
			fullPrompt += ", square format";
		}

		let isSendedEndLongAction = false;

		async function checkEndAction() {
			if (!isSendedEndLongAction) {
				let actionName = "AI (" + requestEngine.modelUI.name + ")";
				await Asc.Editor.callMethod("EndAction", ["Block", actionName]);
				isSendedEndLongAction = true;
			}
		}

		let actionName = "AI (" + requestEngine.modelUI.name + ")";
		await Asc.Editor.callMethod("StartAction", ["Block", actionName]);
		await Asc.Editor.callMethod("StartAction", ["GroupActions"]);

		try {
			let imageUrl;
			imageUrl = await requestEngine.imageGenerationRequest(fullPrompt);

			await checkEndAction();

			if (imageUrl) {
				Asc.scope.imageUrl = imageUrl;
				await Asc.Editor.callCommand(function () {
					let oPresentation = Api.GetPresentation();
					let oSlide;
					if (params.slideNumber !== undefined && params.slideNumber !== null) {
						oSlide = oPresentation.GetSlideByIndex(params.slideNum - 1);
					}
					else {
						oSlide = oPresentation.GetCurrentSlide();
					}
					if (!oSlide) return;

					let slideWidth = oPresentation.GetWidth();
					let slideHeight = oPresentation.GetHeight();

					let x = (slideWidth - Asc.scope.width) / 2;
					let y = (slideHeight - Asc.scope.height) / 2;

					let oImage = Api.CreateImage(Asc.scope.imageUrl, Asc.scope.width, Asc.scope.height);
					oImage.SetPosition(x, y);
					oSlide.AddObject(oImage);
				});
			}
		} catch (error) {
			await checkEndAction();
		}

		await Asc.Editor.callMethod("EndAction", ["GroupActions"]);
	};

	return func;
})();
