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

function TextAnnotationPopup()
{
	this.popup = null;
	this.type = 0; // 0 - spelling, 1 - grammar
	this.paraId = -1;
	this.rangeId = -1;

	this.content = "";
	this.width = 318;
	this.height = 500;
	
	this.open = function(type, paraId, rangeId, data)
	{
		if (this.popup && 0 === this.type && 1 === type)
			return null;
		
		this._calculateWindowSize(data);
		return this._open(type, paraId, rangeId);
	};

	this._open = function(type, paraId, rangeId) 
	{
		if (this.type === type
			&& rangeId === this.rangeId
			&& paraId === this.paraId)
			return this.popup;
			
		this.type = type;
		this.paraId = paraId;
		this.rangeId = rangeId;
		
		if (this.popup)
			this.popup.close();

		let variation = {
			url : 'annotationPopup.html',
			isVisual : true,
			buttons : this._getButtons(),
			isModal : false,
			description: this._getTitle(),
			EditorsSupport : ["word", "slide", "cell", "pdf"],
			size : [this.width, this.height],
			fixedSize : true,
			isTargeted : true
		};
		let popup = new window.Asc.PluginWindow();

		let _t = this;
		popup.attachEvent("onWindowReady", function() {
			let name2color = {
				"theme-light": "#F62211",
				"theme-classic-light": "#D9534F",
				
				"theme-dark": "#F62211",
				"theme-contrast-dark": "#F62211",

				"theme-gray": "#F62211",

				"theme-white": "#F23D3D",
				"theme-night": "#F23D3D"
			};
			let type2color = {
				"light": "#F62211",
				"dark": "#F62211"
			};

			let color = type2color["light"];
			if (window.Asc.plugin.theme)
			{
				if (window.Asc.plugin.theme.Name && name2color[window.Asc.plugin.theme.Name])
					color = name2color[window.Asc.plugin.theme.Name];
				else if (window.Asc.plugin.theme.Type && type2color[window.Asc.plugin.theme.Type])
					color = type2color[window.Asc.plugin.theme.Type];
			}

			popup.command("onUpdateContent", {
				content : _t.content,
				color : color
			});
		});

		popup.show(variation);
		this.popup = popup;
		return popup;
	};
	
	this.close = function(type) 
	{
		if (undefined !== type && this.type !== type)
			return;
		
		if (!this.popup)
			return;
		
		this.type = -1;
		this.rangeId = -1;
		this.paraId = -1;

		this.popup.close();
		this.popup = null;
		Asc.Editor.callMethod("FocusEditor");
	};

	this._getTitle = function()
	{
		return window.Asc.plugin.tr(this.type === 0 ? "Spelling suggestion" : "Grammar suggestion");
	};
	
	this._getButtons = function()
	{
		return [
			{ text: window.Asc.plugin.tr('Accept'), primary: true },
			{ text: window.Asc.plugin.tr('Reject'), primary: false }
		];
	};

	this._calculateWindowSize = function(data)
	{
		let backColor = window.Asc.plugin.theme ? window.Asc.plugin.theme["background-normal"] : "#FFFFFF";
		let textColor = window.Asc.plugin.theme ? window.Asc.plugin.theme["text-normal"] : "#3D3D3D";
		let borderColor = window.Asc.plugin.theme ? window.Asc.plugin.theme["border-divider"] : "#666666";
		let ballonColor = window.Asc.plugin.theme ? window.Asc.plugin.theme["canvas-background"] : "#F5F5F5";
		this.content = `<div class="back-color text-color" style="background:${backColor}; overflow:hidden; max-width:320px; min-width:280px;color:${textColor}; user-select:none;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
			<div style="padding:16px 16px 0px 16px;">

				<div style="margin-bottom:12px;">
					<div class="text-color" style="font-size:11px; font-weight:700; color:${textColor}; margin-bottom:6px;">
						${window.Asc.plugin.tr("Suggested correction")}
					</div>

					<div class="ballon-color text-color border-color" style="font-size:12px; color:${textColor}; line-height:1.5; background:${ballonColor}; border:1px solid ${borderColor}; border-radius:3px; padding:10px;">
						<div style="display:flex; align-items:center; gap:8px;">
							<span class="text-color" style="color:${textColor}; font-weight:normal;">${data.original}</span>
							<span class="text-color" style="color:${textColor}; font-weight:bold;">→</span>
							<span class="text-color" style="color:${textColor}; font-weight:normal;">${data.suggested}</span>
						</div>
					</div>
				</div>`;

		if (data.explanation) {
			this.content += `<div style="margin-bottom:16px;">
				<div class="text-color" class="text-color" style="font-size:11px; font-weight:700; color:${textColor}; margin-bottom:6px;">
					${window.Asc.plugin.tr("Explanation")}
				</div>

				<div class="ballon-color text-color border-color" style="font-size:12px; color:${textColor}; line-height:1.5; background:${ballonColor}; border:1px solid ${borderColor}; border-radius:3px; padding:10px;">${data.explanation}</div>
			</div>`;
		}

		this.content += "</div></div>";

		let measureDiv = document.createElement("div");
		measureDiv.style.position = "absolute";
		measureDiv.style.left = "-9999px";
		measureDiv.style.top = "-9999px";
		measureDiv.style.width = this.width + "px";
		measureDiv.style.visibility = "hidden";
		measureDiv.style.pointerEvents = "none";
		measureDiv.style.opacity = "0";
		measureDiv.style.margin = "0";
		measureDiv.style.padding = "0";
		measureDiv.innerHTML = this.content;

		document.body.appendChild(measureDiv);

		this.height = measureDiv.scrollHeight;

		document.body.removeChild(measureDiv);
	};
}

var textAnnotatorPopup = new TextAnnotationPopup();
