/* 业务规则：交接包的打包、校验与合并挂接 */

const RELAY_APP = "movable-type-workshop-relay";
const RELAY_KIND = "relay";
const RELAY_VERSION = 1;

const PAPER_GRIDS = {
  postcard: { cols: 16, rows: 10 },
  bookmark: { cols: 7, rows: 18 },
  square: { cols: 12, rows: 12 }
};

const PAPER_LABELS = {
  postcard: "明信片",
  bookmark: "书签",
  square: "方形小笺"
};

const WEAR_VALUES = ["新", "微磨", "旧痕"];

const WorkshopRules = {
  RELAY_VERSION,
  PAPER_GRIDS,
  PAPER_LABELS,

  getGrid(paperSize) {
    return PAPER_GRIDS[paperSize] || PAPER_GRIDS.postcard;
  },

  typeSignature(type) {
    return [type.char, type.style, type.size, type.wear].join("|");
  },

  /* 导出：只带落字用到的字模资料、纸张设置和作品名，未用库存不写入 */
  buildRelayPackage(state) {
    const usedTypeIds = new Set(state.placements.map((item) => item.typeId));
    const usedTypes = state.inventory.filter((item) => usedTypeIds.has(item.id));
    const indexById = new Map(usedTypes.map((item, index) => [item.id, index]));
    const settings = state.settings;
    const grid = this.getGrid(settings.paperSize);

    return {
      app: RELAY_APP,
      kind: RELAY_KIND,
      version: RELAY_VERSION,
      exportedAt: new Date().toISOString(),
      workTitle: settings.workTitle,
      settings: {
        paperSize: settings.paperSize,
        flowMode: settings.flowMode,
        gridGap: settings.gridGap
      },
      grid,
      types: usedTypes.map(({ char, style, size, quantity, wear }) => ({
        char,
        style,
        size,
        quantity,
        wear
      })),
      placements: state.placements
        .map(({ row, col, typeId }) => ({ row, col, typeIndex: indexById.get(typeId) }))
        .filter((item) => item.typeIndex !== undefined)
    };
  },

  /* 校验：先查身份与版本，再查格子，最后查字模资料；任一项不过即返回原因 */
  validateRelayPackage(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return { ok: false, errors: ["文件内容不是有效的交接包。"] };
    }
    if (data.app !== RELAY_APP || data.kind !== RELAY_KIND) {
      return { ok: false, errors: ["不是活字排版工坊的交接文件，请确认来源。"] };
    }
    if (data.version !== RELAY_VERSION) {
      return {
        ok: false,
        errors: [`格式版本不受支持（文件为 v${data.version}，本机支持 v${RELAY_VERSION}），请双方使用同一版本。`]
      };
    }

    const settings = data.settings;
    if (!settings || typeof settings !== "object") {
      return { ok: false, errors: ["缺少纸张设置，无法还原版面。"] };
    }
    const grid = PAPER_GRIDS[settings.paperSize];
    if (!grid) {
      return { ok: false, errors: [`纸张类型“${settings.paperSize}”无法识别。`] };
    }
    if (settings.flowMode !== "horizontal" && settings.flowMode !== "vertical") {
      return { ok: false, errors: ["纸张设置中的排字方向无法识别。"] };
    }
    if (!Number.isInteger(settings.gridGap) || settings.gridGap < 4 || settings.gridGap > 18) {
      return { ok: false, errors: ["纸张设置中的网格间距超出允许范围（4–18）。"] };
    }
    if (!data.grid || !Number.isInteger(data.grid.cols) || !Number.isInteger(data.grid.rows)) {
      return { ok: false, errors: ["缺少格子行列资料，无法检查版面。"] };
    }
    if (data.grid.cols !== grid.cols || data.grid.rows !== grid.rows) {
      return {
        ok: false,
        errors: [
          `格子与纸张不符：${PAPER_LABELS[settings.paperSize]}应为 ${grid.cols}列×${grid.rows}行，文件为 ${data.grid.cols}列×${data.grid.rows}行。`
        ]
      };
    }

    if (!Array.isArray(data.types)) {
      return { ok: false, errors: ["缺少字模资料。"] };
    }
    const typeErrors = [];
    data.types.forEach((type, index) => {
      const label = `第${index + 1}枚字模`;
      if (!type || typeof type !== "object") {
        typeErrors.push(`${label}资料缺失。`);
        return;
      }
      if (typeof type.char !== "string" || !type.char.trim()) typeErrors.push(`${label}缺少字符。`);
      if (typeof type.style !== "string" || !type.style.trim()) typeErrors.push(`${label}缺少风格。`);
      if (!WEAR_VALUES.includes(type.wear)) typeErrors.push(`${label}的磨损值“${type.wear}”无法识别。`);
      if (!Number.isInteger(type.size) || type.size < 8 || type.size > 72)
        typeErrors.push(`${label}字号超出允许范围（8–72）。`);
      if (!Number.isInteger(type.quantity) || type.quantity < 1 || type.quantity > 99)
        typeErrors.push(`${label}数量超出允许范围（1–99）。`);
    });
    if (typeErrors.length) return { ok: false, errors: typeErrors.slice(0, 4) };

    if (!Array.isArray(data.placements)) {
      return { ok: false, errors: ["缺少版面落字资料。"] };
    }
    const placementErrors = [];
    const occupied = new Set();
    data.placements.forEach((placement, index) => {
      if (placementErrors.length >= 3) return;
      if (!placement || typeof placement !== "object") {
        placementErrors.push(`第${index + 1}个落字资料缺失。`);
        return;
      }
      const { row, col, typeIndex } = placement;
      if (!Number.isInteger(row) || !Number.isInteger(col)) {
        placementErrors.push(`第${index + 1}个落字缺少行列位置。`);
        return;
      }
      if (row < 0 || row >= grid.rows || col < 0 || col >= grid.cols) {
        placementErrors.push(
          `第${index + 1}个落字（第${row + 1}行第${col + 1}列）超出${grid.cols}列×${grid.rows}行的格子。`
        );
        return;
      }
      const key = `${row}:${col}`;
      if (occupied.has(key)) {
        placementErrors.push(`第${row + 1}行第${col + 1}列有重复落字，版面资料冲突。`);
        return;
      }
      occupied.add(key);
      if (!Number.isInteger(typeIndex) || typeIndex < 0 || typeIndex >= data.types.length) {
        placementErrors.push(`第${index + 1}个落字引用的字模资料缺失。`);
      }
    });
    if (placementErrors.length) return { ok: false, errors: placementErrors };

    return { ok: true, errors: [] };
  },

  /* 合并：按字符、风格、字号、磨损认同款，数量取两边较多的一份；版面接到新字模编号 */
  applyRelayImport(state, pkg) {
    const inventory = structuredClone(state.inventory);
    const idBySignature = new Map(inventory.map((item) => [this.typeSignature(item), item.id]));
    const mappedTypes = pkg.types.map((type) => ({ ...type }));

    const idByIndex = [];
    let mergedCount = 0;
    let addedCount = 0;
    const mergedDetails = [];

    mappedTypes.forEach((type) => {
      const signature = this.typeSignature(type);
      const existingId = idBySignature.get(signature);
      if (existingId) {
        const existing = inventory.find((item) => item.id === existingId);
        if (type.quantity > existing.quantity) {
          mergedDetails.push(`${type.char}（${existing.quantity}→${type.quantity}）`);
          existing.quantity = type.quantity;
        }
        mergedCount += 1;
        idByIndex.push(existingId);
      } else {
        const id = crypto.randomUUID();
        inventory.push({ id, ...type });
        idBySignature.set(signature, id);
        addedCount += 1;
        idByIndex.push(id);
      }
    });

    const settings = {
      paperSize: pkg.settings.paperSize,
      flowMode: pkg.settings.flowMode,
      gridGap: pkg.settings.gridGap,
      workTitle: typeof pkg.workTitle === "string" ? pkg.workTitle : state.settings.workTitle
    };

    const placements = pkg.placements.map(({ row, col, typeIndex }) => ({
      row,
      col,
      typeId: idByIndex[typeIndex]
    }));

    const draftTitle = (settings.workTitle || "").trim() || "未命名作品";
    const draft = {
      id: crypto.randomUUID(),
      title: draftTitle,
      source: "relay",
      settings: structuredClone(settings),
      placements: structuredClone(placements),
      savedAt: new Date().toISOString()
    };
    const drafts = [draft, ...structuredClone(state.drafts)].slice(0, 8);

    return {
      inventory,
      settings,
      placements,
      drafts,
      selectedTypeId: idByIndex[0] || inventory[0]?.id || null,
      summary: {
        mergedCount,
        addedCount,
        placementCount: placements.length,
        mergedDetails
      }
    };
  }
};
