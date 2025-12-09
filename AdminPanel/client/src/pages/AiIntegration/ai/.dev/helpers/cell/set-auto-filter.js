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
		"name": "setAutoFilter",
		"description": "Applies autofilter to a data range, enabling dropdown filters on column headers. Supports filtering by column number or column name (with fuzzy matching). Offers multiple filter types: value comparison operators (greater than, less than, equals), multiple value selection, top/bottom N items or percentage, color-based filtering (cell background or font color), and dynamic filters. Can be used to filter active selection or specific ranges.",
		"parameters": {
			"type": "object",
			"properties": {
				"range": {
					"type": "string",
					"description": "Cell range to apply autofilter (e.g., 'A1:D10'). If omitted, uses active/selected range."
				},
				"field": {
					"type": "number",
					"description": "Field number for filtering (starting from 1, left-most field)."
				},
				"fieldName": {
					"type": "string",
					"description": "Column name/header for filtering (e.g., 'Name', 'Age'). Will automatically find the column number."
				},
				"criteria1": {
					"type": ["string", "array", "object"],
					"description": "Filter criteria - string for operators (e.g., '>10'), array for multiple values (e.g., [1,2,3]), ApiColor object for color filters, or dynamic filter constant."
				},
				"operator": {
					"type": "string",
					"description": "Filter operator.",
					"enum": ["xlAnd", "xlOr", "xlFilterValues", "xlTop10Items", "xlTop10Percent", "xlBottom10Items", "xlBottom10Percent", "xlFilterCellColor", "xlFilterFontColor", "xlFilterDynamic"]
				},
				"criteria2": {
					"type": "string",
					"description": "Second criteria for compound filters (used with xlAnd/xlOr operators)."
				},
				"visibleDropDown": {
					"type": "boolean",
					"description": "Show/hide filter dropdown arrow (default: true)."
				}
			},
			"required": []
		},
		"examples": [
			{
				"prompt": "Apply autofilter to range A1:D10",
				"arguments": { "range": "A1:D10" }
			},
			{
				"prompt": "Apply autofilter to active/selected range",
				"arguments": {}
			},
			{
				"prompt": "Filter column 1 for values greater than 10",
				"arguments": { "range": "A1:D10", "field": 1, "criteria1": ">10" }
			},
			{
				"prompt": "Filter by column name 'Name' for specific values",
				"arguments": { "range": "A1:D10", "fieldName": "Name", "criteria1": ["John", "Jane"], "operator": "xlFilterValues" }
			},
			{
				"prompt": "Filter by column header 'Age' for values greater than 18",
				"arguments": { "range": "A1:D10", "fieldName": "Age", "criteria1": ">18" }
			},
			{
				"prompt": "Filter column 2 for specific values [2,5,8]",
				"arguments": { "range": "A1:D10", "field": 2, "criteria1": [2, 5, 8], "operator": "xlFilterValues" }
			},
			{
				"prompt": "Filter column 1 for top 10 items",
				"arguments": { "range": "A1:D10", "field": 1, "criteria1": "10", "operator": "xlTop10Items" }
			},
			{
				"prompt": "Create compound filter (>5 OR <2)",
				"arguments": { "range": "A1:D10", "field": 1, "criteria1": ">5", "operator": "xlOr", "criteria2": "<2" }
			},
			{
				"prompt": "Filter by cell background color (yellow)",
				"arguments": { "range": "A1:D10", "field": 1, "criteria1": { "r": 255, "g": 255, "b": 0 }, "operator": "xlFilterCellColor" }
			},
			{
				"prompt": "Filter by font color (red)",
				"arguments": { "range": "A1:D10", "field": 1, "criteria1": { "r": 255, "g": 0, "b": 0 }, "operator": "xlFilterFontColor" }
			}
		]
	});

	func.call = async function(params) {
		Asc.scope.range = params.range;
		Asc.scope.field = params.field;
		Asc.scope.fieldName = params.fieldName;
		Asc.scope.criteria1 = params.criteria1;
		Asc.scope.operator = params.operator;
		Asc.scope.criteria2 = params.criteria2;
		Asc.scope.visibleDropDown = params.visibleDropDown;

		if (Asc.scope.fieldName && !Asc.scope.field) {
			let insertRes = await Asc.Editor.callCommand(function(){
				let ws = Api.GetActiveSheet();
				let _range;

				if (!Asc.scope.range) {
					_range = Api.GetSelection();
				} else {
					_range = ws.GetRange(Asc.scope.range);
				}

				return _range.GetValue2();
			});

			let csv = insertRes.map(function(item){
				return item.map(function(value) {
					if (value == null) return '';
					const str = String(value);
					if (str.includes(',') || str.includes('\n') || str.includes('\r') || str.includes('"')) {
						return '"' + str.replace(/"/g, '""') + '"';
					}
					return str;
				}).join(',');
			}).join('\n');

			let argPromt = "Find column index for header '" + Asc.scope.fieldName + "' in the following CSV data.\n\n" +
			"IMPORTANT RULES:\n" +
			"1. Return ONLY a single number (column index starting from 1). No text, no explanations, no additional characters.\n" +
			"2. Find EXACT match first. If exact match exists, return its index.\n" +
			"3. If no exact match, then look for partial matches.\n" +
			"4. Case-insensitive comparison allowed.\n" +
			"5. Data is CSV format (comma-separated). Look ONLY at the first row (header row).\n" +
			"6. Count positions carefully: each comma marks a column boundary.\n" +
			"7. Example: if searching for 'test2' and headers are 'test1,test2,test', return 2 (not 1 or 3).\n" +
			"8. If the header is in the 3rd column, return only: 3\n\n" +
			"CSV data:\n" + csv;

			let requestEngine = AI.Request.create(AI.ActionType.Chat);
			if (!requestEngine)
				return;

			let isSendedEndLongAction = false;
			async function checkEndAction() {
				if (!isSendedEndLongAction) {
					await Asc.Editor.callMethod("EndAction", ["Block", "AI (" + requestEngine.modelUI.name + ")"]);
					isSendedEndLongAction = true
				}
			}

			await Asc.Editor.callMethod("StartAction", ["Block", "AI (" + requestEngine.modelUI.name + ")"]);
			await Asc.Editor.callMethod("StartAction", ["GroupActions"]);

			let result = await requestEngine.chatRequest(argPromt, false, async function(data) {
				if (!data)
					return;
				await checkEndAction();
			});

			await checkEndAction();
			await Asc.Editor.callMethod("EndAction", ["GroupActions"]);
			Asc.scope.field = result;
		}

		await Asc.Editor.callCommand(function(){
			let ws = Api.GetActiveSheet();
			let range;

			if (!Asc.scope.range) {
				range = Api.GetSelection();
			} else {
				range = ws.GetRange(Asc.scope.range);
			}

			if (!range) {
				return;
			}

			let field = Asc.scope.field;
			if (!field) {
				field = 1;
			}

			let criteria1 = Asc.scope.criteria1;
			if (Asc.scope.operator === "xlFilterCellColor" || Asc.scope.operator === "xlFilterFontColor") {
				if (criteria1 && typeof criteria1 === 'object' && criteria1.r !== undefined && criteria1.g !== undefined && criteria1.b !== undefined) {
					criteria1 = Api.CreateColorFromRGB(criteria1.r, criteria1.g, criteria1.b);
				}
			}

			range.SetAutoFilter(
				field,
				criteria1,
				Asc.scope.operator,
				Asc.scope.criteria2,
				Asc.scope.visibleDropDown
			);
		});
	};

	return func;
})();
