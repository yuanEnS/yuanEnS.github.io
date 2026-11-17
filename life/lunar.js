// 农历（阴历）换算：用浏览器和 Worker 自带的中国历法（Intl 的 chinese 历，ICU 的数据），不用自己维护几百年的农历表。
// 纪念日、生日的页面（yuanens.com/life/lunar.js）和 Worker 的邮件提醒共用这一份：
// 改了要运行 node tools/copy-rules.js，把它复制到网站仓库。
//
// 日期都是 'YYYY-MM-DD' 字符串（阳历）。农历用 { year, month, day, leap }，month 1–12，leap 表示闰月。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Lunar = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const FORMAT = new Intl.DateTimeFormat('en-u-ca-chinese', { timeZone: 'UTC', year: 'numeric', month: 'numeric', day: 'numeric' });
  const DAY = 86400000;

  const dayNumber = iso => {
    const [y, m, d] = iso.split('-').map(Number);
    return Date.UTC(y, m - 1, d) / DAY;
  };
  const fromDayNumber = n => new Date(n * DAY).toISOString().slice(0, 10);
  const validIso = iso => typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(iso) && fromDayNumber(dayNumber(iso)) === iso;

  // 阳历 → 农历。闰月在 Intl 里写成「6bis」
  const cache = new Map();
  function toLunar(iso) {
    if (cache.has(iso)) return cache.get(iso);
    const parts = {};
    for (const part of FORMAT.formatToParts(new Date(`${iso}T00:00:00Z`))) parts[part.type] = part.value;
    const result = {
      year: Number(parts.relatedYear || parts.year),
      month: parseInt(parts.month, 10),
      day: Number(parts.day),
      leap: /bis/.test(parts.month),
    };
    if (cache.size > 5000) cache.clear();
    cache.set(iso, result);
    return result;
  }

  // 农历 → 阳历；这一天不存在（比如小月的三十、这一年没有这个闰月）返回 null。
  // 农历正月初一在阳历 1 月 21 日到 2 月 20 日之间，第 m 个月大约在那之后 29.5×(m-1) 天，闰月再往后一个月，在附近找
  function toSolar(year, month, day, leap = false) {
    if (!(month >= 1 && month <= 12 && day >= 1 && day <= 30)) return null;
    const guess = dayNumber(`${String(year).padStart(4, '0')}-01-20`) + Math.floor((month - 1) * 29.5) + day - 1;
    for (let i = -3; i <= 64; i++) {
      const iso = fromDayNumber(guess + i);
      const l = toLunar(iso);
      if (l.year === year && l.month === month && l.day === day && l.leap === !!leap) return iso;
      if (l.year > year) break;
    }
    return null;
  }

  const hasLeap = (year, month) => !!toSolar(year, month, 1, true);
  const monthLength = (year, month, leap = false) => (toSolar(year, month, 30, leap) ? 30 : 29);

  // 某个农历年里的这个农历日子：闰月出生的，那一年有这个闰月就过闰月，没有就过平常的那个月；
  // 三十出生的，遇到小月（只有二十九天）就过二十九
  function inLunarYear(year, month, day, leap) {
    const useLeap = leap && hasLeap(year, month);
    const d = Math.min(day, monthLength(year, month, useLeap));
    return toSolar(year, month, d, useLeap);
  }

  // 下一次（含今天）是哪一天。item：{ date, lunar }，lunar 为真时按 date 那天的农历日子算，否则按阳历的月、日算。
  // 返回 { date, years }，years 是第几个周年（生日就是几岁），date 当天和以前返回 years = 0
  function next(item, today) {
    const start = item.date;
    if (item.lunar) {
      const born = toLunar(start);
      const now = toLunar(today).year;
      for (let y = Math.max(born.year, now - 1); y <= now + 2; y++) {
        const date = inLunarYear(y, born.month, born.day, born.leap);
        if (date && date >= today && date >= start) return { date, years: y - born.year };
      }
      return null;
    }
    const [y0, m, d] = start.split('-').map(Number);
    // 2 月 29 日在平年算 3 月 1 日
    const at = y => fromDayNumber(Date.UTC(y, m - 1, d) / DAY);
    let y = Math.max(y0, Number(today.slice(0, 4)));
    if (at(y) < today) y++;
    return { date: at(y), years: y - y0 };
  }

  const MONTHS = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'];
  const TENS = ['初', '十', '廿', '三'];
  const DIGITS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  function dayName(day) {
    if (day === 10) return '初十';
    if (day === 20) return '二十';
    if (day === 30) return '三十';
    return TENS[Math.floor(day / 10)] + DIGITS[day % 10];
  }
  const monthName = (month, leap) => `${leap ? '闰' : ''}${MONTHS[month - 1]}月`;
  // 「八月十五」「闰四月初一」
  const name = ({ month, day, leap }) => `${monthName(month, leap)}${dayName(day)}`;

  const ANIMALS = '鼠牛虎兔龙蛇马羊猴鸡狗猪';
  const STEMS = '甲乙丙丁戊己庚辛壬癸';
  const BRANCHES = '子丑寅卯辰巳午未申酉戌亥';
  const zodiac = year => ANIMALS[((year - 4) % 12 + 12) % 12];
  const yearName = year => STEMS[((year - 4) % 10 + 10) % 10] + BRANCHES[((year - 4) % 12 + 12) % 12];

  return { toLunar, toSolar, hasLeap, monthLength, inLunarYear, next, name, monthName, dayName, zodiac, yearName, dayNumber, validIso };
});
