

'use strict';

const pluginGuid = "asc.{9DC93CDB-B576-4F0C-B55E-FCC9C48DD007}";
let iframeMain = '';
let sdkVersion = 'develop'; // Dynamic version, defaults to 'develop'
const mainButtonId = 'settings.html';

// Plugin window management callbacks
let showPluginWindowCallback = null;
let closePluginWindowCallback = null;
let saveCallback = null;

let settingsButton = null;

/**
 * Sends a message to an iframe
 * @param {string} iframeId - The iframe element ID
 * @param {Object} data - The data to send
 */
function sendMessageToFrame(iframeId, data) {
    const frame = document.getElementById(iframeId);
    if (frame) {
        console.log('sendMessageToFrame', iframeId, data);
        frame.contentWindow.postMessage(JSON.stringify(data), "*");
    }
}

/**
 * Handles incoming messages from iframes
 * @param {MessageEvent} event - The message event
 */
function receiveMessage(event) {
    if (typeof event.data !== 'string') {
        return;
    }
    console.log(event);
    
    try {
        const data = JSON.parse(event.data);
        if (data.type === 'initialize') {
            initialize(data);
        } else if (data.type === 'initialize_internal') {
            initialize_internal(data);
        } else if (data.type === 'method') {
            handleMethod(data);
        } else if (data.type === 'messageToPlugin') {
            sendMessageToPlugin(data);
        }
    } catch (error) {
        console.error('Failed to parse message data:', error);
    }
}

/**
 * Initializes the plugin with the main iframe
 * @param {Object} data - Initialization data containing windowID
 */
