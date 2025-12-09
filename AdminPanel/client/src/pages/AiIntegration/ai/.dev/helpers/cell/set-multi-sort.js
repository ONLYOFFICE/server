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
		"name": "setMultiSort",
		"description": "Sorts data by multiple columns (up to 3 levels). Use this when you need to sort by primary, secondary, and tertiary sort keys. Each level can have its own sort order.",
		"parameters": {
			"type": "object",
			"properties": {
				"range": {
					"type": "string",
					"description": "Cell range to sort (e.g., 'A1:D10'). If omitted, uses active/selected range."
				},
				"key1": {
					"type": ["string", "number"],
					"description": "First sort field - cell reference, column index (1-based), or column name. If omitted, uses first column."
				},
				"sortOrder1": {
					"type": "string",
					"description": "Sort order for key1: 'xlAscending' or 'xlDescending'.",
					"enum": ["xlAscending", "xlDescending"],
					"default": "xlAscending"
				},
				"key2": {
					"type": ["string", "number"],
					"description": "Second sort field - cell reference, column index, or column name. If omitted, uses second column."
				},
				"sortOrder2": {
					"type": "string",
					"description": "Sort order for key2: 'xlAscending' or 'xlDescending'.",
					"enum": ["xlAscending", "xlDescending"],
					"default": "xlAscending"
				},
				"key3": {
					"type": ["string", "number"],
					"description": "Third sort field - cell reference, column index, or column name."
				},
				"sortOrder3": {
					"type": "string",
					"description": "Sort order for key3: 'xlAscending' or 'xlDescending'.",
					"enum": ["xlAscending", "xlDescending"],
					"default": "xlAscending"
				},
				"header": {
					"type": "string",
					"description": "Specifies if first row contains headers: 'xlYes' or 'xlNo'.",
					"enum": ["xlYes", "xlNo"],
					"default": "xlNo"
				}
			},
			"required": []
		},
		"examples": [
			{
				"prompt": "Sort by two columns",
				"arguments": {}
			},
			{
				"prompt": "Sort by Name and Age",
				"arguments": { "key1": "Name", "key2": "Age", "header": "xlYes" }
			},
			{
				"prompt": "Sort first column ascending, second descending",
				"arguments": { "sortOrder1": "xlAscending", "sortOrder2": "xlDescending" }
			}
		]
	});

	func.call = async function(params) {
		Asc.scope.range = params.range;
		Asc.scope.key1 = params.key1;
		Asc.scope.sortOrder1 = params.sortOrder1 || "xlAscending";
		Asc.scope.key2 = params.key2;
		Asc.scope.sortOrder2 = params.sortOrder2 || "xlAscending";
		Asc.scope.key3 = params.key3;
		Asc.scope.sortOrder3 = params.sortOrder3 || "xlAscending";
		Asc.scope.header = params.header || "xlNo";

		async function findColumnByName(fieldName) {
			if (!fieldName) return null;

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

			let argPromt = "Find column index for header '" + fieldName + "' in the following CSV data.\n\n" +
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
				return null;

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
			return result - 0;
		}

		if (Asc.scope.key1 && typeof Asc.scope.key1 === 'string' && isNaN(Asc.scope.key1) && !Asc.scope.key1.match(/^[A-Z]+\d+$/i)) {
			Asc.scope.key1 = await findColumnByName(Asc.scope.key1);
		}
		if (Asc.scope.key2 && typeof Asc.scope.key2 === 'string' && isNaN(Asc.scope.key2) && !Asc.scope.key2.match(/^[A-Z]+\d+$/i)) {
			Asc.scope.key2 = await findColumnByName(Asc.scope.key2);
		}
		if (Asc.scope.key3 && typeof Asc.scope.key3 === 'string' && isNaN(Asc.scope.key3) && !Asc.scope.key3.match(/^[A-Z]+\d+$/i)) {
			Asc.scope.key3 = await findColumnByName(Asc.scope.key3);
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

			if (Asc.scope.header === "xlYes") {
				range.SetOffset(1, 0);
			}

			let key1 = null, key2 = null, key3 = null;

			function adjustSortKey(keyValue, defaultColumnOffset) {
				if (!keyValue) {
					if (defaultColumnOffset !== undefined) {
						return ws.GetCells(range.GetRow(), range.GetCol() + defaultColumnOffset);
					}
					return null;
				}

				if (typeof keyValue === 'number') {
					return ws.GetCells(range.GetRow(), range.GetCol() + keyValue - 1);
				} else if (typeof keyValue === 'string') {
					try {
						let keyRange = ws.GetRange(keyValue);
						return keyRange || keyValue;
					} catch {
						return keyValue;
					}
				} else {
					return keyValue;
				}
			}

			key1 = adjustSortKey(Asc.scope.key1, 0);
			key2 = adjustSortKey(Asc.scope.key2, 1);
			key3 = adjustSortKey(Asc.scope.key3);

			range.SetSort(
				key1,
				Asc.scope.sortOrder1,
				key2,
				Asc.scope.sortOrder2,
				key3,
				Asc.scope.sortOrder3,
				Asc.scope.header
			);
		});
	};

	return func;
})();
