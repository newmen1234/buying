import { db } from "../server/db";
import { payrollEntries, staff } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { getRatesForDate, convertToRub } from "../server/cbr-rates";
import XLSX from "xlsx";

const FILE_PATH = "uploads/payroll/2.xlsx";

interface MonthConfig {
  year: number;
  month: number;
  sheetName: string;
  cbrDate: string;
  colTotal: number;
  colPctN: number;
  colPctV: number;
  colAmtN: number;
  colAmtV: number;
}

const MONTHS: MonthConfig[] = [
  { year: 2024, month: 1, sheetName: "Январь 2024", cbrDate: "2024-01-15", colTotal: 3, colPctN: 4, colPctV: 6, colAmtN: 5, colAmtV: 7 },
  { year: 2024, month: 2, sheetName: "Февраль 2024", cbrDate: "2024-02-15", colTotal: 3, colPctN: 4, colPctV: 6, colAmtN: 5, colAmtV: 7 },
  { year: 2024, month: 3, sheetName: "Март 2024", cbrDate: "2024-03-15", colTotal: 3, colPctN: 4, colPctV: 6, colAmtN: 5, colAmtV: 7 },
  { year: 2024, month: 4, sheetName: "Апрель 2024", cbrDate: "2024-04-15", colTotal: 3, colPctN: 4, colPctV: 5, colAmtN: 6, colAmtV: 7 },
  { year: 2024, month: 5, sheetName: "Май 2024", cbrDate: "2024-05-15", colTotal: 3, colPctN: 4, colPctV: 5, colAmtN: 6, colAmtV: 7 },
  { year: 2024, month: 6, sheetName: "Июнь 2024", cbrDate: "2024-06-15", colTotal: 3, colPctN: 4, colPctV: 5, colAmtN: 6, colAmtV: 7 },
  { year: 2024, month: 7, sheetName: "Июль 2024 ", cbrDate: "2024-07-15", colTotal: 3, colPctN: 4, colPctV: 5, colAmtN: 6, colAmtV: 7 },
  { year: 2024, month: 8, sheetName: "Август 2024", cbrDate: "2024-08-15", colTotal: 3, colPctN: 4, colPctV: 5, colAmtN: 6, colAmtV: 7 },
  { year: 2024, month: 9, sheetName: "Сентябрь 2024", cbrDate: "2024-09-15", colTotal: 4, colPctN: 5, colPctV: 6, colAmtN: 7, colAmtV: 8 },
  { year: 2024, month: 10, sheetName: "Октябрь 2024", cbrDate: "2024-10-15", colTotal: 4, colPctN: 5, colPctV: 6, colAmtN: 7, colAmtV: 8 },
  { year: 2024, month: 11, sheetName: "Ноябрь 2024", cbrDate: "2024-11-15", colTotal: 4, colPctN: 5, colPctV: 6, colAmtN: 7, colAmtV: 8 },
  { year: 2024, month: 12, sheetName: "Декабрь 2024", cbrDate: "2024-12-15", colTotal: 4, colPctN: 5, colPctV: 6, colAmtN: 7, colAmtV: 8 },
  { year: 2025, month: 1, sheetName: "Январь 2025", cbrDate: "2025-01-15", colTotal: 4, colPctN: 5, colPctV: 6, colAmtN: 7, colAmtV: 8 },
  { year: 2025, month: 2, sheetName: "Февраль 2025", cbrDate: "2025-02-15", colTotal: 4, colPctN: 5, colPctV: 6, colAmtN: 7, colAmtV: 8 },
  { year: 2025, month: 3, sheetName: "Март 2025", cbrDate: "2025-03-15", colTotal: 4, colPctN: 5, colPctV: 6, colAmtN: 7, colAmtV: 8 },
  { year: 2025, month: 4, sheetName: "Апрель 2025", cbrDate: "2025-04-15", colTotal: 4, colPctN: 5, colPctV: 6, colAmtN: 7, colAmtV: 8 },
  { year: 2025, month: 5, sheetName: "Май 2025", cbrDate: "2025-05-15", colTotal: 4, colPctN: 5, colPctV: 6, colAmtN: 7, colAmtV: 8 },
  { year: 2025, month: 6, sheetName: "Июнь 2025", cbrDate: "2025-06-15", colTotal: 4, colPctN: 5, colPctV: 6, colAmtN: 7, colAmtV: 8 },
  { year: 2025, month: 7, sheetName: "Июль 2025", cbrDate: "2025-07-15", colTotal: 4, colPctN: 5, colPctV: 6, colAmtN: 7, colAmtV: 8 },
  { year: 2025, month: 8, sheetName: "Август 2025", cbrDate: "2025-08-15", colTotal: 4, colPctN: 5, colPctV: 6, colAmtN: 7, colAmtV: 8 },
  { year: 2025, month: 9, sheetName: "Сентябрь 2025", cbrDate: "2025-09-15", colTotal: 5, colPctN: 6, colPctV: 7, colAmtN: 8, colAmtV: 9 },
  { year: 2025, month: 10, sheetName: "Октябрь 2025", cbrDate: "2025-10-15", colTotal: 5, colPctN: 6, colPctV: 7, colAmtN: 8, colAmtV: 9 },
  { year: 2025, month: 11, sheetName: "Ноябрь 2025", cbrDate: "2025-11-15", colTotal: 5, colPctN: 6, colPctV: 7, colAmtN: 8, colAmtV: 9 },
  { year: 2025, month: 12, sheetName: "Декабрь 2025", cbrDate: "2025-12-15", colTotal: 5, colPctN: 6, colPctV: 7, colAmtN: 8, colAmtV: 9 },
  { year: 2026, month: 1, sheetName: "Январь 2026", cbrDate: "2026-01-15", colTotal: 5, colPctN: 6, colPctV: 7, colAmtN: 8, colAmtV: 9 },
];

