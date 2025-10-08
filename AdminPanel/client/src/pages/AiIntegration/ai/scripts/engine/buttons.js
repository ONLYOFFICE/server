(function(window, undefined)
{
	function generateGuid()
	{
		if (!window.crypto || !window.crypto.getRandomValues)
		{
			function s4() {
				return Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);
			}
			return s4() + s4() + '-' + s4() + '-' + s4() + '-' + s4() + '-' + s4() + s4() + s4();
		}
		
		var array = new Uint16Array(8);
		window.crypto.getRandomValues(array);
		var index = 0;
		function s4() {
			var value = 0x10000 + array[index++];
			return value.toString(16).substring(1);
		}
		return s4() + s4() + '-' + s4() + '-' + s4() + '-' + s4() + '-' + s4() + s4() + s4();
	}

	function translateItem(text) {
		return window.Asc.plugin.tr(text);
	};

	window.Asc = window.Asc || {};
	var Asc = window.Asc;
	
	Asc.Buttons = {};
	Asc.Buttons.ButtonsContextMenu = [];
	Asc.Buttons.ButtonsToolbar = [];

	Asc.Buttons.registerContextMenu = function()
	{
		window.Asc.plugin.attachEvent("onContextMenuShow", function(options) {
			if (!options)
				return;

			let items = {
				guid: window.Asc.plugin.guid,
			};
			for (let i = 0, len = Asc.Buttons.ButtonsContextMenu.length; i < len; i++)
			{
				let button = Asc.Buttons.ButtonsContextMenu[i];
				if (button.parent === null)
				{
					button.onContextMenuShow(options, items);
				}
			}
	
			if (items.items)
				window.Asc.plugin.executeMethod("AddContextMenuItem", [items]);
		});
	};

	Asc.Buttons.registerToolbarMenu = function()
	{
		let items = {
			guid : window.Asc.plugin.guid,
			tabs : []
		};

		for (let i = 0, len = Asc.Buttons.ButtonsToolbar.length; i < len; i++)
		{
			let button = Asc.Buttons.ButtonsToolbar[i];
			if (button.parent === null)
			{
				button.toToolbar(items);
			}

			if (!!button.menu) {
				for (item of button.menu) {
					if (!!item.onclick) {
						window.Asc.plugin.attachToolbarMenuClickEvent(item.id, item.onclick);
					}
				}
			}
		}

		if (items.tabs.length > 0)
			window.Asc.plugin.executeMethod("AddToolbarMenuItem", [items]);
	};

	Asc.Buttons.updateToolbarMenu = function(id, name, buttons)
	{
		let buttonMainToolbar = new Asc.ButtonToolbar(null, id);
		buttonMainToolbar.text = name;

		let items = {
			guid : window.Asc.plugin.guid,
			tabs : []
		};

		buttonMainToolbar.childs = buttons;
		for (let i = 0, len = buttons.length; i < len; i++)
			buttons[i].parent = buttonMainToolbar;

		buttonMainToolbar.toToolbar(items);

		if (items.tabs.length > 0)
			window.Asc.plugin.executeMethod("UpdateToolbarMenuItem", [items]);
	};

	var ToolbarButtonType = {
		Button : "button",
		BigButton : "big-button"
	};

	var ItemType = {
		None : 0,
		ContextMenu : 1,
		Toolbar : 2
	};

	function Button(parent, id)
	{
		this.itemType = ItemType.None;
		this.editors = ["word", "cell", "slide"];

		this.id = (id === undefined) ? generateGuid() : id;

		this.icons = null;
		
		this.text = "";
		this.hint = null;
		this.data = "";

		this.separator = false;
		this.lockInViewMode = true;
		this.enableToggle = false;
		this.disabled = false;
		this.removed = false;

		this.parent = parent ? parent : null;
		this.childs = null;

		if (this.parent)
		{
			if (!this.parent.childs)
				this.parent.childs = [];
			this.parent.childs.push(this);
		}
	}

	Button.prototype.toItem = function() 
	{
		let item = {
			id : this.id,
			text : translateItem(this.text)            
		};

		if (this.hint !== null)
			item.hint = translateItem(this.hint === "" ? this.hint : this.text);
		
		if (this.separator)
			item.separator = true;

		if (this.data)
			item.data = this.data;

		if (this.lockInViewMode)
			item.lockInViewMode = true;

		if (this.enableToggle)
			item.enableToggle = true;

		if (this.disabled)
			item.disabled = true;
		else
			item.disabled = false;

		if (this.removed)
			item.removed = true;

		if (this.icons)
			item.icons = this.icons;

		if (this.itemType === ItemType.Toolbar)
			item.type = this.type;

		if (this.menu)
			item.items = this.menu.map(function(menuItem) {
				menuItem.text = translateItem(menuItem.text);
				return menuItem;
			});

		if (this.split)
			item.split = true;

		return item;
	};

	Button.prototype.attachOnClick = function(handler)
	{
	};

	Button.prototype.onClick = function() 
	{
		console.log("BUTTON: " + this.text);
	};

	function ButtonContextMenu(parent, id)
	{
		Button.call(this, parent, id);

		this.itemType = ItemType.ContextMenu;
		this.showOnOptionsType = [];

		Asc.Buttons.ButtonsContextMenu.push(this);
	}

	ButtonContextMenu.prototype = Object.create(Button.prototype);
	ButtonContextMenu.prototype.constructor = ButtonContextMenu;

	ButtonContextMenu.prototype.copy = function()
	{
		let ret = new ButtonContextMenu(this.parent, this.id);
		ret.editors = this.editors;

		ret.separator = this.separator;
		ret.lockInViewMode = this.lockInViewMode;
		ret.enableToggle = this.enableToggle;
		ret.disabled = this.disabled;
		ret.showOnOptionsType = this.showOnOptionsType.slice();

		return ret;
	};

	ButtonContextMenu.prototype.addCheckers = function()
	{
		let len = arguments.length;
		this.showOnOptionsType = new Array(len);
		for (let i = 0; i < len; i++)
			this.showOnOptionsType[i] = arguments[i];
	};

	ButtonContextMenu.prototype.attachOnClick = function(handler)
	{
		window.Asc.plugin.attachContextMenuClickEvent(this.id, handler);  
	};

	ButtonContextMenu.prototype.onContextMenuShowAnalyze = function(options, parent)
	{        
		return false;
	};

	ButtonContextMenu.prototype.onContextMenuShowExtendItem = function(options, item)
	{        
	};

	ButtonContextMenu.prototype.onContextMenuShow = function(options, parent) 
	{
		if (this.onContextMenuShowAnalyze(options, parent))
			return;

		let isSupport = false;
		for (let i = 0, len = this.editors.length; i < len; i++)
		{
			if (Asc.plugin.info.editorType === this.editors[i])
			{
				isSupport = true;
				break;
			}
		}

		if (!isSupport)
			return;

		for (let i = 0, len = this.showOnOptionsType.length; i < len; i++)
		{
			if (options.type === this.showOnOptionsType[i] || this.showOnOptionsType[i] === "All")
			{
				if (!parent.items)
					parent.items = [];

				let curItem = this.toItem();   
				this.onContextMenuShowExtendItem(options, curItem);                           
				
				if (this.childs)
				{
					for (let j = 0, childsLen = this.childs.length; j < childsLen; j++)
					{
						this.childs[j].onContextMenuShow(options, curItem);
					}
				}

				parent.items.push(curItem);
				return;
			}
		}
	};

	function ButtonToolbar(parent, id)
	{
		Button.call(this, parent, id);

		this.itemType = ItemType.Toolbar;
		this.type = ToolbarButtonType.BigButton;
		this.tab = "";
		
		Asc.Buttons.ButtonsToolbar.push(this);
	}

	ButtonToolbar.prototype = Object.create(Button.prototype);
	ButtonToolbar.prototype.constructor = ButtonToolbar;

	ButtonToolbar.prototype.attachOnClick = function(handler)
	{
		window.Asc.plugin.attachToolbarMenuClickEvent(this.id, handler);
	};

	ButtonToolbar.prototype.toItem = function(items)
	{        
		let item = Button.prototype.toItem.call(this);
		item.type = this.type;
		return item;
	};

	ButtonToolbar.prototype.toToolbar = function(items)
	{
		let currentItem = null;
		if (this.parent === null)
		{
			let tab = {
				id : this.id,
				text : translateItem(this.text),
				items : []
			};
			if (this.hint !== null)
				tab.hint = translateItem(this.hint === "" ? this.hint : this.text);

			items.tabs.push(tab);

			currentItem = tab;
		}
		else
		{
			currentItem = this.toItem();
			
			if (!items.items)
				items.items = [];
			
			items.items.push(currentItem);
		}

		if (this.childs)
		{
			for (let j = 0, childsLen = this.childs.length; j < childsLen; j++)
			{
				this.childs[j].toToolbar(currentItem);
			}
		}
	};

	Asc.ToolbarButtonType = ToolbarButtonType;
	Asc.ButtonContextMenu = ButtonContextMenu;
	Asc.ButtonToolbar = ButtonToolbar;
})(window);
