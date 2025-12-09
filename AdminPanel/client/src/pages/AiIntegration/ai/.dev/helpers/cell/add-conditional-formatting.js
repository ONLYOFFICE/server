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
		"name": "addConditionalFormatting",
		"description": "Use this function when user asks for conditional formatting without specifying the exact type. This applies the most commonly used conditional formatting rule - highlighting cells based on values greater than a threshold with color background. Perfect for general requests like 'add conditional formatting', 'highlight important data', or 'format cells conditionally'.",
		"parameters": {
			"type": "object",
			"properties": {
				"range": {
					"type": "string",
					"description": "Cell range to apply formatting (e.g., 'A1:D10'). If omitted, uses active/selected range."
				},
				"threshold": {
					"type": "number",
					"description": "Value threshold for highlighting (default: calculated from data)."
				},
				"fillColor": {
					"type": "object",
					"description": "Background color {r: 255, g: 200, b: 200} (default: light red).",
					"properties": {
						"r": { "type": "number" },
						"g": { "type": "number" },
						"b": { "type": "number" }
					}
				}
			},
			"required": []
		},
		"examples": [
			{
				"prompt": "Apply default conditional formatting to current selection",
				"arguments": {}
			},
			{
				"prompt": "Apply conditional formatting with custom threshold",
				"arguments": { "threshold": 100 }
			},
			{
				"prompt": "When user asks to add conditional formatting without specifics",
				"arguments": { "range": "A1:D10" }
			}
		]
	});

	func.call = async function(params) {
		Asc.scope.range = params.range;
		Asc.scope.threshold = params.threshold;
		Asc.scope.fillColor = params.fillColor || {r: 255, g: 200, b: 200};

		await Asc.Editor.callCommand(function() {
			let ws = Api.GetActiveSheet();
			let range;
			if (Asc.scope.range) {
				range = ws.GetRange(Asc.scope.range);
			} else {
				range = ws.Selection;
			}
			
			let threshold = Asc.scope.threshold;
			if (!threshold) {
				let values = range.GetValue2();
				let numericValues = [];
				for (let i = 0; i < values.length; i++) {
					for (let j = 0; j < values[i].length; j++) {
						let val = parseFloat(values[i][j]);
						if (!isNaN(val)) {
							numericValues.push(val);
						}
					}
				}
				if (numericValues.length > 0) {
					numericValues.sort((a, b) => a - b);
					threshold = numericValues[Math.floor(numericValues.length * 0.7)];
				} else {
					threshold = 0;
				}
			}
			
			let formatConditions = range.GetFormatConditions();
			let condition = formatConditions.Add("xlCellValue", "xlGreater", threshold);
			
			if (condition) {
				let color = Asc.scope.fillColor ? 
					Api.CreateColorFromRGB(Asc.scope.fillColor.r, Asc.scope.fillColor.g, Asc.scope.fillColor.b) :
					Api.CreateColorFromRGB(255, 200, 200);
				condition.SetFillColor(color);
			}
		});
	};

	return func;
})();