const TOP_LEVEL_MARKERS = new Set([
  "Основная часть", "Переменная часть", "Сотрудники с валютой", "Фрилансеры",
  "Global", "Global (валюта)", "Общая компания",
  "SHOPPING", "SHOPPING (валюта)",
]);

const SECTION_TO_DEPT: Record<string, { departmentId: number; groupId: number | null }> = {
  "Администрация проекта": { departmentId: 10, groupId: null },
  "Администрация проект: отдел HR": { departmentId: 10, groupId: 3 },
  "Администрация проекта: водитель-курьер": { departmentId: 10, groupId: null },
  "Администрация проекта: отдел CRM": { departmentId: 18, groupId: 7 },
  "Администрация проекта: финансовый отдел": { departmentId: 18, groupId: 6 },
  "Администрация проекта: группа учёта первички": { departmentId: 18, groupId: 8 },
  "Баинг": { departmentId: 12, groupId: null },
  "Баинг (график)": { departmentId: 12, groupId: null },
  "Клиентский сервис": { departmentId: 13, groupId: null },
  "Клиентский сервис (график)": { departmentId: 13, groupId: null },
  "Коммерческий отдел": { departmentId: 14, groupId: null },
  "Контент": { departmentId: 17, groupId: 4 },
  "Логистика": { departmentId: 16, groupId: null },
  "Логистика (график)": { departmentId: 16, groupId: null },
  "Онлайн продажи": { departmentId: 14, groupId: 10 },
  "Отдел 1 С": { departmentId: 10, groupId: 2 },
  "Отдел развития": { departmentId: 9, groupId: null },
  "Управление данными и разработка": { departmentId: 17, groupId: null },
  "УДР: парсинг": { departmentId: 17, groupId: 5 },
  'Направление "Авито"': { departmentId: 14, groupId: 1 },
  'Направление "Сток"': { departmentId: 14, groupId: 9 },
  'Направление "Amazon"': { departmentId: 14, groupId: 11 },
  'Разарботка ПО "1 С"': { departmentId: 10, groupId: 2 },
  "СТОК": { departmentId: 14, groupId: 9 },
  "Финансовый отдел: группа учета": { departmentId: 18, groupId: 6 },
  "Финансовый отдел: группа CRM": { departmentId: 18, groupId: 7 },
  "Финансовый отдел: группа учёта первички": { departmentId: 18, groupId: 8 },
  "Финансовый отдел (USD)": { departmentId: 18, groupId: 6 },
  "УДР: парсинг (KZT)": { departmentId: 17, groupId: 5 },
  "УДР (USD)": { departmentId: 17, groupId: null },
  "Руководитель": { departmentId: 10, groupId: null },
  "Юридический отдел": { departmentId: 10, groupId: null },
  "Развитие ассортимента": { departmentId: 9, groupId: null },
  "Отдел 1 С/Аналитики": { departmentId: 10, groupId: 2 },
  "Управ. данными и разработка": { departmentId: 17, groupId: null },
  "Агентство": { departmentId: 10, groupId: null },
  "ФО: группа CRM": { departmentId: 18, groupId: 7 },
  "ФО: группа учёта первички": { departmentId: 18, groupId: 8 },
  "Финансовый отдел": { departmentId: 18, groupId: null },
};

const VNESHTATNY_MAPPING: Record<string, { departmentId: number; groupId: number | null }> = {
  "Аланов Кирилл": { departmentId: 13, groupId: null },
  "Аралов Лука": { departmentId: 16, groupId: null },
  "Валиева Анна": { departmentId: 16, groupId: null },
  "Ильина Юлия": { departmentId: 18, groupId: null },
  "Размыслова Анастасия": { departmentId: 18, groupId: null },
  "Руденко Юлия": { departmentId: 18, groupId: null },
  "Басангова Екатерина": { departmentId: 12, groupId: null },
  "Бута Виктория": { departmentId: 12, groupId: null },
  "Насташенко Татьяна": { departmentId: 12, groupId: null },
  "Бычков Александр": { departmentId: 17, groupId: null },
  "Кренжелок Виктория": { departmentId: 12, groupId: null },
  "Пономарева Наталья": { departmentId: 12, groupId: null },
  "Дмитренко Алеся": { departmentId: 12, groupId: null },
  "Доценко Ксения": { departmentId: 12, groupId: null },
  "Изотов Марк": { departmentId: 12, groupId: null },
  "Мухаметгалин Тимур": { departmentId: 12, groupId: null },
  "Павлов Богдан": { departmentId: 12, groupId: null },
  "Яшина Диана": { departmentId: 12, groupId: null },
  "Пичуева Анастасия": { departmentId: 12, groupId: null },
  "Гурьева Инна": { departmentId: 12, groupId: null },
  "Коженцев Андрей": { departmentId: 17, groupId: null },
  "Копытова Екатерина": { departmentId: 12, groupId: null },
  "Карян Наталья": { departmentId: 12, groupId: null },
  "Гелагаева Елизавета": { departmentId: 12, groupId: null },
  "Голубев Александр": { departmentId: 12, groupId: null },
  "Малинский Илья": { departmentId: 12, groupId: null },
  "Елгина Полина": { departmentId: 14, groupId: null },
  "Кинякина Екатерина": { departmentId: 14, groupId: null },
  "Рылева Мария": { departmentId: 16, groupId: null },
  "Василевская Марина": { departmentId: 18, groupId: null },
  "Степанова Анна": { departmentId: 18, groupId: null },
  "Бурый Виталий": { departmentId: 9, groupId: null },
  "Жуков Леонид": { departmentId: 17, groupId: null },
  "Поддержка Стокифай,": { departmentId: 14, groupId: 9 },
  "Поддержка Стокифай": { departmentId: 14, groupId: 9 },
};

