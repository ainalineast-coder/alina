"use strict";
/* ============================================================
 * ERP «Тёплый дом» — интерфейс (вью-слой поверх Store).
 * Маршруты (hash):
 *   #/            сеть: панель владельца
 *   #/f/<id>      филиал (вкладки: койки, постояльцы, финансы, персонал, журнал)
 *   #/r/<id>      карточка постояльца
 *   #/reports     сводные отчёты по сети
 *   #/data        данные: экспорт/импорт/сброс, конфиг мониторинга
 * ============================================================ */

// ── Инициализация данных ─────────────────────────────────────
if (!Store.load()) seedDatabase(Store);

const CUR = " ₸";
const CARE_RU = { independent: "самостоятельный", assisted: "частичный уход", intensive: "интенсивный уход" };
const KIND_RU = { admit: "Заселение", discharge: "Выселение", transfer: "Перевод", incident: "Инцидент", note: "Заметка", payment: "Оплата" };

// ── Утилиты ──────────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const esc = (x) => String(x == null ? "" : x).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const money = (n) => (Number(n) || 0).toLocaleString("ru-RU") + CUR;
const fmtDate = (s) => { if (!s) return "—"; const [y, m, d] = s.split("-"); return d + "." + m + "." + y; };
const fmtTs = (ts) => new Date(ts).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const monthRu = (m) => { const [y, mm] = m.split("-"); return ["янв","фев","мар","апр","май","июн","июл","авг","сен","окт","ноя","дек"][+mm - 1] + " " + y; };
const age = (birth) => { if (!birth) return ""; const b = new Date(birth); let a = new Date().getFullYear() - b.getFullYear(); const md = new Date().getMonth() - b.getMonth(); if (md < 0 || (md === 0 && new Date().getDate() < b.getDate())) a--; return a; };

