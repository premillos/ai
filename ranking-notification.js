import { createHmac } from 'node:crypto';
import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const TREND_DATA_FILE = path.resolve(
  process.cwd(),
  'static',
  'data',
  'rank-trends.json',
);
const SITE_URL = 'https://premillos.github.io/ai/';
const shouldSend = process.argv.includes('--send');
const allowStale = process.argv.includes('--allow-stale');

/**
 * 获取上海时区的自然日期，避免 GitHub 运行器使用 UTC 导致日期误判。
 * @param {Date} date 日期对象
 * @returns {string} YYYY-MM-DD 日期
 */
function formatShanghaiDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

/**
 * 将排名格式化为最多一位小数。
 * @param {number|null} rank 排名
 * @returns {string} 排名文本
 */
function formatRank(rank) {
  if (rank === null) return '未入榜';
  return Number.isInteger(rank) ? String(rank) : rank.toFixed(1);
}

/**
 * 根据最新两个真实数据日计算网站排名变化。
 * @param {object} trend 全部关键词和国家的聚合趋势
 * @returns {object} 排名变化结果
 */
function calculateChanges(trend) {
  if (!Array.isArray(trend.dates) || trend.dates.length < 2) {
    throw new Error('至少需要两个真实数据日才能生成排名变化通知');
  }
  const [previousDate, latestDate] = trend.dates.slice(-2);
  const changes = trend.series.map((series) => {
    const ranksByDate = new Map(
      series.points.map((point) => [point.date, point.rank]),
    );
    const previousRank = ranksByDate.get(previousDate) ?? null;
    const latestRank = ranksByDate.get(latestDate) ?? null;
    let type = 'stable';
    let change = null;

    if (previousRank === null && latestRank !== null) {
      type = 'new';
    } else if (previousRank !== null && latestRank === null) {
      type = 'lost';
    } else if (previousRank === null && latestRank === null) {
      type = 'absent';
    } else {
      change = Math.round((previousRank - latestRank) * 10) / 10;
      if (change > 0) type = 'up';
      if (change < 0) type = 'down';
    }

    return {
      domain: series.domain,
      previousRank,
      latestRank,
      change,
      type,
    };
  });
  const sortByChange = (left, right) =>
    Math.abs(right.change ?? 0) - Math.abs(left.change ?? 0) ||
    left.domain.localeCompare(right.domain);

  return {
    previousDate,
    latestDate,
    up: changes.filter((item) => item.type === 'up').sort(sortByChange),
    down: changes.filter((item) => item.type === 'down').sort(sortByChange),
    stable: changes.filter((item) => item.type === 'stable'),
    newEntries: changes
      .filter((item) => item.type === 'new')
      .sort((left, right) => left.latestRank - right.latestRank),
    lost: changes
      .filter((item) => item.type === 'lost')
      .sort((left, right) => left.previousRank - right.previousRank),
    leaders: changes
      .filter((item) => item.latestRank !== null)
      .sort(
        (left, right) =>
          left.latestRank - right.latestRank ||
          left.domain.localeCompare(right.domain),
      )
      .slice(0, 5),
  };
}

/**
 * 将单个变化列表转换为钉钉兼容的 Markdown。
 * @param {object[]} items 变化数据
 * @param {'up'|'down'} direction 变化方向
 * @returns {string[]} Markdown 行
 */
function renderChangeList(items, direction) {
  if (items.length === 0) return ['- 暂无'];
  return items.slice(0, 5).map((item, index) => {
    const label = direction === 'up' ? '上升' : '下降';
    return `${index + 1}. **${item.domain}**：${formatRank(item.previousRank)} → ${formatRank(item.latestRank)}，${label} ${Math.abs(item.change)} 位`;
  });
}

/**
 * 生成每日排名变化 Markdown。
 * @param {object} changes 排名变化结果
 * @returns {string} Markdown 内容
 */
