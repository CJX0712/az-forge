/* _smoke.js —— 从 index.html 抽取引擎，无头跑全部断言 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const dir = __dirname;

const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
const m = html.match(/<script id="engine">([\s\S]*?)<\/script>/);
if (!m) { console.error("找不到 <script id=engine>"); process.exit(1); }
const sandbox = { console: console, Math: Math, Float64Array: Float64Array, Int8Array: Int8Array, Array: Array };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(m[1], sandbox, { filename: "engine" });
const IDF = sandbox.IDF;
if (!IDF) { console.error("引擎未挂载 IDF"); process.exit(1); }

const C = IDF.C, R = IDF.R, SZ = IDF.SZ;
let pass = 0, fail = 0;
function T(name, cond, info) {
  if (cond) { pass++; console.log("PASS " + name + (info ? "  " + info : "")); }
  else { fail++; console.log("FAIL " + name + (info ? "  " + info : "")); }
}

/* 1 规则 */
{
  const idx = (r, c) => r * 7 + c;
  const mk = (pairs, v) => { const b = new Int8Array(42); for (const i of pairs) b[i] = v; return b; };
  T("四连判定：横/竖/正对角/反对角",
    IDF.winAt(mk([idx(0, 0), idx(0, 1), idx(0, 2), idx(0, 3)], 1), idx(0, 3)) &&
    IDF.winAt(mk([idx(0, 2), idx(1, 2), idx(2, 2), idx(3, 2)], 2), idx(3, 2)) &&
    IDF.winAt(mk([0, 8, 16, 24], 1), 24) &&
    IDF.winAt(mk([idx(0, 3), idx(1, 2), idx(2, 1), idx(3, 0)], 2), idx(3, 0)));
  T("三连不算胜 & 行末不回绕 & 中间断开",
    !IDF.winAt(mk([idx(0, 0), idx(0, 1), idx(0, 2)], 1), idx(0, 2)) &&
    !IDF.winAt(mk([idx(0, 4), idx(0, 5), idx(0, 6), idx(1, 0)], 1), idx(1, 0)) &&
    !IDF.winAt(mk([idx(0, 0), idx(0, 1), idx(0, 3), idx(0, 4)], 1), idx(0, 4)));
  const g = IDF.newGame();
  for (const c of [0, 0, 1, 1, 2, 2, 3]) IDF.play(g, c);
  T("对局横向取胜流程", g.done && g.res === 1, "res=" + g.res);
  const g3 = IDF.newGame();
  for (let i = 0; i < 6; i++) IDF.play(g3, 6);
  T("满列拒绝落子", IDF.play(g3, 6) === false && g3.h[6] === 6);
  let ok = true;
  for (let k = 0; k < 120; k++) {
    const g4 = IDF.newGame(); const rnd = IDF.mulberry32(500 + k); let n = 0;
    while (!g4.done && n < 60) { IDF.play(g4, IDF.randomMove(g4, rnd)); n++; }
    if (!(g4.done && g4.nm <= 42 && g4.res >= 1 && g4.res <= 3)) ok = false;
  }
  T("120 局随机对局均正常终止", ok);
}

/* 2 编码 */
{
  const g = IDF.newGame(); IDF.play(g, 3); IDF.play(g, 5);
  const e = IDF.encode(g);
  let good = true;
  for (let i = 0; i < 42; i++) if (e[i] > 0 && e[42 + i] > 0) good = false;   // 互斥
  for (let i = 0; i < 42; i++) if (g.b[i] && e[i] + e[42 + i] !== 1) good = false; // 覆盖
  T("编码 planes：两通道互斥且覆盖所有棋子", good);
}

