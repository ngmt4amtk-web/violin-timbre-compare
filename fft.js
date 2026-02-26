// fft.js — Radix-2 FFT + Hann窓 + スペクトル計算

const FFTLib = (() => {
  let hannWindow = null;
  let fftSize = 0;

  function init(size) {
    fftSize = size;
    hannWindow = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      hannWindow[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (size - 1)));
    }
  }

  // Cooley-Tukey radix-2 FFT (in-place)
  function fft(real, imag) {
    const n = real.length;

    // Bit-reversal permutation
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      while (j & bit) { j ^= bit; bit >>= 1; }
      j ^= bit;
      if (i < j) {
        let tmp = real[i]; real[i] = real[j]; real[j] = tmp;
        tmp = imag[i]; imag[i] = imag[j]; imag[j] = tmp;
      }
    }

    // Butterfly
    for (let len = 2; len <= n; len *= 2) {
      const halfLen = len >> 1;
      const angle = -2 * Math.PI / len;
      const wR = Math.cos(angle);
      const wI = Math.sin(angle);

      for (let i = 0; i < n; i += len) {
        let cR = 1, cI = 0;
        for (let j = 0; j < halfLen; j++) {
          const aIdx = i + j;
          const bIdx = aIdx + halfLen;
          const tR = real[bIdx] * cR - imag[bIdx] * cI;
          const tI = real[bIdx] * cI + imag[bIdx] * cR;
          real[bIdx] = real[aIdx] - tR;
          imag[bIdx] = imag[aIdx] - tI;
          real[aIdx] += tR;
          imag[aIdx] += tI;
          const newCR = cR * wR - cI * wI;
          cI = cR * wI + cI * wR;
          cR = newCR;
        }
      }
    }
  }

  // 時間領域信号 → dBスペクトル (Hann窓適用)
  function computeSpectrum(timeDomain) {
    const n = fftSize;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);

    // Hann窓適用
    for (let i = 0; i < n; i++) {
      real[i] = timeDomain[i] * hannWindow[i];
      imag[i] = 0;
    }

    fft(real, imag);

    // 振幅スペクトル (dB) — N/2 + 1 bins
    const numBins = (n >> 1) + 1;
    const magnitudeDB = new Float32Array(numBins);
    const scale = 2.0 / n; // 振幅の正規化

    for (let i = 0; i < numBins; i++) {
      const mag = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]) * scale;
      magnitudeDB[i] = mag > 1e-10 ? 20 * Math.log10(mag) : -100;
    }

    return magnitudeDB;
  }

  return { init, computeSpectrum };
})();
