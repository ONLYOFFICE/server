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
		"name": "summarizeData",
		"description": "Analyzes and creates a comprehensive text summary of data in the specified range. Automatically determines data types (numeric, categorical, dates) and provides relevant statistics for each type. For numeric data: calculates totals, averages, ranges, and identifies outliers. For categorical data: finds most frequent values and distribution patterns. The summary is placed in a new cell adjacent to the data range with proper formatting and text wrapping.",
		"parameters": {
			"type": "object",
			"properties": {
				"range": {
					"type": "string",
					"description": "Cell range to summarize data (e.g., 'A1:D10'). If omitted, uses active/selected range."
				}
			},
			"required": []
		},
		"examples": [
			{
				"prompt": "Analyze and summarize data in the current selection with key trends, totals, and insights",
				"arguments": {}
			},
			{
				"prompt": "Summarize data in range A1:D10",
				"arguments": { "range": "A1:D10" }
			},
			{
				"prompt": "Create text summary of active range with statistics, patterns, and anomalies",
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

		let address = rangeData[0];
		let data = rangeData[1];
		let colCount = data.length > 0 ? data[0].length : 0;
		let rowCount = data.length;
		
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

		const argPrompt = [
			"You are a data analyst. Analyze the provided CSV data and create a comprehensive summary.",
			"",
			"Instructions:",
			"1. Determine data types in each column (numeric, categorical/text, dates, mixed)",
			"2. For NUMERIC data: calculate totals, averages, ranges, identify peaks/outliers",
			"3. For CATEGORICAL data: find most frequent values, distribution patterns",
			"4. For MIXED tables: combine insights (e.g., 'Category A average: 120, Category B: 95, outlier in row 15')",
			"5. Identify trends, patterns, anomalies, and key insights",
			"",
			"Output format: Plain text summary in bullet points",
			"- Start each bullet with '• '",
			"- Keep concise but informative",
			"- Include specific numbers and findings",
			"- Highlight important patterns or anomalies",
			"- Maximum 10-15 bullet points",
			"",
			"CSV data (" + rowCount + " rows, " + colCount + " columns):",
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

		Asc.scope.address = address;
		Asc.scope.summary = aiResult;
		Asc.scope.colCount = colCount;

		if (Asc.scope.summary) {
			await Asc.Editor.callCommand(function() {
				let ws = Api.GetActiveSheet();
				let range = ws.GetRange(Asc.scope.address);
				let summary = Asc.scope.summary;
				let colCount = Asc.scope.colCount;
				
				let summaryCol = range.GetCol() + colCount;
				let summaryRow = range.GetRow();
				
				let summaryCell = ws.GetCells(summaryRow, summaryCol);
				summaryCell.Value = "Data Summary:\n" + summary;
				
				summaryCell.WrapText = true;
				summaryCell.AlignVertical = "top";
				
				let summaryRange = ws.GetRange(summaryCell.Address);
				summaryRange.AutoFit(false, true);
				
				let highlightColor = Api.CreateColorFromRGB(245, 245, 245);
				summaryCell.FillColor = highlightColor;
			});
		}
	};

	return func;
})();
