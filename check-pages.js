import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const directoryArgument = process.argv[2] || 'static';
const STATIC_DIRECTORY = path.resolve(process.cwd(), directoryArgument);
const REQUIRED_FILES = [
  'index.html',
  'archive.html',
  'rank-animation.html',
  'sitemap.xml',
  'robots.txt',
  'favicon.svg',
  'assets/og-cover.png',
  'assets/og-cover.svg',
  'data/rank-trends.json',
  '.nojekyll',
];
const SITE_URL = 'https://premillos.github.io/ai';
// 首页依赖固定版本的公共 CDN，构建检查用于防止误退回本地大文件。
const REQUIRED_CDN_REFERENCES = [
  'https://cdn.jsdelivr.net/npm/echarts@6.1.0/dist/echarts.min.js',
  'https://cdn.jsdelivr.net/npm/flatpickr@4.6.13/dist/flatpickr.min.css',
  'https://cdn.jsdelivr.net/npm/flatpickr@4.6.13/dist/flatpickr.min.js',
  'https://cdn.jsdelivr.net/npm/flatpickr@4.6.13/dist/l10n/zh.js',
];

/**
 * 递归读取静态目录中的全部文件。
 * @param {string} directory 当前目录
 * @returns {Promise<string[]>} 文件绝对路径
 */
async function findFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      return entry.isDirectory() ? findFiles(entryPath) : [entryPath];
    }),
  );
  return files.flat();
}

/**
 * 从 HTML 中提取本地链接和资源地址。
 * @param {string} html HTML 内容
 * @returns {string[]} 本地地址
 */
function findLocalReferences(html) {
  return [...html.matchAll(/\b(?:href|src)="([^"]+)"/g)]
    .map((match) => match[1])
    .filter(
      (reference) =>
        reference &&
        !reference.startsWith('#') &&
        !reference.startsWith('http://') &&
        !reference.startsWith('https://') &&
        !reference.startsWith('mailto:') &&
        !reference.startsWith('data:'),
    );
}

/**
 * 检查 GitHub Pages 发布所需文件和相对链接。
 */
