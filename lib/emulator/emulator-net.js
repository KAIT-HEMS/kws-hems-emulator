/* ------------------------------------------------------------------
* hems-emulator - emulator/emulator-net.js
* - UDP 通信関連の処理
* ---------------------------------------------------------------- */
'use strict';
const mOs = require('os');
const mDgram = require('dgram');
const mControllerPacket = require('./emulator-packet.js');

class ControllerNet {
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
    // ----------------------------------------------------------------
    // プライベートなプロパティ
    // ----------------------------------------------------------------

    // Packet モジュールのインスタンス
    this._mpacket = new mControllerPacket();

    // 送信パケットキュー関連
    this._send_queue = []; // 送信パケットキュー
    this._SEND_QUEUE_MAX = 10; // 送信パケットキューの上限数
    this._SEND_INTERVAL_MSEC = 100; // パケット送信間隔 (ミリ秒)
    this._last_tid = 0; // ECHONET Lite リクエストパケットの TID
    this._is_send_queue_processing = false; // 送信パケットキュー処理中フラグ
    this._last_sent_time = Date.now(); // 最後にパケットを送信完了した時間

    // UDP 関連
    this._EL_PORT = 3610; // UDP ポート番号
    this._EL_MULTICAST_ADDRESS = '224.0.23.0'; // マルチキャストアドレス (IPv4)
    this._udp = null; // Dgram モジュールから生成する UDP オブジェクト
    this._net_if_list = []; // ネットワークインタフェースのリスト
    this._join_multicast = conf.join_multicast; // マルチキャストグループにジョインするかどうかのフラグ

    // ----------------------------------------------------------------
    // パブリックなプロパティ
    // ----------------------------------------------------------------