function initialize(data) {
    const iframeId = data.windowID || iframeMain;
    const msg = {
        guid: pluginGuid,
        type: "plugin_init",
        data: /*<code>*/"(function(a,n){var f=[1,1.25,1.5,1.75,2,2.25,2.5,2.75,3,3.5,4,4.5,5];a.AscDesktopEditor&&a.AscDesktopEditor.GetSupportedScaleValues&&(f=a.AscDesktopEditor.GetSupportedScaleValues());var h=function(){if(0===f.length)return!1;var c=navigator.userAgent.toLowerCase(),e=-1<c.indexOf(\"android\");c=!(-1<c.indexOf(\"msie\")||-1<c.indexOf(\"trident\")||-1<c.indexOf(\"edge\"))&&-1<c.indexOf(\"chrome\");var d=!!a.opera,l=/android|avantgo|blackberry|blazer|compal|elaine|fennec|hiptop|iemobile|ip(hone|od|ad)|iris|kindle|lge |maemo|midp|mmp|opera m(ob|in)i|palm( os)?|phone|p(ixi|re)\\/|plucker|pocket|psp|symbian|treo|up\\.(browser|link)|vodafone|wap|windows (ce|phone)|xda|xiino/i.test(navigator.userAgent||navigator.vendor||a.opera);return!e&&c&&!d&&!l&&document&&document.firstElementChild&&document.body?!0:!1}();a.AscCommon=a.AscCommon||{};a.AscCommon.checkDeviceScale=function(){var c={zoom:1,devicePixelRatio:a.devicePixelRatio,applicationPixelRatio:a.devicePixelRatio,correct:!1};if(!h)return c;for(var e=a.devicePixelRatio,d=0,l=Math.abs(f[0]-e),k,g=1,p=f.length;g<p&&!(1E-4<Math.abs(f[g]-e)&&f[g]>e-1E-4);g++)k=Math.abs(f[g]-e),k<l-1E-4&&(l=k,d=g);c.applicationPixelRatio=f[d];.01<Math.abs(c.devicePixelRatio-c.applicationPixelRatio)&&(c.zoom=c.devicePixelRatio/c.applicationPixelRatio,c.correct=!0);return c};var b=1;a.AscCommon.correctApplicationScale=function(c){!c.correct&&1E-4>Math.abs(c.zoom-b)||(b=c.zoom,document.firstElementChild.style.zoom=.001>Math.abs(b-1)?\"normal\":1/b)}})(window);(function(a,n){function f(b){this.plugin=b;this.ps;this.items=[];this.isCurrentVisible=this.isVisible=!1}function h(){this.id=a.Asc.generateGuid();this.id=this.id.replace(/-/g,\"\");this._events={};this._register()}f.prototype.createWindow=function(){var b=document.body,c=document.getElementsByTagName(\"head\")[0];b&&c&&(b=document.createElement(\"style\"),b.type=\"text/css\",b.innerHTML='.ih_main { margin: 0px; padding: 0px; width: 100%; height: 100%; display: inline-block; overflow: hidden; box-sizing: border-box; user-select: none; position: fixed; border: 1px solid #cfcfcf; } ul { margin: 0px; padding: 0px; width: 100%; height: 100%; list-style-type: none; outline:none; } li { padding: 5px; font-family: \"Helvetica Neue\", Helvetica, Arial, sans-serif; font-size: 12px; font-weight: 400; color: #373737; } li:hover { background-color: #D8DADC; } .li_selected { background-color: #D8DADC; color: #373737; }.li_selected:hover { background-color: #D8DADC; color: #373737; }',c.appendChild(b),document.body.style.background=\"#FFFFFF\",document.body.style.width=\"100%\",document.body.style.height=\"100%\",document.body.style.margin=\"0\",document.body.style.padding=\"0\",document.body.innerHTML='<div class=\"ih_main\" id=\"ih_area\"><ul id=\"ih_elements_id\" role=\"listbox\"></ul></div>',this.ps=new PerfectScrollbar(document.getElementById(\"ih_area\"),{minScrollbarLength:20}),this.updateScrolls(),this.createDefaultEvents())};f.prototype.setItems=function(b){this.items=b;for(var c=\"\",e=b.length,d=0;d<e;d++)n===b[d].id&&(b[d].id=\"\"+d),c+='<li role=\"option\"',0==d&&(c+=' class=\"li_selected\"'),c+=' id=\"'+b[d].id+'\"',c+=' onclick=\"_private_on_ih_click(event)\">',c+=b[d].text,c+=\"</li>\";document.getElementById(\"ih_elements_id\").innerHTML=c;this.updateScrolls();this.scrollToSelected()};f.prototype.createDefaultEvents=function(){this.plugin.onExternalMouseUp=function(){var c=document.createEvent(\"MouseEvents\");c.initMouseEvent(\"mouseup\",!0,!0,a,1,0,0,0,0,!1,!1,!1,!1,0,null);document.dispatchEvent(c)};var b=this;a.onkeydown=function(c){switch(c.keyCode){case 27:b.isVisible&&(b.isVisible=!1,b.plugin.executeMethod(\"UnShowInputHelper\",[b.plugin.info.guid,!0]));break;case 38:case 40:case 9:case 36:case 35:case 33:case 34:for(var e=document.getElementsByTagName(\"li\"),d=-1,l=0;l<e.length;l++)if(\"li_selected\"==e[l].className){d=l;e[l].className=\"\";break}if(-1==d)d=0;else switch(c.keyCode){case 38:d--;0>d&&(d=0);break;case 40:d++;d>=e.length&&(d=e.length-1);break;case 9:d++;d>=e.length&&(d=0);break;case 36:d=0;break;case 35:d=e.length-1;break;case 33:case 34:l=1;var k=document.getElementById(\"ih_area\").clientHeight/24>>0;1<k&&(l=k);33==c.keyCode?(d-=l,0>d&&(d=0)):(d+=l,d>=e.length&&(d=d=e.length-1))}d<e.length&&(e[d].className=\"li_selected\",l=e[d].offsetTop,e=e[d].offsetHeight,d=document.getElementById(\"ih_area\"),k=d.scrollTop,l<k?d.scrollTo?d.scrollTo(0,l):d.scrollTop=l:k+d.offsetHeight<l+e&&(d.scrollTo?d.scrollTo(0,l-(d.offsetHeight-e)):d.scrollTop=l-(d.offsetHeight-e)));break;case 13:b.onSelectedItem()}c.preventDefault&&c.preventDefault();c.stopPropagation&&c.stopPropagation();return!1};a.onresize=function(c){b.updateScrolls()};a._private_on_ih_click=function(c){for(var e=document.getElementsByTagName(\"li\"),d=0;d<e.length;d++)e[d].className=\"\";c.target.className=\"li_selected\";c.target.getAttribute(\"id\");b.onSelectedItem()};this.plugin.event_onKeyDown=function(c){a.onkeydown({keyCode:c.keyCode})}};f.prototype.updateScrolls=function(){this.ps.update();this.ps.update();var b=document.getElementsByClassName(\"ps__rail-y\")[0],c=document.getElementsByClassName(\"ps__rail-x\")[0];if(c&&b){var e=a.getComputedStyle(b),d=a.getComputedStyle(c);e=e&&\"none\"==e.display?!1:!0;d&&\"none\"==d.display||!e?(\"2px\"!=b.style.marginBottom&&(b.style.marginBottom=\"2px\"),\"2px\"!=c.style.marginRight&&(c.style.marginRight=\"2px\")):(\"13px\"!=b.style.marginBottom&&(b.style.marginBottom=\"13px\"),\"13px\"!=c.style.marginRight&&(c.style.marginRight=\"13px\"))}};f.prototype.scrollToSelected=function(){for(var b=document.getElementsByTagName(\"li\"),c=0;c<b.length;c++)if(\"li_selected\"==b[c].className){var e=document.getElementById(\"ih_area\");e.scrollTo?e.scrollTo(0,b[c].offsetTop):e.scrollTop=b[c].offsetTop;break}};f.prototype.getSelectedItem=function(){for(var b=document.getElementsByTagName(\"li\"),c=-1,e=0;e<b.length;e++)if(\"li_selected\"==b[e].className){c=b[e].getAttribute(\"id\");break}if(-1==c)return null;b=this.items.length;for(e=0;e<b;e++)if(c==this.items[e].id)return this.items[e];return null};f.prototype.onSelectedItem=function(){this.plugin.inputHelper_onSelectItem&&this.plugin.inputHelper_onSelectItem(this.getSelectedItem())};f.prototype.show=function(b,c,e){this.isCurrentVisible=!0;this.plugin.executeMethod(\"ShowInputHelper\",[this.plugin.info.guid,b,c,e],function(){a.Asc.plugin.ih.isVisible=!0})};f.prototype.unShow=function(){if(this.isCurrentVisible||this.isVisible)this.isCurrentVisible=!1,a.Asc.plugin.executeMethod(\"UnShowInputHelper\",[this.plugin.info.guid],function(){a.Asc.plugin.ih.isVisible=!1})};f.prototype.getItemHeight=function(){var b=24,c=document.getElementsByTagName(\"li\");0<c.length&&0<c[0].offsetHeight&&(b=c[0].offsetHeight);return b};f.prototype.getItemsHeight=function(b){return 2+b*this.getItemHeight()};f.prototype.getItems=function(){return this.items};f.prototype.getScrollSizes=function(){var b={w:0,h:0},c=this.getItemHeight(),e=document.getElementById(\"ih_elements_id\");e&&(b.w=e.scrollWidth,b.h=2+this.items.length*c);return b};h.prototype._register=function(){var b=a.Asc.plugin;b._windows||(b._windows={});b._windows[this.id]=this};h.prototype._unregister=function(){var b=a.Asc.plugin;b._windows&&b._windows[this.id]&&delete b._windows[this.id]};h.prototype.show=function(b){var c=b.url;if(0!==c.indexOf(\"http://\")&&0!==c.indexOf(\"https://\")&&0!==c.indexOf(\"file://\")&&0!==c.indexOf(\"www.\")){let d=a.location;var e=d.pathname.lastIndexOf(\"/\")+1;e=d.pathname.substring(e);c=d.href.replace(e,c)}c=-1===c.indexOf(\".html?\")?c+\"?windowID=\":c+\"&windowID=\";b.url=c+this.id;a.Asc.plugin.executeMethod(\"ShowWindow\",[this.id,b])};h.prototype.activate=function(b){a.Asc.plugin.executeMethod(\"ActivateWindow\",[this.id,b])};h.prototype.close=function(){a.Asc.plugin.executeMethod(\"CloseWindow\",[this.id]);this._unregister()};h.prototype.command=function(b,c){a.Asc.plugin.executeMethod(\"SendToWindow\",[this.id,b,c])};h.prototype.attachEvent=function(b,c){this._events[b]=c};h.prototype.detachEvent=function(b){this._events&&this._events[b]&&delete this._events[b]};h.prototype._oncommand=function(b,c){this._events&&this._events[b]&&this._events[b].call(a.Asc.plugin,c)};a.Asc=a.Asc||{};a.Asc.generateGuid=function(){if(a.crypto&&a.crypto.getRandomValues){var b=new Uint16Array(8);a.crypto.getRandomValues(b);var c=0;function d(){return(65536+b[c++]).toString(16).substring(1)}return d()+d()+\"-\"+d()+\"-\"+d()+\"-\"+d()+\"-\"+d()+d()+d()}function e(){return Math.floor(65536*(1+Math.random())).toString(16).substring(1)}return e()+e()+\"-\"+e()+\"-\"+e()+\"-\"+e()+\"-\"+e()+e()+e()};a.Asc.inputHelper=f;a.Asc.PluginWindow=h})(window,void 0);(function(a,n){function f(h){var b=h.metaKey||h.ctrlKey?!0:!1;if(116==h.keyCode)return a.parent.postMessage(JSON.stringify({type:\"reload\",guid:a.Asc.plugin.guid,ctrl:b}),\"*\"),h.preventDefault&&h.preventDefault(),h.stopPropagation&&h.stopPropagation(),!1}a.addEventListener?a.addEventListener(\"keydown\",f,!1):a.attachEvent(\"keydown\",f)})(window,void 0);(function(a,n){function f(k){var g=new XMLHttpRequest;g.open(\"GET\",\"./translations/\"+k+\".json\");g.onreadystatechange=function(){if(4==g.readyState){if(200==g.status||0==location.href.indexOf(\"file:\"))try{h(JSON.parse(g.responseText))}catch(p){h()}404==g.status&&h()}};g.send()}function h(k){a.Asc.plugin.translateManager=k||{};if(a.Asc.plugin.onTranslate)a.Asc.plugin.onTranslate()}function b(){if(!a.Asc.plugin.isStarted){a.Asc.plugin.isStarted=!0;a.startPluginApi();var k=AscCommon.checkDeviceScale();AscCommon.retinaPixelRatio=k.applicationPixelRatio;AscCommon.zoom=k.zoom;AscCommon.correctApplicationScale(k);a.Asc.plugin.onEnableMouseEvent=function(g){var p=document.getElementsByTagName(\"iframe\");p&&p[0]&&(p[0].style.pointerEvents=g?\"none\":\"\")}}}var c={body:{color:\"text-normal\",\"background-color\":\"background-toolbar\"},\".defaultlable\":{color:\"text-normal\"},\".aboutlable\":{color:\"text-normal\"},\"a.aboutlink\":{color:\"text-normal\"},\".form-control, .form-control[readonly], .form-control[disabled]\":{color:\"text-normal\",\"background-color\":\"background-normal\",\"border-color\":\"border-regular-control\"},\".form-control:focus\":{\"border-color\":\"border-control-focus\"},\".form-control[disabled]\":{color:\"text-invers\"},\".btn-text-default\":{\"background-color\":\"background-normal\",\"border-color\":\"border-regular-control\",color:\"text-normal\"},\".btn-text-default:hover\":{\"background-color\":\"highlight-button-hover\"},\".btn-text-default.active,\\t\\t.btn-text-default:active\":{\"background-color\":\"highlight-button-pressed !important\",color:\"text-normal-pressed\"},\".btn-text-default[disabled]:hover,\\t\\t.btn-text-default.disabled:hover,\\t\\t.btn-text-default[disabled]:active,\\t\\t.btn-text-default[disabled].active,\\t\\t.btn-text-default.disabled:active,\\t\\t.btn-text-default.disabled.active\":{\"background-color\":\"background-normal !important\",color:\"text-normal\"},\".select2-container--default .select2-selection--single\":{color:\"text-normal\",\"background-color\":\"background-normal\"},\".select2-container--default .select2-selection--single .select2-selection__rendered\":{color:\"text-normal\"},\".select2-results\":{\"background-color\":\"background-normal\"},\".select2-container--default .select2-results__option--highlighted[aria-selected]\":{\"background-color\":\"highlight-button-hover !important\"},\".select2-container--default .select2-results__option[aria-selected=true]\":{\"background-color\":\"highlight-button-pressed !important\",color:\"text-normal-pressed\"},\".select2-dropdown, .select2-container--default .select2-selection--single\":{\"border-color\":\"border-regular-control !important\"},\".select2-container--default.select2-container--open .select2-selection--single\":{\"border-color\":\"border-control-focus !important\"},\".select2-container--default.select2-container--focus:not(.select2-container--open) .select2-selection--single\":{\"border-color\":\"border-regular-control !important\"},\".select2-container--default.select2-container--open.select2-container--focus .select2-selection--single\":{\"border-color\":\"border-control-focus !important\"},\".select2-search--dropdown\":{\"background-color\":\"background-normal !important\"},\".select2-container--default .select2-search--dropdown .select2-search__field\":{color:\"text-normal\",\"background-color\":\"background-normal\",\"border-color\":\"border-regular-control\"},\".select2-container--default.select2-container--disabled .select2-selection--single\":{\"background-color\":\"background-normal\"},\".select2-container--default .select2-selection--single .select2-selection__arrow b\":{\"border-color\":\"text-normal !important\"},\".select2-container--default.select2-container--open .select2-selection__arrow b\":{\"border-color\":\"text-normal !important\"},\".ps .ps__rail-y:hover\":{\"background-color\":\"background-toolbar\"},\".ps .ps__rail-y.ps--clicking\":{\"background-color\":\"background-toolbar\"},\".ps__thumb-y\":{\"background-color\":\"background-normal\",\"border-color\":\"Border !important\"},\".ps__rail-y:hover > .ps__thumb-y\":{\"border-color\":\"canvas-scroll-thumb-hover\",\"background-color\":\"canvas-scroll-thumb-hover !important\"},\".ps .ps__rail-x:hover\":{\"background-color\":\"background-toolbar\"},\".ps .ps__rail-x.ps--clicking\":{\"background-color\":\"background-toolbar\"},\".ps__thumb-x\":{\"background-color\":\"background-normal\",\"border-color\":\"Border !important\"},\".ps__rail-x:hover > .ps__thumb-x\":{\"border-color\":\"canvas-scroll-thumb-hover\"},a:{color:\"text-link !important\"},\"a:hover\":{color:\"text-link-hover !important\"},\"a:active\":{color:\"text-link-active !important\"},\"a:visited\":{color:\"text-link-visited !important\"},\"*::-webkit-scrollbar-track\":{background:\"background-normal\"},\"*::-webkit-scrollbar-track:hover\":{background:\"background-toolbar-additional\"},\"*::-webkit-scrollbar-thumb\":{\"background-color\":\"background-toolbar\",\"border-color\":\"border-regular-control\"},\"*::-webkit-scrollbar-thumb:hover\":{\"background-color\":\"canvas-scroll-thumb-hover\"},\".asc-plugin-loader\":{color:\"text-normal\"}},e=!1,d=\"\";a.plugin_sendMessage=function(k){a.Asc.plugin.ie_channel?a.Asc.plugin.ie_channel.postMessage(k):a.parent.postMessage(k,\"*\")};a.plugin_onMessage=function(k){if(a.Asc.plugin&&\"string\"==typeof k.data){var g={};try{g=JSON.parse(k.data)}catch(m){g={}}k=g.type;if(g.guid!=a.Asc.plugin.guid){if(n!==g.guid)return;switch(k){case \"onExternalPluginMessage\":break;default:return}}\"init\"===k&&(a.Asc.plugin.info=g);\"updateOptions\"===k&&g.options&&(a.Asc.plugin.info.options=g.options);if(n!==g.theme&&(!a.Asc.plugin.theme||\"onThemeChanged\"===k))if(a.Asc.plugin.theme=g.theme,a.Asc.plugin.onThemeChangedBase||(a.Asc.plugin.onThemeChangedBase=function(m){var q=\"\",t;for(t in c){q+=t+\" {\";var w=c[t],r;for(r in w){var u=w[r],y=u.indexOf(\" !important\");-1<y&&(u=u.substr(0,y));(u=m[u])&&(q+=r+\" : \"+u+(-1===y?\";\":\" !important;\"))}q+=\" }\\n\"}m=document.createElement(\"style\");m.type=\"text/css\";m.innerHTML=q;document.getElementsByTagName(\"head\")[0].appendChild(m)}),a.Asc.plugin.onThemeChanged)a.Asc.plugin.onThemeChanged(a.Asc.plugin.theme);else a.Asc.plugin.onThemeChangedBase(a.Asc.plugin.theme);a.Asc.plugin.tr&&a.Asc.plugin.tr_init||(a.Asc.plugin.tr_init=!0,a.Asc.plugin.tr=function(m){return a.Asc.plugin.translateManager&&a.Asc.plugin.translateManager[m]?a.Asc.plugin.translateManager[m]:m});var p=\"\";a.Asc.plugin.info&&(p=a.Asc.plugin.info.lang);if(\"\"==p||p!=d)if(d=p,\"en-EN\"==d||\"\"==d)h();else{var v=new XMLHttpRequest;v.open(\"GET\",\"./translations/langs.json\");v.onreadystatechange=function(){if(4==v.readyState)if(200==v.status||0==location.href.indexOf(\"file:\"))try{for(var m=JSON.parse(v.responseText),q,t,w=0;w<m.length;w++){var r=m[w];if(r==d){q=r;break}else r.split(\"-\")[0]==d.split(\"-\")[0]&&(t=r)}q||t?f(q||t):h()}catch(u){f(d)}else 404==v.status?f(d):h()};v.send()}switch(k){case \"init\":b();a.Asc.plugin.init(a.Asc.plugin.info.data);break;case \"button\":k=parseInt(g.button);isNaN(k)&&(k=g.button);a.Asc.plugin.button||-1!==k||n!==g.buttonWindowId?a.Asc.plugin.button(k,g.buttonWindowId):a.Asc.plugin.executeCommand(\"close\",\"\");break;case \"enableMouseEvent\":e=g.isEnabled;if(a.Asc.plugin.onEnableMouseEvent)a.Asc.plugin.onEnableMouseEvent(e);break;case \"onExternalMouseUp\":if(a.Asc.plugin.onExternalMouseUp)a.Asc.plugin.onExternalMouseUp();break;case \"onMethodReturn\":a.Asc.plugin.isWaitMethod=!1;if(a.Asc.plugin.methodCallback)k=a.Asc.plugin.methodCallback,a.Asc.plugin.methodCallback=null,k(g.methodReturnData),k=null;else if(a.Asc.plugin.onMethodReturn)a.Asc.plugin.onMethodReturn(g.methodReturnData);a.Asc.plugin.executeMethodStack&&0<a.Asc.plugin.executeMethodStack.length&&(g=a.Asc.plugin.executeMethodStack.shift(),a.Asc.plugin.executeMethod(g.name,g.params,g.callback));break;case \"onCommandCallback\":if(a.Asc.plugin.onCallCommandCallback)k=a.Asc.plugin.onCallCommandCallback,a.Asc.plugin.onCallCommandCallback=null,k(g.commandReturnData),k=null;else if(a.Asc.plugin.onCommandCallback)a.Asc.plugin.onCommandCallback(g.commandReturnData);break;case \"onExternalPluginMessage\":if(a.Asc.plugin.onExternalPluginMessage&&g.data&&g.data.type)a.Asc.plugin.onExternalPluginMessage(g.data);break;case \"onEvent\":if(a.Asc.plugin[\"event_\"+g.eventName])a.Asc.plugin[\"event_\"+g.eventName](g.eventData);else if(a.Asc.plugin.onEvent)a.Asc.plugin.onEvent(g.eventName,g.eventData);break;case \"onWindowEvent\":if(a.Asc.plugin._windows&&g.windowID&&a.Asc.plugin._windows[g.windowID])if(\"private_window_method\"===g.eventName){var x=g.windowID;a.Asc.plugin.executeMethod(g.eventData.name,g.eventData.params,function(m){a.Asc.plugin._windows&&a.Asc.plugin._windows[x]&&a.Asc.plugin._windows[x].command(\"on_private_window_method\",m)})}else\"private_window_command\"===g.eventName?(x=g.windowID,a.Asc.plugin.info.recalculate=!1===g.eventData.isCalc?!1:!0,a.Asc.plugin.executeCommand(\"command\",g.eventData.code,function(m){a.Asc.plugin._windows&&a.Asc.plugin._windows[x]&&a.Asc.plugin._windows[x].command(\"on_private_window_command\",m)})):a.Asc.plugin._windows[g.windowID]._oncommand(g.eventName,g.eventData);break;case \"updateOptions\":if(a.Asc.plugin.onUpdateOptions)a.Asc.plugin.onUpdateOptions()}}};a.onmousemove=function(k){e&&a.Asc.plugin&&a.Asc.plugin.executeCommand&&a.Asc.plugin.executeCommand(\"onmousemove\",JSON.stringify({x:n===k.clientX?k.pageX:k.clientX,y:n===k.clientY?k.pageY:k.clientY}))};a.onmouseup=function(k){e&&a.Asc.plugin&&a.Asc.plugin.executeCommand&&a.Asc.plugin.executeCommand(\"onmouseup\",JSON.stringify({x:n===k.clientX?k.pageX:k.clientX,y:n===k.clientY?k.pageY:k.clientY}))};var l={guid:a.Asc.plugin.guid,type:\"initialize_internal\"};a.Asc.plugin.windowID&&(l.windowID=a.Asc.plugin.windowID);a.plugin_sendMessage(JSON.stringify(l))})(window,void 0);window.startPluginApi=function(){var a=window.Asc.plugin;a._checkPluginOnWindow=function(f){return this.windowID&&!f?(console.log(\"This method does not allow in window frame\"),!0):this.windowID||!0!==f?!1:(console.log(\"This method is allow only in window frame\"),!0)};a._pushWindowMethodCommandCallback=function(f){void 0===this.windowCallbacks&&(this.windowCallbacks=[],this.attachEvent(\"on_private_window_method\",function(h){var b=window.Asc.plugin.windowCallbacks.shift();b&&b(h)}),this.attachEvent(\"on_private_window_command\",function(h){var b=window.Asc.plugin.windowCallbacks.shift();b&&b(h)}));this.windowCallbacks.push(f)};a.executeCommand=function(f,h,b){if(!this._checkPluginOnWindow()||0===f.indexOf(\"onmouse\")){window.Asc.plugin.info.type=f;window.Asc.plugin.info.data=h;f=\"\";try{f=JSON.stringify(window.Asc.plugin.info)}catch(c){f=JSON.stringify({type:h})}window.Asc.plugin.onCallCommandCallback=b;window.plugin_sendMessage(f)}};a.executeMethod=function(f,h,b){if(this.windowID)this._pushWindowMethodCommandCallback(b),this.sendToPlugin(\"private_window_method\",{name:f,params:h});else{if(!0===window.Asc.plugin.isWaitMethod)return void 0===this.executeMethodStack&&(this.executeMethodStack=[]),this.executeMethodStack.push({name:f,params:h,callback:b}),!1;window.Asc.plugin.isWaitMethod=!0;window.Asc.plugin.methodCallback=b;window.Asc.plugin.info.type=\"method\";window.Asc.plugin.info.methodName=f;window.Asc.plugin.info.data=h;f=\"\";try{f=JSON.stringify(window.Asc.plugin.info)}catch(c){return!1}window.plugin_sendMessage(f);return!0}};a.resizeWindow=function(f,h,b,c,e,d){if(!this._checkPluginOnWindow()){void 0===b&&(b=0);void 0===c&&(c=0);void 0===e&&(e=0);void 0===d&&(d=0);f=JSON.stringify({width:f,height:h,minw:b,minh:c,maxw:e,maxh:d});window.Asc.plugin.info.type=\"resize\";window.Asc.plugin.info.data=f;h=\"\";try{h=JSON.stringify(window.Asc.plugin.info)}catch(l){h=JSON.stringify({type:f})}window.plugin_sendMessage(h)}};a.callCommand=function(f,h,b,c){f=\"var Asc = {}; Asc.scope = \"+JSON.stringify(window.Asc.scope)+\"; var scope = Asc.scope; (\"+f.toString()+\")();\";this.windowID?(this._pushWindowMethodCommandCallback(c),this.sendToPlugin(\"private_window_command\",{code:f,isCalc:b})):(window.Asc.plugin.info.recalculate=!1===b?!1:!0,window.Asc.plugin.executeCommand(!0===h?\"close\":\"command\",f,c))};a.callModule=function(f,h,b){if(!this._checkPluginOnWindow()){var c=new XMLHttpRequest;c.open(\"GET\",f);c.onreadystatechange=function(){if(4==c.readyState&&(200==c.status||0==location.href.indexOf(\"file:\"))){var e=!0===b?\"close\":\"command\";window.Asc.plugin.info.recalculate=!0;window.Asc.plugin.executeCommand(e,c.responseText);h&&h(c.responseText)}};c.send()}};a.loadModule=function(f,h){if(!this._checkPluginOnWindow()){var b=new XMLHttpRequest;b.open(\"GET\",f);b.onreadystatechange=function(){4!=b.readyState||200!=b.status&&0!=location.href.indexOf(\"file:\")||h&&h(b.responseText)};b.send()}};let n=!1;try{new Function(\"async function test() {}\"),n=!0}catch(f){n=!1}n&&(eval(\"Asc.plugin.callCommandAsync = function(func) { return new Promise(function(resolve) { Asc.plugin.callCommand(func, false, true, function(retValue) { resolve(retValue); }) }); };\"),eval(\"Asc.plugin.callMethodAsync = function(name, args) { return new Promise(function(resolve) { Asc.plugin.executeMethod(name, args || [], function(retValue) { resolve(retValue); }) }); };\"));a.createInputHelper=function(){this._checkPluginOnWindow()||(window.Asc.plugin.ih=new window.Asc.inputHelper(window.Asc.plugin))};a.getInputHelper=function(){if(!this._checkPluginOnWindow())return window.Asc.plugin.ih};a.sendToPlugin=function(f,h){if(!this._checkPluginOnWindow(!0)){window.Asc.plugin.info.type=\"messageToPlugin\";window.Asc.plugin.info.eventName=f;window.Asc.plugin.info.data=h;window.Asc.plugin.info.windowID=this.windowID;f=\"\";try{f=JSON.stringify(window.Asc.plugin.info)}catch(b){return!1}window.plugin_sendMessage(f);return!0}};a.sendEvent=function(f,h){window.Asc.plugin.executeMethod(\"SendEvent\",[f,h])};a.sendEventInternal=function(f,h){window.Asc.plugin.executeMethod(\"SendEventInternal\",[f,h])}};"/*</code>*/
    }
    sendMessageToFrame(iframeId, msg);
}
/**
 * Initializes internal plugin settings with mock editor data
 * @param {Object} data - Initialization data containing windowID
 */
