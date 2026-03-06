import XLSX from "xlsx";
import { db } from "../server/db";
import { staff, staffAssignments } from "../shared/schema";
import { eq, and, sql } from "drizzle-orm";

const TRANSLITERATION: Record<string, string> = {
  "Акопян Жанна": "Zhanna Akopyan",
  "Аксенова Мария": "Maria Aksenova",
  "Аланова Мария": "Maria Alanova",
  "Амирасланова Кристина": "Kristina Amiraslanova",
  "Аничина Наталья": "Nataly Anichina",
  "Антипина Анастасия": "Anastasiya Antipina",
  "Аралова Александра": "Alexandra Aralova",
  "Аржанов Захар": "Zakhar Arzhanov",
  "Бабченец Олеся": "Olesya Babchenets",
  "Баркан Мария": "Maria Barkan",
  "Бекова Дениза": "Deniza Bekova",
  "Белецкая Екатерина": "Ekaterina Beletskaya",
  "Белолипецкая Анастасия": "Anastasia Belolipetskaya",
  "Бикмухаметова Раиля": "Railya Bikmukhametova",
  "Борисова Екатерина": "Ekaterina Borisova",
  "Василевская Марина": "Marina Vasilevskaya",
  "Василиади Анна": "Anna Vasiliadi",
  "Валиева Гульназ": "Gulnaz Valieva",
  "Воробьева Анна": "Anna Vorobieva",
  "Войнова Наталья": "Natalia Voynova",
  "Грачева Владислава": "Vladislava Gracheva",
  "Гребиниченко Валерия": "Valeriia Grebinichenko",
  "Гриднева Ксения": "Ksenia Gridneva",
  "Грудачев Алексей": "Alexey Grudachev",
  "Головатюк Екатерина": "Ekaterina Golovatyuk",
  "Голоборщева Алиса": "Alisa Goloborshcheva",
  "Данилова Александра": "Alexandra Danilova",
  "Денисова Анастасия": "Anastasiya Denisova",
  "Дмитренко Алеся": "Alesya Dmitrenko",
  "Дмитриева Юлия": "Julia Dmitrieva",
  "Дмитрук Данила": "Danila Dmitruk",
  "Днистрянская Анна": "Anna Dnistryanskaya",
  "Елгина Полина": "Polina Elgina",
  "Эмилова Асел": "Asel Emilova",
  "Зайцева Анастасия": "Anastasia Zaytseva",
  "Зиновьев Илья": "Ilya Zinovev",
  "Иванов Александр": "Alexander Ivanov",
  "Иванов Максим": "Maxim Ivanov",
  "Иванова Ольга": "Olga Ivanova",
  "Идрисова Александра": "Alexandra Idrisova",
  "Изотов Марк": "Mark Izotov",
  "Ильина Юлия": "Yulia Ilyna",
  "Ипполитова Виктория": "Victoria Ippolitova",
  "Канал Гузаль": "Guzal Kanal",
  "Капсулецкая Марианна": "Marianna Kapsuletskaya",
  "Кинякина Екатерина": "Ekaterina Kinyakina",
  "Клюева Яна": "Yana Klyueva",
  "Ковшевная Маргарита": "Margarita Kovshevnaya",
  "Колесник Александра": "Alexandra Kolesnik",
  "Коноваленко Екатерина": "Ekaterina Konovalenko",
  "Котова Юлия": "Julia Kotova",
  "Котовец Анастасия": "Anastasiya Kotovec",
  "Кукуян Надежда": "Nadezhda Kukuyan",
  "Кулиш Евгения": "Evgenia Kulish",
  "Кутькова Наталья": "Natalya Kutkova",
  "Лазун Елена": "Elena Lazun",
  "Либертинская Евгения": "Evgenia Libertinskaya",
  "Лубнина Анастасия": "Anastasia Lubnina",
  "Луцкова Лариса": "Larisa Lutskova",
  "Любимый Андрей": "Andrey Lyubimyi",
  "Малая Светлана": "Svetlana Malaya",
  "Мамедова Камилла": "Kamilla Mamedova",
  "Маршалл Дарьяна": "Daryana Marshall",
  "Мельникова Наталья": "Natalia Melnikova",
  "Микоян Ангела": "Angela Mikoyan",
  "Найда Екатерина": "Ekaterina Naida",
  "Налбандян Елизавета": "Elizaveta Nalbandyan",
  "Никифорова Алеся": "Alesya Nikiforova",
  "Никифорова Софья": "Sofiya Nikiforova",
  "Николаева Анастасия": "Anastasia Nikolaeva",
  "Ногина Светлана": "Svetlana Nogina",
  "Оленева Наталья": "Natalia Oleneva",
  "Панарина Калинникия": "Kalinnikiya Panarina",
  "Папп Ирина": "Irina Papp",
  "Пась Мария": "Maryia Pas",
  "Петросова Кристина": "Kristina Petrosova",
  "Петухова Александра": "Alexandra Petukhova",
  "Пьянкова Кристина": "Kristina Piankova",
  "Пичуева Анастасия": "Anastasiya Pichueva",
  "Попова Юлия": "Julia Popova",
  "Потопахина Инна": "Inna Potopakhina",
  "Размыслова Анастасия": "Anastasia Razmyslova",
  "Руденко Юлия": "Julia Rudenko",
  "Руденко Максим": "Maxim Rudenko",
  "Рудык Дарья": "Daria Rudyk",
  "Рылева Мария": "Maria Ryleva",
  "Рзаева Сабина": "Sabina Rzaeva",
  "Сафронова Анна": "Anna Safronova",
  "Савицкая Юлия": "Ylia Savitskaya",
  "Семенова Валерия": "Valeriya Semenova",
  "Сермягина Елена": "Elena Sermyagina",
  "Шаброва Анастасия": "Anastasia Shabrova",
  "Шадевская Анна": "Anna Shadevskaya",
  "Шишканова Карина": "Karina Shishkanova",
  "Шмидт Анастасия": "Anastasia Shmidt",
  "Шульгина Анастасия": "Anastasia Shulgina",
  "Сколотнев Александр": "Alexander Skolotnev",
  "Скоркина Ирина": "Irina Skorkina",
  "Скуратова Мария": "Maria Skuratova",
  "Слепокуров Сергей": "Sergey Slepokurov",
  "Смирнова Светлана": "Svetlana Smirnova",
  "Смолин Рустам": "Rustam Smolin",
  "Солнышкина Юлия": "Julia Solnyshkina",
  "Солодунова Татьяна": "Tatiana Solodunova",
  "Соловьева Алина": "Alina Solovyova",
  "Степанова Анна": "Anna Stepanova",
  "Степанова Светлана": "Svetlana Stepanova",
  "Судникова Ирина": "Irina Sudnikova",
  "Супрун Светлана": "Svetlana Suprun",
  "Сурина Екатерина": "Ekaterina Surina",
  "Сверчкова Наталья": "Natalya Sverchkova",
  "Сырцева Татьяна": "Tatiana Syrtseva",
  "Сывороткина Марина": "Marina Syvorotkina",
  "Харитонова Роксана": "Roxana Kharitonova",
  "Хиль Светлана": "Svetlana Khil",
  "Чернышев Кирилл": "Kirill Chernyshev",
  "Чернышова Ксения": "Ksenia Chernyshova",
  "Чернозубенко Александра": "Alexandra Chernozubenko",
  "Федотов Николай": "Nikolay Fedotov",
  "Якушева Юлия": "Julia Jakusheva",
  "Ярославцева Анастасия": "Anastasia Yaroslavtseva",
  "Юркина Кристина": "Kristina Yurkina",
  "Юшук Яна": "Yana Yushuk",
  "Забродин Дмитрий": "Dmitry Zabrodin",
  "Задорожний Дмитрий": "Dmitry Zadorozhniy",
  "Зубов Борис": "Boris Zubov",
};

