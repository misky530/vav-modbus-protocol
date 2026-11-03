// 读 Getter 数组 / forceMode → 写 Slave + 维护历史环形缓冲（供 /vav 曲线）
// 正常↔值班切换时，压力 SP / 风机频率中心 / 阀风量中心约 8s 缓变（ease-out），非瞬时跳变
const prev = global.get('vavSim') || {};
const now = Date.now();
const t0 = prev.t0 || now;
const t = (now - t0) / 1000;
const RAMP_MS = 8000;

let regsIn = [];
if (Array.isArray(msg.payload)) regsIn = msg.payload;
else if (msg.payload && Array.isArray(msg.payload.data)) regsIn = msg.payload.data;

function u16(v) {
  v = Number(v);
  if (!Number.isFinite(v)) return 0;
  v = v & 0xFFFF;
  return v > 32767 ? v - 65536 : v;
}

let mode = prev.mode || 'normal';
const prevMode = mode;
const forced = msg.forceMode || (msg.message && msg.message.forceMode);
let modeCmd = null;
if (forced === 'normal' || forced === 'standby') {
  mode = forced;
  modeCmd = forced;
} else if (regsIn.length >= 21) {
  const cmdNormal = u16(regsIn[19]);
  const cmdStandby = u16(regsIn[20]);
  if (cmdStandby === 1) { mode = 'standby'; modeCmd = 'standby'; }
  else if (cmdNormal === 1) { mode = 'normal'; modeCmd = 'normal'; }
}
const normal = mode === 'normal';

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function rnd(seed) {
  const x = Math.sin((t + seed) * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}
function wave(amp, periodSec, phase) {
  return amp * Math.sin(2 * Math.PI * t / periodSec + phase);
}
function easeOut(u) {
  u = clamp(u, 0, 1);
  return 1 - Math.pow(1 - u, 2);
}
function lerp(a, b, u) { return a + (b - a) * u; }
function centersFor(m) {
  const n = m === 'normal';
  return { sp: n ? 500 : 300, hz: n ? 48 : 28, fl: n ? 2000 : 1000, kd: 80 };
}

const targetCenters = centersFor(mode);
let transition = prev.transition || null;

// 模式命令触发：立刻更新 mode_status 目标，并从当前有效中心开始约 8s 过渡
if (modeCmd && mode !== prevMode) {
  const from = (prev.centers && typeof prev.centers.sp === 'number')
    ? Object.assign({}, prev.centers)
    : centersFor(prevMode);
  transition = {
    from: from,
    to: Object.assign({}, targetCenters),
    start: now,
    duration: RAMP_MS,
    targetMode: mode
  };
} else if (modeCmd && mode === prevMode && transition && transition.targetMode === mode) {
  // 同模式重复命令：若仍在过渡中，保持现有过渡；已结束则无需重启
} else if (mode !== prevMode && !modeCmd) {
  // 兜底（例如外部改写了 mode）
  const from = (prev.centers && typeof prev.centers.sp === 'number')
    ? Object.assign({}, prev.centers)
    : centersFor(prevMode);
  transition = {
    from: from,
    to: Object.assign({}, targetCenters),
    start: now,
    duration: RAMP_MS,
    targetMode: mode
  };
}

let spCenter = targetCenters.sp;
let hzCenter = targetCenters.hz;
let flCenter = targetCenters.fl;
let kdCenter = targetCenters.kd;
let transitioning = false;

if (transition && transition.start && transition.duration) {
  const u = (now - transition.start) / transition.duration;
  if (u < 1) {
    transitioning = true;
    const e = easeOut(u);
    const fr = transition.from || targetCenters;
    const to = transition.to || targetCenters;
    spCenter = lerp(fr.sp, to.sp, e);
    hzCenter = lerp(fr.hz, to.hz, e);
    flCenter = lerp(fr.fl, to.fl, e);
    kdCenter = lerp(fr.kd != null ? fr.kd : 80, to.kd != null ? to.kd : 80, e);
  } else {
    transition = null;
  }
}

const centers = { sp: spCenter, hz: hzCenter, fl: flCenter, kd: kdCenter };

const pfylBase = spCenter + wave(12, 45, 0.2) + wave(4, 9, 1.1);
const pfyl1 = Math.round(clamp(pfylBase + (rnd(1) - 0.5) * 3, -500, 500));
const pfyl2 = Math.round(clamp(pfylBase + wave(6, 38, 2.0) + (rnd(2) - 0.5) * 3, -500, 500));
const fjpl1i = Math.round(clamp(hzCenter + wave(1.6, 40, 0.5) + (rnd(3) - 0.5) * 0.4, 0, 50));
const fjpl2i = Math.round(clamp(hzCenter + wave(1.4, 42, 1.7) + (rnd(4) - 0.5) * 0.4, 0, 50));

const valves = {};
for (let i = 1; i <= 6; i++) {
  const kd = Math.round(clamp(kdCenter + wave(2.5, 55 + i, i * 0.7) + (rnd(10 + i) - 0.5) * 0.8, 0, 100));
  const fl = Math.round(clamp(
    flCenter * (0.92 + 0.08 * (kd / 80)) + wave(60 + i * 5, 36 + i, i) + (rnd(20 + i) - 0.5) * 20,
    0, 5000
  ));
  valves['排风阀-' + i] = { fl, kd };
}
const wd = Math.round(clamp(24 + wave(1.2, 180, 0.3) + (rnd(30) - 0.5) * 0.2, -50, 100));
const sd = Math.round(clamp(55 + wave(4, 240, 1.0) + (rnd(31) - 0.5) * 0.5, 0, 100));
const yc = Math.round(clamp(5 + wave(2.5, 70, 0.8) + (rnd(32) - 0.5) * 0.4, -500, 500));

const fl_sum_123 = valves['排风阀-1'].fl + valves['排风阀-2'].fl + valves['排风阀-3'].fl;
const fl_sum_456 = valves['排风阀-4'].fl + valves['排风阀-5'].fl + valves['排风阀-6'].fl;

const sim = {
  t0, mode, sp: spCenter, centers, transition, transitioning,
  fans: {
    '排风机-1': { pfyl: pfyl1, fjpl: fjpl1i },
    '排风机-2': { pfyl: pfyl2, fjpl: fjpl2i }
  },
  valves,
  sums: { fl_sum_123, fl_sum_456 },
  room: { '温湿压-1': { wd, sd, yc } },
  points: {},
  overrides: prev.overrides || {}
};

Object.keys(sim.overrides).forEach((k) => {
  const o = sim.overrides[k];
  if (!o || o.until < now) { delete sim.overrides[k]; return; }
  const [dev, code] = k.split('.');
  if (sim.fans[dev]) sim.fans[dev][code] = o.value;
  else if (sim.valves[dev]) sim.valves[dev][code] = o.value;
  else if (sim.room[dev]) sim.room[dev][code] = o.value;
});

// 覆盖后重算总风量
sim.sums.fl_sum_123 = sim.valves['排风阀-1'].fl + sim.valves['排风阀-2'].fl + sim.valves['排风阀-3'].fl;
sim.sums.fl_sum_456 = sim.valves['排风阀-4'].fl + sim.valves['排风阀-5'].fl + sim.valves['排风阀-6'].fl;

function put(dev, code, value, unit, addr) {
  sim.points[dev + '.' + code] = { device: dev, code, value, unit, protocolAddress: addr };
}
put('排风机-1','pfyl', sim.fans['排风机-1'].pfyl, 'Pa', 1);
put('排风机-1','fjpl', sim.fans['排风机-1'].fjpl, 'Hz', 2);
put('排风机-2','pfyl', sim.fans['排风机-2'].pfyl, 'Pa', 3);
put('排风机-2','fjpl', sim.fans['排风机-2'].fjpl, 'Hz', 4);
for (let i = 1; i <= 6; i++) {
  const a = 5 + (i - 1) * 2;
  const name = '排风阀-' + i;
  put(name, 'fl', sim.valves[name].fl, 'm³/h', a);
  put(name, 'kd', sim.valves[name].kd, '%', a + 1);
}
put('温湿压-1','wd', sim.room['温湿压-1'].wd, '℃', 17);
put('温湿压-1','sd', sim.room['温湿压-1'].sd, '%', 18);
put('温湿压-1','yc', sim.room['温湿压-1'].yc, 'Pa', 19);
put('系统命令','cmd_normal', 0, '-', 20);
put('系统命令','cmd_standby', 0, '-', 21);
put('系统状态','mode_status', normal ? 0 : 1, '-', 22);
put('排风汇总','fl_sum_123', sim.sums.fl_sum_123, 'm³/h', 23);
put('排风汇总','fl_sum_456', sim.sums.fl_sum_456, 'm³/h', 24);

function toReg(v) {
  let n = Math.round(Number(v));
  if (!Number.isFinite(n)) n = 0;
  if (n < 0) n = (n + 65536) & 0xFFFF;
  return n & 0xFFFF;
}
const order = [
  ['排风机-1','pfyl'], ['排风机-1','fjpl'],
  ['排风机-2','pfyl'], ['排风机-2','fjpl'],
  ['排风阀-1','fl'], ['排风阀-1','kd'],
  ['排风阀-2','fl'], ['排风阀-2','kd'],
  ['排风阀-3','fl'], ['排风阀-3','kd'],
  ['排风阀-4','fl'], ['排风阀-4','kd'],
  ['排风阀-5','fl'], ['排风阀-5','kd'],
  ['排风阀-6','fl'], ['排风阀-6','kd'],
  ['温湿压-1','wd'], ['温湿压-1','sd'], ['温湿压-1','yc'],
  ['系统命令','cmd_normal'], ['系统命令','cmd_standby'], ['系统状态','mode_status'],
  ['排风汇总','fl_sum_123'], ['排风汇总','fl_sum_456']
];
const regs = [];
const bytes = [];
for (let i = 0; i < order.length; i++) {
  const p = sim.points[order[i][0] + '.' + order[i][1]];
  const r = toReg(p.value);
  regs.push(r);
  bytes.push((r >> 8) & 0xFF, r & 0xFF);
}

// 历史：约 0.5s 一点，保留约 20 分钟；过渡期内中间值自然入历史
const hist = global.get('vavHistory') || [];
hist.push({
  t: now,
  mode: mode,
  transitioning: transitioning ? 1 : 0,
  pfyl1: sim.fans['排风机-1'].pfyl,
  pfyl2: sim.fans['排风机-2'].pfyl,
  fjpl1: sim.fans['排风机-1'].fjpl,
  fjpl2: sim.fans['排风机-2'].fjpl,
  fl1: sim.valves['排风阀-1'].fl,
  fl2: sim.valves['排风阀-2'].fl,
  fl3: sim.valves['排风阀-3'].fl,
  fl4: sim.valves['排风阀-4'].fl,
  fl5: sim.valves['排风阀-5'].fl,
  fl6: sim.valves['排风阀-6'].fl,
  fl_sum_123: sim.sums.fl_sum_123,
  fl_sum_456: sim.sums.fl_sum_456,
  kd1: sim.valves['排风阀-1'].kd,
  yc: sim.room['温湿压-1'].yc,
  modeStatus: normal ? 0 : 1,
  sp: Math.round(spCenter)
});
while (hist.length > 2400) hist.shift();
global.set('vavHistory', hist);

sim.holdingRegisters = regs;
global.set('vavSim', sim);
global.set('vavMode', mode);
global.set('vavHoldingRegisters', regs);

const writeMsg = {
  topic: 'vavSim/' + mode + (transitioning ? '/ramping' : ''),
  mode: mode,
  transitioning: transitioning,
  registers: regs,
  payload: { value: bytes, register: 'holding', address: 0, disableMsgOutput: 1 }
};
return writeMsg;
