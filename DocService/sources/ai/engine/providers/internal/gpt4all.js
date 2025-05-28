"use strict";

class Provider extends AI.Provider {

	constructor() {
		super("GPT4All", "http://localhost:4891", "", "v1");
	}

	getRequestBodyOptions() {
		return {
			max_tokens : 4096
		};
	}

	isOnlyDesktop() {
		return true;
	}

}
