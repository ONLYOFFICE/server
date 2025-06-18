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
	themeType = theme.type || 'light';
	
	addCssVariables(theme);

	var classes = document.body.className.split(' ');
	classes.forEach(function(className) {
		if (className.indexOf('theme-') != -1) {
			document.body.classList.remove(className);
		}
	});
	document.body.classList.add(theme.name);
	document.body.classList.add('theme-type-' + themeType);
	$('img.icon').each(function() {
		var src = $(this).attr('src');
		var newSrc = src.replace(/(icons\/)([^\/]+)(\/)/, '$1' + themeType + '$3');
		$(this).attr('src', newSrc);
	});
}

function addCssVariables(theme) {
	let colorRegex = /^(#([0-9a-f]{3}){1,2}|rgba?\([^\)]+\)|hsl\([^\)]+\))$/i;

	let oldStyle = document.getElementById('theme-variables');
	if (oldStyle) {
		oldStyle.remove();
	}

	let style = document.createElement('style');
	style.id = 'theme-variables';
	let cssVariables = ":root {\n";

	for (let key in theme) {
		let value = theme[key];

		if (colorRegex.test(value)) {
			let cssKey = '--' + key.replace(/([A-Z])/g, "-$1").toLowerCase();
			cssVariables += ' ' + cssKey + ': ' + value + ';\n';
		}
	}

	cssVariables += "}";

	style.textContent = cssVariables;
	document.head.appendChild(style);
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