interface SectionMapping {
  departmentId: number;
  groupId: number | null;
}

const TOP_LEVEL_SECTIONS = new Set([
  "Global",
  "Global (валюта)",
  "SHOPPING",
  "Переменная часть баинга",
  "СТОК",
  "Внештатный отдел",
  "SHOPPING (валюта)",
]);

const SECTION_TO_DEPT: Record<string, SectionMapping> = {
  "Администрация проекта": { departmentId: 10, groupId: null },
  "Администрация проект: отдел HR": { departmentId: 10, groupId: 3 },
  "Баинг": { departmentId: 12, groupId: null },
  "Баинг (график)": { departmentId: 12, groupId: null },
  "Клиентский сервис (график)": { departmentId: 13, groupId: null },
  "Коммерческий отдел": { departmentId: 14, groupId: null },
  "Контент": { departmentId: 17, groupId: 4 },
  "Логистика": { departmentId: 16, groupId: null },
  "Логистика (график)": { departmentId: 16, groupId: null },
  "Направление \"Авито\"": { departmentId: 14, groupId: 1 },
  "Разарботка ПО \"1 С\"": { departmentId: 10, groupId: 2 },
  "Управление данными и разработка": { departmentId: 17, groupId: null },
  "УДР: парсинг": { departmentId: 17, groupId: 5 },
  "Финансовый отдел: группа учета": { departmentId: 18, groupId: 6 },
  "Финансовый отдел: группа CRM": { departmentId: 18, groupId: 7 },
  "Финансовый отдел: группа учёта первички": { departmentId: 18, groupId: 8 },
  "Переменная часть баинга": { departmentId: 12, groupId: null },
  "СТОК": { departmentId: 14, groupId: 9 },
  "Финансовый отдел (USD)": { departmentId: 18, groupId: null },
  "Отдел развития": { departmentId: 9, groupId: null },
};

