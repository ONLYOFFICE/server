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

function MarkDownStreamer()
{
	this.isUseStreamContentMethod = true;
	this.isStated = false;
	this.stable = "";
	this.tail = "";

	this.msPlugins = [Asc.PluginsMD.latex, Asc.PluginsMD.forms];

	this.isStreaming = window.EditorHelper.isSupportStreaming;
}

// INTERFACE
MarkDownStreamer.prototype.onStreamChunk = async function(mdValue, isFinalChunk)
{
	if (!this.isStated) {
		await Asc.Editor.callMethod("StartAction", ["GroupActions"]);
		this.isStated = true;
	}

	if (!this.isStreaming) {
		this.tail += mdValue;

		if (isFinalChunk) {
			await this.onStreamEnd();
			this.isStated = false;
		}
		return;
	}		

	let checkValue = this.tail + mdValue;
	let cutPoint = this._findStableCutPoint(checkValue);

	if (cutPoint >= 0) {
		if (this.isUseStreamContentMethod) {
			await this.onStreamStableTail(checkValue.slice(0, cutPoint + 1), checkValue.slice(cutPoint + 1));
		} else {
			await this.onStable(checkValue.slice(0, cutPoint + 1));
			await this.onTail(checkValue.slice(cutPoint + 1));
		}		
	} else {
		if (this.isUseStreamContentMethod) {
			await this.onStreamStableTail("", checkValue);
		} else {
			await this.onTail(checkValue);
		}
	}

	if (isFinalChunk) {
		await this.onStreamEnd();
		this.isStated = false;
	}
};

MarkDownStreamer.prototype.checkUndo = async function()
{
	if (this.tail === "")
		return;

	//console.log("Undo");
	await Asc.Editor.callMethod("EndAction", ["GroupActions", "", "cancel"]);
	this.tail = "";
};

MarkDownStreamer.prototype.onStreamEnd = async function()
{
	if (!this.isStated)
		return;

	if (this.tail !== "") {

		if (!this.isStreaming) {
			await Asc.Library.InsertAsMD(this.tail, this.msPlugins);
		} else {
			// save tail as stable
			await Asc.Editor.callMethod("EndAction", ["GroupActions"]);
		}		
	}		

	await Asc.Editor.callMethod("EndAction", ["GroupActions"]);
};

MarkDownStreamer.prototype.onStable = async function(mdValue)
{
	//console.log("Stable chunk:" + mdValue);

	this.checkUndo();

	await Asc.Library.InsertAsMD(mdValue, this.msPlugins);
	this.stable += mdValue;
};

MarkDownStreamer.prototype.onTail = async function(mdValue)
{
	if (mdValue === "")
		return;

	this.checkUndo();

	await Asc.Editor.callMethod("StartAction", ["GroupActions"]);
	await Asc.Library.InsertAsMD(mdValue, this.msPlugins);
	this.tail = mdValue;

	//console.log("Tail chunk:" + mdValue);
};

MarkDownStreamer.prototype.onStreamStableTail = async function(stableMD, tailMD)
{
	if (stableMD === "" && tailMD === "")
		return;

	let obj = {
		stable: "",
		tail: "",
		undo: false,
		word: {
			removeSelection: true
		}
	};

	if (this.tail !== "")
		obj.undo = true;

	if (stableMD !== "")
		obj.stable = Asc.Library.getHTMLFromMD(stableMD, this.msPlugins);
	if (tailMD !== "")
		obj.tail = Asc.Library.getHTMLFromMD(tailMD, this.msPlugins);

	this.tail = tailMD;

	//console.log("Streamed chunk. Stable:" + stableMD + " Html:" + obj.stable);

	await Asc.Editor.callMethod("InsertStreamedContent", [obj]);
};

MarkDownStreamer.prototype.reset = function()
{
	this.stable = "";
	this.tail = "";
};

