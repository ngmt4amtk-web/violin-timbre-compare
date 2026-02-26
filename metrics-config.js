// metrics-config.js — 23指標の定義・要因ラベル・表示設定

const METRICS = [
  // ── カテゴリA: スペクトル形状 ──
  {
    key: 'spectralCentroid', label: '明るさ', unit: 'Hz',
    category: 'spectrum', factor: '弓圧',
    format: v => v.toFixed(0), range: [500, 4000],
    tip: { up: '弓圧を軽く / 駒から離す', down: '弓圧を強く / 駒に近づく' },
  },
  {
    key: 'spectralSpread', label: '音の幅', unit: 'Hz',
    category: 'spectrum', factor: '接触点',
    format: v => v.toFixed(0), range: [200, 2000],
    tip: { up: '接触点を安定させる', down: '接触点を変えてみる' },
  },
  {
    key: 'spectralSlope', label: '倍音の減衰', unit: 'dB/Hz',
    category: 'spectrum', factor: '弓圧・接触点',
    format: v => v.toFixed(4), range: [-0.01, 0],
    tip: { up: '弓圧を軽く', down: '弓圧を少し強く' },
  },
  {
    key: 'sfm', label: 'ノイズ感', unit: '',
    category: 'spectrum', factor: '弓圧（過多↑）',
    format: v => v.toFixed(3), range: [0, 0.3],
    tip: { up: '弓圧を軽くする', down: '' },
  },
  {
    key: 'spectralIrregularity', label: 'なめらかさ', unit: '',
    category: 'spectrum', factor: '弓圧',
    format: v => v.toFixed(3), range: [0, 0.8],
    tip: { up: '弓圧をより均一に', down: '' },
  },
  {
    key: 'spectralFlux', label: '音の安定性', unit: '',
    category: 'spectrum', factor: '弓の安定性',
    format: v => v.toFixed(4), range: [0, 0.05],
    tip: { up: '弓を安定させる', down: '' },
  },

  // ── カテゴリB: 倍音構造 ──
  {
    key: 't1', label: '基音の強さ', unit: '',
    category: 'harmonic', factor: '弓圧・接触点',
    format: v => v.toFixed(3), range: [0, 0.6],
    tip: { up: '駒から離す', down: '駒に近づく' },
  },
  {
    key: 't2', label: '中域倍音', unit: '',
    category: 'harmonic', factor: '弓速・接触点',
    format: v => v.toFixed(3), range: [0, 0.6],
    tip: { up: '弓速を調整', down: '弓速を上げる' },
  },
  {
    key: 't3', label: '高域倍音', unit: '',
    category: 'harmonic', factor: '弓圧・接触点',
    format: v => v.toFixed(3), range: [0, 0.5],
    tip: { up: '弓圧を軽く', down: '弓圧を少し強く' },
  },
  {
    key: 'oddEvenRatio', label: '奇偶倍音比', unit: '',
    category: 'harmonic', factor: '接触点(β)',
    format: v => v.toFixed(2), range: [0.5, 2.0],
    tip: { up: '接触点を微調整', down: '接触点を微調整' },
  },
  {
    key: 'hnr', label: '音の澄み', unit: 'dB',
    category: 'harmonic', factor: '弓圧・弓速',
    format: v => v.toFixed(1), range: [0, 40],
    tip: { up: '', down: '弓圧と弓速のバランス' },
  },
  {
    key: 'harmonicSlope', label: '倍音の落ち方', unit: 'dB/倍音',
    category: 'harmonic', factor: '弓圧',
    format: v => v.toFixed(2), range: [-10, 0],
    tip: { up: '弓圧を調整', down: '弓圧を調整' },
  },

  // ── カテゴリC: 周波数帯域（Dünnwald） ──
  {
    key: 'richness', label: '豊かさ', unit: 'dB',
    category: 'band', factor: '弓速・接触点',
    format: v => v.toFixed(1), range: [-20, 10],
    tip: { up: '', down: '弓速を上げる / 駒から少し離す' },
  },
  {
    key: 'nasality', label: '鼻声感', unit: 'dB',
    category: 'band', factor: '接触点',
    format: v => v.toFixed(1), range: [-20, 10],
    tip: { up: '接触点を調整', down: '' },
  },
  {
    key: 'brilliance', label: '輝き', unit: 'dB',
    category: 'band', factor: '弓圧',
    format: v => v.toFixed(1), range: [-20, 10],
    tip: { up: '弓圧を軽く', down: '弓圧をかける' },
  },
  {
    key: 'harshness', label: '粗さ', unit: 'dB',
    category: 'band', factor: '弓圧（過多↑）',
    format: v => v.toFixed(1), range: [-20, 10],
    tip: { up: '弓圧を軽く / 駒から離す', down: '' },
  },

  // ── カテゴリD: 時間・発音 ──
  {
    key: 'rms', label: '音量', unit: 'dB',
    category: 'temporal', factor: '弓速×弓圧',
    format: v => v.toFixed(1), range: [-50, 0],
    tip: { up: '弓速を落とす', down: '弓速を上げる' },
  },
  {
    key: 'f0', label: '音程', unit: 'Hz',
    category: 'temporal', factor: '左手',
    format: v => v.toFixed(1), range: [196, 880],
    tip: { up: '音程を下げる', down: '音程を上げる' },
  },
  {
    key: 'f0Stability', label: '音程の安定', unit: 'cents',
    category: 'temporal', factor: '左手',
    format: v => v.toFixed(1), range: [0, 50],
    tip: { up: '左手を安定させる', down: '' },
  },
  {
    key: 'scStability', label: '音色の安定', unit: 'Hz',
    category: 'temporal', factor: '弓の一貫性',
    format: v => v.toFixed(1), range: [0, 500],
    tip: { up: '弓を一定に保つ', down: '' },
  },
  {
    key: 'attackTime', label: '立ち上がり', unit: 'ms',
    category: 'temporal', factor: '弓の初速',
    format: v => v.toFixed(0), range: [0, 200],
    tip: { up: '弓を素早く置く', down: '' },
  },
  {
    key: 'vibratoRate', label: 'ビブラート速度', unit: 'Hz',
    category: 'temporal', factor: '左手',
    format: v => v.toFixed(1), range: [0, 8],
    tip: { up: 'ビブラートを遅く', down: 'ビブラートを速く' },
  },
  {
    key: 'vibratoDepth', label: 'ビブラート深さ', unit: 'cents',
    category: 'temporal', factor: '左手',
    format: v => v.toFixed(1), range: [0, 60],
    tip: { up: 'ビブラートを浅く', down: 'ビブラートを深く' },
  },
];

const CATEGORY_LABELS = {
  spectrum: 'スペクトル形状',
  harmonic: '倍音構造',
  band: '周波数帯域',
  temporal: '時間・発音',
};