const EMPLOYEE_OVERRIDES: Record<string, { departmentId?: number; groupId?: number | null; direction?: string; currency?: string }> = {
  "Бурый Виталий": { departmentId: 9, groupId: null, direction: "global" },
  "Гаар Альфред": { departmentId: 17, groupId: 5 },
  "Пась Мария": { currency: "BYN" },
};

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
  "Борисова Анастасия": "Anastasia Borisova",
  "Валиева Гульназ": "Gulnaz Valieva",
  "Вылегжанина Анастасия": "Anastasiya Vylegzhanina",
  "Глазкова Валерия": "Valeria Glazkova",
  "Гребиниченко Валерия": "Valeria Grebinichenko",
  "Гриднева Ксения": "Ksenia Gridneva",
  "Гусарова Полина": "Polina Gusarova",
  "Зиновьев Илья": "Ilya Zinovev",
  "Ивлева Ирина": "Irina Ivleva",
  "Каминская Диана": "Diana Kaminskaya",
  "Канал Гузаль": "Guzal Kanal",
  "Канафьева Кристина": "Kristina Kanafyeva",
  "Козлова Дарья": "Daria Kozlova",
  "Коробкова Мария": "Maria Korobkova",
  "Костырина Виктория": "Victoria Kostyrina",
  "Кравцова Юлия": "Yulia Kravtsova",
  "Кукуян Надежда": "Nadezhda Kukuyan",
  "Левыкина Мария": "Maria Levykina",
  "Либертинская Евгения": "Evgenia Libertinskaya",
  "Луцкова Лариса": "Larisa Lutskova",
  "Маннанова Аида": "Aida Mannanova",
  "Маркелов Павел": "Pavel Markelov",
  "Минязова Альфия": "Alfiya Minyazova",
  "Миранкова Екатерина": "Ekaterina Mirankova",
  "Моисеева Юлия": "Yulia Moiseeva",
  "Мурачева Ксения": "Ksenia Muracheva",
  "Мустафина Лидия": "Lidia Mustafina",
  "Никишина Екатерина": "Ekaterina Nikishina",
  "Николаева Кристина": "Kristina Nikolaeva",
  "Нуждина Яна": "Yana Nuzhdina",
  "Павликова Мария": "Maria Pavlikova",
  "Паль Ксения": "Ksenia Pal",
  "Пась Мария": "Maria Pas",
  "Подвальная Олеся": "Olesya Podvalnaya",
  "Полторацкая Полина": "Polina Poltoratskaya",
  "Прядко Мария": "Maria Pryadko",
  "Пьянкова Кристина": "Kristina Pyankova",
  "Размыслова Анастасия": "Anastasia Razmyslova",
  "Рябова Мария": "Maria Ryabova",
  "Сагитова Динара": "Dinara Sagitova",
  "Сайдуллаева Гулрухсор": "Gulrukhsor Saidullaeva",
  "Селедкина Наталья": "Natalia Seledkina",
  "Серебренникова Светлана": "Svetlana Serebrennikova",
  "Сименс Юлия": "Yulia Simens",
  "Сорокина Ирина": "Irina Sorokina",
  "Стволенко Мария": "Maria Stvolenko",
  "Столярова Яна": "Yana Stolyarova",
  "Сырцева Татьяна": "Tatiana Syrtseva",
  "Тимакова Мария": "Maria Timakova",
  "Федотов Николай": "Nikolay Fedotov",
  "Хабибуллина Евгения": "Evgenia Khabibullina",
  "Шаброва Анастасия": "Anastasia Shabrova",
  "Шацкая Ирина": "Irina Shatskaya",
  "Шевернева Мария": "Maria Sheverneva",
  "Эмилова Асель": "Asel Emilova",
  "Иванов Максим": "Maxim Ivanov",
  "Руденко Юлия": "Yulia Rudenko",
  "Ильина Юлия": "Yulia Ilina",
  "Доценко Ксения": "Ksenia Dotsenko",
  "Михальченков Кирилл": "Kirill Mikhalchenkov",
  "Мухаметгалин Тимур": "Timur Mukhametgalin",
  "Павлов Богдан": "Bogdan Pavlov",
  "Рейхерт Юрий": "Yuri Reikhert",
  "Скиба Евгения": "Evgenia Skiba",
  "Яшина Диана": "Diana Yashina",
  "Аланов Кирилл": "Kirill Alanov",
  "Аралов Лука": "Luka Aralov",
  "Валиева Анна": "Anna Valieva",
  "Басангова Екатерина": "Ekaterina Basangova",
  "Бута Виктория": "Victoria Buta",
  "Насташенко Татьяна": "Tatiana Nastashenko",
  "Бычков Александр": "Alexander Bychkov",
  "Кренжелок Виктория": "Victoria Krenzhelok",
  "Пономарева Наталья": "Natalya Ponomaryova",
  "Никифорова Алеся": "Alesya Nikiforova",
  "Мельникова Наталья": "Natalia Melnikova",
  "Голоборщева Алиса": "Alisa Goloborshcheva",
  "Гурьева Инна": "Inna Guryeva",
  "Дмитренко Алеся": "Alesya Dmitrenko",
  "Изотов Марк": "Mark Izotov",
  "Коженцев Андрей": "Andrey Kozhentsev",
  "Гаар Альфред": "Alfred Gaar",
  "Денисова Анастасия": "Anastasia Denisova",
  "Копытова Екатерина": "Ekaterina Kopytova",
  "Карян Наталья": "Natalia Karyan",
  "Гелагаева Елизавета": "Elizaveta Gelagaeva",
  "Голубев Александр": "Alexander Golubev",
  "Малинский Илья": "Ilya Malinskiy",
  "Жуков Леонид": "Leonid Zhukov",
  "Бурый Виталий": "Vitaliy Buriy",
  "Поддержка Стокифай": "Podderzhka Stockify",
  "Авдюхова Ольга": "Olga Avdyukhova",
  "Агафонкина Виктория": "Victoria Agafonkina",
  "Аксёнова Мария": "Maria Aksenova",
  "Алещенко Ксения": "Ksenia Aleshchenko",
  "Ахмадишин Ислам": "Islam Akhmadishin",
  "Балацкий Ростислав": "Rostislav Balatsky",
  "Башкатов Александр": "Alexander Bashkatov",
  "Болгов Никита": "Nikita Bolgov",
  "Борносуз Александр": "Alexander Bornosuz",
  "Воробьева Анна": "Anna Vorobyeva",
  "Голоборщева Роман": "Roman Goloborshchev",
  "Грудачев Алексей": "Alexey Grudachev",
  "Гузовский Даниил": "Daniil Guzovsky",
  "Данилова Александра": "Alexandra Danilova",
  "Дмитрук Данила": "Danila Dmitruk",
  "Днистрянская Анна": "Anna Dnistryanskaya",
  "Довнарович Андрей": "Andrey Dovnarovich",
  "Дохненко Даниил": "Daniil Dokhnenko",
  "Драгунская Алёна": "Alyona Dragunskaya",
  "Дюк Елизавета": "Elizaveta Dyuk",
  "Дяченко Алеся": "Alesya Dyachenko",
  "Елгина Полина": "Polina Elgina",
  "Задорожный Дмитрий": "Dmitry Zadorozhny",
  "Зайцева Анастасия": "Anastasiya Zaitseva",
  "Звдорожный Дмитрий": "Dmitry Zadorozhny",
  "Иванова Ольга": "Olga Ivanova",
  "Кадышева Анна": "Anna Kadysheva",
  "Карватская Наталья": "Natalya Karvatskaya",
  "Киселева Маргарита": "Margarita Kiseleva",
  "Клейменова Анна": "Anna Kleimenova",
  "Коноваленко Екатерина": "Ekaterina Konovalenko",
  "Костромина Кристина": "Kristina Kostromina",
  "Кочнева Галина": "Galina Kochneva",
  "Красникова Надежда": "Nadezhda Krasnikova",
  "Круглова Ирина": "Irina Kruglova",
  "Латынина Дарья": "Daria Latynina",
  "Лащенкова Светлана": "Svetlana Lashchenkova",
  "Лубнина Анастасия": "Anastasia Lubnina",
  "Луцков Лариса": "Larisa Lutskova",
  "Любимый Андрей": "Andrey Lyubimiy",
  "Мазько Анна": "Anna Mazko",
  "Мануилова Любовь": "Lyubov Manuilova",
  "Мачуло Вероника": "Veronika Machulo",
  "Михайлик Елена": "Elena Mikhaylik",
  "Найда Екатерина": "Ekaterina Naida",
  "Неделяев Дмитрий": "Dmitry Nedelyaev",
  "Нешев Марк": "Mark Neshev",
  "Никифорова Алевтина": "Alevtina Nikiforova",
  "Овчинникова Елена": "Elena Ovchinnikova",
  "Озерова Дарья": "Daria Ozerova",
  "Панарина Калинникия": "Kalinnikiya Panarina",
  "Папп Ирина": "Irina Papp",
  "Петросова Кристина": "Kristina Petrosova",
  "Пичуева Анастасия": "Anastasiya Pichueva",
  "Плотникова Карина": "Karina Plotnikova",
  "Политыко Максим": "Maxim Polityko",
  "Пономарёва Наталья": "Natalya Ponomaryova",
  "Руденко Максим": "Maxim Rudenko",
  "Руденко Ян": "Yan Rudenko",
  "Рудык Дарья": "Daria Rudyk",
  "Рылева Мария": "Maria Ryleva",
  "Савранчук Владимир": "Vladimir Savranchuk",
  "Сверчкова Наталья": "Natalya Sverchkova",
  "Сермягина Елена": "Elena Sermyagina",
  "Сирота Артём": "Artyom Sirota",
  "Скоркина Ирина": "Irina Skorkina",
  "Слепокуров Сергей": "Sergey Slepokurov",
  "Степанов Артемий": "Artemiy Stepanov",
  "Степанова Валентина": "Valentina Stepanova",
  "Татосян Тигран": "Tigran Tatosyan",
  "Толстенёва Олеся": "Olesya Tolsteneva",
  "Тюркоглу Зульфия": "Zulfiya Tyurkoglu",
  "Хачатрян Лиана": "Liana Khachatryan",
  "Хиль Светлана": "Svetlana Khil",
  "Хорошева Анастасия": "Anastasiya Khorosheva",
  "Чернышев Кирилл": "Kirill Chernyshev",
  "Чернышова Ксения": "Ksenia Chernyshova",
  "Шадевская Анна": "Anna Shadevskaya",
  "Шакиров Марат": "Marat Shakirov",
  "Шевчук Екатерина": "Ekaterina Shevchuk",
  "Шнейдер Лариса": "Larisa Shneider",
  "Яйчук Даниил": "Daniil Yaychuk",
  "Кинякина Екатерина": "Ekaterina Kinyakina",
};

