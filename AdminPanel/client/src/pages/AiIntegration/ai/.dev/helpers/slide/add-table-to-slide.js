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
		"name": "addTableToSlide",
		"description": "Adds a table to the slide (194x97mm, centered)",
		"parameters": {
			"type": "object",
			"properties": {
				"slideNumber": {
					"type": "number",
					"description": "the slide number to add table",
					"minimum": 1
				},
				"rows": {
					"type": "number",
					"description": "number of rows"
				},
				"columns": {
					"type": "number",
					"description": "number of columns"
				},
				"data": {
					"type": "array",
					"description": "2D array of cell values - rows x columns"
				}
			},
			"required": []
		},
		"examples": [
			{
				"prompt": "add a 3x3 table on slide 2",
				"arguments": {"slideNumber": 2, "rows": 3, "columns": 3}
			},
			{
				"prompt": "add a table with data on current slide",
				"arguments": {"data": [["Name", "Age", "City"], ["John", "30", "New York"], ["Jane", "25", "London"]]}
			}
		]
	});
	
	func.call = async function (params) {
		Asc.scope.params = params;

		await Asc.Editor.callCommand(function () {
			let presentation = Api.GetPresentation();
			let slide;

			if (Asc.scope.params.slideNumber) {
				slide = presentation.GetSlideByIndex(Asc.scope.params.slideNumber - 1);
			}
			else {
				slide = presentation.GetCurrentSlide();
			}

			if (!slide) return;

			let slideWidth = presentation.GetWidth();
			let slideHeight = presentation.GetHeight();

			let data = Asc.scope.params.data;
			let rows = Asc.scope.params.rows || 3;
			let columns = Asc.scope.params.columns || 3;

			if (data && Array.isArray(data) && data.length > 0) {
				rows = data.length;
				if (data[0] && Array.isArray(data[0])) {
					columns = data[0].length;
				}
			}

			let tableWidth = 7000000;
			let tableHeight = 3500000;
			let x = (slideWidth - tableWidth) / 2;
			let y = (slideHeight - tableHeight) / 2;

			let table = Api.CreateTable(columns, rows);

			if (table) {
				table.SetPosition(x, y);
				table.SetSize(tableWidth, tableHeight);
				let rowHeight = tableHeight / rows;
				if (data && Array.isArray(data)) {
					let rowCount = Math.min(data.length, rows);
					for (let rowIdx = 0; rowIdx < rowCount; rowIdx++) {
						let row = table.GetRow(rowIdx);
						if (Array.isArray(data[rowIdx])) {
							let cellCount = Math.min(data[rowIdx].length, columns);
							for (let col = 0; col < cellCount; col++) {
								let cell = row.GetCell(col);
								if (cell) {
									let cellContent = cell.GetContent();
									if (cellContent) {
										cellContent.RemoveAllElements();
										let paragraph = Api.CreateParagraph();
										let value = data[rowIdx][col];
										if (value !== null && value !== undefined) {
											paragraph.AddText(value);
											cellContent.Push(paragraph);
										}
									}
								}
							}
						}
					}
				}

				slide.AddObject(table);
			}
		});
	};
	return func;
})();
