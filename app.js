// app.js — логика конвертера

const CBR_URL = "https://www.cbr-xml-daily.ru/daily_json.js";
const OPEN_ER_URL = "https://open.er-api.com/v6/latest/";
const FALLBACK_URL =
  "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/";

const CACHE_KEY = "cash_cache_v1";
const PUB_HOUR_MSK = 15;

const output = document.getElementById("output");
const input = document.getElementById("input");
const sendBtn = document.getElementById("send");

// ---------- Вывод в интерфейс ----------

function print(text, cls = "msg-info") {
  if (!text) return;
  const line = document.createElement("div");
  line.className = `msg ${cls}`;
  line.textContent = text;
  output.appendChild(line);
  output.scrollTop = output.scrollHeight;
}

function printHelp() {
  const box = document.createElement("div");
  box.className = "help-card";
  box.innerHTML = `
    <h3>📖 Справка</h3>
    <p><b>Форматы ввода:</b><br>
    <code>100 USD to RUB</code><br>
    <code>RUB to USD 5000</code></p>
    <p><b>Встроенные команды:</b><br>
    <code>help</code> — эта справка<br>
    <code>codes</code> — список доступных валют<br>
    <code>clear</code> — очистить экран</p>
    <p style="color: var(--text-muted); font-size: 0.85rem; margin-top: 12px;">
      Валюты — коды ISO 4217 (USD, EUR, RUB и т.д.). Регистр не важен.<br>
      Дробные суммы: 100.50 или 100,50.<br><br>
      <b>Источники курсов:</b> 1. ЦБ РФ (основной, кэш до 15:00 МСК).<br>
      2. open.er-api.com, 3. currency-api (резервные).
    </p>
  `;
  output.appendChild(box);
  output.scrollTop = output.scrollHeight;
}

// ---------- Время ЦБ ----------

function lastPublicationTs() {
  const now = new Date();
  const nowMsk = new Date(now.getTime() + 3 * 3600 * 1000);
  let candidate = new Date(
    Date.UTC(
      nowMsk.getUTCFullYear(),
      nowMsk.getUTCMonth(),
      nowMsk.getUTCDate(),
      PUB_HOUR_MSK,
      0,
      0,
    ),
  );
  if (nowMsk < candidate) {
    candidate = new Date(candidate.getTime() - 24 * 3600 * 1000);
  }
  return candidate.getTime() - 3 * 3600 * 1000;
}

// ---------- Кэш ----------

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveCache(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch (e) {
    print(`Предупреждение: не удалось сохранить кэш: ${e.message}`, "msg-warn");
  }
}

// ---------- HTTP ----------

async function getJson(url) {
  const res = await fetch(url, { mode: "cors", cache: "no-store" });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `HTTP ${res.status} ${res.statusText} для ${url}. ${body.slice(0, 200)}`,
    );
  }
  return res.json();
}

// ---------- Источники ----------

async function fetchCbrData() {
  const data = await getJson(CBR_URL);
  if (!data.Valute || typeof data.Valute !== "object") {
    throw new Error(`В ответе ЦБ нет поля Valute.`);
  }
  const rates = { RUB: 1.0 };
  const names = { RUB: "Российский рубль" };
  for (const [code, info] of Object.entries(data.Valute)) {
    if (!info || typeof info !== "object") continue;
    const value = info.Value;
    const nominal = info.Nominal ?? 1;
    if (value == null || !nominal) continue;
    const c = code.toUpperCase();
    rates[c] = Number(value) / Number(nominal);
    if (info.Name) names[c] = String(info.Name).trim();
  }
  return { rates, names };
}

async function fetchOpenErRate(from, to) {
  if (from === to) return 1.0;
  const data = await getJson(OPEN_ER_URL + from);
  if (data.result !== "success") throw new Error("API вернул ошибку");
  if (!data.rates || data.rates[to] == null)
    throw new Error(`Нет валюты ${to}`);
  return Number(data.rates[to]);
}

async function fetchFallbackRate(from, to) {
  if (from === to) return 1.0;
  const base = from.toLowerCase();
  const data = await getJson(FALLBACK_URL + base + ".json");
  const block = data[base];
  if (!block || block[to.toLowerCase()] == null)
    throw new Error(`Нет валюты ${to}`);
  return Number(block[to.toLowerCase()]);
}

// ---------- Данные ЦБ с кэшем ----------

