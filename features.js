// features.js — 23指標の計算エンジン

const Features = (() => {

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

  // ── YIN 基本周波数検出 ──

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

    let tau = 2;
    while (tau < halfLen) {
      if (yinBuf[tau] < YIN_THRESHOLD) {
        while (tau + 1 < halfLen && yinBuf[tau + 1] < yinBuf[tau]) tau++;
        break;
      }
      tau++;
    }

    if (tau >= halfLen || yinBuf[tau] >= YIN_THRESHOLD) return -1;

    if (tau > 0 && tau < halfLen - 1) {
      const s0 = yinBuf[tau - 1], s1 = yinBuf[tau], s2 = yinBuf[tau + 1];
      const denom = 2 * (2 * s1 - s2 - s0);
      if (denom !== 0) return sr / (tau + (s2 - s0) / denom);
    }
    return sr / tau;
  }

  // ── RMS ──

  function computeRMS(timeDomain) {
    let sum = 0;
    for (let i = 0; i < timeDomain.length; i++) {
      sum += timeDomain[i] * timeDomain[i];
    }
    const rms = Math.sqrt(sum / timeDomain.length);
    return rms > 0 ? 20 * Math.log10(rms) : -100;
  }

  // ── 倍音振幅取得 ──

  function getHarmonics(f0, freqDB, sr, fftSize, maxH) {
    if (f0 <= 0) return [];
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
    return amps;
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
    const n = mag.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    let count = 0;
    for (let i = 1; i < n; i++) {
      const f = binToFreq(i, sr, fftSize);
      if (f < 100 || f > 10000) continue;
      const y = mag[i] > 0 ? 20 * Math.log10(mag[i]) : -100;
      sumX += f;
      sumY += y;
      sumXY += f * y;
      sumXX += f * f;
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

  // ── 5. Spectral Irregularity ──

  function spectralIrregularity(f0, freqDB, sr, fftSize) {
    const amps = getHarmonics(f0, freqDB, sr, fftSize);
    if (amps.length < 2) return 0;
    let diffSum = 0, ampSum = 0;
    for (let i = 0; i < amps.length - 1; i++) {
      diffSum += Math.abs(amps[i] - amps[i + 1]);
      ampSum += amps[i];
    }
    ampSum += amps[amps.length - 1];
    return ampSum === 0 ? 0 : diffSum / ampSum;
  }

  // ── 6. Spectral Flux（前フレームとの差分） ──

  let prevMag = null;

  function spectralFlux(freqDB) {
    const mag = dbToLinear(freqDB);
    if (!prevMag) {
      prevMag = new Float32Array(mag);
      return 0;
    }
    let flux = 0;
    for (let i = 0; i < mag.length; i++) {
      const d = mag[i] - prevMag[i];
      flux += d * d;
    }
    prevMag.set(mag);
    return Math.sqrt(flux / mag.length);
  }

  function resetFlux() {
    prevMag = null;
  }

  // ── 7-9. Tristimulus T1/T2/T3 ──

  function tristimulus(f0, freqDB, sr, fftSize) {
    if (f0 <= 0) return { t1: 0, t2: 0, t3: 0 };
    const amps = getHarmonics(f0, freqDB, sr, fftSize);
    if (amps.length === 0) return { t1: 0, t2: 0, t3: 0 };
    const total = amps.reduce((s, a) => s + a, 0);
    if (total === 0) return { t1: 0, t2: 0, t3: 0 };

    const t1 = amps[0] / total;
    let t2 = 0;
    for (let i = 1; i < Math.min(4, amps.length); i++) t2 += amps[i];
    t2 /= total;
    let t3 = 0;
    for (let i = 4; i < amps.length; i++) t3 += amps[i];
    t3 /= total;

    return { t1, t2, t3 };
  }

  // ── 10. Odd/Even Ratio ──

  function oddEvenRatio(f0, freqDB, sr, fftSize) {
    if (f0 <= 0) return 0;
    const amps = getHarmonics(f0, freqDB, sr, fftSize);
    if (amps.length < 3) return 0;
    let odd = 0, even = 0;
    for (let i = 0; i < amps.length; i++) {
      if ((i + 1) % 2 === 1) odd += amps[i] * amps[i];
      else even += amps[i] * amps[i];
    }
    return even === 0 ? 0 : Math.sqrt(odd / even);
  }

  // ── 11. Harmonic-to-Noise Ratio (HNR) ──

  function harmonicToNoise(f0, freqDB, sr, fftSize) {
    if (f0 <= 0) return 0;
    const mag = dbToLinear(freqDB);
    const binW = sr / fftSize;
    const radius = Math.max(1, Math.ceil(f0 / binW / 4));
    const nyquist = sr / 2;

    let harmonicE = 0, totalE = 0;
    for (let i = 1; i < mag.length; i++) {
      totalE += mag[i] * mag[i];
    }

    for (let h = 1; h <= 20; h++) {
      const hf = f0 * h;
      if (hf >= nyquist) break;
      const center = freqToBin(hf, sr, fftSize);
      const lo = Math.max(0, center - radius);
      const hi = Math.min(mag.length - 1, center + radius);
      for (let b = lo; b <= hi; b++) {
        harmonicE += mag[b] * mag[b];
      }
    }

    const noiseE = totalE - harmonicE;
    if (noiseE <= 0) return 40;
    return 10 * Math.log10(harmonicE / noiseE);
  }

  // ── 12. Harmonic Slope（倍音振幅の回帰傾き） ──

  function harmonicSlope(f0, freqDB, sr, fftSize) {
    const amps = getHarmonics(f0, freqDB, sr, fftSize);
    if (amps.length < 3) return 0;

    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    let n = 0;
    for (let i = 0; i < amps.length; i++) {
      if (amps[i] <= 0) continue;
      const x = i + 1;
      const y = 20 * Math.log10(amps[i]);
      sumX += x; sumY += y; sumXY += x * y; sumXX += x * x;
      n++;
    }
    if (n < 2) return 0;
    return (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  }

  // ── 13-16. Dünnwald帯域 ──

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
        e += mag[i] * mag[i];
        c++;
      }
      if (totalRms > 0 && c > 0) {
        result[name] = 20 * Math.log10(Math.sqrt(e / c) / totalRms + 1e-10);
      } else {
        result[name] = -60;
      }
    }
    return result;
  }

  // ── 17. RMS Energy (dB) ──
  // → computeRMS() 上で定義済み

  // ── 18. F0 ──
  // → detectF0() 上で定義済み

  // ── 19-20. Stability（ローリングSD） ──

  class RollingStats {
    constructor(windowSize) {
      this.win = windowSize || 30;
      this.buf = [];
    }
    push(val) {
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
      if (this.buf.length === 0) return 0;
      return this.buf.reduce((s, v) => s + v, 0) / this.buf.length;
    }
    reset() {
      this.buf = [];
    }
  }

  const f0Stats = new RollingStats(30);
  const scStats = new RollingStats(30);

  // ── 21. Attack Time ──

  let attackState = { tracking: false, startTime: 0, threshold: -40 };
  let lastRMS = -100;
  let lastAttackTime = 0;

  function detectAttack(rmsDB, now) {
    const silenceThreshold = -50;
    const soundThreshold = -30;

    if (lastRMS < silenceThreshold && rmsDB > silenceThreshold) {
      attackState.tracking = true;
      attackState.startTime = now;
    }

    if (attackState.tracking && rmsDB > soundThreshold) {
      lastAttackTime = now - attackState.startTime;
      attackState.tracking = false;
    }

    lastRMS = rmsDB;
    return lastAttackTime;
  }

  // ── 22-23. Vibrato検出 ──

  const vibratoF0Buf = [];
  const VIBRATO_WINDOW = 60; // ~2秒分 @ 30fps

  function detectVibrato(f0) {
    if (f0 <= 0) return { rate: 0, depth: 0 };

    vibratoF0Buf.push(f0);
    if (vibratoF0Buf.length > VIBRATO_WINDOW) vibratoF0Buf.shift();
    if (vibratoF0Buf.length < 15) return { rate: 0, depth: 0 };

    // F0の平均を引いてAC成分だけにする
    const mean = vibratoF0Buf.reduce((s, v) => s + v, 0) / vibratoF0Buf.length;
    const centered = vibratoF0Buf.map(v => v - mean);

    // ゼロクロッシングでレート推定
    let crossings = 0;
    for (let i = 1; i < centered.length; i++) {
      if ((centered[i - 1] < 0 && centered[i] >= 0) ||
          (centered[i - 1] >= 0 && centered[i] < 0)) {
        crossings++;
      }
    }
    const durationSec = vibratoF0Buf.length / 30; // 30fps想定
    const rate = crossings / 2 / durationSec;

    // 深さ: cents単位
    let maxF0 = -Infinity, minF0 = Infinity;
    for (const v of vibratoF0Buf) {
      if (v > maxF0) maxF0 = v;
      if (v < minF0) minF0 = v;
    }
    const depth = mean > 0 ? 1200 * Math.log2(maxF0 / minF0) : 0;

    // ビブラート範囲内（4-8Hz）でなければ0とみなす
    if (rate < 3.5 || rate > 9) return { rate: 0, depth: 0 };

    return { rate: Math.round(rate * 10) / 10, depth: Math.round(depth * 10) / 10 };
  }

  // ── 全指標一括計算 ──

  function computeAll(buffers, now) {
    const { frequency, timeDomain, sampleRate: sr, fftSize } = buffers;

    const rmsDB = computeRMS(timeDomain);
    if (rmsDB < -55) return null; // 無音

    const f0 = detectF0(timeDomain, sr);
    const sc = spectralCentroid(frequency, sr, fftSize);

    // Stability用バッファに追加
    if (f0 > 0) f0Stats.push(f0);
    scStats.push(sc);

    const ss = spectralSpread(frequency, sr, fftSize, sc);
    const slope = spectralSlope(frequency, sr, fftSize);
    const sfm = spectralFlatness(frequency);
    const si = spectralIrregularity(f0, frequency, sr, fftSize);
    const flux = spectralFlux(frequency);

    const tri = tristimulus(f0, frequency, sr, fftSize);
    const oer = oddEvenRatio(f0, frequency, sr, fftSize);
    const hnr = harmonicToNoise(f0, frequency, sr, fftSize);
    const hSlope = harmonicSlope(f0, frequency, sr, fftSize);

    const dw = dunnwaldBands(frequency, sr, fftSize);

    const attack = detectAttack(rmsDB, now);
    const vib = detectVibrato(f0);

    // F0 stability in cents
    const f0SD = f0Stats.sd();
    const f0Mean = f0Stats.mean();
    const f0StabilityCents = f0Mean > 0 ? 1200 * Math.log2((f0Mean + f0SD) / f0Mean) : 0;

    return {
      spectralCentroid: Math.round(sc * 10) / 10,
      spectralSpread: Math.round(ss * 10) / 10,
      spectralSlope: Math.round(slope * 1000000) / 1000000,
      sfm: Math.round(sfm * 1000) / 1000,
      spectralIrregularity: Math.round(si * 1000) / 1000,
      spectralFlux: Math.round(flux * 10000) / 10000,

      t1: Math.round(tri.t1 * 1000) / 1000,
      t2: Math.round(tri.t2 * 1000) / 1000,
      t3: Math.round(tri.t3 * 1000) / 1000,
      oddEvenRatio: Math.round(oer * 100) / 100,
      hnr: Math.round(hnr * 10) / 10,
      harmonicSlope: Math.round(hSlope * 100) / 100,

      richness: Math.round(dw.richness * 10) / 10,
      nasality: Math.round(dw.nasality * 10) / 10,
      brilliance: Math.round(dw.brilliance * 10) / 10,
      harshness: Math.round(dw.harshness * 10) / 10,

      rms: Math.round(rmsDB * 10) / 10,
      f0: f0 > 0 ? Math.round(f0 * 10) / 10 : 0,
      f0Stability: Math.round(f0StabilityCents * 10) / 10,
      scStability: Math.round(scStats.sd() * 10) / 10,
      attackTime: Math.round(attack * 10) / 10,
      vibratoRate: vib.rate,
      vibratoDepth: vib.depth,
    };
  }

  function resetState() {
    prevMag = null;
    f0Stats.reset();
    scStats.reset();
    vibratoF0Buf.length = 0;
    lastRMS = -100;
    lastAttackTime = 0;
    attackState = { tracking: false, startTime: 0, threshold: -40 };
  }

  return { computeAll, resetState, computeRMS, detectF0 };
})();
