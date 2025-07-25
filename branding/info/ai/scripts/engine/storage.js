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
	exports.AI = exports.AI || {};
	var AI = exports.AI;
	AI.UI = AI.UI || {};
	AI.Storage = AI.Storage || {};
	AI.Storage.Version = 3;

	AI.isLocalDesktop = (function(){
		if (window.navigator && window.navigator.userAgent.toLowerCase().indexOf("ascdesktopeditor") < 0)
			return false;
		if (window.location && window.location.protocol == "file:")
			return true;
		if (window.document && window.document.currentScript && 0 == window.document.currentScript.src.indexOf("file:///"))
			return true;
		return false;
	})();

	AI.isLocalDesktopForNotStreamedRequests = (function(){
		if (AI.isLocalDesktop)
			return true;

		if (window.location && window.location.protocol == "onlyoffice:")
			return true;

		return false;
	})();

	AI.isLocalUrl = function(url) {
		let filter = ["localhost", "127.0.0.1"];
		for (let i = 0, len = filter.length; i < len; i++) {
			let pos = url.indexOf(filter[i]);
			if (pos >= 0 && pos < 10)
				return true;
		}
		return false;
	};

	AI.getDesktopLocalVersion = function() {
		let ret = 99 * 1000000 + 99 * 1000 + 99;
		if (!AI.isLocalDesktop)
			return ret;
		let pos = window.navigator.userAgent.indexOf("AscDesktopEditor/");
		let pos2 = window.navigator.userAgent.indexOf(" ", pos);
		if (pos === -1 || pos2 === -1)
			return ret;
		try {
			let tokens = window.navigator.userAgent.substring(pos + 17, pos2).split(".");
			return parseInt(tokens[0]) * 1000000 + parseInt(tokens[1]) * 1000 + parseInt(tokens[2]);
		} catch (e) {			
		}

		return ret;
	};

	AI.loadResourceAsText = async function(url) {
		return new Promise(resolve => (function(){
			try {
				var xhr = new XMLHttpRequest();
				if (xhr) {
					xhr.open('GET', url, true);
					xhr.onload = function () {
						var status = xhr.status;
						if (status == 200 || location.href.indexOf("file:") == 0) {
							resolve(xhr.responseText);
						} else {
							resolve("");
						}
					};
					xhr.onerror = function() {
						resolve("");
					}
					xhr.send('');
				}
			} catch (e) {
				resolve("");
			}
		})());
	};	

})(window);
