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
		"name": "explainFormula",
		"description": "Analyzes and explains Excel formulas in natural language. Uses AI to provide detailed explanations of formula logic, function parameters, nested operations, and expected results. The explanation is added as a cell comment to the cell containing the formula. Particularly useful for understanding complex formulas with multiple nested functions or unfamiliar Excel functions. Keeps explanations concise (under 1024 characters recommended) while covering all essential information.",
		"parameters": {
			"type": "object",
			"properties": {
				"range": {
					"type": "string",
					"description": "Cell range containing formula to explain (e.g., 'A1'). If omitted, uses active/selected cell."
				}
			},
			"required": []
		},
		"examples": [
			{
				"prompt": "Explain formula in active cell",
				"arguments": {}
			},
			{
				"prompt": "Explain formula in specific cell A1",
				"arguments": { "range": "A1" }
			},
			{
				"prompt": "Explain formula in cell B5",
				"arguments": { "range": "B5" }
			}
		]
	});

	func.call = async function(params) {
		Asc.scope.range = params.range;

		let formulaData = await Asc.Editor.callCommand(function(){
			let ws = Api.GetActiveSheet();
			let _range;

			if (!Asc.scope.range) {
				_range = Api.GetSelection();
			} else {
				_range = ws.GetRange(Asc.scope.range);
			}

			if (!_range || !_range.GetCells(1, 1)) {
				return null;
			}

			let cell = _range.GetCells(1, 1);
			let formula = cell.GetFormula();
			let cellAddress = cell.GetAddress();
			
			return {
				formula: formula,
				address: cellAddress,
				hasFormula: formula && formula.toString().startsWith('=')
			};
		});

		if (!formulaData || !formulaData.hasFormula) {
			return; // No formula to explain
		}

		let argPrompt = "Explain the following Excel formula in detail:\n\n" +
			"Formula: " + formulaData.formula + "\n" +
			"Cell: " + formulaData.address + "\n\n" +
			"IMPORTANT RULES:\n" +
			"1. Provide a clear, detailed explanation of what the formula does.\n" +
			"2. Break down each part of the formula if it's complex.\n" +
			"3. Explain the functions used and their parameters.\n" +
			"4. Describe the expected result or output.\n" +
			"5. Use simple, understandable language.\n" +
			"6. If there are nested functions, explain the order of operations.\n" +
			"7. Mention any potential issues or common mistakes.\n" +
			"8. Keep the explanation concise but comprehensive.\n" +
			"9. Be brief and avoid unnecessary verbose explanations.\n" +
			"10. Get straight to the point without filler text.\n" +
			"11. Focus only on essential information.\n" +
			"12. Keep response length under 1024 characters (recommended), maximum 32767 characters.\n" +
			"13. Prioritize the most important information if length constraint requires cuts.\n\n" +
			"Please provide a detailed but concise explanation of this formula.";

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

		let explanation = await requestEngine.chatRequest(argPrompt, false, async function(data) {
			if (!data)
				return;
			await checkEndAction();
		});

		await checkEndAction();
		await Asc.Editor.callMethod("EndAction", ["GroupActions"]);

		// Add comment with explanation to the cell
		if (explanation) {
			Asc.scope.explanation = explanation;
			await Asc.Editor.callCommand(function(){
				let ws = Api.GetActiveSheet();
				let _range;

				if (!Asc.scope.range) {
					_range = Api.GetSelection();
				} else {
					_range = ws.GetRange(Asc.scope.range);
				}

				if (_range) {
					let cell = _range.GetCells(1, 1);
					if (cell) {
						// Create comment with formula explanation
						let commentText = "Formula Explanation:\n\n" + Asc.scope.explanation;
						cell.AddComment(commentText, "AI Assistant");
					}
				}
			});
		}
	};

	return func;
})();
