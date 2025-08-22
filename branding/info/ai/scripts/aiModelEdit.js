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

var type = 'add';
var aiModel = null;
var isModelCmbInit = true;

var providersList = [];
var providerModelsList = [];

var nameInputEl = document.getElementById('name-input');
var providerNameCmbEl = document.getElementById('provider-name-cmb');
$(providerNameCmbEl).on('select2:open', onOpenProviderComboBox);

var providerUrlInputEl = document.getElementById('provider-url-input');
var providerKeyInputEl = document.getElementById('provider-key-input');
var modelNameCmbEl = document.getElementById('model-name-cmb');
var updateModelsBtnEl = document.getElementById('update-models-btn');
var updateModelsErrorEl = document.getElementById('update-models-error');

var isCustomName = false;
var isFirstLoadOfModels = true;

nameInputEl.addEventListener('change', onChangeNameInput);
providerUrlInputEl.addEventListener('change', onChangeProviderUrlInput);
providerKeyInputEl.addEventListener('change', onChangeProviderKeyInput)
updateModelsBtnEl.addEventListener('click', updateModelsList);

var modelsList = [];
function getModelById(id) {
	for (let i = 0, len = modelsList.length; i < len; i++) {
		if (modelsList[i].id === id)
			return modelsList[i];
	}
	return null;
}


var nameInputValidator = new ValidatorWrapper({
	fieldEl: nameInputEl
});

var providerUrlValidator = new ValidatorWrapper({
	fieldEl: providerUrlInputEl
});

var providerNameValidator = new ValidatorWrapper({
	fieldEl: providerNameCmbEl,
	borderedEl: function() {
		return providerNameValidator.containerEl.querySelector('.select2-selection');	
	}
});
$(providerNameCmbEl).select2({width: '100%'});

var modelNameValidator = new ValidatorWrapper({
	fieldEl: modelNameCmbEl,
	borderedEl: function() {
		return modelNameValidator.containerEl.querySelector('.select2-selection');	
	}
});
$(modelNameCmbEl).select2({width: '100%'});


$('#custom-providers-button label').click(function(e) {
	window.Asc.plugin.sendToPlugin("onOpenCustomProvidersModal");
});

var updateModelsLoader = null;
var updateModelsErrorTip = new Tooltip(updateModelsErrorEl, {
	xAnchor: 'right',
	align: 'right',
	yOffset: 2,
	width: 233,
});

const providerKeyTip = new Tooltip(providerKeyInputEl, {
	align: 'center',
	width: 250,
	text: "You can obtain information about the key on the provider's website. This field is not mandatory.",
});

