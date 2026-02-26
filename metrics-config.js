// metrics-config.js — 37指標の定義・要因ラベル・表示設定 v2

// CSV出力用: 有効数字を保つフォーマッタ
function csvFormat(v) {
  if (v === null || v === undefined) return '';
  if (v === 0) return '0';
  const abs = Math.abs(v);
  if (abs < 0.0001) return v.toExponential(3);
  if (abs < 0.01) return v.toExponential(3);
  if (abs < 1) return v.toPrecision(4);
  if (abs < 100) return v.toFixed(2);
  if (abs < 10000) return v.toFixed(1);
  return v.toFixed(0);
}

const METRICS = [
  // ── カテゴリA: スペクトル形状 ──
  {
    key: 'spectralCentroid', label: '明るさ', unit: 'Hz',
    category: 'spectrum', factor: '弓圧',
    display: v => v === null ? '—' : v.toFixed(0),
    csv: csvFormat,
    range: [500, 4000],
    tip: { up: '弓圧を軽く / 駒から離す', down: '弓圧を強く / 駒に近づく' },
  },
  {
    key: 'spectralSpread', label: '音の幅', unit: 'Hz',
    category: 'spectrum', factor: '接触点',
    display: v => v === null ? '—' : v.toFixed(0),
    csv: csvFormat,
    range: [200, 2000],
    tip: { up: '接触点を安定させる', down: '接触点を変えてみる' },
  },
  {
    key: 'spectralSlope', label: '倍音の減衰', unit: 'dB/Hz',
    category: 'spectrum', factor: '弓圧・接触点',
    display: v => v === null ? '—' : v.toExponential(2),
    csv: csvFormat,
    range: [-0.01, 0],
    tip: { up: '弓圧を軽く', down: '弓圧を少し強く' },
  },
  {
    key: 'sfm', label: 'ノイズ感', unit: '',
    category: 'spectrum', factor: '弓圧（過多↑）',
    display: v => v === null ? '—' : v.toFixed(3),
    csv: csvFormat,
    range: [0, 0.3],
    tip: { up: '弓圧を軽くする', down: '' },
  },
  {
    key: 'spectralIrregularity', label: 'なめらかさ', unit: '',
    category: 'spectrum', factor: '弓圧',
    display: v => v === null ? '—' : v.toFixed(3),
    csv: csvFormat,
    range: [0, 0.8],
    nullWhenNoF0: true,
    tip: { up: '弓圧をより均一に', down: '' },
  },
  {
    key: 'spectralFlux', label: '音の安定性', unit: 'dB',
    category: 'spectrum', factor: '弓の安定性',
    display: v => v === null ? '—' : v.toFixed(2),
    csv: csvFormat,
    range: [0, 15],
    tip: { up: '弓を安定させる', down: '' },
  },
  {
    key: 'spectralRolloff85', label: 'ロールオフ85%', unit: 'Hz',
    category: 'spectrum', factor: '弓圧・接触点',
    display: v => v === null ? '—' : v.toFixed(0),
    csv: csvFormat,
    range: [500, 8000],
    tip: { up: '弓圧を軽く', down: '弓圧を強く' },
  },
  {
    key: 'spectralRolloff95', label: 'ロールオフ95%', unit: 'Hz',
    category: 'spectrum', factor: '弓圧・接触点',
    display: v => v === null ? '—' : v.toFixed(0),
    csv: csvFormat,
    range: [1000, 15000],
    tip: { up: '高周波ノイズ減', down: '' },
  },

  // ── カテゴリB: 倍音構造 ──
  {
    key: 't1', label: '基音の強さ', unit: '',
    category: 'harmonic', factor: '弓圧・接触点',
    display: v => v === null ? '—' : v.toFixed(3),
    csv: csvFormat,
    range: [0, 0.6], nullWhenNoF0: true,
    tip: { up: '駒から離す', down: '駒に近づく' },
  },
  {
    key: 't2', label: '中域倍音', unit: '',
    category: 'harmonic', factor: '弓速・接触点',
    display: v => v === null ? '—' : v.toFixed(3),
    csv: csvFormat,
    range: [0, 0.6], nullWhenNoF0: true,
    tip: { up: '弓速を調整', down: '弓速を上げる' },
  },
  {
    key: 't3', label: '高域倍音', unit: '',
    category: 'harmonic', factor: '弓圧・接触点',
    display: v => v === null ? '—' : v.toFixed(3),
    csv: csvFormat,
    range: [0, 0.5], nullWhenNoF0: true,
    tip: { up: '弓圧を軽く', down: '弓圧を少し強く' },
  },
  {
    key: 'oddEvenRatio', label: '奇偶倍音比', unit: '',
    category: 'harmonic', factor: '接触点(β)',
    display: v => v === null ? '—' : v.toFixed(2),
    csv: csvFormat,
    range: [0.5, 2.0], nullWhenNoF0: true,
    tip: { up: '接触点を微調整', down: '接触点を微調整' },
  },
  {
    key: 'hnr', label: '音の澄み', unit: 'dB',
    category: 'harmonic', factor: '弓圧・弓速',
    display: v => v === null ? '—' : v.toFixed(1),
    csv: csvFormat,
    range: [0, 40], nullWhenNoF0: true,
    tip: { up: '', down: '弓圧と弓速のバランス' },
  },
  {
    key: 'harmonicSlope', label: '倍音の落ち方', unit: 'dB/倍音',
    category: 'harmonic', factor: '弓圧',
    display: v => v === null ? '—' : v.toFixed(2),
    csv: csvFormat,
    range: [-10, 0], nullWhenNoF0: true,
    tip: { up: '弓圧を調整', down: '弓圧を調整' },
  },
  {
    key: 'aperiodicity', label: '非周期性', unit: '',
    category: 'harmonic', factor: '弓の接触状態',
    display: v => v === null ? '—' : v.toFixed(3),
    csv: csvFormat,
    range: [0, 1], nullWhenNoF0: true,
    tip: { up: '弓を安定させる', down: '' },
  },

  // ── カテゴリC: 個別倍音 ──
  {
    key: 'h1', label: '第1倍音(基音)', unit: 'dBFS',
    category: 'harmonicDetail', factor: '接触点・弓圧',
    display: v => v === null ? '—' : v.toFixed(1),
    csv: csvFormat,
    range: [-60, 0], nullWhenNoF0: true,
    tip: { up: '', down: '' },
  },
  {
    key: 'h2', label: '第2倍音', unit: 'dBFS',
    category: 'harmonicDetail', factor: '接触点(β=1/2で消失)',
    display: v => v === null ? '—' : v.toFixed(1),
    csv: csvFormat,
    range: [-60, 0], nullWhenNoF0: true,
    tip: { up: '', down: '' },
  },
  {
    key: 'h3', label: '第3倍音', unit: 'dBFS',
    category: 'harmonicDetail', factor: '接触点(β=1/3で消失)',
    display: v => v === null ? '—' : v.toFixed(1),
    csv: csvFormat,
    range: [-60, 0], nullWhenNoF0: true,
    tip: { up: '', down: '' },
  },
  {
    key: 'h4', label: '第4倍音', unit: 'dBFS',
    category: 'harmonicDetail', factor: '接触点(β=1/4で消失)',
    display: v => v === null ? '—' : v.toFixed(1),
    csv: csvFormat,
    range: [-60, 0], nullWhenNoF0: true,
    tip: { up: '', down: '' },
  },
  {
    key: 'h5', label: '第5倍音', unit: 'dBFS',
    category: 'harmonicDetail', factor: '接触点(β=1/5で消失)',
    display: v => v === null ? '—' : v.toFixed(1),
    csv: csvFormat,
    range: [-60, 0], nullWhenNoF0: true,
    tip: { up: '', down: '' },
  },
  {
    key: 'h6', label: '第6倍音', unit: 'dBFS',
    category: 'harmonicDetail', factor: '接触点(β=1/6で消失)',
    display: v => v === null ? '—' : v.toFixed(1),
    csv: csvFormat,
    range: [-60, 0], nullWhenNoF0: true,
    tip: { up: '', down: '' },
  },
  {
    key: 'h7', label: '第7倍音', unit: 'dBFS',
    category: 'harmonicDetail', factor: '接触点(β=1/7で消失)',
    display: v => v === null ? '—' : v.toFixed(1),
    csv: csvFormat,
    range: [-60, 0], nullWhenNoF0: true,
    tip: { up: '', down: '' },
  },
  {
    key: 'h8', label: '第8倍音', unit: 'dBFS',
    category: 'harmonicDetail', factor: '接触点(β=1/8で消失)',
    display: v => v === null ? '—' : v.toFixed(1),
    csv: csvFormat,
    range: [-60, 0], nullWhenNoF0: true,
    tip: { up: '', down: '' },
  },

  // ── カテゴリD: 周波数帯域 ──
  {
    key: 'richness', label: '豊かさ', unit: 'dB',
    category: 'band', factor: '弓速・接触点',
    display: v => v === null ? '—' : v.toFixed(1),
    csv: csvFormat,
    range: [-20, 10],
    tip: { up: '', down: '弓速を上げる / 駒から少し離す' },
  },
  {
    key: 'nasality', label: '鼻声感', unit: 'dB',
    category: 'band', factor: '接触点',
    display: v => v === null ? '—' : v.toFixed(1),
    csv: csvFormat,
    range: [-20, 10],
    tip: { up: '接触点を調整', down: '' },
  },
  {
    key: 'brilliance', label: '輝き', unit: 'dB',
    category: 'band', factor: '弓圧',
    display: v => v === null ? '—' : v.toFixed(1),
    csv: csvFormat,
    range: [-20, 10],
    tip: { up: '弓圧を軽く', down: '弓圧をかける' },
  },
  {
    key: 'harshness', label: '粗さ', unit: 'dB',
    category: 'band', factor: '弓圧（過多↑）',
    display: v => v === null ? '—' : v.toFixed(1),
    csv: csvFormat,
    range: [-20, 10],
    tip: { up: '弓圧を軽く / 駒から離す', down: '' },
  },
  {
    key: 'lowFreqRatio', label: '低域比率(<100Hz)', unit: '',
    category: 'band', factor: '弓圧過多',
    display: v => v === null ? '—' : v.toFixed(4),
    csv: csvFormat,
    range: [0, 0.1],
    tip: { up: '弓圧を下げる', down: '' },
  },

  // ── カテゴリE: 時間・発音 ──
  {
    key: 'rms', label: '音量', unit: 'dBFS',
    category: 'temporal', factor: '弓速×弓圧',
    display: v => v === null ? '—' : v.toFixed(1),
    csv: csvFormat,
    range: [-50, 0],
    tip: { up: '弓速を落とす', down: '弓速を上げる' },
  },
  {
    key: 'f0', label: '音程', unit: 'Hz',
    category: 'temporal', factor: '左手',
    display: v => v === null ? '—' : v.toFixed(1),
    csv: csvFormat,
    range: [196, 880],
    tip: { up: '音程を下げる', down: '音程を上げる' },
  },
  {
    key: 'f0Confidence', label: 'f0信頼度', unit: '',
    category: 'temporal', factor: '音の周期性',
    display: v => v === null ? '—' : v.toFixed(3),
    csv: csvFormat,
    range: [0, 1],
    tip: { up: '', down: '弓を安定させる' },
  },
  {
    key: 'f0Stability', label: '音程の安定', unit: 'cents',
    category: 'temporal', factor: '左手',
    display: v => v === null ? '—' : v.toFixed(1),
    csv: csvFormat,
    range: [0, 50], nullWhenNoF0: true,
    tip: { up: '左手を安定させる', down: '' },
  },
  {
    key: 'scStability', label: '音色の安定', unit: 'Hz',
    category: 'temporal', factor: '弓の一貫性',
    display: v => v === null ? '—' : v.toFixed(1),
    csv: csvFormat,
    range: [0, 500],
    tip: { up: '弓を一定に保つ', down: '' },
  },
  {
    key: 'timeSinceOnset', label: '発音からの経過', unit: 'ms',
    category: 'temporal', factor: '弓の発音',
    display: v => v === null ? '—' : v.toFixed(0),
    csv: csvFormat,
    range: [0, 3000],
    tip: { up: '', down: '' },
  },
];

const CATEGORY_LABELS = {
  spectrum: 'スペクトル形状',
  harmonic: '倍音構造',
  harmonicDetail: '個別倍音振幅',
  band: '周波数帯域',
  temporal: '時間・発音',
};