/* 3 网络形状与前向 */
{
  const net = IDF.createNet({ K: 16, nb: 2, seed: 1 });
  T("参数量 = 12246", IDF.nParams(net) === 12246, "n=" + IDF.nParams(net));
  const g = IDF.newGame();
  const f = IDF.forward(net, IDF.encode(g), null, false);
  let s = 0, fin = true;
  for (let i = 0; i < C; i++) { s += f.probs[i]; if (!isFinite(f.probs[i])) fin = false; }
  T("policy 概率和为 1 且有限", Math.abs(s - 1) < 1e-12 && fin, "Σp=" + s.toFixed(15));
  T("value ∈ (-1,1)", f.v > -1 && f.v < 1 && isFinite(f.v), "v=" + f.v.toFixed(6));
  // mask
  const g2 = IDF.newGame();
  for (let i = 0; i < 6; i++) IDF.play(g2, 0);
  const msk = new Float64Array(C); for (let c = 0; c < C; c++) msk[c] = g2.h[c] < R ? 1 : 0;
  const f2 = IDF.forward(net, IDF.encode(g2), msk, false);
  T("mask 后满列概率为 0", f2.probs[0] < 1e-9, "p[0]=" + f2.probs[0].toExponential(2));
  const f3 = IDF.forward(net, IDF.encode(g), null, false);
  T("前向确定性", f3.v === f.v);
}

/* 4 原语 FD */
{
  const rnd = IDF.mulberry32(5), eps = 1e-6;
  const ci = 2, co = 3, H = 4, Wi = 5, k = 3, pad = 1;
  const x = new Float64Array(ci * H * Wi), w = new Float64Array(co * ci * k * k), bi = new Float64Array(co);
  for (let i = 0; i < x.length; i++) x[i] = rnd() * 2 - 1;
  for (let i = 0; i < w.length; i++) w[i] = (rnd() * 2 - 1) * 0.4;
  const Ho = H + 2 * pad - k + 1, Wo = Wi + 2 * pad - k + 1, sp = Ho * Wo;
  const sc = new Float64Array(co * sp); for (let i = 0; i < sc.length; i++) sc[i] = rnd() * 2 - 1;
  const out = new Float64Array(co * sp);
  const cf = () => { IDF.convF(x, w, bi, ci, co, H, Wi, k, pad, out); let s = 0; for (let i = 0; i < sc.length; i++) s += sc[i] * out[i]; return s; };
  const dX = new Float64Array(ci * H * Wi), dW = new Float64Array(w.length), dB = new Float64Array(co);
  IDF.convB(x, w, sc, ci, co, H, Wi, k, pad, dX, dW, dB);
  let mW = 0, mX = 0;
  for (let i = 0; i < w.length; i++) { const o = w[i]; w[i] = o + eps; const a = cf(); w[i] = o - eps; const b = cf(); w[i] = o; mW = Math.max(mW, Math.abs((a - b) / (2 * eps) - dW[i]) / (Math.abs((a - b) / (2 * eps)) + Math.abs(dW[i]) + 1e-12)); }
  for (let i = 0; i < x.length; i++) { const o = x[i]; x[i] = o + eps; const a = cf(); x[i] = o - eps; const b = cf(); x[i] = o; mX = Math.max(mX, Math.abs((a - b) / (2 * eps) - dX[i]) / (Math.abs((a - b) / (2 * eps)) + Math.abs(dX[i]) + 1e-12)); }
  T("卷积原语反向 FD", mW < 1e-5 && mX < 1e-5, "dW=" + mW.toExponential(2) + " dX=" + mX.toExponential(2));
}

