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
		"name": "rewriteText",
		"description": "Use this function when you asked to rewrite or replace some text. If text or paragraph number is not specified assume that we are working with the current paragraph.",
		
		"parameters": {
			"type": "object",
			"properties": {
				"parNumber": {
					"type": "number",
					"description": "The paragraph number to change."
				},
				"prompt": {
					"type": "string",
					"description": "Instructions on how to change the text."
				},
				"showDifference": {
					"type": "boolean",
					"description": "Whether to show the difference between the original and new text, or just replace it."
				},
				"type": {
					"type": "string",
					"enum": ["sentence", "paragraph"],
					"default": "paragraph",
					"description": "Which part of the text to be rewritten (e.g., 'sentence' or 'paragraph')."
				}
			},
			"required": ["prompt"]
		},
		"examples": [
			{
				"prompt": "Rewrite this text",
				"arguments": { "prompt": "Rewrite", "type": "paragraph" }
			},
			{
				"prompt": "Rephrase this sentence differently",
				"arguments": { "prompt": "rephrase sentence", "type": "sentence" }
			},
			{
				"prompt": "Show me how you would rephrase this sentence",
				"arguments": { "prompt": "rephrase sentence", "type": "sentence", "showDifference": true }
			},
			{
				"prompt": "Make paragraph 2 more emotional",
				"arguments": { "parNumber": 2, "prompt": "make the text more emotional", "type": "paragraph" }
			},
			{
				"prompt": "Rephrase the first paragraph",
				"arguments": { "parNumber": 1, "prompt": "Rephrase", "type": "paragraph" }
			},
			{
				"prompt": "Make this paragraph more formal",
				"arguments": { "prompt": "Rewrite in official style", "type": "paragraph" }
			}
		]
	});
	
	func.call = async function(params) {
		let text = "";
		if ("paragraph" === params.type)
		{
			Asc.scope.parNumber = params.parNumber;
			text = await Asc.Editor.callCommand(function(){
				let doc = Api.GetDocument();
				let par = undefined === Asc.scope.parNumber ? doc.GetCurrentParagraph() : doc.GetElement(Asc.scope.parNumber - 1);
				if (!par)
					return "";
				par.Select();
				return par.GetText();
			});
		}
		else // if ("sentence" === params.type)
		{
			text = await Asc.Editor.callCommand(function(){
				return Api.GetDocument().GetCurrentSentence();
			});
		}

		let argPromt = params.prompt + ":\n" + text + "\n Answer with only the new one sentence, no need of any explanations";

		let requestEngine = AI.Request.create(AI.ActionType.Chat);
		if (!requestEngine)
			return;

		await Asc.Editor.callMethod("StartAction", ["GroupActions"]);

		let turnOffTrackChanges = false;
		if (params.showDifference)
		{
			let isTrackChanges = await Asc.Editor.callCommand(function(){
				return Api.GetDocument().IsTrackRevisions();
			});

			if (!isTrackChanges)
			{
				await Asc.Editor.callCommand(function(){
					Api.GetDocument().SetTrackRevisions(true);
				});
				turnOffTrackChanges = true;
			}
		}

		await Asc.Editor.callMethod("StartAction", ["Block", "AI (" + requestEngine.modelUI.name + ")"]);

		let isSendedEndLongAction = false;
		async function checkEndAction() {
			if (!isSendedEndLongAction) {
				await Asc.Editor.callMethod("EndAction", ["Block", "AI (" + requestEngine.modelUI.name + ")"]);
				isSendedEndLongAction = true
			}
		}

		let result = await requestEngine.chatRequest(argPromt, false, async function(data) {
			if (!data)
				return;
			await checkEndAction();

			if (text && "sentence" === params.type)
			{
				Asc.scope.data = data;
				await Asc.Editor.callCommand(function(){
					let doc = Api.GetDocument();
					doc.ReplaceCurrentSentence("");
				});
				text = null;
			}

			await Asc.Library.PasteText(data);
		});

		await checkEndAction();

		if (turnOffTrackChanges)
			await Asc.Editor.callCommand(function(){return Api.GetDocument().SetTrackRevisions(false);});

		await Asc.Editor.callMethod("EndAction", ["GroupActions"]);
	};

	return func;
})();
