"use strict";
/* ============================================================
 * Хранилище данных ERP «Тёплый дом» (прототип).
 *
 * Данные живут в localStorage браузера (ключ DB_KEY) — это
 * полнофункциональный прототип для демонстраций и одиночной
 * работы. Структура и API спроектированы так, чтобы позже
 * подменить реализацию на REST-бэкенд без переписывания UI.
 *
 * Сущности:
 *   org        — организация (сеть)
 *   facilities — филиалы
 *   rooms      — комнаты (с числом коек)
 *   residents  — постояльцы (анкета + медицина + койка)
 *   contracts  — договоры (тариф/мес, плательщик)
 *   charges    — начисления (постоялец, месяц "YYYY-MM", сумма)
 *   payments   — оплаты (постоялец, дата, сумма, способ)
 *   staff      — сотрудники филиалов
 *   events     — журнал (заселение, выселение, инцидент, заметка)
 * ============================================================ */

const DB_KEY = "carehome_erp_v1";

const Store = {
  data: null,

  // ── Загрузка/сохранение ───────────────────────────────────
  blank() {
    return {
      org: { name: "Сеть домов престарелых", currency: "₸" },
      facilities: [], rooms: [], residents: [], contracts: [],
      charges: [], payments: [], staff: [], events: [],
      meta: { created: Date.now(), version: 1 },
    };
  },

  load() {
    try {
      const raw = localStorage.getItem(DB_KEY);
      this.data = raw ? JSON.parse(raw) : null;
    } catch (e) { this.data = null; }
    if (!this.data || !this.data.facilities) this.data = null;
    return this.data;
  },

  save() {
    localStorage.setItem(DB_KEY, JSON.stringify(this.data));
  },

  reset(newData) {
    this.data = newData || this.blank();
    this.save();
  },

  exportJson() {
    return JSON.stringify(this.data, null, 2);
  },

  importJson(text) {
    const d = JSON.parse(text);
    if (!d.facilities || !d.residents) throw new Error("Файл не похож на выгрузку ERP");
    this.data = d; this.save();
  },

  // ── Утилиты ───────────────────────────────────────────────
  uid(prefix) {
    return prefix + "_" + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
  },

  byId(coll, id) { return this.data[coll].find(x => x.id === id) || null; },

  // ── Филиалы ───────────────────────────────────────────────
  addFacility(f) {
    const item = Object.assign({ id: this.uid("fac"), name: "", city: "", address: "", phone: "", director: "" }, f);
    this.data.facilities.push(item); this.save(); return item;
  },
  updateFacility(id, patch) {
    const f = this.byId("facilities", id); if (!f) return null;
    Object.assign(f, patch); this.save(); return f;
  },

  // ── Комнаты/койки ─────────────────────────────────────────
  addRoom(r) {
    const item = Object.assign({ id: this.uid("room"), facility_id: "", name: "", beds: 1, floor: "" }, r);
    this.data.rooms.push(item); this.save(); return item;
  },
  updateRoom(id, patch) {
    const r = this.byId("rooms", id); if (!r) return null;
    Object.assign(r, patch); this.save(); return r;
  },
  roomsOf(facilityId) { return this.data.rooms.filter(r => r.facility_id === facilityId); },

  /** Занятые койки комнаты: список постояльцев со статусом active в этой комнате. */
  occupants(roomId) {
    return this.data.residents.filter(p => p.status === "active" && p.room_id === roomId);
  },

  bedStats(facilityId) {
    let beds = 0, used = 0;
    for (const r of this.roomsOf(facilityId)) {
      beds += Number(r.beds) || 0;
      used += this.occupants(r.id).length;
    }
    return { beds, used, free: beds - used };
  },

  // ── Постояльцы ────────────────────────────────────────────
  addResident(p) {
    const item = Object.assign({
      id: this.uid("res"),
      facility_id: "", room_id: null,
      name: "", birth: "", gender: "ж", doc: "",
      kin: [],                       // [{name, phone, relation}]
      care_level: "assisted",        // independent | assisted | intensive
      dementia: false, bedridden: false, fall_history: false,
      diagnoses: "", allergies: "", meds: "",
      notes: "",
      status: "active",              // active | discharged
      admitted: "", discharged_at: "",
    }, p);
    this.data.residents.push(item); this.save(); return item;
  },
  updateResident(id, patch) {
    const p = this.byId("residents", id); if (!p) return null;
    Object.assign(p, patch); this.save(); return p;
  },
  residentsOf(facilityId, includeDischarged) {
    return this.data.residents.filter(p =>
      p.facility_id === facilityId && (includeDischarged || p.status === "active"));
  },

  /** Выселение: освобождает койку, закрывает договор, пишет событие. */
  dischargeResident(id, dateStr, reason) {
    const p = this.byId("residents", id); if (!p) return null;
    p.status = "discharged"; p.discharged_at = dateStr || today(); p.room_id = null;
    for (const c of this.data.contracts.filter(c => c.resident_id === id && c.active)) {
      c.active = false; c.ended = p.discharged_at;
    }
    this.addEvent({ resident_id: id, facility_id: p.facility_id, kind: "discharge",
                    text: "Выселение" + (reason ? ": " + reason : "") });
    this.save(); return p;
  },

  /** Перевод в другой филиал/комнату. */
  transferResident(id, facilityId, roomId) {
    const p = this.byId("residents", id); if (!p) return null;
    const from = this.byId("facilities", p.facility_id);
    const to = this.byId("facilities", facilityId);
    p.facility_id = facilityId; p.room_id = roomId || null;
    this.addEvent({ resident_id: id, facility_id: facilityId, kind: "transfer",
                    text: "Перевод: " + (from ? from.name : "?") + " → " + (to ? to.name : "?") });
    this.save(); return p;
  },

  // ── Договоры ──────────────────────────────────────────────
  addContract(c) {
    const item = Object.assign({
      id: this.uid("ctr"), resident_id: "", number: "", started: today(), ended: "",
      payer_name: "", payer_phone: "", monthly: 0, extras: 0, active: true, comment: "",
    }, c);
    this.data.contracts.push(item); this.save(); return item;
  },
  updateContract(id, patch) {
    const c = this.byId("contracts", id); if (!c) return null;
    Object.assign(c, patch); this.save(); return c;
  },
  contractOf(residentId) {
    return this.data.contracts.find(c => c.resident_id === residentId && c.active) || null;
  },

  // ── Финансы ───────────────────────────────────────────────
  addCharge(ch) {
    const item = Object.assign({ id: this.uid("chg"), resident_id: "", facility_id: "",
      month: "", amount: 0, title: "Проживание и уход" }, ch);
    this.data.charges.push(item); this.save(); return item;
  },
  addPayment(p) {
    const item = Object.assign({ id: this.uid("pay"), resident_id: "", facility_id: "",
      date: today(), amount: 0, method: "kaspi", comment: "" }, p);
    this.data.payments.push(item); this.save(); return item;
  },

  /** Сформировать начисления за месяц по активным договорам филиала.
   *  Идемпотентно: повторный вызов не дублирует. Возвращает число новых. */
  generateCharges(facilityId, month) {
    let n = 0;
    for (const p of this.residentsOf(facilityId)) {
      const c = this.contractOf(p.id);
      if (!c) continue;
      const exists = this.data.charges.some(ch => ch.resident_id === p.id && ch.month === month);
      if (exists) continue;
      this.addCharge({ resident_id: p.id, facility_id: facilityId, month,
        amount: (Number(c.monthly) || 0) + (Number(c.extras) || 0) });
      n++;
    }
    return n;
  },

  balance(residentId) {
    const charged = this.data.charges.filter(c => c.resident_id === residentId)
      .reduce((s, c) => s + Number(c.amount || 0), 0);
    const paid = this.data.payments.filter(p => p.resident_id === residentId)
      .reduce((s, p) => s + Number(p.amount || 0), 0);
    return paid - charged; // <0 — долг
  },

  debtors(facilityId) {
    const list = [];
    for (const p of (facilityId ? this.residentsOf(facilityId) :
                     this.data.residents.filter(x => x.status === "active"))) {
      const b = this.balance(p.id);
      if (b < 0) list.push({ resident: p, debt: -b });
    }
    list.sort((a, b) => b.debt - a.debt);
    return list;
  },

  monthRevenue(facilityId, month) {
    return this.data.payments
      .filter(p => (!facilityId || p.facility_id === facilityId) && (p.date || "").slice(0, 7) === month)
      .reduce((s, p) => s + Number(p.amount || 0), 0);
  },

  monthCharged(facilityId, month) {
    return this.data.charges
      .filter(c => (!facilityId || c.facility_id === facilityId) && c.month === month)
      .reduce((s, c) => s + Number(c.amount || 0), 0);
  },

  // ── Персонал ──────────────────────────────────────────────
  addStaff(s) {
    const item = Object.assign({ id: this.uid("stf"), facility_id: "", name: "",
      role: "медсестра", phone: "", comment: "" }, s);
    this.data.staff.push(item); this.save(); return item;
  },
  updateStaff(id, patch) {
    const s = this.byId("staff", id); if (!s) return null;
    Object.assign(s, patch); this.save(); return s;
  },
  removeStaff(id) {
    this.data.staff = this.data.staff.filter(s => s.id !== id); this.save();
  },

  // ── Журнал событий ────────────────────────────────────────
  addEvent(e) {
    const item = Object.assign({ id: this.uid("evt"), resident_id: null, facility_id: "",
      kind: "note", text: "", ts: Date.now() }, e);
    this.data.events.unshift(item);
    if (this.data.events.length > 3000) this.data.events.length = 3000;
    this.save(); return item;
  },
  eventsOf(opts) {
    let list = this.data.events;
    if (opts.resident_id) list = list.filter(e => e.resident_id === opts.resident_id);
    if (opts.facility_id) list = list.filter(e => e.facility_id === opts.facility_id);
    if (opts.kind) list = list.filter(e => e.kind === opts.kind);
    if (opts.sinceTs) list = list.filter(e => e.ts >= opts.sinceTs);
    return list.slice(0, opts.limit || 200);
  },
  incidents30d(facilityId) {
    const since = Date.now() - 30 * 86400e3;
    return this.eventsOf({ facility_id: facilityId, kind: "incident", sinceTs: since, limit: 999 }).length;
  },

  // ── Выгрузка конфига мониторинга (модуль «Пансион») ───────
  monitoringYaml(facilityId) {
    const f = this.byId("facilities", facilityId);
    const lines = [];
    lines.push("# Конфиг мониторинга RuView/Пансион — выгружено из ERP");
    lines.push("# Филиал: " + (f ? f.name : facilityId));
    lines.push("facility:");
    lines.push('  name: "' + (f ? f.name : "Филиал") + '"');
    lines.push("  night_start_hour: 22");
    lines.push("  night_end_hour: 7");
    lines.push("");
    lines.push("residents:");
    const active = this.residentsOf(facilityId);
    for (const p of active) {
      lines.push("  - id: " + p.id);
      lines.push('    name: "' + p.name + '"');
      lines.push("    care_level: " + (p.care_level || "assisted"));
      if (p.dementia) lines.push("    dementia: true");
      if (p.bedridden) lines.push("    bedridden: true");
      if (p.fall_history) lines.push("    fall_history: true");
      const kin = (p.kin && p.kin[0]) ? p.kin[0] : null;
      if (kin) lines.push('    kin_contact: "' + kin.phone + " (" + (kin.relation || "родственник") + ')"');
    }
    lines.push("");
    lines.push("rooms:");
    for (const r of this.roomsOf(facilityId)) {
      const occ = this.occupants(r.id);
      lines.push('  - id: "' + r.id + '"');
      lines.push('    name: "' + r.name + '"');
      lines.push('    node_id: "ЗАМЕНИТЕ_НА_node_id_датчика"');
      if (occ[0]) lines.push("    resident_id: " + occ[0].id);
    }
    return lines.join("\n");
  },
};

function today() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function thisMonth() {
  return new Date().toISOString().slice(0, 7);
}

// Для headless-проверки под Node.
if (typeof module !== "undefined") module.exports = { Store, today, thisMonth };
