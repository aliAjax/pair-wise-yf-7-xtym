// relay-ui.js —— 接力传档的页面接入
// 负责：导入导出入口、校验提示与结果摘要。
// 业务规则见 relay-rules.js，文件读写见 relay-archive.js；本文件只接线不改规则。
// 不新增页面或依赖，沿用 app.js 的 state / renderAll 与现有纸张风格。

(function () {
  const PAPER_NAMES = {
    postcard: "明信片",
    bookmark: "书签",
    square: "方形小笺"
  };

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function paperDesc(paper) {
    return `${PAPER_NAMES[paper.paperSize] || paper.paperSize} · ${paper.flowMode === "vertical" ? "竖排" : "横排"} · 间距${paper.gridGap}`;
  }

  function showMessage(kind, lines) {
    const box = document.querySelector("#relayMessage");
    box.className = `relay-message ${kind}`;
    box.innerHTML = lines
      .map((line, index) =>
        index === 0
          ? `<strong>${escapeHtml(line)}</strong>`
          : `<span>• ${escapeHtml(line)}</span>`
      )
      .join("");
  }

  function handleExport() {
    const payload = window.RelayRules.buildRelayPayload(state);
    window.RelayArchive.downloadRelay(payload);
    const title = payload.workTitle || "未命名作品";
    if (!payload.placements.length) {
      showMessage("info", [
        `已导出接力档「${title}」（${paperDesc(payload.paper)}）。`,
        "当前版面还没有落字，档内只含作品名与纸张设置；未用库存未写入。"
      ]);
      return;
    }
    showMessage("ok", [
      `已导出接力档「${title}」（${paperDesc(payload.paper)}）。`,
      `含 ${payload.types.length} 枚落字用到的字模、${payload.placements.length} 个落字；未用库存未写入。`
    ]);
  }

  async function handleImportFile(file) {
    if (!file) return;
    const input = document.querySelector("#relayFileInput");
    const read = await window.RelayArchive.readRelayFile(file);
    input.value = "";
    if (!read.ok) {
      showMessage("warn", ["接力档未通过校验，当前版面与草稿保持原样：", ...read.errors]);
      return;
    }

    // 先检查版本、格子和字模资料；不通过则只提示原因
    const verdict = window.RelayRules.validateRelayPayload(read.data);
    if (!verdict.ok) {
      showMessage("warn", ["接力档未通过校验，当前版面与草稿保持原样：", ...verdict.errors]);
      return;
    }

    // 通过后合并重复字模、把版面接到新字模编号并留成草稿
    const merged = window.RelayRules.mergeRelayData(state, verdict.data);
    state.inventory = merged.inventory;
    state.drafts.unshift(merged.draft);
    state.drafts = state.drafts.slice(0, 8);
    renderAll();

    const { addedTypes, mergedTypes, placements } = merged.stats;
    showMessage("ok", [
      `接力档「${merged.draft.title}」已接收（${paperDesc(verdict.data.paper)}）。`,
      `字模合并：新增 ${addedTypes} 枚，合并重复 ${mergedTypes} 枚，数量取两边较多的一份。`,
      `版面（${placements} 个落字）已接到新字模编号并留成草稿；当前版面保持原样，载入该草稿即可继续接力。`
    ]);
  }

  function init() {
    const exportBtn = document.querySelector("#relayExportBtn");
    const importBtn = document.querySelector("#relayImportBtn");
    const fileInput = document.querySelector("#relayFileInput");
    exportBtn.addEventListener("click", handleExport);
    importBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", (event) => {
      handleImportFile(event.target.files[0]);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