async function main() {
  const files = await findFiles(STATIC_DIRECTORY);
  const relativeFiles = new Set(
    files.map((file) => path.relative(STATIC_DIRECTORY, file)),
  );

  for (const requiredFile of REQUIRED_FILES) {
    if (!relativeFiles.has(requiredFile)) {
      throw new Error(`缺少 GitHub Pages 必需文件：${requiredFile}`);
    }
  }

  const htmlFiles = files.filter((file) => file.endsWith('.html'));
  for (const htmlFile of htmlFiles) {
    const html = await readFile(htmlFile, 'utf8');
    if (html.includes('SERPER_API_KEY')) {
      throw new Error(`页面中出现密钥变量：${htmlFile}`);
    }
    if (
      html.includes('const reportData = {') ||
      html.includes('const rankTrendData = {')
    ) {
      throw new Error(`页面仍包含内嵌业务数据：${htmlFile}`);
    }

    // 动态 JSON 必须携带内容指纹，防止部署后继续读取旧缓存。
    if (
      path.basename(htmlFile) === 'index.html' &&
      !/data\/rank-trends\.json\?v=[a-f0-9]{12}/.test(html)
    ) {
      throw new Error(`首页趋势数据缺少内容版本号：${htmlFile}`);
    }
    if (path.basename(htmlFile) === 'index.html') {
      for (const reference of REQUIRED_CDN_REFERENCES) {
        if (!html.includes(reference)) {
          throw new Error(`首页缺少固定版本 CDN 资源：${reference}`);
        }
      }
      if (/\b(?:href|src)="vendor\/(?:echarts|flatpickr)/.test(html)) {
        throw new Error(`首页仍在引用本地图表资源：${htmlFile}`);
      }
      // 首页必须保留网站图例的四种批量操作，避免只能逐项点击。
      for (const action of ['all', 'invert', 'default', 'none']) {
        if (!html.includes(`data-legend-action="${action}"`)) {
          throw new Error(`首页缺少网站批量操作 ${action}：${htmlFile}`);
        }
      }
    }
    if (
      path.dirname(htmlFile) === path.join(STATIC_DIRECTORY, 'reports') &&
      !/\.\.\/data\/reports\/[^?'"\s]+\.json\?v=[a-f0-9]{12}/.test(html)
    ) {
      throw new Error(`日报动态数据缺少内容版本号：${htmlFile}`);
    }

    const requiredSeoPatterns = [
      ['页面标题', /<title>[^<]+<\/title>/],
      ['页面描述', /<meta name="description" content="[^"]+">/],
      ['抓取指令', /<meta name="robots" content="[^"]+">/],
      ['规范链接', /<link rel="canonical" href="https:\/\/premillos\.github\.io\/ai\/[^"]*">/],
      ['Open Graph 标题', /<meta property="og:title" content="[^"]+">/],
      ['Open Graph 图片', /<meta property="og:image" content="[^"]+">/],
      ['JSON-LD 结构化数据', /<script type="application\/ld\+json">[\s\S]+?<\/script>/],
    ];

    for (const [label, pattern] of requiredSeoPatterns) {
      if (!pattern.test(html)) {
        throw new Error(
          `页面缺少 ${label}：${path.relative(process.cwd(), htmlFile)}`,
        );
      }
    }

    const structuredDataMatches = [
      ...html.matchAll(
        /<script type="application\/ld\+json">([\s\S]+?)<\/script>/g,
      ),
    ];
    for (const match of structuredDataMatches) {
      try {
        JSON.parse(match[1]);
      } catch (error) {
        throw new Error(
          `JSON-LD 格式无效：${path.relative(process.cwd(), htmlFile)}，${error.message}`,
        );
      }
    }

    for (const reference of findLocalReferences(html)) {
      const cleanReference = decodeURIComponent(
        reference.split('#')[0].split('?')[0],
      );
      const targetPath = path.resolve(path.dirname(htmlFile), cleanReference);
      const relativeTarget = path.relative(STATIC_DIRECTORY, targetPath);

      if (
        relativeTarget.startsWith('..') ||
        !relativeFiles.has(relativeTarget)
      ) {
        throw new Error(
          `页面存在无效本地链接：${path.relative(process.cwd(), htmlFile)} -> ${reference}`,
        );
      }
    }
  }

  // 校验动态加载的 JSON 文件可解析，并确保每个日报都有对应数据文件。
  const dataFiles = files.filter(
    (file) =>
      file.startsWith(`${path.join(STATIC_DIRECTORY, 'data')}${path.sep}`) &&
      file.endsWith('.json'),
  );
  for (const dataFile of dataFiles) {
    try {
      JSON.parse(await readFile(dataFile, 'utf8'));
    } catch (error) {
      throw new Error(
        `动态数据 JSON 格式无效：${path.relative(process.cwd(), dataFile)}，${error.message}`,
      );
    }
  }

  // 首页趋势数据必须包含网站画像，确保变化分析和波动指数具备数据基础。
  const rankTrendData = JSON.parse(
    await readFile(
      path.join(STATIC_DIRECTORY, 'data', 'rank-trends.json'),
      'utf8',
    ),
  );
  if (
    !Array.isArray(rankTrendData.trends) ||
    rankTrendData.trends.length === 0 ||
    rankTrendData.trends.some(
      (trend) =>
        !Array.isArray(trend.series) ||
        trend.series.some(
          (series) =>
            !series.profile ||
            !Array.isArray(series.profile.topKeywords) ||
            !Array.isArray(series.profile.topCountries) ||
            !Array.isArray(series.profile.coverageByDate),
        ),
    )
  ) {
    throw new Error('首页趋势数据缺少完整的网站画像字段');
  }

  const indexHtml = await readFile(
    path.join(STATIC_DIRECTORY, 'index.html'),
    'utf8',
  );
  for (const componentId of [
    'analysis-metrics',
    'ranking-changes',
    'volatility-ranking',
    'coverage-ranking',
    'profile-domain-select',
    'domain-profile',
  ]) {
    if (!indexHtml.includes(`id="${componentId}"`)) {
      throw new Error(`首页缺少排名分析组件：${componentId}`);
    }
  }

  // 排名动画页必须具备完整控制器，并继续按版本加载同一份趋势数据。
  const rankAnimationHtml = await readFile(
    path.join(STATIC_DIRECTORY, 'rank-animation.html'),
    'utf8',
  );
  for (const componentId of [
    'rank-motion-chart',
    'motion-keyword',
    'motion-country',
    'motion-count',
    'motion-speed',
    'motion-play',
    'motion-timeline',
  ]) {
    if (!rankAnimationHtml.includes(`id="${componentId}"`)) {
      throw new Error(`排名动画页缺少交互组件：${componentId}`);
    }
  }
  if (!/data\/rank-trends\.json\?v=[a-f0-9]{12}/.test(rankAnimationHtml)) {
    throw new Error('排名动画页趋势数据缺少内容版本号');
  }

  const reportHtmlFiles = htmlFiles.filter(
    (file) => path.dirname(file) === path.join(STATIC_DIRECTORY, 'reports'),
  );
  for (const reportHtmlFile of reportHtmlFiles) {
    const dataFile = path.join(
      STATIC_DIRECTORY,
      'data',
      'reports',
      `${path.basename(reportHtmlFile, '.html')}.json`,
    );
    if (!files.includes(dataFile)) {
      throw new Error(
        `日报缺少动态数据文件：${path.relative(process.cwd(), reportHtmlFile)}`,
      );
    }
  }

  const sitemap = await readFile(path.join(STATIC_DIRECTORY, 'sitemap.xml'), 'utf8');
  if (
    !sitemap.includes(`${SITE_URL}/`) ||
    !sitemap.includes(`${SITE_URL}/rank-animation.html`) ||
    !sitemap.includes('<urlset')
  ) {
    throw new Error('站点地图缺少站点首页、排名动画页或 urlset 根节点');
  }

  const robots = await readFile(path.join(STATIC_DIRECTORY, 'robots.txt'), 'utf8');
  if (!robots.includes(`Sitemap: ${SITE_URL}/sitemap.xml`)) {
    throw new Error('robots.txt 未正确声明站点地图');
  }

  console.log(
    `GitHub Pages 检查通过：${path.relative(process.cwd(), STATIC_DIRECTORY)} 中有 ${htmlFiles.length} 个 HTML，${files.length} 个静态文件`,
  );
}

main().catch((error) => {
  console.error(`GitHub Pages 检查失败：${error.message}`);
  process.exitCode = 1;
});
