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

function getCellFunctions() {

	let funcs = [];

	if (true) {
		let func = new RegisteredFunction();
		func.name = "insertPivotTable";
		func.params = [
			"range (string, optional): cell range to apply autofilter (e.g., 'A1:D10'). If omitted, uses active/selected range",
			"columns (array, optional): array of column names to use for pivot rows (categorical/grouping)",
			"valueColumn (string, optional): column name to use for pivot values (numeric/aggregate)",
		];

		func.examples = [
			"Create or summarize the current selection with a pivot table."+
			"Use when the user requests a pivot table or asks to group/aggregate/analyze data(selection):\n" +
			"[functionCalling (insertPivotTable)]: {}",

			"If you need to insert pivot table to range A1:D10, respond:" +
			"[functionCalling (insertPivotTable)]: {\"range\": \"A1:D10\"}",

			"Create or summarize the current grouping columns with a pivot table."+
			"Use when the user requests a pivot table or asks to group/aggregate/analyze specific grouping columns:\n" +
			"[functionCalling (insertPivotTable)]: {\"columns\": [\"Column1\", \"Column2\"]}",

			"Create or summarize the numeric value columns with a pivot table."+
			"Use when the user requests a pivot table or asks to group/aggregate/analyze numeric value columns:\n" +
			"[functionCalling (insertPivotTable)]: {\"valueColumn\": \"Column3\"}"
		];

		func.call = async function(params) {
			Asc.scope.range = params.range;
			const columns = params.columns || [];
			const valueColumn = params.valueColumn || "";
			Asc.scope.rowCountToLookup = 20;
			// Generate relevant sheet name based on user params (language-neutral)
			let nameParts = [];
			if (columns.length > 0) {
				nameParts = columns.slice(0, 2); // Max 2 for readability
			}
			if (valueColumn) {
				nameParts.push(valueColumn);
			}
			let newSheetName = nameParts.length > 0 ? nameParts.join('_') : 'Pivot Analysis';
			// Excel limit 31 (reserve space for uniqueness suffix)
			if (newSheetName.length > 28) {
				newSheetName = newSheetName.substring(0, 28);
			}
			Asc.scope.newSheetName = newSheetName;
			//insert pivot table
			let insertRes = await Asc.Editor.callCommand(function(){
				function limitRangeToRows(address, maxRows) {
					const digits = address.match(/\d+/g);
					if (!digits || digits.length < 2) {
						return address;
					}
					const startRow = parseInt(digits[0], 10);
					const endRow = parseInt(digits[1], 10);
					const currentRowCount = endRow - startRow + 1;
					if (currentRowCount <= maxRows) {
						return address;
					}
					const limitedEndRow = startRow + maxRows - 1;
					return address.replace(/\d+(?=\D*$)/, limitedEndRow.toString());
				}
				function createUniqueSheetName(newSheetName) {
					let sheets = Api.Sheets;
					let items = [];
					for (let i = 0; i < sheets.length; i++) {
						items.push(sheets[i].Name.toLowerCase());
					}
					if (items.indexOf(newSheetName.toLowerCase()) < 0) {
						return newSheetName;
					}
					let index = 0, name;
					while(++index < 1000) {
						name = newSheetName + '_'+ index;
						if (items.indexOf(name.toLowerCase()) < 0) break;
					}

					newSheetName = name;
					return newSheetName;
				}
				let pivotTable;
				if (Asc.scope.range) {
					let ws = Api.GetActiveSheet();
					let range = ws.GetRange(Asc.scope.range);
					pivotTable = Api.InsertPivotNewWorksheet(range, createUniqueSheetName(Asc.scope.newSheetName));
				} else {
					pivotTable = Api.InsertPivotNewWorksheet(undefined, createUniqueSheetName(Asc.scope.newSheetName));
				}
				let wsSource = pivotTable.Source.Worksheet;
				let addressSource = pivotTable.Source.Address;
				// Apply row limitation
				addressSource = limitRangeToRows(addressSource, Asc.scope.rowCountToLookup);
				let rangeSource = wsSource.GetRange(addressSource);
				return [pivotTable.GetParent().Name, pivotTable.TableRange1.Address, rangeSource.GetValue2()];
			});

			//make csv from source data
			let colsMaxIndex = 0;
			let sheetName = insertRes[0];
			let address = insertRes[1];
			let csv = insertRes[2].map(function(item){
				return item.map(function(value) {
					if (value == null) return '';
					colsMaxIndex = value.length;
					const str = String(value);
					if (str.includes(',') || str.includes('\n') || str.includes('\r') || str.includes('"')) {
						return '"' + str.replace(/"/g, '""') + '"';
					}
					return str;
				}).join(',');
			}).join('\n');

			//make ai request for indices to aggregate
			const argPrompt = [
				"You are a data analyst.",
				"Input is CSV (comma-separated, ','). Can contain empty cells. Columns are zero-based from 0 to " + colsMaxIndex + ".",
				"Rules:",
				"1. Column selection priority:",
				"   a) If mandatory grouping columns are specified and found: use ONLY those matched columns as pivot rows.",
				"   b) If no mandatory columns or none found: choose 1–2 best column indices for pivot rows (categorical/grouping).",
				"2. For automatic column selection (when no mandatory columns found):",
				"   a) Contain textual (non-numeric) data.",
				"   b) Prefer columns with at least 2 distinct values.",
				"   c) Prefer columns that have at least one repeated value (i.e., not all values are unique and not all identical).",
				"   If no column fully satisfies these preferences, pick the best available textual option.",
				"3. Mandatory grouping columns: " + columns.join(', ') + " (comma-separated header names).",
				"   - Use approximate (fuzzy) matching against header cells: case-insensitive, ignore spaces/punctuation.",
				"   - If multiple headers match the same required name, pick the one with the highest similarity (tie-breaker: lowest index).",
				"   - IMPORTANT: If any mandatory columns are matched, use ONLY those matched columns. Do NOT add additional columns.",
				"4. Choose exactly 1 column index for pivot values (numeric/aggregate). Prefer a numeric column; otherwise pick one that can be meaningfully aggregated.",
				"5. Mandatory value column (combined with selection of the data index): " + valueColumn + " (single header name, can be empty).",
				"   - Use the same fuzzy matching rules (case-insensitive, ignore spaces/punctuation).",
				"   - If found, use its index as the ONLY pivot value column.",
				"   - Fallback: If no acceptable match is found, choose the best available numeric column (or the most aggregatable one) as the value column.",
				"   - If a fallback is used, still follow all output rules (numbers only, correct braces).",
				"6. Ordering rule: Within the rows list and within the columns list, place indices in descending order of “grouping potential” (more suitable for grouping first). Use ascending numeric order only to break ties.",
				"   Definition of “grouping potential”: medium-to-high cardinality (not all identical, not all unique), well-distributed categories, likely to produce useful pivot groups.",
				"7. The answer MUST start with '{' and end with '}'. Missing braces = invalid.",
				"8. No extra text, spaces, or newlines.",
				"9. Output ONLY numbers, no labels like 'rows:' or 'data:'.",
				"Output format examples:",
				"- Single row field: {1|3} (row index 1, data index 3)",
				"- Two row fields: {2,0|4} (row indices 2,0, data index 4)",
				"Do NOT output: {rows:1|data:2} - this is wrong!",
				"DO output: {1|2} - this is correct!",
				"CSV:",
				csv
			  ].join('\n');

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
			await Asc.Editor.callMethod("EndAction", ["GroupActions"]);

			//Parse AI result
			function parseAIResult(result) {
				const matches = result.match(/\{([^}]+)\}/g);
				if (!matches) return null;

				let content = null;
				for (let i = 0; i < matches.length; i++) {
					const bracesContent = matches[i].slice(1, -1);
					if (/\d/.test(bracesContent)) { // Check if contains any digit
						content = bracesContent;
						break;
					}
				}

				if (!content) return null;

				const sections = content.split('|');
				if (sections.length !== 2) return null;

				const rowMatches = sections[0].match(/\d+/g) || [];
				const rowIndices = rowMatches.map(s => parseInt(s, 10)).filter(n => !isNaN(n));

				const dataMatches = sections[1].match(/\d+/g) || [];
				const dataIndex = dataMatches.length > 0 ? parseInt(dataMatches[0], 10) : NaN;

				if (rowIndices.length === 0 || isNaN(dataIndex)) return null;
				return {
					rowIndices,
					colIndices: [],
					dataIndex
				};
			}
			Asc.scope.address = address;
			Asc.scope.sheetName = sheetName;
			Asc.scope.parsedResult = parseAIResult(aiResult);
			if (Asc.scope.parsedResult) {
				//add pivot fields and data values
				await Asc.Editor.callCommand(function() {
					let ws = Api.GetSheet(Asc.scope.sheetName);
					if (!ws) {
						return;
					}
					let range = ws.GetRange(Asc.scope.address);
					let pivotTable = range.PivotTable;
					if (pivotTable) {
						let pivotFields = pivotTable.GetPivotFields();
						const parsedResult = Asc.scope.parsedResult;
						const rowNames = [];
						for (let i = 0; i < parsedResult.rowIndices.length; i++) {
							const rowIndex = parsedResult.rowIndices[i];
							if (rowIndex < pivotFields.length) {
								rowNames.push(pivotFields[rowIndex].GetName());
							}
						}
						const colNames = [];
						for (let j = 0; j < parsedResult.colIndices.length; j++) {
							const colIndex = parsedResult.colIndices[j];
							if (colIndex < pivotFields.length) {
								colNames.push(pivotFields[colIndex].GetName());
							}
						}
						let dataName = "";
						if (parsedResult.dataIndex < pivotFields.length) {
							dataName = pivotFields[parsedResult.dataIndex].GetName();
						}

						if (rowNames.length > 0 || colNames.length > 0) {
							pivotTable.AddFields({rows: rowNames, columns: colNames});
						}

						if (dataName) {
							pivotTable.AddDataField(dataName);
						}
					}
				});
			}
		};

		funcs.push(func);
	}


   if (true)
    {
        let func = new RegisteredFunction();
        func.name = "setAutoFilter";
        func.params = [
            "range (string, optional): cell range to apply autofilter (e.g., 'A1:D10'). If omitted, uses active/selected range",
            "field (number, optional): field number for filtering (starting from 1, left-most field)",
            "fieldName (string, optional): column name/header for filtering (e.g., 'Name', 'Age'). Will automatically find the column number",
            "criteria1 (string|array|object, optional): filter criteria - string for operators (e.g., '>10'), array for multiple values (e.g., [1,2,3]), ApiColor object for color filters, or dynamic filter constant",
            "operator (string, optional): filter operator - 'xlAnd', 'xlOr', 'xlFilterValues', 'xlTop10Items', 'xlTop10Percent', 'xlBottom10Items', 'xlBottom10Percent', 'xlFilterCellColor', 'xlFilterFontColor', 'xlFilterDynamic'",
            "criteria2 (string, optional): second criteria for compound filters (used with xlAnd/xlOr operators)",
            "visibleDropDown (boolean, optional): show/hide filter dropdown arrow (default: true)"
        ];

        func.examples = [
            "If you need to apply autofilter to range A1:D10, respond:" +
            "[functionCalling (setAutoFilter)]: {\"range\": \"A1:D10\"}",

            "To apply autofilter to active/selected range, respond:" +
            "[functionCalling (setAutoFilter)]: {}",

            "To filter column 1 for values greater than 10, respond:" +
            "[functionCalling (setAutoFilter)]: {\"range\": \"A1:D10\", \"field\": 1, \"criteria1\": \">10\"}",

            "To filter by column name 'Name' for specific values, respond:" +
            "[functionCalling (setAutoFilter)]: {\"range\": \"A1:D10\", \"fieldName\": \"Name\", \"criteria1\": [\"John\", \"Jane\"], \"operator\": \"xlFilterValues\"}",

            "To filter by column header 'Age' for values greater than 18, respond:" +
            "[functionCalling (setAutoFilter)]: {\"range\": \"A1:D10\", \"fieldName\": \"Age\", \"criteria1\": \">18\"}",

            "To filter column 2 for specific values [2,5,8], respond:" +
            "[functionCalling (setAutoFilter)]: {\"range\": \"A1:D10\", \"field\": 2, \"criteria1\": [2,5,8], \"operator\": \"xlFilterValues\"}",

            "To filter column 1 for top 10 items, respond:" +
            "[functionCalling (setAutoFilter)]: {\"range\": \"A1:D10\", \"field\": 1, \"criteria1\": \"10\", \"operator\": \"xlTop10Items\"}",

            "To create compound filter (>5 OR <2), respond:" +
            "[functionCalling (setAutoFilter)]: {\"range\": \"A1:D10\", \"field\": 1, \"criteria1\": \">5\", \"operator\": \"xlOr\", \"criteria2\": \"<2\"}",

            "To filter by cell background color (yellow), respond:" +
            "[functionCalling (setAutoFilter)]: {\"range\": \"A1:D10\", \"field\": 1, \"criteria1\": {\"r\": 255, \"g\": 255, \"b\": 0}, \"operator\": \"xlFilterCellColor\"}",

            "To filter by font color (red), respond:" +
            "[functionCalling (setAutoFilter)]: {\"range\": \"A1:D10\", \"field\": 1, \"criteria1\": {\"r\": 255, \"g\": 0, \"b\": 0}, \"operator\": \"xlFilterFontColor\"}",

            "To filter active range for values greater than 5, respond:" +
            "[functionCalling (setAutoFilter)]: {\"field\": 1, \"criteria1\": \">5\"}",

            "To filter active range by column name 'Price' for values less than 100, respond:" +
            "[functionCalling (setAutoFilter)]: {\"fieldName\": \"Price\", \"criteria1\": \"<100\"}",

            "To remove autofilter from range, respond:" +
            "[functionCalling (setAutoFilter)]: {\"range\": \"A1:D10\", \"field\": null}",

            "To clear filter from specific column, respond:" +
            "[functionCalling (setAutoFilter)]: {\"range\": \"A1:D10\", \"field\": 1, \"criteria1\": null}",

            "To filter range A1:D8 by yellow color, respond:" +
            "[functionCalling (setAutoFilter)]: {\"range\": \"A1:D8\", \"fieldName\": \"color\", \"criteria1\": {\"r\": 255, \"g\": 255, \"b\": 0}, \"operator\": \"xlFilterCellColor\"}"
        ];

        func.call = async function(params) {
            Asc.scope.range = params.range;
            Asc.scope.field = params.field;
            Asc.scope.fieldName = params.fieldName;
            Asc.scope.criteria1 = params.criteria1;
            Asc.scope.operator = params.operator;
            Asc.scope.criteria2 = params.criteria2;
            Asc.scope.visibleDropDown = params.visibleDropDown;

            if (Asc.scope.fieldName && !Asc.scope.field) {
                let insertRes = await Asc.Editor.callCommand(function(){
                    let ws = Api.GetActiveSheet();
                    let _range;

                    if (!Asc.scope.range) {
                        _range = Api.GetSelection();
                    } else {
                        _range = ws.GetRange(Asc.scope.range);
                    }

                    return _range.GetValue2();
                });

                let csv = insertRes.map(function(item){
                    return item.map(function(value) {
                        if (value == null) return '';
                        const str = String(value);
                        if (str.includes(',') || str.includes('\n') || str.includes('\r') || str.includes('"')) {
                            return '"' + str.replace(/"/g, '""') + '"';
                        }
                        return str;
                    }).join(',');
                }).join('\n');

                let argPromt = "Find column index for header '" + Asc.scope.fieldName + "' in the following CSV data.\n\n" +
                "IMPORTANT RULES:\n" +
                "1. Return ONLY a single number (column index starting from 1). No text, no explanations, no additional characters.\n" +
                "2. Find EXACT match first. If exact match exists, return its index.\n" +
                "3. If no exact match, then look for partial matches.\n" +
                "4. Case-insensitive comparison allowed.\n" +
                "5. Data is CSV format (comma-separated). Look ONLY at the first row (header row).\n" +
                "6. Count positions carefully: each comma marks a column boundary.\n" +
                "7. Example: if searching for 'test2' and headers are 'test1,test2,test', return 2 (not 1 or 3).\n" +
                "8. If the header is in the 3rd column, return only: 3\n\n" +
                "CSV data:\n" + csv;

                let requestEngine = AI.Request.create(AI.ActionType.Chat);
                if (!requestEngine)
                    return;

                let isSendedEndLongAction = false;
                async function checkEndAction() {
                    if (!isSendedEndLongAction) {
                        await Asc.Editor.callMethod("EndAction", ["Block", "AI (" + requestEngine.modelUI.name + ")"]);
                        isSendedEndLongAction = true
                    }
                }

                await Asc.Editor.callMethod("StartAction", ["Block", "AI (" + requestEngine.modelUI.name + ")"]);
                await Asc.Editor.callMethod("StartAction", ["GroupActions"]);

                let result = await requestEngine.chatRequest(argPromt, false, async function(data) {
                    if (!data)
                        return;
                    await checkEndAction();
                });

                await checkEndAction();
                await Asc.Editor.callMethod("EndAction", ["GroupActions"]);
                Asc.scope.field = result;
            }

            await Asc.Editor.callCommand(function(){
                let ws = Api.GetActiveSheet();
                let range;

                if (!Asc.scope.range) {
                    range = Api.GetSelection();
                } else {
                    range = ws.GetRange(Asc.scope.range);
                }

                if (!range) {
                    return;
                }

                let field = Asc.scope.field;
                if (!field) {
                    field = 1;
                }

                let criteria1 = Asc.scope.criteria1;
                if (Asc.scope.operator === "xlFilterCellColor" || Asc.scope.operator === "xlFilterFontColor") {
                    if (criteria1 && typeof criteria1 === 'object' && criteria1.r !== undefined && criteria1.g !== undefined && criteria1.b !== undefined) {
                        criteria1 = Api.CreateColorFromRGB(criteria1.r, criteria1.g, criteria1.b);
                    }
                }

                range.SetAutoFilter(
                    field,
                    criteria1,
                    Asc.scope.operator,
                    Asc.scope.criteria2,
                    Asc.scope.visibleDropDown
                );
            });
        };

        funcs.push(func);
    }

    if (true)
    {
        let func = new RegisteredFunction();
        func.name = "setSort";
        func.params = [
            "range (string, optional): cell range to sort (e.g., 'A1:D10'). If omitted, uses active/selected range",
            "key1 (string|ApiRange|number, optional): first sort field - range, named range reference, or column index within range (1-based)",
            "key1Name (string, optional): first sort field column name/header (e.g., 'Name', 'Age'). Will automatically find the column number",
            "sortOrder1 (string, optional): sort order for key1 - 'xlAscending' or 'xlDescending' (default: 'xlAscending')",
            "key2 (string|ApiRange|number, optional): second sort field - range, named range reference, or column index within range (1-based)",
            "key2Name (string, optional): second sort field column name/header (e.g., 'Name', 'Age'). Will automatically find the column number",
            "sortOrder2 (string, optional): sort order for key2 - 'xlAscending' or 'xlDescending'",
            "key3 (string|ApiRange|number, optional): third sort field - range, named range reference, or column index within range (1-based)",
            "key3Name (string, optional): third sort field column name/header (e.g., 'Name', 'Age'). Will automatically find the column number",
            "sortOrder3 (string, optional): sort order for key3 - 'xlAscending' or 'xlDescending'",
            "header (string, optional): specifies if first row contains headers - 'xlYes' or 'xlNo' (default: 'xlNo')"
        ];

        func.examples = [
            "To sort range A1:D10 by first column in ascending order, respond:" +
            "[functionCalling (setSort)]: {\"range\": \"A1:D10\", \"key1\": \"A1\", \"sortOrder1\": \"xlAscending\"}",

            "To sort active range by first column with headers, respond:" +
            "[functionCalling (setSort)]: {\"key1\": \"A1\", \"header\": \"xlYes\"}",

            "To sort range by multiple columns (first ascending, second descending), respond:" +
            "[functionCalling (setSort)]: {\"range\": \"A1:D10\", \"key1\": \"A1\", \"sortOrder1\": \"xlAscending\", \"key2\": \"B1\", \"sortOrder2\": \"xlDescending\"}",

            "To sort range by three columns, respond:" +
            "[functionCalling (setSort)]: {\"range\": \"A1:D10\", \"key1\": \"A1\", \"sortOrder1\": \"xlAscending\", \"key2\": \"B1\", \"sortOrder2\": \"xlDescending\", \"key3\": \"C1\", \"sortOrder3\": \"xlAscending\"}",

            "To sort range by rows instead of columns, respond:" +
            "[functionCalling (setSort)]: {\"range\": \"A1:D10\", \"key1\": \"A1\", \"orientation\": \"xlSortRows\"}",

            "To sort range with headers by second column descending, respond:" +
            "[functionCalling (setSort)]: {\"range\": \"A1:D10\", \"key1\": \"B1\", \"sortOrder1\": \"xlDescending\", \"header\": \"xlYes\"}",

            "To sort active range by named range key, respond:" +
            "[functionCalling (setSort)]: {\"key1\": \"MyRange\", \"sortOrder1\": \"xlAscending\"}",

            "To sort range by column index (1st column), respond:" +
            "[functionCalling (setSort)]: {\"range\": \"A1:D10\", \"key1\": 1, \"sortOrder1\": \"xlAscending\"}",

            "To sort range by multiple column indices (1st ascending, 3rd descending), respond:" +
            "[functionCalling (setSort)]: {\"range\": \"A1:D10\", \"key1\": 1, \"sortOrder1\": \"xlAscending\", \"key2\": 3, \"sortOrder2\": \"xlDescending\"}",

            "To sort active range by second column index with headers, respond:" +
            "[functionCalling (setSort)]: {\"key1\": 2, \"sortOrder1\": \"xlAscending\", \"header\": \"xlYes\"}",

            "To sort by column name 'Name' in ascending order, respond:" +
            "[functionCalling (setSort)]: {\"range\": \"A1:D10\", \"key1Name\": \"Name\", \"sortOrder1\": \"xlAscending\", \"header\": \"xlYes\"}",

            "To sort by multiple column names (Name ascending, Age descending), respond:" +
            "[functionCalling (setSort)]: {\"range\": \"A1:D10\", \"key1Name\": \"Name\", \"sortOrder1\": \"xlAscending\", \"key2Name\": \"Age\", \"sortOrder2\": \"xlDescending\", \"header\": \"xlYes\"}",

            "To sort active range by column name 'Price' descending with headers, respond:" +
            "[functionCalling (setSort)]: {\"key1Name\": \"Price\", \"sortOrder1\": \"xlDescending\", \"header\": \"xlYes\"}",

            "To sort by three column names, respond:" +
            "[functionCalling (setSort)]: {\"range\": \"A1:D10\", \"key1Name\": \"Category\", \"sortOrder1\": \"xlAscending\", \"key2Name\": \"Price\", \"sortOrder2\": \"xlDescending\", \"key3Name\": \"Date\", \"sortOrder3\": \"xlAscending\", \"header\": \"xlYes\"}"
        ];

        func.call = async function(params) {
            Asc.scope.range = params.range;
            Asc.scope.key1 = params.key1;
            Asc.scope.key1Name = params.key1Name;
            Asc.scope.sortOrder1 = params.sortOrder1 || "xlAscending";
            Asc.scope.key2 = params.key2;
            Asc.scope.key2Name = params.key2Name;
            Asc.scope.sortOrder2 = params.sortOrder2;
            Asc.scope.key3 = params.key3;
            Asc.scope.key3Name = params.key3Name;
            Asc.scope.sortOrder3 = params.sortOrder3;
            Asc.scope.header = params.header || "xlNo";

            // Функция для поиска колонки по имени
            async function findColumnByName(fieldName) {
                if (!fieldName) return null;

                let insertRes = await Asc.Editor.callCommand(function(){
                    let ws = Api.GetActiveSheet();
                    let _range;

                    if (!Asc.scope.range) {
                        _range = Api.GetSelection();
                    } else {
                        _range = ws.GetRange(Asc.scope.range);
                    }

                    return _range.GetValue2();
                });

                let csv = insertRes.map(function(item){
                    return item.map(function(value) {
                        if (value == null) return '';
                        const str = String(value);
                        if (str.includes(',') || str.includes('\n') || str.includes('\r') || str.includes('"')) {
                            return '"' + str.replace(/"/g, '""') + '"';
                        }
                        return str;
                    }).join(',');
                }).join('\n');

                let argPromt = "Find column index for header '" + fieldName + "' in the following CSV data.\n\n" +
                "IMPORTANT RULES:\n" +
                "1. Return ONLY a single number (column index starting from 1). No text, no explanations, no additional characters.\n" +
                "2. Find EXACT match first. If exact match exists, return its index.\n" +
                "3. If no exact match, then look for partial matches.\n" +
                "4. Case-insensitive comparison allowed.\n" +
                "5. Data is CSV format (comma-separated). Look ONLY at the first row (header row).\n" +
                "6. Count positions carefully: each comma marks a column boundary.\n" +
                "7. Example: if searching for 'test2' and headers are 'test1,test2,test', return 2 (not 1 or 3).\n" +
                "8. If the header is in the 3rd column, return only: 3\n\n" +
                "CSV data:\n" + csv;
                
                let requestEngine = AI.Request.create(AI.ActionType.Chat);
                if (!requestEngine)
                    return null;

                let isSendedEndLongAction = false;
                async function checkEndAction() {
                    if (!isSendedEndLongAction) {
                        await Asc.Editor.callMethod("EndAction", ["Block", "AI (" + requestEngine.modelUI.name + ")"]);
                        isSendedEndLongAction = true
                    }
                }

                await Asc.Editor.callMethod("StartAction", ["Block", "AI (" + requestEngine.modelUI.name + ")"]);
                await Asc.Editor.callMethod("StartAction", ["GroupActions"]);

                let result = await requestEngine.chatRequest(argPromt, false, async function(data) {
                    if (!data)
                        return;
                    await checkEndAction();
                });

                await checkEndAction();
                await Asc.Editor.callMethod("EndAction", ["GroupActions"]);
                return result - 0;
            }

            if (Asc.scope.key1Name && !Asc.scope.key1) {
                Asc.scope.key1 = await findColumnByName(Asc.scope.key1Name);
            }
            if (Asc.scope.key2Name && !Asc.scope.key2) {
                Asc.scope.key2 = await findColumnByName(Asc.scope.key2Name);
            }
            if (Asc.scope.key3Name && !Asc.scope.key3) {
                Asc.scope.key3 = await findColumnByName(Asc.scope.key3Name);
            }

            await Asc.Editor.callCommand(function(){
                let ws = Api.GetActiveSheet();
                let range;

                if (!Asc.scope.range) {
                    range = Api.GetSelection();
                } else {
                    range = ws.GetRange(Asc.scope.range);
                }

                if (!range) {
                    return;
                }

                if (Asc.scope.header === "xlYes") {
                    range.SetOffset(1, 0);
                }

                let key1 = null, key2 = null, key3 = null;

                function adjustSortKey(keyValue) {
                    if (!keyValue) return null;

                    if (typeof keyValue === 'number') {
                        return ws.GetCells(range.GetRow(), range.GetCol() + keyValue - 1);
                    } else if (typeof keyValue === 'string') {
                        try {
                            let keyRange = ws.GetRange(keyValue);
                            return keyRange || keyValue;
                        } catch {
                            return keyValue;
                        }
                    } else {
                        return keyValue;
                    }
                }

                key1 = adjustSortKey(Asc.scope.key1);
                key2 = adjustSortKey(Asc.scope.key2);
                key3 = adjustSortKey(Asc.scope.key3);

                range.SetSort(
                    key1,
                    Asc.scope.sortOrder1,
                    key2,
                    Asc.scope.sortOrder2,
                    key3,
                    Asc.scope.sortOrder3,
                    Asc.scope.header
                );
            });
        };

        funcs.push(func);
    }


	if (true) {
		let func = new RegisteredFunction();
		func.name = "addChart";
		func.params = [
			"range (string, optional): cell range with data for chart (e.g., 'A1:D10'). If omitted, uses current selection",
			"chartType (string, optional): type of chart - bar, barStacked, barStackedPercent, bar3D, barStacked3D, barStackedPercent3D, barStackedPercent3DPerspective, horizontalBar, horizontalBarStacked, horizontalBarStackedPercent, horizontalBar3D, horizontalBarStacked3D, horizontalBarStackedPercent3D, lineNormal, lineStacked, lineStackedPercent, line3D, pie, pie3D, doughnut, scatter, stock, area, areaStacked, areaStackedPercent Default: bar",
			"title (string, optional): chart title text"
		];

		func.examples = [
			"To create a bar chart from current selection, respond:" +
			"[functionCalling (addChart)]: {}",

			"To create a line chart from current selection, respond:" +
			"[functionCalling (addChart)]: {\"chartType\": \"line\"}",

			"To create a pie chart from specific range, respond:" +
			"[functionCalling (addChart)]: {\"range\": \"A1:B10\", \"chartType\": \"pie\"}",

			"To create a chart with title, respond:" +
			"[functionCalling (addChart)]: {\"title\": \"Sales Overview\"}"
		];

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
		funcs.push(func);
	}

	if (true)
	{
		let func = new RegisteredFunction();
		func.name = "explainFormula";
		func.params = [
			"range (string, optional): cell range containing formula to explain (e.g., 'A1'). If omitted, uses active/selected cell"
		];

		func.examples = [
			"To explain formula in active cell, respond:" +
			"[functionCalling (explainFormula)]: {}",

			"To explain formula in specific cell A1, respond:" +
			"[functionCalling (explainFormula)]: {\"range\": \"A1\"}",

			"To explain formula in cell B5, respond:" +
			"[functionCalling (explainFormula)]: {\"range\": \"B5\"}"
		];

		func.call = async function(params) {
			Asc.scope.range = params.range;

			// Get formula from the specified cell
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

		funcs.push(func);
	}

    return funcs;
}
