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
		"name": "commentText",
		"description": "Adds a comment or footnote to explain or annotate the selected text. If no text is selected, works with the current paragraph.",
		"parameters": {
			"type": "object",
			"properties": {
				"prompt": {
					"type": "string",
					"description": "The instruction for what to explain or comment about the text."
				},
				"type": {
					"type": "string",
					"enum": ["comment", "footnote"],
					"description": "Whether to add as a comment or as a footnote.",
					"default": "comment"
				}
			},
			"required": ["prompt"]
		},
		"examples": [
			{
				"prompt": "Explain this text",
				"arguments": { "prompt": "Explain this text", "type": "comment" }
			},
			{
				"prompt": "Add a historical context as footnote",
				"arguments": { "prompt": "Add historical context", "type": "footnote" }
			},
			{
				"prompt": "Comment on the significance",
				"arguments": { "prompt": "Explain significance", "type": "comment" }
			}
		]
	});
	
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
})();