function initialize_internal(data) {
    const iframeId = data.windowID || iframeMain;
    const msg = {
        "guid": pluginGuid,
        "editorType": "word",
        "mmToPx": 3.7795275590551185,
        "restrictions": 0,
        "data": "",
        "isViewMode": false,
        "isMobileMode": false,
        "isEmbedMode": false,
        "lang": "en-EN",
        "documentId": "__1new__359_.docx1759671306707",
        "documentTitle": "new (359).docx",
        "documentCallbackUrl": "http://localhost/track?filename=new%20(359).docx&useraddress=__1",
        "userId": "uid-1",
        "userName": "John Smith",
        "jwt": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJkb2N1bWVudCI6eyJrZXkiOiJfXzFuZXdfXzM1OV8uZG9jeDE3NTk2NzEzMDY3MDciLCJwZXJtaXNzaW9ucyI6eyJjaGF0Ijp0cnVlLCJjb21tZW50Ijp0cnVlLCJjb3B5Ijp0cnVlLCJkb3dubG9hZCI6dHJ1ZSwiZWRpdCI6dHJ1ZSwiZmlsbEZvcm1zIjp0cnVlLCJtb2RpZnlDb250ZW50Q29udHJvbCI6dHJ1ZSwibW9kaWZ5RmlsdGVyIjp0cnVlLCJwcmludCI6dHJ1ZSwicmV2aWV3Ijp0cnVlLCJyZXZpZXdHcm91cHMiOm51bGwsImNvbW1lbnRHcm91cHMiOnt9LCJ1c2VySW5mb0dyb3VwcyI6bnVsbCwicHJvdGVjdCI6dHJ1ZX0sImRzX2VuY3J5cHRlZCI6ZmFsc2V9LCJlZGl0b3JDb25maWciOnsidXNlciI6eyJpZCI6InVpZC0xIiwibmFtZSI6IkpvaG4gU21pdGgiLCJpbmRleCI6NX0sImRzX2lzQ2xvc2VDb0F1dGhvcmluZyI6ZmFsc2UsImRzX3Nlc3Npb25UaW1lQ29ubmVjdCI6MTc1OTY3MjAxMTI1MH0sImlhdCI6MTc1OTY3MjAxMSwiZXhwIjoxNzYyMjY0MDExfQ.A38MlU5RPm2IggenZsd7I7cC-1d01qu1ZepwsZOUqQo",
        "theme": {
            "Name": "theme-night",
            "Type": "dark",
            "RulersButton": false,
            "NavigationButtons": false,
            "BackgroundColor": "#222222",
            "PageOutline": "#cccccc",
            "RulerDark": "#585858",
            "RulerLight": "#222222",
            "RulerOutline": "#484848",
            "RulerMarkersOutlineColor": "#969696",
            "RulerMarkersOutlineColorOld": "#484848",
            "RulerMarkersFillColor": "#404040",
            "RulerMarkersFillColorOld": "#404040",
            "RulerTextColor": "#969696",
            "RulerTabsColor": "#eaeaea",
            "RulerTabsColorOld": "#666666",
            "RulerTableColor1": "#404040",
            "RulerTableColor2": "#969696",
            "ScrollBackgroundColor": "#222222",
            "ScrollOutlineColor": "#686868",
            "ScrollOutlineHoverColor": "#7f7f7f",
            "ScrollOutlineActiveColor": "#cecece",
            "ScrollerColor": "#404040",
            "ScrollerHoverColor": "#686868",
            "ScrollerActiveColor": "#686868",
            "ScrollArrowColor": "#eaeaea",
            "ScrollArrowHoverColor": "#eaeaea",
            "ScrollArrowActiveColor": "#ffffff",
            "ScrollerTargetColor": "#eaeaea",
            "ScrollerTargetHoverColor": "#eaeaea",
            "ScrollerTargetActiveColor": "#ffffff",
            "STYLE_THUMBNAIL_WIDTH": 104,
            "STYLE_THUMBNAIL_HEIGHT": 40,
            "THEMES_LAYOUT_THUMBNAIL_HEIGHT": 68,
            "isNeedInvertOnActive": false,
            "ContentControlsBack": "#F1F1F1",
            "ContentControlsHover": "#D8DADC",
            "ContentControlsActive": "#7C838A",
            "ContentControlsText": "#444444",
            "ContentControlsTextActive": "#FFFFFF",
            "ContentControlsAnchorActive": "#CFCFCF",
            "FormsContentControlsOutlineHover": "rgba(0, 0, 0, 0.3)",
            "FormsContentControlsOutlineActive": "rgba(0, 0, 0, 0.3)",
            "FormsContentControlsOutlineBorderRadiusHover": 0,
            "FormsContentControlsOutlineBorderRadiusActive": 2,
            "FormsContentControlsMarkersBackground": "#FFFFFF",
            "FormsContentControlsMarkersBackgroundHover": "#E1E1E1",
            "FormsContentControlsMarkersBackgroundActive": "#CCCCCC",
            "FormsContentControlsOutlineMoverHover": "#444444",
            "FormsContentControlsOutlineMoverActive": "#444444",
            "BackgroundColorThumbnails": "#404040",
            "BackgroundColorThumbnailsActive": "#404040",
            "BackgroundColorThumbnailsHover": "#404040",
            "ThumbnailsPageOutlineActive": "#4A87E7",
            "ThumbnailsPageOutlineHover": "#92B7F0",
            "ThumbnailsPageNumberText": "#f3f3f3",
            "ThumbnailsPageNumberTextActive": "#f3f3f3",
            "ThumbnailsPageNumberTextHover": "#f3f3f3",
            "ThumbnailsLockColor": "#D34F4F",
            "BackgroundColorNotes": "#222222",
            "THEMES_THUMBNAIL_WIDTH": 88,
            "THEMES_THUMBNAIL_HEIGHT": 40,
            "BorderSplitterColor": "#585858",
            "SupportNotes": true,
            "SplitterWidthMM": 1,
            "ThumbnailScrollWidthNullIfNoScrolling": false,
            "AnimPaneBackground": "#404040",
            "AnimPaneItemFillSelected": "#606060",
            "AnimPaneItemFillHovered": "#555555",
            "AnimPaneButtonFill": "#555555",
            "AnimPaneButtonFillHovered": "#555555",
            "AnimPaneButtonFillDisabled": "#555555",
            "AnimPanePlayButtonFill": "#ffffff",
            "AnimPanePlayButtonOutline": "#666666",
            "AnimPaneEffectBarFillEntrance": "#77b583",
            "AnimPaneEffectBarOutlineEntrance": "#0e8a26",
            "AnimPaneEffectBarFillEmphasis": "#fbc37c",
            "AnimPaneEffectBarOutlineEmphasis": "#ff8e00",
            "AnimPaneEffectBarFillExit": "#f59a9a",
            "AnimPaneEffectBarOutlineExit": "#f23d3d",
            "AnimPaneEffectBarFillPath": "#a1cee3",
            "AnimPaneEffectBarOutlinePath": "#254662",
            "AnimPaneTimelineRulerOutline": "#616161",
            "AnimPaneTimelineRulerTick": "#505050",
            "AnimPaneText": "#f3f3f3",
            "AnimPaneTextActive": "#f3f3f3",
            "AnimPaneTextHover": "#f3f3f3",
            "AnimPaneTimelineScrollerFill": "#606060",
            "AnimPaneTimelineScrollerOutline": "#ffffff",
            "AnimPaneTimelineScrollerOpacity": 0,
            "AnimPaneTimelineScrollerOpacityHovered": 0.4,
            "AnimPaneTimelineScrollerOpacityActive": 1,
            "DemBackgroundColor": "#404040",
            "DemButtonBackgroundColor": "#404040",
            "DemButtonBackgroundColorHover": "#585858",
            "DemButtonBackgroundColorActive": "#686868",
            "DemButtonBorderColor": "#686868",
            "DemButtonTextColor": "#f3f3f3",
            "DemButtonTextColorActive": "#f9f9f9",
            "DemSplitterColor": "#585858",
            "DemTextColor": "#f3f3f3",
            "Background": "#222222",
            "BackgroundActive": "#585858",
            "BackgroundHighlighted": "#404040",
            "Border": "#686868",
            "BorderActive": "#cecece",
            "BorderHighlighted": "#969696",
            "Color": "#b2b2b2",
            "ColorActive": "#b2b2b2",
            "ColorHighlighted": "#b2b2b2",
            "ColorFiltering": "#6BEC9F",
            "SheetViewCellBackground": "#1B5836",
            "SheetViewCellBackgroundPressed": "#287C4E",
            "SheetViewCellBackgroundHover": "#216A42",
            "SheetViewCellTitleLabel": "#ffffff",
            "ColorDark": "#333",
            "ColorDarkActive": "#333",
            "ColorDarkHighlighted": "#333",
            "ColorDarkFiltering": "#ffffff",
            "GroupDataBorder": "#eaeaea",
            "EditorBorder": "#585858",
            "SelectAllIcon": "#999999",
            "SheetViewSelectAllIcon": "#3D664E",
            "toolbar-header-document": "#222222",
            "toolbar-header-spreadsheet": "#222222",
            "toolbar-header-presentation": "#222222",
            "toolbar-header-pdf": "#222222",
            "toolbar-header-visio": "#222222",
            "text-toolbar-header-on-background-document": "#222222",
            "text-toolbar-header-on-background-spreadsheet": "#222222",
            "text-toolbar-header-on-background-presentation": "#222222",
            "text-toolbar-header-on-background-pdf": "#222222",
            "text-toolbar-header-on-background-visio": "#222222",
            "background-normal": "#404040",
            "background-toolbar": "#404040",
            "background-toolbar-additional": "#404040",
            "background-primary-dialog-button": "#6e9fec",
            "background-notification-popover": "#1F2C5C",
            "background-notification-badge": "#ffd112",
            "background-scrim": "rgba(0, 0, 0, 0.2)",
            "background-loader": "rgba(24, 24, 24, 0.9)",
            "background-accent-button": "#6e9fec",
            "background-contrast-popover": "#404040",
            "shadow-contrast-popover": "rgba(0, 0, 0, 0.3)",
            "highlight-button-hover": "#585858",
            "highlight-button-pressed": "#686868",
            "highlight-button-pressed-hover": "#7f7f7f",
            "highlight-primary-dialog-button-hover": "#4a87e7",
            "highlight-header-button-hover": "#585858",
            "highlight-header-button-pressed": "#686868",
            "highlight-text-select": "#3494fb",
            "highlight-accent-button-hover": "#375478",
            "highlight-accent-button-pressed": "#293f59",
            "highlight-toolbar-tab-underline-document": "#446995",
            "highlight-toolbar-tab-underline-spreadsheet": "#3A8056",
            "highlight-toolbar-tab-underline-presentation": "#B75B44",
            "highlight-toolbar-tab-underline-pdf": "#AA5252",
            "highlight-toolbar-tab-underline-visio": "#444796",
            "highlight-header-tab-underline-document": "#4a87e7",
            "highlight-header-tab-underline-spreadsheet": "#3A8056",
            "highlight-header-tab-underline-presentation": "#B75B44",
            "highlight-header-tab-underline-pdf": "#AA5252",
            "highlight-header-tab-underline-visio": "#444796",
            "border-toolbar": "#585858",
            "border-divider": "#585858",
            "border-regular-control": "#686868",
            "border-toolbar-button-hover": "#eaeaea",
            "border-preview-hover": "#92B7F0",
            "border-preview-select": "#4A87E7",
            "border-control-focus": "#4A87E7",
            "border-color-shading": "#686868",
            "border-error": "#f62211",
            "border-contrast-popover": "#686868",
            "text-normal": "#f3f3f3",
            "text-normal-pressed": "#f9f9f9",
            "text-secondary": "#969696",
            "text-tertiary": "#cecece",
            "text-link": "#92B7F0",
            "text-link-hover": "#B7CFF5",
            "text-link-active": "#B7CFF5",
            "text-link-visited": "#92B7F0",
            "text-inverse": "#fff",
            "text-toolbar-header": "#f3f3f3",
            "text-contrast-background": "#fff",
            "text-alt-key-hint": "rgba(0, 0, 0, 0.8)",
            "icon-normal": "#eaeaea",
            "icon-normal-pressed": "#eaeaea",
            "icon-inverse": "#171717",
            "icon-toolbar-header": "#eaeaea",
            "icon-notification-badge": "#eaeaea",
            "icon-contrast-popover": "#fff",
            "icon-success": "#78b588",
            "canvas-background": "#222222",
            "canvas-content-background": "#fff",
            "canvas-page-border": "#ccc",
            "canvas-ruler-background": "#222",
            "canvas-ruler-border": "#484848",
            "canvas-ruler-margins-background": "#585858",
            "canvas-ruler-mark": "#969696",
            "canvas-ruler-handle-border": "#969696",
            "canvas-ruler-handle-border-disabled": "#484848",
            "canvas-high-contrast": "#eaeaea",
            "canvas-high-contrast-disabled": "#666",
            "canvas-cell-border": "#686868",
            "canvas-cell-title-background": "#222",
            "canvas-cell-title-background-hover": "#404040",
            "canvas-cell-title-background-selected": "#585858",
            "canvas-cell-title-border": "#686868",
            "canvas-cell-title-border-hover": "#969696",
            "canvas-cell-title-border-selected": "#cecece",
            "canvas-cell-title-text": "#b2b2b2",
            "canvas-dark-cell-title": "#666666",
            "canvas-dark-cell-title-hover": "#999",
            "canvas-dark-cell-title-selected": "#333",
            "canvas-dark-cell-title-border": "#3d3d3d",
            "canvas-dark-cell-title-border-hover": "#5c5c5c",
            "canvas-dark-cell-title-border-selected": "#0f0f0f",
            "canvas-dark-content-background": "#3a3a3a",
            "canvas-dark-page-border": "#2a2a2a",
            "canvas-scroll-thumb": "#404040",
            "canvas-scroll-thumb-hover": "#686868",
            "canvas-scroll-thumb-pressed": "#686868",
            "canvas-scroll-thumb-border": "#686868",
            "canvas-scroll-thumb-border-hover": "#7f7f7f",
            "canvas-scroll-thumb-border-pressed": "#cecece",
            "canvas-scroll-arrow": "#eaeaea",
            "canvas-scroll-arrow-hover": "#eaeaea",
            "canvas-scroll-arrow-pressed": "#fff",
            "canvas-scroll-thumb-target": "#eaeaea",
            "canvas-scroll-thumb-target-hover": "#eaeaea",
            "canvas-scroll-thumb-target-pressed": "#fff",
            "canvas-sheet-view-cell-background": "#1B5836",
            "canvas-sheet-view-cell-background-hover": "#216A42",
            "canvas-sheet-view-cell-background-pressed": "#287C4E",
            "canvas-sheet-view-cell-title-label": "#fff",
            "canvas-freeze-line-1px": "#818182",
            "canvas-freeze-line-2px": "#aaaaaa",
            "canvas-select-all-icon": "#999",
            "canvas-anim-pane-background": "#404040",
            "canvas-anim-pane-item-fill-selected": "#606060",
            "canvas-anim-pane-item-fill-hovered": "#555",
            "canvas-anim-pane-button-fill": "#555",
            "canvas-anim-pane-button-fill-hovered": "#555",
            "canvas-anim-pane-button-fill-disabled": "rgba(85, 85, 85, 0.4)",
            "canvas-anim-pane-play-button-fill": "#fff",
            "canvas-anim-pane-play-button-outline": "#666666",
            "canvas-anim-pane-effect-bar-entrance-fill": "#77b583",
            "canvas-anim-pane-effect-bar-entrance-outline": "#0e8a26",
            "canvas-anim-pane-effect-bar-emphasis-fill": "#fbc37c",
            "canvas-anim-pane-effect-bar-emphasis-outline": "#ff8e00",
            "canvas-anim-pane-effect-bar-exit-fill": "#f59a9a",
            "canvas-anim-pane-effect-bar-exit-outline": "#f23d3d",
            "canvas-anim-pane-effect-bar-path-fill": "#a1cee3",
            "canvas-anim-pane-effect-bar-path-outline": "#254662",
            "canvas-anim-pane-timeline-ruler-outline": "#616161",
            "canvas-anim-pane-timeline-ruler-tick": "#505050",
            "canvas-anim-pane-timeline-scroller-fill": "#606060",
            "canvas-anim-pane-timeline-scroller-outline": "rgba(255, 255, 255, 0.8)",
            "canvas-anim-pane-timeline-scroller-opacity": "0",
            "canvas-anim-pane-timeline-scroller-opacity-hovered": "0.4",
            "canvas-anim-pane-timeline-scroller-opacity-active": "1",
            "toolbar-height-controls": "84px",
            "sprite-button-icons-uid": "mod25",
            "type": "dark",
            "name": "theme-night"
        },
        "type": "init",
        "options": {}
    };
    sendMessageToFrame(iframeId, msg);
}

