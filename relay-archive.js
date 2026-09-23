// relay-archive.js —— 接力档的存档读写
// 负责：把接力档下载为 .json 文件、读取并解析摊主交来的文件。
// 不做任何业务校验（规则在 relay-rules.js），也不改动当前版面。

(function () {
  function sanitizeFileName(name) {
    return (name || "movable-type-relay").replace(/[\\/:*?"<>|]/g, "_").slice(0, 80) || "movable-type-relay";
  }

  function downloadRelay(payload) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.download = `${sanitizeFileName(payload.workTitle)}.relay.json`;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
  }

  function readRelayFile(file) {
    return file.text().then(
      (text) => {
        try {
          return { ok: true, data: JSON.parse(text) };
        } catch {
          return { ok: false, errors: ["文件不是有效的 JSON，无法作为接力档读取。"] };
        }
      },
      () => ({ ok: false, errors: ["文件读取失败，请重新选择接力档。"] })
    );
  }

  window.RelayArchive = { downloadRelay, readRelayFile };
})();
