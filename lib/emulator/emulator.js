/* ------------------------------------------------------------------
* hems-emulator - emulator/emulator.js
* ---------------------------------------------------------------- */
'use strict';
const mEmulatorNet = require('./emulator-net.js');

class Emulator {
  /* ------------------------------------------------------------------
  * コンストラクタ
  * 
  * [引数]
  * - conf             | Object  | Required | 設定情報を格納したオブジェクト
  *   - join_multicast | Boolean | Required | マルチキャストグループにジョインするかどうかのフラグ
  * ---------------------------------------------------------------- */
  constructor(conf) {
    // conf のチェック
    if (!conf || typeof (conf) !== 'object') {
      throw new Error('The `conf` is invalid.');
    }

    // EmulatorNet のインスタンス
    this._net = new mEmulatorNet(conf);

    // -----------------------------------
    // パブリックなプロパティ
    // -----------------------------------

    // ECHONET Lite パケット送受信イベントハンドラ
    // - 主にデバッグ用
    this.onrecv = () => { }; // パケット受信イベントハンドラ
    this.onsent = () => { }; // パケット送信イベントハンドラ
  }

  /* ------------------------------------------------------------------
  * start()
  * - ECHONET Lite コントローラーを起動
  * 
  * [引数]
  * - なし
  * 
  * [戻値]
  * - Promise オブジェクト
  * - resolve() には何も引き渡されない
  * ---------------------------------------------------------------- */
  start() {
    return new Promise((resolve, reject) => {
      // UDP を初期化
      this._net.init().then(() => {
        // ECHONET パケット受信イベントハンドラをセット
        this._net.onrecv = this._recvElPacket.bind(this);
        // ECHONET パケット送信イベントハンドラをセット
        this._net.onsent = this._sentElPacket.bind(this);
        resolve();
      }).catch((error) => {
        reject(error);
      });
    });
  }

  // ECHONET パケットを送信したときの処理
  _sentElPacket(data) {
    // パケット送信イベントハンドラを実行
    this.onsent(data);
  }

  // ECHONET パケットを受信したときの処理
  _recvElPacket(data) {
    // パケット受信イベントハンドラを実行
    this.onrecv(data);
  }

  /* ------------------------------------------------------------------
  * send(address, packet)
  * - ECHONET Lite パケットを指定の IP アドレスに向けて送信
  * 
  * [引数]
  * - address       | String  | Required | 宛先の IPv4 アドレス
  *                 |         |          | null を指定したらマルチキャスト
  * - packet        | Object  | Required |
  *   - tid         | Integer | Optional | 指定がなけれは自動採番
  *   - seoj        | String  | Required | 16進数文字列 (例: "0x013001")
  *   - deoj        | String  | Required | 16進数文字列 (例: "0x05FF01")
  *   - esv         | String  | Required | 16進数文字列 (例: "0x62")
  *                 | String  |          | またはキーワード (例: "GET")
  *   - operations  | Array   | Required | プロパティのリスト
  *     - epc       | String  | Required | EPC の16進数文字列 (例: "0x80")
  *     - edt       | Buffer  | Optional | EDT を表す Buffer オブジェクト
  *                 | String  |          | または 16 進数文字列 (例: "0x0102")
  *                 | Array   |          | または 16 進数文字列バイト配列 (例: ["0x01", "0x02"])
  *                 | Array   |          | または数値バイト配列 (例: [0x01, 0x02])
  *   - operations2 | Array   | *1       | プロパティのリスト
  *     - epc       | String  | Required | EPC の16進数文字列 (例: "0x80")
  *     - edt       | Buffer  | Optional | EDT を表す Buffer オブジェクト
  *                 | String  |          | または 16 進数文字列 (例: "0x0102")
  *                 | Array   |          | または 16 進数文字列バイト配列 (例: ["0x01", "0x02"])
  *                 | Array   |          | または数値バイト配列 (例: [0x01, 0x02])
  * 
  * *1 operations2 は ESV が SETGET または SETGET_RES の場合のみ必須
  * 
  * [戻値]
  * - Promise オブジェクト
  * - resolve() には何も引き渡されない
  * ---------------------------------------------------------------- */
  send(address, packet) {
    return new Promise((resolve, reject) => {
      this._net.send(address, packet).then(() => {
        resolve();
      }).catch((error) => {
        reject(error);
      });
    });
  }

};

module.exports = Emulator;