/* 5 全网络梯度检验（折点感知 FD 金标准） */
function lossMask(net, planes, piT, z) {
  const f = IDF.forward(net, planes, null, true);
  let ce = 0;
  for (let a = 0; a < C; a++) ce += -piT[a] * Math.log(f.probs[a] + 1e-12);
  const d = f.v - z;
  if (net.cfg.act !== "relu") return { loss: ce + d * d, mask: [] };
  const kk = f.cache, sp2 = net.cfg.H * net.cfg.W, K = net.cfg.K, mm = [];
  const push = (arr, n) => { for (let i = 0; i < n; i++) mm.push(arr[i] > 0 ? 1 : 0); };
  push(kk.cin, K * sp2);
  for (const b of kk.blk) { push(b.p1, K * sp2); push(b.pre, K * sp2); }
  push(kk.pc, net.cfg.PC * sp2); push(kk.vc, net.cfg.VC * sp2); push(kk.vf1, net.cfg.VH);
  return { loss: ce + d * d, mask: mm };
}
function maskEq(a, b) { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; }
function gradCheck(net, planes, piT, z, eps, kinkAware) {
  IDF.zeroGrads(net);
  const f = IDF.forward(net, planes, null, true);
  const dL = new Float64Array(C); for (let a = 0; a < C; a++) dL[a] = f.probs[a] - piT[a];
  IDF.backward(net, f, dL, 2 * (f.v - z), net.g);
  const m0 = kinkAware ? lossMask(net, planes, piT, z).mask : null;
  let worst = 0, nm = "", inf = 0, kink = 0;
  const sr = IDF.mulberry32(77);
  for (const kn of net.keys) {
    const arr = net.p[kn], g = net.g[kn];
    for (let s = 0; s < 5; s++) {
      const i = Math.floor(sr() * arr.length) % arr.length, o = arr[i];
      let lp, lm;
      if (kinkAware) {
        arr[i] = o + eps; const r1 = lossMask(net, planes, piT, z); lp = r1.loss;
        arr[i] = o - eps; const r2 = lossMask(net, planes, piT, z); lm = r2.loss;
        arr[i] = o;
        if (!maskEq(m0, r1.mask) || !maskEq(m0, r2.mask)) { kink++; continue; }
      } else {
        arr[i] = o + eps; lp = lossMask(net, planes, piT, z).loss;
        arr[i] = o - eps; lm = lossMask(net, planes, piT, z).loss;
        arr[i] = o;
      }
      const num = (lp - lm) / (2 * eps), ana = g[i];
      if (Math.max(Math.abs(num), Math.abs(ana)) <= 1e-8) continue;
      inf++;
      const r = Math.abs(num - ana) / (Math.abs(num) + Math.abs(ana));
      if (r > worst) { worst = r; nm = kn + "[" + i + "]"; }
    }
  }
  return { worst, nm, inf, kink };
}
{
  const cases = [];
  for (let q = 0; q < 3; q++) {
    const g = IDF.newGame(); const rnd = IDF.mulberry32(20 + q);
    for (let s = 0; s < q * 3 + 1; s++) IDF.play(g, IDF.randomMove(g, rnd));
    const pi = new Float64Array(C); const lg = IDF.legal(g); for (const c of lg) pi[c] = 1 / lg.length;
    cases.push({ planes: IDF.encode(g), pi: pi, z: q === 0 ? 1 : (q === 1 ? -1 : 0) });
  }
  // 5a. 光滑激活（无折点，严格全参数）
  for (const act of ["tanh", "id"]) {
    const net = IDF.createNet({ K: 16, nb: 2, seed: 7, act: act });
    let w = 0, nm = "", inf = 0;
    for (const cs of cases) { const r = gradCheck(net, cs.planes, cs.pi, cs.z, 1e-6, false); if (r.worst > w) { w = r.worst; nm = r.nm; } inf += r.inf; }
    T("全网络梯度检验·" + act + "（FD 金标准）", w < 1e-4 && inf >= 20, "maxRel=" + w.toExponential(2) + " @" + nm + " 样本=" + inf);
  }
  // 5b. 实际训练用的 ReLU 网络（跳过跨折点、FD 数学上不可测的参数）
  {
    const net = IDF.createNet({ K: 16, nb: 2, seed: 7, act: "relu" });
    let w = 0, nm = "", inf = 0, kink = 0;
    for (const cs of cases) { const r = gradCheck(net, cs.planes, cs.pi, cs.z, 1e-6, true); if (r.worst > w) { w = r.worst; nm = r.nm; } inf += r.inf; kink += r.kink; }
    T("全网络梯度检验·relu（折点感知）", w < 1e-4 && inf >= 20, "maxRel=" + w.toExponential(2) + " @" + nm + " 有效=" + inf + " 折点跳过=" + kink);
  }
}

