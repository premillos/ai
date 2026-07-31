import {
  mkdir,
  readFile,
  readdir,
  rename,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const RESULTS_DIRECTORY = path.resolve(process.cwd(), 'results');
const ARCHIVE_DIRECTORY = path.resolve(process.cwd(), 'results_archive');
const CONFIG_FILE = path.resolve(process.cwd(), 'search-config.json');
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 计算稳定的文本哈希，用于生成可复现的模板选择和排名变化。
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
 * 将文本转换为安全的结果文件名。
 * @param {string} value 原始文本
 * @returns {string} 文件名片段
 */
function sanitizeFileName(value) {
  const sanitized = value
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[._]+|[._]+$/g, '')
    .slice(0, 80);

  return sanitized || 'search';
}

/**
 * 获取 results 中最新的日期目录。
 * @returns {Promise<string>} 最新日期
 */
async function findLatestResultDate() {
  const entries = await readdir(RESULTS_DIRECTORY, { withFileTypes: true });
  const dates = entries
    .filter((entry) => entry.isDirectory() && DATE_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left));

  if (dates.length === 0) {
    throw new Error('results 目录中没有可作为模板的日期数据');
  }

  return dates[0];
}

/**
 * 读取最新日期中的聊天和视频聊天模板。
 * @param {string} sourceDate 模板日期
 * @returns {Promise<object>} 模板集合
 */
async function loadTemplates(sourceDate) {
  const sourceDirectory = path.join(RESULTS_DIRECTORY, sourceDate);
  const fileNames = (await readdir(sourceDirectory))
    .filter((name) => name.endsWith('.json'))
    .sort();
  const records = [];

  for (const fileName of fileNames) {
    const data = JSON.parse(
      await readFile(path.join(sourceDirectory, fileName), 'utf8'),
    );
    if (Array.isArray(data.data?.organic) && data.data.organic.length > 0) {
      records.push({ fileName, data });
    }
  }

  if (records.length === 0) {
    throw new Error(`模板目录中没有有效搜索结果：${sourceDirectory}`);
  }

  const englishRecords = records.filter(
    (record) => record.data.searchCondition?.language === 'en',
  );
  const candidates = englishRecords.length > 0 ? englishRecords : records;
  const videoTemplate =
    candidates.find((record) =>
      String(record.data.searchCondition?.keyword)
        .toLowerCase()
        .includes('video'),
    ) ?? candidates[0];
  const chatTemplate =
    candidates.find(
      (record) =>
        !String(record.data.searchCondition?.keyword)
          .toLowerCase()
          .includes('video'),
    ) ?? candidates[0];

  return { videoTemplate, chatTemplate };
}

/**
 * 根据目标关键词选择更接近的源模板。
 * @param {string} keyword 目标关键词
 * @param {object} templates 模板集合
 * @returns {object} 选中的模板
 */
function selectTemplate(keyword, templates) {
  return keyword.toLowerCase().includes('video')
    ? templates.videoTemplate
    : templates.chatTemplate;
}

/**
 * 为指定条件和日期生成稳定的排名变化。
 * @param {object[]} organic 模板自然搜索结果
 * @param {string} conditionKey 搜索条件标识
 * @param {number} absoluteDay 三个月内的日期序号
 * @returns {object[]} 调整排名后的结果
 */