const VNESHTATNY_MAPPING: Record<string, SectionMapping> = {
  "Аланов Кирилл": { departmentId: 13, groupId: null },
  "Аралов Лука": { departmentId: 16, groupId: null },
  "Валиева Анна": { departmentId: 16, groupId: null },
  "Ильина Юлия": { departmentId: 18, groupId: null },
  "Размыслова Анастасия": { departmentId: 18, groupId: null },
  "Руденко Юлия": { departmentId: 18, groupId: null },
};

const FREELANCERS_TO_ADD = [
  { firstName: "Ksenia", lastName: "Dotsenko" },
  { firstName: "Kirill", lastName: "Mikhalchenkov" },
  { firstName: "Timur", lastName: "Mukhametgalin" },
  { firstName: "Bogdan", lastName: "Pavlov" },
  { firstName: "Yuri", lastName: "Reikhert" },
  { firstName: "Evgenia", lastName: "Skiba" },
  { firstName: "Diana", lastName: "Yashina" },
  { firstName: "Anastasia", lastName: "Borisova" },
  { firstName: "Yana", lastName: "Stolyarova" },
  { firstName: "Kirill", lastName: "Alanov" },
  { firstName: "Luka", lastName: "Aralov" },
  { firstName: "Anna", lastName: "Valieva" },
  { firstName: "Ekaterina", lastName: "Basangova" },
  { firstName: "Victoria", lastName: "Buta" },
  { firstName: "Tatiana", lastName: "Nastashenko" },
  { firstName: "Alexander", lastName: "Bychkov" },
  { firstName: "Victoria", lastName: "Krenzhelok" },
  { firstName: "Natalya", lastName: "Ponomaryova" },
];

const FREELANCER_TRANSLIT: Record<string, string> = {
  "Доценко Ксения": "Ksenia Dotsenko",
  "Михальченков Кирилл": "Kirill Mikhalchenkov",
  "Мухаметгалин Тимур": "Timur Mukhametgalin",
  "Павлов Богдан": "Bogdan Pavlov",
  "Рейхерт Юрий": "Yuri Reikhert",
  "Скиба Евгения": "Evgenia Skiba",
  "Яшина Диана": "Diana Yashina",
  "Борисова Анастасия": "Anastasia Borisova",
  "Столярова Яна": "Yana Stolyarova",
  "Аланов Кирилл": "Kirill Alanov",
  "Аралов Лука": "Luka Aralov",
  "Валиева Анна": "Anna Valieva",
  "Басангова Екатерина": "Ekaterina Basangova",
  "Бута Виктория": "Victoria Buta",
  "Насташенко Татьяна": "Tatiana Nastashenko",
  "Бычков Александр": "Alexander Bychkov",
  "Кренжелок Виктория": "Victoria Krenzhelok",
  "Пономарёва Наталья": "Natalya Ponomaryova",
};

