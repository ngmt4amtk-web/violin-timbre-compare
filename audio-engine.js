// audio-engine.js — Web Audio API管理 v3 (AudioWorklet)

const AudioEngine = (() => {
  let audioCtx = null;
  let workletNode = null;
  let source = null;
  let stream = null;
  let frameCallback = null;

  const FFT_SIZE = 4096;
  const HOP_SIZE = 512;

  let sampleRate = 48000;

  async function init() {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    sampleRate = audioCtx.sampleRate;

    // AudioWorkletを読み込み
    await audioCtx.audioWorklet.addModule('worklet-processor.js');

    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      }
    });

    source = audioCtx.createMediaStreamSource(stream);

    workletNode = new AudioWorkletNode(audioCtx, 'timbre-processor', {
      processorOptions: {
        bufferSize: FFT_SIZE,
        hopSize: HOP_SIZE,
      }
    });

    // FFT初期化（Hann窓）
    FFTLib.init(FFT_SIZE);

    // Workletからのバッファ受信 → メインスレッドでFFT計算
    workletNode.port.onmessage = (e) => {
      const { timeDomain: buf, time, frame, seq } = e.data;
      const timeDomain = new Float32Array(buf);
      const frequency = FFTLib.computeSpectrum(timeDomain);

      if (frameCallback) {
        frameCallback({
          frequency,
          timeDomain,
          sampleRate,
          fftSize: FFT_SIZE,
          hopSize: HOP_SIZE,
          time,
          frame,
          seq,
        });
      }
    };

    source.connect(workletNode);

    // WorkletNodeをオーディオグラフに接続（無音出力でprocess()を維持）
    const silentGain = audioCtx.createGain();
    silentGain.gain.value = 0;
    workletNode.connect(silentGain);
    silentGain.connect(audioCtx.destination);

    return { sampleRate, fftSize: FFT_SIZE, hopSize: HOP_SIZE };
  }

  function onFrame(cb) {
    frameCallback = cb;
  }

  function getSampleRate() { return sampleRate; }
  function getFftSize() { return FFT_SIZE; }
  function getHopSize() { return HOP_SIZE; }

  function stop() {
    frameCallback = null;
    if (workletNode) {
      workletNode.port.onmessage = null;
      workletNode.disconnect();
      workletNode = null;
    }
    if (source) {
      source.disconnect();
      source = null;
    }
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
    if (audioCtx) {
      audioCtx.close();
      audioCtx = null;
    }
  }

  return { init, onFrame, getSampleRate, getFftSize, getHopSize, stop };
})();
