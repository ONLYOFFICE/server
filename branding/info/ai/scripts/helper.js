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

(function(window, undefined) {

	window.Asc.plugin.init = function() {		
		let input = document.getElementById("input-action");
		if (input) {
			input.addEventListener('keydown', function(event) {
				if (event.keyCode === 27) {
					window.Asc.plugin.sendToPlugin("onHelperClose");
					return;
				}

				if (event.keyCode === 13 && !event.shiftKey) {
					window.Asc.plugin.sendToPlugin("onHelperAction", input.value);
					return;
				}
			});		
		}

		window.addEventListener("focus", function() {
			let input = document.getElementById("input-action");
			if (input)
				input.focus();
		});

		if (input) {
			input.addEventListener("blur", function() {
				window.Asc.plugin.sendToPlugin("onHelperClose");
			});
		}

		window.Asc.plugin.sendToPlugin("onHelperShow", input.value);
	};

	function onThemeChanged(theme) {
		window.Asc.plugin.onThemeChangedBase(theme);

		let input = document.getElementById("input-action");
		if (input) {
			let themeType = theme.type || "light";
			//input.style.backgroundColor = (themeType === "light") ? "rgb(255, 255, 255)" : "rgba(64, 64, 64)";
			input.style.backgroundColor = theme["canvas-anim-pane-background"];
			input.style['box-shadow'] = theme["canvas-cell-title-border-selected"] + ' 0 0 4px 1px';

			input.style.caretColor = (themeType === "light") ? "#000000" : "#FFFFFF";
			input.style.color = input.style.caretColor = (themeType === "light") ? "#000000" : "#FFFFFF";
		}
	}

	window.Asc.plugin.onTranslate = function() {
		
	};

	window.Asc.plugin.onThemeChanged = onThemeChanged;
	window.Asc.plugin.attachEvent("onThemeChanged", onThemeChanged);

})(window, undefined);
