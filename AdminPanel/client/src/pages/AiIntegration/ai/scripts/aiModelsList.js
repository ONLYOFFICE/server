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

let aiModelsList = new ListView(document.getElementById('ai-models-list'), {
	renderItem: function(model) {
		var createdEl = document.createElement('div');
		createdEl.classList.add('item');

		var contentEl = document.createElement('div');
		contentEl.classList.add('content');

		contentEl.innerText = model.name;
		createdEl.appendChild(contentEl);
		return createdEl;
	}
});
var scrollbarList = new PerfectScrollbar("#ai-models-list", {});
aiModelsList.on('select', function() {
	editBtnEl.removeAttribute('disabled');
	deleteBtnEl.removeAttribute('disabled');
});
aiModelsList.on('deselect', function() {
	editBtnEl.setAttribute('disabled', true);
	deleteBtnEl.setAttribute('disabled', true);
});

var addBtnEl = document.getElementById('add-btn');
addBtnEl.addEventListener('click', function() {
	window.Asc.plugin.sendToPlugin("onOpenEditModal", {
		type: 'add'
	});
});

var editBtnEl = document.getElementById('edit-btn');
editBtnEl.addEventListener('click', function() {
	window.Asc.plugin.sendToPlugin("onOpenEditModal", {
		type: 'edit', 
		model: aiModelsList.getSelected()
	});
});

var deleteBtnEl = document.getElementById('delete-btn');
deleteBtnEl.addEventListener('click', function() {
	if(aiModelsList.getSelected()) {
		window.Asc.plugin.sendToPlugin("onDeleteAiModel", aiModelsList.getSelected());
		aiModelsList.delete(aiModelsList.getSelected());
	}
});


window.Asc.plugin.init = function() {
	window.Asc.plugin.sendToPlugin("onInit");
	window.Asc.plugin.attachEvent("onUpdateModels", function(list) {
		aiModelsList.set(list);
	});
	window.Asc.plugin.attachEvent("onThemeChanged", onThemeChanged);
}
window.Asc.plugin.onThemeChanged = onThemeChanged;

window.Asc.plugin.onTranslate = function () {
	let elements = document.querySelectorAll('.i18n');
	elements.forEach(function(element) {
		element.innerText = window.Asc.plugin.tr(element.innerText);
	});
};

window.addEventListener("resize", onResize);
onResize();


function onThemeChanged(theme) {
	window.Asc.plugin.onThemeChangedBase(theme);
	
	var themeType = theme.type || 'light';
	updateBodyThemeClasses(theme.type, theme.name);
	updateThemeVariables(theme);
	
	let btnIcons = document.getElementsByClassName('icon');
	for (let i = 0; i < btnIcons.length; i++) {
		let icon = btnIcons[i];
		let src = icon.getAttribute('src');
		let newSrc = src.replace(/(icons\/)([^\/]+)(\/)/, '$1' + themeType + '$3');
		icon.setAttribute('src', newSrc);
	}
}

function getZoomSuffixForImage() {
	var ratio = Math.round(window.devicePixelRatio / 0.25) * 0.25;
	ratio = Math.max(ratio, 1);
	ratio = Math.min(ratio, 2);
	if(ratio == 1) return ''
	else {
		return '@' + ratio + 'x';
	}
}

function onResize () {
	$('img').each(function() {
		var el = $(this);
		var src = $(el).attr('src');
		if(!src.includes('resources/icons/')) return;

		var srcParts = src.split('/');
		var fileNameWithRatio = srcParts.pop();
		var clearFileName = fileNameWithRatio.replace(/@\d+(\.\d+)?x/, '');
		var newFileName = clearFileName;
		newFileName = clearFileName.replace(/(\.[^/.]+)$/, getZoomSuffixForImage() + '$1');
		srcParts.push(newFileName);
		el.attr('src', srcParts.join('/'));
	});
}