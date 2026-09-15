/* _uicheck.js —— DOM stub 端到端：加载 index.html 的 engine+ui，模拟点击与自检 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const dir = __dirname;

const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
const me = html.match(/<script id="engine">([\s\S]*?)<\/script>/);
const mu = html.match(/<script id="ui">([\s\S]*?)<\/script>/);
if (!me || !mu) { console.error("index.html 缺少 engine/ui 脚本"); process.exit(1); }

let pass = 0, fail = 0;
function T(n, c, i) { if (c) { pass++; console.log("PASS " + n + (i ? "  " + i : "")); } else { fail++; console.log("FAIL " + n + (i ? "  " + i : "")); } }

/* ---------- DOM stub ---------- */
const listeners = {};
function makeCtx(el) {
  const noop = () => { };
  return {
    canvas: el, fillStyle: "", strokeStyle: "", lineWidth: 1, font: "",
    fillRect: noop, clearRect: noop, beginPath: noop, arc: noop, fill: noop,
    stroke: noop, fillText: noop, moveTo: noop, lineTo: noop, closePath: noop
  };
}
const els = {};
function makeEl(id, tag) {
  const el = {
    tagName: (tag || "div").toUpperCase(), id: id || "", children: [], _ctx: null,
    value: "", textContent: "", className: "", disabled: false,
    clientWidth: 380, clientHeight: 120, width: 0, height: 0, scrollTop: 0, scrollHeight: 0,
    style: {}, classList: { add() { }, remove() { }, toggle() { } },
    appendChild(c) { el.children.push(c); return c; },
    removeChild(c) { const i = el.children.indexOf(c); if (i >= 0) el.children.splice(i, 1); return c; },
    addEventListener(ev, fn) { (listeners[id] = listeners[id] || {})[ev] = fn; },
    getContext() { if (!el._ctx) el._ctx = makeCtx(el); return el._ctx; },   // 必须缓存
    getBoundingClientRect() { return { width: 394, height: 340, left: 0, top: 0 }; }
  };
  Object.defineProperty(el, "innerHTML", {
    get() { return el.children.map(c => (c._html !== undefined ? c._html : c.innerHTML)).join(""); },
    set(v) { el.children.length = 0; if (v !== "") { const d = makeEl("", "div"); d._html = v; el.children.push(d); } }
  });
  Object.defineProperty(el, "firstChild", { get() { return el.children[0] || null; } });
  Object.defineProperty(el, "childNodes", { get() { return el.children; } });
  return el;
}
const IDS = ["board", "visits", "curve", "log", "testOut", "testSum", "stTurn", "stGames", "stSteps",
  "stBuf", "stLoss", "stWin", "stGrd", "btnNew", "btnReset", "btnTrain", "btnStop", "btnEval",
  "btnTest", "simsSel", "iterIn"];
for (const id of IDS) els[id] = makeEl(id, id === "board" || id === "visits" || id === "curve" ? "canvas" : "div");
els.simsSel.value = "40"; els.iterIn.value = "3";

const document = {
  readyState: "complete",
  getElementById: (id) => els[id] || (els[id] = makeEl(id)),
  createElement: (t) => makeEl("", t),
  addEventListener: () => { }
};

const sandbox = {
  console: console, Math: Math, Date: Date, Promise: Promise, setTimeout: setTimeout,
  clearTimeout: clearTimeout, Float64Array: Float64Array, Int8Array: Int8Array, Array: Array,
  JSON: JSON, document: document, isFinite: isFinite, String: String, Number: Number, Object: Object
};
sandbox.globalThis = sandbox;
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(me[1], sandbox, { filename: "engine" });
T("引擎脚本可执行（<script id=engine>）", !!sandbox.IDF);

let uiErr = null;
try { vm.runInContext(mu[1], sandbox, { filename: "ui" }); } catch (e) { uiErr = e; }
T("UI 脚本可执行（无顶层语法/引用错误）", !uiErr, uiErr ? String(uiErr.message).slice(0, 120) : "");

const $ = (id) => els[id];
T("棋盘画布已初始化尺寸", $("board").width > 0 && $("board").height > 0,
  $("board").width + "x" + $("board").height);
T("日志有启动输出", $("log").children.length > 0, $("log").children.length + " 行");
T("状态栏已渲染", String($("stTurn").innerHTML).length > 0, String($("stTurn").innerHTML).replace(/<[^>]+>/g, ""));

/* 点击棋盘 → 人类落子 + AI 应答 */
const before = $("log").children.length;
const click = listeners.board && listeners.board.click;
T("棋盘已绑定 click", !!click);
if (click) click({ clientX: 3 * 54 + 8 + 20, clientY: 100 });
const moved = $("stTurn").innerHTML.indexOf("AI") >= 0 || $("stTurn").innerHTML.indexOf("轮到你") >= 0;
T("点击后对局状态仍可读", moved, String($("stTurn").innerHTML).replace(/<[^>]+>/g, ""));

/* 自检 */
$("btnTest").onclick();
const out = String($("testOut").innerHTML);
const noFail = out.indexOf("✗") < 0;
const cnt = (out.match(/✓/g) || []).length;
T("UI 自检面板有输出", out.length > 0, cnt + " 项通过");
T("UI 自检全部通过（无 ✗）", noFail, String($("testSum").innerHTML).replace(/<[^>]+>/g, ""));

/* 训练：启动 → 推进若干 tick → 停止 */
$("btnTrain").onclick();
T("训练按钮：开始后禁用、停止可用", $("btnTrain").disabled === true && $("btnStop").disabled === false);

(async () => {
  await new Promise((r) => setTimeout(r, 2500));
  const games = parseInt(String($("stGames").textContent), 10);
  const steps = parseInt(String($("stSteps").textContent), 10);
  T("训练推进：自我对弈局数 > 0", games > 0, "局数=" + games);
  T("训练推进：梯度步 > 0", steps > 0, "步数=" + steps);
  T("loss 已记录", String($("stLoss").textContent) !== "—", "loss=" + $("stLoss").textContent);
  T("样本缓冲 > 0", parseInt(String($("stBuf").textContent), 10) > 0);
  $("btnStop").onclick();
  await new Promise((r) => setTimeout(r, 300));
  T("停止后按钮状态复位", $("btnTrain").disabled === false && $("btnStop").disabled === true);

  /* 评估 */
  $("btnEval").onclick();
  await new Promise((r) => setTimeout(r, 1500));
  T("评估写入 vs 随机 / vs 贪心", String($("stWin").textContent).indexOf("%") > 0 && String($("stGrd").textContent).indexOf("%") > 0,
    "随机=" + $("stWin").textContent + " 贪心=" + $("stGrd").textContent);

  /* 新对局 / 重置 */
  $("btnNew").onclick();
  T("新对局可用", true);
  $("btnReset").onclick();
  T("重置网络可用", String($("stGames").textContent) === "0");

  console.log("\n=== " + pass + " / " + (pass + fail) + (fail === 0 ? "  ALL GREEN" : "  HAS FAILURES") + " ===");
  process.exit(fail === 0 ? 0 : 1);
})();
