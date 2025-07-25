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

var WORD_FUNCTIONS = {};

(function(){
	WORD_FUNCTIONS.commentText = function()
	{
		let func = new RegisteredFunction();
		func.name = "commentText";
		func.params = [
			"type (string): whether to add as a 'comment' or as a 'footnote' (default is 'comment')"
		];

		func.examples = [
			"If you need to explain selected text as a comment, respond with:\n" +
			"[functionCalling (commentText)]: {\"prompt\" : \"Explain this text\", \"type\": \"comment\"}",

			"If you need to add a footnote to selected text, respond with:\n" +
			"[functionCalling (commentText)]: {\"prompt\" : \"Add a footnote to this text\", \"type\": \"footnote\"}",

			"If you need to comment selected text, respond with:\n" +
			"[functionCalling (commentText)]: {\"prompt\" : \"Comment this text\"}",

			"If you need to explain selected text as a footnote, respond with:\n" +
			"[functionCalling (commentText)]: {\"prompt\" : \"Explain this text\", \"type\": \"footnote\"}"
		];
		
		func.call = async function(params) {
			let type = params.type;
			let isFootnote = "footnote" === type;

			let text = await Asc.Editor.callCommand(function(){
				let doc = Api.GetDocument();
				let range = doc.GetRangeBySelect();
				let text = range ? range.GetText() : "";
				if (!text)
				{
					text = doc.GetCurrentWord();
					doc.SelectCurrentWord();
				}

				return text;
			});

			let argPromt = params.prompt + ":\n" + text;

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

			if (isFootnote)
			{
				let addFootnote = true;
				let result = await requestEngine.chatRequest(argPromt, false, async function(data) {
					if (!data)
						return;

					await checkEndAction();
					Asc.scope.data = data;
					Asc.scope.model = requestEngine.modelUI.name;

					if (addFootnote)
					{
						await Asc.Editor.callCommand(function(){
							Api.GetDocument().AddFootnote();
						});
						addFootnote = false;
					}
					await Asc.Library.PasteText(data);
				});
			}
			else 
			{
				let commentId = null;
				let result = await requestEngine.chatRequest(argPromt, false, async function(data) {
					if (!data)
						return;

					await checkEndAction();
					Asc.scope.data = data;
					Asc.scope.model = requestEngine.modelUI.name;
					Asc.scope.commentId = commentId;

					commentId = await Asc.Editor.callCommand(function(){
						let doc = Api.GetDocument();

						let commentId = Asc.scope.commentId;
						if (!commentId)
						{
							let range = doc.GetRangeBySelect();
							if (!range)
								return null;

							let comment = range.AddComment(Asc.scope.data, Asc.scope.model, "uid" + Asc.scope.model);
							if (!comment)
								return null;
							doc.ShowComment([comment.GetId()]);
							return comment.GetId();
						}

						let comment = doc.GetCommentById(commentId);
						if (!comment)
							return commentId;

						comment.SetText(comment.GetText() + scope.data);
						return commentId;
					});
				});
			}

			await checkEndAction();
			await Asc.Editor.callMethod("EndAction", ["GroupActions"]);
		};

		return func;
	}
	WORD_FUNCTIONS.rewriteText = function() 
	{
		let func = new RegisteredFunction();
		func.name = "rewriteText";
		func.params = [
			"parNumber (number): the paragraph number to change",
			"prompt (string): instructions on how to change the text",
			"showDifference (boolean): whether to show the difference between the original and new text, or just replace it",
			"type (string): which part of the text to be rewritten (e.g., 'sentence' or 'paragraph')"
		];

		func.examples = [
			"If you need to rephrase current sentence, respond with:\n" +
			"[functionCalling (rewriteText)]: {\"prompt\": \"rephrase sentence\", \"type\" : \"sentence\"}",

			"If you need to rephrase current sentence and show difference, respond with:\n" +
			"[functionCalling (rewriteText)]: {\"prompt\": \"rephrase sentence\", \"type\" : \"sentence\", \"showDifference\" : true}",

			"if you need to change paragraph 2 to be more emotional, respond with:\n" +
			"[functionCalling (rewriteText)]: {\"parNumber\": 2, \"prompt\": \"make the text more emotional\", \"type\" : \"paragraph\"}",

			"if you need to rewrite the first paragraph, respond with:\n" +
			"[functionCalling (rewriteText)]: {\"parNumber\": 1, \"prompt\": \"Rephrase \", \"type\" : \"paragraph\"}",

			"if you need to rewrite the current paragraph to be more official, respond with:\n" +
			"[functionCalling (rewriteText)]: {\"prompt\": \"Rewrite in official style\", \"type\" : \"paragraph\"}"
		];
		
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
	}
	WORD_FUNCTIONS.changeTextStyle = function()
	{
		let func = new RegisteredFunction();
		func.name = "changeTextStyle";
		func.params = [
			"bold (boolean): whether to make the text bold",
			"italic (boolean): whether to make the text italic",
			"underline (boolean): whether to underline the text",
			"strikeout (boolean): whether to strike out the text",
			"fontSize (number): font size to apply to the selected text"
		];
		
		func.examples = [
			"If you need to make selected text bold and italic, respond with:" +
			"[functionCalling (changeTextStyle)]: {\"bold\": true, \"italic\": true }",
		
			"If you need to underline the selected text, respond with:" +
			"[functionCalling (changeTextStyle)]: {\"underline\": true }",
		
			"If you need to strike out the selected text, respond with:" +
			"[functionCalling (changeTextStyle)]: {\"strikeout\": true }",
		
			"If you need to set the font size of selected text to 18, respond with:" +
			"[functionCalling (changeTextStyle)]: {\"fontSize\": 18 }",
		
			"If you need to make selected text bold, respond with:" +
			"[functionCalling (changeTextStyle)]: {\"bold\": true }",
		
			"If you need to make selected text non-italic, respond with:" +
			"[functionCalling (changeTextStyle)]: {\"italic\": false }"
		];
		
		func.call = async function(params) {
			Asc.scope.bold = params.bold;
			Asc.scope.italic = params.italic;
			Asc.scope.underline = params.underline;
			Asc.scope.strikeout = params.strikeout;
			Asc.scope.fontSize = params.fontSize;
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

				if (undefined !== Asc.scope.bold)
					range.SetBold(Asc.scope.bold);

				if (undefined !== Asc.scope.italic)
					range.SetItalic(Asc.scope.italic);

				if (undefined !== Asc.scope.underline)
					range.SetUnderline(Asc.scope.underline);

				if (undefined !== Asc.scope.strikeout)
					range.SetStrikeout(Asc.scope.strikeout);

				if (undefined !== Asc.scope.fontSize)
					range.SetFontSize(Asc.scope.fontSize);
			});
		};

		return func;
	}
	WORD_FUNCTIONS.insertPage = function()
	{
		let func = new RegisteredFunction();
		func.name = "insertPage";
		func.params = [
			"location (string): where to insert the new page ('current', 'start', or 'end')"
		];

		func.examples = [
			"If you need to insert blank page to the current location, respond with:" +
			"[functionCalling (insertPage)]: {\"location\": \"current\"}",

			"If you need to add page to the end of the document, respond with:" +
			"[functionCalling (insertPage)]: {\"location\": \"end\"}",

			"If you need to add page to the start of the document, respond with:" +
			"[functionCalling (insertPage)]: {\"location\": \"start\"}"
		];
		
		func.call = async function(params) {
			Asc.scope.location = params.location;

			await Asc.Editor.callCommand(function(){
				let doc = Api.GetDocument();
				if ("start" === Asc.scope.location)
					doc.MoveCursorToStart();
				else if ("end" === Asc.scope.location)
					doc.MoveCursorToEnd();

				Api.GetDocument().InsertBlankPage();
			});
		};

		return func;
	}
})();

function getWordFunctions() {

	let funcs = [];
	if (true) 
	{
		let func = new RegisteredFunction();
		func.name = "changeParagraphStyle";
		func.params = [
			"parNumber (number): the paragraph number to apply style changes to",
			"style (string): the style name to apply to the paragraph"
		];

		func.examples = [
			"If you need to change the style of paragraph 3 to Heading 1, respond with:" +
			"[functionCalling (changeParagraphStyle)]: {\"parNumber\": 3, \"style\": \"Heading 1\"}"
		];
		
		func.call = async function(params) {
			Asc.scope.parNumber = params.parNumber;
			Asc.scope.styleName = params.style;
			await Asc.Editor.callCommand(function(){
				let doc = Api.GetDocument();
				let par = doc.GetElement(Asc.scope.parNumber - 1);
				if (!par)
					return;

				let style = doc.GetStyle(Asc.scope.styleName);
				par.SetStyle(style);
			});			
		};

		funcs.push(func);
	}

	funcs.push(WORD_FUNCTIONS.changeTextStyle());
	funcs.push(WORD_FUNCTIONS.commentText());
	funcs.push(WORD_FUNCTIONS.rewriteText());
	funcs.push(WORD_FUNCTIONS.insertPage());

	return funcs;

}
