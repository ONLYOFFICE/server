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
		"name": "addTextToPlaceholder",
		"description": "Universal function for adding ANY text content to slides. Use this for ALL text addition requests: recipes, lists, instructions, notes, ideas, or any other text content.",
		"parameters": {
			"type": "object",
			"properties": {
				"slideNumber": {
					"type": "number",
					"description": "the slide number to add text to (optional, default current slide)",
					"minimum": 1
				},
				"text": {
					"type": "string",
					"description": "ANY text content to add - recipes, lists, instructions, notes, ideas, descriptions, stories, data, or whatever user asks to add"
				},
				"textType": {
					"type": "string",
					"description": "type of text - 'body', 'chart', 'clipArt', 'ctrTitle', 'diagram', 'date', 'footer', 'header', 'media', 'object', 'picture', 'sldImage', 'sldNumber', 'subTitle', 'table', 'title' (optional, default 'body')"
				},
				"prompt": {
					"type": "string",
					"description": "AI instructions for text enhancement or generation (optional)"
				}
			},
			"required": []
		},
		"examples": [
			{
				"prompt": "add [anything] or write [anything] or create text about [anything]'",
				"arguments": {"text": "[generated or specified content]", "textType": "body"}
			},
			{
				"prompt": "add recipe for coffee or just recipe for coffee",
				"arguments": {"text": "Coffee Recipe:\\n1. Grind coffee beans\\n2. Heat water to 95°C\\n3. Pour water over coffee\\n4. Wait 4 minutes\\n5. Enjoy", "textType": "body"}
			},
			{
				"prompt": "generate content",
				"arguments": {"text": "Topic", "textType": "body", "prompt": "generate detailed content about this topic"}
			}
		]
	});
	
	func.call = async function (params) {
		Asc.scope.slideNum = params.slideNumber;
		Asc.scope.text = params.text;
		Asc.scope.textType = params.textType || "body";
		Asc.scope.prompt = params.prompt;

		await Asc.Editor.callCommand(function () {
			let presentation = Api.GetPresentation();
			let slide;

			if (Asc.scope.slideNum) {
				slide = presentation.GetSlideByIndex(Asc.scope.slideNum - 1);
			}
			else {
				slide = presentation.GetCurrentSlide();
			}

			if (!slide) return;

			const placeholderGroups = {
				titles: ['title', 'ctrTitle'],
				subTitles: ['subTitle'],
				content: ['body', 'object', 'unknown'],
				media: ['picture', 'chart', 'media', 'clipArt', 'diagram', 'sldImage', 'table'],
				footer: ['footer', 'date', 'sldNumber', 'header']
			};

			function findPlaceholderGroup(type) {
				for (let groupName in placeholderGroups) {
					if (placeholderGroups[groupName].includes(type)) {
						return placeholderGroups[groupName];
					}
				}
				return [type];
			}

			function findShapeByPlaceholderType(slide, placeholderTypes) {
				let allDrawings = slide.GetAllDrawings();

				for (let type of placeholderTypes) {
					for (let i = 0; i < allDrawings.length; i++) {
						let drawing = allDrawings[i];

						let ph = drawing.GetPlaceholder();
						if (ph) {
							if (ph.GetType() === type) {
								return {shape: drawing, foundType: type};
							}
						}
					}
				}

				return null;
			}

			let placeholderGroup = findPlaceholderGroup(Asc.scope.textType);

			let searchResult = findShapeByPlaceholderType(slide, placeholderGroup);
			let targetShape = searchResult ? searchResult.shape : null;
			let foundType = searchResult ? searchResult.foundType : null;

			if (!targetShape && !placeholderGroups.content.includes(Asc.scope.textType)) {
				searchResult = findShapeByPlaceholderType(slide, placeholderGroups.content);
				targetShape = searchResult ? searchResult.shape : null;
				foundType = searchResult ? searchResult.foundType : null;
			}

			let bNewShape = false;
			if (!targetShape) {
				let slideWidth = presentation.GetWidth();
				let slideHeight = presentation.GetHeight();

				let sizes = {
					title: {width: 0.8, height: 0.1},
					ctrTitle: {width: 0.8, height: 0.1},
					subTitle: {width: 0.8, height: 0.08},
					body: {width: 0.8, height: 0.6},
					object: {width: 0.8, height: 0.6},
					picture: {width: 0.5, height: 0.4},
					chart: {width: 0.6, height: 0.5},
					table: {width: 0.8, height: 0.6},
					media: {width: 0.6, height: 0.5},
					clipArt: {width: 0.3, height: 0.3},
					diagram: {width: 0.7, height: 0.5},
					sldImage: {width: 0.6, height: 0.5},
					footer: {width: 0.8, height: 0.06},
					header: {width: 0.8, height: 0.06},
					date: {width: 0.2, height: 0.04},
					sldNumber: {width: 0.1, height: 0.04}
				};

				let size = sizes[Asc.scope.textType] || sizes.body;
				let shapeWidth = slideWidth * size.width;
				let shapeHeight = slideHeight * size.height;
				let x = (slideWidth - shapeWidth) / 2;
				let y = (slideHeight - shapeHeight) / 2;

				let oFill = Api.CreateNoFill();
				let oStroke = Api.CreateStroke(0, Api.CreateNoFill());
				targetShape = Api.CreateShape("rect", shapeWidth, shapeHeight, oFill, oStroke);
				targetShape.SetPosition(x, y);

				slide.AddObject(targetShape);
				foundType = Asc.scope.textType;
				bNewShape = true;
			}

			let docContent = targetShape.GetDocContent();
			if (docContent) {
				let internalContent = docContent.Content || docContent;

				while (internalContent.GetElementsCount() > 1) {
					internalContent.RemoveElement(1);
				}

				let lines = Asc.scope.text.split('\n').filter(line => line.trim() !== '');

				if (lines.length === 1) {
					let paragraph = internalContent.GetElement(0);
					if (paragraph) {
						paragraph.RemoveAllElements();
						paragraph.AddText(lines[0]);
					}
				}
				else {
					let firstParagraph = internalContent.GetElement(0);
					if (firstParagraph) {
						firstParagraph.RemoveAllElements();
						let run = firstParagraph.AddText(lines[0]);
						if (bNewShape) {
							run.SetFill(Api.CreateSolidFill(Api.CreateSchemeColor("tx1")));
						}
					}

					for (let i = 1; i < lines.length; i++) {
						let newParagraph = Api.CreateParagraph();
						let run = newParagraph.AddText(lines[i]);
						if (bNewShape) {
							run.SetFill(Api.CreateSolidFill(Api.CreateSchemeColor("tx1")));
						}
						internalContent.Push(newParagraph);
					}
				}

				return;
			}

			return;
		});

	};
	return func;
})();
