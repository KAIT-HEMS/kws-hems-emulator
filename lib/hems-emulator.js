/* ------------------------------------------------------------------
* hems-emulator - hems-emulator.js
* ---------------------------------------------------------------- */
'use strict';
const mFs = require('fs');
const mFsPromise = require('fs').promises;
const mPath = require('path');
const WebSocketClient = require('websocket').client;
const mHttps = require('https');

const mHemsEmulatorDebug = require('./hems-emulator-debug.js');
const mEmulator = require('./emulator/emulator.js');

class HemsEmulator {
  /* ------------------------------------------------------------------
  * コンストラクタ
  * 
  * [引数]
  * - params     | Object | Required |
  *   - base_dir | String | Required | ベースディレクトリパス
  *   - version  | String | Required | hemscontroller のバージョン
  * ---------------------------------------------------------------- */
  constructor(params) {
    this._base_dir = params.base_dir;
    this._version = params.version;
    this._debug = null; // HemsControllerDebug オブジェクト

    // 設定ファイルのロード
    this._conf = this._loadConf();
    // データ保存ディレクトリパスを設定情報に追加
    //this._conf.el_controler.data_dir_path = mPath.join(__dirname, '..', 'etc');

    // ECHONET エミュレーター
    this._emulator = null;

    // WebSocket クライアント
    this._ws = new WebSocketClient();
    // WebSocket コネクション
    this._ws_conn = null;

    // エミュレートするデバイス ID
    this._device_id = '';

    this._on_log_elrecv = () => { };
    this._on_log_elsent = () => { };
    this._on_log_wsrecv = () => { };
    this._on_log_wssent = () => { };
    this._on_log_httpreq = () => { };
    this._on_log_httpres = () => { };

    // ESV の 16 進数と意味の対応
    this._esv_name_code_map = {
      'SETI': '60',
      'SETC': '61',
      'GET': '62',
      'INF_REQ': '63',
      'SETGET': '6E',
      'SET_RES': '71',
      'GET_RES': '72',
      'INF': '73',
      'INFC': '74',
      'INFC_RES': '7A',
      'SETGET_RES': '7E',
      'SETI_SNA': '50',
      'SETC_SNA': '51',
      'GET_SNA': '52',
      'INF_SNA': '53',
      'SETGET_SNA': '5E'
    };
    this._esv_code_name_map = {};
    for (let [k, v] of Object.entries(this._esv_name_code_map)) {
      this._esv_code_name_map[v] = k;
    }
  }

