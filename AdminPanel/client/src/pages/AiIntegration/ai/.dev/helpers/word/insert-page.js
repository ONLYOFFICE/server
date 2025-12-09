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
		"name": "insertPage",
		"description": "Inserts a blank page at the specified location in the document.",
		"parameters": {
			"type": "object",
			"properties": {
				"location": {
					"type": "string",
					"enum": ["current", "start", "end"],
					"description": "Where to insert the new page ('current', 'start', or 'end').",
					"default": "current"
				}
			},
			"required": ["location"]
		},
		"examples": [
			{
				"prompt": "Insert a blank page at current position",
				"arguments": { "location": "current" }
			}, 
			{
				"prompt": "Add a new page at the end",
				"arguments": { "location": "end" }
			},
			{
				"prompt": "Add a page at the beginning",
				"arguments": { "location": "start" }
			}
		],
		"returns": {
			"type": "object",
			"description": "An object indicating whether the page was successfully inserted.",
			"properties": {
				"isApply": {
					"type": "boolean",
					"description": "Indicates whether the blank page was successfully inserted at the specified location."
				}
			},
			"required": ["isApply"]
		}
	});
	
	func.call = async function(params) {
		Asc.scope.location = params.location;

		await Asc.Editor.callCommand(function(){
			let doc = Api.GetDocument();
			if ("start" === Asc.scope.location)
				doc.MoveCursorToStart();
			else if ("end" === Asc.scope.location)
				doc.MoveCursorToEnd();

			Api.GetDocument().InsertBlankPage();
		});
	};
	
	return func;
})();