// PRIVATE METHODS
MarkDownStreamer.prototype._findStableCutPoint = function(markdown)
{
	const BLOCK_TYPES = {
		CODE: { start: '```', end: '```', multiline: true },
		LATEX: { start: '$$', end: '$$', multiline: true },
		TABLE: { lineStart: '|', needsEmpty: true }
	};
	
	let lastSafePoint = -1;
	let lineStart = 0;
	let currentLine = '';
	let activeBlock = null; // { type, blockDef }
	
	for (let i = 0, len = markdown.length; i < len; i++) {
		let char = markdown[i];

		if (char === '\n') {
			let trimmed = currentLine.trim();
			
			if (activeBlock) {
				let def = activeBlock.blockDef;
				
				if (def.multiline) {
					if (trimmed.startsWith(def.end)) {
						activeBlock = null;
						let nextLineStart = i + 1;
						let nextChar = markdown[nextLineStart];
						if (nextChar === '\n' || nextChar === undefined) {
							lastSafePoint = i;
						}
					}
				} else if (def.lineStart) {
					let matches = typeof def.lineStart === 'string' 
						? trimmed.startsWith(def.lineStart)
						: def.lineStart.test(currentLine);
					
					if (!matches) {
						activeBlock = null;
						if (def.needsEmpty && !trimmed) {
							lastSafePoint = i;
						}
					}
				}
			} else {
				
				for (let btKey in BLOCK_TYPES) {
					let bt = BLOCK_TYPES[btKey];
					if (bt.multiline && trimmed.startsWith(bt.start)) {
						activeBlock = { type: btKey, blockDef: bt };
						break;
					}
				}

				if (!activeBlock && !trimmed) {
					lastSafePoint = i;
				}
			}
			
			currentLine = '';
			lineStart = i + 1;
		} else {
			currentLine += char;
		}
	}
	return lastSafePoint;
};

