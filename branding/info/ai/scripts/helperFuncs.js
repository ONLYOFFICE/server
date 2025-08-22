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

function RegisteredFunction()
{
	this.name = "";
	this.description = "";
	this.params = [];
	this.examples = [];

	this.call = null;
}

function EditorHelperImpl() {

	this.funcs = [];
	this.names2funcs = {};
	this.isSupportStreaming = false;

	let editorType = Asc.Editor.getType();

	switch (editorType) {
		case "word": {
			this.funcs = getWordFunctions();
			this.isSupportStreaming = true;
			break;
		}
		case "cell": {
			this.funcs = getCellFunctions();			
			break;
		}
		case "slide": {
			this.funcs = getSlideFunctions();
			break;
		}
		default:
			break;
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
You are an assistant that calls functions in a strict format **only when needed**.\n\
CRITICAL: Never add explanations, confirmations, or any text before or after function calls. Respond ONLY with the exact function call format when a function is required.\n\
\n\
Function calling format:\n\
\n\
If a function call is required based on the user's request, respond exactly as follows:\n\
[functionCalling (functionName)]: parameters\n\
Rules:\
- NO explanatory text before function calls\n\
- NO confirmations after function calls\n\
- NO \"I will now...\", \"Let me...\", \"Here's the...\" phrases\n\
- Follow the exact format — zero deviations allowed\n\
- Only use function calls when explicitly required by the user's request\n\
- If no function needed, respond with normal helpful text\n\
where\n\
- functionName is the name of the function to call,\n\
- parameters is a JSON object containing all the parameters.\n\
\n\
When calling a function:\n\
- Do not include any explanations or extra text outside the function call.\n\
- Always follow the exact format — no deviations are allowed.\n\
\n\
Only use function calls when they are explicitly required by the user's request.\n\
If the user's request doesn't require any function, respond with normal helpful text.\n\
\n\
Available functions:\n";

	for (let i = 0; i < this.funcs.length; i++) {
		let func = this.funcs[i];
		systemPrompt += "\n- " + func.name + "\n  Parameters:\n";
		for (let j = 0; j < func.params.length; j++) {
			systemPrompt += "  - " + func.params[j] + "\n";
		}
	}

	systemPrompt += "\nExamples:\n";
	for (let i = 0; i < this.funcs.length; i++) {
		let func = this.funcs[i];
		for (let j = 0; j < func.examples.length; j++) {
			systemPrompt += func.examples[j] + "\n";
		}
	}

	systemPrompt += "\nIf no function call is needed, respond with normal text.\n";

	return systemPrompt;
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
