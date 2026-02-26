// app.js — メインアプリケーション制御 v3 (AudioWorklet)

(() => {
  'use strict';

  const FORMAT_VERSION = '3.0';

  // ── 状態 ──
  let currentMode = 'realtime';
  let isRunning = false;
  let reference = null;
  let audioParams = null; // { sampleRate, fftSize, hopSize }

  // データモード
  let dataRecording = false;
  let dataFrames = [];
  let dataStartTimeAudio = 0;
  let dataTotalReceived = 0;
  let dataDroppedFrames = 0;
  let dataExpectedSeq = -1;

  // 基準録音
  let refRecording = false;
  let refFrames = [];
  let refStartTime = 0;
  const REF_DURATION = 3000;

  // UI throttle
  let pendingMetrics = null;
  let uiRafId = null;

  const $ = id => document.getElementById(id);

  // ── 初期化 ──

  function init() {
    buildMetricsUI();
    bindEvents();
  }

  function buildMetricsUI() {
    const container = $('metrics-container');
    const categories = {};

    for (const m of METRICS) {
      if (!categories[m.category]) categories[m.category] = [];
      categories[m.category].push(m);
    }

    for (const [cat, metrics] of Object.entries(categories)) {
      const section = document.createElement('div');
      section.className = 'category-section';

      const header = document.createElement('div');
      header.className = 'category-header';
      header.textContent = CATEGORY_LABELS[cat];
      section.appendChild(header);

      for (const m of metrics) {
        const row = document.createElement('div');
        row.className = 'metric-row';
        row.id = `row-${m.key}`;
        row.innerHTML = `
          <div class="metric-top">
            <span class="metric-label">${m.label}</span>
            <div class="metric-bar-wrap">
              <div class="metric-bar" id="bar-${m.key}"></div>
              <div class="metric-bar ref-marker" id="ref-${m.key}" style="display:none"></div>
            </div>
            <span class="metric-value" id="val-${m.key}">—</span>
          </div>
          <div class="metric-bottom">
            <span class="metric-ref" id="refval-${m.key}"></span>
            <span class="metric-diff" id="diff-${m.key}"></span>
            <span class="metric-factor">${m.factor}</span>
          </div>
        `;
        section.appendChild(row);
      }
      container.appendChild(section);
    }
  }

  function bindEvents() {
    $('btn-start').addEventListener('click', startAudio);
    for (const tab of document.querySelectorAll('.tab')) {
      tab.addEventListener('click', () => switchMode(tab.dataset.mode));
    }
    $('btn-record-ref').addEventListener('click', startRefRecording);
    $('btn-clear-ref').addEventListener('click', clearReference);
    $('btn-data-record').addEventListener('click', startDataRecording);
    $('btn-data-stop').addEventListener('click', stopDataRecording);
    $('btn-export-simple').addEventListener('click', () => exportData(false));
    $('btn-export-detail').addEventListener('click', () => exportData(true));
    $('btn-data-new').addEventListener('click', resetDataMode);
  }

  async function startAudio() {
    try {
      audioParams = await AudioEngine.init();
      Features.configure(audioParams.sampleRate, audioParams.hopSize);
      isRunning = true;

      $('screen-start').classList.remove('active');
      $('screen-realtime').classList.add('active');
      $('header').style.display = '';

      // Workletフレームコールバック登録
      AudioEngine.onFrame(handleFrame);
    } catch (e) {
      alert('マイクへのアクセスが必要です: ' + e.message);
    }
  }

  function switchMode(mode) {
    currentMode = mode;
    for (const tab of document.querySelectorAll('.tab')) {
      tab.classList.toggle('active', tab.dataset.mode === mode);
    }
    $('screen-realtime').classList.toggle('active', mode === 'realtime');
    $('screen-data').classList.toggle('active', mode === 'data');
  }

  // ── Workletフレームハンドラ（~94fps） ──

  function handleFrame(buffers) {
    if (!isRunning) return;

    const audioTimeMs = buffers.time * 1000;
    const metrics = Features.computeAll(buffers, audioTimeMs);

    // ドロップフレーム検出（seq gap）
    if (dataRecording && buffers.seq !== undefined) {
      dataTotalReceived++;
      if (dataExpectedSeq >= 0 && buffers.seq > dataExpectedSeq) {
        dataDroppedFrames += (buffers.seq - dataExpectedSeq);
      }
      dataExpectedSeq = buffers.seq + 1;
    }

    // データ収集（フルレート）
    if (currentMode === 'data' && dataRecording && metrics) {
      dataFrames.push({
        timestamp: audioTimeMs,
        metrics: { ...metrics },
        seq: buffers.seq,
      });
    }

    // 基準録音収集
    if (currentMode === 'realtime' && refRecording && metrics) {
      refFrames.push({ ...metrics });
    }

    // UI更新（rAFでデバウンス → ディスプレイレート上限）
    pendingMetrics = metrics;
    if (!uiRafId) {
      uiRafId = requestAnimationFrame(() => {
        uiRafId = null;
        if (currentMode === 'realtime') {
          updateRealtimeUI(pendingMetrics);
          if (refRecording) updateRefProgress();
        }
        if (currentMode === 'data' && dataRecording) {
          updateDataTimer();
        }
      });
    }
  }

  // ── リアルタイムモード UI更新 ──

  function updateRealtimeUI(metrics) {
    if (!metrics) {
      for (const m of METRICS) {
        const valEl = $(`val-${m.key}`);
        if (valEl) valEl.style.opacity = '0.3';
      }
      return;
    }

    for (const m of METRICS) {
      const val = metrics[m.key];
      const valEl = $(`val-${m.key}`);
      const barEl = $(`bar-${m.key}`);
      const refEl = $(`ref-${m.key}`);
      const refValEl = $(`refval-${m.key}`);
      const diffEl = $(`diff-${m.key}`);
      const rowEl = $(`row-${m.key}`);

      // null値の処理
      if (val === null) {
        valEl.textContent = '—';
        valEl.style.opacity = '0.3';
        barEl.style.width = '0%';
        diffEl.textContent = '';
        rowEl.className = 'metric-row';
        continue;
      }

      valEl.textContent = m.display(val);
      valEl.style.opacity = '1';

      // バー
      const [lo, hi] = m.range;
      const pct = Math.max(0, Math.min(100, ((val - lo) / (hi - lo)) * 100));
      barEl.style.width = pct + '%';

      // 基準との比較
      if (reference) {
        const refVal = reference.metrics[m.key];
        if (refVal !== null && refVal !== undefined) {
          const refPct = Math.max(0, Math.min(100, ((refVal - lo) / (hi - lo)) * 100));
          refEl.style.display = '';
          refEl.style.left = refPct + '%';
          refValEl.textContent = `基準: ${m.display(refVal)}`;

          const diff = val - refVal;
          const absDiff = Math.abs(diff);
          const rangeDiff = hi - lo;

          if (rangeDiff > 0 && absDiff < rangeDiff * 0.02) {
            diffEl.textContent = '≈';
            diffEl.className = 'metric-diff match';
            rowEl.className = 'metric-row highlight-green';
          } else {
            const arrow = diff > 0 ? '△' : '▽';
            diffEl.textContent = `${arrow}${m.display(absDiff)}`;
            diffEl.className = 'metric-diff ' + (diff > 0 ? 'up' : 'down');

            const pctDiff = rangeDiff > 0 ? (absDiff / rangeDiff) * 100 : 0;
            if (pctDiff > 30) {
              rowEl.className = 'metric-row highlight-red';
            } else if (pctDiff > 15) {
              rowEl.className = 'metric-row highlight-orange';
            } else {
              rowEl.className = 'metric-row';
            }
          }
        } else {
          refEl.style.display = 'none';
          refValEl.textContent = '';
          diffEl.textContent = '';
          rowEl.className = 'metric-row';
        }
      } else {
        refEl.style.display = 'none';
        refValEl.textContent = '';
        diffEl.textContent = '';
        rowEl.className = 'metric-row';
      }
    }

    if (reference) updateTop3(metrics);
  }

  function updateTop3(metrics) {
    const diffs = [];
    for (const m of METRICS) {
      const cur = metrics[m.key];
      const ref = reference.metrics[m.key];
      if (cur === null || ref === null || ref === undefined) continue;
      const [lo, hi] = m.range;
      const rangeDiff = hi - lo;
      if (rangeDiff === 0) continue;
      const normDiff = Math.abs(cur - ref) / rangeDiff;
      const rawDiff = cur - ref;
      diffs.push({ metric: m, normDiff, rawDiff });
    }

    diffs.sort((a, b) => b.normDiff - a.normDiff);
    const top3 = diffs.slice(0, 3);

    const panel = $('top3-panel');
    const list = $('top3-list');

    if (top3.length === 0 || top3[0].normDiff < 0.02) {
      panel.style.display = 'none';
      return;
    }

    panel.style.display = '';
    list.innerHTML = '';

    top3.forEach((d, i) => {
      const dir = d.rawDiff > 0 ? 'up' : 'down';
      const tip = d.metric.tip[dir] || '';
      const arrow = d.rawDiff > 0 ? '△' : '▽';
      const pct = Math.round(d.normDiff * 100);

      const item = document.createElement('div');
      item.className = 'top3-item';
      item.innerHTML = `
        <span class="top3-rank">${i + 1}.</span>
        <span class="top3-name">${d.metric.label}</span>
        <span class="top3-diff">${arrow}${pct}%</span>
        <span class="top3-tip">${tip ? '→ ' + tip : ''}</span>
      `;
      list.appendChild(item);
    });
  }

  // ── 基準録音 ──

  function startRefRecording() {
    if (refRecording) return;
    refRecording = true;
    refFrames = [];
    refStartTime = performance.now();
    Features.resetState();

    $('btn-record-ref').textContent = '録音中…';
    $('btn-record-ref').classList.add('recording');
    $('ref-progress').style.display = '';
    $('ref-progress-bar').style.width = '0%';

    setTimeout(finishRefRecording, REF_DURATION);
  }

  function updateRefProgress() {
    const elapsed = performance.now() - refStartTime;
    const pct = Math.min(100, (elapsed / REF_DURATION) * 100);
    $('ref-progress-bar').style.width = pct + '%';
    const remaining = Math.max(0, Math.ceil((REF_DURATION - elapsed) / 1000));
    $('ref-countdown').textContent = remaining;
  }

  function finishRefRecording() {
    refRecording = false;
    $('btn-record-ref').textContent = '基準を録る';
    $('btn-record-ref').classList.remove('recording');
    $('ref-progress').style.display = 'none';

    if (refFrames.length < 5) {
      $('ref-label').textContent = '基準: 録音失敗（音が小さい）';
      return;
    }

    // 全フレームの平均（null除外）
    const avg = {};
    for (const m of METRICS) {
      const vals = refFrames.map(f => f[m.key]).filter(v => v !== null && v !== undefined);
      avg[m.key] = vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
    }

    const f0Vals = refFrames.map(f => f.f0).filter(v => v !== null && v > 0);
    const avgF0 = f0Vals.length > 0 ? f0Vals.reduce((s, v) => s + v, 0) / f0Vals.length : null;

    reference = { metrics: avg, f0: avgF0 };

    const noteName = avgF0 ? freqToNote(avgF0) : '—';
    $('ref-label').textContent = `基準: ${noteName}`;
    $('ref-pitch').textContent = avgF0 ? `${avgF0.toFixed(1)} Hz / ${refFrames.length} frames` : '';
    $('btn-clear-ref').style.display = '';
    $('top3-panel').style.display = '';

    Features.resetState();
  }

  function clearReference() {
    reference = null;
    $('ref-label').textContent = '基準: 未録音';
    $('ref-pitch').textContent = '';
    $('btn-clear-ref').style.display = 'none';
    $('top3-panel').style.display = 'none';

    for (const m of METRICS) {
      $(`ref-${m.key}`).style.display = 'none';
      $(`refval-${m.key}`).textContent = '';
      $(`diff-${m.key}`).textContent = '';
      $(`row-${m.key}`).className = 'metric-row';
    }
  }

  // ── データモード ──

  function startDataRecording() {
    dataRecording = true;
    dataFrames = [];
    dataStartTimeAudio = 0;
    dataTotalReceived = 0;
    dataDroppedFrames = 0;
    dataExpectedSeq = -1;
    Features.resetState();

    $('data-status').textContent = '録音中';
    $('data-status').classList.add('recording');
    $('btn-data-record').style.display = 'none';
    $('btn-data-stop').style.display = '';
    $('data-timer').style.display = '';
    $('data-export').style.display = 'none';
    $('data-summary').style.display = 'none';
  }

  function updateDataTimer() {
    if (dataFrames.length === 0) return;
    if (dataStartTimeAudio === 0) dataStartTimeAudio = dataFrames[0].timestamp;
    const elapsed = (dataFrames[dataFrames.length - 1].timestamp - dataStartTimeAudio) / 1000;
    $('data-elapsed').textContent = elapsed.toFixed(1);
    $('data-frames').textContent = dataFrames.length;
  }

  function stopDataRecording() {
    dataRecording = false;
    $('data-status').textContent = '録音完了';
    $('data-status').classList.remove('recording');
    $('btn-data-stop').style.display = 'none';
    $('data-timer').style.display = 'none';

    if (dataFrames.length < 2) {
      $('data-status').textContent = '録音失敗（音が小さい）';
      $('btn-data-record').style.display = '';
      return;
    }

    const duration = (dataFrames[dataFrames.length - 1].timestamp - dataFrames[0].timestamp) / 1000;
    const fps = dataFrames.length / duration;

    $('export-duration').textContent = `${duration.toFixed(1)}秒`;
    $('export-frames').textContent = `${dataFrames.length} frames`;
    $('export-fps').textContent = `${fps.toFixed(0)} fps`;
    $('data-export').style.display = '';

    showDataSummary();
  }

  function showDataSummary() {
    const container = $('data-summary');
    container.style.display = '';
    container.innerHTML = '';

    for (const m of METRICS) {
      const vals = dataFrames.map(f => f.metrics[m.key]).filter(v => v !== null && v !== undefined);
      if (vals.length === 0) continue;

      const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
      const sd = Math.sqrt(vals.reduce((s, v) => s + (v - avg) * (v - avg), 0) / vals.length);

      const row = document.createElement('div');
      row.className = 'summary-row';
      row.innerHTML = `
        <span class="s-label">${m.label}</span>
        <span class="s-avg">avg=${m.display(avg)}</span>
        <span class="s-sd">sd=${m.display(sd)} (n=${vals.length})</span>
      `;
      container.appendChild(row);
    }
  }

  // ── エクスポート ──

  function exportData(detailed) {
    const firstTs = dataFrames[0].timestamp;
    const lastTs = dataFrames[dataFrames.length - 1].timestamp;
    const duration = (lastTs - firstTs) / 1000;
    const fps = dataFrames.length / duration;
    const nominalFps = audioParams.sampleRate / audioParams.hopSize;
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 19);
    const fileDateStr = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('-') + '_' + [
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
    ].join('');

    let txt = '';

    // ── [header] ──
    txt += '[header]\n';
    txt += `app: 音色比較\n`;
    txt += `format_version: ${FORMAT_VERSION}\n`;
    txt += `date: ${dateStr}\n`;
    txt += `duration_sec: ${duration.toFixed(3)}\n`;
    txt += `total_frames: ${dataFrames.length}\n`;
    txt += `avg_fps: ${fps.toFixed(1)}\n`;
    txt += `nominal_fps: ${nominalFps.toFixed(1)}\n`;
    txt += `frame_timing: fixed (AudioWorklet, hop=${audioParams.hopSize})\n`;

    // 分析パラメータ
    txt += `sample_rate: ${audioParams.sampleRate}\n`;
    txt += `fft_size: ${audioParams.fftSize}\n`;
    txt += `hop_size: ${audioParams.hopSize}\n`;
    txt += `window_function: Hann\n`;
    txt += `f0_algorithm: YIN (threshold=0.15, parabolic interpolation)\n`;
    txt += `rms_unit: dBFS (full-scale reference)\n`;
    txt += `harmonic_amplitudes_unit: dBFS\n`;
    txt += `null_convention: empty cell = not computable (f0 undetected or insufficient data)\n`;

    // フレーム間隔の統計
    if (dataFrames.length > 1) {
      const intervals = [];
      for (let i = 1; i < dataFrames.length; i++) {
        intervals.push(dataFrames[i].timestamp - dataFrames[i - 1].timestamp);
      }
      const avgInterval = intervals.reduce((s, v) => s + v, 0) / intervals.length;
      const sdInterval = Math.sqrt(intervals.reduce((s, v) => s + (v - avgInterval) * (v - avgInterval), 0) / intervals.length);
      txt += `frame_interval_ms: avg=${avgInterval.toFixed(2)} sd=${sdInterval.toFixed(2)} min=${Math.min(...intervals).toFixed(2)} max=${Math.max(...intervals).toFixed(2)}\n`;
    }
    txt += '\n';

    // ── [quality] ──
    txt += '[quality]\n';
    txt += '# data quality metrics\n';

    const totalFrames = dataFrames.length;

    // f0 detection ratio
    const f0Frames = dataFrames.filter(f => f.metrics.f0 !== null).length;
    txt += `f0_detection_ratio: ${(f0Frames / totalFrames).toFixed(3)}\n`;

    // Dropped frames
    const expectedFrames = Math.round(duration * audioParams.sampleRate / audioParams.hopSize);
    txt += `expected_frames: ${expectedFrames}\n`;
    txt += `received_frames: ${dataTotalReceived}\n`;
    txt += `valid_frames: ${totalFrames}\n`;
    txt += `dropped_frame_ratio: ${expectedFrames > 0 ? (Math.max(0, expectedFrames - dataTotalReceived) / expectedFrames).toFixed(3) : '0'}\n`;

    // Tail silence
    let tailSilence = 0;
    for (let i = dataFrames.length - 1; i >= 0; i--) {
      if (dataFrames[i].metrics.rms < -50) tailSilence++;
      else break;
    }
    txt += `tail_silence_frames: ${tailSilence}\n`;
    txt += '\n';

    // ── [metrics_summary] ──
    txt += '[metrics_summary]\n';
    txt += '# stats computed excluding null values; n = count of valid frames\n';
    for (const m of METRICS) {
      const vals = dataFrames.map(f => f.metrics[m.key]).filter(v => v !== null && v !== undefined);
      if (vals.length === 0) {
        txt += `${m.key}: n=0\n`;
        continue;
      }
      const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
      const sd = Math.sqrt(vals.reduce((s, v) => s + (v - avg) * (v - avg), 0) / vals.length);
      const min = Math.min(...vals);
      const max = Math.max(...vals);
      txt += `${m.key}: avg=${m.csv(avg)} sd=${m.csv(sd)} min=${m.csv(min)} max=${m.csv(max)} n=${vals.length}\n`;
    }
    txt += '\n';

    // ── [onsets] ──
    const onsets = Features.getOnsets();
    if (onsets.length > 0) {
      txt += '[onsets]\n';
      txt += '# onset events detected during recording\n';
      txt += '# time: ms from recording start, rise_time: ms from silence to stable sound\n';
      txt += 'index,time_ms,rise_time_ms\n';
      onsets.forEach((o, i) => {
        const relTime = o.time - firstTs;
        txt += `${i},${relTime.toFixed(1)},${o.riseTime.toFixed(1)}\n`;
      });
      txt += '\n';
    }

    // ── [frame_data] ──
    if (detailed) {
      txt += '[frame_data]\n';
      txt += '# one row per analysis frame; empty = null (metric not computable)\n';
      const keys = METRICS.map(m => m.key);
      txt += 'frame,timestamp,' + keys.join(',') + '\n';

      for (let i = 0; i < dataFrames.length; i++) {
        const f = dataFrames[i];
        const ts = ((f.timestamp - firstTs) / 1000).toFixed(3);
        const vals = keys.map(k => {
          const v = f.metrics[k];
          if (v === null || v === undefined) return '';
          const m = METRICS.find(mm => mm.key === k);
          return m.csv(v);
        });
        txt += `${i},${ts},${vals.join(',')}\n`;
      }
    }

    const suffix = detailed ? '_detail' : '';
    const filename = `timbre_${fileDateStr}${suffix}.txt`;
    downloadTxt(txt, filename);
  }

  function downloadTxt(content, filename) {
    const blob = new Blob([content], { type: 'text/plain; charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function resetDataMode() {
    dataFrames = [];
    dataTotalReceived = 0;
    dataDroppedFrames = 0;
    dataExpectedSeq = -1;
    $('data-status').textContent = '待機中';
    $('data-status').classList.remove('recording');
    $('btn-data-record').style.display = '';
    $('btn-data-stop').style.display = 'none';
    $('data-timer').style.display = 'none';
    $('data-export').style.display = 'none';
    $('data-summary').style.display = 'none';
    Features.resetState();
  }

  // ── ユーティリティ ──

  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  function freqToNote(freq) {
    if (!freq || freq <= 0) return '—';
    const midi = 69 + 12 * Math.log2(freq / 440);
    const note = Math.round(midi);
    const name = NOTE_NAMES[((note % 12) + 12) % 12];
    const octave = Math.floor(note / 12) - 1;
    return `${name}${octave}`;
  }

  init();
})();
