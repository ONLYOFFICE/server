(function(exports, undefined)
{
	exports.AI = exports.AI || {};
	var AI = exports.AI;
	AI.UI = AI.UI || {};
	AI.Storage = AI.Storage || {};
	AI.Storage.Version = 3;

	AI.isLocalDesktop = (function(){
		if (window.navigator && window.navigator.userAgent.toLowerCase().indexOf("ascdesktopeditor") < 0)
			return false;
		if (window.location && window.location.protocol == "file:")
			return true;
		if (window.document && window.document.currentScript && 0 == window.document.currentScript.src.indexOf("file:///"))
			return true;
		return false;
	})();

	AI.isLocalUrl = function(url) {
		let filter = ["localhost", "127.0.0.1"];
		for (let i = 0, len = filter.length; i < len; i++) {
			let pos = url.indexOf(filter[i]);
			if (pos >= 0 && pos < 10)
				return true;
		}
		return false;
	};

	AI.getDesktopLocalVersion = function() {
		let ret = 99 * 1000000 + 99 * 1000 + 99;
		if (!AI.isLocalDesktop)
			return ret;
		let pos = window.navigator.userAgent.indexOf("AscDesktopEditor/");
		let pos2 = window.navigator.userAgent.indexOf(" ", pos);
		if (pos === -1 || pos2 === -1)
			return ret;
		try {
			let tokens = window.navigator.userAgent.substring(pos + 17, pos2).split(".");
			return parseInt(tokens[0]) * 1000000 + parseInt(tokens[1]) * 1000 + parseInt(tokens[2]);
		} catch (e) {			
		}

		return ret;
	};

	AI.loadResourceAsText = async function(url) {
		return new Promise(resolve => (function(){
			try {
				var xhr = new XMLHttpRequest();
				if (xhr) {
					xhr.open('GET', url, true);
					xhr.onload = function () {
						var status = xhr.status;
						if (status == 200 || location.href.indexOf("file:") == 0) {
							resolve(xhr.responseText);
						} else {
							resolve("");
						}
					};
					xhr.onerror = function() {
						resolve("");
					}
					xhr.send('');
				}
			} catch (e) {
				resolve("");
			}
		})());
	};	

})(window);