function renderMarkdown(changes) {
  const lines = [
    `# 📈 搜索排名每日变化 · ${changes.latestDate}`,
    '',
    `> 对比 ${changes.previousDate}，统计范围为全部关键词 / 全部国家。排名越小表现越好。`,
    '',
    '### 今日概览',
    '',
    `- ⬆️ 排名上升：**${changes.up.length}** 个`,
    `- ⬇️ 排名下降：**${changes.down.length}** 个`,
    `- ➖ 排名持平：**${changes.stable.length}** 个`,
    `- 🆕 新进入榜单：**${changes.newEntries.length}** 个`,
    `- ⚠️ 掉出榜单：**${changes.lost.length}** 个`,
    '',
    '### 上升幅度最大',
    '',
    ...renderChangeList(changes.up, 'up'),
    '',
    '### 下降幅度最大',
    '',
    ...renderChangeList(changes.down, 'down'),
    '',
    '### 新进入榜单',
    '',
    ...(changes.newEntries.length
      ? changes.newEntries.map(
          (item) => `- 🆕 **${item.domain}**：第 ${formatRank(item.latestRank)} 名`,
        )
      : ['- 暂无']),
    '',
    '### 掉出榜单',
    '',
    ...(changes.lost.length
      ? changes.lost.map(
          (item) => `- ⚠️ **${item.domain}**：前一日第 ${formatRank(item.previousRank)} 名`,
        )
      : ['- 暂无']),
    '',
    '### 当前排名领先网站',
    '',
    ...changes.leaders.map(
      (item, index) =>
        `${index + 1}. **${item.domain}**：第 ${formatRank(item.latestRank)} 名`,
    ),
    '',
    `[查看完整排名趋势](${SITE_URL})`,
    '',
    '---',
    '前端AI实验室 · pzl',
  ];
  return lines.join('\n');
}

/**
 * 将 Markdown 写入 GitHub Actions 任务摘要，方便手动预览。
 * @param {string} markdown Markdown 内容
 * @param {string} status 执行状态说明
 */
async function writeStepSummary(markdown, status) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  await appendFile(
    process.env.GITHUB_STEP_SUMMARY,
    `## ${status}\n\n${markdown}\n`,
    'utf8',
  );
}

/**
 * 使用加签后的钉钉机器人地址发送 Markdown 消息。
 * @param {string} title 消息标题
 * @param {string} markdown Markdown 内容
 */
async function sendDingTalk(title, markdown) {
  const webhook = process.env.DINGTALK_WEBHOOK;
  const secret = process.env.DINGTALK_SECRET;
  if (!webhook || !secret) {
    throw new Error('缺少 DINGTALK_WEBHOOK 或 DINGTALK_SECRET');
  }

  const timestamp = String(Date.now());
  const signature = createHmac('sha256', secret)
    .update(`${timestamp}\n${secret}`)
    .digest('base64');
  const requestUrl = new URL(webhook);
  requestUrl.searchParams.set('timestamp', timestamp);
  requestUrl.searchParams.set('sign', signature);

  const response = await fetch(requestUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      msgtype: 'markdown',
      markdown: { title, text: markdown },
      at: { isAtAll: false },
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    throw new Error(`钉钉通知请求失败：HTTP ${response.status}`);
  }
  const result = await response.json();
  if (result.errcode !== 0) {
    throw new Error(`钉钉通知发送失败：${result.errmsg || result.errcode}`);
  }
}

/**
 * 生成预览，或在当天数据完整时发送钉钉通知。
 */
async function main() {
  const data = JSON.parse(await readFile(TREND_DATA_FILE, 'utf8'));
  const trend = data.trends?.find((item) => item.key === 'all::all');
  if (!trend) throw new Error('趋势数据中缺少 all::all 聚合视图');

  const changes = calculateChanges(trend);
  const markdown = renderMarkdown(changes);
  const currentDate = formatShanghaiDate();
  const isCurrent = changes.latestDate === currentDate;

  console.log(markdown);
  if (!isCurrent && !allowStale) {
    const status = `跳过发送：最新数据日期 ${changes.latestDate}，当前日期 ${currentDate}`;
    console.log(`\n${status}`);
    await writeStepSummary(markdown, status);
    return;
  }

  if (!shouldSend) {
    await writeStepSummary(markdown, '排名通知预览（未发送）');
    console.log('\n预览生成完成，未发送钉钉通知');
    return;
  }

  await sendDingTalk(`排名变化日报 · ${changes.latestDate}`, markdown);
  await writeStepSummary(markdown, '钉钉排名通知已发送');
  console.log('\n钉钉排名通知发送成功');
}

main().catch((error) => {
  console.error(`排名通知执行失败：${error.message}`);
  process.exitCode = 1;
});
