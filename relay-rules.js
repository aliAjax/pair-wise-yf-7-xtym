// relay-rules.js —— 接力传档的业务规则
// 负责：纸张格子、字模唯一键、导出资料的组装、导入资料的校验与合并。
// 不接触 DOM、localStorage 与文件读写，方便单独核对规则。

const RELAY_FORMAT = "movable-type-workshop-relay";
const RELAY_VERSION = 1;

const PAPER_GRIDS = {
  postcard: { cols: 16, rows: 10 },
  bookmark: { cols: 7, rows: 18 },
  square: { cols: 12, rows: 12 }
};

const WEAR_LEVELS = ["新", "微磨", "旧痕"];
const FLOW_MODES = ["horizontal", "vertical"];
const SIZE_MIN = 8;
const SIZE_MAX = 72;
const QUANTITY_MIN = 1;
const QUANTITY_MAX = 99;
const GRID_GAP_MIN = 4;
const GRID_GAP_MAX = 18;

function getPaperGrid(paperSize) {
  return PAPER_GRIDS[paperSize] || null;
}

// 按 字符/风格/字号/磨损 判定两枚字模是否重复
function typeKey(type) {
  return [type.char, type.style, type.size, type.wear].join("");
}

// 收集落字用到的字模，未用库存不导出；顺序沿用库存顺序
function collectUsedTypes(inventory, placements) {
  const usedIds = new Set(placements.map((item) => item.typeId));
  return inventory
    .filter((item) => usedIds.has(item.id))
    .map((item) => ({
      char: item.char,
      style: item.style,
      size: item.size,
      quantity: item.quantity,
      wear: item.wear
    }));
}

