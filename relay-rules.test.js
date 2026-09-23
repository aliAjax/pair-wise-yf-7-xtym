const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const vm = require("node:vm");

// 给浏览器脚本搭一个最小沙箱
const sandbox = {
  window: {},
  crypto: { randomUUID: () => `uuid-${Math.random().toString(16).slice(2)}` },
  structuredClone: (v) => JSON.parse(JSON.stringify(v))
};
sandbox.window.crypto = sandbox.crypto;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(`${__dirname}/relay-rules.js`, "utf8"), sandbox);
const R = sandbox.window.RelayRules;

const stateWith = (inventory, placements, settings = {}) => ({
  inventory,
  placements,
  settings: { paperSize: "postcard", flowMode: "horizontal", gridGap: 8, workTitle: "晚风小笺", ...settings }
});

const mkType = (id, char, style, size, quantity, wear) => ({ id, char, style, size, quantity, wear });

test("导出只带落字用到的字模与纸张设置、作品名", () => {
  const used = mkType("t1", "山", "宋体旧字", 30, 4, "微磨");
  const unused = mkType("t2", "花", "楷体木刻", 28, 2, "新");
  const state = stateWith([used, unused], [{ row: 0, col: 0, typeId: "t1" }]);
  const payload = R.buildRelayPayload(state);
  assert.strictEqual(payload.format, "movable-type-workshop-relay");
  assert.strictEqual(payload.version, 1);
  assert.deepEqual(payload.types, [{ char: "山", style: "宋体旧字", size: 30, quantity: 4, wear: "微磨" }]);
  assert.deepEqual(payload.placements, [{ row: 0, col: 0, typeIndex: 0 }]);
  assert.deepEqual(payload.paper, { paperSize: "postcard", flowMode: "horizontal", gridGap: 8 });
  assert.strictEqual(payload.workTitle, "晚风小笺");
  assert.ok(!("drafts" in payload) && !("selectedTypeId" in payload));
});

test("有效档：同键字模数量取较多值，版面接到新编号，留成草稿", () => {
  const existing = mkType("t1", "山", "宋体旧字", 30, 2, "微磨"); // 库存数量较少
  const state = stateWith([existing], [], { workTitle: "旧作" });
  const payload = {
    format: "movable-type-workshop-relay",
    version: 1,
    workTitle: "晚风小笺",
    paper: { paperSize: "postcard", flowMode: "vertical", gridGap: 10 },
    types: [
      { char: "山", style: "宋体旧字", size: 30, quantity: 4, wear: "微磨" }, // 档内更多
      { char: "月", style: "宋体旧字", size: 30, quantity: 1, wear: "旧痕" } // 新字模
    ],
    placements: [
      { row: 0, col: 0, typeIndex: 0 },
      { row: 0, col: 1, typeIndex: 1 }
    ]
  };
  const verdict = R.validateRelayPayload(payload);
  assert.strictEqual(verdict.ok, true, JSON.stringify(verdict.errors));
  const merged = R.mergeRelayData(state, verdict.data);
  assert.strictEqual(merged.inventory.length, 2);
  assert.strictEqual(merged.inventory[0].quantity, 4, "数量应取档内较多的 4");
  assert.strictEqual(merged.inventory[1].char, "月");
  assert.deepEqual(
    merged.draft.placements.map((p) => ({ row: p.row, col: p.col, typeId: p.typeId })),
    [
      { row: 0, col: 0, typeId: "t1" },
      { row: 0, col: 1, typeId: merged.inventory[1].id }
    ]
  );
  assert.strictEqual(merged.draft.title, "晚风小笺");
  assert.strictEqual(merged.draft.settings.flowMode, "vertical");
  assert.strictEqual(merged.draft.settings.workTitle, "晚风小笺", "草稿设置应带作品名，载入时不丢");
  assert.strictEqual(merged.draft.relay, true);
  assert.deepEqual(merged.stats, { addedTypes: 1, mergedTypes: 1, placements: 2 });
  assert.strictEqual(state.inventory[0].quantity, 2, "merge 不直接改原 state（由页面提交）");
});

test("校验失败：格式旧", () => {
  const v = R.validateRelayPayload({ format: "movable-type-workshop-relay", version: 0 });
  assert.strictEqual(v.ok, false);
  assert.match(v.errors[0], /格式过旧/);
});

test("校验失败：版本过新", () => {
  const v = R.validateRelayPayload({ format: "movable-type-workshop-relay", version: 9 });
  assert.strictEqual(v.ok, false);
  assert.match(v.errors[0], /版本过新/);
});

test("校验失败：来源不对 / 缺版本 / 非对象", () => {
  assert.match(R.validateRelayPayload({ format: "other", version: 1 }).errors[0], /不是活字工坊/);
  assert.match(R.validateRelayPayload({ format: "movable-type-workshop-relay" }).errors[0], /缺少版本号/);
  assert.match(R.validateRelayPayload(null).errors[0], /JSON 结构/);
  assert.match(R.validateRelayPayload("x").errors[0], /JSON 结构/);
});

