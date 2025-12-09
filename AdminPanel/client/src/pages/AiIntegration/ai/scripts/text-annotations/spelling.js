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

function SpellChecker()
{
	TextAnnotator.call(this);
	this.type = 0;
}
SpellChecker.prototype = Object.create(TextAnnotator.prototype);
SpellChecker.prototype.constructor = SpellChecker;

SpellChecker.prototype.annotateParagraph = async function(paraId, recalcId, text)
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

	let argPrompt = `You are a spellcheck corrector. I will provide text that may contain spelling errors in any language. Your task is to identify ALL spelling mistakes and return ONLY the corrections in the following JSON format:

[
  {"wrong": "misspelledWord", "correct": "correctWord", "occurrence": 1, "confidence": "high"},
  ...
]

Rules:
- "wrong": the exact misspelled word as it appears in the text
- "correct": the correctly spelled replacement
- "occurrence": which occurrence of this word if it appears multiple times (1 for first, 2 for second, etc.)
- "confidence": how certain you are this is a misspelling
  * "high" - definitely misspelled, no valid alternative meaning
  * "medium" - likely misspelled in this context, but could be valid elsewhere
  * "low" - uncertain, highly context-dependent
- Return an empty array [] if there are no errors
- Return an empty array [] if the text is completely unintelligible or a complete mess
- Support multiple languages (English, Russian, etc.)

CRITICAL
- Ouput should be in the exact this format
- No any comments are allowed

CRITICAL - Word Boundaries (MOST IMPORTANT):
- ONLY match complete, standalone words separated by spaces, punctuation, or at the start/end of text
- DO NOT match letters or substrings that are PART of other words
- A word is bounded by: spaces, punctuation (.,!?;:), quotes, or start/end of text
- Examples of what NOT to match:
  * "r" in "letter" - NO! "r" is part of the word "letter"
  * "r" in "great" - NO! "r" is part of the word "great"
  * "te" in "letter" - NO! "te" is part of the word "letter"
- Examples of what TO match:
  * "r" in "r u sure" - YES! "r" is a standalone word
  * "te" in "What te problem" - YES! "te" is a standalone word

CRITICAL - Handling same word with different meanings:
If the same word appears multiple times but only some occurrences are misspelled:
- ONLY include the misspelled occurrences
- Use the "occurrence" number to specify which instance

Example showing word boundaries:
Input: "The letter r. r u sure about it?"
Explanation:
- "letter" - correct word, don't touch it
- "r." - this is the standalone letter r
- "r u" - this "r" is a standalone word (misspelled, should be "are")
Output: [
  {"wrong": "r", "correct": "are", "occurrence": 2, "confidence": "medium"},
  {"wrong": "u", "correct": "you", "occurrence": 1, "confidence": "medium"}
]
Note: The first standalone "r" (after "letter") is correct. The second standalone "r" (in "r u") is misspelled.

Example with substring trap:
Input: "Great! r u coming?"
Output: [
  {"wrong": "r", "correct": "are", "occurrence": 1, "confidence": "medium"},
  {"wrong": "u", "correct": "you", "occurrence": 1, "confidence": "medium"}
]
Note: The "r" in "Great" is NOT matched because it's part of the word "Great", not a standalone word.

CRITICAL - Completeness:
- Find and include EVERY misspelled standalone word in the text
- If the same misspelled word appears multiple times, create separate entries
- Single-letter standalone words can be misspellings (e.g., standalone "r" → "are", standalone "u" → "you")

CRITICAL - What NOT to include:
- DO NOT include letters or substrings within other words
- DO NOT include entries where "wrong" and "correct" are identical
- ONLY include actual spelling mistakes that are standalone words

CRITICAL - Output Format:
- Return ONLY the raw JSON array, nothing else
- DO NOT wrap the response in markdown code blocks (no \`\`\`json or \`\`\`)
- DO NOT include any explanatory text before or after the JSON
- DO NOT use escaped newlines (\\n) - return the JSON on a single line if possible
- The response should start with [ and end with ]

Correct output format:
[{"wrong": "Hlo", "correct": "Hello", "occurrence": 1, "confidence": "high"}]

Incorrect output formats (DO NOT USE):
\`\`\`json
[{"wrong": "Hlo", "correct": "Hello"}]
\`\`\`

Example (no errors):
Input: "The quick brown fox jumps over the lazy dog."
Output: []
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
		for (const { wrong, correct, occurrence } of corrections) 
		{
			if (wrong === correct)
				continue;
			
			let count = 0;
			let searchStart = 0;

			while (searchStart < text.length)
			{
				const index = text.indexOf(wrong, searchStart);
				if (index === -1) break;

				const isStartBoundary = index === 0 || _t._isWordBoundary(text[index - 1]);
				const isEndBoundary = index + wrong.length === text.length || _t._isWordBoundary(text[index + wrong.length]);

				if (isStartBoundary && isEndBoundary)
				{
					count++;
					if (count === occurrence)
					{
						ranges.push({
							"start": index,
							"length": wrong.length,
							"id": rangeId
						});
						_t.paragraphs[paraId][rangeId] = {
							"suggested" : correct,
							"original" : wrong
						};
						++rangeId;
						break;
					}
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
			"name" : "spelling",
			"recalcId": recalcId,
			"ranges": ranges
		};
		await Asc.Editor.callMethod("AnnotateParagraph", [obj]);
	}
	catch (e)
	{ }
}
SpellChecker.prototype.getInfoForPopup = function(paraId, rangeId)
{
	let anot = this.getAnnotation(paraId, rangeId);
	return {
		suggested : anot["suggested"],
		original : anot["original"]
	};
};
SpellChecker.prototype.onAccept = async function(paraId, rangeId)
{
	let anot = this.getAnnotation(paraId, rangeId);
	if (!anot)
		return;
	
	let range = this.getAnnotationRangeObj(paraId, rangeId);
	await Asc.Editor.callMethod("StartAction", ["GroupActions"]);
	await Asc.Editor.callMethod("SelectAnnotationRange", [range]);
	
	Asc.scope.text = anot["suggested"];
	await Asc.Editor.callCommand(function(){
		Api.ReplaceTextSmart([Asc.scope.text]);
		Api.GetDocument().RemoveSelection();
	});	
	
	await Asc.Editor.callMethod("RemoveAnnotationRange", [range]);
	await Asc.Editor.callMethod("EndAction", ["GroupActions"]);
	await Asc.Editor.callMethod("FocusEditor");
};
SpellChecker.prototype.getAnnotationRangeObj = function(paraId, rangeId)
{
	return {
		"paragraphId" : paraId,
		"rangeId" : rangeId,
		"name" : "spelling"
	};
};
SpellChecker.prototype._handleNewRangePositions = async function(range, paraId, text)
{
	if (!range || range["name"] !== "spelling" || !this.paragraphs[paraId])
		return;

	let rangeId = range["id"];
	let annot = this.getAnnotation(paraId, rangeId);
	
	if (!annot)
		return;
	
	let start = range["start"];
	let len = range["length"];
	
	const isStartBoundary = start === 0 || this._isWordBoundary(text[start - 1]);
	const isEndBoundary = start + len === text.length || this._isWordBoundary(text[start + len]);
	
	if (!isStartBoundary || !isEndBoundary || annot["original"] !== text.substring(start, start + len))
	{
		let annotRange = this.getAnnotationRangeObj(paraId, rangeId);
		Asc.Editor.callMethod("RemoveAnnotationRange", [annotRange]);
	}
};
SpellChecker.prototype._isWordBoundary = function(char)
{
	return /[\s.,!?;:'"()\[\]{}\-–—\/\\]/.test(char);
};