async function getCbrData(requireNames = false) {
  const cache = loadCache();
  const pubTs = lastPublicationTs();
  if (cache && cache.timestamp >= pubTs) {
    const ratesOk = cache.rates && cache.rates.RUB != null;
    const namesOk =
      !requireNames || (cache.names && Object.keys(cache.names).length > 0);
    if (ratesOk && namesOk)
      return { rates: cache.rates, names: cache.names || {} };
  }
  const { rates, names } = await fetchCbrData();
  saveCache({ timestamp: Date.now(), rates, names });
  return { rates, names };
}

// ---------- Конвертация ----------

async function convert(amount, from, to) {
  if (from === to) return amount;

  try {
    const { rates } = await getCbrData(false);
    if (rates[from] == null)
      throw new Error(`Валюта ${from} отсутствует в ЦБ РФ.`);
    if (rates[to] == null) throw new Error(`Валюта ${to} отсутствует в ЦБ РФ.`);
    return (amount * rates[from]) / rates[to];
  } catch (e) {
    print(`ЦБ РФ недоступен (${e.message}), пробую fallback...`, "msg-warn");
  }

  try {
    const rate = await fetchOpenErRate(from, to);
    print(
      "Использован fallback open.er-api.com (курс может отличаться от ЦБ РФ).",
      "msg-warn",
    );
    return amount * rate;
  } catch (e) {
    print(`open.er-api.com не сработал, пробую второй fallback...`, "msg-warn");
  }

  try {
    const rate = await fetchFallbackRate(from, to);
    print(
      "Использован fallback currency-api (курс может отличаться от ЦБ РФ).",
      "msg-warn",
    );
    return amount * rate;
  } catch (e) {
    throw new Error(`Не удалось получить курс ни из одного источника.`);
  }
}

// ---------- Список кодов ----------

async function printCodes() {
  try {
    const { rates, names } = await getCbrData(true);
    const all = Array.from(
      new Set([...Object.keys(rates), ...Object.keys(names)]),
    ).sort();

    // Создаем контейнер для списка
    const div = document.createElement("div");
    div.className = "msg msg-result";
    div.style.fontFamily = "monospace";
    div.style.whiteSpace = "pre";

    let text = `Доступные валюты (${all.length}):\n\n`;
    for (const code of all) {
      text += `${code}  ${names[code] || "—"}\n`;
    }
    div.textContent = text;
    output.appendChild(div);
    output.scrollTop = output.scrollHeight;
  } catch (e) {
    print(
      `Ошибка: не удалось получить список валют: ${e.message}`,
      "msg-error",
    );
  }
}

// ---------- Парсинг ----------

function parseConversion(text) {
  text = text.trim();
  let m = text.match(/^([\d.,]+)\s+([A-Za-z]{3})\s+to\s+([A-Za-z]{3})$/i);
  if (m) {
    const amount = parseFloat(m[1].replace(",", "."));
    if (!(amount > 0)) throw new Error("Сумма должна быть положительной.");
    return { amount, from: m[2].toUpperCase(), to: m[3].toUpperCase() };
  }
  m = text.match(/^([A-Za-z]{3})\s+to\s+([A-Za-z]{3})\s+([\d.,]+)$/i);
  if (m) {
    const amount = parseFloat(m[3].replace(",", "."));
    if (!(amount > 0)) throw new Error("Сумма должна быть положительной.");
    return { amount, from: m[1].toUpperCase(), to: m[2].toUpperCase() };
  }
  throw new Error("Неверный формат. Попробуйте '100 USD to RUB'.");
}

// ---------- Обработка ввода ----------

async function handleLine(line) {
  line = line.trim();
  if (!line) return;
  const cmd = line.toLowerCase();

  if (cmd === "help") {
    printHelp();
    return;
  }
  if (cmd === "codes") {
    await printCodes();
    return;
  }
  if (cmd === "clear") {
    output.innerHTML = "";
    return;
  }

  try {
    const { amount, from, to } = parseConversion(line);
    const result = await convert(amount, from, to);
    print(
      `${amount.toFixed(2)} ${from} = ${result.toFixed(2)} ${to}`,
      "msg-result",
    );
  } catch (e) {
    print(`Ошибка: ${e.message}`, "msg-error");
  }
}

// ---------- Инициализация ----------

sendBtn.addEventListener("click", async () => {
  const text = input.value;
  input.value = "";
  await handleLine(text);
});

input.addEventListener("keydown", async (e) => {
  if (e.key === "Enter") {
    const text = input.value;
    input.value = "";
    await handleLine(text);
  }
});

// Приветствие
printHelp();
input.focus();

// Регистрация Service Worker
if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("./sw.js")
    .then((reg) => console.log("SW registered:", reg.scope))
    .catch((err) => console.log("SW failed:", err));
}
