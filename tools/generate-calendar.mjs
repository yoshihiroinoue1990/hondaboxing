#!/usr/bin/env node
/**
 * 休館日カレンダー画像生成スクリプト
 *
 * 使い方:
 *   npx puppeteer browsers install chrome
 *   node tools/generate-calendar.mjs --year 2026 --month 5 --closed "8:第2木曜日定休日,22:第4木曜日定休日"
 *
 * オプション:
 *   --year    年（例: 2026）
 *   --month   月（例: 5）
 *   --closed  休館日をカンマ区切りで指定。「日:理由」の形式（例: "8:定休日,22:定休日"）
 *   --hours   短縮営業日をカンマ区切りで指定。「日:営業時間」の形式（例: "3:15〜18時"）
 *   --open    通常営業などの注記をカンマ区切りで指定。「日:注記」の形式（例: "24:通常営業"）
 *   --holidays 祝日の日付をカンマ区切りで指定（例: "21,22,23"）
 *   --out     出力先パス（省略時: img/kyukanbi_YYYYMM.png）
 */

import puppeteer from 'puppeteer';
import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// 引数パース
// ---------------------------------------------------------------------------
function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {};
  for (let i = 0; i < args.length; i += 2) {
    parsed[args[i].replace(/^--/, '')] = args[i + 1];
  }

  const now = new Date();
  const year  = parseInt(parsed.year  || now.getFullYear(), 10);
  const month = parseInt(parsed.month || now.getMonth() + 1, 10);

  const parseEntries = value => (value || '')
    .split(',')
    .filter(Boolean)
    .map(entry => {
      const separatorIndex = entry.indexOf(':');
      const day = separatorIndex === -1 ? entry : entry.slice(0, separatorIndex);
      const label = separatorIndex === -1 ? '' : entry.slice(separatorIndex + 1);
      return { day: parseInt(day, 10), label };
    });

  const closed = parseEntries(parsed.closed).map(({ day, label }) => ({ day, reason: label }));
  const hours = parseEntries(parsed.hours);
  const open = parseEntries(parsed.open);
  const holidays = (parsed.holidays || '')
    .split(',')
    .filter(Boolean)
    .map(day => parseInt(day, 10));

  const mm = String(month).padStart(2, '0');
  const out = parsed.out || resolve(projectRoot, `img/kyukanbi_${year}${mm}.png`);

  return { year, month, closed, hours, open, holidays, out };
}