const SKIP_SUBROW_PATTERNS = [
  "зарплата", "премия", "отпуск", "штраф", "увольнение", "бонус", "больничный",
  "итого", "Итого", "часовая", "остаток", "аванс", "компенсация", "расчетный",
  "расчётный", "баинг", "консультации", "лидер по", "Штрафы:", "принят", "уволен",
  "график", "совмещение", "стажировка", "обучение", "надбавка", "доплата",
  "переработка", "ночные", "праздничные", "командировка", "подработка",
  "продажа стокового", "подписание", "помощь в задачах",
  "заработная", "зарплота", "Дополнительная оплата", "расчет при увольнении",
  "рабочих дней", "https://", "рд из", "кд", "сборные заказы",
  "помощь в саппорт", "лидер по количеству", "Штраф ", "работа в", "компенсация",
];

function extractNameKey(fullName: string): string {
  const clean = fullName.replace(/\n.*/s, "").replace(/\(.*\)/, "").trim();
  const parts = clean.split(/\s+/);
  if (parts.length >= 2) return `${parts[0]} ${parts[1]}`;
  return clean;
}

function getNum(ws: XLSX.WorkSheet, r: number, c: number): number {
  const cell = ws[XLSX.utils.encode_cell({ r, c })];
  if (!cell) return 0;
  const v = Number(cell.v);
  return isNaN(v) ? 0 : v;
}

