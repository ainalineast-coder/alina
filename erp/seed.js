"use strict";
/* ============================================================
 * Демо-данные: сеть «Тёплый дом», 3 филиала (Алматы ×2, Астана).
 * Генерируются детерминированно (свой PRNG), чтобы демо везде
 * выглядело одинаково. Все ФИО вымышленные.
 * ============================================================ */

function seedDatabase(StoreRef) {
  // Детерминированный PRNG (mulberry32).
  let s = 20260611;
  const rnd = () => { s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));

  const SURN_F = ["Иванова","Ахметова","Петрова","Садыкова","Кузнецова","Омарова","Смирнова","Алиева","Попова","Нурланова","Соколова","Ержанова","Михайлова","Касымова","Фёдорова","Бекова","Морозова","Жумабаева","Волкова","Сулейменова"];
  const SURN_M = ["Иванов","Ахметов","Петров","Садыков","Кузнецов","Омаров","Смирнов","Алиев","Попов","Нурланов","Соколов","Ержанов","Михайлов","Касымов","Фёдоров","Беков","Морозов","Жумабаев","Волков","Сулейменов"];
  const NAME_F = ["Мария","Айгуль","Анна","Гульнара","Валентина","Сауле","Людмила","Роза","Нина","Камила","Тамара","Багдат","Галина","Зейнеп","Светлана"];
  const NAME_M = ["Николай","Серик","Борис","Марат","Владимир","Касым","Пётр","Ермек","Иван","Болат","Виктор","Темир","Геннадий","Аскар","Михаил"];
  const PATR_F = ["Петровна","Сериковна","Ивановна","Маратовна","Николаевна","Болатовна","Викторовна","Аскаровна","Михайловна","Ермековна"];
  const PATR_M = ["Петрович","Серикович","Иванович","Маратович","Николаевич","Болатович","Викторович","Аскарович","Михайлович","Ермекович"];
  const RELATIONS = ["дочь","сын","внук","внучка","племянница","сестра","брат"];
  const STAFF_ROLES = ["медсестра","сиделка","врач","повар","администратор"];
  const INCIDENTS = ["Падение в палате, без травм","Жалоба на головокружение","Отказ от ужина","Падение в санузле, вызван врач","Повышенное давление, дано лекарство","Ночное блуждание, возвращён в палату"];

  const phone = () => "+7 7" + ri(0, 9) + ri(0, 9) + " " + ri(100, 999) + "-" + ri(10, 99) + "-" + ri(10, 99);

  const db = StoreRef.blank();
  StoreRef.data = db;
  db.org.name = "Сеть «Тёплый дом»";

  // ── Филиалы ───────────────────────────────────────────────
  const facsSpec = [
    { name: "Тёплый дом — Алматы, Центр", city: "Алматы", address: "ул. Абая, 25", rooms: 14, fill: 0.93 },
    { name: "Тёплый дом — Алматы, Юг",    city: "Алматы", address: "мкр. Орбита-3, 11", rooms: 10, fill: 0.78 },
    { name: "Тёплый дом — Астана",        city: "Астана", address: "ул. Кенесары, 40", rooms: 12, fill: 0.85 },
  ];

  const months = lastMonths(3); // [старый, прошлый, текущий]
  const tariffs = [280000, 320000, 350000, 380000, 420000];

  for (const fs of facsSpec) {
    const fac = StoreRef.addFacility({
      name: fs.name, city: fs.city, address: fs.address,
      phone: phone(), director: pick(SURN_F) + " " + pick(NAME_F),
    });

    // Комнаты: 1-2-местные.
    const rooms = [];
    for (let i = 1; i <= fs.rooms; i++) {
      rooms.push(StoreRef.addRoom({
        facility_id: fac.id,
        name: "Палата " + (100 + i),
        beds: (i % 3 === 0) ? 1 : 2,
        floor: i <= fs.rooms / 2 ? "1 этаж" : "2 этаж",
      }));
    }

    // Персонал.
    for (let i = 0; i < 6; i++) {
      const female = rnd() < 0.8;
      StoreRef.addStaff({
        facility_id: fac.id,
        name: (female ? pick(SURN_F) + " " + pick(NAME_F) : pick(SURN_M) + " " + pick(NAME_M)),
        role: i === 0 ? "старшая медсестра" : pick(STAFF_ROLES),
        phone: phone(),
      });
    }

    // Постояльцы: заполняем койки с коэффициентом fill.
    const totalBeds = rooms.reduce((sum, r) => sum + r.beds, 0);
    let target = Math.round(totalBeds * fs.fill);
    for (const room of rooms) {
      for (let b = 0; b < room.beds && target > 0; b++, target--) {
        const female = rnd() < 0.62;
        const name = female
          ? pick(SURN_F) + " " + pick(NAME_F) + " " + pick(PATR_F)
          : pick(SURN_M) + " " + pick(NAME_M) + " " + pick(PATR_M);
        const care = rnd() < 0.2 ? "intensive" : (rnd() < 0.35 ? "independent" : "assisted");
        const bedridden = care === "intensive" && rnd() < 0.6;
        const res = StoreRef.addResident({
          facility_id: fac.id, room_id: room.id,
          name, gender: female ? "ж" : "м",
          birth: (1936 + ri(0, 16)) + "-" + String(ri(1, 12)).padStart(2, "0") + "-" + String(ri(1, 28)).padStart(2, "0"),
          doc: "ИИН " + ri(360000, 520000) + String(ri(100000, 999999)),
          kin: [{ name: pick(female ? NAME_F : NAME_M), phone: phone(), relation: pick(RELATIONS) }],
          care_level: care,
          dementia: rnd() < 0.22,
          bedridden,
          fall_history: rnd() < 0.3,
          diagnoses: pick(["Гипертония", "ИБС", "Сахарный диабет 2 типа", "Артроз", "Последствия инсульта", "ХОБЛ"]),
          allergies: rnd() < 0.25 ? pick(["пенициллин", "аспирин", "йод"]) : "",
          meds: pick(["Эналаприл 10мг утром", "Метформин 500мг 2р/д", "Аспаркам", "Амлодипин 5мг", "—"]),
          admitted: months[0] + "-" + String(ri(1, 28)).padStart(2, "0"),
          status: "active",
        });

        // Договор.
        const monthly = pick(tariffs) + (care === "intensive" ? 80000 : 0);
        StoreRef.addContract({
          resident_id: res.id,
          number: "Д-" + fac.id.slice(-3).toUpperCase() + "/" + ri(100, 999),
          started: res.admitted,
          payer_name: res.kin[0].name + " (" + res.kin[0].relation + ")",
          payer_phone: res.kin[0].phone,
          monthly, extras: rnd() < 0.3 ? 25000 : 0,
        });
      }
    }

    // Начисления за 3 месяца + оплаты (часть — должники).
    for (const m of months) StoreRef.generateCharges(fac.id, m);
    for (const p of StoreRef.residentsOf(fac.id)) {
      const c = StoreRef.contractOf(p.id);
      if (!c) continue;
      const amt = (Number(c.monthly) || 0) + (Number(c.extras) || 0);
      const debtor = rnd() < 0.12;            // ~12% должников
      const payMonths = debtor ? months.slice(0, 2) : months;
      for (const m of payMonths) {
        // текущий месяц у небольшой части — ещё не оплачен (начало месяца)
        if (m === months[2] && rnd() < 0.12 && !debtor) continue;
        StoreRef.addPayment({
          resident_id: p.id, facility_id: fac.id,
          date: m + "-" + String(ri(1, 10)).padStart(2, "0"),
          amount: amt, method: pick(["kaspi", "наличные", "перевод"]),
        });
      }
    }

    // События: заселения + инциденты за последний месяц.
    for (const p of StoreRef.residentsOf(fac.id).slice(0, 5)) {
      StoreRef.addEvent({ resident_id: p.id, facility_id: fac.id, kind: "admit",
        text: "Заселение, договор оформлен", ts: Date.now() - ri(40, 80) * 86400e3 });
    }
    const residents = StoreRef.residentsOf(fac.id);
    const nInc = ri(2, 5);
    for (let i = 0; i < nInc; i++) {
      const p = pick(residents);
      StoreRef.addEvent({ resident_id: p.id, facility_id: fac.id, kind: "incident",
        text: pick(INCIDENTS), ts: Date.now() - ri(0, 29) * 86400e3 - ri(0, 86399) * 1000 });
    }
  }

  StoreRef.save();
  return db;
}

function lastMonths(n) {
  const out = [];
  const d = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push(x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0"));
  }
  return out;
}

if (typeof module !== "undefined") module.exports = { seedDatabase, lastMonths };
