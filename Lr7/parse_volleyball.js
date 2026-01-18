const fs = require("fs");
const path = require("path");
const axios = require("axios");
const cheerio = require("cheerio");

async function fetchHtml(url) {
  const res = await axios.get(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
      Referer: "https://www.championat.com/",
    },
  });
  return res.data;
}

function normalizeText(s) {
  return s.replace(/\s+/g, " ").trim();
}

async function parseVolleyballStats(url) {
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  console.log("Поиск таблицы на странице...");

  // Поиск ВСЕХ таблиц на странице для анализа
  const allTables = $("table");
  console.log(`Найдено таблиц на странице: ${allTables.length}`);

  let bestTable = null;
  let bestTableRows = 0;
  let tableIndex = 0;

  // Перебираем все таблицы и ищем ту, которая содержит данные игроков
  allTables.each((i, table) => {
    const $table = $(table);
    const rows = $table.find("tr");
    const rowCount = rows.length;

    // Проверяем содержание первой строки (заголовки)
    const firstRow = rows.first();
    const headerCells = firstRow.find("th, td");
    const headerTexts = headerCells
      .map((j, cell) => normalizeText($(cell).text()))
      .get();

    // Ищем ключевые слова в заголовках
    const relevantHeaders = headerTexts.filter((text) =>
      [
        "игрок",
        "команда",
        "амплуа",
        "очки",
        "игры",
        "player",
        "team",
        "role",
        "points",
        "games",
      ].some((keyword) => text.toLowerCase().includes(keyword.toLowerCase()))
    );

    console.log(
      `Таблица ${i}: ${rowCount} строк, заголовки: [${headerTexts.join(
        ", "
      )}], релевантных: ${relevantHeaders.length}`
    );

    // Если нашли подходящую таблицу (с релевантными заголовками и достаточным количеством строк)
    if (relevantHeaders.length >= 2 && rowCount > 5) {
      if (rowCount > bestTableRows) {
        bestTableRows = rowCount;
        bestTable = $table;
        tableIndex = i;
      }
    }
  });

  if (!bestTable) {
    console.warn(
      "Таблица с ожидаемыми заголовками не найдена. Пробуем найти по структуре данных..."
    );

    // Альтернативный поиск: ищем таблицу, в которой есть данные об игроках и командах
    allTables.each((i, table) => {
      const $table = $(table);
      const rows = $table.find("tr");
      const rowCount = rows.length;

      // Проверяем, есть ли в таблице данные об игроках (обычно в первой колонке после заголовка)
      let playerCount = 0;
      rows.each((j, row) => {
        if (j > 0) {
          // Пропускаем заголовок
          const cells = $(row).find("td");
          if (cells.length >= 2) {
            // Проверяем, похоже ли содержимое на имя игрока (содержит пробел и буквы)
            const playerCell = cells.eq(1).text(); // Вторая колонка обычно содержит имя
            if (
              playerCell &&
              playerCell.trim().length > 3 &&
              playerCell.includes(" ")
            ) {
              playerCount++;
            }
          }
        }
      });

      if (playerCount > 10) {
        // Если нашли более 10 игроков
        bestTable = $table;
        tableIndex = i;
        console.log(`Найдена таблица с ${playerCount} игроками (индекс ${i})`);
        return false; // Прерываем цикл
      }
    });
  }

  if (!bestTable) {
    console.error("Не удалось найти таблицу со статистикой игроков.");
    return { headers: [], rows: [] };
  }

  console.log(
    `Используем таблицу с индексом ${tableIndex}, строк: ${
      bestTable.find("tr").length
    }`
  );

  // Извлекаем заголовки
  const headers = [];
  const firstRow = bestTable.find("tr").first();

  firstRow.find("th, td").each((i, cell) => {
    let headerText = normalizeText($(cell).text());

    // Убираем "Нет данных" из первого заголовка
    if (i === 0 && (headerText === "Нет данных" || headerText === "")) {
      headerText = "№";
    }

    headers.push(headerText || `column${i}`);
  });

  // Если не нашли заголовки в первой строке, создаем свои
  if (headers.length === 0 || headers.every((h) => !h)) {
    console.log("Заголовки не найдены, создаем стандартные...");
    // На основе структуры данных создаем заголовки
    const sampleRow = bestTable.find("tr").eq(1);
    const cellCount = sampleRow.find("td").length;
    for (let i = 0; i < cellCount; i++) {
      headers.push(`column${i}`);
    }
    // Заменяем первые заголовки на осмысленные, если знаем структуру
    if (cellCount >= 6) {
      headers[0] = "№";
      headers[1] = "Игрок";
      headers[2] = "Команда";
      headers[3] = "Амплуа";
      headers[4] = "Очки";
      headers[5] = "Игры";
    }
  }

  // Извлекаем данные
  const rows = [];
  bestTable.find("tr").each((ri, tr) => {
    // Пропускаем первую строку, если она содержит заголовки
    if (ri === 0 && $(tr).find("th").length > 0) return;

    const row = {};
    $(tr)
      .find("td")
      .each((ci, td) => {
        const header = headers[ci] || `col${ci}`;
        row[header] = normalizeText($(td).text());
      });

    // Добавляем строку только если в ней есть данные
    if (Object.keys(row).length > 0 && !Object.values(row).every((v) => !v)) {
      rows.push(row);
    }
  });

  console.log(`Извлечено ${rows.length} строк данных`);

  return { headers, rows };
}

