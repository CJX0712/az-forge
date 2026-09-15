/* _probe.js —— 人工读数用：训练一局 vs 贪心，打印 ASCII 棋局与 MCTS 分析 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const dir = __dirname;

const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
const m = html.match(/<script id="engine">([\s\S]*?)<\/script>/);
const sandbox = { console: console, Math: Math, Float64Array: Float64Array, Int8Array: Int8Array, Array: Array };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(m[1], sandbox, { filename: "engine" });
const IDF = sandbox.IDF;
const C = IDF.C, R = IDF.R;

const GAMES = parseInt(process.argv[2] || "60", 10);
const net = IDF.createNet({ K: 16, nb: 2, seed: 2026 });
console.log("参数量=" + IDF.nParams(net) + "   自我对弈 " + GAMES + " 局");

function rate(opp, n, rndSeed) {
  return IDF.arena(net, opp, n, { sims: 40, rnd: IDF.mulberry32(rndSeed) });
}

console.log("\n===== 训练前 =====");
const b1 = rate(IDF.randomMove, 20, 11), b2 = rate(IDF.greedyMove, 20, 12);
console.log("vs 随机 得分率 " + (b1.rate * 100).toFixed(1) + "%    vs 贪心 得分率 " + (b2.rate * 100).toFixed(1) + "%");

const buf = [], rnd = IDF.mulberry32(31337);
let loss = 0, ln = 0;
const t0 = Date.now();
for (let gi = 1; gi <= GAMES; gi++) {
  const sp = IDF.selfPlay(net, { sims: 50, rnd: rnd, tempMoves: 8 });
  for (const h of sp.hist) buf.push(h);
  if (buf.length > 12000) buf.splice(0, buf.length - 12000);
  for (let s = 0; s < 5; s++) {
    const b = [];
    for (let i = 0; i < 24; i++) b.push(buf[Math.floor(rnd() * buf.length)]);
    loss += IDF.trainStep(net, b, 2e-3, 1e-4); ln++;
  }
  if (gi % 20 === 0) console.log("  第 " + gi + " 局  loss=" + (loss / ln).toFixed(4));
}
console.log("训练用时 " + ((Date.now() - t0) / 1000).toFixed(1) + "s");

console.log("\n===== 训练后 =====");
const a1 = rate(IDF.randomMove, 20, 11), a2 = rate(IDF.greedyMove, 20, 12);
console.log("vs 随机 得分率 " + (a1.rate * 100).toFixed(1) + "%  (" + a1.win + "胜" + a1.loss + "负" + a1.draw + "平)");
console.log("vs 贪心 得分率 " + (a2.rate * 100).toFixed(1) + "%  (" + a2.win + "胜" + a2.loss + "负" + a2.draw + "平)");
console.log("提升：vs 随机 " + ((a1.rate - b1.rate) * 100).toFixed(1) + " 个百分点，vs 贪心 " + ((a2.rate - b2.rate) * 100).toFixed(1) + " 个百分点");

/* ---- 一局 AI(红,X) vs 贪心(黄,O) ---- */
console.log("\n===== 示范对局：AI 执红(X) vs 贪心基线(O) =====");
{
  const g = IDF.newGame();
  const r = IDF.mulberry32(2024);
  let mv = 0;
  while (!g.done && mv < 42) {
    if (g.turn === 1) {
      const root = IDF.runMCTS(net, g, { sims: 120 });
      let best = -1, bn = -1;
      for (const c of root.legal) if (root.N[c] > bn) { bn = root.N[c]; best = c; }
      IDF.play(g, best);
    } else IDF.play(g, IDF.greedyMove(g, r));
    mv++;
  }
  console.log(IDF.boardStr(g));
  console.log("结果：" + (g.res === 3 ? "平局" : (g.res === 1 ? "AI(红) 胜" : "贪心(黄) 胜")) + "   共 " + mv + " 手");
}

/* ---- MCTS 分析：开局与一个战术局面 ---- */
function showAnalysis(title, g, sims) {
  const root = IDF.runMCTS(net, g, { sims: sims });
  console.log("\n" + title);
  console.log(IDF.boardStr(g));
  const f = IDF.forward(net, IDF.encode(g), null, false);
  console.log("网络估值 v = " + f.v.toFixed(4) + "   (轮到 " + (g.turn === 1 ? "红 X" : "黄 O") + ")");
  let line1 = "列    ", line2 = "N     ", line3 = "Q     ", line4 = "P(先验)";
  for (let c = 0; c < C; c++) {
    line1 += String(c).padStart(7);
    line2 += String(root.N[c]).padStart(7);
    line3 += (g.h[c] >= R ? "   —  " : root.Q[c].toFixed(3).padStart(7));
    line4 += (g.h[c] >= R ? "   —  " : root.P[c].toFixed(3).padStart(7));
  }
  console.log(line1 + "\n" + line2 + "\n" + line3 + "\n" + line4);
}
{
  const g = IDF.newGame();
  showAnalysis("===== MCTS 分析 A：空盘开局 =====", g, 200);

  const idx = (r, c) => r * 7 + c;
  const b = new Int8Array(42);
  b[idx(0, 0)] = 2; b[idx(0, 1)] = 2; b[idx(0, 2)] = 2;   // 黄方底行三连，唯一封堵点 = col3
  showAnalysis("===== MCTS 分析 B：黄方底行三连(列0-2)，红方唯一解 = 堵 col3 =====", IDF.gameFrom(b, 1), 500);

  const b2 = new Int8Array(42);
  b2[idx(0, 1)] = 2; b2[idx(0, 2)] = 2; b2[idx(0, 3)] = 2; // 双威胁：col0 与 col4 都能成四连 → 红方必败
  showAnalysis("===== MCTS 分析 C：黄方双威胁(列1-3)，红方无论堵哪边都输 =====", IDF.gameFrom(b2, 1), 400);
}
