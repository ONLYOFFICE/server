function ListView($el, options) {
    this._init = function() {
        var defaults = {
            emptyText: '',
            renderItem: function(item, index) {
                var itemEl = document.createElement('div');
                itemEl.classList.add('item');
                itemEl.innerText = item.label;
                return itemEl;
            }
        };
        this.options = Object.assign({}, defaults, options);

        $el.classList.add('list-view');
        this.$el = $el;
        this.list = [];
        this.selectedItem = null;
        this.events = {
            set: [],
            add: [],
            edit: [],
            delete: [],
            select: [],
            deselect: [],
        };

        this._render();
    };

    this._render = function() {
        var me = this;
        this.$el.innerHTML = '';
        if(this.list.length > 0) {
            this.list.forEach(function(item, index) {
                let itemEl = me.options.renderItem(item, index);
                itemEl.addEventListener('click', function() {
                    me.setSelected(index);
                });
                me.$el.appendChild(itemEl);
            });
        } else if(this.options.emptyText) {
            let emptyEl = document.createElement('div');
            emptyEl.innerText = this.options.emptyText;
            emptyEl.classList.add('empty-text');
            this.$el.appendChild(emptyEl);
        }
    };

    this._trigger = function(event, data) {
        if(this.events[event]) {
            this.events[event].forEach(function(callback) {
                callback(data);
            });
        }
    };

    this.getList = function() {
        return this.list;
    };

    this.set = function(list) {
        this.list = list;
        this._render();
        if(list.length > 0) {
            this.setSelected(0);
        } else {
            this.deselect();
        }
        scrollbarList.update();
        scrollbarList.update();

        this._trigger('set', list);
    };
    
    this.add = function(item) {
        this.list.push(item);
        this._render();
        this.setSelected(this.list.length - 1);
        this.$el.scrollTop = this.$el.scrollHeight;
        scrollbarList.update();
        scrollbarList.update();

        this._trigger('add', item);
    };

    this.edit = function(item) {
        var findedItem = this.list.filter(function(el) {
            return el.id == item.id;
        })[0];

        if(!findedItem) return;

        for (var key in item) {
            if (findedItem[key]) {
                findedItem[key] = item[key];
            }
        }
        this._render();

        this._trigger('edit', findedItem, item);
    };

    this.delete = function(item) {
        var indexDeletedItem = this.list.indexOf(item);
        if(indexDeletedItem != -1) {
            this.list = this.list.filter(function(el) {
                return el != item;
            });
            this._render();

            if(this.list.length == 0) {
                this.deselect();
            } else if(indexDeletedItem < this.list.length) {
                this.setSelected(indexDeletedItem);
            } else {
                this.setSelected(this.list.length - 1);
            }

            this._trigger('delete', item);
        }
    };

    this.deleteByIndex = function(index) {
        if(!this.list[index]) return;

        this.delete(this.list[index]);
    };

    this.setSelected = function(index) {
        if(this.list.length == 0) return;

        if(index == -1) {
            index = this.list.length - 1;
        }
        if(!this.list[index]) return;

        this.deselect();
        this.selectedItem = this.list[index];
        this.$el.children[index].classList.add('selected');

        this._trigger('select', this.selectedItem);
    };

    this.getSelected = function() {
        return this.selectedItem;
    };

    this.deselect = function() {
        var previouslySelectedItem = this.selectedItem;
        this.selectedItem = null;

        var itemsEl = this.$el.getElementsByClassName('item');
        for (var i = 0; i < itemsEl.length; i++) {
            itemsEl[i].classList.remove('selected');
        }

        if (previouslySelectedItem) {
            this._trigger('deselect', previouslySelectedItem);
        }
    };

    this.setEmptyText = function(text) {
        this.options.emptyText = text;
        this._render();
    };

    this.on = function(event, callback) {
        if(this.events[event]) {
            this.events[event].push(callback);
        }
    };


    this._init();
}
