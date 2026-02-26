// audio-engine.js — Web Audio API管理

const AudioEngine = (() => {
  let audioCtx = null;
  let analyser = null;
  let source = null;
  let stream = null;

  const FFT_SIZE = 4096;
  const SMOOTHING = 0.3;

  let frequencyBuf = null;
  let timeDomainBuf = null;
  let sampleRate = 44100;

  async function init() {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    sampleRate = audioCtx.sampleRate;

    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      }
    });

    source = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = SMOOTHING;

    source.connect(analyser);

    frequencyBuf = new Float32Array(analyser.frequencyBinCount);
    timeDomainBuf = new Float32Array(analyser.fftSize);

    return { sampleRate, fftSize: FFT_SIZE };
  }

  function getBuffers() {
    if (!analyser) return null;
    analyser.getFloatFrequencyData(frequencyBuf);
    analyser.getFloatTimeDomainData(timeDomainBuf);
    return {
      frequency: frequencyBuf,
      timeDomain: timeDomainBuf,
      sampleRate,
      fftSize: FFT_SIZE,
    };
  }

  function getSampleRate() {
    return sampleRate;
  }

  function getFftSize() {
    return FFT_SIZE;
  }

  function stop() {
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
    }
    if (audioCtx) {
      audioCtx.close();
    }
    audioCtx = null;
    analyser = null;
    source = null;
    stream = null;
  }

  return { init, getBuffers, getSampleRate, getFftSize, stop };
})();
