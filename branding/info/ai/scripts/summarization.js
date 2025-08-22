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

var langCmbEl = document.getElementById('target-lang-cmb');
var insertCmbEl = document.getElementById('insert-as-cmb');

var originalAreaEl = document.getElementById('original-textarea');
var resultAreaEl = document.getElementById('result-textarea');

var summarizeBtnEl = document.getElementById('summarize-btn');
summarizeBtnEl.addEventListener('click', onSummarize);

var insertBtnEl = document.getElementById('insert-btn');
insertBtnEl.setAttribute('disabled', true);
insertBtnEl.addEventListener('click', onInsert);

var clearBtnEl = document.getElementById('clear-btn');
clearBtnEl.addEventListener('click', function() {
	originalAreaEl.value = '';
});

var copyBtnEl = document.getElementById('copy-btn');
copyBtnEl.setAttribute('disabled', true);
copyBtnEl.addEventListener('click', function() {
	resultAreaEl.select();
	document.execCommand('copy');
});

var errorAlertEl = document.getElementById('error-alert');
var loaderEl = document.getElementById('loader-wrapper');

var langList = [
	{ nameEn: 'English', nameLocale: 'English', value: 'en-US'},
	{ nameEn: 'French', nameLocale: 'Français', value: 'fr-FR'},
	{ nameEn: 'German', nameLocale: 'Deutsch', value: 'de-DE'},
	{ nameEn: 'Chinese', nameLocale: '中文', value: 'zh-CN'},
	{ nameEn: 'Japanese', nameLocale: '日本語', value: 'ja-JP'},
	{ nameEn: 'Russian', nameLocale: 'Русский', value: 'ru-RU' },
	{ nameEn: 'Korean', nameLocale: '한국어', value: 'ko-KR'},
	{ nameEn: 'Spanish', nameLocale: 'Español', value: 'es-ES'},
	{ nameEn: 'Italian', nameLocale: 'Italiano', value: 'it-IT'}
];

function insertEngine(type) {
	return function() {
		window.Asc.plugin.sendToPlugin("onSummarize", {
			type : type,
			data : resultAreaEl.value
		});
	}
}

var insertList = [
	{
		name: 'As review', 
		value: 'review', 
		insertCallback: insertEngine("review")
	},
	{
		name: 'In comment', 
		value: 'comment',
		insertCallback: insertEngine("comment")
	},
	{
		name: 'Replace original text', 
		value: 'replace',
		insertCallback: insertEngine("replace")
	},
	{
		name: 'To the end of document', 
		value: 'end', 
		insertCallback: insertEngine("end")
	}
];


window.Asc.plugin.init = function() {
	if (Asc.plugin.info.editorType !== "word") {
		insertList = insertList.slice(1, 3);
		updateInsertList();
	}

	updateLangList();

	window.Asc.plugin.executeMethod("GetDocumentLang", [], setDefaultLang);
	window.Asc.plugin.attachEvent("onThemeChanged", onThemeChanged);

	window.Asc.plugin.attachEvent("onGetSelection", function(data) {
		originalAreaEl.value = data;
	});

	window.Asc.plugin.attachEvent("onSummarize", function(data) {
		//$(loaderEl).hide();

		if (data.error === 0) {
			resultAreaEl.value = data.data;
			insertBtnEl.removeAttribute('disabled');
			copyBtnEl.removeAttribute('disabled');
			$(errorAlertEl).hide();
		} else {
			resultAreaEl.value = '';
			insertBtnEl.setAttribute('disabled', true);
			copyBtnEl.setAttribute('disabled', true);
			$(errorAlertEl).show().find('.error-description')[0].textContent = data.message;
		}
	});

	window.Asc.plugin.sendToPlugin("onInit");
}
window.Asc.plugin.onThemeChanged = onThemeChanged;

window.Asc.plugin.onTranslate = function () {
	let elements = document.querySelectorAll('.i18n');
	elements.forEach(function(element) {
		element.innerText = window.Asc.plugin.tr(element.innerText);
	});

	originalAreaEl.placeholder = window.Asc.plugin.tr(originalAreaEl.placeholder);
	resultAreaEl.placeholder = window.Asc.plugin.tr(resultAreaEl.placeholder);


	console.log('translate');
	//"Insert result" combobox items
	insertList.forEach(function(item) {
		item.name = window.Asc.plugin.tr(item.name);
	});
	updateInsertList();
};

window.addEventListener("resize", onResize);
onResize();

function onThemeChanged(theme) {
	window.Asc.plugin.onThemeChangedBase(theme);

	var themeType = theme.type || 'light';
	updateBodyThemeClasses(theme.type, theme.name);
	updateThemeVariables(theme);

	$('img.icon').each(function() {
		var src = $(this).attr('src');
		var newSrc = src.replace(/(icons\/)([^\/]+)(\/)/, '$1' + themeType + '$3');
		$(this).attr('src', newSrc);
	});
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

function setDefaultLang(documentLang) {
	var findedLang = langList.filter(function(lang) { return lang.value == documentLang})[0];
	if(findedLang) {
		$(langCmbEl).val(findedLang.value);
		$(langCmbEl).trigger('change');
	}
}

function updateLangList() {
	var cmbEl = $(langCmbEl);
	cmbEl.select2({
		data : langList.map(function(item) {
			return {
				id: item.value,
				text: item.nameLocale + ' – ' + item.nameEn
			}
		}),
		minimumResultsForSearch: Infinity,
		dropdownAutoWidth: true,
		width: 'auto'
	});
}

function updateInsertList() {
	var cmbEl = $(insertCmbEl);
	cmbEl.select2({
		minimumResultsForSearch: Infinity,
		dropdownAutoWidth: true,
		width: 'auto'
	});
	cmbEl.empty();

	insertList.forEach(function(item) {
		const newOption = new Option(item.name, item.value, false, false);
		cmbEl.append(newOption);
	});
	cmbEl.trigger('change');
}

function onSummarize() {
	var originalText = originalAreaEl.value.trim();
	if(!originalText.length) return;

	let data = {
		lang : "English",
		data : originalAreaEl.value
	};

	let langId = $(langCmbEl).val();
	for (let i = 0, len = langList.length; i < len; i++) {
		if (langList[i].value === langId) {
			data.lang = langList[i].nameEn;
			break;
		}
	}

	//$(loaderEl).show();
	window.Asc.plugin.sendToPlugin("Summarize", data);	
}

function onInsert() {
	var itemInInsertLits = insertList.filter(function(item) {return item.value == insertCmbEl.value})[0];
	if(!itemInInsertLits) return;

	itemInInsertLits.insertCallback();
}
