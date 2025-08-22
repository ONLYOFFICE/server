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

function Tooltip(targetEl, options) {
    this._init = function() {
        var me = this;
        var defaults = {
            renderInner: null,
            text: '',
            xAnchor: 'center',
            yAnchor: 'bottom',
            xOffset: 0,
            yOffset: 3,
            align: 'center',
            width: null,
            hasShadow: false,
            keepAliveOnHover: false,
            delay: 0, 
            hideDelay: 0
        };
        this.options = Object.assign({}, defaults, options);


        targetEl.addEventListener('mouseover', function() {
            // Set a timer for the delay before showing
            me.showTimeout = setTimeout(function() {
                me._createTooltipElement();
                if(me.options.renderInner) {
                    me.tooltipEl.appendChild(me.options.renderInner());
                } else {
                    me.tooltipEl.innerText = me.options.text;
                }
                if (me.options.width) {
                    me.tooltipEl.style.width = me.options.width + 'px';
                    me.tooltipEl.style.whiteSpace = '';
                } else {
                    me.tooltipEl.style.width = '';
                    me.tooltipEl.style.whiteSpace = 'nowrap';
                }

                if (me.options.hasShadow) {
                    me.tooltipEl.classList.add('has-shadow');
                } else {
                    me.tooltipEl.classList.remove('has-shadow');
                }
                me._updatePosition();
            }, me.options.delay);
        });

        targetEl.addEventListener('mouseleave', function() {
            clearTimeout(me.showTimeout); // Clear the show timer if the user leaves the element
            
            // Set a timer for the delay before hiding
            me.hideTimeout = setTimeout(function() {
                me._deleteTooltipElement();
            }, me.options.hideDelay);
        });
    };

    this._createTooltipElement = function () {
        if (!this.tooltipEl) {
            let me = this;
            this.tooltipEl = document.createElement("div");
            this.tooltipEl.classList.add("tooltip");

            this.tooltipEl.addEventListener('mouseenter', function() {
                if (me.options.keepAliveOnHover) {
                    clearTimeout(me.hideTimeout); // Clear the hide timer when hovering over the tooltip
                }
            });
    
            this.tooltipEl.addEventListener('mouseleave', function() {
                if (me.options.keepAliveOnHover) {
                    // Set a timer for the delay before hiding the tooltip
                    me.hideTimeout = setTimeout(function() {
                        me._deleteTooltipElement();
                    }, me.options.hideDelay);
                }
            });

            document.body.appendChild(this.tooltipEl);
        }
    };

    this._deleteTooltipElement = function() {
        if (this.tooltipEl) { 
            this.tooltipEl.remove();
            this.tooltipEl = null;
        }
    };

    this._updatePosition = function() {
        var rectTooltip = this.tooltipEl.getBoundingClientRect();
        var rectEl = targetEl.getBoundingClientRect();
        var yOffset = this.options.yOffset;
        var xOffset = this.options.xOffset;
        if (this.options.align == 'right') {
            xOffset = -rectTooltip.width;
        } else if (this.options.align == 'center') {
            xOffset = -rectTooltip.width / 2;
        }

        if (this.options.xAnchor == 'right') {
            this.tooltipEl.style.left = rectEl.right + xOffset + 'px';
        } else if (this.options.xAnchor == 'left') {
            this.tooltipEl.style.left = rectEl.left + xOffset + 'px';
        } else if (this.options.xAnchor == 'center') {
            this.tooltipEl.style.left = rectEl.left + rectEl.width / 2 + xOffset + 'px';
        }

        if (this.options.yAnchor == 'bottom') {
            this.tooltipEl.style.top = rectEl.bottom + yOffset + 'px';
        } else if (this.options.yAnchor == 'top') {
            this.tooltipEl.style.top = rectEl.top - yOffset - rectTooltip.height + 'px';
        }
    };

    this.getText = function() {
        return this.options.text;
    };

    this.setText = function(text) {
        this.options.text = text;
        if(this.tooltipEl) {
            this.tooltipEl.innerText = text;
            this._updatePosition();
        }
    };

    this._init();
}
