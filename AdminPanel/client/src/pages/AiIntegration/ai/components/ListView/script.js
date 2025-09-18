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