var capabilitiesElements = {
	text: {
		btn: new ToggleButton({
			id: 'use-for-text',
			icon: 'resources/icons/light/ai-texts' + getZoomSuffixForImage() + '.png'
		}),
		tip: new Tooltip(document.getElementById('use-for-text'), {
			text: 'Text',
			yAnchor: 'top',
			xAnchor: 'left',
			align: 'left'
		}),
		capabilities: AI.CapabilitiesUI.Chat
	},
	image: {
		btn: new ToggleButton({
			id: 'use-for-image',
			icon: 'resources/icons/light/ai-images' + getZoomSuffixForImage() + '.png'
		}),
		tip: new Tooltip(document.getElementById('use-for-image'), {
			text: 'Images',
			yAnchor: 'top'
		}),
		capabilities: AI.CapabilitiesUI.Image
	},
	embeddings: {
		btn: new ToggleButton({
			id: 'use-for-embeddings',
			icon: 'resources/icons/light/ai-embeddings' + getZoomSuffixForImage() + '.png'
		}),
		tip: new Tooltip(document.getElementById('use-for-embeddings'), {
			text: 'Embeddings',
			yAnchor: 'top'
		}),
		capabilities: AI.CapabilitiesUI.Embeddings
	},
	audio: {
		btn: new ToggleButton({
			id: 'use-for-audio',
			icon: 'resources/icons/light/ai-audio' + getZoomSuffixForImage() + '.png'
		}),
		tip: new Tooltip(document.getElementById('use-for-audio'), {
			text: 'Audio Processing',
			yAnchor: 'top'
		}),
		capabilities: AI.CapabilitiesUI.Audio
	},
	moderations: {
		btn: new ToggleButton({
			id: 'use-for-moderations',
			icon: 'resources/icons/light/ai-moderations' + getZoomSuffixForImage() + '.png'
		}),
		tip: new Tooltip(document.getElementById('use-for-moderations'), {
			text: 'Content Moderation',
			yAnchor: 'top'
		}),
		capabilities: AI.CapabilitiesUI.Moderations
	},
	realtime: {
		btn: new ToggleButton({
			id: 'use-for-realtime',
			icon: 'resources/icons/light/ai-realtime' + getZoomSuffixForImage() + '.png'
		}),
		tip: new Tooltip(document.getElementById('use-for-realtime'), {
			text: 'Realtime Tasks',
			yAnchor: 'top',
		}),
		capabilities: AI.CapabilitiesUI.Realtime
	},
	code: {
		btn: new ToggleButton({
			id: 'use-for-code',
			icon: 'resources/icons/light/ai-code' + getZoomSuffixForImage() + '.png'
		}),
		tip: new Tooltip(document.getElementById('use-for-code'), {
			text: 'Coding Help',
			yAnchor: 'top',
			xAnchor: 'right',
			align: 'right'
		}),
		capabilities: AI.CapabilitiesUI.Code
	},
	vision: {
		btn: new ToggleButton({
			id: 'use-for-vision',
			icon: 'resources/icons/light/ai-visual-analysis' + getZoomSuffixForImage() + '.png'
		}),
		tip: new Tooltip(document.getElementById('use-for-vision'), {
			text: 'Visual Analysis',
			yAnchor: 'top',
			xAnchor: 'right',
			align: 'right'
		}),
		capabilities: AI.CapabilitiesUI.Vision
	}
};

var resolveModels = null;
var rejectModels = null;
window.Asc.plugin.init = function() {
	window.Asc.plugin.sendToPlugin("onInit");	
	window.Asc.plugin.attachEvent("onThemeChanged", onThemeChanged);
	window.Asc.plugin.attachEvent("onModelInfo", onModelInfo);
	window.Asc.plugin.attachEvent("onSubmit", onSubmit);
	window.Asc.plugin.attachEvent("onProvidersUpdate", onProvidersUpdate);
	window.Asc.plugin.attachEvent("onGetModels", function(data) {
		if(data.error == 1) {
			rejectModels && rejectModels(data.message);
		} else {
			modelsList = data.models;
			let res = data.models.map(function(model) {
				return {
					name: model.name,
					capabilities: model.capabilities
				}
			});
			res.sort(function(a,b){ return (a.name < b.name) ? -1 : ((a.name === b.name) ? 0 : 1); });
			resolveModels && resolveModels(res);
		}
	});
}
window.Asc.plugin.onThemeChanged = onThemeChanged;