function simulateRanking(organic, conditionKey, absoluteDay) {
  return organic
    .map((item, index) => {
      const identity = `${item.link ?? item.title ?? index}|${conditionKey}`;
      const hash = hashText(identity);
      const phase = (hash % 628) / 100;
      const amplitude = 1.1 + ((hash >>> 8) % 22) / 10;
      const dailyNoise =
        ((hashText(`${identity}|${absoluteDay}`) % 1000) / 1000 - 0.5) * 1.2;
      const longTrend =
        (((hash >>> 16) % 11) - 5) * (absoluteDay / 92) * 0.32;
      const weeklyWave = Math.sin(absoluteDay * 0.48 + phase) * amplitude;
      const score =
        Number(item.position ?? index + 1) +
        weeklyWave +
        dailyNoise +
        longTrend;

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
 * 创建单个搜索条件的模拟结果。
 * @param {object} templateRecord 模板记录
 * @param {string} keyword 关键词
 * @param {object} country 国家配置
 * @param {object} config 搜索配置
 * @param {Date} targetDate 目标日期
 * @param {number} absoluteDay 三个月内的日期序号
 * @param {string} sourceDate 模板日期
 * @returns {object} 模拟结果
 */
function createSimulatedResult(
  templateRecord,
  keyword,
  country,
  config,
  targetDate,
  absoluteDay,
  sourceDate,
) {
  const template = templateRecord.data;
  const conditionKey = `${keyword}|${country.code}|${country.language}`;
  const searchedAt = new Date(template.searchedAt ?? targetDate);
  searchedAt.setUTCFullYear(
    targetDate.getUTCFullYear(),
    targetDate.getUTCMonth(),
    targetDate.getUTCDate(),
  );
  // 兼容旧模板，但不把已经移除的 num 参数写入新模拟文件。
  const templateSearchParameters = {
    ...(template.data?.searchParameters ?? {}),
  };
  delete templateSearchParameters.num;

  return {
    ...template,
    searchCondition: {
      keyword,
      country: country.code,
      language: country.language,
      page: config.page,
    },
    searchedAt: searchedAt.toISOString(),
    data: {
      ...template.data,
      searchParameters: {
        ...templateSearchParameters,
        q: keyword,
        gl: country.code,
        hl: country.language,
        page: config.page,
      },
      organic: simulateRanking(
        template.data.organic,
        conditionKey,
        absoluteDay,
      ),
      credits: 0,
    },
    simulation: {
      isSimulated: true,
      sourceDate,
      sourceFile: templateRecord.fileName,
      generatedAt: new Date().toISOString(),
      note: '基于现有结果模板和当前关键词配置生成的三个月排名趋势演示数据',
    },
  };
}

/**
 * 生成不冲突的归档目录名称。
 * @param {string} sourceDate 源数据最新日期
 * @returns {string} 归档目录
 */
function createArchivePath(sourceDate) {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
  return path.join(ARCHIVE_DIRECTORY, `results-${sourceDate}-${timestamp}`);
}

/**
 * 按当前配置生成截至源日期的三个完整自然月数据。
 */
async function main() {
  const config = JSON.parse(await readFile(CONFIG_FILE, 'utf8'));
  if (!Array.isArray(config.keywords) || config.keywords.length === 0) {
    throw new Error('search-config.json 缺少关键词配置');
  }
  if (!Array.isArray(config.countries) || config.countries.length === 0) {
    throw new Error('search-config.json 缺少国家配置');
  }

  const sourceDate = await findLatestResultDate();
  const templates = await loadTemplates(sourceDate);
  const archivePath = createArchivePath(sourceDate);

  await mkdir(ARCHIVE_DIRECTORY, { recursive: true });
  await rename(RESULTS_DIRECTORY, archivePath);
  await mkdir(RESULTS_DIRECTORY, { recursive: true });

  const [year, month, day] = sourceDate.split('-').map(Number);
  const startDate = new Date(Date.UTC(year, month - 3, 1, 12, 0, 0));
  const endDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  let dateCount = 0;
  let fileCount = 0;

  for (
    let cursor = new Date(startDate);
    cursor <= endDate;
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  ) {
    const targetDate = new Date(cursor);
    const dateText = formatDate(targetDate);
    const targetDirectory = path.join(RESULTS_DIRECTORY, dateText);
    await mkdir(targetDirectory, { recursive: true });
    const writes = [];

    for (const keyword of config.keywords) {
      for (const country of config.countries) {
        const template = selectTemplate(keyword, templates);
        const result = createSimulatedResult(
          template,
          keyword,
          country,
          config,
          targetDate,
          dateCount + 1,
          sourceDate,
        );
        const fileName = [
          sanitizeFileName(keyword),
          `country-${sanitizeFileName(country.code)}`,
          `language-${sanitizeFileName(country.language)}`,
          `page-${config.page}`,
        ].join('__');
        const outputPath = path.join(targetDirectory, `${fileName}.json`);

        writes.push(
          writeFile(
            outputPath,
            `${JSON.stringify(result, null, 2)}\n`,
            'utf8',
          ),
        );
      }
    }

    await Promise.all(writes);
    dateCount += 1;
    fileCount += writes.length;
  }

  console.log(
    `三个月数据生成完成：${dateCount} 天，${fileCount} 个文件；原数据已归档到 ${archivePath}`,
  );
}

main().catch((error) => {
  console.error(`生成失败：${error.message}`);
  process.exitCode = 1;
});
