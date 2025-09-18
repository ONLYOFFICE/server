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

let providersList = new ListView(document.getElementById('providers-list'), {
	emptyText: 'The list is empty, press + to add the file',
	renderItem: function(item) {
		var itemEl = document.createElement('div');
		itemEl.classList.add('item');
		itemEl.innerText = item.name;
		return itemEl;
	}
});
let scrollbarList = new PerfectScrollbar("#providers-list", {});
providersList.on('select', function() {
	deleteBtnEl.removeAttribute('disabled');
});
providersList.on('deselect', function() {
	deleteBtnEl.setAttribute('disabled', true);
});
providersList.on('set', function() {
	if(providersList.getList().length > 0) {
		providersList.$el.classList.remove('empty');
	}
});
providersList.on('add', function() {
	if(providersList.getList().length > 0) {
		providersList.$el.classList.remove('empty');
	}
});
providersList.on('delete', function() {
	if(providersList.getList().length == 0) {
		providersList.$el.classList.add('empty');
	}
});

providersList.$el.addEventListener('click', function() {
	if(providersList.getList().length == 0) {
		fileInputEl.click();
	}
});
providersList.$el.addEventListener('dragover', function(e) {
	e.stopPropagation();
	e.preventDefault();
	e.dataTransfer.dropEffect = 'copy';
	providersList.$el.classList.add('dragged');
});
providersList.$el.addEventListener('dragleave', function() {
	providersList.$el.classList.remove('dragged');
});
providersList.$el.addEventListener('drop', function(e) {
	e.stopPropagation();
	e.preventDefault();
	handlerChangeFileInput(e.dataTransfer.files);
	providersList.$el.classList.remove('dragged');
});


let addBtnEl = document.getElementById('add-btn');
addBtnEl.addEventListener('click', function() {
	fileInputEl.click();
});

let deleteBtnEl = document.getElementById('delete-btn');
deleteBtnEl.addEventListener('click', function() {
	if(providersList.getSelected()) {
		window.Asc.plugin.sendToPlugin("onDeleteCustomProvider", providersList.getSelected());
		providersList.delete(providersList.getSelected());
	}
});

let fileInputEl = document.getElementById('file-input');
fileInputEl.addEventListener("change", function (event) {
	handlerChangeFileInput(event.target.files);
	event.target.value = "";
});

let errorLabelEl = document.getElementById('error-label');
let errorLabelTimeout = null;

// TODO: Change path for template file
let templateFilePath = document.currentScript.src + '/../engine/providers/internal/openai.js';

window.Asc.plugin.init = function() {
	window.Asc.plugin.sendToPlugin("onInit");
	window.Asc.plugin.attachEvent("onSetCustomProvider", function(list) {
		let items = [];
		for (let i = 0, len = list.length; i < len; i++)
			items.push({ name : list[i] });
		providersList.set(items);
	});
	window.Asc.plugin.attachEvent("onAddCustomProvider", function(item) {
		providersList.add({name: item});
	});
	window.Asc.plugin.attachEvent("onErrorCustomProvider", function(item) {
		showErrorLabel('Error adding provider from file, please try again');
	});
	window.Asc.plugin.attachEvent("onThemeChanged", onThemeChanged);
}
window.Asc.plugin.onThemeChanged = onThemeChanged;

window.Asc.plugin.onTranslate = function () {
	let elements = document.querySelectorAll('.i18n');
	elements.forEach(function(element) {
		element.innerText = window.Asc.plugin.tr(element.innerText);
	});

	providersList.setEmptyText(window.Asc.plugin.tr(providersList.options.emptyText));

	new Tooltip(document.getElementById('alert-icon'), {
		renderInner: function() {
			let innerEl = document.createElement("div");
			innerEl.id = 'alert-inner-popover';
			
			let textEl = document.createElement("div");
			textEl.innerText = window.Asc.plugin.tr('Enter the configuration for the AI model API in JS format. Provide the model name, endpoint URLs, and headers.');
			
			let linkEl = document.createElement("a");
			linkEl.id = 'popover-link';
			linkEl.href = templateFilePath;
			linkEl.download = 'providerTemplate.js';
			linkEl.innerText = window.Asc.plugin.tr('Download template');
			
			innerEl.appendChild(textEl);
			innerEl.appendChild(linkEl);
			return innerEl;
		},
		xAnchor: 'left',
		align: 'left',
		yOffset: 4,
		width: 150,
		hasShadow: true,
		keepAliveOnHover: true,
		delay: 200,
		hideDelay: 200
	});
};

window.addEventListener("resize", onResize);
onResize();


function handlerChangeFileInput(files) {
	let pendingFiles = files.length;
	let hasError = false;

	function checkCompletion() {
        pendingFiles--;
        if (pendingFiles === 0 && !hasError) {
            hideErrorLabel();
        }
    }

	for (let i = 0; i < files.length; i++) {
		let file = files[i]; 
		if (file.name.lastIndexOf(".js") == file.name.length - 3) {
			let reader = new FileReader();
			reader.readAsText(file);
			reader.onload = function(e) {
				let fileContent = e.target.result;
				window.Asc.plugin.sendToPlugin("onAddCustomProvider", {
					name: file.name,
					content: fileContent
				});
				checkCompletion();
			};
			reader.onerror = function(e) {
				showErrorLabel('Error adding provider from file, please try again');
				hasError = true;
				checkCompletion();
			};
        } else {
			showErrorLabel('Invalid file format, please upload the .js file');
			hasError = true;
			checkCompletion();
		}
    }
}

function showErrorLabel(text) {
	clearTimeout(errorLabelTimeout);
	errorLabelEl.innerText = window.Asc.plugin.tr(text);
	errorLabelEl.classList.remove('hide');
	errorLabelTimeout = setTimeout(function() {
		errorLabelEl.classList.add('hide');
	}, 10 * 1000);
}

function hideErrorLabel() {
	clearTimeout(errorLabelTimeout);
	errorLabelEl.classList.add('hide');
}

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