function toCsv(headers, rows) {
  if (headers.length === 0 || rows.length === 0) {
    return "";
  }

  const hdr = headers.map((h) => `"${h.replace(/"/g, '""')}"`).join(",");
  const lines = [hdr];
  for (const r of rows) {
    const line = headers
      .map((h) => {
        const v = r[h] ?? "";
        return `"${String(v).replace(/"/g, '""')}"`;
      })
      .join(",");
    lines.push(line);
  }
  return lines.join("\n");
}

async function main(argv) {
  const args = require("minimist")(argv.slice(2));

  const defaultUrl =
    "https://www.championat.com/volleyball/_oth/tournament/6676/statistic/player/bombardir/";
  const url = args.url || defaultUrl;
  const out = args.out || "volleyball_player_stats";
  const noWrite = args["no-write"] || args["no_write"] || false;

  try {
    console.log("Загружаю данные с:", url);
    const { headers, rows } = await parseVolleyballStats(url);

    if (headers.length === 0 || rows.length === 0) {
      console.error("Не удалось найти таблицу с данными на странице");

      // Попробуем альтернативный подход - сохраним HTML для анализа
      if (!noWrite) {
        const html = await fetchHtml(url);
        const outputDir = path.resolve(__dirname);
        const htmlPath = path.join(outputDir, `${out}_page.html`);
        fs.writeFileSync(htmlPath, html, "utf8");
        console.log(`HTML страницы сохранен в: ${htmlPath} для анализа`);
      }

      return;
    }

    console.log(
      `Найдена таблица с ${headers.length} столбцами и ${rows.length} строками`
    );
    console.log("Заголовки:", headers);
    console.log("Первые 3 строки данных:");
    console.log(rows.slice(0, 3));

    const csv = toCsv(headers, rows);
    const json = JSON.stringify(rows, null, 2);

    const outputDir = path.resolve(__dirname);
    const csvPath = path.join(outputDir, `${out}.csv`);
    const jsonPath = path.join(outputDir, `${out}.json`);

    if (!noWrite) {
      fs.mkdirSync(outputDir, { recursive: true });
      fs.writeFileSync(csvPath, csv, "utf8");
      fs.writeFileSync(jsonPath, json, "utf8");
      console.log(`Файлы сохранены: ${csvPath} и ${jsonPath}`);
    } else {
      console.log("Режим без записи. Превью первых 5 строк:");
      console.log(JSON.stringify(rows.slice(0, 5), null, 2));
    }

    return { headers, rows };
  } catch (err) {
    console.error("Ошибка:", err.message);
    if (err.response) {
      console.error("Статус:", err.response.status);
      console.error("URL:", err.response.config.url);
    }
    throw err;
  }
}

if (require.main === module) {
  main(process.argv).catch(() => process.exit(1));
}
