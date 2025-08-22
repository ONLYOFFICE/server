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

(function(exports, undefined)
{
	let Editor = {};
	
	Editor.callMethod = async function(name, args)
	{
		return new Promise(resolve => (function(){
			Asc.plugin.executeMethod(name, args || [], function(returnValue){
				resolve(returnValue);
			});
		})());
	};

	Editor.callCommand = async function(func)
	{
		return new Promise(resolve => (function(){
			Asc.plugin.callCommand(func, false, true, function(returnValue){
				resolve(returnValue);
			});
		})());
	};

	Editor.pause = async function(msec)
	{
		return new Promise(resolve => (function(){
			setTimeout(function(){
				resolve();				
			}, msec);
		})());
	};

	Editor.getType = function() {
		if (Asc.plugin.info.editorSubType === "pdf")
			return "pdf";
		return window.Asc.plugin.info.editorType;
	};

	exports.Asc = exports.Asc || {};
	exports.Asc.Editor = Editor;

	function Library() {
		this.version = 0;
	}

	exports.Asc.PluginsMD = {
		latex: function(md) {
			// Inline: $...$
			md.inline.ruler.after("escape", "latex_inline", function(state, silent) {
				let start = state.pos;
				if (state.src[start] !== '$')
					return false;
				if (state.src[start + 1] === '$')
					return false;

				let content = "";
				let end = start + 1;
				while ((end = state.src.indexOf('$', end)) !== -1) {
					if (state.src.charCodeAt(end - 1) === 92/*\\*/) {
						end++;
						continue;
					}
					content = state.src.slice(start + 1, end);
					content = content.trim();
					break;
				}

				if (!content)
					return false;

				if (!silent) {
					let token = state.push("latex_inline", "span", 0);
					token.content = content;
					token.attrs = [["class", "oo-latex-inline"]];
				}
			
				state.pos = end + 1;
				return true;
			});
			md.renderer.rules.latex_inline = function(tokens, idx) {
				return `<span class="oo-latex-inline">${tokens[idx].content}</span>`;
			};
			
			// Block: $$...$$  
			md.block.ruler.before("fence", "latex_block", function(state, startLine, endLine, silent) {
				let startPos = state.bMarks[startLine] + state.tShift[startLine];
				let maxPos = state.eMarks[startLine];
				let line = state.src.slice(startPos, maxPos).trim();
				
				if (!line.startsWith("$$"))
					return false;
				if (silent)
					return true;
				
				let content = "";
				let found = false;
				
				for (let i = startLine + 1; i < endLine; i++) {
					let pos = state.bMarks[i] + state.tShift[i];
					let max = state.eMarks[i];
					let nextLine = state.src.slice(pos, max).trim();

					if (nextLine === "$$") {
						found = true;
						state.line = i + 1;
						break;
					}

					content += nextLine + "\n";
				}
				
				if (!found) return false;
				
				const token = state.push("latex_block", "span", 0);
				token.block = true;
				token.content = content.trim();
				token.attrs = [["class", "oo-latex"]];
				token.map = [startLine, state.line];

				return true;
			});
			md.renderer.rules.latex_block = function(tokens, idx) {
				return `<span class="oo-latex">${tokens[idx].content}</span>\n`;
			};
		}
	};

	function decodeHtmlText(text) {
		return text
			.replace(/&quot;/g, '"')
			.replace(/&apos;/g, "'")
			.replace(/&amp;/g, '&')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')			
			.replace(/&nbsp;/g, ' ');
	}

	Library.prototype.GetEditorVersion = async function()
	{
		if (this.version !== 0)
			return this.version;

		let version = await Editor.callMethod("GetVersion");
		if ("develop" == version)
			version = "99.99.99";

		let arrVer = version.split(".");
		while (3 > arrVer.length)
			arrVer.push("0");

		this.version = 1000000 * parseInt(arrVer[0]) +  1000 * parseInt(arrVer[1]) + parseInt(arrVer[2]);
		return this.version;
	};

	Library.prototype.GetCurrentWord = async function()
	{
		return await Editor.callMethod("GetCurrentWord");
	};

	Library.prototype.GetSelectedText = async function()
	{
		let result = await Editor.callMethod("GetSelectedText");
		if (result !== "")
			return result;

		return this.GetSelectedContent("text");
	};

	Library.prototype.GetSelectedContent = async function(type) {
		return await Editor.callMethod("GetSelectedContent", [{ type : type }]);
	};

	Library.prototype.GetSelectedImage = async function(type) {
		let res = await Editor.callMethod("GetSelectedContent", [{ type : "html" }]);
		let index1 = res.indexOf("src=\"data:image/");
		if (-1 === index1)
			return "";
		index1 += 5;
		let index2 = res.indexOf("\"", index1);
		if (-1 === index2)
			return "";
		return res.substring(index1, index2);
	};

	Library.prototype.ReplaceTextSmart = async function(text)
	{
		return await Editor.callMethod("ReplaceTextSmart", [text]);
	};

	Library.prototype.InsertAsText = async function(text)
	{
		Asc.scope.data = (text || "").split("\n\n");
		return await Editor.callCommand(function() {
			let oDocument = Api.GetDocument();
			for (let ind = 0; ind < Asc.scope.data.length; ind++) {
				let text = Asc.scope.data[ind];
				if (text.length) {
					let oParagraph = Api.CreateParagraph();
					oParagraph.AddText(text);
					oDocument.Push(oParagraph);
				}
			}
		});
	};

	Library.prototype.InsertAsMD = async function(data, plugins)
	{
		let htmlContent = Asc.Library.ConvertMdToHTML(data, plugins)
		return await Asc.Library.InsertAsHTML(htmlContent);
	};

	Library.prototype.ConvertMdToHTML = function(data, plugins)
	{
		let c = window.markdownit();
		if (plugins) {
			for (let i = 0, len = plugins.length; i < len; i++)
				c.use(plugins[i]);
		}
		return c.render(this.getMarkdownResult(data));
	};

	Library.prototype.InsertAsHTML = async function(data)
	{
		switch (Asc.Editor.getType()) {
			case "word": {
				if (true) {
					await Editor.callCommand(function() {
						let document = Api.GetDocument();
						document.RemoveSelection();
					}, false);
				} else {
					await Editor.callCommand(function() {
						let doc = Api.GetDocument();
						let paras = doc.GetAllParagraphs();
						if (paras.length)
						{
							let lastPara = paras[paras.length - 1];
							let lastElement = lastPara.GetElement(lastPara.GetElementsCount() - 1);
							if (lastElement && lastElement.MoveCursorToPos)
							{
								lastElement.MoveCursorToPos(100000);
							}
						}
					});
				}
			}
			default:
				break;
		}
		return await Editor.callMethod("PasteHtml", [data]);
	};

	Library.prototype.InsertAsComment = async function(text)
	{
		return await Editor.callMethod("AddComment", [{
			UserName : "AI",
			Text : decodeHtmlText(text),
			Time: Date.now(),
			Solver: false
		}]);
	};

	Library.prototype.InsertAsHyperlink = async function(content, hint)
	{
		let text = content;
		start = text.indexOf('htt');
		end = text.indexOf(' ', start);
		if (end == -1)
			end = text.length;

		Asc.scope.link = text.slice(start, end);
		return await Editor.callCommand(function(){
			let oDocument = Api.GetDocument();
			let oRange = oDocument.GetRangeBySelect();
			oRange.AddHyperlink(Asc.scope.link, "Meaning of the word");
		});
	};

	Library.prototype.InsertAsReview = async function(content, isHtml) 
	{
		let isTrackRevisions = await Editor.callCommand(function(){
			let res = Api.asc_GetLocalTrackRevisions();
			Api.asc_SetLocalTrackRevisions(true);
			return res;
		});

		Asc.scope.localTrackRevisions = isTrackRevisions;

		await Editor.callMethod(isHtml ? "PasteHtml" : "PasteText", [content.trim()]);

		if (true !== isTrackRevisions) 
		{
			await Editor.callCommand(function(){
				Api.asc_SetLocalTrackRevisions(Asc.scope.localTrackRevisions);
			});
		}
	};

	Library.prototype.PasteText = async function(text)
	{
		return await Editor.callMethod("PasteText", [text]);
	};

	Library.prototype.SendError = async function(text, errorLevel)
	{
		Asc.scope.errorText = text;
		Asc.scope.errorLevel = errorLevel;
		return await Editor.callCommand(function(){
			Api.sendEvent("asc_onError", Asc.scope.errorText, Asc.scope.errorLevel);
		});
	};

	Library.prototype.GetLocalImagePath = async function(url) {
		return await Editor.callMethod("getLocalImagePath", [url]);
	};

	Library.prototype.AddGeneratedImage = async function(base64) {
		let editorVersion = await Asc.Library.GetEditorVersion();

		if (Asc.Editor.getType() === "pdf") {
			return await Editor.callMethod("PasteHtml", ["<img src=\"" + base64 + "\" />"]);
		}
		
		if (editorVersion >= 9000000) {
			let urlLocal = await this.GetLocalImagePath(base64);
			if (urlLocal.error === true)
				return;

			Asc.scope.url = urlLocal.url;
		} else {
			Asc.scope.url = url;
		}

		switch (window.Asc.plugin.info.editorType) {
			case "word": {
				return await Editor.callCommand(function() {
					let document = Api.GetDocument();
					let paragraph = Api.CreateParagraph();
					let drawing = Api.CreateImage(Asc.scope.url, 100 * 36000, 100 * 36000);
					paragraph.AddDrawing(drawing);
					document.RemoveSelection();
					document.InsertContent([paragraph], true);
				}, false);
			}
			case "cell": {
				return await Editor.callCommand(function() {
					let worksheet = Api.GetActiveSheet();
					worksheet.AddImage(Asc.scope.url, 100 * 36000, 100 * 36000, 0, 2 * 36000, 2, 3 * 36000);
				}, false);
			}
			case "slide": {
				return await Editor.callCommand(function() {
					let presentation = Api.GetPresentation();
					let slide = presentation.GetCurrentSlide();
					let image = Api.CreateImage(Asc.scope.url, 150 * 36000, 150 * 36000);
					slide.AddObject(image);
				}, false);
			}
			default:
				break;
		}
	};

	Library.prototype.AddOleObject = async function(imageUrl, data) {
		switch (window.Asc.plugin.info.editorType) {
			case "word": {
				await Editor.callCommand(function(){
					let document = Api.GetDocument();
					document.RemoveSelection();
				});
				break;
			}
			default:
				break;
		}

		let W = 100;
		let H = 100;

		let info = window.Asc.plugin.info;
		var obj = {
			guid : info.guid,
			widthPix : info.mmToPx * W,
			heightPix : info.mmToPx * H,
			width : W,
			height : H,
			imgSrc : imageUrl,
			data : data
		};

		return await Editor.callMethod("AddOleObject", [obj]);
	};

	Library.prototype.trimResult = function(data, posStart, isSpaces, extraCharacters) {
		let pos = posStart || 0;
		if (-1 != pos) {
			let trimC = ["\"", "'", "\n", "\r", "`"];
			if (true === isSpaces)
				trimC.push(" ");
			while (pos < data.length && trimC.includes(data[pos]))
				pos++;

			let posEnd = data.length - 1;
			while (posEnd > 0 && trimC.includes(data[posEnd]))
				posEnd--;

			if (posEnd > pos)
				return data.substring(pos, posEnd + 1);				
		}
		return data;
	};

	Library.prototype.getTranslateResult = function(data, dataSrc) {
		data = this.trimResult(data, 0, true);
		let trimC = ["\"", "'", "\n", "\r", " "];
		if (dataSrc.length > 0 && trimC.includes(dataSrc[0])) {
			data = dataSrc[0] + data;
		}
		if (dataSrc.length > 1 && trimC.includes(dataSrc[dataSrc.length - 1])) {
			data = data + dataSrc[dataSrc.length - 1];
		}
		return data;
	};

	Library.prototype.getMarkdownResult = function(data) {
		let markdownEscape = data.indexOf("```md");
		if (-1 !== markdownEscape && markdownEscape < 5)
			data = data.substring(markdownEscape + 5);		
		return this.trimResult(data);
	};

	exports.Asc = exports.Asc || {};
	exports.Asc.Library = new Library();

	exports.Asc.Prompts = {
		getFixAndSpellPrompt(content) {
			let prompt = `I want you to act as an editor and proofreader. \
I will provide you with some text that needs to be checked for spelling and grammar errors. \
Your task is to carefully review the text and correct any mistakes, \
ensuring that the corrected text is free of errors and maintains the original meaning. \
Only return the corrected text. \
Here is the text that needs revision: \"${content}\"`;
			return prompt;
		},
		getSummarizationPrompt(content, language) {
			let prompt = "Summarize the following text. ";
			if (language) {
				prompt += "and translate the result to " + language;
				prompt += ". Return only the resulting translated text.";
			} else {
				prompt += ". Return only the resulting text.";
			}
			prompt += "Text: \"\"\"\n";
			prompt += content;
			prompt += "\n\"\"\"";
			return prompt;
		},
		getTranslatePrompt(content, language) {
			let prompt = "Translate the following text to " + language;
			prompt += ". Return only the resulting text.";
			prompt += "Text: \"\"\"\n";
			prompt += content;
			prompt += "\n\"\"\"";
			return prompt;
		},
		getExplainPrompt(content) {
			let prompt = "Explain what the following text means. Return only the resulting text.";
			prompt += "Text: \"\"\"\n";
			prompt += content;
			prompt += "\n\"\"\"";
			return prompt;
		},
		getTextLongerPrompt(content) {
			let prompt = "Make the following text longer. Return only the resulting text.";
			prompt += "Text: \"\"\"\n";
			prompt += content;
			prompt += "\n\"\"\"";
			return prompt;
		},
		getTextShorterPrompt(content) {
			let prompt = "Make the following text simpler. Return only the resulting text.";
			prompt += "Text: \"\"\"\n";
			prompt += content;
			prompt += "\n\"\"\"";
			return prompt;
		},
		getTextRewritePrompt(content) {
			let prompt = "Rewrite the following text differently. Return only the resulting text.";
			prompt += "Text: \"\"\"\n";
			prompt += content;
			prompt += "\n\"\"\"";
			return prompt;
		},
		getTextKeywordsPrompt(content) {
			let prompt = `Get Key words from this text: "${content}"`;
			return prompt;
		},
		getExplainAsLinkPrompt(content) {
			let prompt = "Give a link to the explanation of the following text. Return only the resulting link.";
			prompt += "Text: \"\"\"\n";
			prompt += content;
			prompt += "\n\"\"\"";
			return prompt;
		},
		getImageDescription() {
			return "Describe in detail everything you see in this image. Mention the objects, their appearance, colors, arrangement, background, and any noticeable actions or interactions. Be as specific and accurate as possible. Avoid making assumptions about things that are not clearly visible."
		},
		getImagePromptOCR() {
			return "Extract all text from this image as accurately as possible. Preserve original reading order and formatting if possible. Recognize tables and images if possible. Do not add or remove any content. Output recognized objects in md format if possible. If not, return plain text.";
		}
	};

})(window);
