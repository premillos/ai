/**
 * 根据指定数据日及其前一个数据日计算网站排名变化。
 * @param {object} trend 全部关键词和国家的聚合趋势
 * @param {string} [targetDate] 指定数据日，默认使用最新数据日
 * @returns {object} 排名变化结果
 */
export function calculateRankingChanges(trend, targetDate) {
  if (!Array.isArray(trend.dates) || trend.dates.length < 2) {
    throw new Error('至少需要两个真实数据日才能计算排名变化');
  }

  const latestIndex = targetDate
    ? trend.dates.indexOf(targetDate)
    : trend.dates.length - 1;
  if (latestIndex < 1) {
    throw new Error(`数据日缺少可对比的前一日：${targetDate ?? '最新数据日'}`);
  }

  const previousDate = trend.dates[latestIndex - 1];
  const latestDate = trend.dates[latestIndex];
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