// ---------------------------------------------------------------------------
// カレンダー HTML 生成
// ---------------------------------------------------------------------------
const MONTH_EN = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function buildCalendarHTML(year, month, closedDays, hourEntries, openEntries, holidays) {
  const closedSet = new Set(closedDays.map(d => d.day));
  const hourMap = new Map(hourEntries.map(entry => [entry.day, entry.label]));
  const openMap = new Map(openEntries.map(entry => [entry.day, entry.label]));
  const inferredHolidays = closedDays
    .filter(entry => entry.reason.includes('の日') || entry.reason.includes('休日') || entry.reason === '元日')
    .map(entry => entry.day);
  const holidaySet = new Set([...holidays, ...inferredHolidays]);

  const firstDay = new Date(year, month - 1, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month, 0).getDate();

  let rows = '';
  let col = 0;
  let row = '<tr>';

  for (let blank = 0; blank < firstDay; blank++) {
    row += '<td class="empty"></td>';
    col++;
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dow = (firstDay + d - 1) % 7; // 0=Sun 6=Sat
    const isClosed = closedSet.has(d);
    const isHoliday = holidaySet.has(d);
    const hourLabel = hourMap.get(d);
    const openLabel = openMap.get(d);
    const classes = [
      dow === 0 ? 'sun' : '',
      dow === 6 ? 'sat' : '',
      isClosed ? 'closed' : '',
      isHoliday ? 'holiday' : '',
      hourLabel ? 'short-hours' : '',
      openLabel ? 'special-open' : '',
    ].filter(Boolean).join(' ');

    const dayNote = isClosed
      ? '<span class="rest-mark">休</span>'
      : hourLabel
        ? `<span class="hours-mark">${hourLabel}</span>`
        : openLabel
          ? `<span class="open-mark">${openLabel}</span>`
          : '';

    row += `<td${classes ? ` class="${classes}"` : ''}>${d}${dayNote}</td>`;
    col++;

    if (col === 7) {
      row += '</tr>';
      rows += row;
      row = '<tr>';
      col = 0;
    }
  }

  if (col > 0) {
    while (col < 7) {
      row += '<td class="empty"></td>';
      col++;
    }
    row += '</tr>';
    rows += row;
  }

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: #0048b0;
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 100vh;
    font-family: "Helvetica Neue", "Hiragino Sans", "Hiragino Kaku Gothic ProN", Meiryo, sans-serif;
  }
  .calendar-wrapper { width: 780px; padding: 50px 40px 30px; }
  .calendar-card {
    background: #fff;
    border-radius: 16px;
    padding: 40px 36px 28px;
    box-shadow: 0 2px 12px rgba(0,0,0,0.06);
  }
  .calendar-title {
    text-align: center; margin-bottom: 4px;
    color: #0048b0; font-weight: 700; font-size: 16px; letter-spacing: 0.05em;
  }
  .calendar-title .month-num {
    font-size: 52px; font-weight: 800; color: #0048b0;
    vertical-align: middle; line-height: 1; margin: 0 2px;
  }
  .calendar-title .month-label { font-size: 22px; color: #0048b0; vertical-align: middle; }
  .calendar-title .year { font-size: 18px; color: #0048b0; vertical-align: middle; margin-right: 2px; }
  .calendar-subtitle {
    text-align: center; font-size: 14px; color: #666;
    margin-bottom: 20px; letter-spacing: 0.15em;
  }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  thead th { font-size: 15px; font-weight: 600; padding: 8px 0; letter-spacing: 0.1em; color: #444; }
  thead th.sun { color: #cc3333; }
  thead th.sat { color: #3366aa; }
  tbody td {
    height: 72px; text-align: center; vertical-align: top;
    padding-top: 14px; font-size: 22px; font-weight: 600;
    color: #333; border: 1px solid #e8e8e8; position: relative;
  }
  tbody td.sun { color: #cc3333; }
  tbody td.sat { color: #3366aa; }
  tbody td.holiday { color: #cc3333; }
  tbody td.closed { background: #fdf5e6; }
  tbody td.short-hours { background: #eef6ff; }
  tbody td.special-open { background: #eef9f0; }
  tbody td .rest-mark {
    display: block; font-size: 16px; font-weight: 700;
    color: #cc3333; margin-top: 2px; letter-spacing: 0.1em;
  }
  tbody td .hours-mark,
  tbody td .open-mark {
    display: block; font-size: 11px; font-weight: 700;
    margin-top: 5px; line-height: 1.15; white-space: nowrap;
  }
  tbody td .hours-mark { color: #1457a6; }
  tbody td .open-mark { color: #25833a; }
  .calendar-footer {
    text-align: right; margin-top: 10px;
    font-size: 13px; color: #777; padding-right: 4px;
  }
</style>
</head>
<body>
  <div class="calendar-wrapper">
    <div class="calendar-card">
      <div class="calendar-title">
        <span class="year">${year}</span>
        <span class="month-num">${month}</span>
        <span class="month-label">月 ${MONTH_EN[month]}</span>
      </div>
      <p class="calendar-subtitle">今月の営業日</p>
      <table>
        <thead>
          <tr>
            <th class="sun">日</th><th>月</th><th>火</th>
            <th>水</th><th>木</th><th>金</th><th class="sat">土</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="calendar-footer">「休」は休館 ／ 時刻は営業時間</div>
    </div>
  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// メイン
// ---------------------------------------------------------------------------
async function main() {
  const { year, month, closed, hours, open, holidays, out } = parseArgs();

  console.log(`📅 ${year}年${month}月のカレンダーを生成します`);
  console.log(`   休館日: ${closed.map(c => `${c.day}日(${c.reason})`).join(', ') || 'なし'}`);
  console.log(`   短縮営業: ${hours.map(entry => `${entry.day}日(${entry.label})`).join(', ') || 'なし'}`);
  console.log(`   営業注記: ${open.map(entry => `${entry.day}日(${entry.label})`).join(', ') || 'なし'}`);

  const html = buildCalendarHTML(year, month, closed, hours, open, holidays);

  const tmpHTML = resolve(projectRoot, `tools/.tmp_calendar_${year}${month}.html`);
  writeFileSync(tmpHTML, html);

  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.setViewport({ width: 1024, height: 800, deviceScaleFactor: 2 });
  await page.goto(`file://${tmpHTML}`);

  const card = await page.$('.calendar-wrapper');
  await card.screenshot({ path: out, type: 'png' });
  await browser.close();

  const { unlinkSync } = await import('fs');
  unlinkSync(tmpHTML);

  console.log(`✅ 保存しました: ${out}`);
}

main().catch(err => {
  console.error('エラー:', err);
  process.exit(1);
});
