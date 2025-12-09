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

function GrammarChecker()
{
	TextAnnotator.call(this);
	this.type = 1;
}

GrammarChecker.prototype = Object.create(TextAnnotator.prototype);
GrammarChecker.prototype.constructor = GrammarChecker;

GrammarChecker.prototype.annotateParagraph = async function(paraId, recalcId, text)
{
	this.paragraphs[paraId] = {};

	let requestEngine = AI.Request.create(AI.ActionType.Chat);
	if (!requestEngine)
		return false;

	let isSendedEndLongAction = false;
	async function checkEndAction()
	{
		if (!isSendedEndLongAction)
			isSendedEndLongAction = true;
	}

	let argPrompt = `You are a grammar correction tool that analyzes text for punctuation and style issues only. You will receive text to analyze and must respond with corrections in a specific JSON format.

CRITICAL REQUIREMENT - READ CAREFULLY:
The "sentence" field in your JSON response MUST contain the EXACT text from the original input with NO changes whatsoever - not even fixing capitalization, punctuation, or anything else. Copy it character-by-character exactly as it appears in the original. Only the "suggestion" field should contain corrections.

Your task is to:
- Check ONLY for punctuation errors (commas, periods, semicolons, colons, apostrophes, quotation marks, etc.) and style issues (sentence structure, word order, grammar, capitalization)
- Completely ignore spelling errors and typos. Do not mention them, do not flag them, do not include sentences just because they contain spelling errors. Pretend all words are spelled correctly.
- Return corrections in JSON format only

What counts as an error:
- Missing or incorrect punctuation (periods, commas, semicolons, etc.)
- Run-on sentences needing punctuation
- Incorrect sentence structure or word order
- Grammar issues (subject-verb agreement, tense consistency, etc.)
- Capitalization errors

What does NOT count as an error:
- Misspelled words or typos
- Missing letters in words
- Wrong letters in words

Response format - return ONLY this JSON array with no additional text:
[
  {
    "origin": "relevant snippet of text around the error",
    "suggestion": "the corrected version of that snippet",
    "description": "brief explanation of the punctuation or style issue",
   "difference":"difference between origin and suggestion"
    "occurrence": 1,
    "confidence": 0.95
  }
]

Guidelines for each field:
- "origin": VERY SHORT SNIPPET (3-8 words) of EXACT UNCHANGED original text around the error. Do not fix anything in this field.
- "suggestion": The corrected version of that same snippet
- "difference":  The difference between origin and suggestion in html format: the differences wrapped with <strong> tag
- "description": Brief explanation of the punctuation or style issue
- "occurrence": Which occurrence of this sentence if it appears multiple times (1 for first, 2 for second, etc.)
- "confidence": Value between 0 and 1 indicating certainty (1.0 = completely certain, 0.5 = uncertain)

Only include sentences that have punctuation or style errors - skip sentences with no errors.

If no errors are found in the entire text, return an empty array: []

Examples:

Input: "She dont like apples Me and him goes to school however they enjoy learning. Its a beautiful day"
Output:
[
  {
    "origin": "apples Me and him",
    "suggestion": "apples. Me and him",
    "difference": "apples<strong>.</strong> Me and him"
    "description": "Missing period between sentences",
    "occurrence": 1,
    "confidence": 1.0
  },
  {
    "origin": "school however they",
    "suggestion": "school; however, they",
    "difference": "school<strong>;</strong> however<strong>,</strong> they"
    "description": "Incorrect punctuation with 'however' - should use semicolon before and comma after",
    "occurrence": 1,
    "confidence": 0.95
  },
  {
    "origin": "beautiful day",
    "suggestion": "beautiful day.",
    "difference": "beautiful day<strong>.</strong>",
    "description": "Missing period at end of sentence",
    "occurrence": 1,
    "confidence": 1.0
  }
]

Input: "The sun is shining. however, it might rain later."
Output:
[
  {
    "origin": "shining. however, it",
    "suggestion": "shining. However, it",
    "difference": "shining. <strong>H</strong>owever, it",
    "description": "Sentence should start with a capital letter",
    "occurrence": 1,
    "confidence": 1.0
  }
]

CRITICAL - Output Format:
- Return ONLY the raw JSON array, nothing else
- DO NOT wrap the response in markdown code blocks (no \`\`\`json or \`\`\`)
- DO NOT include any explanatory text before or after the JSON
- DO NOT use escaped newlines (\\n) - return the JSON on a single line if possible
- The response should start with [ and end with ]

Text to check:`;
	argPrompt += text;

	let response = "";
	await requestEngine.chatRequest(argPrompt, false, async function (data)
	{
		if (!data)
			return;
		await checkEndAction();

		response += data;
	});
	await checkEndAction();

	let rangeId = 1;
	let ranges = [];

	let _t = this;
	function convertToRanges(text, corrections) 
	{
		for (const { origin, suggestion, difference, description, occurrence, confidence } of corrections) 
		{
			if (origin === suggestion || confidence <= 0.7)
				continue;
			
			let count = 0;
			let searchStart = 0;

			while (searchStart < text.length)
			{
				const index = text.indexOf(origin, searchStart);
				if (index === -1) break;
				
				count++;
				if (count === occurrence)
				{
					ranges.push({
						"start": index,
						"length": origin.length,
						"id": rangeId
					});
					_t.paragraphs[paraId][rangeId] = {
						"original" : origin,
						"suggestion" : suggestion,
						"difference" : difference,
						"description" : description
					};
					++rangeId;
					break;
				}
				searchStart = index + 1;
			}
		}
	}

	try 
	{
		convertToRanges(text, JSON.parse(response));
		let obj = {
			"type": "highlightText",
			"paragraphId": paraId,
			"name" : "grammar",
			"recalcId": recalcId,
			"ranges": ranges
		};
		await Asc.Editor.callMethod("AnnotateParagraph", [obj]);
	}
	catch (e)
	{ }
}
GrammarChecker.prototype.getInfoForPopup = function(paraId, rangeId)
{
	let _s = this.getAnnotation(paraId, rangeId);
	return {
		suggested : _s["difference"],
		original : _s["original"],
		explanation : _s["description"]
	};
};
GrammarChecker.prototype.onAccept = async function(paraId, rangeId)
{
	let text = this.getAnnotation(paraId, rangeId)["suggestion"];
	
	await Asc.Editor.callMethod("StartAction", ["GroupActions"]);
	
	let range = this.getAnnotationRangeObj(paraId, rangeId);
	await Asc.Editor.callMethod("SelectAnnotationRange", [range]);
	
	Asc.scope.text = text;
	await Asc.Editor.callCommand(function(){
		Api.ReplaceTextSmart([Asc.scope.text]);
		Api.GetDocument().RemoveSelection();
	});
	
	await Asc.Editor.callMethod("RemoveAnnotationRange", [range]);
	await Asc.Editor.callMethod("EndAction", ["GroupActions"]);
	await Asc.Editor.callMethod("FocusEditor");
};
GrammarChecker.prototype.getAnnotationRangeObj = function(paraId, rangeId)
{
	return {
		"paragraphId" : paraId,
		"rangeId" : rangeId,
		"name" : "grammar"
	};
};
GrammarChecker.prototype._handleNewRangePositions = async function(range, paraId, text)
{
	if (!range || range["name"] !== "grammar" || !this.paragraphs[paraId])
		return;

	let rangeId = range["id"];
	let annot = this.getAnnotation(paraId, rangeId);
	
	if (!annot)
		return;
	
	let start = range["start"];
	let len = range["length"];
	
	if (annot["original"] !== text.substring(start, start + len))
	{
		let annotRange = this.getAnnotationRangeObj(paraId, rangeId);
		Asc.Editor.callMethod("RemoveAnnotationRange", [annotRange]);
	}
};
