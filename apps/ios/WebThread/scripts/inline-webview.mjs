import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const distDir = path.resolve(import.meta.dirname, '..', 'dist');
const indexPath = path.join(distDir, 'index.html');

let html = await readFile(indexPath, 'utf8');

const stylesheetPattern = /<link rel="stylesheet" crossorigin href="([^"]+)">/g;
html = await replaceAsync(html, stylesheetPattern, async (_match, href) => {
  const css = await readFile(path.join(distDir, href), 'utf8');
  return `<style>\n${css}\n</style>`;
});

const moduleScriptPattern = /<script type="module" crossorigin src="([^"]+)"><\/script>/g;
html = await replaceAsync(html, moduleScriptPattern, async (_match, src) => {
  const js = await readFile(path.join(distDir, src), 'utf8');
  return `<script type="module">\n${js}\n</script>`;
});

await writeFile(indexPath, html);

async function replaceAsync(value, pattern, replacer) {
  const matches = [...value.matchAll(pattern)];
  let result = value;
  for (const match of matches.reverse()) {
    const replacement = await replacer(...match);
    result =
      result.slice(0, match.index) +
      replacement +
      result.slice(match.index + match[0].length);
  }
  return result;
}
