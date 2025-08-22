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

var heightUpdateConditions = {
	_updateActions: false,
	_updateModels: false,
	_translate: false,

	_markReady: function(key) {
		heightUpdateConditions[key] = true;
		heightUpdateConditions.checkAllReady();
	},

	updateActionsReady: function() {
		heightUpdateConditions._markReady('_updateActions');
	},
	updateModelsReady: function() {
		heightUpdateConditions._markReady('_updateModels');
	},
	translateReady: function() {
		heightUpdateConditions._markReady('_translate');
	},

	checkAllReady: function() {
		if (
			heightUpdateConditions._updateActions &&
			heightUpdateConditions._updateModels &&
			heightUpdateConditions._translate
		) {
			updateWindowHeight();
		}
	},
};


window.Asc.plugin.init = function() {
	window.Asc.plugin.sendToPlugin("onInit");
	window.Asc.plugin.attachEvent("onUpdateActions", function(list) {
		actionsList = list;
		renderActionsList();
		heightUpdateConditions.updateActionsReady();
	});
	window.Asc.plugin.attachEvent("onUpdateModels", function(list) {
		aiModelsList = list;
		updatedComboBoxes();
		heightUpdateConditions.updateModelsReady();
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

	heightUpdateConditions.translateReady();
};

window.addEventListener("resize", onResize);
onResize();

function onThemeChanged(theme) {
	window.Asc.plugin.onThemeChangedBase(theme);

	themeType = theme.type || 'light';
	updateBodyThemeClasses(theme.type, theme.name);
	updateThemeVariables(theme);

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

function updateWindowHeight() {
	var descriptionHeight = {
		default: parseFloat($('#description').css('line-height')),
		current: $('#description').height()
	};
	var listHeight = {
		default: $('#actions-list').height(),
		maxAllowed: 400,
		current: 0
	};
	var maxVisibleItems = 5;
	var bodyOverflow = $('body').css('overflow-y');
	$('body').css('overflow-y', 'hidden');

	var isBreak = false;
	$('#actions-list .item').each(function(index, item) {
		if(isBreak) return false;

		var itemHeight = $(item).outerHeight();
		if(index == maxVisibleItems-1) {
			itemHeight -= parseFloat($(item).css('padding-bottom'));
			isBreak = true;
		}

		if(listHeight.current + itemHeight <= listHeight.maxAllowed) {
			listHeight.current += itemHeight;
		} else {
			isBreak = true;
		}
	});

	if(listHeight.current > listHeight.default || descriptionHeight.current > descriptionHeight.default) {
		$('#actions-list').css('height', listHeight.current + 'px');
		scrollbarList.update();
		window.Asc.plugin.sendToPlugin("onUpdateHeight", document.body.scrollHeight + 2);
	}
	$('body').css('overflow-y', bodyOverflow);
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

		/*
		if(options.length == 0) {
			options.push({
				id: 'empty',
				text: window.Asc.plugin.tr("Models not found"),
				disabled: true,
			});
		}
		*/
		options.push(
			{
				text: '-',
				children: []
			},
			{
				id: 'add',
				text: window.Asc.plugin.tr("Add AI Model"),
				handler: function() {
					window.Asc.plugin.sendToPlugin("onOpenAddModal");
				}
			}
		);

		selectEl.select2().empty();
		selectEl.select2({
			data: options,
			templateResult: function(option, el) {
				if(option.text == '-') {
					$(el).addClass('separator');
					return '';
				} else {
					var div = $('<div class="ellipsis-content"></div>');
					div[0].innerText = option.text;
					return div;
				}
			},
			minimumResultsForSearch: Infinity,
			dropdownAutoWidth: true,
			width : 140
		});
		// TODO: If the active model is no longer in the list, set null and trigger an event to change the model.
		selectEl.val(action.model);
		selectEl.trigger('change');


		selectEl.on('select2:selecting', function (e) {
			var selectedOption = e.params.args.data;

			if(selectedOption.handler) {
				e.preventDefault();
				selectedOption.handler();
				selectEl.select2('close');
			}
		});
	});
}