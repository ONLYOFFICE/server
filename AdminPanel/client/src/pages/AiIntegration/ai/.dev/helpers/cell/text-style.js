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
		"description": "Applies text formatting styles to cells in the specified range or current selection. Supports comprehensive text styling options including bold, italic, underline (multiple types), strikeout, font family, font size, and font color. Colors can be specified using hex codes (#FF0000) or preset color names (red, blue, etc.). All formatting parameters are optional - only specified properties will be changed, leaving others unchanged.",
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
					"type": "string",
					"description": "Underline type to apply.",
					"enum": ["none", "single", "singleAccounting", "double", "doubleAccounting"]
				},
				"strikeout": {
					"type": "boolean",
					"description": "Whether to strike through the text (true to enable, false to disable)."
				},
				"fontSize": {
					"type": "number",
					"description": "Font size to apply to the selected cell(s).",
					"minimum": 1,
					"maximum": 200
				},
				"fontName": {
					"type": "string",
					"description": "Font family name to apply to the selected cell(s)."
				},
				"fontColor": {
					"type": "string",
					"description": "Font color (hex color like '#FF0000' or preset color name like 'red')."
				},
				"range": {
					"type": "string",
					"description": "Cell range to format (e.g., 'A1:B5'). If omitted, uses current selection."
				}
			},
			"required": []
		},
		"examples": [
			{
				"prompt": "Make selected cells bold and italic",
				"arguments": { "bold": true, "italic": true }
			},
			{
				"prompt": "Underline selected cells",
				"arguments": { "underline": "single" }
			},
			{
				"prompt": "Strike out selected cells",
				"arguments": { "strikeout": true }
			},
			{
				"prompt": "Set font size to 18",
				"arguments": { "fontSize": 18 }
			},
			{
				"prompt": "Change font to Arial and make it red",
				"arguments": { "fontName": "Arial", "fontColor": "red" }
			},
			{
				"prompt": "Format range A1:C3 as bold",
				"arguments": { "range": "A1:C3", "bold": true }
			},
			{
				"prompt": "Remove italics from selected cells",
				"arguments": { "italic": false }
			}
		]
	});

	func.call = async function(params) {
		Asc.scope.bold = params.bold;
		Asc.scope.italic = params.italic;
		Asc.scope.underline = params.underline;
		Asc.scope.strikeout = params.strikeout;
		Asc.scope.fontSize = params.fontSize;
		Asc.scope.fontName = params.fontName;
		Asc.scope.fontColor = params.fontColor;
		Asc.scope.range = params.range;

		await Asc.Editor.callCommand(function(){
			let ws = Api.GetActiveSheet();
			let _range;

			if (!Asc.scope.range) {
				_range = Api.GetSelection();
			} else {
				_range = ws.GetRange(Asc.scope.range);
			}

			if (!_range)
				return;

			if (undefined !== Asc.scope.bold)
				_range.SetBold(Asc.scope.bold);

			if (undefined !== Asc.scope.italic)
				_range.SetItalic(Asc.scope.italic);

			if (undefined !== Asc.scope.underline)
				_range.SetUnderline(Asc.scope.underline);

			if (undefined !== Asc.scope.strikeout)
				_range.SetStrikeout(Asc.scope.strikeout);

			if (undefined !== Asc.scope.fontSize)
				_range.SetFontSize(Asc.scope.fontSize);

			if (undefined !== Asc.scope.fontName)
				_range.SetFontName(Asc.scope.fontName);

			if (undefined !== Asc.scope.fontColor) {
				// Handle different color formats
				let color;
				if (Asc.scope.fontColor.startsWith('#')) {
					// Hex color
					color = Api.CreateColorFromRGB(
						parseInt(Asc.scope.fontColor.substring(1, 3), 16),
						parseInt(Asc.scope.fontColor.substring(3, 5), 16),
						parseInt(Asc.scope.fontColor.substring(5, 7), 16)
					);
				} else {
					// Preset color name
					color = Api.CreateColorByName(Asc.scope.fontColor);
				}
				if (color)
					_range.SetFontColor(color);
			}
		});
	};

	return func;
})();