// 组装接力档：只带落字用到的字模资料、纸张设置和作品名
function buildRelayPayload(state) {
  const usedTypes = collectUsedTypes(state.inventory, state.placements);
  const keyIndex = new Map(usedTypes.map((type, index) => [typeKey(type), index]));
  const inventoryById = new Map(state.inventory.map((item) => [item.id, item]));
  const placements = state.placements
    .filter((placement) => inventoryById.has(placement.typeId)) // 跳过悬空引用
    .map((placement) => ({
      row: placement.row,
      col: placement.col,
      typeIndex: keyIndex.get(typeKey(inventoryById.get(placement.typeId)))
    }))
    .sort((a, b) => a.row - b.row || a.col - b.col);

  return {
    format: RELAY_FORMAT,
    version: RELAY_VERSION,
    workTitle: state.settings.workTitle,
    paper: {
      paperSize: state.settings.paperSize,
      flowMode: state.settings.flowMode,
      gridGap: state.settings.gridGap
    },
    types: usedTypes,
    placements
  };
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIntegerInRange(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

// 同类问题最多各举三例，避免清单过长
function takeExamples(list) {
  return list.slice(0, 3).join("；") + (list.length > 3 ? ` 等${list.length}处` : "");
}

// 先检查版本、格子和字模资料；格式旧、越界或资料缺失时返回原因
// 校验通过后返回归一化后的资料，当前版面与草稿由调用方保持原样
function validateRelayPayload(input) {
  const errors = [];

  if (!isPlainObject(input)) {
    return { ok: false, errors: ["文件内容不是可识别的接力档（缺少 JSON 结构）。"] };
  }
  if (input.format !== RELAY_FORMAT) {
    return { ok: false, errors: ["不是活字工坊的接力档，资料来源无法确认。"] };
  }
  if (typeof input.version !== "number") {
    return { ok: false, errors: ["缺少版本号，无法判断接力档格式。"] };
  }
  if (input.version < RELAY_VERSION) {
    return { ok: false, errors: [`接力档格式过旧（v${input.version}），当前需要 v${RELAY_VERSION}，请用新版重新导出。`] };
  }
  if (input.version > RELAY_VERSION) {
    return { ok: false, errors: [`接力档版本过新（v${input.version}），当前仅支持 v${RELAY_VERSION}。`] };
  }

  const paper = input.paper;
  if (!isPlainObject(paper)) {
    errors.push("缺少纸张设置。");
  } else {
    const grid = getPaperGrid(paper.paperSize);
    if (!grid) errors.push(`纸张规格无法识别（${String(paper.paperSize)}）。`);
    if (!FLOW_MODES.includes(paper.flowMode)) errors.push("排版方向无法识别。");
    if (!isIntegerInRange(paper.gridGap, GRID_GAP_MIN, GRID_GAP_MAX)) {
      errors.push(`格子间距越界，应为 ${GRID_GAP_MIN}–${GRID_GAP_MAX} 的整数。`);
    }
  }

  const rawTypes = input.types;
  const types = [];
  if (!Array.isArray(rawTypes)) {
    errors.push("缺少字模资料。");
  } else {
    const seenKeys = new Map();
    const badTypes = [];
    rawTypes.forEach((raw, index) => {
      if (!isPlainObject(raw)) {
        badTypes.push(`第${index + 1}枚字模资料缺失`);
        return;
      }
      const char = typeof raw.char === "string" ? raw.char.trim() : "";
      const style = typeof raw.style === "string" ? raw.style.trim() : "";
      const wear = WEAR_LEVELS.includes(raw.wear) ? raw.wear : null;
      if (
        !char ||
        !style ||
        !wear ||
        !isIntegerInRange(raw.size, SIZE_MIN, SIZE_MAX) ||
        !isIntegerInRange(raw.quantity, QUANTITY_MIN, QUANTITY_MAX)
      ) {
        badTypes.push(`第${index + 1}枚（${char || "无字"}）字段缺失或越界`);
        return;
      }
      const type = { char, style, size: raw.size, quantity: raw.quantity, wear };
      const key = typeKey(type);
      if (seenKeys.has(key)) {
        badTypes.push(`第${index + 1}枚（${char}·${style}）与第${seenKeys.get(key) + 1}枚重复`);
        return;
      }
      seenKeys.set(key, index);
      types.push(type);
    });
    if (badTypes.length) errors.push(`字模资料有问题：${takeExamples(badTypes)}。`);
  }

  const grid = isPlainObject(paper) ? getPaperGrid(paper.paperSize) : null;
  const rawPlacements = input.placements;
  const placements = [];
  if (!Array.isArray(rawPlacements)) {
    errors.push("缺少版面落字资料。");
  } else if (grid) {
    const occupied = new Set();
    const badPlacements = [];
    const outOfBounds = [];
    const overlaps = [];
    rawPlacements.forEach((raw) => {
      if (
        !isPlainObject(raw) ||
        !Number.isInteger(raw.row) ||
        !Number.isInteger(raw.col) ||
        !Number.isInteger(raw.typeIndex)
      ) {
        badPlacements.push("存在字段缺失的落字");
        return;
      }
      if (raw.typeIndex < 0 || raw.typeIndex >= types.length) {
        badPlacements.push(`第${raw.row + 1}行第${raw.col + 1}列引用的字模资料缺失`);
        return;
      }
      if (raw.row < 0 || raw.row >= grid.rows || raw.col < 0 || raw.col >= grid.cols) {
        outOfBounds.push(`第${raw.row + 1}行第${raw.col + 1}列`);
        return;
      }
      const key = `${raw.row}:${raw.col}`;
      if (occupied.has(key)) {
        overlaps.push(`第${raw.row + 1}行第${raw.col + 1}列`);
        return;
      }
      occupied.add(key);
      placements.push({ row: raw.row, col: raw.col, typeIndex: raw.typeIndex });
    });
    if (badPlacements.length) errors.push(`版面资料有问题：${takeExamples([...new Set(badPlacements)])}。`);
    if (outOfBounds.length) errors.push(`落字超出纸张格子：${takeExamples([...new Set(outOfBounds)])}。`);
    if (overlaps.length) errors.push(`同一格重复落字：${takeExamples([...new Set(overlaps)])}。`);
  }

  if (errors.length) return { ok: false, errors };

  const title = typeof input.workTitle === "string" ? input.workTitle.trim() : "";
  return {
    ok: true,
    data: {
      workTitle: title,
      paper: {
        paperSize: paper.paperSize,
        flowMode: paper.flowMode,
        gridGap: paper.gridGap
      },
      types,
      placements: placements.sort((a, b) => a.row - b.row || a.col - b.col)
    }
  };
}

// 按 字符、风格、字号和磨损 合并重复字模，数量取两边较多的一份；
// 再把版面接到新字模编号。返回合并结果，由调用方写入库存并留成草稿。
function mergeRelayData(state, data) {
  const inventory = [...state.inventory];
  const idByKey = new Map(inventory.map((item) => [typeKey(item), item.id]));
  let addedTypes = 0;
  let mergedTypes = 0;

  data.types.forEach((type) => {
    const key = typeKey(type);
    const existingId = idByKey.get(key);
    if (existingId) {
      const index = inventory.findIndex((item) => item.id === existingId);
      const existing = inventory[index];
      if (type.quantity > existing.quantity) {
        inventory[index] = { ...existing, quantity: type.quantity }; // 不改动原 state 的对象
      }
      mergedTypes += 1;
    } else {
      const id = crypto.randomUUID();
      inventory.push({ id, ...type });
      idByKey.set(key, id);
      addedTypes += 1;
    }
  });

  const placements = data.placements.map((placement) => ({
    row: placement.row,
    col: placement.col,
    typeId: idByKey.get(typeKey(data.types[placement.typeIndex]))
  }));

  return {
    inventory,
    draft: {
      id: crypto.randomUUID(),
      title: data.workTitle || "未命名作品",
      settings: { ...structuredClone(data.paper), workTitle: data.workTitle },
      placements,
      savedAt: new Date().toISOString(),
      relay: true
    },
    stats: {
      addedTypes,
      mergedTypes,
      placements: placements.length
    }
  };
}

// 暴露给 app.js 与另外两个接力文件（经典脚本共享全局）
window.RelayRules = {
  RELAY_FORMAT,
  RELAY_VERSION,
  getPaperGrid,
  typeKey,
  buildRelayPayload,
  validateRelayPayload,
  mergeRelayData
};
