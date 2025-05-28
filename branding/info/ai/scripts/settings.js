var themeType = 'light';
var actionsList = [];
var aiModelsList = [];
var capabilitiesList = {
	[AI.CapabilitiesUI.Chat]: {name: window.Asc.plugin.tr('Text-Based'), icon: 'ai-texts.png'},
	[AI.CapabilitiesUI.Image]: {name: window.Asc.plugin.tr('Images'), icon: 'ai-images.png'},
	[AI.CapabilitiesUI.Embeddings]: {name: window.Asc.plugin.tr('Embeddings'), icon: 'ai-embeddings.png'},
	[AI.CapabilitiesUI.Audio]: {name: window.Asc.plugin.tr('Audio'), icon: 'ai-audio.png'},
	[AI.CapabilitiesUI.Moderations]: {name: window.Asc.plugin.tr('Moderations'), icon: 'ai-moderations.png'},
	[AI.CapabilitiesUI.Realtime]: {name: window.Asc.plugin.tr('Realtime'), icon: 'ai-realtime.png'},
	[AI.CapabilitiesUI.Code]: {name: window.Asc.plugin.tr('Code'), icon: 'ai-code.png'},
	[AI.CapabilitiesUI.Vision]: {name: window.Asc.plugin.tr('Vision'), icon: 'ai-visual-analysis.png'}
};

var scrollbarList = new PerfectScrollbar("#actions-list", {});

window.Asc.plugin.init = function() {
	window.Asc.plugin.sendToPlugin("onInit");
	window.Asc.plugin.attachEvent("onUpdateActions", function(list) {
		actionsList = list;
		renderActionsList();
	});
	window.Asc.plugin.attachEvent("onUpdateModels", function(list) {
		aiModelsList = list;
		updatedComboBoxes();
	});
	window.Asc.plugin.attachEvent("onThemeChanged", onThemeChanged);

	$('#edit-ai-models label').click(function(e) {
		window.Asc.plugin.sendToPlugin("onOpenAiModelsModal");
	});
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
	$('#actions-list img').each(function() {
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

function renderActionsList() {
	var actionsListEl = document.getElementById('actions-list');
	actionsListEl.innerHTML = '';
	actionsList.forEach(function(action, index) {
		var createdEl = document.createElement('div');
		var icon = action.icon || 'default';
		createdEl.classList.add('item');
		if(index == 0) {
			createdEl.classList.add('first');
		} else if(index == actionsList.length - 1) {
			createdEl.classList.add('last');
		}
		createdEl.innerHTML =
			'<div class="label">' +
				'<img src="resources/icons/' + themeType + '/' + icon + getZoomSuffixForImage() + '.png"/>' +
				'<div>' + action.name + '</div>' +
			'</div>' +
			'<select class="ai-model-select" id="ai-model-select-' + (index) + '"></select>';
		actionsListEl.appendChild(createdEl);
		var selectEl = $(createdEl).find('.ai-model-select');
		selectEl.on('select2:select', function (e) {
			window.Asc.plugin.sendToPlugin("onChangeAction", { 
				id: e.params.data.actionId,
				model: e.params.data.id 
			});
		});
	});
	toggleScrollbarPadding();
	scrollbarList.update();
}

function toggleScrollbarPadding() {
	var actionsListEl = document.getElementById('actions-list');
	// Check if there is a scroll bar
	if (actionsListEl.scrollHeight > actionsListEl.clientHeight) {
		actionsListEl.classList.add('with-scrollbar');
	} else {
		actionsListEl.classList.remove('with-scrollbar');
	}
}

function updatedComboBoxes() {
	$('#actions-list .item .ai-model-select').each(function(index) {
		var selectEl = $(this);
		var action = actionsList[index];
		var options = aiModelsList.filter(function(model) {
			return (action.capabilities & model.capabilities) !== 0;
		}).map(function(model) {
			return {
				id: model.id,
				text: model.name,
				actionId: action.id
			}
		});

		selectEl.select2().empty();
		selectEl.select2({
			data: options,
			templateResult: function(option) {
				var div = $('<div class="ellipsis-content"></div>');
				div[0].innerText = option.text;
				return div;
			},
			language: {
				noResults: function() {
					return window.Asc.plugin.tr("Models not found");
				}
			},
			minimumResultsForSearch: Infinity,
			dropdownAutoWidth: true,
			width : 150
		});
		// TODO: If the active model is no longer in the list, set null and trigger an event to change the model.
		selectEl.val(action.model);
		selectEl.trigger('change');
	});
}