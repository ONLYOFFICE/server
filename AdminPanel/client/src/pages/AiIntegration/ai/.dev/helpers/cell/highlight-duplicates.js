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
		"name": "highlightDuplicates",
		"description": "Identifies and highlights duplicate values within a specified range. Compares all cells in the range and highlights cells that contain values appearing more than once. Uses AI to accurately detect duplicates while handling various data types (numbers, text, dates). Highlights all instances of duplicate values with customizable color. Useful for data validation, cleanup tasks, and identifying repeated entries in datasets.",
		"parameters": {
			"type": "object",
			"properties": {
				"range": {
					"type": "string",
					"description": "Cell range to analyze for duplicates (e.g., 'A1:D10'). If omitted, uses current selection or entire used range."
				},
				"highlightColor": {
					"type": "string",
					"description": "Color to highlight duplicates (hex color like '#FF0000' or preset color name like 'red'). Default: 'orange'.",
					"default": "orange"
				}
			},
			"required": []
		},
		"examples": [
			{
				"prompt": "Highlight duplicates in current selection",
				"arguments": {}
			},
			{
				"prompt": "Highlight duplicates in specific range A1:D10",
				"arguments": { "range": "A1:D10" }
			},
			{
				"prompt": "Highlight duplicates in red color",
				"arguments": { "range": "A1:D10", "highlightColor": "red" }
			},
			{
				"prompt": "Highlight duplicates in specific range with custom color",
				"arguments": { "range": "A1:D10", "highlightColor": "#FF5733" }
			},
			{
				"prompt": "Find and highlight duplicate rows in data",
				"arguments": {}
			},
			{
				"prompt": "Detect duplicate entries with blue highlighting",
				"arguments": { "highlightColor": "blue" }
			}
		]
	});

	func.call = async function(params) {
		Asc.scope.range = params.range;
		Asc.scope.highlightColor = params.highlightColor || "orange";

		let rangeData = await Asc.Editor.callCommand(function(){
			let ws = Api.GetActiveSheet();
			let _range;

			if (!Asc.scope.range) {
				_range = Api.GetSelection();
			} else {
				_range = ws.GetRange(Asc.scope.range);
			}

			if (!_range)
				return null;

			let values = _range.GetValue2();
			let address = _range.Address;
			let startRow = _range.Row;
			let startCol = _range.Col;

			return {
				values: values,
				address: address,
				startRow: startRow,
				startCol: startCol
			};
		});

		if (!rangeData || !rangeData.values) {
			return;
		}

		// Extract all values with their positions for duplicate detection
		let allData = [];
		let values = rangeData.values;
		
		if (Array.isArray(values)) {
			for (let r = 0; r < values.length; r++) {
				let row = values[r];
				if (Array.isArray(row)) {
					for (let c = 0; c < row.length; c++) {
						allData.push({row: r, col: c, value: row[c]});
					}
				} else {
					allData.push({row: r, col: 0, value: row});
				}
			}
		} else {
			allData.push({row: 0, col: 0, value: values});
		}

		if (allData.length === 0) {
			return; // No data to analyze
		}

		let dataValues = allData.map(function(item) { return item.value; });
		
		let argPrompt = "Find duplicate values in this array: [" + dataValues.join(',') + "]\n\n" +
			"Return ONLY a JSON array of indices (0-based) that are duplicates.\n" +
			"Example: if values at positions 0 and 2 are identical, return [0,2]\n" +
			"If no duplicates found, return []\n" +
			"CRITICAL: Response must be ONLY the JSON array, nothing else.\n" +
			"Invalid data formats are not allowed - must be valid JSON array format.\n" +
			"No text, no explanations, no additional formatting - ONLY [1,2,3] format:";

		let requestEngine = AI.Request.create(AI.ActionType.Chat);
		if (!requestEngine)
			return;

		let isSendedEndLongAction = false;
		async function checkEndAction() {
			if (!isSendedEndLongAction) {
				await Asc.Editor.callMethod("EndAction", ["Block", "AI (" + requestEngine.modelUI.name + ")"]);
				isSendedEndLongAction = true;
			}
		}

		await Asc.Editor.callMethod("StartAction", ["Block", "AI (" + requestEngine.modelUI.name + ")"]);
		await Asc.Editor.callMethod("StartAction", ["GroupActions"]);

		let aiResult = await requestEngine.chatRequest(argPrompt, false, async function(data) {
			if (!data)
				return;
		});

		await checkEndAction();

		if (aiResult) {
			try {
				let duplicates = JSON.parse(aiResult.trim());
				if (Array.isArray(duplicates) && duplicates.length > 0) {
					Asc.scope.duplicates = [];
					Asc.scope.allData = allData;
					
					for (let i = 0; i < duplicates.length; i++) {
						let dataIndex = duplicates[i];
						if (typeof dataIndex === 'number' && dataIndex >= 0 && dataIndex < allData.length) {
							Asc.scope.duplicates.push({
								row: allData[dataIndex].row,
								col: allData[dataIndex].col
							});
						}
					}
					
					if (Asc.scope.duplicates.length > 0) {
						Asc.scope.rangeData = rangeData;

						await Asc.Editor.callCommand(function(){
							let ws = Api.GetActiveSheet();
							let highlightColor;
							
							// Handle different color formats
							if (Asc.scope.highlightColor.startsWith('#')) {
								// Hex color
								let hex = Asc.scope.highlightColor.substring(1);
								let r = parseInt(hex.substring(0, 2), 16);
								let g = parseInt(hex.substring(2, 4), 16);
								let b = parseInt(hex.substring(4, 6), 16);
								highlightColor = Api.CreateColorFromRGB(r, g, b);
							} else {
								// Named color
								highlightColor = Api.CreateColorByName(Asc.scope.highlightColor);
							}

							for (let i = 0; i < Asc.scope.duplicates.length; i++) {
								let duplicate = Asc.scope.duplicates[i];
								let targetRow = Asc.scope.rangeData.startRow + duplicate.row;
								let targetCol = Asc.scope.rangeData.startCol + duplicate.col;
								
								let cell = ws.GetCells(targetRow, targetCol);
								if (cell) {
									cell.SetFillColor(highlightColor);
								}
							}
						});
					}
				}
			} catch (error) {
				// Handle JSON parsing errors or other issues
				console.error("Error parsing duplicate detection result:", error);
			}
		}

		await Asc.Editor.callMethod("EndAction", ["GroupActions"]);
	};

	return func;
})();
