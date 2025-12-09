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
		"name": "addTop10Condition",
		"description": "Highlights the top or bottom ranked values in a range. You can choose to highlight by item count (e.g., top 10 values) or by percentage (e.g., top 20% of values). Perfect for identifying highest performers, outliers, or values that need attention in your dataset.",
		"parameters": {
			"type": "object",
			"properties": {
				"range": {
					"type": "string",
					"description": "Cell range to apply condition (e.g., 'A1:D10'). If omitted, uses active/selected range."
				},
				"rank": {
					"type": "number",
					"description": "Number of top/bottom items to highlight (default: 10).",
					"default": 10
				},
				"isBottom": {
					"type": "boolean",
					"description": "True for bottom values, false for top values (default: false).",
					"default": false
				},
				"isPercent": {
					"type": "boolean",
					"description": "True for percentage, false for item count (default: false).",
					"default": false
				},
				"fillColor": {
					"type": "object",
					"description": "Background color {r: 255, g: 0, b: 0}.",
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
				"prompt": "Highlight top 10 values with green background",
				"arguments": { "fillColor": { "r": 0, "g": 255, "b": 0 } }
			},
			{
				"prompt": "Highlight bottom 5 values with red background",
				"arguments": { "rank": 5, "isBottom": true, "fillColor": { "r": 255, "g": 0, "b": 0 } }
			},
			{
				"prompt": "When user asks to highlight top/bottom values, highest/lowest cells",
				"arguments": { "rank": 10, "isBottom": false }
			}
		]
	});

	func.call = async function(params) {
		Asc.scope.range = params.range;
		Asc.scope.rank = params.rank || 10;
		Asc.scope.isBottom = params.isBottom || false;
		Asc.scope.isPercent = params.isPercent || false;
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
			let condition = formatConditions.AddTop10();
			
			if (condition) {
				if (condition.SetRank) {
					condition.SetRank(Asc.scope.rank);
				}
				if (condition.SetBottom) {
					condition.SetBottom(Asc.scope.isBottom);
				}
				if (condition.SetPercent) {
					condition.SetPercent(Asc.scope.isPercent);
				}
				
				if (Asc.scope.fillColor) {
					let fillColor = Api.CreateColorFromRGB(Asc.scope.fillColor.r, Asc.scope.fillColor.g, Asc.scope.fillColor.b);
					condition.SetFillColor(fillColor);
				} else {
					let defaultFillColor = Api.CreateColorFromRGB(144, 238, 144);
					condition.SetFillColor(defaultFillColor);
				}
			}
		});
	};

	return func;
})();
