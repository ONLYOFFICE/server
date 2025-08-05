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
	const maxTokens = 16000;
	let apiKey = '';
	let interval = null;
	let tokenTimeot = null;
	let errTimeout = null;
	let modalTimeout = null;
	let loader = null;
	let bCreateLoader = true;
	let themeType = 'light';
	let regenerationMessageIndex = null;	//Index of the message for which a new reply is being created

	const ErrorCodes = {
		UNKNOWN: 1
	};
	const errorsMap = {
		[ErrorCodes.UNKNOWN]: {
			title: 'Something went wrong',
			description: 'Please try reloading the conversation'
		}
	};

	let scrollbarList; 

	let messagesList = {
		_list: [],
		
		_renderItemToList: function(item, index) {
			$('#chat_wrapper').removeClass('empty');

			let $chat = $('#chat');
			item.$el = $('<div class="message" style="order: ' + index + ';"></div>');
			$chat.prepend(item.$el);
			this._renderItem(item);
			$chat.scrollTop($chat[0].scrollHeight);
		},
		_renderItem: function(item) {
			item.$el.empty();
			item.$el.toggleClass('user_message', item.role == 'user');

			const me = this;
			let $messageContent = $('<div class="form-control message_content"></div>');
			let $spanMessage = $('<span class="span_message"></span>');
			let $attachedWrapper;
			let activeContent = item.getActiveContent();
			$messageContent.append($spanMessage);
			
			let c = window.markdownit();
			let htmlContent = c.render(activeContent);
			$spanMessage.css('display', 'block');
			$spanMessage.html(htmlContent);

			let plainText = htmlContent.replace(/<\/?[^>]+(>|$)/g, "").replace(/\n{3,}/g, "\n\n");
	
			if(item.role == 'user') {
				// TODO: For a future release.
				if(false && item.attachedText) {
					$attachedWrapper = $(
						'<div class="message_content_attached_wrapper collapsed">' + 
							'<div class="message_content_attached">' + 
								item.attachedText +
							'</div>' + 
							'<div class="message_content_collapse_btn noselect">' +
								'<img class="icon" draggable="false" src="' + getFormattedPathForIcon('resources/icons/light/chevron-down.png') + '"/>' +
							'</div>' +
						'</div>'
					);
					$attachedWrapper.find('.message_content_collapse_btn').on('click', function() {
						$attachedWrapper.toggleClass('collapsed');
						toggleAttachedCollapseButton($attachedWrapper);
					});
					$messageContent.prepend($attachedWrapper);
				}
			} else {
				if(item.error) {
					const errorObj = errorsMap[item.error];
					const $error = $(
						'<div class="message_content_error_title">' +
							'<img class="icon" draggable="false" src="' + getFormattedPathForIcon('resources/icons/light/error.png') + '" />' +
							'<div>' + errorObj.title + '</div>' + 
						'</div>' +
						'<div class="message_content_error_desc">' + errorObj.description + '</div>'
					);
					$messageContent.append($error);
				} else {
					let $actionButtons = $('<div class="action_buttons_list"></div>');
					actionButtons.forEach(function(button, index) {
						let buttonEl = $('<button class="action_button btn-text-default"></button>');
						buttonEl.append('<img class="icon" draggable="false" src="' + getFormattedPathForIcon(button.icon) + '"/>');
						buttonEl.on('click', function() {
							button.handler(item, activeContent, htmlContent, plainText);
						});
		
						if(button.tipOptions) {
							if(item.btnTips[index]) {
								item.btnTips[index]._deleteTooltipElement();
							}
							item.btnTips[index] = new Tooltip(buttonEl[0], button.tipOptions);
						}
						
						$actionButtons.append(buttonEl);
					});
					item.$el.append($actionButtons);
	
					if(item.content.length > 1) {
						const $repliesSwitch = $(
							'<div class="message_content_replies_switch">' + 
								'<div>' + (item.activeContentIndex + 1) + ' / ' + (item.content.length) + '</div>' +
							'</div>'
						);
	
						const $decrementBtn = $('<button><img class="decrement icon" src="' + getFormattedPathForIcon('resources/icons/light/chevron-down.png') + '"/></button>');
						item.activeContentIndex == 0 ? $decrementBtn.attr('disabled', 'disabled') : $decrementBtn.removeAttr('disabled');
						$repliesSwitch.prepend($decrementBtn);
						$decrementBtn.on('click', function() {
							item.activeContentIndex -= 1;
							me._renderItem(item);
	
						});
						
						const $incrementBtn = $('<button><img class="increment icon" src="' + getFormattedPathForIcon('resources/icons/light/chevron-down.png') + '"/></button>');
						item.activeContentIndex == item.content.length - 1 ? $incrementBtn.attr('disabled', 'disabled') : $incrementBtn.removeAttr('disabled');
						$repliesSwitch.append($incrementBtn);
						$incrementBtn.on('click', function() {
							item.activeContentIndex += 1;
							me._renderItem(item);
						});
	
						$messageContent.append($repliesSwitch);
					}
				}
			}
			item.$el.prepend($messageContent);
			if($attachedWrapper) {
				setTimeout(function() {
					toggleAttachedCollapseButton($attachedWrapper);
				}, 10);
			}
			scrollbarList.update();
		},

		set: function(array) {
			let me = this;

			array.forEach(function(item) {
				me.add(item);
			});
		},
		add: function(item) {
			const message = Object.assign({}, item);

			message.getActiveContent = function() {
				return (message.role == 'user' ? message.content : message.content[message.activeContentIndex]);
			};
			if(message.role == 'assistant') {
				message.activeContentIndex = 0;
			}
			message.btnTips = [];
			this._list.push(message)
			this._renderItemToList(message, this._list.length - 1);
		},
		pushContentForAssistant: function(messageIndex, content) {
			if(!this._list[messageIndex] || this._list[messageIndex].role != 'assistant') return;
			const message = this._list[messageIndex];
			message.content.push(content);
			message.activeContentIndex = message.content.length - 1;
			this._renderItem(message);
		},
		get: function() {
			return this._list;
		}
	};

	let attachedText = {
		set: function(text) {
			$('#attached_text_wrapper').removeClass('hidden');
			$('#attached_text').text(text);
		},
		get: function() {
			return $('#attached_text').text().trim();
		},
		clear: function() {
			$('#attached_text_wrapper').addClass('hidden', true);
			$('#attached_text').text('');
		},
		hasShow: function() {
			return !$('#attached_text_wrapper').hasClass('hidden');
		}
	};

	let actionButtons = [
		{ 
			icon: 'resources/icons/light/btn-update.png', 
			tipOptions: {
				text: 'Generate new',
				align: 'left'
			},
			handler: function(message) { 
				const messageIndex = messagesList.get().findIndex(function(item) { return item == message});
				if(messageIndex > 0) {
					regenerationMessageIndex = messageIndex;
					sendMessage(messagesList.get()[messageIndex - 1].content);
				}
			}
		},
		{ 
			icon: 'resources/icons/light/btn-copy.png', 
			tipOptions: {
				text: 'Copy',
				align: 'left'
			},
			handler: function(message, content) { 
				var prevTextareaVal = $('#input_message').val();
				$('#input_message').val(content);
				$('#input_message').select();
				document.execCommand('copy');
				$('#input_message').val(prevTextareaVal);
			}
		},
		{ 
			icon: 'resources/icons/light/btn-replace.png', 
			tipOptions: {
				text: 'Replace original text',
				align: 'left'
			},
			handler: function(message, content, htmlContent, plainText) { insertEngine('replace', plainText); }
		},
		{ 
			icon: 'resources/icons/light/btn-select-tool.png', 
			tipOptions: {
				text: 'Insert result',
				align: 'left'
			},
			handler: function(message, content, htmlContent)  { insertEngine('insert', htmlContent); }
		},
		{ 
			icon: 'resources/icons/light/btn-menu-comments.png', 
			tipOptions: {
				text: 'In comment',
				align: 'left'
			},
			handler: function(message, content, htmlContent, plainText) { insertEngine('comment', plainText); }
		},
		{ 
			icon: 'resources/icons/light/btn-ic-review.png', 
			tipOptions: {
				text: 'As review',
				align: 'left'
			},
			handler: function(message, content, htmlContent) { insertEngine('review', htmlContent);}
		}
	];
	let welcomeButtons = [
		{ text: 'Blog post', prompt: 'Blog post about' },
		{ text: 'Press release', prompt: 'Press release about' },
		{ text: 'An essay', prompt: 'An essay about' },
		{ text: 'Social media post', prompt: 'Social media post about' },
		{ text: 'Brainstorm', prompt: 'Brainstorm ideas for' },
		{ text: 'Project proposal', prompt: 'Project proposal about' },
		{ text: 'Creative story', prompt: 'Creative story about' },
		{ text: 'Make a plan', prompt: 'Make a plan about' },
		{ text: 'Get advice', prompt: 'Get advice about' }
	];


	function insertEngine(type, text) {
		window.Asc.plugin.sendToPlugin("onChatReplace", {
			type : type,
			data : text
		});
	}
	let localStorageKey = "onlyoffice_ai_chat_state";

	window.Asc.plugin.init = function() {
		scrollbarList = new PerfectScrollbar("#chat", {});
		restoreState();
		bCreateLoader = false;
		destroyLoader();

		updateTextareaSize();

		window.Asc.plugin.sendToPlugin("onWindowReady", {});

		document.getElementById('input_message_submit').addEventListener('click', function() {
			onSubmit();
		});
		document.getElementById('input_message').onkeydown = function(e) {
			if ( (e.ctrlKey || e.metaKey) && e.key === 'Enter') {
				e.target.value += '\n';
				updateTextareaSize();
			} else if (e.key === 'Enter') {
				e.preventDefault();
				e.stopPropagation();
				onSubmit();
			}
		};

		document.getElementById('input_message').addEventListener('focus', function(event) {
			$('#input_message_wrapper').addClass('focused');
		});
		document.getElementById('input_message').addEventListener('blur', function(event) {
			$('#input_message_wrapper').removeClass('focused');
		});
		document.getElementById('input_message').focus();

		document.getElementById('input_message').addEventListener('input', function(event) {
			//autosize
			updateTextareaSize();

			if (tokenTimeot) {
				clearTimeout(tokenTimeot);
				tokenTimeot = null;
			}
			tokenTimeot = setTimeout(function() {
				let text = event.target.value.trim();
				let tokens = window.Asc.OpenAIEncode(text);
				if (tokens.length > maxTokens) {
					event.target.classList.add('error_border');
				} else {
					event.target.classList.remove('error_border');
				}
				document.getElementById('cur_tokens').innerText = tokens.length;
			}, 250);
		});

		document.getElementById('attached_text_close').addEventListener('click', function() {
			attachedText.clear();
		});
		
		// TODO:
		if (true)
		{
			document.getElementById('tokens_info').style.display = "none";
		}

		document.getElementById('tokens_info').addEventListener('mouseenter', function (event) {
			event.target.children[0].classList.remove('hidden');
			if (modalTimeout) {
				clearTimeout(modalTimeout);
				modalTimeout = null;
			}
		});

		document.getElementById('tokens_info').addEventListener('mouseleave', function (event) {
			modalTimeout = setTimeout(function() {
				event.target.children[0].classList.add('hidden');
			}, 100)
		});

		document.getElementById('clear_history').onclick = function() {
			document.getElementById('chat').innerHTML = '';
			messagesList.set([]);
			document.getElementById('total_tokens').classList.remove('err-message');
			document.getElementById('total_tokens').innerText = 0;
		};

		document.getElementById("chat_wrapper").addEventListener("click", function(e) {
			if (e.target.tagName === "A") {
				e.preventDefault();
				window.open(e.target.href, "_blank");
			}
		});
	};


	function onSubmit() {
		let textarea = document.getElementById('input_message');
		if (textarea.classList.contains('error_border')){
			setError('Too many tokens in your request.');
			return;
		}
		let value = textarea.value.trim();
		if (value.length) {
			sendMessage(textarea.value.trim());
			textarea.value = '';
			updateTextareaSize();
			document.getElementById('cur_tokens').innerText = 0;
		}
	};

	function updateStartPanel() {
		updateWelcomeText();
		renderWelcomeButtons();
	};

	function updateWelcomeText() {
		let welcomeText = window.Asc.plugin.tr('Welcome');
		if(window.Asc.plugin.info.userName) {
			welcomeText += ', ' + window.Asc.plugin.info.userName;
		}
		welcomeText += '!';
		$("#welcome_text").prepend('<span>' + welcomeText + '</span>');
	};

	function renderWelcomeButtons() {
		welcomeButtons.forEach(function(button) {
			let addedEl = $('<button class="welcome_button btn-text-default noselect">' + button.text + '</button>');
			addedEl.on('click', function() {
				$('#input_message').val(button.prompt + ' ').focus();
			});
			$('#welcome_buttons_list').append(addedEl);
		});
	};

	function updateTextareaSize() {
		let textarea = $('#input_message')[0];
		if(textarea) {
			textarea.style.height = "auto";
			textarea.style.height = Math.min(textarea.scrollHeight, 98) +2 + "px";
		}
	};

	function setState(state) {
		window.localStorage.setItem(localStorageKey, JSON.stringify(state));
	};

	function getState() {
		let state = window.localStorage.getItem(localStorageKey);
		return state ? JSON.parse(state) : null;
	};

	function restoreState() {
		let state = getState();
		if(!state) return;

		if(state.messages) {
			messagesList.set(state.messages);
		}
		if(state.inputValue) {
			document.getElementById('input_message').value = state.inputValue;
		}
		if(state.attachedText) {
			attachedText.set(state.attachedText);
		}
	};

	function sendMessage(text) {
		const isRegenerating = regenerationMessageIndex !== null;
		const message = { role: 'user', content: text };

		if (attachedText.hasShow()) {
			message.attachedText = attachedText.get();
			attachedText.clear();
		}
		if (!isRegenerating) {
			messagesList.add(message);
			createTyping();
		}

		let list = isRegenerating 
			? messagesList.get().slice(0, regenerationMessageIndex) 
			: messagesList.get();
		
		//Remove the errors and user messages that caused the error
		list = list.filter(function(item, index) {
			const nextItem = list[index + 1]
			return !item.error && !(nextItem && nextItem.error);
		});	
		list = list.map(function(item) {
			return { role: item.role, content: item.getActiveContent() }
		});

		window.Asc.plugin.sendToPlugin("onChatMessage", list);	
	};

	function createTyping() {
		let chatEl = $('#chat');
		let messageEl = $('<div id="loading" class="message" style="order: ' +  messagesList.get().length + ';"></div>');
		let spanMessageEl = $('<div class="span_message"></div>');
		spanMessageEl.text(window.Asc.plugin.tr('Thinking'));
		messageEl.append(spanMessageEl);
		chatEl.prepend(messageEl);
		chatEl.scrollTop(chatEl[0].scrollHeight);
		interval = setInterval(function() {
			let countDots = (spanMessageEl.text().match(/\./g) || []).length;
			countDots = countDots < 3 ? countDots + 1 : 0;
			spanMessageEl.text(window.Asc.plugin.tr('Thinking') + Array(countDots + 1).join("."));
		}, 500);
	};

	function removeTyping() {
		clearInterval(interval);
		interval = null;
		let element = document.getElementById('loading');
		element && element.remove();
		return;
	};

	function createLoader() {
		$('#loader-container').removeClass( "hidden" );
		loader && (loader.remove ? loader.remove() : $('#loader-container')[0].removeChild(loader));
		loader = showLoader($('#loader-container')[0], window.Asc.plugin.tr('Loading...'));
	};

	function destroyLoader() {
		document.getElementById('chat_window').classList.remove('hidden');
		$('#loader-container').addClass( "hidden" )
		loader && (loader.remove ? loader.remove() : $('#loader-container')[0].removeChild(loader));
		loader = undefined;
	};

	function setError(error) {
		document.getElementById('lb_err').innerHTML = window.Asc.plugin.tr(error);
		document.getElementById('div_err').classList.remove('hidden');
		if (errTimeout) {
			clearTimeout(errTimeout);
			errTimeout = null;
		}
		errTimeout = setTimeout(clearError, 5000);
	};

	function clearError() {
		document.getElementById('div_err').classList.add('hidden');
		document.getElementById('lb_err').innerHTML = '';
	};

	function getFormattedPathForIcon(path) {
		path = path.replace(/\/(light|dark)\//, '/' + themeType + '/');
		path = path.replace(/(\.\w+)$/, getZoomSuffixForImage() + '$1');
		return path;
	}

	//Toggle the hide of the button to collapse attached text 
	function toggleAttachedCollapseButton($wrapper) {
		const $content = $wrapper.find('.message_content_attached');
		const $btn = $wrapper.find('.message_content_collapse_btn');
		const needCollapse = $content.height() < $content[0].scrollHeight;
		const isCollapsed = $wrapper.hasClass('collapsed');
		$btn.toggleClass('hidden', !needCollapse && isCollapsed);
	}

	function onResize () {
		updateTextareaSize();

		scrollbarList && scrollbarList.update();

		$('.message_content_attached_wrapper').each(function(index, el) {
			toggleAttachedCollapseButton($(el));
		});

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

	function getZoomSuffixForImage() {
		var ratio = Math.round(window.devicePixelRatio / 0.25) * 0.25;
		ratio = Math.max(ratio, 1);
		ratio = Math.min(ratio, 2);
		if(ratio == 1) return ''
		else {
			return '@' + ratio + 'x';
		}
	}

	function onThemeChanged(theme) {
		bCreateLoader = false;
		window.Asc.plugin.onThemeChangedBase(theme);

		themeType = theme.type || 'light';
		updateBodyThemeClasses(theme.type, theme.name);
		updateThemeVariables(theme);

		$('img.icon').each(function() {
			var src = $(this).attr('src');
			var newSrc = src.replace(/(icons\/)([^\/]+)(\/)/, '$1' + themeType + '$3');
			$(this).attr('src', newSrc);
		});
	}

	window.addEventListener("resize", onResize);
	onResize();

	window.Asc.plugin.onTranslate = function() {
		if (bCreateLoader)
			createLoader();
		let elements = document.querySelectorAll('.i18n');

		elements.forEach(function(element) {
			element.innerText = window.Asc.plugin.tr(element.innerText);
		});

		// Textarea
		document.getElementById('input_message').setAttribute('placeholder', window.Asc.plugin.tr('Ask AI anything'));

		//Action buttons
		// In this method info object must be exist
		if (this.info && this.info.editorType !== "word") {
			for (let i = actionButtons.length - 1; i >= 0; --i) {
				if (actionButtons[i].tipOptions.text == "As review") {
					actionButtons.splice(i, 1);
					break;
				}
			}
		}

		actionButtons.forEach(function(button) {
			button.tipOptions.text = window.Asc.plugin.tr(button.tipOptions.text);
		});

		//Welcome buttons
		welcomeButtons.forEach(function(button) {
			button.text = window.Asc.plugin.tr(button.text);
			button.prompt = window.Asc.plugin.tr(button.prompt);
		});

		//Reply errors
		for (var key in errorsMap) {
			if (errorsMap.hasOwnProperty(key)) {
				const errorItem = errorsMap[key];
				errorItem.text = window.Asc.plugin.tr(errorItem.title);
				errorItem.description = window.Asc.plugin.tr(errorItem.description);
			}
		}

		updateStartPanel();
	};

	window.Asc.plugin.onThemeChanged = onThemeChanged;

	window.Asc.plugin.attachEvent("onChatReply", function(reply) {
		let errorCode = null;
		if(!reply.trim()) {
			errorCode = ErrorCodes.UNKNOWN;
		}

		if(regenerationMessageIndex) {
			if(!errorCode) {
				messagesList.pushContentForAssistant(regenerationMessageIndex, reply);
			}
		} else {
			messagesList.add({ role: 'assistant', content: [reply], error: errorCode });
		}
		regenerationMessageIndex = null;
		
		removeTyping();
		document.getElementById('input_message').focus();
	});

	window.Asc.plugin.attachEvent("onAttachedText", function(text) {
		// For a future release.
		// attachedText.set(text);
	});

	window.Asc.plugin.attachEvent("onThemeChanged", onThemeChanged);

	window.Asc.plugin.attachEvent("onUpdateState", function() {
		setState({
			messages: messagesList.get(),
			inputValue: document.getElementById('input_message').value,
			attachedText: attachedText.hasShow() ? attachedText.get() : ''
		});
		window.Asc.plugin.sendToPlugin("onUpdateState");
	});

})(window, undefined);