function isSubRow(val: string): boolean {
  const lower = val.toLowerCase();
  for (const pat of SKIP_SUBROW_PATTERNS) {
    if (lower.startsWith(pat.toLowerCase())) return true;
  }
  return false;
}

function looksLikeName(val: string): boolean {
  return /^[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+/.test(val);
}

function looksLikeServiceDescription(val: string): boolean {
  return /услуг|информацион|консульт|подбор|продаж|анализ|менеджер|помощь в орган/i.test(val);
}

function detectCurrencyFromSection(sectionName: string): string | null {
  if (sectionName.includes("(KZT)")) return "KZT";
  if (sectionName.includes("(USD)")) return "USD";
  if (sectionName.includes("(EUR)")) return "EUR";
  return null;
}

interface ParsedEntry {
  nameKey: string;
  fullName: string;
  departmentId: number;
  groupId: number | null;
  direction: string;
  amountTotal: number;
  amountNewmen: number;
  amountVatebo: number;
  pctNewmen: number;
  pctVatebo: number;
  currency: string;
  amountOriginal: number | null;
}

interface DeferredVariableEntry {
  nameKey: string;
  fullName: string;
  row: number;
  amountTotal_raw: number;
  amountNewmen_raw: number;
  amountVatebo_raw: number;
  pctNewmen: number;
  pctVatebo: number;
}

function parseSheet(
  ws: XLSX.WorkSheet,
  config: MonthConfig,
  rates: Record<string, number>,
): ParsedEntry[] {
  const range = XLSX.utils.decode_range(ws["!ref"]!);
  const merges = ws["!merges"] || [];
  const sectionRows = new Map<number, string>();

  for (const m of merges) {
    if (m.s.c === 0 && m.e.c >= 1) {
      const cell = ws[XLSX.utils.encode_cell({ r: m.s.r, c: 0 })];
      if (cell) {
        let val = String(cell.v).trim();
        val = val.replace(/\n.*$/s, "").trim();
        sectionRows.set(m.s.r, val);
      }
    }
  }

  const COL_TOTAL = config.colTotal;
  const COL_PCT_N = config.colPctN;
  const COL_PCT_V = config.colPctV;
  const COL_AMT_N = config.colAmtN;
  const COL_AMT_V = config.colAmtV;

  let currentTopLevel = "";
  let currentSection = "";
  let inPeremennaya = false;
  let inSotrudnikiValyuta = false;
  let inFreelancers = false;
  let inVneshtatny = false;
  let currencyOverride: string | null = null;

  const entries: ParsedEntry[] = [];
  const deferredVariable: DeferredVariableEntry[] = [];

  for (let r = 0; r <= range.e.r; r++) {
    if (sectionRows.has(r)) {
      const sectionName = sectionRows.get(r)!;

      if (sectionName === "Основная часть") {
        currentTopLevel = "Основная часть";
        currentSection = "";
        inPeremennaya = false;
        inSotrudnikiValyuta = false;
        inFreelancers = false;
        inVneshtatny = false;
        currencyOverride = null;
        continue;
      }

      if (sectionName === "Переменная часть") {
        inPeremennaya = true;
        inSotrudnikiValyuta = false;
        inFreelancers = false;
        inVneshtatny = false;
        currentSection = "";
        currencyOverride = null;
        continue;
      }

      if (sectionName === "Сотрудники с валютой") {
        inSotrudnikiValyuta = true;
        inPeremennaya = false;
        inFreelancers = false;
        inVneshtatny = false;
        currentSection = "";
        currencyOverride = null;
        continue;
      }

      if (sectionName === "Фрилансеры") {
        inFreelancers = true;
        inPeremennaya = false;
        inSotrudnikiValyuta = false;
        inVneshtatny = false;
        currentSection = "";
        currencyOverride = null;
        continue;
      }

      if (sectionName === "Внештатный отдел") {
        inVneshtatny = true;
        inPeremennaya = false;
        inSotrudnikiValyuta = false;
        inFreelancers = false;
        currentSection = sectionName;
        currencyOverride = null;
        continue;
      }

      if (sectionName === "Global") {
        currentTopLevel = "Global";
        currentSection = "";
        inPeremennaya = false;
        inSotrudnikiValyuta = false;
        inFreelancers = false;
        inVneshtatny = false;
        currencyOverride = null;
        continue;
      }

      if (sectionName === "Global (валюта)") {
        currentTopLevel = "Global (валюта)";
        currentSection = "";
        inPeremennaya = false;
        inSotrudnikiValyuta = false;
        inFreelancers = false;
        inVneshtatny = false;
        currencyOverride = "EUR";
        continue;
      }

      if (sectionName === "Общая компания") {
        currentTopLevel = "Общая компания";
        currentSection = "";
        inPeremennaya = false;
        inSotrudnikiValyuta = false;
        inFreelancers = false;
        inVneshtatny = false;
        currencyOverride = null;
        continue;
      }

      if (sectionName === "SHOPPING" || sectionName === "SHOPPING (валюта)") {
        currentTopLevel = sectionName;
        currentSection = "";
        inPeremennaya = false;
        inSotrudnikiValyuta = false;
        inFreelancers = false;
        inVneshtatny = false;
        currencyOverride = null;
        continue;
      }

      if (sectionName === "Переменная часть и проч. выплаты") {
        inPeremennaya = true;
        inSotrudnikiValyuta = false;
        inFreelancers = false;
        inVneshtatny = false;
        currentSection = "";
        currencyOverride = null;
        continue;
      }

      if (sectionName === "Внештатный отдел, переменная часть и проч. выплаты") {
        inVneshtatny = true;
        inPeremennaya = true;
        inSotrudnikiValyuta = false;
        inFreelancers = false;
        currentSection = sectionName;
        currencyOverride = null;
        continue;
      }

      if (sectionName === "Переменная часть баинга") {
        inPeremennaya = true;
        inSotrudnikiValyuta = false;
        inFreelancers = false;
        inVneshtatny = false;
        currentSection = "Баинг";
        currencyOverride = null;
        continue;
      }

      if (sectionName === "СТОК") {
        inPeremennaya = false;
        inSotrudnikiValyuta = false;
        inFreelancers = false;
        inVneshtatny = false;
        currentSection = sectionName;
        currencyOverride = null;
        continue;
      }

      if (sectionName === "контрольная сумма" || sectionName.startsWith("РАШ") || sectionName.startsWith("Расход со счета")) {
        continue;
      }

      if (inSotrudnikiValyuta) {
        currentSection = sectionName;
        currencyOverride = detectCurrencyFromSection(sectionName);
        continue;
      }

      if (inPeremennaya) {
        currentSection = sectionName;
        continue;
      }

      currentSection = sectionName;
      currencyOverride = detectCurrencyFromSection(sectionName);
      continue;
    }

    const cellB = ws[XLSX.utils.encode_cell({ r, c: 1 })];
    if (!cellB) continue;
    const cellBVal = String(cellB.v).trim();
    if (!cellBVal || cellBVal.length < 3) continue;

    if (cellBVal === "Итого" || cellBVal === "отдел" || isSubRow(cellBVal)) continue;
    if (cellBVal.toLowerCase().includes("контрольная сумма")) continue;

    const cellA = ws[XLSX.utils.encode_cell({ r, c: 0 })];
    const cellAVal = cellA ? String(cellA.v).trim().replace(/\n.*$/s, "").trim() : "";

    const nameCheck = looksLikeName(cellBVal);
    const serviceCheck = looksLikeServiceDescription(cellAVal);
    const isEmployeeRow = nameCheck || serviceCheck;

    if (!isEmployeeRow) continue;

    const nameKey = extractNameKey(cellBVal);

    if (inPeremennaya) {
      const amountTotal_raw = getNum(ws, r, COL_TOTAL);
      const pctNewmen = getNum(ws, r, COL_PCT_N);
      const pctVatebo = getNum(ws, r, COL_PCT_V);
      const amountNewmen_raw = getNum(ws, r, COL_AMT_N);
      const amountVatebo_raw = getNum(ws, r, COL_AMT_V);

      if (amountTotal_raw === 0 && amountNewmen_raw === 0 && amountVatebo_raw === 0) continue;

      deferredVariable.push({
        nameKey,
        fullName: cellBVal,
        row: r,
        amountTotal_raw,
        amountNewmen_raw,
        amountVatebo_raw,
        pctNewmen,
        pctVatebo,
      });
      continue;
    }

    let mapping: { departmentId: number; groupId: number | null } | null = null;
    let direction = "ru";
    let currency = "RUB";

    if (inVneshtatny) {
      mapping = VNESHTATNY_MAPPING[nameKey] || { departmentId: 10, groupId: null };
      direction = "ru";
    } else if (inFreelancers) {
      mapping = VNESHTATNY_MAPPING[nameKey] || { departmentId: 10, groupId: null };
      direction = "ru";
    } else if (inSotrudnikiValyuta) {
      mapping = SECTION_TO_DEPT[currentSection] || { departmentId: 9, groupId: null };
      direction = "ru";
      currency = currencyOverride || "RUB";
    } else if (currentTopLevel === "Global" || currentTopLevel === "Global (валюта)") {
      mapping = { departmentId: 9, groupId: null };
      direction = "global";
      if (currentTopLevel === "Global (валюта)") {
        currency = currencyOverride || "EUR";
      }
    } else if (currentTopLevel === "SHOPPING") {
      mapping = SECTION_TO_DEPT[currentSection] || null;
      direction = "ru";
      currency = "RUB";
    } else if (currentTopLevel === "SHOPPING (валюта)") {
      mapping = SECTION_TO_DEPT[currentSection] || null;
      direction = "ru";
      if (currentSection.includes("USD")) {
        currency = "USD";
      } else {
        currency = "EUR";
      }
    } else {
      mapping = SECTION_TO_DEPT[currentSection] || null;
      direction = "ru";
    }

    if (!mapping) {
      continue;
    }

    const override = EMPLOYEE_OVERRIDES[nameKey];
    if (override) {
      if (override.departmentId !== undefined) mapping = { departmentId: override.departmentId, groupId: override.groupId ?? mapping.groupId };
      if (override.direction) direction = override.direction;
      if (override.currency) currency = override.currency;
    }

    const amountTotal_raw = getNum(ws, r, COL_TOTAL);
    const pctNewmen = getNum(ws, r, COL_PCT_N);
    const pctVatebo = getNum(ws, r, COL_PCT_V);
    const amountNewmen_raw = getNum(ws, r, COL_AMT_N);
    const amountVatebo_raw = getNum(ws, r, COL_AMT_V);

    if (amountTotal_raw === 0 && amountNewmen_raw === 0 && amountVatebo_raw === 0) continue;

    let amountTotal: number;
    let amountNewmen: number;
    let amountVatebo: number;
    let amountOriginal: number | null = null;

    if (currency !== "RUB") {
      amountOriginal = amountTotal_raw;
      amountTotal = convertToRub(amountTotal_raw, currency, rates);
      amountNewmen = convertToRub(amountNewmen_raw, currency, rates);
      amountVatebo = convertToRub(amountVatebo_raw, currency, rates);
    } else {
      amountTotal = amountTotal_raw;
      amountNewmen = amountNewmen_raw;
      amountVatebo = amountVatebo_raw;
    }

    entries.push({
      nameKey,
      fullName: cellBVal,
      departmentId: mapping.departmentId,
      groupId: mapping.groupId,
      direction,
      amountTotal,
      amountNewmen,
      amountVatebo,
      pctNewmen,
      pctVatebo,
      currency,
      amountOriginal,
    });
  }

  const baseMappingByName = new Map<string, { departmentId: number; groupId: number | null; direction: string }>();
  for (const e of entries) {
    if (!baseMappingByName.has(e.nameKey)) {
      baseMappingByName.set(e.nameKey, {
        departmentId: e.departmentId,
        groupId: e.groupId,
        direction: e.direction,
      });
    }
  }

  for (const dv of deferredVariable) {
    let mapping = baseMappingByName.get(dv.nameKey);
    let direction = mapping?.direction || "ru";

    if (!mapping) {
      const vnMapping = VNESHTATNY_MAPPING[dv.nameKey];
      if (vnMapping) {
        mapping = { ...vnMapping, direction: "ru" };
        direction = "ru";
      }
    }

    if (!mapping) {
      console.log(`  [VARIABLE UNMATCHED] ${dv.nameKey} (row ${dv.row}): total=${dv.amountTotal_raw.toFixed(2)} — no department found`);
      continue;
    }

    const dvOverride = EMPLOYEE_OVERRIDES[dv.nameKey];
    let dvCurrency = "RUB";
    let dvDeptId = mapping.departmentId;
    let dvGroupId = mapping.groupId;
    let dvDirection = direction;
    if (dvOverride) {
      if (dvOverride.departmentId !== undefined) { dvDeptId = dvOverride.departmentId; dvGroupId = dvOverride.groupId ?? dvGroupId; }
      if (dvOverride.direction) dvDirection = dvOverride.direction;
      if (dvOverride.currency) dvCurrency = dvOverride.currency;
    }

    let dvAmountTotal = dv.amountTotal_raw;
    let dvAmountNewmen = dv.amountNewmen_raw;
    let dvAmountVatebo = dv.amountVatebo_raw;
    let dvAmountOriginal: number | null = null;
    if (dvCurrency !== "RUB") {
      dvAmountOriginal = dv.amountTotal_raw;
      dvAmountTotal = convertToRub(dv.amountTotal_raw, dvCurrency, rates);
      dvAmountNewmen = convertToRub(dv.amountNewmen_raw, dvCurrency, rates);
      dvAmountVatebo = convertToRub(dv.amountVatebo_raw, dvCurrency, rates);
    }

    entries.push({
      nameKey: dv.nameKey,
      fullName: dv.fullName,
      departmentId: dvDeptId,
      groupId: dvGroupId,
      direction: dvDirection,
      amountTotal: dvAmountTotal,
      amountNewmen: dvAmountNewmen,
      amountVatebo: dvAmountVatebo,
      pctNewmen: dv.pctNewmen,
      pctVatebo: dv.pctVatebo,
      currency: dvCurrency,
      amountOriginal: dvAmountOriginal,
    });
  }

  return entries;
}

function aggregateEntries(entries: ParsedEntry[]): ParsedEntry[] {
  const map = new Map<string, ParsedEntry>();

  for (const e of entries) {
    const key = `${e.nameKey}__${e.departmentId}__${e.groupId}__${e.currency}__${e.direction}`;
    const existing = map.get(key);
    if (existing) {
      existing.amountTotal += e.amountTotal;
      existing.amountNewmen += e.amountNewmen;
      existing.amountVatebo += e.amountVatebo;
      if (e.amountOriginal !== null) {
        existing.amountOriginal = (existing.amountOriginal || 0) + e.amountOriginal;
      }
      if (e.pctNewmen > 0 && existing.pctNewmen === 0) {
        existing.pctNewmen = e.pctNewmen;
        existing.pctVatebo = e.pctVatebo;
      }
    } else {
      map.set(key, { ...e });
    }
  }

  return Array.from(map.values());
}

async function main() {
  console.log("=== Payroll Full Import (2024 + 2025 + Jan 2026) ===\n");

  const allStaff = await db.select().from(staff);
  const staffByName = new Map<string, typeof allStaff[0]>();
  for (const s of allStaff) {
    staffByName.set(`${s.firstName} ${s.lastName}`, s);
  }
  console.log(`Loaded ${allStaff.length} staff members from DB.\n`);

  const wb = XLSX.readFile(FILE_PATH);

  let totalCreated = 0;
  let totalUnmatched = 0;
  const allUnmatched: string[] = [];

  for (const config of MONTHS) {
    console.log(`\n--- Processing: ${config.sheetName} (${config.year}/${config.month}) ---`);

    const ws = wb.Sheets[config.sheetName];
    if (!ws) {
      console.error(`  Sheet '${config.sheetName}' not found, skipping.`);
      continue;
    }

    const rates = await getRatesForDate(config.cbrDate);
    console.log(`  CBR rates for ${config.cbrDate}: EUR=${rates.EUR?.toFixed(2)}, USD=${rates.USD?.toFixed(2)}, KZT=${rates.KZT?.toFixed(4) || "N/A"}`);

    const rawEntries = parseSheet(ws, config, rates);
    console.log(`  Parsed ${rawEntries.length} raw entries.`);

    const entries = aggregateEntries(rawEntries);
    console.log(`  After aggregation: ${entries.length} entries.`);

    await db.delete(payrollEntries).where(
      and(eq(payrollEntries.year, config.year), eq(payrollEntries.month, config.month))
    );

    let created = 0;
    let unmatched = 0;

    for (const entry of entries) {
      const translitName = TRANSLITERATION[entry.nameKey];
      let staffMember: typeof allStaff[0] | undefined;

      if (translitName) {
        const [firstName, ...lastParts] = translitName.split(" ");
        const lastName = lastParts.join(" ");
        staffMember = staffByName.get(`${firstName} ${lastName}`);
      }

      if (!staffMember) {
        allUnmatched.push(`${config.sheetName}: ${entry.nameKey} (dept=${entry.departmentId}) = ${entry.amountTotal.toFixed(2)}`);
        unmatched++;
      }

      try {
        await db.insert(payrollEntries).values({
          year: config.year,
          month: config.month,
          staffId: staffMember?.id ?? null,
          departmentId: entry.departmentId,
          groupId: entry.groupId,
          direction: entry.direction,
          amountTotal: entry.amountTotal,
          amountNewmen: entry.amountNewmen,
          amountVatebo: entry.amountVatebo,
          pctNewmen: entry.pctNewmen,
          pctVatebo: entry.pctVatebo,
          currency: entry.currency,
          amountOriginal: entry.amountOriginal,
          staffName: entry.nameKey,
        });
        created++;
      } catch (e: any) {
        console.error(`  Insert failed: ${entry.nameKey}: ${e.message}`);
      }
    }

    const total = entries.reduce((s, e) => s + e.amountTotal, 0);
    console.log(`  Created: ${created} entries, Unmatched: ${unmatched}, Total RUB: ${total.toFixed(2)}`);
    totalCreated += created;
    totalUnmatched += unmatched;
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Total created: ${totalCreated}`);
  console.log(`Total unmatched: ${totalUnmatched}`);

  if (allUnmatched.length > 0) {
    console.log(`\nUnmatched staff:`);
    const unique = [...new Set(allUnmatched)];
    unique.forEach(n => console.log(`  - ${n}`));
  }

  console.log("\n=== Import Complete ===");
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