function download(filename, text, mime) {
  const blob = new Blob(["﻿" + text], { type: (mime || "text/plain") + ";charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
function toCsv(rows) { return rows.map(r => r.map(c => '"' + String(c == null ? "" : c).replace(/"/g, '""') + '"').join(";")).join("\r\n"); }

// ── Модальные формы ──────────────────────────────────────────
function formModal(title, fields, onSubmit) {
  const root = $("#modal-root");
  const f = fields.map((fl) => {
    const v = fl.value == null ? "" : fl.value;
    if (fl.type === "select") {
      const opts = fl.options.map(o => `<option value="${esc(o.value)}" ${String(o.value) === String(v) ? "selected" : ""}>${esc(o.label)}</option>`).join("");
      return `<div class="frow"><label>${esc(fl.label)}</label><select name="${fl.key}">${opts}</select></div>`;
    }
    if (fl.type === "checkbox") {
      return `<div class="frow chk"><input type="checkbox" name="${fl.key}" id="chk_${fl.key}" ${v ? "checked" : ""}><label for="chk_${fl.key}" style="margin:0">${esc(fl.label)}</label></div>`;
    }
    if (fl.type === "textarea") {
      return `<div class="frow"><label>${esc(fl.label)}</label><textarea name="${fl.key}" rows="3">${esc(v)}</textarea></div>`;
    }
    return `<div class="frow"><label>${esc(fl.label)}</label><input type="${fl.type || "text"}" name="${fl.key}" value="${esc(v)}" ${fl.placeholder ? `placeholder="${esc(fl.placeholder)}"` : ""}></div>`;
  }).join("");

  root.innerHTML = `<div class="overlay" onclick="if(event.target===this)closeModal()">
    <form class="modal" id="mform">
      <h3>${esc(title)}</h3>${f}
      <div class="actions">
        <button type="button" onclick="closeModal()">Отмена</button>
        <button type="submit" class="primary">Сохранить</button>
      </div>
    </form></div>`;

  $("#mform").onsubmit = (e) => {
    e.preventDefault();
    const out = {};
    for (const fl of fields) {
      const el = e.target.elements[fl.key];
      if (fl.type === "checkbox") out[fl.key] = el.checked;
      else if (fl.type === "number") out[fl.key] = Number(el.value || 0);
      else out[fl.key] = el.value.trim();
    }
    closeModal();
    onSubmit(out);
  };
}
function closeModal() { $("#modal-root").innerHTML = ""; }
window.closeModal = closeModal;

function showYamlModal(title, text) {
  $("#modal-root").innerHTML = `<div class="overlay" onclick="if(event.target===this)closeModal()">
    <div class="modal" style="max-width:680px">
      <h3>${esc(title)}</h3>
      <pre class="yaml">${esc(text)}</pre>
      <div class="actions">
        <button onclick="navigator.clipboard.writeText(document.querySelector('pre.yaml').textContent).then(()=>this.textContent='Скопировано ✓')">Копировать</button>
        <button class="primary" onclick="closeModal()">Закрыть</button>
      </div>
    </div></div>`;
}

// ── Роутер ───────────────────────────────────────────────────
function route() {
  const hash = location.hash || "#/";
  const [path, qs] = hash.slice(1).split("?");
  const q = Object.fromEntries(new URLSearchParams(qs || ""));
  const seg = path.split("/").filter(Boolean);

  document.querySelectorAll("#nav a").forEach(a => a.classList.remove("active"));
  let view = "";
  if (seg.length === 0) { markNav("net"); view = viewNetwork(); }
  else if (seg[0] === "f" && seg[1]) { markNav("net"); view = viewFacility(seg[1], q.tab || "beds"); }
  else if (seg[0] === "r" && seg[1]) { markNav("net"); view = viewResident(seg[1], q.tab || "profile"); }
  else if (seg[0] === "reports") { markNav("reports"); view = viewReports(); }
  else if (seg[0] === "data") { markNav("data"); view = viewData(); }
  else view = "<p>Страница не найдена. <a href='#/'>На главную</a></p>";

  $("#view").innerHTML = view;
  $("#brand").textContent = Store.data.org.name + " · ERP";
}
function markNav(r) { const a = document.querySelector(`#nav a[data-r="${r}"]`); if (a) a.classList.add("active"); }
window.addEventListener("hashchange", route);

function rerender() { route(); }

// ── Вью: сеть (панель владельца) ─────────────────────────────
function viewNetwork() {
  const m = thisMonth();
  let beds = 0, used = 0, debtTotal = 0, incidents = 0, revenue = 0, charged = 0;
  const cards = Store.data.facilities.map(f => {
    const bs = Store.bedStats(f.id);
    beds += bs.beds; used += bs.used;
    const debt = Store.debtors(f.id).reduce((s, d) => s + d.debt, 0);
    debtTotal += debt;
    const inc = Store.incidents30d(f.id);
    incidents += inc;
    const rev = Store.monthRevenue(f.id, m); revenue += rev;
    charged += Store.monthCharged(f.id, m);
    const occ = bs.beds ? Math.round(bs.used / bs.beds * 100) : 0;
    return `<div class="card click" onclick="location.hash='#/f/${f.id}'">
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <b>${esc(f.name)}</b><span class="muted" style="font-size:12px">${esc(f.city)}</span>
      </div>
      <div class="muted" style="font-size:12px;margin:2px 0 8px">${esc(f.address)} · ${esc(f.director)}</div>
      <div style="display:flex;justify-content:space-between;font-size:13px">
        <span>Койки: <b>${bs.used}/${bs.beds}</b></span><span>${occ}%</span>
      </div>
      <div class="bar ${occ >= 90 ? "green" : occ >= 70 ? "" : "yellow"}"><i style="width:${occ}%"></i></div>
      <div style="display:flex;gap:14px;margin-top:10px;font-size:13px;flex-wrap:wrap">
        <span>Сбор: <b>${money(rev)}</b></span>
        <span class="${debt > 0 ? "bad-t" : "ok-t"}">Долги: <b>${money(debt)}</b></span>
        <span class="${inc > 0 ? "" : "muted"}">Инциденты 30д: <b>${inc}</b></span>
      </div>
    </div>`;
  }).join("");

  const occTotal = beds ? Math.round(used / beds * 100) : 0;
  return `
    ${demoNote()}
    <h2>Сеть — сводка за ${monthRu(m)}</h2>
    <div class="kpis">
      <div class="kpi"><b>${Store.data.facilities.length}</b><span>филиалов</span></div>
      <div class="kpi"><b>${used}</b><span>постояльцев</span></div>
      <div class="kpi ${occTotal >= 85 ? "good" : ""}"><b>${occTotal}%</b><span>заполняемость (${used}/${beds})</span></div>
      <div class="kpi good"><b>${money(revenue)}</b><span>собрано за месяц</span></div>
      <div class="kpi"><b>${money(charged)}</b><span>начислено за месяц</span></div>
      <div class="kpi ${debtTotal > 0 ? "bad" : "good"}"><b>${money(debtTotal)}</b><span>долги всего</span></div>
      <div class="kpi ${incidents > 0 ? "warn" : ""}"><b>${incidents}</b><span>инцидентов за 30 дней</span></div>
    </div>
    <div class="toolbar"><button class="primary" onclick="addFacilityDlg()">+ Филиал</button></div>
    <div class="grid cols3">${cards}</div>`;
}

function addFacilityDlg() {
  formModal("Новый филиал", [
    { key: "name", label: "Название", placeholder: "Тёплый дом — ..." },
    { key: "city", label: "Город" },
    { key: "address", label: "Адрес" },
    { key: "phone", label: "Телефон" },
    { key: "director", label: "Директор" },
  ], (v) => { const f = Store.addFacility(v); location.hash = "#/f/" + f.id; });
}
window.addFacilityDlg = addFacilityDlg;

// ── Вью: филиал ──────────────────────────────────────────────
function viewFacility(fid, tab) {
  const f = Store.byId("facilities", fid);
  if (!f) return "<p>Филиал не найден. <a href='#/'>К сети</a></p>";
  const bs = Store.bedStats(fid);
  const m = thisMonth();
  const debt = Store.debtors(fid).reduce((s, d) => s + d.debt, 0);

  const tabs = [
    ["beds", "Койки"], ["residents", "Постояльцы"], ["finance", "Финансы"],
    ["staff", "Персонал"], ["log", "Журнал"],
  ].map(([t, label]) => `<a href="#/f/${fid}?tab=${t}" class="${tab === t ? "active" : ""}">${label}</a>`).join("");

  let body = "";
  if (tab === "beds") body = tabBeds(f);
  else if (tab === "residents") body = tabResidents(f);
  else if (tab === "finance") body = tabFinance(f);
  else if (tab === "staff") body = tabStaff(f);
  else if (tab === "log") body = tabLog(f);

  return `
    <div class="crumbs"><a href="#/">Сеть</a> / ${esc(f.name)}</div>
    <h2>${esc(f.name)}</h2>
    <div class="kpis">
      <div class="kpi"><b>${bs.used}/${bs.beds}</b><span>занято коек</span></div>
      <div class="kpi good"><b>${money(Store.monthRevenue(fid, m))}</b><span>собрано в ${monthRu(m)}</span></div>
      <div class="kpi ${debt > 0 ? "bad" : "good"}"><b>${money(debt)}</b><span>долги</span></div>
      <div class="kpi"><b>${Store.incidents30d(fid)}</b><span>инцидентов 30д</span></div>
    </div>
    <div class="tabs">${tabs}</div>
    ${body}`;
}

function tabBeds(f) {
  const rooms = Store.roomsOf(f.id).map(r => {
    const occ = Store.occupants(r.id);
    let bedsHtml = "";
    for (let i = 0; i < r.beds; i++) {
      const p = occ[i];
      bedsHtml += p
        ? `<div class="bed busy"><span class="dot"></span><a href="#/r/${p.id}">${esc(p.name)}</a></div>`
        : `<div class="bed free"><span class="dot"></span>свободно
             <button class="small" style="margin-left:auto" onclick="admitDlg('${f.id}','${r.id}')">заселить</button></div>`;
    }
    return `<div class="room"><div class="rn">${esc(r.name)} <span class="muted" style="font-weight:400;font-size:11px">· ${esc(r.floor)} · ${r.beds}-мест.</span></div>${bedsHtml}</div>`;
  }).join("");
  return `<div class="toolbar">
      <button class="primary" onclick="admitDlg('${f.id}','')">+ Заселить постояльца</button>
      <button onclick="addRoomDlg('${f.id}')">+ Комната</button>
    </div>
    <div class="beds">${rooms || "<p class='muted'>Комнат пока нет — добавьте первую.</p>"}</div>`;
}

function tabResidents(f) {
  const list = Store.residentsOf(f.id).sort((a, b) => a.name.localeCompare(b.name, "ru"));
  const rows = list.map(p => {
    const room = p.room_id ? Store.byId("rooms", p.room_id) : null;
    const bal = Store.balance(p.id);
    const flags = [
      p.dementia ? '<span class="tag violet">деменция</span>' : "",
      p.bedridden ? '<span class="tag bad">лежачий</span>' : "",
      p.fall_history ? '<span class="tag warn">падения</span>' : "",
    ].join("");
    return `<tr class="click" onclick="location.hash='#/r/${p.id}'">
      <td><b>${esc(p.name)}</b><div class="muted" style="font-size:12px">${age(p.birth)} лет · ${CARE_RU[p.care_level] || ""}</div></td>
      <td>${room ? esc(room.name) : "<span class='muted'>без койки</span>"}</td>
      <td>${flags || "<span class='muted'>—</span>"}</td>
      <td class="right ${bal < 0 ? "bad-t" : "ok-t"}">${bal < 0 ? "долг " + money(-bal) : "оплачено"}</td>
    </tr>`;
  }).join("");
  return `<div class="toolbar">
      <button class="primary" onclick="admitDlg('${f.id}','')">+ Заселить</button>
      <button onclick="exportResidentsCsv('${f.id}')">Экспорт CSV</button>
    </div>
    <div class="card" style="padding:0">
    <table><thead><tr><th>Постоялец</th><th>Комната</th><th>Особенности</th><th class="right">Баланс</th></tr></thead>
    <tbody>${rows || "<tr><td colspan=4 class='muted'>Пусто</td></tr>"}</tbody></table></div>`;
}

function tabFinance(f) {
  const m = thisMonth();
  const debtors = Store.debtors(f.id);
  const dRows = debtors.map(d => `<tr class="click" onclick="location.hash='#/r/${d.resident.id}?tab=finance'">
      <td>${esc(d.resident.name)}</td>
      <td class="right bad-t"><b>${money(d.debt)}</b></td>
      <td class="right"><button class="small" onclick="event.stopPropagation();payDlg('${d.resident.id}')">принять оплату</button></td>
    </tr>`).join("");
  const pays = Store.data.payments.filter(p => p.facility_id === f.id)
    .sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 15)
    .map(p => { const r = Store.byId("residents", p.resident_id);
      return `<tr><td>${fmtDate(p.date)}</td><td>${r ? esc(r.name) : "—"}</td><td>${esc(p.method)}</td><td class="right ok-t">${money(p.amount)}</td></tr>`; }).join("");
  return `
    <div class="toolbar">
      <button class="primary" onclick="genCharges('${f.id}')">Сформировать начисления за ${monthRu(m)}</button>
      <span class="muted" style="font-size:12.5px">Начислено: <b>${money(Store.monthCharged(f.id, m))}</b> · Собрано: <b>${money(Store.monthRevenue(f.id, m))}</b></span>
    </div>
    <h3>Должники (${debtors.length})</h3>
    <div class="card" style="padding:0"><table>
      <thead><tr><th>Постоялец</th><th class="right">Долг</th><th></th></tr></thead>
      <tbody>${dRows || "<tr><td colspan=3 class='ok-t'>Долгов нет 🎉</td></tr>"}</tbody></table></div>
    <h3>Последние оплаты</h3>
    <div class="card" style="padding:0"><table>
      <thead><tr><th>Дата</th><th>Постоялец</th><th>Способ</th><th class="right">Сумма</th></tr></thead>
      <tbody>${pays || "<tr><td colspan=4 class='muted'>Оплат нет</td></tr>"}</tbody></table></div>`;
}

function tabStaff(f) {
  const rows = Store.data.staff.filter(s => s.facility_id === f.id).map(s => `<tr>
      <td><b>${esc(s.name)}</b></td><td>${esc(s.role)}</td><td>${esc(s.phone)}</td>
      <td class="right">
        <button class="small" onclick="staffDlg('${f.id}','${s.id}')">изменить</button>
        <button class="small danger" onclick="if(confirm('Удалить сотрудника?')){Store.removeStaff('${s.id}');rerender()}">удалить</button>
      </td></tr>`).join("");
  return `<div class="toolbar"><button class="primary" onclick="staffDlg('${f.id}','')">+ Сотрудник</button></div>
    <div class="card" style="padding:0"><table>
      <thead><tr><th>ФИО</th><th>Должность</th><th>Телефон</th><th></th></tr></thead>
      <tbody>${rows || "<tr><td colspan=4 class='muted'>Пусто</td></tr>"}</tbody></table></div>`;
}

function tabLog(f) {
  const rows = Store.eventsOf({ facility_id: f.id, limit: 60 }).map(e => {
    const r = e.resident_id ? Store.byId("residents", e.resident_id) : null;
    return `<tr><td class="muted" style="white-space:nowrap">${fmtTs(e.ts)}</td>
      <td><span class="tag ${e.kind === "incident" ? "bad" : ""}">${KIND_RU[e.kind] || e.kind}</span></td>
      <td>${r ? `<a href="#/r/${r.id}">${esc(r.name)}</a> — ` : ""}${esc(e.text)}</td></tr>`;
  }).join("");
  return `<div class="toolbar"><button onclick="incidentDlg('${f.id}')">+ Инцидент / заметка</button></div>
    <div class="card" style="padding:0"><table><tbody>${rows || "<tr><td class='muted'>Журнал пуст</td></tr>"}</tbody></table></div>`;
}

// ── Действия филиала ─────────────────────────────────────────
function addRoomDlg(fid) {
  formModal("Новая комната", [
    { key: "name", label: "Название", placeholder: "Палата 115" },
    { key: "beds", label: "Число коек", type: "number", value: 2 },
    { key: "floor", label: "Этаж", placeholder: "1 этаж" },
  ], (v) => { Store.addRoom(Object.assign(v, { facility_id: fid })); rerender(); });
}
window.addRoomDlg = addRoomDlg;

function admitDlg(fid, roomId) {
  const free = Store.roomsOf(fid).filter(r => Store.occupants(r.id).length < r.beds);
  formModal("Заселение постояльца", [
    { key: "name", label: "ФИО" },
    { key: "birth", label: "Дата рождения", type: "date" },
    { key: "gender", label: "Пол", type: "select", value: "ж", options: [{ value: "ж", label: "женский" }, { value: "м", label: "мужской" }] },
    { key: "room_id", label: "Комната", type: "select", value: roomId,
      options: free.map(r => ({ value: r.id, label: r.name + " (свободно " + (r.beds - Store.occupants(r.id).length) + ")" })) },
    { key: "care_level", label: "Уровень ухода", type: "select", value: "assisted",
      options: [{ value: "independent", label: "самостоятельный" }, { value: "assisted", label: "частичный уход" }, { value: "intensive", label: "интенсивный уход" }] },
    { key: "dementia", label: "Деменция", type: "checkbox" },
    { key: "bedridden", label: "Лежачий", type: "checkbox" },
    { key: "fall_history", label: "Падения в анамнезе", type: "checkbox" },
    { key: "kin_name", label: "Контакт родственника (имя)" },
    { key: "kin_phone", label: "Телефон родственника" },
    { key: "monthly", label: "Тариф, ₸/мес", type: "number", value: 350000 },
  ], (v) => {
    if (!v.name) return;
    const res = Store.addResident({
      facility_id: fid, room_id: v.room_id || null, name: v.name, birth: v.birth,
      gender: v.gender, care_level: v.care_level, dementia: v.dementia,
      bedridden: v.bedridden, fall_history: v.fall_history,
      kin: v.kin_name ? [{ name: v.kin_name, phone: v.kin_phone, relation: "родственник" }] : [],
      admitted: today(),
    });
    Store.addContract({ resident_id: res.id, number: "Д-" + Math.floor(Math.random() * 900 + 100),
      payer_name: v.kin_name || v.name, payer_phone: v.kin_phone || "", monthly: v.monthly });
    Store.addEvent({ resident_id: res.id, facility_id: fid, kind: "admit", text: "Заселение, договор оформлен" });
    location.hash = "#/r/" + res.id;
  });
}
window.admitDlg = admitDlg;

function genCharges(fid) {
  const n = Store.generateCharges(fid, thisMonth());
  alert(n ? "Создано начислений: " + n : "Начисления за этот месяц уже сформированы.");
  rerender();
}
window.genCharges = genCharges;

function staffDlg(fid, sid) {
  const s = sid ? Store.byId("staff", sid) : {};
  formModal(sid ? "Сотрудник" : "Новый сотрудник", [
    { key: "name", label: "ФИО", value: s.name },
    { key: "role", label: "Должность", value: s.role || "медсестра" },
    { key: "phone", label: "Телефон", value: s.phone },
  ], (v) => { sid ? Store.updateStaff(sid, v) : Store.addStaff(Object.assign(v, { facility_id: fid })); rerender(); });
}
window.staffDlg = staffDlg;

function incidentDlg(fid) {
  const residents = Store.residentsOf(fid);
  formModal("Событие журнала", [
    { key: "kind", label: "Тип", type: "select", value: "incident",
      options: [{ value: "incident", label: "Инцидент" }, { value: "note", label: "Заметка" }] },
    { key: "resident_id", label: "Постоялец (необязательно)", type: "select", value: "",
      options: [{ value: "", label: "—" }].concat(residents.map(p => ({ value: p.id, label: p.name }))) },
    { key: "text", label: "Описание", type: "textarea" },
  ], (v) => {
    Store.addEvent({ facility_id: fid, resident_id: v.resident_id || null, kind: v.kind, text: v.text });
    rerender();
  });
}
window.incidentDlg = incidentDlg;

function exportResidentsCsv(fid) {
  const f = Store.byId("facilities", fid);
  const rows = [["ФИО", "Дата рождения", "Возраст", "Комната", "Уровень ухода", "Деменция", "Лежачий", "Тариф/мес", "Баланс"]];
  for (const p of Store.residentsOf(fid)) {
    const room = p.room_id ? Store.byId("rooms", p.room_id) : null;
    const c = Store.contractOf(p.id);
    rows.push([p.name, fmtDate(p.birth), age(p.birth), room ? room.name : "", CARE_RU[p.care_level] || "",
      p.dementia ? "да" : "", p.bedridden ? "да" : "", c ? c.monthly : "", Store.balance(p.id)]);
  }
  download("постояльцы_" + (f ? f.name : fid) + ".csv", toCsv(rows), "text/csv");
}
window.exportResidentsCsv = exportResidentsCsv;

// ── Вью: карточка постояльца ─────────────────────────────────
function viewResident(rid, tab) {
  const p = Store.byId("residents", rid);
  if (!p) return "<p>Постоялец не найден. <a href='#/'>К сети</a></p>";
  const f = Store.byId("facilities", p.facility_id);
  const room = p.room_id ? Store.byId("rooms", p.room_id) : null;
  const bal = Store.balance(p.id);

  const tabs = [["profile", "Анкета"], ["med", "Медицина"], ["finance", "Договор и финансы"], ["log", "Журнал"]]
    .map(([t, label]) => `<a href="#/r/${rid}?tab=${t}" class="${tab === t ? "active" : ""}">${label}</a>`).join("");

  const flags = [
    p.dementia ? '<span class="tag violet">деменция</span>' : "",
    p.bedridden ? '<span class="tag bad">лежачий</span>' : "",
    p.fall_history ? '<span class="tag warn">падения в анамнезе</span>' : "",
    p.status === "discharged" ? '<span class="tag">выселен(а) ' + fmtDate(p.discharged_at) + "</span>" : "",
  ].join("");

  let body = "";
  if (tab === "profile") body = rTabProfile(p);
  else if (tab === "med") body = rTabMed(p);
  else if (tab === "finance") body = rTabFinance(p);
  else if (tab === "log") body = rTabLog(p);

  return `
    <div class="crumbs"><a href="#/">Сеть</a> / <a href="#/f/${p.facility_id}">${f ? esc(f.name) : ""}</a> / ${esc(p.name)}</div>
    <h2 style="margin-bottom:4px">${esc(p.name)}</h2>
    <div style="margin-bottom:8px">
      <span class="muted">${age(p.birth)} лет · ${CARE_RU[p.care_level] || ""} · ${room ? esc(room.name) : "без койки"}</span>
      &nbsp;${flags}
      <span class="tag ${bal < 0 ? "bad" : "ok"}">${bal < 0 ? "долг " + money(-bal) : "баланс в порядке"}</span>
    </div>
    <div class="tabs">${tabs}</div>
    ${body}`;
}

function rTabProfile(p) {
  const kin = (p.kin || []).map(k => `<li>${esc(k.name)} (${esc(k.relation)}) — ${esc(k.phone)}</li>`).join("");
  return `<div class="grid cols3">
    <div class="card">
      <h3 style="margin-top:0">Личные данные</h3>
      <p>Дата рождения: <b>${fmtDate(p.birth)}</b> (${age(p.birth)} лет)<br>
      Пол: ${p.gender === "м" ? "мужской" : "женский"}<br>
      Документ: ${esc(p.doc) || "—"}<br>
      Заселение: ${fmtDate(p.admitted)}</p>
      <button class="small" onclick="editProfileDlg('${p.id}')">Изменить</button>
    </div>
    <div class="card">
      <h3 style="margin-top:0">Родственники</h3>
      <ul style="margin:0;padding-left:18px">${kin || "<li class='muted'>не указаны</li>"}</ul>
      <button class="small" style="margin-top:8px" onclick="kinDlg('${p.id}')">+ Контакт</button>
    </div>
    <div class="card">
      <h3 style="margin-top:0">Действия</h3>
      <div style="display:flex;flex-direction:column;gap:8px">
        <button onclick="transferDlg('${p.id}')">Перевести (комната/филиал)</button>
        <button onclick="payDlg('${p.id}')">Принять оплату</button>
        ${p.status === "active" ? `<button class="danger" onclick="dischargeDlg('${p.id}')">Выселить</button>` : ""}
      </div>
    </div>
  </div>
  <div class="card" style="margin-top:14px"><h3 style="margin-top:0">Заметки</h3>
    <p>${esc(p.notes) || "<span class='muted'>—</span>"}</p></div>`;
}

function rTabMed(p) {
  return `<div class="grid cols3">
    <div class="card"><h3 style="margin-top:0">Состояние</h3>
      <p>Уровень ухода: <b>${CARE_RU[p.care_level]}</b><br>
      Деменция: ${p.dementia ? "<b>да</b>" : "нет"}<br>
      Лежачий: ${p.bedridden ? "<b>да</b>" : "нет"}<br>
      Падения в анамнезе: ${p.fall_history ? "<b>да</b>" : "нет"}</p></div>
    <div class="card"><h3 style="margin-top:0">Диагнозы и аллергии</h3>
      <p>Диагнозы: ${esc(p.diagnoses) || "—"}<br>Аллергии: ${esc(p.allergies) || "—"}</p></div>
    <div class="card"><h3 style="margin-top:0">Лекарства</h3>
      <p>${esc(p.meds) || "—"}</p></div>
  </div>
  <div class="toolbar" style="margin-top:14px"><button onclick="editMedDlg('${p.id}')">Изменить медданные</button></div>`;
}

function rTabFinance(p) {
  const c = Store.contractOf(p.id);
  const charges = Store.data.charges.filter(x => x.resident_id === p.id).sort((a, b) => b.month.localeCompare(a.month));
  const pays = Store.data.payments.filter(x => x.resident_id === p.id).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const chRows = charges.map(ch => `<tr><td>${monthRu(ch.month)}</td><td>${esc(ch.title)}</td><td class="right">${money(ch.amount)}</td></tr>`).join("");
  const pRows = pays.map(x => `<tr><td>${fmtDate(x.date)}</td><td>${esc(x.method)}</td><td class="right ok-t">${money(x.amount)}</td></tr>`).join("");
  const bal = Store.balance(p.id);
  return `
    <div class="card" style="margin-bottom:14px">
      <h3 style="margin-top:0">Договор</h3>
      ${c ? `<p>№ <b>${esc(c.number)}</b> от ${fmtDate(c.started)} · Плательщик: ${esc(c.payer_name)} ${esc(c.payer_phone)}<br>
        Тариф: <b>${money(c.monthly)}</b>/мес ${c.extras ? "+ доп. услуги " + money(c.extras) : ""}</p>
        <button class="small" onclick="contractDlg('${p.id}')">Изменить договор</button>`
      : `<p class="muted">Договора нет.</p><button class="small primary" onclick="contractDlg('${p.id}')">Оформить договор</button>`}
    </div>
    <div class="toolbar">
      <button class="primary" onclick="payDlg('${p.id}')">+ Оплата</button>
      <span class="${bal < 0 ? "bad-t" : "ok-t"}" style="font-weight:600">${bal < 0 ? "Долг: " + money(-bal) : "Переплата/ноль: " + money(bal)}</span>
    </div>
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:14px">
      <div class="card" style="padding:0"><table><thead><tr><th colspan=3>Начисления</th></tr></thead><tbody>${chRows || "<tr><td class='muted'>нет</td></tr>"}</tbody></table></div>
      <div class="card" style="padding:0"><table><thead><tr><th colspan=3>Оплаты</th></tr></thead><tbody>${pRows || "<tr><td class='muted'>нет</td></tr>"}</tbody></table></div>
    </div>`;
}

function rTabLog(p) {
  const rows = Store.eventsOf({ resident_id: p.id, limit: 50 }).map(e =>
    `<tr><td class="muted" style="white-space:nowrap">${fmtTs(e.ts)}</td>
     <td><span class="tag ${e.kind === "incident" ? "bad" : ""}">${KIND_RU[e.kind] || e.kind}</span></td>
     <td>${esc(e.text)}</td></tr>`).join("");
  return `<div class="card" style="padding:0"><table><tbody>${rows || "<tr><td class='muted'>Журнал пуст</td></tr>"}</tbody></table></div>`;
}

// ── Действия постояльца ──────────────────────────────────────
function editProfileDlg(rid) {
  const p = Store.byId("residents", rid);
  formModal("Анкета", [
    { key: "name", label: "ФИО", value: p.name },
    { key: "birth", label: "Дата рождения", type: "date", value: p.birth },
    { key: "doc", label: "Документ (ИИН/паспорт)", value: p.doc },
    { key: "notes", label: "Заметки", type: "textarea", value: p.notes },
  ], (v) => { Store.updateResident(rid, v); rerender(); });
}
window.editProfileDlg = editProfileDlg;

function editMedDlg(rid) {
  const p = Store.byId("residents", rid);
  formModal("Медицинские данные", [
    { key: "care_level", label: "Уровень ухода", type: "select", value: p.care_level,
      options: [{ value: "independent", label: "самостоятельный" }, { value: "assisted", label: "частичный уход" }, { value: "intensive", label: "интенсивный уход" }] },
    { key: "dementia", label: "Деменция", type: "checkbox", value: p.dementia },
    { key: "bedridden", label: "Лежачий", type: "checkbox", value: p.bedridden },
    { key: "fall_history", label: "Падения в анамнезе", type: "checkbox", value: p.fall_history },
    { key: "diagnoses", label: "Диагнозы", type: "textarea", value: p.diagnoses },
    { key: "allergies", label: "Аллергии", value: p.allergies },
    { key: "meds", label: "Лекарства (приём)", type: "textarea", value: p.meds },
  ], (v) => { Store.updateResident(rid, v); rerender(); });
}
window.editMedDlg = editMedDlg;

function kinDlg(rid) {
  formModal("Контакт родственника", [
    { key: "name", label: "Имя" },
    { key: "relation", label: "Кем приходится", value: "дочь" },
    { key: "phone", label: "Телефон" },
  ], (v) => {
    const p = Store.byId("residents", rid);
    p.kin = (p.kin || []).concat([v]); Store.save(); rerender();
  });
}
window.kinDlg = kinDlg;

function contractDlg(rid) {
  const c = Store.contractOf(rid) || {};
  formModal("Договор", [
    { key: "number", label: "Номер", value: c.number },
    { key: "started", label: "Дата начала", type: "date", value: c.started || today() },
    { key: "payer_name", label: "Плательщик", value: c.payer_name },
    { key: "payer_phone", label: "Телефон плательщика", value: c.payer_phone },
    { key: "monthly", label: "Тариф, ₸/мес", type: "number", value: c.monthly || 350000 },
    { key: "extras", label: "Доп. услуги, ₸/мес", type: "number", value: c.extras || 0 },
  ], (v) => {
    if (c.id) Store.updateContract(c.id, v);
    else Store.addContract(Object.assign(v, { resident_id: rid }));
    rerender();
  });
}
window.contractDlg = contractDlg;

function payDlg(rid) {
  const p = Store.byId("residents", rid);
  const c = Store.contractOf(rid);
  formModal("Оплата — " + p.name, [
    { key: "amount", label: "Сумма, ₸", type: "number", value: c ? (Number(c.monthly) + Number(c.extras || 0)) : 0 },
    { key: "date", label: "Дата", type: "date", value: today() },
    { key: "method", label: "Способ", type: "select", value: "kaspi",
      options: [{ value: "kaspi", label: "Kaspi" }, { value: "наличные", label: "Наличные" }, { value: "перевод", label: "Банковский перевод" }] },
  ], (v) => {
    Store.addPayment({ resident_id: rid, facility_id: p.facility_id, amount: v.amount, date: v.date, method: v.method });
    Store.addEvent({ resident_id: rid, facility_id: p.facility_id, kind: "payment", text: "Оплата " + money(v.amount) + " (" + v.method + ")" });
    rerender();
  });
}
window.payDlg = payDlg;

function transferDlg(rid) {
  const p = Store.byId("residents", rid);
  const facOpts = Store.data.facilities.map(f => ({ value: f.id, label: f.name }));
  formModal("Перевод постояльца", [
    { key: "facility_id", label: "Филиал", type: "select", value: p.facility_id, options: facOpts },
    { key: "room_id", label: "ID комнаты (пусто — без койки, выбрать на «Койках»)", value: "" },
  ], (v) => {
    let roomId = v.room_id || null;
    if (roomId && !Store.byId("rooms", roomId)) roomId = null;
    Store.transferResident(rid, v.facility_id, roomId);
    location.hash = "#/f/" + v.facility_id + "?tab=beds";
  });
}
window.transferDlg = transferDlg;

function dischargeDlg(rid) {
  formModal("Выселение", [
    { key: "date", label: "Дата", type: "date", value: today() },
    { key: "reason", label: "Причина", placeholder: "переезд к семье / госпитализация / ..." },
  ], (v) => {
    const p = Store.dischargeResident(rid, v.date, v.reason);
    location.hash = "#/f/" + p.facility_id + "?tab=residents";
  });
}
window.dischargeDlg = dischargeDlg;

// ── Вью: отчёты ──────────────────────────────────────────────
function viewReports() {
  const m = thisMonth();
  const rows = Store.data.facilities.map(f => {
    const bs = Store.bedStats(f.id);
    const occ = bs.beds ? Math.round(bs.used / bs.beds * 100) : 0;
    const debt = Store.debtors(f.id).reduce((s, d) => s + d.debt, 0);
    return `<tr class="click" onclick="location.hash='#/f/${f.id}'">
      <td><b>${esc(f.name)}</b></td>
      <td class="right">${bs.used}/${bs.beds} (${occ}%)</td>
      <td class="right">${money(Store.monthCharged(f.id, m))}</td>
      <td class="right ok-t">${money(Store.monthRevenue(f.id, m))}</td>
      <td class="right ${debt ? "bad-t" : ""}">${money(debt)}</td>
      <td class="right">${Store.incidents30d(f.id)}</td></tr>`;
  }).join("");

  const debtorsAll = Store.debtors(null).slice(0, 20).map(d => {
    const f = Store.byId("facilities", d.resident.facility_id);
    return `<tr class="click" onclick="location.hash='#/r/${d.resident.id}?tab=finance'">
      <td>${esc(d.resident.name)}</td><td class="muted">${f ? esc(f.name) : ""}</td>
      <td class="right bad-t"><b>${money(d.debt)}</b></td></tr>`;
  }).join("");

  return `
    <h2>Отчёты по сети — ${monthRu(m)}</h2>
    <h3>Филиалы</h3>
    <div class="card" style="padding:0"><table>
      <thead><tr><th>Филиал</th><th class="right">Заполняемость</th><th class="right">Начислено</th><th class="right">Собрано</th><th class="right">Долги</th><th class="right">Инциденты 30д</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <h3>Топ должников по сети</h3>
    <div class="toolbar"><button onclick="exportDebtorsCsv()">Экспорт должников CSV</button></div>
    <div class="card" style="padding:0"><table>
      <thead><tr><th>Постоялец</th><th>Филиал</th><th class="right">Долг</th></tr></thead>
      <tbody>${debtorsAll || "<tr><td colspan=3 class='ok-t'>Долгов нет 🎉</td></tr>"}</tbody></table></div>`;
}

function exportDebtorsCsv() {
  const rows = [["Постоялец", "Филиал", "Долг", "Телефон плательщика"]];
  for (const d of Store.debtors(null)) {
    const f = Store.byId("facilities", d.resident.facility_id);
    const c = Store.contractOf(d.resident.id);
    rows.push([d.resident.name, f ? f.name : "", d.debt, c ? c.payer_phone : ""]);
  }
  download("должники_сети.csv", toCsv(rows), "text/csv");
}
window.exportDebtorsCsv = exportDebtorsCsv;

// ── Вью: данные ──────────────────────────────────────────────
function viewData() {
  const facOpts = Store.data.facilities.map(f => `<option value="${f.id}">${esc(f.name)}</option>`).join("");
  return `
    <h2>Данные</h2>
    <div class="grid cols3">
      <div class="card">
        <h3 style="margin-top:0">Резервная копия</h3>
        <p class="muted" style="font-size:12.5px">Данные хранятся в этом браузере. Регулярно выгружайте копию в файл.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="primary" onclick="download('erp_backup_'+today()+'.json', Store.exportJson(),'application/json')">Экспорт в файл</button>
          <button onclick="importDlg()">Импорт из файла</button>
        </div>
      </div>
      <div class="card">
        <h3 style="margin-top:0">Конфиг мониторинга</h3>
        <p class="muted" style="font-size:12.5px">Выгрузка residents.yaml для системы мониторинга «Пансион» (RuView): постояльцы и комнаты выбранного филиала с их особенностями.</p>
        <select id="yamlFac" style="width:100%;margin-bottom:8px">${facOpts}</select>
        <button onclick="showYamlModal('residents.yaml — конфиг мониторинга', Store.monitoringYaml(document.getElementById('yamlFac').value))">Показать конфиг</button>
      </div>
      <div class="card">
        <h3 style="margin-top:0">Демо-данные</h3>
        <p class="muted" style="font-size:12.5px">Сбросить всё и заново заполнить демонстрационной сетью из 3 филиалов.</p>
        <button class="danger" onclick="if(confirm('Все текущие данные будут заменены демо-данными. Продолжить?')){seedDatabase(Store);rerender()}">Сбросить на демо</button>
      </div>
    </div>`;
}

function importDlg() {
  const inp = document.createElement("input");
  inp.type = "file"; inp.accept = ".json,application/json";
  inp.onchange = () => {
    const file = inp.files[0]; if (!file) return;
    const fr = new FileReader();
    fr.onload = () => {
      try { Store.importJson(fr.result); alert("Импорт выполнен."); rerender(); }
      catch (e) { alert("Ошибка импорта: " + e.message); }
    };
    fr.readAsText(file);
  };
  inp.click();
}
window.importDlg = importDlg;

function demoNote() {
  return `<div class="demo-note">Демонстрационные данные (все ФИО вымышленные). Изменения сохраняются в вашем браузере. Раздел «Данные» — резервная копия и сброс.</div>`;
}

// ── Старт ────────────────────────────────────────────────────
route();
