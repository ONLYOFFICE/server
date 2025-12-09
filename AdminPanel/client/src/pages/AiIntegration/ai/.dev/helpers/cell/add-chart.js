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
		"name": "addChart",
		"description": "Creates charts from data ranges to visualize data. Supports multiple chart types including bar charts, line charts, pie charts, scatter plots, and area charts. Each chart type has variants like stacked, 3D, and percentage views. Charts are automatically positioned below the source data range with configurable dimensions. Optional chart titles can be added for better context.",
		"parameters": {
			"type": "object",
			"properties": {
				"range": {
					"type": "string",
					"description": "Cell range with data for chart (e.g., 'A1:D10'). If omitted, uses current selection."
				},
				"chartType": {
					"type": "string",
					"description": "Type of chart to create.",
					"enum": ["bar", "barStacked", "barStackedPercent", "bar3D", "barStacked3D", "barStackedPercent3D", "barStackedPercent3DPerspective", "horizontalBar", "horizontalBarStacked", "horizontalBarStackedPercent", "horizontalBar3D", "horizontalBarStacked3D", "horizontalBarStackedPercent3D", "lineNormal", "lineStacked", "lineStackedPercent", "line3D", "pie", "pie3D", "doughnut", "scatter", "stock", "area", "areaStacked", "areaStackedPercent"],
					"default": "bar"
				},
				"title": {
					"type": "string",
					"description": "Chart title text."
				}
			},
			"required": []
		},
		"examples": [
			{
				"prompt": "Create a bar chart from current selection",
				"arguments": {}
			},
			{
				"prompt": "Create a line chart from current selection",
				"arguments": { "chartType": "lineNormal" }
			},
			{
				"prompt": "Create a pie chart from specific range",
				"arguments": { "range": "A1:B10", "chartType": "pie" }
			},
			{
				"prompt": "Create a chart with title",
				"arguments": { "title": "Sales Overview" }
			}
		]
	});

	func.call = async function(params) {
		Asc.scope.range = params.range;
		Asc.scope.chartType = params.chartType || "bar";
		Asc.scope.title = params.title;

		await Asc.Editor.callCommand(function(){
			let ws = Api.GetActiveSheet();
			let chartRange;

			if (Asc.scope.range) {
				chartRange = Asc.scope.range;
			} else {
				let selection = Api.GetSelection();
				chartRange = selection.GetAddress(true, true, "xlA1", false);
			}

			let range = ws.GetRange(chartRange);
			let fromRow = range.GetRow() + 3;
			let fromCol = range.GetCol();

			let widthEMU = 130 * 36000;
			let heightEMU = 80 * 36000;

			let chart = ws.AddChart(
				chartRange,
				true,
				Asc.scope.chartType,
				2,
				widthEMU,
				heightEMU,
				fromCol,
				0,
				fromRow,
				0
			);
			if (chart && Asc.scope.title) {
				chart.SetTitle(Asc.scope.title, 14);
			}
		});
	};

	return func;
})();
