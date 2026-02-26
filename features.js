// features.js — 音響特徴量計算エンジン v3
// 34指標 + onset検出 + configurable FPS

const Features = (() => {

  // ── 設定 ──

  let effectiveFPS = 93.75; // default: 48000/512

  function configure(sampleRate, hopSize) {
    effectiveFPS = sampleRate / hopSize;
    // ローリング統計を時間ベース（~0.5秒）に更新
    const statsWindow = Math.max(10, Math.round(effectiveFPS * 0.5));
    f0Stats.setWindow(statsWindow);
    scStats.setWindow(statsWindow);
  }

  // ── ユーティリティ ──

  function dbToLinear(dbArray) {
    const out = new Float32Array(dbArray.length);
    for (let i = 0; i < out.length; i++) {
      out[i] = Math.pow(10, dbArray[i] / 20);
    }
    return out;
  }

  function binToFreq(bin, sr, fftSize) {
    return bin * sr / fftSize;
  }

  function freqToBin(freq, sr, fftSize) {
    return Math.round(freq * fftSize / sr);
  }

  // ── YIN 基本周波数検出（信頼度付き） ──

  const YIN_THRESHOLD = 0.15;

  function detectF0(buf, sr) {
    const halfLen = Math.floor(buf.length / 2);
    const yinBuf = new Float32Array(halfLen);

    for (let tau = 0; tau < halfLen; tau++) {
      yinBuf[tau] = 0;
      for (let i = 0; i < halfLen; i++) {
        const d = buf[i] - buf[i + tau];
        yinBuf[tau] += d * d;
      }
    }

    yinBuf[0] = 1;
    let runSum = 0;
    for (let tau = 1; tau < halfLen; tau++) {
      runSum += yinBuf[tau];
      yinBuf[tau] = yinBuf[tau] * tau / runSum;
    }

    // 最小CMNDF値を追跡（信頼度の基盤）
    let minCMNDF = 1;
    let minTau = -1;

    let tau = 2;
    while (tau < halfLen) {
      if (yinBuf[tau] < YIN_THRESHOLD) {
        while (tau + 1 < halfLen && yinBuf[tau + 1] < yinBuf[tau]) tau++;
        break;
      }
      if (yinBuf[tau] < minCMNDF) {
        minCMNDF = yinBuf[tau];
        minTau = tau;
      }
      tau++;
    }

    if (tau >= halfLen || yinBuf[tau] >= YIN_THRESHOLD) {
      // 検出失敗: 最小CMNDF値から信頼度を推定
      return { freq: null, confidence: Math.max(0, 1 - minCMNDF) };
    }

    const cmndVal = yinBuf[tau];

    // Parabolic interpolation
    let betterTau = tau;
    if (tau > 0 && tau < halfLen - 1) {
      const s0 = yinBuf[tau - 1], s1 = yinBuf[tau], s2 = yinBuf[tau + 1];
      const denom = 2 * (2 * s1 - s2 - s0);
      if (denom !== 0) betterTau = tau + (s2 - s0) / denom;
    }

    const freq = sr / betterTau;
    // バイオリン範囲外は棄却
    if (freq < 180 || freq > 4800) {
      return { freq: null, confidence: Math.max(0, 1 - cmndVal) * 0.3 };
    }

    return { freq, confidence: Math.max(0, 1 - cmndVal) };
  }

  // ── RMS (dBFS) ──

  function computeRMS(timeDomain) {
    let sum = 0;
    for (let i = 0; i < timeDomain.length; i++) {
      sum += timeDomain[i] * timeDomain[i];
    }
    const rms = Math.sqrt(sum / timeDomain.length);
    return rms > 0 ? 20 * Math.log10(rms) : -100;
  }

  // ── 倍音振幅取得（1回だけ計算、全倍音依存指標で共有） ──

  function getHarmonics(f0, freqDB, sr, fftSize, maxH) {
    if (f0 === null || f0 <= 0) return null;
    maxH = maxH || 20;
    const mag = dbToLinear(freqDB);
    const nyquist = sr / 2;
    const binW = sr / fftSize;
    const radius = Math.max(2, Math.ceil(f0 / binW / 2));
    const amps = [];

    for (let h = 1; h <= maxH; h++) {
      const hf = f0 * h;
      if (hf >= nyquist) break;
      const center = freqToBin(hf, sr, fftSize);
      let peak = 0;
      const lo = Math.max(0, center - radius);
      const hi = Math.min(mag.length - 1, center + radius);
      for (let b = lo; b <= hi; b++) {
        if (mag[b] > peak) peak = mag[b];
      }
      amps.push(peak);
    }
    return amps.length >= 2 ? amps : null;
  }

  // ── 1. Spectral Centroid ──

  function spectralCentroid(freqDB, sr, fftSize) {
    const mag = dbToLinear(freqDB);
    let wSum = 0, mSum = 0;
    for (let i = 1; i < mag.length; i++) {
      const f = binToFreq(i, sr, fftSize);
      wSum += f * mag[i];
      mSum += mag[i];
    }
    return mSum === 0 ? 0 : wSum / mSum;
  }

  // ── 2. Spectral Spread ──

  function spectralSpread(freqDB, sr, fftSize, sc) {
    const mag = dbToLinear(freqDB);
    let wSum = 0, mSum = 0;
    for (let i = 1; i < mag.length; i++) {
      const f = binToFreq(i, sr, fftSize);
      const d = f - sc;
      wSum += d * d * mag[i];
      mSum += mag[i];
    }
    return mSum === 0 ? 0 : Math.sqrt(wSum / mSum);
  }

  // ── 3. Spectral Slope ──

  function spectralSlope(freqDB, sr, fftSize) {
    const mag = dbToLinear(freqDB);
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0, count = 0;
    for (let i = 1; i < mag.length; i++) {
      const f = binToFreq(i, sr, fftSize);
      if (f < 100 || f > 10000) continue;
      const y = mag[i] > 0 ? 20 * Math.log10(mag[i]) : -100;
      sumX += f; sumY += y; sumXY += f * y; sumXX += f * f;
      count++;
    }
    if (count < 2) return 0;
    return (count * sumXY - sumX * sumY) / (count * sumXX - sumX * sumX);
  }

  // ── 4. Spectral Flatness (SFM) ──

  function spectralFlatness(freqDB) {
    const mag = dbToLinear(freqDB);
    let logSum = 0, linSum = 0, cnt = 0;
    for (let i = 1; i < mag.length; i++) {
      const m = Math.max(mag[i], 1e-10);
      logSum += Math.log(m);
      linSum += m;
      cnt++;
    }
    if (cnt === 0 || linSum === 0) return 0;
    return Math.min(1, Math.exp(logSum / cnt) / (linSum / cnt));
  }

  // ── 5. Spectral Irregularity（倍音依存） ──

  function spectralIrregularity(harmonics) {
    if (!harmonics || harmonics.length < 2) return null;
    let diffSum = 0, ampSum = 0;
    for (let i = 0; i < harmonics.length - 1; i++) {
      diffSum += Math.abs(harmonics[i] - harmonics[i + 1]);
      ampSum += harmonics[i];
    }
    ampSum += harmonics[harmonics.length - 1];
    return ampSum === 0 ? null : diffSum / ampSum;
  }

  // ── 6. Spectral Flux（dBドメイン） ──

  let prevFreqDB = null;

  function spectralFlux(freqDB) {
    if (!prevFreqDB) {
      prevFreqDB = new Float32Array(freqDB);
      return 0;
    }
    let flux = 0;
    for (let i = 0; i < freqDB.length; i++) {
      const d = freqDB[i] - prevFreqDB[i];
      flux += d * d;
    }
    prevFreqDB.set(freqDB);
    return Math.sqrt(flux / freqDB.length); // dB単位
  }

  // ── 7. Spectral Rolloff (85%, 95%) ──

  function spectralRolloff(freqDB, sr, fftSize, pct) {
    const mag = dbToLinear(freqDB);
    let totalE = 0;
    for (let i = 1; i < mag.length; i++) totalE += mag[i] * mag[i];
    if (totalE === 0) return 0;

    const threshold = totalE * pct;
    let cumE = 0;
    for (let i = 1; i < mag.length; i++) {
      cumE += mag[i] * mag[i];
      if (cumE >= threshold) return binToFreq(i, sr, fftSize);
    }
    return sr / 2;
  }

  // ── 8-10. Tristimulus T1/T2/T3（倍音依存） ──

  function tristimulus(harmonics) {
    if (!harmonics) return { t1: null, t2: null, t3: null };
    const total = harmonics.reduce((s, a) => s + a, 0);
    if (total === 0) return { t1: null, t2: null, t3: null };

    const t1 = harmonics[0] / total;
    let t2 = 0;
    for (let i = 1; i < Math.min(4, harmonics.length); i++) t2 += harmonics[i];
    t2 /= total;
    let t3 = 0;
    for (let i = 4; i < harmonics.length; i++) t3 += harmonics[i];
    t3 /= total;

    return { t1, t2, t3 };
  }

  // ── 11. Odd/Even Ratio（倍音依存） ──

  function oddEvenRatio(harmonics) {
    if (!harmonics || harmonics.length < 3) return null;
    let odd = 0, even = 0;
    for (let i = 0; i < harmonics.length; i++) {
      if ((i + 1) % 2 === 1) odd += harmonics[i] * harmonics[i];
      else even += harmonics[i] * harmonics[i];
    }
    return even === 0 ? null : Math.sqrt(odd / even);
  }

  // ── 12. HNR（倍音依存） ──

  function harmonicToNoise(f0, freqDB, sr, fftSize) {
    if (f0 === null || f0 <= 0) return null;
    const mag = dbToLinear(freqDB);
    const binW = sr / fftSize;
    const radius = Math.max(1, Math.ceil(f0 / binW / 4));
    const nyquist = sr / 2;

    let harmonicE = 0, totalE = 0;
    for (let i = 1; i < mag.length; i++) totalE += mag[i] * mag[i];

    for (let h = 1; h <= 20; h++) {
      const hf = f0 * h;
      if (hf >= nyquist) break;
      const center = freqToBin(hf, sr, fftSize);
      const lo = Math.max(0, center - radius);
      const hi = Math.min(mag.length - 1, center + radius);
      for (let b = lo; b <= hi; b++) harmonicE += mag[b] * mag[b];
    }

    const noiseE = totalE - harmonicE;
    if (noiseE <= 0) return 40;
    return 10 * Math.log10(harmonicE / noiseE);
  }

  // ── 13. Harmonic Slope（倍音依存） ──

  function harmonicSlope(harmonics) {
    if (!harmonics || harmonics.length < 3) return null;
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0, n = 0;
    for (let i = 0; i < harmonics.length; i++) {
      if (harmonics[i] <= 0) continue;
      const x = i + 1;
      const y = 20 * Math.log10(harmonics[i]);
      sumX += x; sumY += y; sumXY += x * y; sumXX += x * x;
      n++;
    }
    if (n < 2) return null;
    return (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  }

  // ── 14. Aperiodicity（倍音帯域外エネルギー比） ──

  function aperiodicity(f0, freqDB, sr, fftSize) {
    if (f0 === null || f0 <= 0) return null;
    const mag = dbToLinear(freqDB);
    const binW = sr / fftSize;
    const radius = Math.max(1, Math.ceil(f0 / binW / 4));
    const nyquist = sr / 2;

    let harmonicE = 0, totalE = 0;
    for (let i = 1; i < mag.length; i++) totalE += mag[i] * mag[i];
    if (totalE === 0) return null;

    for (let h = 1; h <= 20; h++) {
      const hf = f0 * h;
      if (hf >= nyquist) break;
      const center = freqToBin(hf, sr, fftSize);
      const lo = Math.max(0, center - radius);
      const hi = Math.min(mag.length - 1, center + radius);
      for (let b = lo; b <= hi; b++) harmonicE += mag[b] * mag[b];
    }

    return (totalE - harmonicE) / totalE;
  }

  // ── 15. 個別倍音振幅 h1-h8 (dBFS) ──

  function individualHarmonics(harmonics) {
    const result = {};
    for (let i = 0; i < 8; i++) {
      const key = `h${i + 1}`;
      if (harmonics && i < harmonics.length && harmonics[i] > 0) {
        result[key] = 20 * Math.log10(harmonics[i]);
      } else {
        result[key] = null;
      }
    }
    return result;
  }

  // ── 16-19. Dünnwald帯域 ──

  const DUNNWALD_BANDS = {
    richness:   { low: 190, high: 650 },
    nasality:   { low: 650, high: 1300 },
    brilliance: { low: 1300, high: 4200 },
    harshness:  { low: 4200, high: 6400 },
  };

  function dunnwaldBands(freqDB, sr, fftSize) {
    const mag = dbToLinear(freqDB);
    let totalE = 0, totalN = 0;
    for (let i = 1; i < mag.length; i++) {
      totalE += mag[i] * mag[i];
      totalN++;
    }
    const totalRms = totalN > 0 ? Math.sqrt(totalE / totalN) : 0;
    const result = {};

    for (const [name, range] of Object.entries(DUNNWALD_BANDS)) {
      const lo = freqToBin(range.low, sr, fftSize);
      const hi = freqToBin(range.high, sr, fftSize);
      let e = 0, c = 0;
      for (let i = lo; i <= Math.min(hi, mag.length - 1); i++) {
        e += mag[i] * mag[i]; c++;
      }
      if (totalRms > 0 && c > 0) {
        result[name] = 20 * Math.log10(Math.sqrt(e / c) / totalRms + 1e-10);
      } else {
        result[name] = -60;
      }
    }
    return result;
  }

  // ── 20. Low Frequency Ratio (< 100Hz) ──

  function lowFreqRatio(freqDB, sr, fftSize) {
    const mag = dbToLinear(freqDB);
    let lowE = 0, totalE = 0;
    const cutoffBin = freqToBin(100, sr, fftSize);
    for (let i = 1; i < mag.length; i++) {
      const e = mag[i] * mag[i];
      totalE += e;
      if (i <= cutoffBin) lowE += e;
    }
    return totalE === 0 ? 0 : lowE / totalE;
  }

  // ── Stability（ローリングSD） ──

  class RollingStats {
    constructor(windowSize) {
      this.win = windowSize || 30;
      this.buf = [];
    }
    setWindow(size) {
      this.win = size;
      while (this.buf.length > this.win) this.buf.shift();
    }
    push(val) {
      if (val === null) return;
      this.buf.push(val);
      if (this.buf.length > this.win) this.buf.shift();
    }
    sd() {
      if (this.buf.length < 2) return 0;
      const mean = this.buf.reduce((s, v) => s + v, 0) / this.buf.length;
      let ss = 0;
      for (const v of this.buf) ss += (v - mean) * (v - mean);
      return Math.sqrt(ss / this.buf.length);
    }
    mean() {
      return this.buf.length === 0 ? 0 : this.buf.reduce((s, v) => s + v, 0) / this.buf.length;
    }
    reset() { this.buf = []; }
  }

  const f0Stats = new RollingStats(47); // ~0.5s at 94fps
  const scStats = new RollingStats(47);

  // ── Onset Detection ──

  class OnsetDetector {
    constructor() {
      this.onsets = [];
      this.state = 'silent';
      this.riseStart = 0;
      this.peakRMS = -100;
      this.lastOnsetTime = null;
    }

    process(rmsDB, timestamp) {
      const SILENCE = -50;
      const SOUND = -35;

      switch (this.state) {
        case 'silent':
          if (rmsDB > SILENCE) {
            this.state = 'rising';
            this.riseStart = timestamp;
            this.peakRMS = rmsDB;
          }
          break;
        case 'rising':
          if (rmsDB > this.peakRMS) this.peakRMS = rmsDB;
          if (rmsDB >= SOUND) {
            const riseTime = timestamp - this.riseStart;
            this.onsets.push({ time: this.riseStart, riseTime: Math.round(riseTime * 10) / 10 });
            this.lastOnsetTime = this.riseStart;
            this.state = 'sustain';
          }
          if (rmsDB < SILENCE) this.state = 'silent';
          break;
        case 'sustain':
          if (rmsDB < SILENCE) this.state = 'silent';
          break;
      }

      return this.lastOnsetTime !== null ? timestamp - this.lastOnsetTime : null;
    }

    getOnsets() { return this.onsets; }
    reset() {
      this.onsets = [];
      this.state = 'silent';
      this.lastOnsetTime = null;
      this.peakRMS = -100;
    }
  }

  const onsetDetector = new OnsetDetector();

  // ── Vibrato検出（閾値カットなし、自己相関ベース） ──

  // ── 全指標一括計算 ──

  function computeAll(buffers, now) {
    const { frequency, timeDomain, sampleRate: sr, fftSize } = buffers;

    const rmsDB = computeRMS(timeDomain);
    if (rmsDB < -55) return null; // 無音

    // F0検出（信頼度付き）
    const f0Result = detectF0(timeDomain, sr);
    const f0 = f0Result.freq; // null or Hz
    const f0Conf = f0Result.confidence;

    // 倍音を1回だけ計算
    const harmonics = getHarmonics(f0, frequency, sr, fftSize, 20);

    // スペクトル形状
    const sc = spectralCentroid(frequency, sr, fftSize);
    scStats.push(sc);
    if (f0 !== null) f0Stats.push(f0);

    const ss = spectralSpread(frequency, sr, fftSize, sc);
    const slope = spectralSlope(frequency, sr, fftSize);
    const sfm = spectralFlatness(frequency);
    const si = spectralIrregularity(harmonics);
    const flux = spectralFlux(frequency);
    const ro85 = spectralRolloff(frequency, sr, fftSize, 0.85);
    const ro95 = spectralRolloff(frequency, sr, fftSize, 0.95);

    // 倍音構造
    const tri = tristimulus(harmonics);
    const oer = oddEvenRatio(harmonics);
    const hnr = harmonicToNoise(f0, frequency, sr, fftSize);
    const hSlope = harmonicSlope(harmonics);
    const aper = aperiodicity(f0, frequency, sr, fftSize);
    const hIndiv = individualHarmonics(harmonics);

    // 周波数帯域
    const dw = dunnwaldBands(frequency, sr, fftSize);
    const lfr = lowFreqRatio(frequency, sr, fftSize);

    // 時間・発音
    const timeSinceOnset = onsetDetector.process(rmsDB, now);

    // F0 stability (cents SD)
    const f0SD = f0Stats.sd();
    const f0Mean = f0Stats.mean();
    const f0StabCents = (f0Mean > 0 && f0 !== null)
      ? 1200 * Math.log2((f0Mean + f0SD) / f0Mean)
      : null;

    return {
      spectralCentroid: sc,
      spectralSpread: ss,
      spectralSlope: slope,
      sfm,
      spectralIrregularity: si,
      spectralFlux: flux,
      spectralRolloff85: ro85,
      spectralRolloff95: ro95,

      t1: tri.t1,
      t2: tri.t2,
      t3: tri.t3,
      oddEvenRatio: oer,
      hnr,
      harmonicSlope: hSlope,
      aperiodicity: aper,

      h1: hIndiv.h1, h2: hIndiv.h2, h3: hIndiv.h3, h4: hIndiv.h4,
      h5: hIndiv.h5, h6: hIndiv.h6, h7: hIndiv.h7, h8: hIndiv.h8,

      richness: dw.richness,
      nasality: dw.nasality,
      brilliance: dw.brilliance,
      harshness: dw.harshness,
      lowFreqRatio: lfr,

      rms: rmsDB,
      f0,
      f0Confidence: f0Conf,
      f0Stability: f0StabCents,
      scStability: scStats.sd(),
      timeSinceOnset,
    };
  }

  function getOnsets() {
    return onsetDetector.getOnsets();
  }

  function resetState() {
    prevFreqDB = null;
    f0Stats.reset();
    scStats.reset();
    onsetDetector.reset();
  }

  return { configure, computeAll, resetState, getOnsets, computeRMS, detectF0 };
})();