function getAnyFormGenerationPrompt(documentDescription) {
	let instructions = `# Instructions for Generating Markdown Documents with Interactive Fields

## General Rules

Generate the document **preferably** in Markdown (.md) format.
Output only the final result — no introductions, explanations, or phrases like "Here's the text" or "The result is".

The document MUST be written in pure Markdown.
Absolutely forbidden:
- HTML tags (e.g., <p>, <div>, <span>, <h1>, <img>, <br>)
- HTML attributes (e.g., align="center", style="...")
- Embedded CSS
- Raw HTML blocks of any kind
Emoji MUST NOT be wrapped in HTML containers.
If you cannot decorate or center text without HTML, do NOT decorate or center it at all.

If possible, provide the output in valid Markdown (.md) format, but do not wrap it in \`\`\`markdown\`\`\` or any other code block.

When generating a document, use standard Markdown syntax. For interactive input fields, use the special syntax \`{FIELD:...}\`.

## Field Types and Their Usage

### 1. Checkbox
Used for fields that can be checked (yes/no, agree/disagree).

**Syntax:**
\`\`\`
{FIELD:type='checkbox',checked='false',key='uniqueKey',text='Description'}
\`\`\`

**Parameters:**
- \`type='checkbox'\` - field type
- \`checked='true'/'false'\` - initial state
- \`key='uniqueKey'\` - unique field key
- \`text='...'\` - description text (optional)
- \`symbolChecked:'☑'\` - symbol for checked state (optional, default ☑)
- \`symbolUnchecked:'☐'\` - symbol for unchecked state (optional, default ☐)

**Example:**
\`\`\`
I agree to the terms: {FIELD:type='checkbox',checked='false',key='agreement',text='Agreement'}
\`\`\`

### 2. Radiobutton
Used for selecting one option from a group (mutually exclusive choices).

**Syntax:**
\`\`\`
{FIELD:type='radiobutton',checked='false',key='uniqueOption',groupKey='groupName',text='Option text'}
\`\`\`

**Parameters:**
- \`type='radiobutton'\` - field type
- \`checked='true'/'false'\` - initial state (only one button in the group should be true)
- \`key='uniqueOption'\` - unique key for this option
- \`groupKey='groupName'\` - **REQUIRED**: same key for all radio buttons in one group
- \`text='...'\` - option text

**IMPORTANT:** All radio buttons that belong to the same question/choice must have the same \`groupKey\`.

**Example:**
\`\`\`
Select your gender:
- {FIELD:type='radiobutton',checked='true',key='gender_male',groupKey='gender',text='Male'}
- {FIELD:type='radiobutton',checked='false',key='gender_female',groupKey='gender',text='Female'}
- {FIELD:type='radiobutton',checked='false',key='gender_other',groupKey='gender',text='Other'}
\`\`\`

### 3. Combobox (Dropdown List)
Used for selecting one value from a predefined list.

**Syntax:**
\`\`\`
{FIELD:type='combobox',items:'option1,option2,option3',selected:'option1',key='uniqueKey',text='Description'}
\`\`\`

**Parameters:**
- \`type='combobox'\` - field type
- \`items:'item1,item2,item3'\` - list of options separated by commas
- \`selected:'item'\` - default selected value (optional)
- \`key='uniqueKey'\` - unique field key
- \`text='...'\` - description text (optional)

**Example:**
\`\`\`
City: {FIELD:type='combobox',items:'New York,Los Angeles,Chicago,Houston',selected:'New York',key='city'}
\`\`\`

### 4. Textbox (Text Field)
Used for entering arbitrary text.

**Syntax:**
\`\`\`
{FIELD:type='textbox',value:'initial value',placeholder:'hint text',key='uniqueKey'}
\`\`\`

**Parameters:**
- \`type='textbox'\` - field type
- \`value:'...'\` - initial value (optional)
- \`placeholder:'...'\` - hint text in empty field (optional)
- \`key='uniqueKey'\` - unique field key

**Example:**
\`\`\`
Full Name: {FIELD:type='textbox',placeholder:'Enter full name',key='fullname'}
Comment: {FIELD:type='textbox',value:'',key='comment'}
\`\`\`

### 5. Date (Date Field)
Used for entering dates.

**Syntax:**
\`\`\`
{FIELD:type='date',value:'DD.MM.YYYY',key='uniqueKey'}
\`\`\`

**Parameters:**
- \`type='date'\` - field type
- \`value:'DD.MM.YYYY'\` - initial date value in DD.MM.YYYY format
- \`key='uniqueKey'\` - unique field key

**Example:**
\`\`\`
Date of Birth: {FIELD:type='date',value:'01.01.2000',key='birthdate'}
Signing Date: {FIELD:type='date',value:'10.11.2025',key='signdate'}
\`\`\`

## Rules for Using Keys

### Unique Keys
Each field must have a unique \`key\` that identifies it.

### Same Keys for Related Fields
**IMPORTANT:** If multiple fields in the document MUST have the same value, use the same \`key\` for them.

**Examples when the same key is needed:**
- Client name mentioned in multiple places in a contract
- Document date repeated at the beginning and end
- Contract number appearing in different sections

**Example:**
\`\`\`
# Contract

Client: {FIELD:type='textbox',placeholder:'Client full name',key='client_name'}

... contract text ...

Client Signature: {FIELD:type='textbox',placeholder:'Full name',key='client_name'}
________________
\`\`\`

In this example, both fields use \`key='client_name'\`, so when one field is filled, the other will be automatically filled as well.

### GroupKey for Radio Buttons
For radio buttons, always use the same \`groupKey\` for all options of the same question. This ensures that only one option can be selected from the group.

## Recommendations for Choosing Field Type

| Task | Field Type |
|------|------------|
| Yes/No, agreement, checkbox | \`checkbox\` |
| Choose one of 2-5 options (exclusive) | \`radiobutton\` |
| Choose from many options (list) | \`combobox\` |
| Enter text, name, address | \`textbox\` |
| Enter date | \`date\` |

## Complete Document Example

\`\`\`markdown
# Employee Form

## Personal Information

**Full Name:** {FIELD:type='textbox',placeholder:'John Smith',key='fullname'}

**Date of Birth:** {FIELD:type='date',value:'01.01.1990',key='birthdate'}

**Gender:**
- {FIELD:type='radiobutton',checked='true',key='gender_m',groupKey='gender',text='Male'}
- {FIELD:type='radiobutton',checked='false',key='gender_f',groupKey='gender',text='Female'}

**City of Residence:** {FIELD:type='combobox',items:'New York,Los Angeles,Chicago,Other',key='city'}

## Education

**Education Level:**
- {FIELD:type='radiobutton',checked='false',key='edu_bachelors',groupKey='education',text='Bachelor's Degree'}
- {FIELD:type='radiobutton',checked='false',key='edu_masters',groupKey='education',text='Master's Degree'}
- {FIELD:type='radiobutton',checked='false',key='edu_highschool',groupKey='education',text='High School'}

## Agreements

{FIELD:type='checkbox',checked='false',key='agree_data',text='Data processing consent'} I agree to personal data processing

{FIELD:type='checkbox',checked='false',key='agree_rules',text='Rules agreement'} I agree to the company rules

---

**Date Completed:** {FIELD:type='date',value:'10.11.2025',key='fill_date'}

**Signature:** {FIELD:type='textbox',placeholder:'Full name',key='fullname'}
\`\`\`

## Important Notes

1. Always use single quotes \`'\` for string values
2. For lists in \`items\` use colon \`:\` and commas without spaces
3. Dates are always in \`DD.MM.YYYY\` format
4. Don't forget \`groupKey\` for radio buttons
5. Use meaningful names for \`key\` (in English, without spaces)
6. If a field should be empty, use \`value:''\` or \`text:''\``;

	let fullPrompt = instructions + "\n\n# Document to Generate\n\n" + documentDescription;
	return fullPrompt;
}

