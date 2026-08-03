# 前端AI实验室

这是一个面向前端与增长团队的资讯和工具工作台，提供关键词趋势、全球市场观察、每日数据简报，并通过 Node.js 脚本批量采集和整理搜索数据。

## 环境要求

- Node.js 18 或更高版本
- 有效的 Serper API Key

## 配置

编辑 `search-config.json`：

```json
{
  "keywords": [
    "random video chat",
    "free random video chat",
    "chat with strangers",
    "random chat",
    "video chat with strangers",
    "Omegle alternative",
    "free Omegle alternative",
    "random cam chat"
  ],
  "countries": [
    {
      "code": "in",
      "language": "en"
    },
    {
      "code": "us",
      "language": "en"
    },
    {
      "code": "gb",
      "language": "en"
    }
  ],
  "page": 1,
  "outputDirectory": "results",
  "requestIntervalMs": 500,
  "timeoutMs": 30000
}
```

- `keywords`：要搜索的关键词列表。
- `countries`：国家配置列表；`code` 对应 Serper 的 `gl`，`language` 对应 `hl`，语言可省略。
- `page`：要采集的搜索结果页码，必须是大于或等于 1 的整数。
- `outputDirectory`：结果目录，相对于配置文件所在目录。
- `requestIntervalMs`：相邻请求之间的等待时间。
- `timeoutMs`：单个请求的超时时间。

脚本会搜索 `keywords` 和 `countries` 的所有组合。

## 运行

在项目根目录创建 `.env`，可以复制示例文件：

```bash
cp .env.example .env
```

然后在 `.env` 中填写密钥：

```dotenv
SERPER_API_KEY=你的_API_Key
```

运行搜索：

```bash
npm run search
```

`.env` 已被 `.gitignore` 排除，不应提交到 Git。也可以不创建 `.env`，改为在命令行设置 `SERPER_API_KEY`；命令行环境变量的优先级更高。

也可以传入其他配置文件：

```bash
node serper-search.js ./其他配置.json
```

## 结果目录

结果按本地日期和搜索条件保存，例如：

```text
results/
└── 2026-07-31/
    └── 人工智能__country-cn__language-zh-cn__page-1.json
```

同一天重复执行相同搜索条件时，会更新对应的结果文件。每个文件包含：

- `searchCondition`：本次搜索条件。
- `searchedAt`：执行时间，ISO 8601 格式。
- `data`：Serper 返回的原始数据。

## 检查脚本语法

```bash
npm run check
```

## 生成可视化报告

搜索完成后，将 `results` 目录中的全部 JSON 数据按关键词整理为 HTML：

```bash
npm run report
```

核心首页生成在 `static/index.html`，数据档案生成在 `static/archive.html`，每天的数据报告生成在 `static/reports/YYYY-MM-DD.html`。首页趋势数据写入 `static/data/rank-trends.json`，日报数据写入 `static/data/reports/YYYY-MM-DD.json`，页面会通过带内容版本号的 Fetch 按需加载，避免把完整业务数据嵌入 HTML，并在数据更新后主动绕过旧缓存。报告包含：

- 首页以关键词排名趋势作为核心工具，采用全宽布局。
- 数据档案二级页面按日期从新到旧排列每日简报。
- 每个日期的数据量、搜索条件和关键词摘要。
- 根页面按关键词展示主要域名的平均自然排名趋势，可点击网站名称筛选折线。
- 网站图例支持全选、反选、恢复默认前 10 和清空，便于批量调整折线。
- 首页提供排名变化分析，比较所选日期范围首尾排名并识别上升、下降、新进入和掉出。
- 根据相邻真实数据日计算 0～100 波动指数，并提供高波动网站排行。
- 网站画像汇总排名表现、日期覆盖、关键词与国家覆盖、Top 3/Top 10 比例和优势市场。
- 网站覆盖率模块综合日期、关键词和国家覆盖比例，展示当前筛选范围内的覆盖率排行。
- 点击趋势折线、变化榜、波动榜或覆盖率榜中的网站可联动切换网站画像。
- 排名趋势默认显示最近一周，可快捷切换最近 3 天、最近一个月、全部数据或自定义日期范围。
- 趋势图使用本地化的 Apache ECharts，支持点击图例、拖动和缩放。
- 日期范围使用经过主题美化的 Flatpickr 中文范围日历选择器。
- 各国家实际搜索结果数量对比。
- 关键词下的热门域名分布。
- 自动将不同子域名归并到可注册主域名，并正确识别 `co.uk` 等多级公共后缀。
- 不同国家搜索结果的域名重合度。
- 按关键词和国家切换的搜索结果明细。

