// 成本分摊核心：纯函数，页面与测试页共用，避免逻辑漂移。
(function (global) {
  "use strict";

  const LEDGER_COLUMNS = ["invoice_id", "entity", "country", "cost_type", "amount", "currency"];
  const HEADCOUNT_COLUMNS = ["entity", "cost_center", "headcount"];
  const COUNTRY_CURRENCY = { US: "USD", CA: "CAD", SG: "SGD", GB: "GBP", DE: "EUR" };

  function parseCSV(text) {
    const rows = [];
    let row = [], field = "", quoted = false;
    const src = text.replace(/^\uFEFF/, "");
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (quoted) {
        if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') quoted = false;
        else field += c;
      } else if (c === '"') quoted = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && src[i + 1] === "\n") i++;
        row.push(field); field = "";
        if (row.some((v) => v.trim() !== "")) rows.push(row);
        row = [];
      } else field += c;
    }
    row.push(field);
    if (row.some((v) => v.trim() !== "")) rows.push(row);
    if (!rows.length) return { header: [], records: [] };
    const header = rows[0].map((h) => h.trim());
    const records = rows.slice(1).map((r, idx) => {
      const rec = { _line: idx + 2 };
      header.forEach((h, j) => { rec[h] = (r[j] ?? "").trim(); });
      return rec;
    });
    return { header, records };
  }

  function toCSV(rows, columns) {
    const esc = (v) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return [columns.join(","), ...rows.map((r) => columns.map((c) => esc(r[c])).join(","))].join("\n");
  }

  function issue(code, level, message, line) {
    return { code, level, message, line: line ?? null };
  }

  function validate(ledger, headcount) {
    const issues = [];
    const missing = (header, cols) => cols.filter((c) => !header.includes(c));
    const lm = missing(ledger.header, LEDGER_COLUMNS);
    const hm = missing(headcount.header, HEADCOUNT_COLUMNS);
    if (lm.length) issues.push(issue("E1", "error", `台账缺少列：${lm.join("、")}`));
    if (hm.length) issues.push(issue("E1", "error", `人数表缺少列：${hm.join("、")}`));
    if (lm.length || hm.length) return issues;

    const hcByEntity = {};
    headcount.records.forEach((r) => {
      const n = Number(r.headcount);
      if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
        issues.push(issue("S4", "error", `人数表 ${r.entity || "(空主体)"} / ${r.cost_center} 人数「${r.headcount}」不是非负整数`, r._line));
        return;
      }
      (hcByEntity[r.entity] ||= []).push(n);
    });
    Object.entries(hcByEntity).forEach(([entity, list]) => {
      if (list.reduce((a, b) => a + b, 0) === 0) issues.push(issue("S3", "error", `主体 ${entity} 在人数表中合计为 0，无法计算占比`));
    });

    const seen = new Set();
    ledger.records.forEach((r) => {
      if (!r.entity) issues.push(issue("S1", "error", `发票 ${r.invoice_id || "(无编号)"} 缺少主体`, r._line));
      else if (!hcByEntity[r.entity]) issues.push(issue("S2", "error", `发票 ${r.invoice_id} 的主体 ${r.entity} 不在人数表中`, r._line));
      if (!Number.isFinite(Number(r.amount)) || r.amount === "") issues.push(issue("S5", "error", `发票 ${r.invoice_id} 金额「${r.amount}」不是数字`, r._line));
      else if (Number(r.amount) < 0) issues.push(issue("S7", "warning", `发票 ${r.invoice_id} 金额为负，按冲销处理`, r._line));
      const expected = COUNTRY_CURRENCY[r.country];
      if (expected && r.currency && r.currency !== expected) {
        issues.push(issue("S6", "warning", `发票 ${r.invoice_id} 国家 ${r.country} 通常使用 ${expected}，实际为 ${r.currency}`, r._line));
      }
      if (r.invoice_id) {
        if (seen.has(r.invoice_id)) issues.push(issue("S8", "warning", `发票编号 ${r.invoice_id} 重复出现，请确认是否重复导入`, r._line));
        seen.add(r.invoice_id);
      }
    });
    return issues;
  }

  // 最大余数法：按人数占比拆分金额（以分为单位），保证拆分后合计与原金额分毫不差
  function splitCents(totalCents, weights) {
    const sum = weights.reduce((a, b) => a + b, 0);
    const sign = totalCents < 0 ? -1 : 1;
    const abs = Math.abs(totalCents);
    const raw = weights.map((w) => (abs * w) / sum);
    const floors = raw.map(Math.floor);
    let remainder = abs - floors.reduce((a, b) => a + b, 0);
    raw.map((v, i) => ({ i, frac: v - floors[i] }))
      .sort((a, b) => b.frac - a.frac || a.i - b.i)
      .forEach(({ i }) => { if (remainder > 0) { floors[i] += 1; remainder -= 1; } });
    return floors.map((v) => v * sign);
  }

  function allocate(ledger, headcount) {
    const issues = validate(ledger, headcount);
    if (issues.some((x) => x.level === "error")) return { issues, lines: [], summary: [], total: 0 };

    const centers = {};
    headcount.records.forEach((r) => (centers[r.entity] ||= []).push({ cost_center: r.cost_center, headcount: Number(r.headcount) }));

    const lines = [];
    let totalCents = 0;
    ledger.records.forEach((r) => {
      const list = centers[r.entity].filter((c) => c.headcount > 0);
      const cents = Math.round(Number(r.amount) * 100);
      totalCents += cents;
      const parts = splitCents(cents, list.map((c) => c.headcount));
      const hcTotal = list.reduce((a, c) => a + c.headcount, 0);
      list.forEach((c, i) => lines.push({
        invoice_id: r.invoice_id, entity: r.entity, country: r.country, cost_type: r.cost_type,
        cost_center: c.cost_center, headcount: c.headcount,
        share: (c.headcount / hcTotal).toFixed(4),
        amount: (parts[i] / 100).toFixed(2), currency: r.currency,
      }));
    });

    const byCenter = {};
    lines.forEach((l) => {
      const key = `${l.entity}|${l.cost_center}|${l.currency}`;
      byCenter[key] ||= { entity: l.entity, cost_center: l.cost_center, currency: l.currency, cents: 0, invoices: 0 };
      byCenter[key].cents += Math.round(Number(l.amount) * 100);
      byCenter[key].invoices += 1;
    });
    const summary = Object.values(byCenter)
      .map((s) => ({ ...s, amount: (s.cents / 100).toFixed(2) }))
      .sort((a, b) => a.entity.localeCompare(b.entity) || b.cents - a.cents);

    return { issues, lines, summary, total: totalCents / 100 };
  }

  const api = { parseCSV, toCSV, validate, splitCents, allocate, LEDGER_COLUMNS, HEADCOUNT_COLUMNS };
  global.Alloc = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