function getAnyDocumentGenerationPrompt(documentDescription) {

	const instructions = "Generate the document **preferably** in Markdown (.md) format.\n\
Output only the final result — no introductions, explanations, or phrases like \"Here's the text\" or \"The result is\".\n\
The document MUST be written in pure Markdown.\n\
Absolutely forbidden:\n\
- HTML tags (e.g., <p>, <div>, <span>, <h1>, <img>, <br>)\n\
- HTML attributes (e.g., align=\"center\", style=\"...\")\n\
- Embedded CSS\n\
- Raw HTML blocks of any kind\n\
Emoji MUST NOT be wrapped in HTML containers.\n\
If you cannot decorate or center text without HTML, do NOT decorate or center it at all.\n\
If possible, provide the output in valid Markdown (.md) format, but do not wrap it in ```markdown``` or any other code block.\n";

	let fullPrompt = instructions + "\nDescription:\n\n" + documentDescription;
	return fullPrompt;
}

async function getAnyPresentationGenerationPrompt(documentDescription) {
	let hs = HELPERS.slide;
	let funcName = "generatePresentationWithTheme";
	let func = null;

	for (let i = 0, len = hs.length; i < len && !func; i++) {
		if (Array.isArray(hs[i])) {
			for (let j = 0, len2 = hs[i].length; j < len2; j++) {
				if (hs[i][j].name === funcName) {
					func = hs[i][j];
					break;
				}
			}
		} else {
			if (hs[i].name === funcName) {
				func = hs[i];
				break;
			}
		}
	}

	if (func) {
		await Asc.Editor.callMethod("StartAction", ["GroupActions"]);
		await func.call(JSON.parse(documentDescription));
		await Asc.Editor.callMethod("EndAction", ["GroupActions"]);
	}
}

