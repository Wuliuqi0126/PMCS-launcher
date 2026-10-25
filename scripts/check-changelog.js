'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function checkChangelog() {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const source = fs.readFileSync(path.join(root, 'renderer', 'changelog.js'), 'utf8');
  const versions = [...source.matchAll(/version:\s*['"]([^'"]+)['"]/g)].map((match) => match[1]);
  if (!versions.includes(pkg.version)) {
    throw new Error(
      `版本 ${pkg.version} 没有对应的更新公告。请在 renderer/changelog.js 中添加 version: '${pkg.version}' 的记录后再打包。`,
    );
  }
  return pkg.version;
}

if (require.main === module) {
  try {
    console.log(`Changelog OK: ${checkChangelog()}`);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

module.exports = { checkChangelog };
