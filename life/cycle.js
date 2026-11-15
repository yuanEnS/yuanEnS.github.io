// 经期记录：从每天的记录算出每次月经、平均周期，预测下一次和排卵期。
// 网页（gamesyuan.com/life/cycle.js）和 Worker 的邮件提醒共用这一份：改了要运行 node tools/copy-rules.js。
//
// 记录是 [{ date: 'YYYY-MM-DD', flow: 0–3, symptoms: ['cramps', …], note }]，flow 0 没来、1 少、2 中、3 多。
// 预测用的是最常见的日历法：最近几次的平均周期往后推；排卵日按下次月经前 14 天估。
// 这只是估算，周期不规律的人误差会很大，不能用来避孕，也不能代替看医生。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Cycle = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const DAY = 86400000;
  const RECENT = 6; // 用最近几次算平均
  const DEFAULT_CYCLE = 28;
  const DEFAULT_PERIOD = 5;
  const MIN_CYCLE = 15; // 比这短、比这长的间隔多半是漏记了，不算进平均
  const MAX_CYCLE = 60;
  const LUTEAL = 14; // 排卵日大约在下次月经前 14 天

  const dayNumber = iso => {
    const [y, m, d] = iso.split('-').map(Number);
    return Date.UTC(y, m - 1, d) / DAY;
  };
  const fromDayNumber = n => new Date(n * DAY).toISOString().slice(0, 10);
  const addDays = (iso, n) => fromDayNumber(dayNumber(iso) + n);

  const SYMPTOMS = {
    cramps: '痛经', backache: '腰酸', headache: '头痛', breasts: '胸胀', bloating: '腹胀', acne: '长痘',
    tired: '疲惫', insomnia: '失眠', low: '情绪低落', irritable: '烦躁', appetite: '食欲大', discharge: '分泌物多',
  };
  const FLOWS = ['没来', '少', '中', '多'];

  // 有流量的日子连起来就是一次月经；中间空一天（忘了记）也算同一次
  function periods(days) {
    const flowDays = days.filter(d => d.flow > 0).map(d => d.date).sort();
    const out = [];
    for (const date of flowDays) {
      const last = out[out.length - 1];
      if (last && dayNumber(date) - dayNumber(last.end) <= 2) last.end = date;
      else out.push({ start: date, end: date });
    }
    out.forEach(p => { p.length = dayNumber(p.end) - dayNumber(p.start) + 1; });
    return out;
  }

  const mean = list => list.reduce((a, b) => a + b, 0) / list.length;

  // 平均周期（这次开始到下次开始）、平均经期天数，和每一次的周期长短
  function stats(list) {
    const cycles = [];
    for (let i = 1; i < list.length; i++) {
      const gap = dayNumber(list[i].start) - dayNumber(list[i - 1].start);
      cycles.push({ start: list[i - 1].start, length: gap, counted: gap >= MIN_CYCLE && gap <= MAX_CYCLE });
    }
    const counted = cycles.filter(c => c.counted).slice(-RECENT).map(c => c.length);
    // 最后一次可能还没结束，平均经期不算它
    const lengths = list.slice(-RECENT - 1, -1).map(p => p.length);
    const cycle = counted.length ? Math.round(mean(counted)) : DEFAULT_CYCLE;
    const period = lengths.length ? Math.round(mean(lengths)) : (list.length ? Math.max(list[list.length - 1].length, 3) : DEFAULT_PERIOD);
    // 规律程度：最近几次周期最长和最短差几天
    const spread = counted.length >= 2 ? Math.max(...counted) - Math.min(...counted) : null;
    return { cycle, period, cycles, counted: counted.length, spread, guessed: !counted.length };
  }

  // 预测。today 之前还没来的，算「推迟了几天」；future 是往后几次的预计经期，日历上用
  function predict(days, today, future = 3) {
    const list = periods(days);
    if (!list.length) return null;
    const s = stats(list);
    const last = list[list.length - 1];
    let next = addDays(last.start, s.cycle);
    const inPeriod = dayNumber(today) >= dayNumber(last.start) && dayNumber(today) <= dayNumber(last.end) + 1
      && dayNumber(today) - dayNumber(last.start) < Math.max(s.period + 3, 8);
    const late = !inPeriod && today > next ? dayNumber(today) - dayNumber(next) : 0;
    const upcoming = [];
    for (let i = 0; i < future; i++) {
      const start = addDays(next, i * s.cycle);
      const ovulation = addDays(start, -LUTEAL);
      upcoming.push({
        start, end: addDays(start, s.period - 1), ovulation,
        fertileStart: addDays(ovulation, -5), fertileEnd: addDays(ovulation, 1),
      });
    }
    return {
      ...s, periods: list, last, next, inPeriod, late, upcoming,
      dayOfPeriod: inPeriod ? dayNumber(today) - dayNumber(last.start) + 1 : 0,
      daysToNext: dayNumber(next) - dayNumber(today),
      dayOfCycle: dayNumber(today) - dayNumber(last.start) + 1,
    };
  }

  // 日历上的某一天是什么：period 记了来了、predicted 预计经期、fertile 易孕期、ovulation 排卵日（都是估的）
  function dayKind(prediction, iso) {
    if (!prediction) return '';
    for (const u of prediction.upcoming) {
      if (iso >= u.start && iso <= u.end) return 'predicted';
      if (iso === u.ovulation) return 'ovulation';
      if (iso >= u.fertileStart && iso <= u.fertileEnd) return 'fertile';
    }
    return '';
  }

  return { periods, stats, predict, dayKind, dayNumber, addDays, SYMPTOMS, FLOWS, DEFAULT_CYCLE, DEFAULT_PERIOD };
});