/**
 * Sends method return data to the main iframe
 * @param {*} data - The data to return
 */
function handleMethodReturn(data) {
    const dataReturn = {
        guid: pluginGuid,
        methodReturnData: data,
        type: "onMethodReturn"
    };
    sendMessageToFrame(iframeMain, dataReturn);
}

/**
 * Handles method calls from the plugin
 * @param {Object} data - Method call data containing methodName and data
 */
function handleMethod(data) {
    if (data.methodName === 'AddToolbarMenuItem') {
        handleMethodReturn(undefined);
        settingsButton = data.data;
        AddToolbarMenuItem(settingsButton);
    } else if (data.methodName === 'GetVersion') {
        handleMethodReturn(sdkVersion);
    } else if (data.methodName === 'ShowWindow') {
        ShowWindow(data.data);
        handleMethodReturn(undefined);
    } else if (data.methodName === 'SendToWindow') {
        SendToWindow(data.data);
        handleMethodReturn(undefined);
    } else if (data.methodName === 'CloseWindow') {
        CloseWindow(data.data);
        handleMethodReturn(undefined);
    // } else if (data.methodName === 'SendEvent') {
    //     console.error(data.data);
    //     handleMethodReturn(undefined);
    } else {
        handleMethodReturn(undefined);
    }
}