/* 6 MCTS 不变量 */
{
  const net = IDF.createNet({ K: 16, nb: 2, seed: 3 });
  const g = IDF.newGame();
  for (const c of [3, 3, 4]) IDF.play(g, c);
  const root = IDF.runMCTS(net, g, { sims: 80 });
  let s = 0, bad = 0;
  for (let c = 0; c < C; c++) { s += root.N[c]; if (g.h[c] >= R && root.N[c] !== 0) bad++; }
  T("MCTS Σ访问 = 模拟次数", s === 80, "ΣN=" + s);
  T("MCTS 非法列访问为 0", bad === 0);
  const pi = IDF.piFromVisits(root, 1);
  let ps = 0; for (let c = 0; c < C; c++) ps += pi[c];
  T("π 归一化 = 1", Math.abs(ps - 1) < 1e-12);
  const pi0 = IDF.piFromVisits(root, 0);
  let cnt = 0; for (let c = 0; c < C; c++) if (pi0[c] > 0) cnt++;
  T("τ→0 退化为 one-hot", cnt === 1);
}

/* 7 战术 */
{
  const net = IDF.createNet({ K: 16, nb: 2, seed: 11 });
  const idx = (r, c) => r * 7 + c;
  const mk = (pairs, v) => { const b = new Int8Array(42); for (const i of pairs) b[i] = v; return b; };
  let a, bst, bn;
  a = IDF.runMCTS(net, IDF.gameFrom(mk([idx(0, 0), idx(0, 1), idx(0, 2)], 1), 1), { sims: 200 });
  bst = -1; bn = -1; for (const c of a.legal) if (a.N[c] > bn) { bn = a.N[c]; bst = c; }
  T("战术·一步胜（横向）→ col3", bst === 3, "Q=" + a.Q[bst].toFixed(3));
  a = IDF.runMCTS(net, IDF.gameFrom(mk([idx(0, 0), idx(1, 0), idx(2, 0)], 1), 1), { sims: 200 });
  bst = -1; bn = -1; for (const c of a.legal) if (a.N[c] > bn) { bn = a.N[c]; bst = c; }
  T("战术·一步胜（纵向）→ col0", bst === 0, "Q=" + a.Q[bst].toFixed(3));
  // 必防需深度-2 搜索（X 走错 → O 一步胜），模拟数要足够
  a = IDF.runMCTS(net, IDF.gameFrom(mk([idx(0, 0), idx(0, 1), idx(0, 2)], 2), 1), { sims: 500 });
  bst = -1; bn = -1; for (const c of a.legal) if (a.N[c] > bn) { bn = a.N[c]; bst = c; }
  T("战术·必防 → 堵 col3", bst === 3, "选=" + bst + " Q=" + a.Q[bst].toFixed(3));
}

/* 8 镜像增强 */
{
  const sp = IDF.selfPlay(IDF.createNet({ seed: 1 }), { sims: 8, rnd: IDF.mulberry32(2) });
  T("镜像增强：样本成对", sp.hist.length % 2 === 0, "n=" + sp.hist.length);
  let ok = true;
  for (let k = 0; k < sp.hist.length; k += 2) {
    for (let c = 0; c < C; c++) if (Math.abs(sp.hist[k].pi[c] - sp.hist[k + 1].pi[C - 1 - c]) > 1e-12) ok = false;
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++)
      if (sp.hist[k].planes[r * C + c] !== sp.hist[k + 1].planes[r * C + C - 1 - c]) ok = false;
  }
  T("镜像增强：planes 与 π 严格互为镜像", ok);
}

/* 9 训练能降低 loss */
{
  const net = IDF.createNet({ K: 16, nb: 2, seed: 4 });
  const buf = []; const rnd = IDF.mulberry32(9);
  for (let i = 0; i < 3; i++) { const sp = IDF.selfPlay(net, { sims: 16, rnd: rnd }); for (const h of sp.hist) buf.push(h); }
  let first = 0;
  for (let s = 0; s < 30; s++) {
    const b = []; for (let i = 0; i < 24; i++) b.push(buf[Math.floor(rnd() * buf.length)]);
    const L = IDF.trainStep(net, b, 3e-3, 1e-4);
    if (s < 5) first += L / 5;
    if (s >= 25) first -= L / 5;
  }
  T("训练使 loss 下降", first > 0, "Δloss=" + first.toFixed(4));
}

console.log("\n=== " + pass + " / " + (pass + fail) + (fail === 0 ? "  ALL GREEN" : "  HAS FAILURES") + " ===");
process.exit(fail === 0 ? 0 : 1);