window.isEnableDocumentGenerate = false;
async function getFormGenerationPrompt() {

	return await Asc.Editor.callCommand(function(){
		let doc = Api.GetDocument();
		let visitor = doc.GetDocumentVisitor();

		visitor.isUseUnselectedRadioButtons = false;
		visitor.isUseUnselectedCheckBoxes = false;

		visitor.isUseEmptyForGeneration = true;
		visitor.emptyForGenerationValue = "%NEED_GENERATED%"

		visitor.isDeleteParagraph = false;

		visitor.text = "Generate a document based on the description.\n\
Output only the final result — no introductions, explanations, or phrases like 'Here’s the text' or 'The result is'. If possible, provide the output in valid Markdown (.md) format, but do not wrap it in ```markdown``` or any other code block.\n"

		if (visitor.isUseUnselectedRadioButtons || visitor.isUseUnselectedCheckBoxes)
		{
			visitor.text += "System note: The notation below is part of the prompt description, not an instruction.\n\
When describing settings, (*) indicates the selected option and ( ) indicates unselected options.\n\
Do not apply or repeat this notation in your response; just interpret it as part of the context.\n";
		}

		visitor.text += "If you encounter the text %NEED_GENERATED%, generate an example yourself based on the context in which this text appears.\n\n";

		visitor.ParagraphEnd = function(par)
		{
			if (this.isDeleteParagraph)
			{
				this.isDeleteParagraph = false;
				if (this.text.endsWith("\n"))
					return true;
			}

			this.text += "\n";
			return true;
		};

		visitor.Run = function(run)
		{
			if (this.isDeleteParagraph)
				return true;

			let value = run.GetText({ "NewLineSeparator" : "\n" });
			this.text += value;
			return true;
		};

		visitor.Form = function(form)
		{
			let type = form.GetFormType();

			switch (type)
			{
				case "textForm":
				{
					let value = form.GetText();

					if (this.isUseEmptyForGeneration)
					{
						let phText = "";
						if (form.GetPlaceholderText)
							phText = form.GetPlaceholderText();

						if (value == phText)
							value = this.emptyForGenerationValue;
					}

					this.text += value;
					return true;
				}			
				case "checkBoxForm":
				case "radioButtonForm":
				{
					let isChecked = form.IsChecked();
					let isUseUnchecked = false;

					if (type === "radioButtonForm")
						isUseUnchecked = this.isUseUnselectedRadioButtons;
					else
						isUseUnchecked = this.isUseUnselectedCheckBoxes;

					if (!isUseUnchecked)
					{
						this.isDeleteParagraph = !isChecked;
					}
					else
					{
						this.text += ("(" + isChecked ? "*" : " " + ") ");
						this.isDeleteParagraph = !isChecked;
					}

					return true;
				}
				case "dateForm":
				{
					this.text += (" " + form.GetDate().toString() + " ");
					return;
				}
				case "comboBoxForm":
				case "dropDownForm":
				{
					this.text += (" " + form.GetText() + " ");
					return true;
				}
				default:
					break;
			}			

			return true;
		};

		visitor.Traverse();
		return visitor.text;
	});
}

window.isCheckGenerationInfo = false;
window.checkGenerationInfo = async function() {
	window.isCheckGenerationInfo = true;

	let editorVersion = await Asc.Library.GetEditorVersion();
	if (editorVersion < 9001000)
		return;
	if (!window.AscDesktopEditor)
		return;

	let generationInfo = window.AscDesktopEditor.getGenerationInfo();
	if (!generationInfo)
		return;

	let generationValue = "";

	switch (generationInfo.type) {
		case "ai-gen-docx":
			generationValue = getAnyDocumentGenerationPrompt(generationInfo.value);
			break;
		case "ai-gen-pptx":
			return await getAnyPresentationGenerationPrompt(generationInfo.value);
			break;
		case "ai-gen-form":
			generationValue = getAnyFormGenerationPrompt(generationInfo.value);
			break;
		case "ai":
			generationValue = generationInfo.value;
			break;
		default:
			break;
	}

	if (generationValue !== "") {

		switch (Asc.Editor.getType()) {
			case "word":
			{
				Asc.Editor.callMethod("FocusEditor");

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

				let markdownStreamer = new MarkDownStreamer();

				let agentHistory = [];

				if (!Array.isArray(generationValue)) {
					agentHistory.push({
						role: "user",
						content: generationValue
					});
				} else {
					agentHistory = generationValue;
				}

				let isSupportStreaming = markdownStreamer.isStreaming;
				async function onStreamEvent(data, end) {
					await markdownStreamer.onStreamChunk(data, end);
				}

				let result = await requestEngine.chatRequest(agentHistory, false, isSupportStreaming ? async function(data) {
					if (!data)
						return;

					if (isSupportStreaming)
						await checkEndAction();
					
					await onStreamEvent(data);
				} : undefined);

				if (!isSupportStreaming) {
					await markdownStreamer.onStreamChunk(result, true);
				}
				markdownStreamer.onStreamEnd();

				await checkEndAction();
				break;
			}
			default:
				break;
		}	

	}
}
