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
	themeType = theme.type || 'light';
	
	var classes = document.body.className.split(' ');
	classes.forEach(function(className) {
		if (className.indexOf('theme-') != -1) {
			document.body.classList.remove(className);
		}
	});
	document.body.classList.add(theme.name);
	document.body.classList.add('theme-type-' + themeType);

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