function extractNameKey(fullName: string): string {
  const cleaned = fullName
    .replace(/\s*\(.*?\)\s*/g, " ")
    .replace(/\n.*$/s, "")
    .trim();
  const parts = cleaned.split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0]} ${parts[1]}`;
  }
  return cleaned;
}

async function main() {
  console.log("=== Payroll Import Script ===\n");

  const wb = XLSX.readFile("uploads/payroll/2.xlsx");
  const ws = wb.Sheets["Январь 2026"];
  if (!ws) {
    console.error("Sheet 'Январь 2026' not found!");
    process.exit(1);
  }

  const merges = ws["!merges"] || [];
  const sectionRows = new Map<number, string>();
  for (const m of merges) {
    if (m.s.c === 0 && m.e.c >= 1) {
      const cell = ws[XLSX.utils.encode_cell({ r: m.s.r, c: 0 })];
      if (cell) {
        sectionRows.set(m.s.r, String(cell.v).trim());
      }
    }
  }

  const sortedSectionRows = [...sectionRows.entries()].sort((a, b) => a[0] - b[0]);
  console.log("Found sections:", sortedSectionRows.map(([r, n]) => `  row ${r}: ${n}`).join("\n"));

  const range = XLSX.utils.decode_range(ws["!ref"]!);

  interface EmployeeEntry {
    nameKey: string;
    fullName: string;
    section: string;
    topLevelSection: string;
    mapping: SectionMapping | null;
  }

  const entries: EmployeeEntry[] = [];
  let currentTopLevel = "Global";
  let currentSection = "";

  for (let r = 0; r <= range.e.r; r++) {
    if (sectionRows.has(r)) {
      const sectionName = sectionRows.get(r)!;
      if (TOP_LEVEL_SECTIONS.has(sectionName)) {
        currentTopLevel = sectionName;
        if (["Global", "Global (валюта)"].includes(sectionName)) {
          currentSection = "";
        } else if (sectionName === "Внештатный отдел") {
          currentSection = "Внештатный отдел";
        } else if (sectionName === "Переменная часть баинга") {
          currentSection = "Переменная часть баинга";
        } else if (sectionName === "СТОК") {
          currentSection = "СТОК";
        } else if (sectionName === "SHOPPING (валюта)") {
          currentSection = "";
        } else {
          currentSection = "";
        }
      } else {
        currentSection = sectionName;
      }
      continue;
    }

    const cellB = ws[XLSX.utils.encode_cell({ r, c: 1 })];
    if (!cellB) continue;
    const cellBVal = String(cellB.v).trim();

    if (!cellBVal || cellBVal === "Итого" || cellBVal.startsWith("зарплата") ||
        cellBVal.startsWith("премия") || cellBVal.startsWith("отпуск") ||
        cellBVal.startsWith("штраф") || cellBVal.startsWith("увольнение") ||
        cellBVal.startsWith("бонус") || cellBVal.startsWith("больничный") ||
        cellBVal.startsWith("итого") || cellBVal.startsWith("Итого") ||
        cellBVal.length < 5) continue;

    const cellA = ws[XLSX.utils.encode_cell({ r, c: 0 })];
    const cellAVal = cellA ? String(cellA.v).trim() : "";

    const looksLikeName = /^[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+/.test(cellBVal);
    const looksLikeService = /услуг|информацион|консульт|подбор|продаж|анализ|менеджер/i.test(cellAVal);
    const isNameInB = looksLikeName || looksLikeService;

    if (!isNameInB) continue;

    const nameKey = extractNameKey(cellBVal);

    let mapping: SectionMapping | null = null;

    if (["Global", "Global (валюта)"].includes(currentTopLevel) && !currentSection) {
      mapping = { departmentId: 9, groupId: null };
    } else if (currentTopLevel === "Global" && currentSection) {
      if (currentSection === "Отдел развития") {
        mapping = { departmentId: 9, groupId: null };
      } else {
        mapping = SECTION_TO_DEPT[currentSection] || null;
        if (mapping) {
          mapping = { departmentId: 9, groupId: null };
        }
      }
    } else if (currentSection === "Внештатный отдел") {
      mapping = VNESHTATNY_MAPPING[nameKey] || null;
    } else if (currentSection) {
      mapping = SECTION_TO_DEPT[currentSection] || null;
    }

    if (mapping) {
      entries.push({
        nameKey,
        fullName: cellBVal,
        section: currentSection || currentTopLevel,
        topLevelSection: currentTopLevel,
        mapping,
      });
    }
  }

  console.log(`\nParsed ${entries.length} employee entries from file.\n`);

  console.log("--- Step 1: Add freelancers ---");
  for (const f of FREELANCERS_TO_ADD) {
    const existing = await db
      .select()
      .from(staff)
      .where(and(eq(staff.firstName, f.firstName), eq(staff.lastName, f.lastName)));
    if (existing.length === 0) {
      const placeholderEmail = `${f.firstName.toLowerCase()}.${f.lastName.toLowerCase()}@freelancer.local`;
      const [inserted] = await db
        .insert(staff)
        .values({ firstName: f.firstName, lastName: f.lastName, position: "Фрилансер", email: placeholderEmail })
        .returning();
      console.log(`  Added: ${f.firstName} ${f.lastName} (id: ${inserted.id})`);
    } else {
      console.log(`  Already exists: ${f.firstName} ${f.lastName} (id: ${existing[0].id})`);
    }
  }

  const allStaff = await db.select().from(staff);
  const staffByName = new Map<string, typeof allStaff[0]>();
  for (const s of allStaff) {
    staffByName.set(`${s.firstName} ${s.lastName}`, s);
  }

  const allTranslit = { ...TRANSLITERATION, ...FREELANCER_TRANSLIT };

  console.log("\n--- Step 2: Match and create assignments ---");
  let matched = 0;
  let unmatched = 0;
  const assignmentsToCreate: { staffId: number; departmentId: number; groupId: number | null }[] = [];
  const unmatchedNames: string[] = [];

  const seen = new Set<string>();
  for (const entry of entries) {
    const translitName = allTranslit[entry.nameKey];
    if (!translitName) {
      if (!seen.has(entry.nameKey)) {
        unmatchedNames.push(`${entry.nameKey} (${entry.section})`);
        seen.add(entry.nameKey);
      }
      unmatched++;
      continue;
    }

    const staffMember = staffByName.get(translitName);
    if (!staffMember) {
      if (!seen.has(entry.nameKey)) {
        unmatchedNames.push(`${entry.nameKey} -> ${translitName} (not in DB, section: ${entry.section})`);
        seen.add(entry.nameKey);
      }
      unmatched++;
      continue;
    }

    const gId = entry.mapping!.groupId;
    const assignKey = `${staffMember.id}-${entry.mapping!.departmentId}-${gId ?? 'null'}`;
    if (!seen.has(assignKey)) {
      seen.add(assignKey);
      assignmentsToCreate.push({
        staffId: staffMember.id,
        departmentId: entry.mapping!.departmentId,
        groupId: gId,
      });
      matched++;
    }
  }

  console.log(`  Matched: ${matched}, Unmatched: ${unmatched}`);
  if (unmatchedNames.length > 0) {
    console.log(`  Unmatched names:\n    ${unmatchedNames.join("\n    ")}`);
  }

  await db.delete(staffAssignments);
  console.log("  Cleared existing assignments.");

  let created = 0;
  for (const a of assignmentsToCreate) {
    try {
      await db.insert(staffAssignments).values(a).onConflictDoNothing();
      created++;
    } catch (e: any) {
      console.error(`  Failed to create assignment: staff=${a.staffId} dept=${a.departmentId} group=${a.groupId}: ${e.message}`);
    }
  }

  console.log(`  Created ${created} assignments.\n`);

  const finalAssignments = await db.select().from(staffAssignments);
  console.log(`Total assignments in DB: ${finalAssignments.length}`);

  console.log("\n=== Import Complete ===");
  process.exit(0);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
