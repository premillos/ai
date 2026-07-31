import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const RESULTS_DIRECTORY = path.resolve(process.cwd(), 'results');
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 计算稳定的文本哈希，用于生成可重复的排名波动。
 * @param {string} value 输入文本
 * @returns {number} 非负整数哈希
 */
function hashText(value) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * 将 UTC 日期格式化为 YYYY-MM-DD。
 * @param {Date} date 日期对象
 * @returns {string} 日期文本
 */
function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * 获取最新的结果日期目录。
 * @returns {Promise<string>} 最新日期
 */
async function findLatestResultDate() {
  const entries = await readdir(RESULTS_DIRECTORY, { withFileTypes: true });
  const dates = entries
    .filter((entry) => entry.isDirectory() && DATE_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left));

  if (dates.length === 0) {
    throw new Error('results 目录中没有可作为基准的日期数据');
  }

  return dates[0];
}

/**
 * 判断文件是否存在。
 * @param {string} filePath 文件路径
 * @returns {Promise<boolean>} 是否存在
 */
async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * 根据日期对自然搜索结果进行稳定的排名波动。
 * @param {object[]} organic 原始自然搜索结果
 * @param {number} dayIndex 当月日期序号
 * @param {string} conditionKey 搜索条件标识
 * @returns {object[]} 调整排名后的结果
 */
function simulateRanking(organic, dayIndex, conditionKey) {
  return organic
    .map((item, index) => {
      const identity = `${item.link ?? item.title ?? index}|${conditionKey}`;
      const hash = hashText(identity);
      const phase = (hash % 628) / 100;
      const amplitude = 1.2 + ((hash >>> 8) % 18) / 10;
      const dailyNoise =
        ((hashText(`${identity}|${dayIndex}`) % 1000) / 1000 - 0.5) * 1.4;
      const trend = (((hash >>> 16) % 9) - 4) * (dayIndex / 31) * 0.18;
      const score =
        Number(item.position ?? index + 1) +
        Math.sin(dayIndex * 0.52 + phase) * amplitude +
        dailyNoise +
        trend;

      return {
        item,
        score,
        stableOrder: hash,
      };
    })
    .sort(
      (left, right) =>
        left.score - right.score || left.stableOrder - right.stableOrder,
    )
    .map(({ item }, index) => ({
      ...item,
      position: index + 1,
    }));
}

/**
 * 基于源文件生成指定日期的模拟结果。
 * @param {object} sourceData 源搜索数据
 * @param {string} sourceFile 源文件相对路径
 * @param {Date} targetDate 目标日期
 * @param {number} dayIndex 当月日期序号
 * @returns {object} 模拟搜索数据
 */
function createSimulatedResult(sourceData, sourceFile, targetDate, dayIndex) {
  const condition = sourceData.searchCondition ?? {};
  const conditionKey = [
    condition.keyword,
    condition.country,
    condition.language,
  ].join('|');
  const searchedAt = new Date(sourceData.searchedAt ?? targetDate);
  searchedAt.setUTCFullYear(
    targetDate.getUTCFullYear(),
    targetDate.getUTCMonth(),
    targetDate.getUTCDate(),
  );

  return {
    ...sourceData,
    searchedAt: searchedAt.toISOString(),
    data: {
      ...sourceData.data,
      organic: simulateRanking(
        Array.isArray(sourceData.data?.organic) ? sourceData.data.organic : [],
        dayIndex,
        conditionKey,
      ),
    },
    simulation: {
      isSimulated: true,
      sourceFile,
      generatedAt: new Date().toISOString(),
      note: '基于现有搜索结果生成的排名趋势演示数据',
    },
  };
}

/**
 * 生成源日期所在自然月的模拟历史数据。
 */
async function main() {
  const sourceDate = await findLatestResultDate();
  const sourceDirectory = path.join(RESULTS_DIRECTORY, sourceDate);
  const sourceFiles = (await readdir(sourceDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort();

  if (sourceFiles.length === 0) {
    throw new Error(`基准目录没有 JSON 文件：${sourceDirectory}`);
  }

  const [year, month, sourceDay] = sourceDate.split('-').map(Number);
  let createdCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;

  for (let day = 1; day <= sourceDay; day += 1) {
    const targetDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    const targetDateText = formatDate(targetDate);

    if (targetDateText === sourceDate) {
      continue;
    }

    const targetDirectory = path.join(RESULTS_DIRECTORY, targetDateText);
    await mkdir(targetDirectory, { recursive: true });

    for (const fileName of sourceFiles) {
      const sourcePath = path.join(sourceDirectory, fileName);
      const targetPath = path.join(targetDirectory, fileName);
      const targetExists = await fileExists(targetPath);

      if (targetExists) {
        const existingData = JSON.parse(await readFile(targetPath, 'utf8'));
        if (existingData.simulation?.isSimulated !== true) {
          skippedCount += 1;
          continue;
        }
      }

      const sourceData = JSON.parse(await readFile(sourcePath, 'utf8'));
      const simulatedData = createSimulatedResult(
        sourceData,
        path.relative(process.cwd(), sourcePath),
        targetDate,
        day,
      );
      await writeFile(
        targetPath,
        `${JSON.stringify(simulatedData, null, 2)}\n`,
        'utf8',
      );

      if (targetExists) {
        updatedCount += 1;
      } else {
        createdCount += 1;
      }
    }
  }

  console.log(
    `模拟历史生成完成：新增 ${createdCount} 个，更新 ${updatedCount} 个，跳过真实文件 ${skippedCount} 个`,
  );
}

main().catch((error) => {
  console.error(`生成失败：${error.message}`);
  process.exitCode = 1;
});