test("校验失败：格子越界", () => {
  const base = {
    format: "movable-type-workshop-relay",
    version: 1,
    workTitle: "x",
    paper: { paperSize: "bookmark", flowMode: "horizontal", gridGap: 8 }, // 7列18行
    types: [{ char: "山", style: "宋", size: 20, quantity: 1, wear: "新" }],
    placements: [{ row: 5, col: 8, typeIndex: 0 }]
  };
  const v = R.validateRelayPayload(base);
  assert.strictEqual(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes("超出纸张格子")));
});

test("校验失败：字模资料缺失 / 字段越界 / 档内重复", () => {
  const base = {
    format: "movable-type-workshop-relay",
    version: 1,
    workTitle: "x",
    paper: { paperSize: "postcard", flowMode: "horizontal", gridGap: 8 },
    types: [
      { char: "山", style: "宋", size: 999, quantity: 1, wear: "新" }, // 字号越界
      { char: "月", style: "宋", size: 20, quantity: 1, wear: "新" },
      { char: "月", style: "宋", size: 20, quantity: 2, wear: "新" }, // 同键重复
      null // 资料缺失
    ],
    placements: []
  };
  const v = R.validateRelayPayload(base);
  assert.strictEqual(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes("字模资料有问题")));
});

test("校验失败：落字引用缺失字模", () => {
  const base = {
    format: "movable-type-workshop-relay",
    version: 1,
    workTitle: "x",
    paper: { paperSize: "postcard", flowMode: "horizontal", gridGap: 8 },
    types: [{ char: "山", style: "宋", size: 20, quantity: 1, wear: "新" }],
    placements: [{ row: 0, col: 0, typeIndex: 5 }]
  };
  const v = R.validateRelayPayload(base);
  assert.strictEqual(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes("引用的字模资料缺失")));
});

test("校验失败：同格重复落字", () => {
  const base = {
    format: "movable-type-workshop-relay",
    version: 1,
    workTitle: "x",
    paper: { paperSize: "postcard", flowMode: "horizontal", gridGap: 8 },
    types: [{ char: "山", style: "宋", size: 20, quantity: 5, wear: "新" }],
    placements: [
      { row: 0, col: 0, typeIndex: 0 },
      { row: 0, col: 0, typeIndex: 0 }
    ]
  };
  const v = R.validateRelayPayload(base);
  assert.strictEqual(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes("同一格重复落字")));
});

test("校验失败：纸张/间距/方向无法识别", () => {
  const mk = (paper) => ({
    format: "movable-type-workshop-relay",
    version: 1,
    workTitle: "x",
    paper,
    types: [],
    placements: []
  });
  assert.ok(!R.validateRelayPayload(mk({ paperSize: "A4", flowMode: "horizontal", gridGap: 8 })).ok);
  assert.ok(!R.validateRelayPayload(mk({ paperSize: "postcard", flowMode: "sideways", gridGap: 8 })).ok);
  assert.ok(!R.validateRelayPayload(mk({ paperSize: "postcard", flowMode: "horizontal", gridGap: 99 })).ok);
  assert.ok(!R.validateRelayPayload(mk(undefined)).ok);
});

test("往返一致：导出后导入可重建版面", () => {
  const types = [
    mkType("a", "山", "宋体旧字", 30, 4, "微磨"),
    mkType("b", "雨", "仿宋细字", 22, 4, "新"),
    mkType("c", "花", "楷体木刻", 28, 2, "新") // 未使用，不应导出
  ];
  const state = stateWith(types, [
    { row: 9, col: 15, typeId: "a" },
    { row: 0, col: 0, typeId: "b" },
    { row: 1, col: 1, typeId: "a" }
  ]);
  const payload = R.buildRelayPayload(state);
  const fresh = stateWith([], [], {});
  const verdict = R.validateRelayPayload(payload);
  assert.strictEqual(verdict.ok, true);
  const merged = R.mergeRelayData(fresh, verdict.data);
  assert.strictEqual(merged.inventory.length, 2, "未用库存未进入档案");
  const byChar = Object.fromEntries(merged.inventory.map((t) => [t.char, t]));
  assert.deepEqual(
    merged.draft.placements
      .map((p) => ({ row: p.row, col: p.col, char: merged.inventory.find((t) => t.id === p.typeId).char }))
      .sort((x, y) => x.row - y.row || x.col - y.col),
    [
      { row: 0, col: 0, char: "雨" },
      { row: 1, col: 1, char: "山" },
      { row: 9, col: 15, char: "山" }
    ]
  );
});

test("空版面也能导出（只带纸张与作品名），导入为空草稿", () => {
  const state = stateWith([mkType("a", "山", "宋", 20, 1, "新")], []);
  const payload = R.buildRelayPayload(state);
  assert.deepEqual(payload.types, []);
  assert.deepEqual(payload.placements, []);
  const verdict = R.validateRelayPayload(payload);
  assert.strictEqual(verdict.ok, true);
  const merged = R.mergeRelayData(stateWith([], [], {}), verdict.data);
  assert.strictEqual(merged.draft.placements.length, 0);
});
