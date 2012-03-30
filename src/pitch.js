PitchAnalyzer = this.PitchAnalyzer = (function () {

var	pi2	= Math.PI * 2,
	sin	= Math.sin,
	cos	= Math.cos,
	pow	= Math.pow,
	log	= Math.log,
	max	= Math.max,
	min	= Math.min,
	abs	= Math.abs,
	LN10	= Math.LN10,
	sqrt	= Math.sqrt,
	atan	= Math.atan,
	atan2	= Math.atan2,
	inf	= 1/0,
	FFT_P	= 10,
	FFT_N	= 1 << FFT_P;

function round (val) {
	return ~~(val + (val >= 0 ? 0.5 : -0.5));
}

function remainder (val, div) {
	return val - round(val/div) * div;
}

function cabs (b, i) {
	return sqrt(b[i] * b[i] + b[i+1] * b[i+1]);
}

function carg (b, i) {
	return atan2(b[i+1], b[i]);
}

function square (n) {
	return n * n;
}

function log10 (n) {
	return log(n) / LN10;
}

function extend (obj) {
	var	args	= arguments,
		l	= args.length,
		i, n;

	for (i=1; i<l; i++){
		for (n in args[i]){
			if (args[i].hasOwnProperty(n)){
				obj[n] = args[i][n];
			}
		}
	}

	return obj;
}

function Tone () {
	this.harmonics = new Float32Array(Tone.MAX_HARM);
}

Tone.prototype = {
	freq: 0.0,
	db: -inf,
	stabledb: -inf,
	age: 0,

	harmonics: null
};

Tone.MIN_AGE = 2;
Tone.MAX_HARM = 48;

function Peak (freq, db) {
	this.freq = typeof freq === 'undefined' ? this.freq : freq;
	this.db = typeof db === 'undefined' ? this.db : db;

	this.harm = new Array(Tone.MAX_HARM);
}

Peak.prototype = {
	harm: null,

	freq: 0.0,
	db: -inf,

	clear: function () {
		this.freq	= Peak.prototype.freq;
		this.db		= Peak.prototype.db;
	},
};

Peak.match = function (peaks, pos) {
	var best = pos;

	if (peaks[pos - 1].db > peaks[best].db) best = pos - 1;
	if (peaks[pos + 1].db > peaks[best].db) best = pos + 1;

	return peaks[pos];
};

function Analyzer (options) {
	options = extend(this, options);

	this.data = new Float32Array(FFT_N);
	this.fftLastPhase = new Float32Array(FFT_N);
	this.wnd = Analyzer.calculateWindow();
	this.tones = [];
}

Analyzer.prototype = {
	wnd: null,
	data: null,
	fft: null,
	FFT: null,
	tones: null,
	fftLastPhase: null,

	offset: 0,

	MIN_FREQ: 50,
	MAX_FREQ: 5000,

	sampleRate: 44100,
	step: 200,
	lastPhase: FFT_N / 2,
	oldFreq: null,

	peak: 0.0,

	getPeak: function () {
		return 10.0 * log10(this.peak);
	},

	findTone: function (minFreq, maxFreq) {
		if (!this.tones.length) {
			this.oldFreq = 0.0;
			return null;
		}

		minFreq = typeof minFreq === 'undefined' ? 65.0 : minFreq;
		maxFreq = typeof maxFreq === 'undefined' ? 1000.0 : maxFreq;

		var db = max.apply(null, this.tones.map(Analyzer.mapdb));
		var best = null;
		var bestscore = 0;

		for (var i=0; i<this.tones.length; i++) {
			if (this.tones[i].db < db - 20.0 || this.tones[i].freq < minFreq || this.tones[i].age < Tone.MIN_AGE) continue;
			if (this.tones[i].freq > maxfreq) break;

			var score = this.tones[i].db - max(180.0, abs(this.tones[i].freq - 300)) / 10.0;

			if (this.oldFreq !== 0.0 && abs(this.tones[i].freq / this.oldFreq - 1.0) < 0.05) score += 10.0;
			if (best && bestscore > score) break;

			best = this.tones[i];
			bestscore = score;
		}

		this.oldFreq = (best ? best.freq : 0.0);
		return best;
	},

	process: function (data) {
		var	o	= this.offset,
			buf	= this.data,
			l;

		while (true) {
			l = ((data.length % buf.length) - o) || data.length;

			for (var i=0; i<l; i++) {
				var s = data[i];
				var p = s * s;

				if (p > this.peak) this.peak = p; else this.peak *= 0.999;

				buf[o + i] = s;
			}

			o = (o + i) % buf.length;

			if (data.length < buf.length) break;

			data = data.subarray(i);

			this.calcFFT();
			this.calcTones();
		}

		this.offset = o;
	},

	mergeWithOld: function (tones) {
		var i, n;

		tones.sort(function (a, b) { return a.freq > b.freq ? 1 : a.freq < b.freq ? -1 : 0; });

		for (i=0; i<this.tones.length; i++) {
			while (n < tones.length && tones[n].freq < this.tones[i].freq) n++;

			if (n < tones.length && tones[n].freq === this.tones[i]) {
				tones[n].age = this.tones[i].age + 1;
				tones[n].stabledb = 0.8 * this.tones[i].stabledb + 0.2 * tones[n].db;
				tones[n].freq = 0.5 * (this.tones[i].freq + tones[n].freq);
			} else if (this.tones[i].db > -80.0) {
				var t = new Tone(this.tones[i].db, this.tones[i].freq);
				t.freq = this.tones[i].freq;
				t.db = this.tones[i].db - 5.0;
				t.stabledb = this.tones[i].stabledb - 0.1;
				tones.push(t);
			}

		}
	},

	calcTones: function () {
		var	tones		= this.tones,
			freqPerBin	= this.sampleRate / FFT_N,
			phaseStep	= pi2 * this.step / FFT_N,
			normCoeff	= 1.0 / FFT_N,
			minMagnitude	= pow(10, -100.0 / 20.0) / normCoeff,
			kMin		= ~~max(1, this.MIN_FREQ / freqPerBin),
			kMax		= ~~min(FFT_N / 2, this.MAX_FREQ / freqPerBin),
			peaks		= [],
			k, magnitude, phase, delta, freq, prevdb, db;

		for (k=0; k < kMax + 1; k++) {
			peaks.push(new Peak);
		}

		for (k=1; k<=kMax; k++) {
			magnitude = cabs(this.fft, k*2);
			phase = carg(this.fft, k*2);

			delta = phase - this.fftLastPhase[k];
			this.fftLastPhase[k] = phase;

			delta -= k * phaseStep;
			delta = remainder(delta, pi2);
			delta /= phaseStep;

			freq = (k + delta) * freqPerBin;

			if (freq > 1.0 && magnitude > minMagnitude) {
				peaks[k].freq = freq;
				peaks[k].db = 20.0 * log10(normCoeff * magnitude);
			}
		}

		prevdb = peaks[0];

		for (k=1; k<kMax; k++) {
			db = peaks[k].db;
			if (db > prevdb) peaks[k - 1].clear();
			if (db < prevdb) peaks[k].clear();
			prevdb = db;
		}

		var tones = [];

		for (k=kMax-1; k >= kMin; k--) {
			if (peaks[k].db < -70.0) continue;

			var bestDiv = 1;
			var bestScore = 0;

			for (var div = 2; div <= Tone.MAX_HARM && k / div > 1; div++) {
				var freq = peaks[k].freq / div;
				var score = 0;
				for (var n=1; n<div && n<8; n++) {
					var p = Peak.match(peaks, ~~(k * n / div));
					score--;
					if (p.db < -90.0 || abs(p.freq / n / freq - 1.0) > .03) continue;
					if (n === 1) score += 4;
					score += 2;
				}
				if (score > bestScore) {
					bestScore = score;
					bestDiv = div;
				}
			}

			var t = new Tone;

			var count = 0;

			var freq = peaks[k].freq / bestDiv;

			t.db = peaks[k].db;

			for (var n=1; n<=bestDiv; n++) {
				var p = Peak.match(peaks, ~~(k * n / bestDiv));

				if (abs(p.freq / n / freq - 1.0) > .03) continue;

				if (p.db > t.db - 10.0) {
					t.db = max(t.db, p.db);
					count++;
					t.freq += p.freq / n;
				}
				t.harmonics[n - 1] = p.db;
				p.clear();
			}

			t.freq /= count;

			if (t.db > -50.0 - 3.0 * count) {
				t.stabledb = t.db;
				tones.push(t);
			}
		}

		this.mergeWithOld(tones);
		this.tones = tones;

	},

	calcFFT: function () {
		this.fft = Analyzer.fft(this.data, this.wnd, FFT_P);
	},
};

Analyzer.mapdb = function (e) {
	return e.db;
};

Analyzer.Tone = Tone;

Analyzer.calculateWindow = function () {
	var i, w = new Float32Array(FFT_N);

	for (i=0; i<FFT_N; i++) {
		w[i] = 0.53836 - 0.46164 * cos(pi2 * i / (FFT_N - 1));
	}

	return w;
};

Analyzer.fft = function (inData, wnd, P) { //return;
	var N = 1 << P;
	var data = new Float32Array(N<<1);
	var M = N / 2;
	var m = M;

	for (var i=0, j=0; i<N; i++, m=M) {
		data[j*2] = inData[i] * wnd[i];
		while (m > 1 && m <= j) { j -= m; m >>= 1; }
		j += m;
	}

	Analyzer.DanielsonLanczos(data, FFT_P);

	return data;
};

Analyzer.DanielsonLanczos = function (data, P) { if (!P) return;
	var N = 1 << P;
	var M = N / 2;

	Analyzer.DanielsonLanczos(data, P - 1);
	Analyzer.DanielsonLanczos(data.subarray(M * 2, P - 1), P - 1);

	var wp_r = -2.0 * square(sin(pi2 / N));
	var wp_i = -sin(pi2 * 2 / N);

	var w_r = 1.0;
	var w_i = 0.0;

	for (var i=0; i<M; i++) {
		var n = 2 * (i + M);

		var temp_r = data[n + 0] * w_r - data[n + 1] * w_i;
		var temp_i = data[n + 0] * w_i + data[n + 1] * w_r;

		data[n + 0] = data[i * 2 + 0] - temp_r;
		data[n + 1] = data[i * 2 + 1] - temp_i;

		data[i * 2 + 0] += temp_r;
		data[i * 2 + 1] += temp_r;

		var ww_r = w_r * wp_r - w_i * wp_i;
		var ww_i = w_r * wp_i + w_i * wp_r;

		w_r += ww_r;
		w_i += ww_i;
	}
};

return Analyzer;

}());

if (typeof module !== 'undefined') {
	module.exports = PitchAnalyzer;
}
