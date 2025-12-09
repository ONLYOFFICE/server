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
		"name": "addUniqueValues",
		"description": "Highlights unique values or duplicate values in a range. Use this to identify data that appears only once (unique) or multiple times (duplicates) within the specified range. Perfect for data validation and cleanup tasks.",
		"parameters": {
			"type": "object",
			"properties": {
				"range": {
					"type": "string",
					"description": "Cell range to apply condition (e.g., 'A1:D10'). If omitted, uses active/selected range."
				},
				"duplicateUnique": {
					"type": "string",
					"description": "'unique' to highlight unique values, 'duplicate' to highlight duplicates (default: 'duplicate').",
					"enum": ["unique", "duplicate"],
					"default": "duplicate"
				},
				"fillColor": {
					"type": "object",
					"description": "Background color {r: 255, g: 255, b: 0}.",
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
				"prompt": "Highlight duplicate values with default color",
				"arguments": {}
			},
			{
				"prompt": "Highlight unique values with yellow background",
				"arguments": { "duplicateUnique": "unique", "fillColor": { "r": 255, "g": 255, "b": 0 } }
			},
			{
				"prompt": "When user asks to highlight duplicate or unique values",
				"arguments": { "duplicateUnique": "unique" }
			}
		]
	});

	func.call = async function(params) {
		Asc.scope.range = params.range;
		Asc.scope.duplicateUnique = params.duplicateUnique || 'duplicate';
		Asc.scope.fillColor = params.fillColor;

		await Asc.Editor.callCommand(function() {
			let ws = Api.GetActiveSheet();
			let range;
			if (Asc.scope.range) {
				range = ws.GetRange(Asc.scope.range);
			} else {
				range = ws.Selection;
			}
			
			let formatConditions = range.GetFormatConditions();
			let condition = formatConditions.AddUniqueValues();

			if (condition) {
				if (Asc.scope.duplicateUnique === 'unique') {
					condition.SetDupeUnique("xlUnique");
				} else {
					condition.SetDupeUnique("xlDuplicate");
				}
				
				if (Asc.scope.fillColor) {
					let fillColor = Api.CreateColorFromRGB(Asc.scope.fillColor.r, Asc.scope.fillColor.g, Asc.scope.fillColor.b);
					condition.SetFillColor(fillColor);
				} else {
					let defaultFillColor = Api.CreateColorFromRGB(255, 192, 203);
					condition.SetFillColor(defaultFillColor);
				}
			}
		});
	};

	return func;
})();