    // イベントハンドラ
    this.onrecv = () => { }; // パケット受信のイベントハンドラ
    this.onsent = () => { }; // パケット送信のイベントハンドラ
  }


  /* ------------------------------------------------------------------
  * init()
  * - UDP の準備
  * - このモジュールを使う場合には必ず最初に実行すること
  * 
  * [引数]
  * - なし
  * 
  * [戻値]
  * - Promise オブジェクト
  * - resolve() には何も引き渡されない
  * ---------------------------------------------------------------- */
  init() {
    return new Promise((resolve, reject) => {
      this._udp = mDgram.createSocket('udp4');

      this._udp.once('error', (error) => {
        reject(error);
      });

      this._udp.on('message', (buf, device_info) => {
        this._receivePacket(buf, device_info);
      });

      this._udp.bind(this._EL_PORT, () => {
        this._udp.removeAllListeners('error');
        this._addMembership();
        resolve();
      });
    });
  }

  _addMembership() {
    if (!this._join_multicast) {
      return;
    }
    let netif_list = this._getNetworkInterfaceList();
    netif_list.forEach((netif) => {
      try {
        this._udp.addMembership(this._EL_MULTICAST_ADDRESS, netif);
      } catch (e) { }
    });
  }

  _dropMembership() {
    if (!this._join_multicast) {
      return;
    }
    let netif_list = this._getNetworkInterfaceList();
    netif_list.forEach((netif) => {
      try {
        this._udp.dropMembership(this._EL_MULTICAST_ADDRESS, netif);
      } catch (e) { }
    });
  }

  _getNetworkInterfaceList() {
    if (this._net_if_list.length !== 0) {
      return JSON.parse(JSON.stringify(this._net_if_list));
    }

    let netifs = mOs.networkInterfaces();
    let list = [];
    for (let dev in netifs) {
      netifs[dev].forEach((info) => {
        // ローカルアドレスは除外
        if (info.internal) {
          return;
        }
        // IPv4でなければ除外
        if (info.family !== 'IPv4') {
          return;
        }
        // リンクローカルアドレスは除外
        let addr = info.address;
        if (/^169\.254\./.test(addr)) {
          return;
        }
        // プライベートアドレスでなければ除外
        if (!this._isPrivateAddress(addr)) {
          return;
        }

        list.push(addr);
      });
    }
    this._net_if_list = list;
    return JSON.parse(JSON.stringify(this._net_if_list));
  }

  _isPrivateAddress(addr) {
    const cidr_list = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'];
    let included = false;
    for (let i = 0, len = cidr_list.length; i < len; i++) {
      if (this._isAddressInCidr(addr, cidr_list[i])) {
        included = true;
        break;
      }
    }
    return included;
  }

  _isAddressInCidr(addr, cidr) {
    let [netaddr, mask] = cidr.split('/');
    mask = parseInt(mask, 10);
    let host_bit_num = 32 - parseInt(mask, 10);

    let netaddr_buf = this._getAddressBuffer(netaddr);
    let netaddr_n = netaddr_buf.readUInt32BE(0) >>> host_bit_num;

    let addr_buf = this._getAddressBuffer(addr);
    let addr_n = addr_buf.readUInt32BE(0) >>> host_bit_num;

    return (netaddr_n === addr_n) ? true : false;
  }

  _getAddressBuffer(addr) {
    let buf = Buffer.alloc(4);
    addr.split('.').forEach((n, i) => {
      buf.writeUInt8(parseInt(n, 10), i);
    });
    return buf;
  }

  // ECHONET Lite パケットを受信したときの処理
  _receivePacket(buf, dev_info) {
    // 自分自身が送信したパケットは除外
    // - マルチキャスト送信だと受信してしまうため
    if (this._net_if_list.indexOf(dev_info.address) >= 0) {
      return;
    }
    // パケットデータをパース
    let packet = this._mpacket.parse(buf);
    if (!packet) {
      return;
    }

    // パケット受信イベントハンドラーを呼び出す
    this.onrecv({
      address: dev_info.address,
      hex: buf.toString('hex').toUpperCase(),
      packet: packet,
    });
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
      // 送信先アドレスをチェック
      if (address) {
        if (typeof (address) !== 'string' || !/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(address)) {
          reject(new Error('The `address` is invalid.'));
          return;
        }
      } else {
        address = this._EL_MULTICAST_ADDRESS;
      }

      // TID をチェック
      if ('tid' in packet) {
        let tid = packet.tid;
        if (typeof (tid) !== 'number' || tid % 1 !== 0) {
          reject(new Error('The `tid` is invalid.'));
          return;
        }
      } else {
        let tid = this._createTransactionId();
        // 引数の packet パケットを壊さないためにコピー
        let pkt = Object.assign({}, packet);
        pkt.tid = tid;
        packet = pkt;
      }

      // パケットを生成
      let buf = null;
      try {
        buf = this._mpacket.compose(packet);
      } catch (e) {
        reject(e);
        return;
      }

      // パケットを送信キューに追加
      this._addSendQueue({
        address: address,
        buf: buf,
        callback: (error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        }
      });
    });
  }

  _createTransactionId() {
    let tid = (this._last_tid + 1) % 0xffff;
    if (tid === 0) {
      tid = 1;
    }
    this._last_tid = tid;
    return tid;
  }

  _addSendQueue(data) {
    // 送信キューの上限をチェック
    if (this._send_queue.length >= this._SEND_QUEUE_MAX) {
      data.callback(new Error('The send queue is full.'));
      return;
    }
    // 送信キューに追加
    this._send_queue.push(data);
    // 送信処理開始
    this._sendQueuedPackets();
  }

  _sendQueuedPackets() {
    if (this._is_send_queue_processing) {
      return;
    }

    let sendPacket = async (cb) => {
      let data = this._send_queue.shift();
      if (!data) {
        cb();
        return;
      }

      let address = data.address;
      let buf = data.buf;
      let callback = data.callback;

      // 宛先がマルチキャストかどうかをチェック
      let multicast = false;
      if (address === this._EL_MULTICAST_ADDRESS) {
        multicast = true;
      }

      // 宛先がマルチキャストアドレスならマルチキャストグループからいったん外れる
      // - その場合は、マルチキャストグループから外れるのに少し時間がかかるため、
      //   送信を少し待たせる必要がある
      let wait = 0;
      if (multicast) {
        this._dropMembership();
        wait = 100;
      }

      // この時点で送信キューが空の場合、前回送信完了から所定の時間が経過して
      // いないかもしれないので、待ち時間を調整
      if (this._send_queue.length === 0) {
        let time_diff = Date.now() - this._last_sent_time;
        if (time_diff < this._SEND_INTERVAL_MSEC) {
          wait += (this._SEND_INTERVAL_MSEC - time_diff);
        }
      }

      await this._wait(wait);

      // パケット送信
      let error = null;
      try {
        if (multicast) {
          // マルチキャストの場合はすべてのネットワークインタフェースに送信する
          let if_addr_list = this._getNetworkInterfaceList();
          for (let if_addr of if_addr_list) {
            this._udp.setMulticastInterface(if_addr);
            await this._wait(100);
            await this._udpSend(buf, address);
            await this._wait(this._SEND_INTERVAL_MSEC);
          }
        } else {
          // ユニキャストの場合
          await this._udpSend(buf, address);
        }
      } catch (e) {
        error = e;
      }

      // 送信完了時間をセットする
      this._last_sent_time = Date.now();

      // 宛先がマルチキャストアドレスならマルチキャストグループに再ジョインする
      if (multicast) {
        this._addMembership();
      }

      // パケット送信イベントハンドラーを呼び出す
      this.onsent({
        address: address,
        hex: buf.toString('hex').toUpperCase(),
        packet: this._mpacket.parse(buf)
      });

      if (error) {
        callback(error);
      } else {
        callback();
      }

      await this._wait(this._SEND_INTERVAL_MSEC);
      sendPacket(cb);
    };

    this._is_send_queue_processing = true;
    sendPacket(() => {
      this._is_send_queue_processing = false;
    });
  }

  _udpSend(buf, address) {
    return new Promise((resolve, reject) => {
      this._udp.send(buf, 0, buf.length, this._EL_PORT, address, (error, bytes) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  _wait(msec) {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve();
      }, msec);
    });
  }

};

module.exports = ControllerNet;
