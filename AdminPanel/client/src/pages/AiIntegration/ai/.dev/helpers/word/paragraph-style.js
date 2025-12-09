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
		"name": "changeParagraphStyle",
		"description": "Changes the style of a specified paragraph in the document. If no paragraph number is provided, affects the current paragraph.",
		"parameters": {
			"type": "object",
			"properties": {
				"parNumber": {
					"type": "number",
					"description": "The paragraph number to apply style changes to. If not provided, the current paragraph will be used."
				},
				"style": {
					"type": "string",
					"description": "The style name to apply to the paragraph (e.g., 'Heading 1', 'Normal', etc.)."
				}
			},
			"required": ["style"]
		},
		"examples": [
			{
				"prompt": "Change paragraph 3 to Heading 1 style",
				"arguments": { "parNumber": 3, "style": "Heading 1" }
			},
			{
				"prompt": "Apply Normal style to paragraph 2",
				"arguments": { "parNumber": 2, "style": "Normal" }
			},
			{
				"prompt": "Make paragraph 5 a heading",
				"arguments": { "parNumber": 5, "style": "Heading 2" }
			},
			{
				"prompt": "Change current paragraph to heading style",
				"arguments": { "style": "Heading 1" }
			}
		]
	});
	
	func.call = async function(params) {
		Asc.scope.parNumber = params.parNumber;
		Asc.scope.styleName = params.style;
		await Asc.Editor.callCommand(function(){
			let doc = Api.GetDocument();
			let par = undefined === Asc.scope.parNumber ? doc.GetCurrentParagraph() : doc.GetElement(Asc.scope.parNumber - 1);
			if (!par)
				return;
			let style = doc.GetStyle(Asc.scope.styleName);
			par.SetStyle(style);
		});
	};

	return func;
})();
