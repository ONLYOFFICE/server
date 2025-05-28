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