window.Asc.plugin.onTranslate = function () {
	let elements = document.querySelectorAll('.i18n');
	elements.forEach(function(element) {
		element.innerText = window.Asc.plugin.tr(element.innerText);
	});

	for (const capability in capabilitiesElements) {
		var item = capabilitiesElements[capability];
		item.tip.setText(window.Asc.plugin.tr(item.tip.getText()));
	}
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

function onProvidersUpdate(info) {
	providersList = [];

	for (let i = 0, len = info.providers.length; i < len; i++) {
		let srcProvider = info.providers[i];
		providersList.push({
			id : srcProvider.name,
			name : srcProvider.name,
			url : srcProvider.url,
			key : srcProvider.key,
		});
	}

	updateProviderComboBox(false);
}

function onModelInfo(info) {
	type = (info.model ? 'edit' : 'add');

	providersList = [];

	for (let i = 0, len = info.providers.length; i < len; i++) {
		let srcProvider = info.providers[i];
		providersList.push({
			id : srcProvider.name,
			name : srcProvider.name,
			url : srcProvider.url,
			key : srcProvider.key,
		});
	}
	
	if(info.model) {
		var key = '';
		isCustomName = true;

		aiModel = {
			name : info.model.name,
			id : info.model.id,
			provider : info.model.provider			
		};

		var findedProvider = info.providers.find(function(provider) {
			return provider.name == aiModel.provider;
		});
		if (findedProvider) {
			key = findedProvider.key;
		}

		nameInputEl.value = aiModel.name;

		$(providerNameCmbEl).val(aiModel.provider);
		providerKeyInputEl.value = key;
	}
	updateProviderComboBox(!!aiModel);
	updateCapabilitiesBtns(info.model ? info.model.capabilities : AI.CapabilitiesUI.None);
}

function onSubmit() {
	var isProviderNameValid = providerNameValidator.validate();
	var isNameInputValid = nameInputValidator.validate();
	var isProviderUrlValid = providerUrlValidator.validate();
	var isModelNameValid = modelNameValidator.validate();
	if(!isProviderNameValid || !isNameInputValid || !isProviderUrlValid || !isModelNameValid) return;

	let model = {
		provider : {
			name : providerNameCmbEl.value,
			url : providerUrlInputEl.value,
			key : providerKeyInputEl.value
		},
		name : nameInputEl.value,
		id : modelNameCmbEl.value,
		capabilities: getCapabilities()
	};

	// let modelInfo = getModelById(model.id);
	// if (modelInfo)
	// 	model.capabilities = modelInfo.capabilities;

	window.Asc.plugin.sendToPlugin("onChangeModel", model);
}

function onChangeNameInput() {
	isCustomName = nameInputEl.value.trim().length > 0;
}

function onChangeProviderComboBox() {
	var provider = providersList.filter(function(el) { return el.id == providerNameCmbEl.value })[0] || null;

	providerUrlInputEl.value = provider ? provider.url : '';
	providerKeyInputEl.value = provider ? provider.key : '';
	if(providerUrlInputEl.value) {
		updateModelsList();
	}
}

function onOpenProviderComboBox() {
	const searchField = $(providerNameCmbEl).data('select2').$dropdown.find('.select2-search__field')[0];
	if (searchField) {
		function onKeydownSearchInput(event) {
			//Keydown "Tab"
			if(event.keyCode == 9) {
				//Blocked "keydown" handler in select2 so that the menu is not hidden
				event.stopPropagation();
		
				//Triggering Enter keydown
				var enterEvent = new KeyboardEvent('keydown', {
					key: 'Enter',
					code: 'Enter',
					keyCode: 13,
					which: 13,
					bubbles: true,
					cancelable: true
				});
				event.target.dispatchEvent(enterEvent);
				
				setTimeout(function() {
					providerUrlInputEl.focus();
				}, 0);
			}
		};
		searchField.addEventListener('keydown', onKeydownSearchInput, { capture: true });
	}
}

function onChangeProviderUrlInput() {
	updateModelsList();
}

function onChangeProviderKeyInput() {
	updateModelsList();
}

function onChangeModelComboBox() {
	var modelObj = providerModelsList.filter(function(model) { return model.name == modelNameCmbEl.value })[0] || null;
	if(modelObj && !isFirstLoadOfModels) {
		updateCapabilitiesBtns(modelObj.capabilities);
	}

	if (modelObj && modelObj.name) {
		let providerObj = providersList.filter(function(provider) { return provider.id == providerNameCmbEl.value })[0] || null;
		let providerName = providerObj ? providerObj.name : providerNameCmbEl.value;
		if (providerName)
			nameInputEl.value = providerName + ' [' + modelObj.name + ']';
		else
			nameInputEl.value = modelObj.name;
	}
}

function getCapabilities() {
	var result = 0;
	for (const key in capabilitiesElements) {
		var itemProps = capabilitiesElements[key];
		itemProps.btn.getValue() && (result += itemProps.capabilities);
	}
	return result;
}

function updateCapabilitiesBtns(capabilities) {
	if(capabilities === undefined) return;

	for (const key in capabilitiesElements) {
		var itemProps = capabilitiesElements[key];
		itemProps.btn.setValue((capabilities & itemProps.capabilities) !== 0);
	}
}

function updateModelsList() {
	var updateHtmlElements = function() {
		modelNameCmbEl.removeAttribute('disabled');
		updateModelComboBox();
	};

	var startLoader = function() {
		updateModelsLoader && (updateModelsLoader.remove ? updateModelsLoader.remove() : $('#update-models-loader-container')[0].removeChild(updateModelsLoader));
		updateModelsLoader = showLoader($('#update-models-loader-container')[0], window.Asc.plugin.tr('Updating'));
		$(updateModelsBtnEl).hide();
		$(updateModelsErrorEl).hide();
	};
	var endLoader = function(errorText) {
		updateModelsLoader && (updateModelsLoader.remove ? updateModelsLoader.remove() : $('#update-models-loader-container')[0].removeChild(updateModelsLoader));
		updateModelsLoader = null;


		$(updateModelsBtnEl).show();
		if(errorText && (type == 'edit' || !isFirstLoadOfModels)) {
			$(updateModelsErrorEl).show();
			updateModelsErrorTip.setText(errorText);
		} else {
			$(updateModelsErrorEl).hide();
		}

		isFirstLoadOfModels = false;
	};

	startLoader();
	$(updateModelsBtnEl).hide();
	modelNameCmbEl.setAttribute('disabled', true);
	fetchModelsForProvider({
		name : providerNameCmbEl.value, 
		url : providerUrlInputEl.value, 
		key: providerKeyInputEl.value
	}).then(function(data) {
		providerModelsList = data;
		updateHtmlElements();
		endLoader();
	}).catch(function(error) {
		providerModelsList = [];
		updateHtmlElements();
		endLoader(error);
	});
}

function updateProviderComboBox(isInit) {
	var cmbEl = $('#provider-name-cmb');
	cmbEl.select2({
		data : providersList.map(function(model) {
			return {
				id: model.id,
				text: model.name
			}
		}),
		tags: true,
		dropdownAutoWidth: true
	});
	cmbEl.on('select2:select', onChangeProviderComboBox);
	if(isInit) {
		cmbEl.val(aiModel.provider);
	} else if(providersList.length > 0) {
		cmbEl.val(providersList[0].id);
		providerKeyInputEl.value = providersList[0].key;		
	}
	cmbEl.trigger('select2:select');
	cmbEl.trigger('change');
}

function updateModelComboBox() {
	var cmbEl = $('#model-name-cmb');
	cmbEl.select2().empty();
	cmbEl.select2({
		data : providerModelsList.map(function(model) {
			return {
				id: model.name,
				text: model.name
			}
		}),
		language: {
			noResults: function() {
				return window.Asc.plugin.tr("Models not found");
			}
		},
		width: '100%',
		minimumResultsForSearch: Infinity,
		dropdownAutoWidth: true
	});
	cmbEl.on('select2:select', onChangeModelComboBox);
	if(modelNameValidator.getState().value == false) {
		modelNameValidator.validate();
	}

	if(isModelCmbInit && aiModel) {
		cmbEl.val(aiModel.id);
	} else {
		cmbEl.val(providerModelsList[0] ? providerModelsList[0].name : null);
	}
	isModelCmbInit = false;
	cmbEl.trigger('select2:select');
	cmbEl.trigger('change');
}

function fetchModelsForProvider(provider) {
	return new Promise(function(resolve, reject) {

		resolveModels = resolve;
		rejectModels = reject;
		window.Asc.plugin.sendToPlugin("onGetModels", provider);

	});
}

function ValidatorWrapper(options) {
	this._init = function() {
		// Default parameters
		var defaults = {
			fieldEl: null,		//HTML field element
			borderedEl: null,	//HTML element with a border that will change color. For fields consisting of several HTML elements. (Example: select2)
			getValue: function(fieldEl) {
				return fieldEl.value;
			},
			validator: function(value) {
				return value.trim().length > 1 ? '' : window.Asc.plugin.tr('This field is required');
			}, 	
			errorIconSrc: 'resources/icons/light/error.png'
		};
		// Merge user options with defaults
		this.options = Object.assign({}, defaults, options);

		this.state = {
			value: true,
			message: ''
		}

		// Create HTML elements
		this.containerEl = document.createElement('div');
		this.containerEl.style.display = 'flex';
		this.containerEl.style.position = 'relative';
		this.options.fieldEl.parentNode.insertBefore(this.containerEl, this.options.fieldEl);
		this.containerEl.appendChild(this.options.fieldEl);

		this.errorIconEl = document.createElement('img');
		this.errorIconEl.src = this.options.errorIconSrc;
		this.errorIconEl.className = 'icon';
		this.errorIconEl.style.position = 'absolute';
		this.errorIconEl.style.width = '20px';
		this.errorIconEl.style.height = '20px';
		this.errorIconEl.style.top = '1px';
		this.errorIconEl.style.right = '0px';
		this.errorIconEl.style.display = 'none';

		this.errorTooltip = new Tooltip(this.errorIconEl, {
			xAnchor: 'right',
			align: 'right'
		});


		if (this.options.fieldEl) {
			this.containerEl.appendChild(this.errorIconEl);
		} else {
			console.error("Field with ID '" + this.options.id + "' not found.");
		}
	};

	this.getState = function() {
		return this.state;
	};

	this.validate = function() {
		if(typeof this.options.validator != 'function') {
			console.error("Validator is not a function");
			return;
		}

		var validateMessage = this.options.validator(this.options.getValue(this.options.fieldEl));

		if(validateMessage != null && typeof validateMessage != 'string') {
			console.error("Validator must return a string value or null");
			return;
		}

		this._setValidateState(validateMessage);
		return !validateMessage;
	};
	this._setValidateState = function(message) {
		this.state.value = !message;
		this.state.message = message;
		this.errorTooltip.setText(message);

		var borderedEl = this.options.fieldEl;
		if(this.options.borderedEl){
			if(typeof this.options.borderedEl == 'function') {
				borderedEl = this.options.borderedEl();
			} else {
				borderedEl = this.options.borderedEl;
			}
		}

		if(this.state.value) {
			this.errorIconEl.style.display = 'none';
			borderedEl.style.borderColor = '';
		} else {
			this.errorIconEl.style.display = 'block';
			borderedEl.style.cssText += 'border-color: #f62211 !important;';
		}
	};

	this._init();
}

//Toggle button component
function ToggleButton(options) {
	this._init = function() {
		// Default parameters
		var defaults = {
			id: '',
			icon: '',
			value: false,
			disabled: false,
			onToggle: function (state) {}
		};

		// Merge user options with defaults
		this.options = Object.assign({}, defaults, options);

		// Button state
		this.value = false;
		this.disabled = false;

		this.buttonEl = document.createElement("button");
		this.buttonEl.className = "toggle-button";

		this.iconEl = document.createElement("img");
		this.iconEl.className = "icon";
		this.iconEl.src = this.options.icon;

		this.buttonEl.appendChild(this.iconEl);

		this.setValue(this.options.value);
		this.setDisabled(this.options.disabled);

		// Add click event listener
		var self = this; // To preserve context
		this.buttonEl.addEventListener("click", function () {
			self.setValue(!self.value);
			self.options.onToggle && self.options.onToggle(self.value); // Call the callback
		});

		// Add button to the container
		var container = document.getElementById(this.options.id);
		if (container) {
			container.appendChild(this.buttonEl);
		} else {
			console.error("Container with ID '" + this.options.id + "' not found.");
		}
	};

	this.setValue = function(value) {
		this.value = value;
		if(value) {
			this.buttonEl.classList.add('active');
		} else {
			this.buttonEl.classList.remove('active');
		}
	};
	this.getValue = function() {
		return this.value;
	};

	this.setDisabled = function(value) {
		this.disabled = value;
		if(value) {
			this.buttonEl.setAttribute('disabled', true);
		} else {
			this.buttonEl.removeAttribute('disabled');
		}
	};
	this.getDisabled = function() {
		return this.disabled;
	};

	this._init();
}
