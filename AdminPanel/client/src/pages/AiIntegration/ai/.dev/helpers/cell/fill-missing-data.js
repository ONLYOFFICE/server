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
		"name": "fillMissingData",
		"description": "Intelligently fills missing or empty cells in a data range using appropriate statistical methods. For numeric columns, fills with median values. For categorical columns, uses the most frequent value. For time series data, applies forward fill (uses the previous non-empty value). Automatically detects column types and highlights filled cells with light blue color for easy identification.",
		"parameters": {
			"type": "object",
			"properties": {
				"range": {
					"type": "string",
					"description": "Cell range to fill missing data (e.g., 'A1:D10'). If omitted, uses active/selected range."
				}
			},
			"required": []
		},
		"examples": [
			{
				"prompt": "Fill missing data in the current selection with appropriate values based on column types",
				"arguments": {}
			},
			{
				"prompt": "Fill missing data in range A1:D10",
				"arguments": { "range": "A1:D10" }
			},
			{
				"prompt": "Fill empty cells in active range using smart algorithms (median for numeric, most frequent for categorical, forward fill for time series)",
				"arguments": {}
			},
			{
				"prompt": "Fill missing values, fill empty cells, complete data, or handle null values",
				"arguments": {}
			}
		]
	});

	func.call = async function(params) {
		Asc.scope.range = params.range;
		
		let rangeData = await Asc.Editor.callCommand(function(){
			let ws = Api.GetActiveSheet();
			let range;
			if (Asc.scope.range) {
				range = ws.GetRange(Asc.scope.range);
			} else {
				range = ws.Selection;
			}
			return [range.Address, range.GetValue2()];
		});

		//make csv from source data
		let address = rangeData[0];
		let data = rangeData[1];
		let csv = data.map(function(item){
			return item.map(function(value) {
				if (value == null) return '';
				const str = String(value);
				if (str.includes(',') || str.includes('\n') || str.includes('\r') || str.includes('"')) {
					return '"' + str.replace(/"/g, '""') + '"';
				}
				return str;
			}).join(',');
		}).join('\n');

		//make ai request for missing data analysis
		const argPrompt = [
			"You are a data analyst.",
			"Input is CSV (comma-separated, ','). Empty cells represent missing values to be filled.",
			"Rules:",
			"1. NUMERIC columns: Fill missing values with MEDIAN of non-empty values.",
			"2. CATEGORICAL columns: Fill missing values with MOST FREQUENT value.", 
			"3. TIME_SERIES columns: Fill missing values with FORWARD FILL (previous non-empty value).",
			"",
			"Output format: JSON array with exact row/column coordinates (1-based indexing):",
			"[",
			"  {\"row\": 2, \"column\": 1, \"new_value\": 25.5},",
			"  {\"row\": 3, \"column\": 2, \"new_value\": \"Category A\"},",
			"  {\"row\": 4, \"column\": 3, \"new_value\": \"FORWARD_FILL\"}",
			"]",
			"- Use \"FORWARD_FILL\" as new_value for time series columns",
			"- Row and column numbers are 1-based (first row = 1, first column = 1)",
			"- Only include cells that need to be filled",
			"- The answer MUST be valid JSON array",
			"- No extra text, spaces, or newlines outside JSON",
			"",
			"CSV:",
			csv
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
		await Asc.Editor.callMethod("EndAction", ["GroupActions"]);

		//Parse AI result
		function parseAIResult(result) {
			try {
				const jsonMatch = result.match(/\[[\s\S]*\]/);
				if (!jsonMatch) return null;
				return JSON.parse(jsonMatch[0]);
			} catch (e) {
				return null;
			}
		}

		Asc.scope.address = address;
		Asc.scope.fillData = parseAIResult(aiResult);
		Asc.scope.originalData = data;

		if (Asc.scope.fillData) {
			await Asc.Editor.callCommand(function() {
				let ws = Api.GetActiveSheet();
				let range = ws.GetRange(Asc.scope.address);
				let fillData = Asc.scope.fillData;
				let originalData = Asc.scope.originalData;
				
				let highlightColor = Api.CreateColorFromRGB(173, 216, 230);
				
				for (let i = 0; i < fillData.length; i++) {
					let fillItem = fillData[i];
					let rowNum = fillItem.row;
					let colNum = fillItem.column;
					let newValue = fillItem.new_value;
					
					if (newValue === "FORWARD_FILL") {
						let lastValue = null;
						for (let searchRow = rowNum - 1; searchRow >= 1; searchRow--) {
							let searchValue = originalData[searchRow - 1][colNum - 1];
							if (searchValue != null && searchValue !== '') {
								lastValue = searchValue;
								break;
							}
						}
						if (lastValue != null) {
							let cell = range.GetCells(rowNum, colNum);
							cell.Value = lastValue;
							cell.FillColor = highlightColor;
						}
					} else {
						let cell = range.GetCells(rowNum, colNum);
						cell.Value = newValue;
						cell.FillColor = highlightColor;
					}
				}
			});
		}
	};

	return func;
})();