/**
 * Forwards window events to the plugin
 * @param {Object} data - Event data with windowID, eventName, and data
 */
function sendMessageToPlugin(data) {
    const pluginData = {
        guid: pluginGuid,
        type: "onWindowEvent",
        windowID: data.windowID,
        eventName: data.eventName,
        eventData: data.data
    };
    sendMessageToFrame(iframeMain, pluginData);
}

/**
 * Sends an event to a specific window
 * @param {Array} data - [iframeId, eventName, eventData]
 */
function SendToWindow(data) {
    const iframeId = data[0];
    const eventName = data[1];
    const eventData = data[2];
    const pluginData = {
        guid: pluginGuid,
        type: "onEvent",
        eventName: eventName,
        eventData: eventData
    };
    sendMessageToFrame(iframeId, pluginData);
}

/**
 * Handles toolbar menu item addition
 * @param {Array} val - Menu item configuration
 */
function AddToolbarMenuItem(val) {
    const id = val[0].tabs[0].items[0].id;
    const data = {
        guid: pluginGuid,
        type: "onEvent",
        eventName: "onToolbarMenuClick",
        eventData: id
    };
    sendMessageToFrame(iframeMain, data);
}

/**
 * Handles button click events
 * @param {string|number} id - Button ID
 * @param {string} [windowId] - Optional window ID
 */
