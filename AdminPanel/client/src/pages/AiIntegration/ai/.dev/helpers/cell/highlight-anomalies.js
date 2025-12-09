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
		"name": "highlightAnomalies",
		"description": "Detects and highlights statistical outliers (anomalies) in numeric data using the IQR (Interquartile Range) method or Z-score analysis. Applies conservative outlier detection to avoid false positives - only marks clear statistical anomalies. Automatically extracts numeric values from the range, calculates quartiles, and identifies values that fall outside Q1-1.5*IQR or Q3+1.5*IQR. Highlights detected anomalies with customizable colors. Requires at least 4 numeric values for analysis.",
		"parameters": {
			"type": "object",
			"properties": {
				"range": {
					"type": "string",
					"description": "Cell range to analyze for anomalies (e.g., 'A1:D10'). If omitted, uses current selection or entire used range."
				},
				"highlightColor": {
					"type": "string",
					"description": "Color to highlight anomalies (hex color like '#FF0000' or preset color name like 'red'). Default: 'yellow'.",
					"default": "yellow"
				}
			},
			"required": []
		},
		"examples": [
			{
				"prompt": "Highlight anomalies in current selection",
				"arguments": {}
			},
			{
				"prompt": "Highlight anomalies in specific range A1:D10",
				"arguments": { "range": "A1:D10" }
			},
			{
				"prompt": "Highlight anomalies in red color",
				"arguments": { "highlightColor": "red" }
			},
			{
				"prompt": "Highlight anomalies in specific range with custom color",
				"arguments": { "range": "A1:D10", "highlightColor": "#FF5733" }
			},
			{
				"prompt": "Analyze selected range for statistical outliers and highlight them",
				"arguments": {}
			},
			{
				"prompt": "Find and highlight anomalous values in data with blue color",
				"arguments": { "highlightColor": "blue" }
			}
		]
	});

	func.call = async function(params) {
		Asc.scope.range = params.range;
		Asc.scope.highlightColor = params.highlightColor || "yellow";

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

		// Extract numeric values with their positions
		let numericData = [];
		let values = rangeData.values;
		
		// Helper function to check if a value is a valid number
		function isValidNumber(value) {
			if (value == null || value === '') {
				return false;
			}
			let numValue = parseFloat(value);
			return !isNaN(numValue) && isFinite(numValue) ? numValue : false;
		}
		
		if (Array.isArray(values)) {
			for (let r = 0; r < values.length; r++) {
				let row = values[r];
				if (Array.isArray(row)) {
					for (let c = 0; c < row.length; c++) {
						let cell = row[c];
						let numValue = isValidNumber(cell);
						if (numValue !== false) {
							numericData.push({row: r, col: c, value: numValue});
						}
					}
				} else {
					let numValue = isValidNumber(row);
					if (numValue !== false) {
						numericData.push({row: r, col: 0, value: numValue});
					}
				}
			}
		} else {
			let numValue = isValidNumber(values);
			if (numValue !== false) {
				numericData.push({row: 0, col: 0, value: numValue});
			}
		}

		if (numericData.length === 0) {
			return; // No numeric data to analyze
		}

		let dataValues = numericData.map(function(item) { return item.value; });
		
		let argPrompt = [
			"You are a statistical data analyst.",
			"Input is numeric array: [" + dataValues.join(',') + "]",
			"Task: Find statistical outliers (anomalies) in the data.",
			"Rules:",
			"1. Use IQR (Interquartile Range) method for outlier detection:",
			"   a) Calculate Q1 (25th percentile) and Q3 (75th percentile)",
			"   b) Calculate IQR = Q3 - Q1",
			"   c) Define outliers as values < Q1 - 1.5*IQR or > Q3 + 1.5*IQR",
			"2. Alternative method: Z-score analysis where |Z| > 2.5 indicates outlier",
			"3. Be conservative - only mark clear statistical outliers to avoid false positives",
			"4. If dataset has less than 4 values, return empty array (insufficient data)",
			"5. Ignore extreme outliers that are obviously data entry errors vs. statistical anomalies",
			"6. The answer MUST be a valid JSON array of indices (0-based positions in input array)",
			"7. Format: [0,2,5] - indices of outlier positions in the input array",
			"8. If no outliers found, return empty array: []",
			"9. No extra text, explanations, or formatting - ONLY the JSON array",
			"10. Example responses:",
			"    - Input [1,2,3,100]: return [3]",
			"    - Input [1,2,3,4,5]: return []",
			"    - Input [10,10,10,50,10]: return [3]",
			"Data to analyze: [" + dataValues.join(',') + "]"
		].join('\n');

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
				let anomalies = JSON.parse(aiResult.trim());
				if (Array.isArray(anomalies) && anomalies.length > 0) {
					Asc.scope.anomalies = [];
					Asc.scope.numericData = numericData;
					
					for (let i = 0; i < anomalies.length; i++) {
						let dataIndex = anomalies[i];
						if (typeof dataIndex === 'number' && dataIndex >= 0 && dataIndex < Asc.scope.numericData.length) {
							Asc.scope.anomalies.push({
								row: Asc.scope.numericData[dataIndex].row,
								col: Asc.scope.numericData[dataIndex].col
							});
						}
					}
					
					if (Asc.scope.anomalies.length > 0) {
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

							for (let i = 0; i < Asc.scope.anomalies.length; i++) {
								let anomaly = Asc.scope.anomalies[i];
								let targetRow = Asc.scope.rangeData.startRow + anomaly.row;
								let targetCol = Asc.scope.rangeData.startCol + anomaly.col;
								
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
				console.error("Error parsing AI result:", error);
			}
		}

		await Asc.Editor.callMethod("EndAction", ["GroupActions"]);
	};

	return func;
})();
