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
		"name": "addColorScale",
		"description": "Applies color scale conditional formatting to visualize data with gradient colors. Creates a heat map effect where values are represented by colors ranging from one color (minimum values) to another color (maximum values). Use 2-color scale for simple comparisons or 3-color scale for more detailed data visualization.",
		"parameters": {
			"type": "object",
			"properties": {
				"range": {
					"type": "string",
					"description": "Cell range to apply color scale (e.g., 'A1:D10'). If omitted, uses active/selected range."
				},
				"colorScaleType": {
					"type": "number",
					"description": "Color scale type - 2 for two-color scale, 3 for three-color scale (default: 3).",
					"enum": [2, 3],
					"default": 3
				}
			},
			"required": []
		},
		"examples": [
			{
				"prompt": "Apply 3-color scale conditional formatting to current selection",
				"arguments": {}
			},
			{
				"prompt": "Apply 2-color scale conditional formatting to range A1:D10",
				"arguments": { "range": "A1:D10", "colorScaleType": 2 }
			},
			{
				"prompt": "When user asks to add color scale, color gradient, heat map formatting",
				"arguments": { "range": "A1:D10", "colorScaleType": 3 }
			}
		]
	});

	func.call = async function(params) {
		Asc.scope.range = params.range;
		Asc.scope.colorScaleType = params.colorScaleType || 3;

		await Asc.Editor.callCommand(function() {
			let ws = Api.GetActiveSheet();
			let range;
			if (Asc.scope.range) {
				range = ws.GetRange(Asc.scope.range);
			} else {
				range = ws.Selection;
			}
			
			let formatConditions = range.GetFormatConditions();
			formatConditions.AddColorScale(Asc.scope.colorScaleType);
		});
	};

	return func;
})();
