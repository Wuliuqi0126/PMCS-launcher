'use strict';

const esbuild = require('esbuild');
const path = require('path');
const { checkChangelog } = require('./check-changelog');

// 硬性约束：package.json 的版本必须在 renderer/changelog.js 中存在。
// 以后升级版本时，先补公告再打包，避免漏掉版本记录。
checkChangelog();

esbuild.build({
  entryPoints: [path.resolve(__dirname, '..', 'renderer', 'react', 'main.jsx')],
  bundle: true,
  outfile: path.resolve(__dirname, '..', 'renderer', 'react-bundle.js'),
  format: 'iife',
  platform: 'browser',
  target: 'chrome120',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  minify: true,
  legalComments: 'none',
}).then(() => {
  console.log('React renderer bundle built: renderer/react-bundle.js');
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
