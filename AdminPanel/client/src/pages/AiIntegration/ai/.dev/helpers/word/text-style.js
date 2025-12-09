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
		"name": "changeTextStyle",
		"description": "Changes the style of the selected text, including bold, italic, underline, strikethrough, and font size.",
		"parameters": {
			"type": "object",
			"properties": {
				"bold": {
					"type": "boolean",
					"description": "Whether to make the text bold (true to enable, false to disable)."
				},
				"italic": {
					"type": "boolean",
					"description": "Whether to make the text italic (true to enable, false to disable)."
				},
				"underline": {
					"type": "boolean",
					"description": "Whether to underline the text (true to enable, false to disable)."
				},
				"strikeout": {
					"type": "boolean",
					"description": "Whether to strike through the text (true to enable, false to disable)."
				},
				"fontSize": {
					"type": "number",
					"description": "The font size to apply to the selected text.",
					"minimum": 1,
					"maximum": 200
				}
			},
			"required": []
		},
		"examples": [
			{
				"prompt": "Make selected text bold and italic",
				"arguments": { "bold": true, "italic": true }
			},
			{
				"prompt": "Underline selected text",
				"arguments": { "underline": true }
			},
			{
				"prompt": "Strike out selected text",
				"arguments": { "strikeout": true }
			},
			{
				"prompt": "Set font size to 18",
				"arguments": { "fontSize": 18 }
			},
			{
				"prompt": "Remove italics",
				"arguments": { "italic": false }
			}
		],
		"returns": {
			"type": "object",
			"description": "An object indicating which styles were changed.",
			"properties": {
				"isApply": {
					"type": "boolean",
					"description": "Indicates whether the text style was changed."
				}
			},
			"required": ["isApply"]		
		}
	});
	
	func.call = async function(params) {
		Asc.scope.params = params;
		await Asc.Editor.callCommand(function(){
			let doc = Api.GetDocument();
			let range = doc.GetRangeBySelect();
			if (!range || "" === range.GetText())
			{
				doc.SelectCurrentWord();
				range = doc.GetRangeBySelect();
			}

			if (!range)
				return;

			let props = Asc.scope.params;

			if (undefined !== props.bold)
				range.SetBold(props.bold);

			if (undefined !== props.italic)
				range.SetItalic(props.italic);

			if (undefined !== props.underline)
				range.SetUnderline(props.underline);

			if (undefined !== props.strikeout)
				range.SetStrikeout(props.strikeout);

			if (undefined !== props.fontSize)
				range.SetFontSize(props.fontSize);
		});
	};

	return func;
})();
