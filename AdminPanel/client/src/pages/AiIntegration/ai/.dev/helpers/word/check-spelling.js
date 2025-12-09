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
		"name": "checkSpelling",
		"description": "Checks spelling and fixes text errors in the current paragraph.",
		"parameters": {
			"type": "object",
			"properties": {},
			"required": []
		},
		"examples": [
			{
				"prompt": "Check spelling in this paragraph",
				"arguments": {}
			},
			{
				"prompt": "Fix grammar in current paragraph",
				"arguments": {}
			},
			{
				"prompt": "Check for text errors",
				"arguments": {}
			}
		]
	});
	
	func.call = async function(params) {

		let text = await Asc.Editor.callCommand(function(){
			let par = Api.GetDocument().GetCurrentParagraph();
			if (!par)
				return "";
			par.Select();
			return par.GetText();
		});

		let argPromt = "Check spelling and grammar for text:" + ":\n" + text + "\n Answer with only the new corrected text, no need of any explanations.";

		let isTrackChanges = await Asc.Editor.callCommand(function(){
			let isOn = Api.GetDocument().IsTrackRevisions();
			if (isOn)
				Api.GetDocument().SetTrackRevisions(false);
			return isOn;
		});

		let requestEngine = AI.Request.create(AI.ActionType.Chat);
		if (!requestEngine)
			return;

		await Asc.Editor.callMethod("StartAction", ["GroupActions"]);

		await Asc.Editor.callMethod("StartAction", ["Block", "AI (" + requestEngine.modelUI.name + ")"]);

		let isSendedEndLongAction = false;
		async function checkEndAction() {
			if (!isSendedEndLongAction) {
				await Asc.Editor.callMethod("EndAction", ["Block", "AI (" + requestEngine.modelUI.name + ")"]);
				isSendedEndLongAction = true
			}
		}

		let resultText = "";

		let result = await requestEngine.chatRequest(argPromt, false, async function(data) {
			if (!data)
				return;
			await checkEndAction();

			resultText += data;

			await Asc.Editor.callMethod("EndAction", ["GroupActions", "", "cancel"]);
			await Asc.Editor.callMethod("StartAction", ["GroupActions"]);

			Asc.scope.text = resultText;
			await Asc.Editor.callCommand(function(){
				let par = Api.GetDocument().GetCurrentParagraph();
				if (!par)
					return "";
				par.Select();					
				Api.ReplaceTextSmart([Asc.scope.text]);
			});
		});

		await checkEndAction();

		await Asc.Editor.callMethod("EndAction", ["GroupActions", "", "cancel"]);
		await Asc.Editor.callMethod("StartAction", ["GroupActions"]);

		Asc.scope.modelName = requestEngine.modelUI.name;
		await Asc.Editor.callCommand(function(){
			return Api.GetDocument().SetAssistantTrackRevisions(true, Asc.scope.modelName);
		});

		Asc.scope.text = resultText;
		await Asc.Editor.callCommand(function(){
			let par = Api.GetDocument().GetCurrentParagraph();
			if (!par)
				return "";
			par.Select();
			Api.ReplaceTextSmart([Asc.scope.text]);
		});

		await Asc.Editor.callCommand(function(){
			return Api.GetDocument().SetAssistantTrackRevisions(false);
		});

		if (isTrackChanges)
		{
			await Asc.Editor.callCommand(function(){
				Api.GetDocument().SetTrackRevisions(true);
			});
		}

		await Asc.Editor.callMethod("EndAction", ["GroupActions"]);
	};
	
	return func;
})();
