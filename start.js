#!/usr/bin/env node
/* ------------------------------------------------------------------
* hems-emulator - start.js
* ---------------------------------------------------------------- */
'use strict';
const mFs = require('fs');
const mPath = require('path');

/* ------------------------------------------------------------------
* コマンドラインオプション
* --enable-debug:
*     デバッグモードを有効にする (シェルにログを出力する)
* ---------------------------------------------------------------- */
let options = {
  enable_debug: false,
};

let opt_sw_started = false;
for (let opt of process.argv) {
  if (/start\.js/.test(opt)) {
    opt_sw_started = true;
    continue;
  }
  if (opt_sw_started) {
    if (opt === '--enable-debug') {
      options.enable_debug = true;
    } else {
      console.error(new Error('指定のコマンドラインオプションはサポートされていません: ' + opt));
      process.exit();
    }
  }
}

// VERSION ファイル読み取り
let version = readVersion();

// スプラッシュテキスト表示
if (options.enable_debug) {
  let stext = readSplashText();
  showSplash(version, stext);
}

// node のバージョンをチェック
let node_ver = process.versions.node;
let ver_m = node_ver.match(/^(\d+)\./);
if(ver_m) {
  let major_ver = parseInt(ver_m[1], 10);
  if(major_ver < 12) {
    // v12 未満なら終了
    let msg = 'node.js のバージョンが v12 未満です。hems-emulator は動作しないため終了します。(現在の node.js のバージョン: ' + node_ver + ')';
    console.log('\n');
    console.log('\u001b[31m' + msg + '\u001b[0m');
    console.log('\n');
    process.exit();
  }
}

// HEMS エミュレーター起動
const mHemsEmulator = require('./lib/hems-emulator.js');
let hemsemulator = new mHemsEmulator({ base_dir: __dirname, version: version });
hemsemulator.start(options).then(() => {
  // 何もしない
}).catch((error) => {
  console.error(error);
  process.exit();
});


function showSplash(version, stext) {
  console.log('\u001b[32m');
  console.log(stext);
  console.log('');
  console.log('ECHONET Lite 実機試験環境整備');
  console.log('HEMS エミュレーター v' + version);
  console.log('\u001b[0m');
}

function readSplashText() {
  let text = '';
  let fpath = mPath.join(__dirname, 'etc', 'splash.txt');
  if (mFs.existsSync(fpath)) {
    try {
      text = mFs.readFileSync(fpath, 'utf8');
      text = text.replace(/\n+$/, '')
    } catch (e) { }
  }
  return text;
}

function readVersion() {
  let ver = '';
  let fpath = mPath.join(__dirname, 'VERSION');
  if (mFs.existsSync(fpath)) {
    try {
      let fbody = mFs.readFileSync(fpath, 'utf8');
      let m = fbody.match(/^([^\n\r]+)/);
      if (m && m[1]) {
        ver = m[1];
      }
    } catch (e) { }
  }
  return ver;
}