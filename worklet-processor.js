// worklet-processor.js — AudioWorkletProcessor
// オーディオスレッドで動作、固定間隔でバッファを送信

class TimbreProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = options.processorOptions || {};
    this.bufferSize = opts.bufferSize || 4096;
    this.hopSize = opts.hopSize || 512;
    this.ringBuffer = new Float32Array(this.bufferSize);
    this.writePos = 0;
    this.hopCount = 0;
    this.seq = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const channelData = input[0]; // mono, 128 samples

    // リングバッファに書き込み
    for (let i = 0; i < channelData.length; i++) {
      this.ringBuffer[(this.writePos + i) % this.bufferSize] = channelData[i];
    }
    this.writePos = (this.writePos + channelData.length) % this.bufferSize;
    this.hopCount += channelData.length;

    // ホップサイズごとにバッファを送信
    if (this.hopCount >= this.hopSize) {
      this.hopCount -= this.hopSize;

      // リングバッファから時系列順に抽出
      const ordered = new Float32Array(this.bufferSize);
      for (let i = 0; i < this.bufferSize; i++) {
        ordered[i] = this.ringBuffer[(this.writePos + i) % this.bufferSize];
      }

      const buf = ordered.buffer;
      this.port.postMessage({
        timeDomain: buf,
        time: currentTime,
        frame: currentFrame,
        seq: this.seq++,
      }, [buf]);
    }

    return true;
  }
}

registerProcessor('timbre-processor', TimbreProcessor);
