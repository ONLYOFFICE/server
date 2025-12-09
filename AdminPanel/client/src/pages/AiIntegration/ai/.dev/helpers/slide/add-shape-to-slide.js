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
		"name": "addShapeToSlide",
		"description": "Adds a shape to the slide with optional text (139x42mm, centered, blue fill with dark border)",
		"parameters": {
			"type": "object",
			"properties": {
				"slideNumber": {
					"type": "number",
					"description": "Slide number to add shape to",
					"minimum": 1
				},
				"shapeType": {
					"type": "string",
					"description": "shape type - rect, roundRect, ellipse, triangle, diamond, pentagon, hexagon, star5, plus, mathMinus, mathMultiply, mathEqual, mathNotEqual, heart, cloud, leftArrow, rightArrow, upArrow, downArrow, leftRightArrow, chevron, bentArrow, curvedRightArrow, blockArc, wedgeRectCallout, cloudCallout, ribbon, wave, can, cube, pie, donut, sun, moon, smileyFace, lightningBolt, noSmoking"
				},
				"text": {
					"type": "string",
					"description": "text to add to the shape"
				}
			},
			"required": []
		},
		"examples": [
			{
				"prompt": "add a rectangle with text on slide 2",
				"arguments": { "slideNumber": 2, "shapeType": "rect" }
			},
			{
				"prompt": "add a star shape on current slide",
				"arguments": { "shapeType": "star5" }
			},
			{
				"prompt": "add a rounded rectangle with text",
				"arguments": { "text": "Key Message" }
			},
			{
				"prompt": "add a diamond shape with text",
				"arguments": { "shapeType": "diamond", "text": "Decision Point" }
			},
			{
				"prompt": "add a right arrow with text",
				"arguments": { "shapeType": "rightArrow", "text": "Next Step" }
			}
		]
	});
	
	func.call = async function(params) {
		Asc.scope.params = params;
		await Asc.Editor.callCommand(function () {
				let presentation = Api.GetPresentation();
				let slide;

				if (Asc.scope.params.slideNumber) {
					slide = presentation.GetSlideByIndex(Asc.scope.params.slideNumber - 1);
				}
				else {
					slide = presentation.GetCurrentSlide();
				}

				if (!slide) return;

				let slideWidth = presentation.GetWidth();
				let slideHeight = presentation.GetHeight();

				let shapeType = Asc.scope.params.shapeType || "rect";
				let width = 2500000;
				let height = 2500000;
				let x = (slideWidth - width) / 2;
				let y = (slideHeight - height) / 2;

				let fill = Api.CreateSolidFill(Api.CreateSchemeColor("accent1"));
				let stroke = Api.CreateStroke(12700, Api.CreateSolidFill(Api.CreateRGBColor(51, 51, 51)));

				let shape = Api.CreateShape(shapeType, width, height, fill, stroke);
				shape.SetPosition(x, y);

				if (Asc.scope.params.text) {
					let docContent = shape.GetDocContent();
					if (docContent) {
						let paragraph = docContent.GetElement(0);
						if (!paragraph) {
							paragraph = Api.CreateParagraph();
							docContent.Push(paragraph);
						}
						paragraph.SetJc("center");
						paragraph.AddText(Asc.scope.params.text);
						shape.SetVerticalTextAlign("center");
					}
				}
				slide.AddObject(shape);
		});
	};

	return func;
})();
