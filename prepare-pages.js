import { cp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { minify } from 'html-minifier-terser';

const SOURCE_DIRECTORY = path.resolve(process.cwd(), 'static');
const OUTPUT_DIRECTORY = path.resolve(process.cwd(), '.pages-dist');

/**
 * 递归读取目录中的全部文件。
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
 * 计算文件列表的总字节数。
 * @param {string[]} files 文件列表
 * @returns {Promise<number>} 总字节数
 */
async function getTotalSize(files) {
  const sizes = await Promise.all(files.map(async (file) => (await stat(file)).size));
  return sizes.reduce((total, size) => total + size, 0);
}

/**
 * 压缩发布目录中的 HTML 及其内联样式与脚本。
 */
async function main() {
  await rm(OUTPUT_DIRECTORY, { recursive: true, force: true });
  await cp(SOURCE_DIRECTORY, OUTPUT_DIRECTORY, { recursive: true });

  const sourceFiles = await findFiles(SOURCE_DIRECTORY);
  const outputFiles = await findFiles(OUTPUT_DIRECTORY);
  const htmlFiles = outputFiles.filter((file) => file.endsWith('.html'));
  const originalSize = await getTotalSize(sourceFiles);

  for (const htmlFile of htmlFiles) {
    const html = await readFile(htmlFile, 'utf8');
    const compressed = await minify(html, {
      collapseWhitespace: true,
      conservativeCollapse: true,
      minifyCSS: true,
      minifyJS: true,
      removeComments: true,
      removeRedundantAttributes: true,
      useShortDoctype: true,
    });
    await writeFile(htmlFile, compressed, 'utf8');
  }

  const compressedFiles = await findFiles(OUTPUT_DIRECTORY);
  const compressedSize = await getTotalSize(compressedFiles);
  const savedSize = originalSize - compressedSize;
  const savedRate = originalSize === 0 ? 0 : (savedSize / originalSize) * 100;

  console.log(
    `Pages 产物准备完成：${htmlFiles.length} 个 HTML，体积减少 ${savedSize.toLocaleString('zh-CN')} 字节（${savedRate.toFixed(1)}%）`,
  );
}

main().catch((error) => {
  console.error(`Pages 产物压缩失败：${error.message}`);
  process.exitCode = 1;
});
