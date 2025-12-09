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

function RegisteredFunction(obj)
{
	this.name = obj.name || "";
	this.description = obj.description || "";
	this.parameters = obj.parameters || {};
	this.examples = obj.examples || [];
	this.returns = obj.returns || {};

	this.call = null;
}

function EditorHelperImpl() {

	this.funcs = [];
	this.names2funcs = {};
	this.isSupportStreaming = false;

	let editorType = Asc.Editor.getType();

	if (editorType === "word") {
		this.isSupportStreaming = true;
	}

	let hs = [];

	switch (editorType) {
		case "word": {
			hs = HELPERS.word;
			break;
		}
		case "cell": {
			hs = HELPERS.cell;	
			break;
		}
		case "slide": {
			hs = HELPERS.slide;
			break;
		}
		default:
			break;
	}

	for (let i = 0, len = hs.length; i < len; i++) {
		if (Array.isArray(hs[i])) {
			for (let j = 0, len2 = hs[i].length; j < len2; j++)
				this.funcs.push(hs[i][j]);
		} else {
			this.funcs.push(hs[i]);
		}
	}

	for (let i = 0; i < this.funcs.length; i++) {
		let func = this.funcs[i];
		this.names2funcs[func.name] = func;
	}
}

EditorHelperImpl.prototype.getSystemPrompt = function() {
	if (this.funcs.length === 0)
		return "";

	let systemPrompt = "\
You are not a conversational assistant. You are a function-calling controller.\n\
\n\
Your behavior rules:\n\
- You do not chat, explain, or ask questions.\n\
- You do not seek clarification.\n\
- You do not request more details.\n\
- You do not apologize.\n\
- You do not provide examples unless explicitly listed below.\n\
- You do not format output in markdown.\n\
- You do not produce any text other than valid outputs.\n\
\n\
Your only two possible actions:\n\
1. Produce a function call in the exact format described below.\n\
2. Produce a normal text response (only if no function call is relevant).\n\
\n\
────────────────────────────\n\
FUNCTION CALL FORMAT\n\
────────────────────────────\n\
When a function call is required, respond EXACTLY as follows:\n\
\n\
[functionCalling (functionName)]: parameters\n\
\n\
Where:\n\
- functionName — the exact function name.\n\
- parameters — a valid JSON object of arguments.\n\
\n\
────────────────────────────\n\
RULES\n\
────────────────────────────\n\
- If the user’s request can be handled by any available function — CALL IT.\n\
- Never ask for clarification. Never request missing information.\n\
- If information is incomplete — make reasonable assumptions or leave optional fields empty.\n\
- Do not explain your assumptions.\n\
- Do not say anything except the function call.\n\
- Do not confirm or describe what you are doing.\n\
- Do not add punctuation after the JSON.\n\
- Calling a function ALWAYS takes priority over clarifying or explaining.\n\
- Function calls must strictly follow the required format.\n\
- If no function applies, then and only then respond normally in text.\n\
\n\
────────────────────────────\n\
AVAILABLE FUNCTIONS\n\
────────────────────────────\n\
";

	for (let i in this.funcs) {
		let func = this.funcs[i];
		systemPrompt += "\n\
- " + func.name + "\n\
Description: " + func.description + "\n\
Parameters schema:\n" + 
JSON.stringify(func.parameters.properties) + "\n\
Returns:\n" +
JSON.stringify(func.returns);

		systemPrompt += "\n\n";
	}
	
	systemPrompt += "\
────────────────────────────\n\
EXAMPLES\n\
────────────────────────────\n\
";
	
	for (let i in this.funcs) {
		let func = this.funcs[i];
		for (let j = 0, len = func.examples.length; j < len; j++) {
			let ex = func.examples[j];
			systemPrompt += "If the user says: \"" + ex.prompt + "\"\n\
Respond exactly with:\n\
[functionCalling (" + func.name + ")]: " + JSON.stringify(ex.arguments) + "\n";
		}
	}

	systemPrompt += "\
────────────────────────────\n\
REMINDER\n\
────────────────────────────\n\
If no function call is needed — respond normally with clear helpful text.\n\
Never output a function call unless the user's request explicitly requires it.\n\
";

	return systemPrompt;
};

EditorHelperImpl.prototype.getTools = function() {
	if (this.funcs.length === 0)
		return null;

	let tools = [];
	for (let i in this.funcs) {
		tools.push(this.funcs[i]);		
	}

	return JSON.parse(JSON.stringify(tools));
};

EditorHelperImpl.prototype.callFunc = async function(data) {

	let index1 = data.indexOf("(");
	let index2 = data.indexOf(")");
	let index3 = data.indexOf("{");

	let funcName = data.substring(index1 + 1, index2).trim();
	let paramsStr = getJsonResult(data, index3);

	try {
		let func = this.names2funcs[funcName];
		if (!func) {
			let errorMsg = "Function not found: " + funcName;
			console.error(errorMsg);
			return {
				error: errorMsg
			};
		}

		let result = await func.call(eval("(" + paramsStr.replaceAll("\n", "\\n") + ")"));
		if (!result)
			result = {};

		result.message = "System function '" + funcName + "' executed successfully";
		return result;
	} catch (e) {
		let errorMsg = "Error calling function: " + funcName;
		console.error(errorMsg);
		return {
			error: errorMsg
		};
	}
	
};

function getJsonResult(responseText, startPos) {
		
	let result = "";

	let isEscaped = false;
	let inString = false;
	let braceCount = 0;
	let inputLen = responseText.length;
	
	for (let i = startPos; i < inputLen; i++) {
		let char = responseText[i];
		
		if (char === '\n') {
			this.lineNumber++;
		}
		
		if (char === '"' && !isEscaped) {
			inString = !inString;
		}
		
		isEscaped = (char === '\\' && !isEscaped);
		
		if (!inString) {
			if (char === '{') {
				braceCount++;
			}
			else if (char === '}') {
				braceCount--;

				if (braceCount === 0) {
					return responseText.substring(startPos, i + 1);
				}
			}				
		}
	}

	return responseText.substring(startPos);
}
