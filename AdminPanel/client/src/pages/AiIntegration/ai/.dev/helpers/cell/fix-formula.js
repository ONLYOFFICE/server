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
		"name": "fixFormula",
		"description": "Scans cells for formulas containing errors and attempts to fix them automatically. Detects common formula errors including #DIV/0! (division by zero), #REF! (invalid cell references), #NAME? (unrecognized function names), #VALUE! (wrong value types), and #N/A (value not available). Applies appropriate fixes: wraps division operations in IF statements, corrects cell references, fixes function name typos, and adds IFERROR wrappers. Preserves formulas that have no errors. Can scan entire sheet or specific range.",
		"parameters": {
			"type": "object",
			"properties": {
				"range": {
					"type": "string",
					"description": "Cell range to fix formulas (e.g., 'A1:D10'). If omitted, scans entire sheet."
				}
			},
			"required": []
		},
		"examples": [
			{
				"prompt": "Fix formula errors in entire sheet",
				"arguments": {}
			},
			{
				"prompt": "Fix formula errors in specific range A1:D10",
				"arguments": { "range": "A1:D10" }
			},
			{
				"prompt": "Find and fix formula errors like #DIV/0!, #REF!, #NAME?",
				"arguments": {}
			},
			{
				"prompt": "Scan and correct formula errors in selected range",
				"arguments": { "range": "A1:Z100" }
			}
		]
	});

	func.call = async function(params) {
		Asc.scope.range = params.range;

		let rangeData = await Asc.Editor.callCommand(function(){
			let ws = Api.GetActiveSheet();
			let _range;

			if (!Asc.scope.range) {
				_range = ws.GetUsedRange();
			} else {
				_range = ws.GetRange(Asc.scope.range);
			}

			if (!_range)
				return null;

			let formulaData = [];
			let startRow = _range.Row;
			let startCol = _range.Col;

			// Use ForEach to iterate through each cell and get formulas
			_range.ForEach(function(cell) {
				let formula = cell.GetFormula();
				if (formula && formula.startsWith('=')) {
					let cellRow = cell.Row - startRow;
					let cellCol = cell.Col - startCol;
					
					formulaData.push({
						row: cellRow,
						col: cellCol,
						formula: formula,
						cellValue: formula,
						address: cell.Address
					});
				}
			});

			return {
				formulas: formulaData,
				startRow: startRow,
				startCol: startCol
			};
		});

		if (!rangeData || !rangeData.formulas || rangeData.formulas.length === 0) {
			return;
		}

		let formulaData = rangeData.formulas;
		let formulaValues = formulaData.map(function(item) { return item.cellValue; });
		
		let argPrompt = "Fix formulas with errors in this array: [" + formulaValues.join(',') + "]\n\n" +
			"Return ONLY a JSON array of fixed formulas.\n" +
			"Fix common errors: #DIV/0! (use IF), #REF! (fix references), #NAME? (fix typos), #VALUE! (fix types), #N/A (use IFERROR)\n" +
			"If formula has no errors, return it unchanged.\n" +
			"Example: input [=A1/B1,=SUM(A:A)] return [=IF(B1<>0,A1/B1,0),=SUM(A:A)]\n" +
			"CRITICAL: Response must be ONLY the JSON array, nothing else.\n" +
			"Invalid data formats are not allowed - must be valid JSON array format.\n" +
			"No text, no explanations, no additional formatting - ONLY [\"=formula1\",\"=formula2\"] format:";

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
				let fixedFormulas = JSON.parse(aiResult.trim());
				if (Array.isArray(fixedFormulas) && fixedFormulas.length > 0) {
					Asc.scope.fixedFormulas = fixedFormulas;
					Asc.scope.formulaData = formulaData;
					Asc.scope.rangeData = rangeData;
					
					await Asc.Editor.callCommand(function(){
						let ws = Api.GetActiveSheet();
						
						for (let i = 0; i < Asc.scope.fixedFormulas.length && i < Asc.scope.formulaData.length; i++) {
							let fixedFormula = Asc.scope.fixedFormulas[i];
							let originalFormula = Asc.scope.formulaData[i];
							
							if (fixedFormula && originalFormula && typeof fixedFormula === 'string') {
								let targetRow = Asc.scope.rangeData.startRow + originalFormula.row;
								let targetCol = Asc.scope.rangeData.startCol + originalFormula.col;
								
								let cell = ws.GetCells(targetRow, targetCol);
								if (cell) {
									cell.SetValue(fixedFormula);
								}
							}
						}
					});
				}
			} catch (error) {
				console.error("Error parsing formula fix result:", error);
			}
		}

		await Asc.Editor.callMethod("EndAction", ["GroupActions"]);
	};

	return func;
})();