function onButtonClick(id, windowId) {
    const pluginData = {
        guid: pluginGuid,
        type: "button",
        button: "" + id
    };
    if (windowId) {
        pluginData.buttonWindowId = "" + windowId;
    }
    sendMessageToFrame(iframeMain, pluginData);
}

/**
 * Shows a plugin window with configured buttons
 * @param {Array} val - [windowId, config] where config contains url, buttons, etc.
 */
function ShowWindow(val) {
    const [iframeId, config] = val;
    const isMain = config.url.includes(mainButtonId);
    
    if (isMain) {
        config.buttons = config.buttons.map((button, index) => ({
            text: 'Save Changes',
            onClick: () => {
                onButtonClick(index, iframeId);
                if (saveCallback) {
                    saveCallback();
                }
                AddToolbarMenuItem(settingsButton);
            },
            disabled: false
        }));
    } else {
        config.buttons = config.buttons.map((button, index) => ({
            text: button.text,
            onClick: () => {
                onButtonClick(index, iframeId);
            },
            disabled: false
        }));
    }
    
    // Use callback if registered
    if (showPluginWindowCallback) {
        showPluginWindowCallback(iframeId, config);
    }
}

/**
 * Closes a plugin window
 * @param {Array} val - [windowId]
 */
function CloseWindow(val) {
    const id = val[0];
    
    // Use callback if registered
    if (closePluginWindowCallback) {
        closePluginWindowCallback(id);
    }
}

/**
 * Initializes AI settings stub with the main iframe ID and SDK version
 * @param {string} iframeId - The ID of the main iframe
 * @param {string} version - The SDK version from statistics data or 'develop' for development
 */
function initAISettings(iframeId, version = 'develop') {
    iframeMain = iframeId;
    sdkVersion = version;
    window.addEventListener('message', receiveMessage);
}

/**
 * Registers callback for showing plugin windows
 * @param {function} callback - Function to call when showing a window (iframeId, config) => void
 */
function registerShowWindowCallback(callback) {
    showPluginWindowCallback = callback;
}

/**
 * Registers callback for closing plugin windows
 * @param {function} callback - Function to call when closing a window (id) => void
 */
function registerCloseWindowCallback(callback) {
    closePluginWindowCallback = callback;
}

/**
 * Registers callback for save button action
 * @param {function} callback - Function to call when save button is clicked () => void
 */
function registerSaveCallback(callback) {
    saveCallback = callback;
}

export { initAISettings, registerShowWindowCallback, registerCloseWindowCallback, registerSaveCallback };