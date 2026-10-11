(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const state = { ledger: null, headcount: null, result: null, ledgerName: "", headcountName: "" };

  function setFile(kind, text, name) {
    state[kind] = Alloc.parseCSV(text);
    state[kind + "Name"] = name;
    $("i-" + kind).textContent = `${name} · ${state[kind].records.length} 行`;
    $("btn-run").disabled = !(state.ledger && state.headcount);
  }

  document.querySelectorAll("input[type=file]").forEach((input) => {
    input.addEventListener("change", () => {
      const file = input.files[0];
      if (!file) return;
      const kind = input.id === "f-ledger" ? "ledger" : "headcount";
      file.text().then((t) => setFile(kind, t, file.name));
    });
  });

  document.querySelectorAll("[data-sample]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.sample;
      if (key === "headcount") setFile("headcount", SAMPLES.headcount, "样例人数表.csv");
      else {
        setFile("ledger", SAMPLES[key], key === "clean" ? "正常样例台账.csv" : "含错误样例台账.csv");
        if (!state.headcount) setFile("headcount", SAMPLES.headcount, "样例人数表.csv");
      }
    });
  });

  function fmt(n) { return Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function esc(s) { return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  function render(res) {
    const errors = res.issues.filter((i) => i.level === "error");
    const warnings = res.issues.filter((i) => i.level === "warning");
    $("result").hidden = false;
    $("st-check").className = "step " + (errors.length ? "bad" : "on");
    $("st-alloc").className = "step " + (errors.length ? "" : "on");
    $("st-dl").className = "step " + (errors.length ? "" : "on");

    const kpis = [
      ["台账发票", state.ledger.records.length],
      ["阻断错误", errors.length],
      ["提示", warnings.length],
      ["分摊明细行", res.lines.length],
    ];
    $("kpis").innerHTML = kpis.map(([l, v]) => `<div class="card kpi"><div class="label">${l}</div><div class="value">${v}</div></div>`).join("");

    $("issues-card").hidden = !res.issues.length;
    $("issues").innerHTML = res.issues.map((i) => `<tr><td><code>${i.code}</code></td>
      <td class="lv-${i.level}">${i.level === "error" ? "错误" : "提示"}</td><td>${i.line ?? "—"}</td>
      <td>${esc(i.message)}</td><td><button class="link" data-goto="${i.code}">查看处理指引 →</button></td></tr>`).join("");

    const ok = !errors.length;
    $("summary-card").hidden = !ok;
    $("lines-card").hidden = !ok;
    if (!ok) return;

    const totals = {};
    res.summary.forEach((s) => { totals[s.entity + s.currency] = (totals[s.entity + s.currency] || 0) + s.cents; });
    $("summary").innerHTML = res.summary.map((s) => {
      const pct = totals[s.entity + s.currency] ? Math.abs(s.cents / totals[s.entity + s.currency]) : 0;
      return `<tr><td>${esc(s.entity)}</td><td>${esc(s.cost_center)}</td><td>${s.currency}</td><td class="num">${s.invoices}</td>
        <td class="num">${fmt(s.amount)}</td><td style="width:22%"><div class="bar"><span style="width:${(pct * 100).toFixed(1)}%"></span></div></td></tr>`;
    }).join("");
    $("lines-note").textContent = `每张发票拆分后的合计与原金额分毫不差（最大余数法）`;
    $("lines").innerHTML = res.lines.map((l) => `<tr><td>${esc(l.invoice_id)}</td><td>${esc(l.entity)}</td><td>${esc(l.cost_type)}</td>
      <td>${esc(l.cost_center)}</td><td class="num">${l.headcount}</td><td class="num">${(l.share * 100).toFixed(2)}%</td>
      <td class="num">${fmt(l.amount)}</td><td>${l.currency}</td></tr>`).join("");
  }

  $("btn-run").addEventListener("click", () => {
    state.result = Alloc.allocate(state.ledger, state.headcount);
    render(state.result);
    notifyHost();
  });

  function download(name, text) {
    const blob = new Blob(["\uFEFF" + text], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  $("dl-lines").addEventListener("click", () => download("allocation_lines.csv",
    Alloc.toCSV(state.result.lines, ["invoice_id", "entity", "country", "cost_type", "cost_center", "headcount", "share", "amount", "currency"])));
  $("dl-summary").addEventListener("click", () => download("allocation_summary.csv",
    Alloc.toCSV(state.result.summary, ["entity", "cost_center", "currency", "invoices", "amount"])));

  // 处理规范
  $("playbook").innerHTML = PLAYBOOK.map((p) => `<details class="pb" id="pb-${p.code}">
    <summary><code>${p.code}</code>${esc(p.title)}<span class="scope">适用：${esc(p.scope)}</span></summary>
    <ol><li><strong>报错：</strong>${esc(p.error)}</li><li><strong>检查：</strong>${esc(p.check)}</li>
    <li><strong>修改：</strong>${esc(p.fix)}</li><li><strong>上传：</strong>${esc(p.upload)}</li></ol></details>`).join("");

  function showTab(name) {
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
    $("tab-run").hidden = name !== "run";
    $("tab-playbook").hidden = name !== "playbook";
  }
  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => showTab(t.dataset.tab)));
  document.addEventListener("click", (e) => {
    const code = e.target.dataset && e.target.dataset.goto;
    if (!code) return;
    showTab("playbook");
    const el = $("pb-" + code);
    el.open = true;
    el.classList.add("flash");
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => el.classList.remove("flash"), 1600);
  });

  // 作为子应用嵌入 Console 时：接收父壳下发的身份，并回传运行结果
  const embedded = window.parent !== window;
  window.addEventListener("message", (e) => {
    if (!e.data || e.data.type !== "console:context") return;
    const badge = $("host-badge");
    badge.hidden = false;
    badge.textContent = `来自 Console：${e.data.user} · ${e.data.role}`;
  });
  function notifyHost() {
    if (!embedded || !state.result) return;
    const errors = state.result.issues.filter((i) => i.level === "error").length;
    window.parent.postMessage({ type: "workbench:result", invoices: state.ledger.records.length, errors, lines: state.result.lines.length }, "*");
  }
  if (embedded) window.parent.postMessage({ type: "workbench:ready" }, "*");
})();