每次运行都会根据当前 `results` 目录重新生成历史列表和对应日期的数据页。

## GitHub Pages 发布

仓库推送到 `main` 后，`.github/workflows/pages.yml` 会检查 `static` 目录，压缩 HTML、内联 CSS 和内联 JavaScript，再将 `.pages-dist` 部署到 GitHub Pages。仓库中仍保留可读的原始页面。

发布前可在本地检查：

```bash
npm run check:pages
npm run build:pages
npm run check:pages:dist
```

`static/.nojekyll` 用于确保 GitHub Pages 原样发布静态资源。

## 每日自动更新

`.github/workflows/daily-search.yml` 每天北京时间 02:00 自动执行：

1. 从 GitHub Actions Secret 读取 `SERPER_API_KEY`。
2. 按 `search-config.json` 拉取当日真实搜索数据。
3. 重新生成首页、数据档案、日报和 SEO 文件。
4. 将 `results` 和 `static` 的变更提交并推送到 `main`。
5. 仅在产生新提交后显式触发统一的 Pages 工作流，由其完成一次压缩和部署。

定时表达式使用 UTC，`0 18 * * *` 对应次日北京时间 02:00。也可以在 GitHub Actions 页面手动触发。

## 每日排名通知

`.github/workflows/ranking-notification.yml` 每天北京时间 09:30 读取最新趋势数据，对比最近两个真实数据日，并通过钉钉机器人发送 Markdown 通知。通知包含排名上升、下降、持平、新进入、掉出以及当前领先网站。

钉钉地址和加签密钥分别保存为仓库 Secrets：`DINGTALK_WEBHOOK`、`DINGTALK_SECRET`，不会写入代码或日志。定时任务仅在最新数据日期等于上海时区当天日期时发送，避免数据采集延迟时误发旧数据。

可以在 GitHub Actions 页面手动执行。手动执行默认只在任务摘要中生成预览；明确开启“是否实际发送钉钉通知”后才会发送。也可以在本地生成预览：

```bash
npm run notify:ranking -- --allow-stale
```

## SEO 与搜索收录

每次执行 `npm run report` 时，生成器会同步更新页面 SEO 信息和搜索引擎入口：

- 首页、数据档案和每日简报都包含独立标题、描述与规范链接。
- 页面包含 Open Graph 和 Twitter 分享卡片元信息。
- 首页使用 `WebSite` 结构化数据，档案页使用 `CollectionPage`，日报使用 `Dataset` 与面包屑数据。
- `static/sitemap.xml` 自动收录首页、档案和全部日报。
- `static/robots.txt` 允许正常抓取并声明站点地图地址。
- `static/favicon.svg` 和 `static/assets/og-cover.png` 用于浏览器标识与社交分享封面。

发布前的 `npm run check:pages` 会校验 SEO 必需文件、页面元信息、JSON-LD 格式以及动态数据 JSON 的完整性。

## 生成演示历史数据

需要查看完整月份的排名趋势时，可以基于最新日期的真实结果，补齐该月此前日期的模拟数据：

```bash
npm run mock-history
npm run report
```

模拟文件包含 `simulation.isSimulated: true` 标记，并记录来源文件。脚本不会覆盖没有模拟标记的真实数据。

需要按照当前关键词和国家配置重建截至最新数据日期的三个完整自然月时：

```bash
npm run mock-quarter
npm run report
```

该命令会先将现有 `results` 整体移动到 `results_archive`，再生成三个月模拟数据，原数据可恢复。
