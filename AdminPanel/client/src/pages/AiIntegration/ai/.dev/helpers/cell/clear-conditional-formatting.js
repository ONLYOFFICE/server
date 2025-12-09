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
		"name": "clearConditionalFormatting",
		"description": "Removes all conditional formatting rules from the specified range or current selection. This function cleans up all existing conditional formatting including color scales, data bars, icon sets, and highlight cell rules, returning cells to their default appearance.",
		"parameters": {
			"type": "object",
			"properties": {
				"range": {
					"type": "string",
					"description": "Cell range to clear formatting (e.g., 'A1:D10'). If omitted, uses active/selected range."
				}
			},
			"required": []
		},
		"examples": [
			{
				"prompt": "Clear all conditional formatting from current selection",
				"arguments": {}
			},
			{
				"prompt": "Clear conditional formatting from range A1:D10",
				"arguments": { "range": "A1:D10" }
			},
			{
				"prompt": "When user asks to remove, delete, clear conditional formatting",
				"arguments": { "range": "A1:D10" }
			}
		]
	});

	func.call = async function(params) {
		Asc.scope.range = params.range;

		await Asc.Editor.callCommand(function() {
			let ws = Api.GetActiveSheet();
			let range;
			if (Asc.scope.range) {
				range = ws.GetRange(Asc.scope.range);
			} else {
				range = ws.Selection;
			}
			
			let formatConditions = range.GetFormatConditions();
			formatConditions.Delete();
		});
	};

	return func;
})();