  _wait(msec) {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve();
      }, msec);
    });
  }

  /* ------------------------------------------------------------------
  * start(options)
  * - HEMS コントローラーを起動する
  *
  * [引数]
  * - options        | Object  | Optional | 起動オプション
  *   - enable_debug | Boolean | Optional | デバッグモード有効フラグ
  * 
  * [戻値]
  * - なし
  * ---------------------------------------------------------------- */
  async start(options = {}) {
    // HemsEmulatorDebug オブジェクトを生成
    this._debug = new mHemsEmulatorDebug({
      console: options.enable_debug,
      file: this._conf.debug.file_enabled,
      rotate: this._conf.debug.file_rotate,
      path: this._conf.debug.log_dir_path || mPath.join(this._base_dir, 'logs')
    });
    await this._debug.init();

    let opt_list = [
      '- ログファイル出力: ' + (this._conf.debug.file_enabled ? '有効' : '無効')
    ];
    this._debug.log('HEMS エミュレーターを起動します。', opt_list.join('\n'));

    // エミュレーターオブジェクト生成
    this._emulator = new mEmulator(this._conf.el_emulator);

    // パケットロギングの準備
    this._initPacketLoging();

    // ECHONET Lite エミュレーター起動
    await this._emulator.start();
    this._debug.log('ECHONET Lite エミュレーターを起動しました。');

    // エミュレーターオブジェクトの各種イベントハンドラをセット
    this._emulator.onrecv = this._onElRecv.bind(this); // EL パケット受信
    this._emulator.onsent = this._onElSent.bind(this); // EL パケット送信

    // エミュレートするデバイス ID を読み取る
    let dev_id_fpath = mPath.join(__dirname, '..', 'etc', 'device_id.txt');
    let dev_id = await mFsPromise.readFile(dev_id_fpath, 'utf8');
    dev_id = dev_id.replace(/[\n\r]/g, '');
    if (!dev_id) {
      this._debug.error('etc/device_id.txt にデバイス ID が設定されていません。');
      process.exit();
    }
    this._debug.log('エミュレートするデバイスの ID を読み取りました。', '- ' + dev_id);
    this._device_id = dev_id;

    // クラウドサーバーとの WebSocket コネクションを準備
    this._initWebSocket();
  }

  // 設定ファイルのロード
  _loadConf() {
    let fpath = mPath.join(this._base_dir, 'etc', 'config.js');
    if (!mFs.existsSync(fpath)) {
      let fpath_default = mPath.join(this._base_dir, 'etc', 'config.default.js');
      if (!mFs.existsSync(fpath_default)) {
        throw new Error('デフォルト設定ファイルが見つかりませんでした。');
      }
      try {
        mFs.copyFileSync(fpath_default, fpath);
      } catch (error) {
        throw new Error('config.default.js のコピーに失敗しました: ' + error.message);
      }
    }
    let conf = null;
    try {
      conf = require(fpath);
    } catch (error) {
      throw new Error('config.js の読み取りに失敗しました: ' + error.message);
    }
    return conf;
  }

  _initPacketLoging() {
    let targets = this._conf.debug.targets;

    // ECHONET Lite パケット受信イベントハンドラをセット
    if (targets.elrecv) {
      this._on_log_elrecv = (data) => {
        this._debug.log('ECHONET Lite パケット受信', data);
      };
    }

    // ECHONET Lite パケット送信ベントハンドラをセット
    if (targets.elsent) {
      this._on_log_elsent = (data) => {
        this._debug.log('ECHONET Lite パケット送信', data);
      };
    }

    // WebSocket メッセージ受信イベントハンドラをセット
    if (targets.wsrecv) {
      this._on_log_wsrecv = (data) => {
        this._debug.log('WebSocket メッセージ受信', data);
      };
    }

    // WebSocket メッセージ送信ベントハンドラをセット
    if (targets.wssent) {
      this._on_log_wssent = (data) => {
        this._debug.log('WebSocket メッセージ送信', data);
      };
    }

    // HTTP リクエスト送信ベントハンドラをセット
    if (targets.httpreq) {
      this._on_log_httpreq = (data) => {
        this._debug.log('HTTP リクエスト送信', data);
      };
    }

    // HTTP レスポンス受信ベントハンドラをセット
    if (targets.httpreq) {
      this._on_log_httpres = (data) => {
        this._debug.log('HTTP レスポンス受信', data);
      };
    }
  }

  /* ------------------------------------------------------------------
  * _onElRecv(data)
  * - this._emulator.onrecv イベントハンドラにより呼び出される
  *
  * [引数]
  * - data  | Object | Required | パケット情報
  * 
  *   data = {
  *     "address": "192.168.11.12",
  *     "hex": "108100060130010EF0017301800131",
  *     "packet": {
  *       "tid": 6,
  *       "seoj": "0x013001",
  *       "deoj": "0x0EF001",
  *       "esv": "0x73",
  *       "operations": [
  *         {
  *           "epc": "0x80",
  *           "edt": ["0x31"]
  *         }
  *       ]
  *     }
  *   }
  * 
  * [戻値]
  * - なし
  * ---------------------------------------------------------------- */
  _onElRecv(data) {
    // ログ
    this._on_log_elrecv(data);

    let packet = data.packet;
    // ESV が (SETI|SETC|GET|INF_REQ|SETGET|INFC) でなければ終了
    if (!/^0x(60|61|62|63|6E|74)$/.test(packet.esv)) {
      return;
    }

    (async () => {
      // webAPI サーバーに echoCommands リクエストを送信
      let url = this._conf.rest.uri + '/devicesForEmulator/' + this._device_id + '/echoCommands';
      let res = await this._httpRequest(url, 'post', data.packet);
      // ----------------------------------
      // [成功]
      // res = {
      //   "status": {"code": 200, "message": "OK"},
      //   "body": {
      //     "id": "FE00007776453D7AB3E30EF00100000000",
      //     "tid": 13,
      //     "seoj": "0x0EF001",
      //     "deoj": "0x05FF01",
      //     "esv": "0x72",
      //     "operations": [
      //       {"epc": "0xD6", "edt": ["0x01", "0x01", "0x30", "0x01"]}
      //     ]
      //   }
      // }
      //
      // [エラー]
      // res = {
      //   "status": {"code": 404, "message": "Not Found"},
      //   "body": {
      //     "code": 404,
      //     "message": "HEMS コントローラーがネットワークに未接続です。"
      //   }
      // }
      // ----------------------------------
      if (Math.floor(res.status.code / 100) === 2) {
        // HTTP レスポンスの内容を ECHONET Lite パケットとして転送
        await this._emulator.send(data.address, res.body);
      }

    })().catch((error) => {
      this._debug.error('echoCommands リクエストに失敗しました。', null, error);
    });
  }

  /* ------------------------------------------------------------------
  * _onElSent(data)
  * - this._emulator.onsent イベントハンドラにより呼び出される
  * ---------------------------------------------------------------- */
  _onElSent(data) {
    // ログ
    this._on_log_elsent(data);
  }

  // 機器発見リクエスト
  async _getDevicesRequest() {
    let url = this._conf.rest.uri + '/devicesForEmulator/';
    let res = await this._httpRequest(url, 'get');
    return res;
  }

  // HTTP リクエスト
  _httpRequest(url, method, data) {
    return new Promise((resolve, reject) => {
      const headers = {
        'Authorization': 'Bearer ' + this._conf.token
      };
      if (this._conf.access_code) {
        headers['X-Elapi-Access-Code'] = this._conf.access_code;
      }
      const opts = {
        method: method,
        headers: headers
      };
      if (/^(put|post)$/.test(method)) {
        opts.headers['Content-Type'] = 'application/json';
      }

      let req = mHttps.request(url, opts, (res) => {
        res.setEncoding('utf8');
        let res_text = '';
        res.on('data', (chunk) => {
          res_text += chunk;
        });
        res.once('end', () => {
          let o = null;
          if (res_text) {
            try {
              o = JSON.parse(res_text);
            } catch (error) {
              reject(error);
            }
          }
          let rdata = {
            status: {
              code: res.statusCode,
              message: res.statusMessage
            },
            body: o
          };
          this._on_log_httpres(rdata);
          resolve(rdata);
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      //req.setTimeout(timeout, () => {
      //  req.abort();
      //  reject(new Error('TIMEOUT'));
      //});

      if (data) {
        if (typeof (data) === 'string') {
          req.write(data);
        } else {
          req.write(JSON.stringify(data));
        }
      }
      req.end();
      this._on_log_httpreq({
        url: url,
        method: method,
        headers: opts.headers,
        body: data
      });
    });
  }


  // クラウドサーバーとの WebSocket コネクションを準備
  _initWebSocket() {
    let establishConnection = () => {
      this._debug.log('WebSocket 接続を開始します: ', '- ' + this._conf.websocket.uri);
      this._ws.connect(this._conf.websocket.uri, 'echonetlite-protocol', null, {
        Authorization: 'Bearer ' + this._conf.token
      });
    };

    this._ws.on('connectFailed', (error) => {
      this._debug.error('WebSocket 接続に失敗しました (connectFailed): ', '- ' + error.toString());
      if (/x\-websocket\-reject\-reason\: (PATH_INVALID|BEARER_INVALID|TARGET_NOT_FOUND|STATUS_INVALID|DATE_EXPIRED)/i.test(error.message)) {
        return;
      }
      setTimeout(() => {
        establishConnection();
      }, 5000);
    });

    this._ws.on('connect', (connection) => {
      this._debug.log('WebSocket コネクションを確立しました。');
      this._ws_conn = connection;

      this._ws_conn.on('error', (error) => {
        this._debug.error("WebSocket コネクションが切断されました (error): ", '- ' + error.toString());
      });

      this._ws_conn.on('close', () => {
        this._debug.error('WebSocket コネクションが切断されました (close)。');
        setTimeout(() => {
          establishConnection();
        }, 5000);
      });

      this._ws_conn.on('message', (message) => {
        this._receivedWebSocketMessage(message);
      });

      let rdata = {
        type: 'REGISTER_REQUEST',
        data: {
          devices: [this._device_id]
        }
      };
      this._sendWebSocketMessage(rdata);
    });

    establishConnection();
  }

  // WebSocket メッセージを受信したときの処理
  // - 事実上、すべてのメッセージは INF パケット
  _receivedWebSocketMessage(message) {
    if (message.type !== 'utf8') {
      return;
    }
    let data = JSON.parse(message.utf8Data);
    // ------------------------------------------
    // data = {
    //   "id": "FE00007776453D7AB3E30EF00100000000",
    //   "tid": 95,
    //   "seoj": "0x013001",
    //   "deoj": "0x0EF001",
    //   "esv": "0x73",
    //   "operations": [
    //     {"epc": "0x80", "edt": ["0x30"]}
    //   ]
    // }
    // ------------------------------------------
    this._on_log_wsrecv(data);

    if (data.esv === '0x73') { // INF
      // ローカルネットワークに INF パケットをマルチキャストする
      this._emulator.send(null, data).then(() => {
        // Do nothing
      }).catch((error) => {
        this._debug.error('INF パケットのマルチキャストに失敗しました: ' + error.message);
      });
    }
  }

  // WebSocket メッセージを送信
  _sendWebSocketMessage(data) {
    if (this._ws_conn && this._ws_conn.connected) {
      this._ws_conn.sendUTF(JSON.stringify(data));
      this._on_log_wssent(data);
    }
  }

}

module.exports = HemsEmulator;