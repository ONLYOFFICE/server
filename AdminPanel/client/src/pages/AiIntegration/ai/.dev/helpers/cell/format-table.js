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
		"name": "formatTable",
		"description": "Applies professional table formatting to a data range with consistent styling, colors, and alignment. Features include: automatic or manual color scheme selection (blue, green, orange, gray, red), alternating row colors for readability, optional header row formatting (bold, centered, colored background), table borders, and automatic column width adjustment. Can auto-detect existing formatting to avoid overriding intentional styles. Supports smart content-based text alignment (right-align numbers, left-align text).",
		"parameters": {
			"type": "object",
			"properties": {
				"range": {
					"type": "string",
					"description": "Cell range to format as a table (e.g., 'A1:D10'). If omitted, uses active/selected range or entire sheet if no selection."
				},
				"applyHeaderStyle": {
					"type": "boolean",
					"description": "Whether to apply bold and center alignment to first row as headers (default: true).",
					"default": true
				},
				"applyBorders": {
					"type": "boolean",
					"description": "Whether to apply borders to the table (default: true).",
					"default": true
				},
				"colorScheme": {
					"type": "string",
					"description": "Color scheme to apply ('blue', 'green', 'orange', 'gray', 'red', or 'auto' for dominant color detection, default: 'auto').",
					"enum": ["blue", "green", "orange", "gray", "red", "auto"],
					"default": "auto"
				},
				"detectHeaders": {
					"type": "boolean",
					"description": "Whether to automatically detect headers based on content (default: true).",
					"default": true
				}
			},
			"required": []
		},
		"examples": [
			{
				"prompt": "Format the selected range as a clean, consistent table",
				"arguments": {}
			},
			{
				"prompt": "Format range A1:E10 as a table with blue color scheme",
				"arguments": { "range": "A1:E10", "colorScheme": "blue" }
			},
			{
				"prompt": "Format current selection as table without header styling",
				"arguments": { "applyHeaderStyle": false }
			},
			{
				"prompt": "Format the entire sheet with green color scheme and borders",
				"arguments": { "colorScheme": "green", "applyBorders": true }
			},
			{
				"prompt": "Format selected range detecting dominant style automatically",
				"arguments": { "colorScheme": "auto" }
			}
		]
	});

	func.call = async function(params) {
		Asc.scope.range = params.range;
		Asc.scope.applyHeaderStyle = params.applyHeaderStyle !== false; // default true
		Asc.scope.applyBorders = params.applyBorders !== false; // default true
		Asc.scope.colorScheme = params.colorScheme || 'auto';
		Asc.scope.detectHeaders = params.detectHeaders !== false; // default true

		await Asc.Editor.callMethod("StartAction", ["GroupActions", "Format table"]);

		await Asc.Editor.callCommand(function(){
			let ws = Api.GetActiveSheet();
			let _range;

			if (!Asc.scope.range) {
				_range = Api.GetSelection();
				// If no selection, use the used range of the sheet
				if (!_range || (_range.GetRowsCount() === 1 && _range.GetColumnsCount() === 1)) {
					_range = ws.GetUsedRange();
				}
			} else {
				_range = ws.GetRange(Asc.scope.range);
			}

			if (!_range)
				return;

		
			let rowsCount = _range.GetRowsCount();
			let colsCount = _range.GetColumnsCount();

			// Color schemes definition
			let colorSchemes = {
				blue: { header: '#4472C4', alternate1: '#D9E2F3', alternate2: '#FFFFFF', text: '#000000' },
				green: { header: '#70AD47', alternate1: '#E2EFDA', alternate2: '#FFFFFF', text: '#000000' },
				orange: { header: '#C65911', alternate1: '#FCE4D6', alternate2: '#FFFFFF', text: '#000000' },
				gray: { header: '#7B7B7B', alternate1: '#F2F2F2', alternate2: '#FFFFFF', text: '#000000' },
				red: { header: '#C5504B', alternate1: '#F2DCDB', alternate2: '#FFFFFF', text: '#000000' }
			};

			let selectedScheme = colorSchemes.blue; // default

			// Auto-detect dominant color if requested
			if (Asc.scope.colorScheme === 'auto') {
				// Sample some cells to detect dominant colors
				let colorCounts = {};
				let sampleSize = Math.min(10, rowsCount * colsCount);
				
				for (let i = 0; i < Math.min(5, rowsCount); i++) {
					for (let j = 0; j < Math.min(5, colsCount); j++) {
						let cell = _range.GetRows(i).GetCells(j);
						try {
							let fill = cell.GetFillColor();
							if (fill) {
								let colorStr = fill.GetHexColor();
								if (colorStr && colorStr !== '#FFFFFF' && colorStr !== '#000000') {
									colorCounts[colorStr] = (colorCounts[colorStr] || 0) + 1;
								}
							}
						} catch(e) {
							// Ignore errors in color detection
						}
					}
				}

				// Find most common color and match to scheme
				let dominantColor = null;
				let maxCount = 0;
				for (let color in colorCounts) {
					if (colorCounts[color] > maxCount) {
						maxCount = colorCounts[color];
						dominantColor = color;
					}
				}

				// Map dominant color to closest scheme
				if (dominantColor) {
					let colorLower = dominantColor.toLowerCase();
					if (colorLower.includes('4472c4') || colorLower.includes('blue')) {
						selectedScheme = colorSchemes.blue;
					} else if (colorLower.includes('70ad47') || colorLower.includes('green')) {
						selectedScheme = colorSchemes.green;
					} else if (colorLower.includes('c65911') || colorLower.includes('orange')) {
						selectedScheme = colorSchemes.orange;
					} else if (colorLower.includes('c5504b') || colorLower.includes('red')) {
						selectedScheme = colorSchemes.red;
					} else {
						selectedScheme = colorSchemes.gray;
					}
				}
			} else if (colorSchemes[Asc.scope.colorScheme]) {
				selectedScheme = colorSchemes[Asc.scope.colorScheme];
			}

			// Apply header formatting if requested
			if (Asc.scope.applyHeaderStyle && rowsCount > 0) {
				let headerRow = _range.GetRows(0);
				
				// Check if headers are already formatted (to avoid overriding intentional formatting)
				let shouldFormatHeaders = true;
				if (Asc.scope.detectHeaders) {
					// Simple header detection: check if first row looks different or contains text while others contain numbers
					try {
						let firstCell = headerRow.GetCells(0);
						let isBold = firstCell.GetBold();
						if (isBold) {
							shouldFormatHeaders = false; // Already formatted
						}
					} catch(e) {
						// Continue with formatting
					}
				}

				if (shouldFormatHeaders) {
					// Format header row
					headerRow.SetBold(true);
					headerRow.SetAlignHorizontal('center');
					headerRow.SetAlignVertical('center');
					
					// Apply header color
					let headerColor = Api.CreateColorFromRGB(
						parseInt(selectedScheme.header.substring(1, 3), 16),
						parseInt(selectedScheme.header.substring(3, 5), 16),
						parseInt(selectedScheme.header.substring(5, 7), 16)
					);
					headerRow.SetFillColor(headerColor);
					
					// Set header text color to white for better contrast
					let headerTextColor = Api.CreateColorFromRGB(255, 255, 255);
					headerRow.SetFontColor(headerTextColor);
				}
			}

			// Apply alternating row colors for data rows
			let startRow = Asc.scope.applyHeaderStyle ? 1 : 0;
			for (let i = startRow; i < rowsCount; i++) {
				let row = _range.GetRows(i);
				let isEvenRow = ((i - startRow) % 2) === 0;
				
				let bgColorHex = isEvenRow ? selectedScheme.alternate1 : selectedScheme.alternate2;
				let bgColor = Api.CreateColorFromRGB(
					parseInt(bgColorHex.substring(1, 3), 16),
					parseInt(bgColorHex.substring(3, 5), 16),
					parseInt(bgColorHex.substring(5, 7), 16)
				);
				row.SetFillColor(bgColor);

				// Set consistent text color
				let textColor = Api.CreateColorFromRGB(
					parseInt(selectedScheme.text.substring(1, 3), 16),
					parseInt(selectedScheme.text.substring(3, 5), 16),
					parseInt(selectedScheme.text.substring(5, 7), 16)
				);
				row.SetFontColor(textColor);

				// Apply consistent text alignment for data
				for (let j = 0; j < colsCount; j++) {
					let cell = row.GetCells(j);
					try {
						let value = cell.GetValue();
						// Auto-align based on content type
						if (typeof value === 'number' || (typeof value === 'string' && !isNaN(parseFloat(value)) && isFinite(value))) {
							cell.SetAlignHorizontal('right');
						} else {
							cell.SetAlignHorizontal('left');
						}
						cell.SetAlignVertical('center');
					} catch(e) {
						// Default alignment if detection fails
						cell.SetAlignHorizontal('left');
						cell.SetAlignVertical('center');
					}
				}
			}

			// Apply borders if requested
			if (Asc.scope.applyBorders) {
				// Set border style
				let borderStyle = 'thin';
				let borderColor = Api.CreateColorFromRGB(128, 128, 128); // Gray border

				// Apply borders to the entire range
				for (let i = 0; i < rowsCount; i++) {
					for (let j = 0; j < colsCount; j++) {
						let cell = _range.GetRows(i).GetCells(j);
						
						// Top border
						if (i === 0) {
							cell.SetBorders('top', borderStyle, borderColor);
						}
						// Bottom border  
						if (i === rowsCount - 1) {
							cell.SetBorders('bottom', borderStyle, borderColor);
						}
						// Left border
						if (j === 0) {
							cell.SetBorders('left', borderStyle, borderColor);
						}
						// Right border
						if (j === colsCount - 1) {
							cell.SetBorders('right', borderStyle, borderColor);
						}
						
						// Inner horizontal borders
						if (i > 0) {
							cell.SetBorders('top', borderStyle, borderColor);
						}
						// Inner vertical borders  
						if (j > 0) {
							cell.SetBorders('left', borderStyle, borderColor);
						}
					}
				}
			}

			// Auto-fit column widths for better appearance
			try {
				for (let j = 0; j < colsCount; j++) {
					let col = _range.GetCols(j);
					col.AutoFit();
				}
			} catch(e) {
				// Auto-fit may not be available in all contexts
			}
		});

		await Asc.Editor.callMethod("EndAction", ["GroupActions"]);
	};

	return func;
})();
