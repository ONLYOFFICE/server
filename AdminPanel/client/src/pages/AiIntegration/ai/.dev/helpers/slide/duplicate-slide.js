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
		"name": "duplicateSlide",
		"description": "Duplicates slide with the specific index or current",
		"parameters": {
			"type": "object",
			"properties": {
				"slideNumber": {
					"type": "number",
					"description": "the slide number to duplicate",
					"minimum": 1
				}
			},
			"required": []
		},
		"examples": [
			{
				"prompt": "duplicate slide 3",
				"arguments": {"slideNumber": 3}
			},
			
			{
				"prompt": "duplicate slide",
				"arguments": {}
			}
		]
	});
	
	func.call = async function (params) {
		Asc.scope.slideNum = params.slideNumber;
		let data = await Asc.Editor.callCommand(function () {
			let presentation = Api.GetPresentation();
			let slide;
			if (Asc.scope.slideNum !== undefined && Asc.scope.slideNum !== null) {
				slide = presentation.GetSlideByIndex(Asc.scope.slideNum - 1);
			}
			if (!slide)
				slide = presentation.GetCurrentSlide();
			if (!slide) {
				return null;
			}
			let slideIdx = slide.GetSlideIndex();
			if (slide) {
				slide.Duplicate(slideIdx + 1);
				return {"idx": slideIdx + 1};
			}
			return null;
		});
		if (data) {
			await Asc.Editor.callMethod("GoToSlide", [data["idx"] + 1]);
		}
	};
	return func;
})();
