/* 存档：localStorage 读写与初始资料 */

const storageKey = "zfl16-movable-type-workshop";

const starterInventory = [
  { id: crypto.randomUUID(), char: "山", style: "宋体旧字", size: 30, quantity: 4, wear: "微磨" },
  { id: crypto.randomUUID(), char: "月", style: "宋体旧字", size: 30, quantity: 3, wear: "旧痕" },
  { id: crypto.randomUUID(), char: "风", style: "楷体木刻", size: 28, quantity: 2, wear: "微磨" },
  { id: crypto.randomUUID(), char: "花", style: "楷体木刻", size: 28, quantity: 2, wear: "新" },
  { id: crypto.randomUUID(), char: "茶", style: "黑体铅字", size: 24, quantity: 3, wear: "旧痕" },
  { id: crypto.randomUUID(), char: "雨", style: "仿宋细字", size: 22, quantity: 4, wear: "新" }
];

const defaultState = {
  inventory: starterInventory,
  selectedTypeId: starterInventory[0].id,
  placements: [],
  drafts: [],
  settings: {
    paperSize: "postcard",
    flowMode: "horizontal",
    gridGap: 8,
    workTitle: "晚风小笺"
  }
};

const WorkshopStorage = {
  key: storageKey,
  defaultState,

  load() {
    const saved = localStorage.getItem(storageKey);
    if (!saved) return structuredClone(defaultState);
    try {
      const parsed = JSON.parse(saved);
      return {
        ...structuredClone(defaultState),
        ...parsed,
        settings: { ...defaultState.settings, ...parsed.settings }
      };
    } catch {
      return structuredClone(defaultState);
    }
  },

  save(nextState) {
    localStorage.setItem(storageKey, JSON.stringify(nextState));
  }
};
