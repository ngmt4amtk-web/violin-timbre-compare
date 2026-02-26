// app.js — メインアプリケーション制御

(() => {
  'use strict';

  // ── 状態 ──
  let currentMode = 'realtime';
  let isRunning = false;
  let reference = null; // { metrics: {key: avg}, f0: number }
  let animFrameId = null;

  // データモード
  let dataRecording = false;
  let dataFrames = [];
  let dataStartTime = 0;

  // 基準録音
  let refRecording = false;
  let refFrames = [];
  let refStartTime = 0;
  const REF_DURATION = 3000; // 3秒

  // ── DOM ──
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
    // 起動
    $('btn-start').addEventListener('click', startAudio);

    // モード切替
    for (const tab of document.querySelectorAll('.tab')) {
      tab.addEventListener('click', () => switchMode(tab.dataset.mode));
    }

    // 基準録音
    $('btn-record-ref').addEventListener('click', startRefRecording);
    $('btn-clear-ref').addEventListener('click', clearReference);

    // データモード
    $('btn-data-record').addEventListener('click', startDataRecording);
    $('btn-data-stop').addEventListener('click', stopDataRecording);
    $('btn-export-simple').addEventListener('click', () => exportData(false));
    $('btn-export-detail').addEventListener('click', () => exportData(true));
    $('btn-data-new').addEventListener('click', resetDataMode);
  }

  async function startAudio() {
    try {
      await AudioEngine.init();
      isRunning = true;
      $('screen-start').classList.remove('active');
      $('screen-realtime').classList.add('active');
      $('header').style.display = '';
      requestAnimationFrame(loop);
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

  // ── メインループ ──

  function loop(timestamp) {
    if (!isRunning) return;
    animFrameId = requestAnimationFrame(loop);

    const buffers = AudioEngine.getBuffers();
    if (!buffers) return;

    const metrics = Features.computeAll(buffers, timestamp);

    if (currentMode === 'realtime') {
      updateRealtimeUI(metrics);
      if (refRecording) collectRefFrame(metrics, timestamp);
    }

    if (currentMode === 'data' && dataRecording && metrics) {
      dataFrames.push({ timestamp, metrics: { ...metrics } });
      updateDataTimer(timestamp);
    }
  }

  // ── リアルタイムモード UI更新 ──

  function updateRealtimeUI(metrics) {
    if (!metrics) {
      // 無音時は値を薄く
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

      // 値表示
      valEl.textContent = m.format(val);
      valEl.style.opacity = '1';

      // バー
      const [lo, hi] = m.range;
      const pct = Math.max(0, Math.min(100, ((val - lo) / (hi - lo)) * 100));
      barEl.style.width = pct + '%';

      // 基準との比較
      if (reference) {
        const refVal = reference.metrics[m.key];
        if (refVal !== undefined && refVal !== null) {
          // 基準マーカー
          const refPct = Math.max(0, Math.min(100, ((refVal - lo) / (hi - lo)) * 100));
          refEl.style.display = '';
          refEl.style.left = refPct + '%';

          refValEl.textContent = `基準: ${m.format(refVal)}`;

          // 差分
          const diff = val - refVal;
          const absDiff = Math.abs(diff);
          const refAbs = Math.abs(refVal) || 1;
          const pctDiff = (absDiff / refAbs) * 100;

          if (absDiff < (hi - lo) * 0.02) {
            diffEl.textContent = '≈';
            diffEl.className = 'metric-diff match';
            rowEl.className = 'metric-row highlight-green';
          } else {
            const arrow = diff > 0 ? '△' : '▽';
            diffEl.textContent = `${arrow}${m.format(absDiff)}`;
            diffEl.className = 'metric-diff ' + (diff > 0 ? 'up' : 'down');

            if (pctDiff > 30) {
              rowEl.className = 'metric-row highlight-red';
            } else if (pctDiff > 15) {
              rowEl.className = 'metric-row highlight-orange';
            } else {
              rowEl.className = 'metric-row';
            }
          }
        }
      } else {
        refEl.style.display = 'none';
        refValEl.textContent = '';
        diffEl.textContent = '';
        rowEl.className = 'metric-row';
      }
    }

    // TOP3
    if (reference) {
      updateTop3(metrics);
    }
  }

  function updateTop3(metrics) {
    const diffs = [];
    for (const m of METRICS) {
      const cur = metrics[m.key];
      const ref = reference.metrics[m.key];
      if (ref === undefined || ref === null) continue;
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

  function collectRefFrame(metrics, timestamp) {
    if (!metrics) return;
    refFrames.push({ ...metrics });
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

    // 全フレームの平均を計算
    const avg = {};
    for (const m of METRICS) {
      const vals = refFrames.map(f => f[m.key]).filter(v => v !== undefined && v !== null && v !== 0);
      if (vals.length > 0) {
        avg[m.key] = vals.reduce((s, v) => s + v, 0) / vals.length;
      } else {
        avg[m.key] = 0;
      }
    }

    // F0の最頻値で音名を推定
    const f0Vals = refFrames.map(f => f.f0).filter(v => v > 0);
    const avgF0 = f0Vals.length > 0 ? f0Vals.reduce((s, v) => s + v, 0) / f0Vals.length : 0;

    reference = { metrics: avg, f0: avgF0 };

    const noteName = avgF0 > 0 ? freqToNote(avgF0) : '—';
    $('ref-label').textContent = `基準: ${noteName}`;
    $('ref-pitch').textContent = avgF0 > 0 ? `${avgF0.toFixed(1)} Hz / ${refFrames.length} frames` : '';
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
    dataStartTime = performance.now();
    Features.resetState();

    $('data-status').textContent = '録音中';
    $('data-status').classList.add('recording');
    $('btn-data-record').style.display = 'none';
    $('btn-data-stop').style.display = '';
    $('data-timer').style.display = '';
    $('data-export').style.display = 'none';
    $('data-summary').style.display = 'none';
  }

  function updateDataTimer(timestamp) {
    const elapsed = (performance.now() - dataStartTime) / 1000;
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

    // サマリー表示
    showDataSummary();
  }

  function showDataSummary() {
    const container = $('data-summary');
    container.style.display = '';
    container.innerHTML = '';

    for (const m of METRICS) {
      const vals = dataFrames.map(f => f.metrics[m.key]).filter(v => v !== undefined && v !== null);
      if (vals.length === 0) continue;

      const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
      const variance = vals.reduce((s, v) => s + (v - avg) * (v - avg), 0) / vals.length;
      const sd = Math.sqrt(variance);

      const row = document.createElement('div');
      row.className = 'summary-row';
      row.innerHTML = `
        <span class="s-label">${m.label}</span>
        <span class="s-avg">avg=${m.format(avg)}</span>
        <span class="s-sd">sd=${m.format(sd)}</span>
      `;
      container.appendChild(row);
    }
  }

  function exportData(detailed) {
    const firstTs = dataFrames[0].timestamp;
    const lastTs = dataFrames[dataFrames.length - 1].timestamp;
    const duration = (lastTs - firstTs) / 1000;
    const fps = dataFrames.length / duration;
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 19);
    const fileDateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;

    let txt = '';

    // [header]
    txt += '[header]\n';
    txt += `app: 音色比較\n`;
    txt += `version: 1.0\n`;
    txt += `date: ${dateStr}\n`;
    txt += `duration_sec: ${duration.toFixed(1)}\n`;
    txt += `fps: ${fps.toFixed(0)}\n`;
    txt += `total_frames: ${dataFrames.length}\n`;

    // 検出された音高
    const f0s = dataFrames.map(f => f.metrics.f0).filter(v => v > 0);
    if (f0s.length > 0) {
      const avgF0 = f0s.reduce((s, v) => s + v, 0) / f0s.length;
      txt += `detected_pitch: ${freqToNote(avgF0)} (${avgF0.toFixed(1)}Hz)\n`;
    }
    txt += '\n';

    // [metrics_summary]
    txt += '[metrics_summary]\n';
    for (const m of METRICS) {
      const vals = dataFrames.map(f => f.metrics[m.key]).filter(v => v !== undefined && v !== null);
      if (vals.length === 0) {
        txt += `${m.key}: n/a\n`;
        continue;
      }
      const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
      const sd = Math.sqrt(vals.reduce((s, v) => s + (v - avg) * (v - avg), 0) / vals.length);
      const min = Math.min(...vals);
      const max = Math.max(...vals);
      txt += `${m.key}: avg=${m.format(avg)} sd=${m.format(sd)} min=${m.format(min)} max=${m.format(max)}\n`;
    }
    txt += '\n';

    // [frame_data]
    if (detailed) {
      txt += '[frame_data]\n';
      const keys = METRICS.map(m => m.key);
      txt += 'frame,timestamp,' + keys.join(',') + '\n';

      for (let i = 0; i < dataFrames.length; i++) {
        const f = dataFrames[i];
        const ts = ((f.timestamp - firstTs) / 1000).toFixed(3);
        const vals = keys.map(k => {
          const m = METRICS.find(mm => mm.key === k);
          const v = f.metrics[k];
          return v !== undefined && v !== null ? m.format(v) : '';
        });
        txt += `${i},${ts},${vals.join(',')}\n`;
      }
    }

    // ダウンロード
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
    if (freq <= 0) return '—';
    const midi = 69 + 12 * Math.log2(freq / 440);
    const note = Math.round(midi);
    const name = NOTE_NAMES[note % 12];
    const octave = Math.floor(note / 12) - 1;
    return `${name}${octave}`;
  }

  // ── 起動 ──
  init();
})();
