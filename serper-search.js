import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const SERPER_SEARCH_URL = 'https://google.serper.dev/search';

/**
 * 加载项目根目录中的本地环境变量文件。
 * 已由系统设置的环境变量不会被文件中的值覆盖。
 * @param {string} envPath 环境变量文件绝对路径
 * @returns {Promise<void>}
 */
async function loadLocalEnv(envPath) {
  let content;

  try {
    content = await readFile(envPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return;
    }
    throw new Error(`无法读取环境变量文件：${envPath}，${error.message}`);
  }

  for (const line of content.split(/\r?\n/)) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmedLine.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmedLine.slice(0, separatorIndex).trim();
    let value = trimmedLine.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

/**
 * 读取并解析搜索配置。
 * @param {string} configPath 配置文件绝对路径
 * @returns {Promise<object>} 搜索配置
 */
async function loadConfig(configPath) {
  let content;

  try {
    content = await readFile(configPath, 'utf8');
  } catch (error) {
    throw new Error(`无法读取配置文件：${configPath}，${error.message}`);
  }

  try {
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`配置文件不是有效的 JSON：${error.message}`);
  }
}

/**
 * 检查配置并补充默认值。
 * @param {object} config 原始配置
 * @returns {object} 标准化后的配置
 */
function normalizeConfig(config) {
  if (!Array.isArray(config.keywords) || config.keywords.length === 0) {
    throw new Error('配置项 keywords 必须是非空数组');
  }

  if (!Array.isArray(config.countries) || config.countries.length === 0) {
    throw new Error('配置项 countries 必须是非空数组');
  }

  const keywords = config.keywords.map((keyword) => {
    if (typeof keyword !== 'string' || keyword.trim() === '') {
      throw new Error('keywords 中的每一项都必须是非空字符串');
    }
    return keyword.trim();
  });

  const countries = config.countries.map((country) => {
    if (!country || typeof country.code !== 'string' || country.code.trim() === '') {
      throw new Error('countries 中的每一项都必须包含非空的 code');
    }

    return {
      code: country.code.trim().toLowerCase(),
      language:
        typeof country.language === 'string' && country.language.trim()
          ? country.language.trim().toLowerCase()
          : undefined,
    };
  });

  const page = Number(config.page ?? 1);
  const requestIntervalMs = Number(config.requestIntervalMs ?? 500);
  const timeoutMs = Number(config.timeoutMs ?? 30000);

  if (!Number.isInteger(page) || page < 1) {
    throw new Error('page 必须是大于或等于 1 的整数');
  }
  if (!Number.isFinite(requestIntervalMs) || requestIntervalMs < 0) {
    throw new Error('requestIntervalMs 必须是大于或等于 0 的数字');
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('timeoutMs 必须是大于 0 的数字');
  }

  return {
    keywords,
    countries,
    page,
    outputDirectory:
      typeof config.outputDirectory === 'string' && config.outputDirectory.trim()
        ? config.outputDirectory.trim()
        : 'results',
    requestIntervalMs,
    timeoutMs,
  };
}

/**
 * 将日期格式化为本地 YYYY-MM-DD。
 * @param {Date} date 日期对象
 * @returns {string} 日期文本
 */
function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 将搜索条件转换为安全的文件名片段。
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
 * 等待指定时间，用于控制请求频率。
 * @param {number} milliseconds 等待毫秒数
 * @returns {Promise<void>}
 */
function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * 调用 Serper 搜索接口。
 * @param {object} condition 搜索条件
 * @param {string} apiKey Serper API Key
 * @param {number} timeoutMs 超时时间
 * @returns {Promise<object>} Serper 原始响应
 */
async function searchSerper(condition, apiKey, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const requestBody = {
    q: condition.keyword,
    gl: condition.country,
    page: condition.page,
  };

  if (condition.language) {
    requestBody.hl = condition.language;
  }

  try {
    const response = await fetch(SERPER_SEARCH_URL, {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    const responseText = await response.text();
    let responseData;

    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = { rawResponse: responseText };
    }

    if (!response.ok) {
      throw new Error(
        `Serper 请求失败（HTTP ${response.status}）：${JSON.stringify(responseData)}`,
      );
    }

    return responseData;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`Serper 请求超过 ${timeoutMs} 毫秒未完成`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * 保存单个搜索条件的结果。
 * @param {string} outputDirectory 输出根目录
 * @param {object} condition 搜索条件
 * @param {object} data 搜索结果
 * @returns {Promise<string>} 保存后的文件绝对路径
 */
async function saveResult(outputDirectory, condition, data) {
  const searchedAt = new Date();
  const dateDirectory = path.join(outputDirectory, formatLocalDate(searchedAt));
  const language = condition.language || 'default';
  const fileName = [
    sanitizeFileName(condition.keyword),
    `country-${sanitizeFileName(condition.country)}`,
    `language-${sanitizeFileName(language)}`,
    `page-${condition.page}`,
  ].join('__');
  const outputPath = path.join(dateDirectory, `${fileName}.json`);

  await mkdir(dateDirectory, { recursive: true });
  await writeFile(
    outputPath,
    `${JSON.stringify(
      {
        searchCondition: condition,
        searchedAt: searchedAt.toISOString(),
        data,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  return outputPath;
}

/**
 * 执行全部关键词和国家的组合搜索。
 */
async function main() {
  await loadLocalEnv(path.resolve(process.cwd(), '.env'));

  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    throw new Error('缺少环境变量 SERPER_API_KEY，请先设置 Serper API Key');
  }

  const configArgument = process.argv[2] || 'search-config.json';
  const configPath = path.resolve(process.cwd(), configArgument);
  const config = normalizeConfig(await loadConfig(configPath));
  const outputDirectory = path.resolve(
    path.dirname(configPath),
    config.outputDirectory,
  );
  const conditions = config.keywords.flatMap((keyword) =>
    config.countries.map((country) => ({
      keyword,
      country: country.code,
      language: country.language,
      page: config.page,
    })),
  );

  console.log(`准备执行 ${conditions.length} 个搜索任务`);

  for (const [index, condition] of conditions.entries()) {
    console.log(
      `[${index + 1}/${conditions.length}] 搜索：${condition.keyword}，国家：${condition.country}`,
    );

    const result = await searchSerper(condition, apiKey, config.timeoutMs);
    const outputPath = await saveResult(outputDirectory, condition, result);
    console.log(`已保存：${outputPath}`);

    if (index < conditions.length - 1 && config.requestIntervalMs > 0) {
      await wait(config.requestIntervalMs);
    }
  }

  console.log('全部搜索任务已完成');
}

main().catch((error) => {
  console.error(`执行失败：${error.message}`);
  process.exitCode = 1;
});
