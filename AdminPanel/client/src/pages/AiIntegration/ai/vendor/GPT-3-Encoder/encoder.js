	// This file includes code which was modified from https://github.com/openai/gpt-2

	let encoder; // = JSON.parse(fs.readFileSync(path.join(__dirname, './encoder.json')));
	let bpe_file; // = fs.readFileSync(path.join(__dirname, './vocabulary.bpe'), 'utf-8');
	const pat = /'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu;
	const cache = new Map;
	let decoder = {};
	let byte_decoder = {};
	let bpe_merges;
	let byte_encoder;
	let bpe_ranks;
	const vocUrl = './vendor/GPT-3-Encoder/vocabulary.bpe';
	const encUrl = './vendor/GPT-3-Encoder/encoder.json';


	fetchResources(vocUrl);
	fetchResources(encUrl);

	function fetchResources(url) {
		let flag = url.includes('vocabulary.bpe');
		fetch(url, {
			method: 'GET'
		})
		.then(function(response) {
			return flag ? response.text() : response.json();
		})
		.then(function(data) {
			if (flag) {
				bpe_file = data;
			} else {
				encoder = data;
			}
		})
		.catch(function(error) {
			console.error('Error:', error);
		}).finally(function(){
			init();
		});
	};

	const range = (x, y) => {
		const res = Array.from(Array(y).keys()).slice(x);
		return res;
	};

	const ord = x => {
		return x.charCodeAt(0);
	};

	const chr = x => {
		return String.fromCharCode(x);
	};

	const textEncoder = new TextEncoder("utf-8");
	const encodeStr = str => {
		return Array.from(textEncoder.encode(str)).map(x => x.toString());
	};

	const textDecoder = new TextDecoder("utf-8")
	const decodeStr = arr => {
		return textDecoder.decode(new Uint8Array(arr));
	};

	const dictZip = (x, y) => {
		const result = {};
		x.map((_, i) => { result[x[i]] = y[i] });
		return result;
	};

	function bytes_to_unicode() {
		const bs = range(ord('!'), ord('~') + 1).concat(range(ord('¡'), ord('¬') + 1), range(ord('®'), ord('ÿ') + 1));

		let cs = bs.slice();
		let n = 0;
		for (let b = 0; b < 2 ** 8; b++) {
			if (!bs.includes(b)) {
				bs.push(b);
				cs.push(2 ** 8 + n);
				n = n + 1;
			}
		}

		cs = cs.map(x => chr(x));

		const result = {};
		bs.map((_, i) => { result[bs[i]] = cs[i] });
		return result;
	};

	function get_pairs(word) {
		const pairs = new Set();
		let prev_char = word[0];
		for (let i = 1; i < word.length; i++) {
			const char = word[i];
			pairs.add([prev_char, char]);
			prev_char = char;
		}
		return pairs;
	};


	function init() {

		if (encoder === undefined || bpe_file === undefined)
			return;

		Object.keys(encoder).map(x => { decoder[encoder[x]] = x });

		let lines = bpe_file.split('\n');

		// bpe_merges = [tuple(merge_str.split()) for merge_str in bpe_data.split("\n")[1:-1]]
		bpe_merges = lines.slice(1, lines.length - 1).map(x => {
			return x.split(/(\s+)/).filter(function(e) { return e.trim().length > 0 });
		})

		byte_encoder = bytes_to_unicode();
		Object.keys(byte_encoder).map(x => { byte_decoder[byte_encoder[x]] = x });

		bpe_ranks = dictZip(bpe_merges, range(0, bpe_merges.length));
	};
	

	function bpe(token) {
		if (cache.has(token)) {
			return cache.get(token);
		}

		let word = token.split('');

		let pairs = get_pairs(word);

		if (!pairs) {
			return token;
		}

		while (true) {
			const minPairs = {};
			Array.from(pairs).map(pair => {
				const rank = bpe_ranks[pair];
				minPairs[(isNaN(rank) ? 10e10 : rank)] = pair;
			})



			const bigram = minPairs[Math.min(...Object.keys(minPairs).map(x => {
				return parseInt(x);
			}))]

			if (!(bigram in bpe_ranks)) {
				break;
			}

			const first = bigram[0];
			const second = bigram[1];
			let new_word = [];
			let i = 0;

			while (i < word.length) {
				const j = word.indexOf(first, i);
				if (j === -1) {
					new_word = new_word.concat(word.slice(i));
					break;
				}
				new_word = new_word.concat(word.slice(i, j));
				i = j;

				if (word[i] === first && i < word.length - 1 && word[i + 1] === second) {
					new_word.push(first + second);
					i = i + 2;
				} else {
					new_word.push(word[i]);
					i = i + 1;
				}
			}

			word = new_word;
			if (word.length === 1) {
				break;
			} else {
				pairs = get_pairs(word);
			}
		}

		word = word.join(' ');
		cache.set(token, word);

		return word;
	};

	function encode(text) {
		let bpe_tokens = [];
		const matches = Array.from(text.matchAll(pat)).map(x => x[0]);
		for (let token of matches) {
			token = encodeStr(token).map(x => {
				return byte_encoder[x];
			}).join('');
			
			const new_tokens = bpe(token).split(' ').map(x => encoder[x]);
			bpe_tokens = bpe_tokens.concat(new_tokens);
		}
		return bpe_tokens;
	};

	function decode(tokens) {
		let text = tokens.map(x => decoder[x]).join('');
		text = decodeStr(text.split('').map(x => byte_decoder[x]));
		return text;
	};

	window.Asc.OpenAIEncode = encode;
	window.Asc.OpenAIDecode = decode;