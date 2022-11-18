/* ------------------------------------------------------------------
* hems-emulator - emulator/emulator-packet.js
* - ECHONET Lite パケットのパースと生成
* ---------------------------------------------------------------- */
'use strict';

class EmulatorPacket {
  /* ------------------------------------------------------------------
  * コンストラクタ
  * 
  * [引数]
  * - なし
  * ---------------------------------------------------------------- */
  constructor() {
    // ESV の 16 進数と意味の対応
    this._esv_name_code_map = {
      'SETI': 0x60,
      'SETC': 0x61,
      'GET': 0x62,
      'INF_REQ': 0x63,
      'SETGET': 0x6E,
      'SET_RES': 0x71,
      'GET_RES': 0x72,
      'INF': 0x73,
      'INFC': 0x74,
      'INFC_RES': 0x7A,
      'SETGET_RES': 0x7E,
      'SETI_SNA': 0x50,
      'SETC_SNA': 0x51,
      'GET_SNA': 0x52,
      'INF_SNA': 0x53,
      'SETGET_SNA': 0x5E
    };
  }

  /* ------------------------------------------------------------------
  * parse()
  * - 受信パケットの Buffer オブジェクトをパース
  * 
  * [引数]
  * - buf   | Buffer | Required | ECHONET Lite パケットを表す Buffer オブジェクト
  * 
  * [戻値]
  * - パースに失敗したら null を返す
  * - パースに成功したら結果を格納したオブジェクトを返す
  * 
  * {
  *   tid: 1,
  *   seoj: "0x013001",
  *   deoj: "0x05FF01",
  *   esv: "0x72",
  *   operations: [
  *     {
  *       epc: "0x80",
  *       edt: ["0x31"]
  *     }
  *   ]
  * }
  * 
  * ESV が SetGet 系なら operations2 が追加される
  * 
  * {
  *   tid: 1,
  *   seoj: "0x013001",
  *   deoj: "0x05FF01",
  *   esv: "0x7E",
  *   operations: [
  *     {
  *       epc: "0x80",
  *       edt: [...]
  *     }
  *   ],
  *   operations2: [
  *     {
  *       epc: "0x80",
  *       edt: [...]
  *     }
  *   ]
  * }
  * ---------------------------------------------------------------- */
  parse(buf) {
    let data = {};

    // パケットのサイズをチェック
    if (buf.length < 12) {
      return null;
    }

    // EHD1
    let ehd1_buf = buf.slice(0, 1);
    let ehd1_value = ehd1_buf.readUInt8(0);
    if (ehd1_value !== 0b00010000) {
      return null;
    }

    // EHD2
    let ehd2_buf = buf.slice(1, 2);
    let ehd2_value = ehd2_buf.readUInt8(0);
    if (ehd2_value !== 0x81) {
      return null;
    }

    // TID
    let tid_buf = buf.slice(2, 4);
    data.tid = tid_buf.readUInt16BE(0);

    // SEOJ
    let seoj_buf = buf.slice(4, 7);
    data.seoj = '0x' + seoj_buf.toString('hex').toUpperCase();

    // DEOJ
    let deoj_buf = buf.slice(7, 10);
    data.deoj = '0x' + deoj_buf.toString('hex').toUpperCase();

    // ESV
    let esv_buf = buf.slice(10, 11);
    let esv_hex = esv_buf.toString('hex').toUpperCase();
    data.esv = '0x' + esv_hex;

    // OPC とプロパティ
    let pparsed = this._parseOpcProps(buf.slice(11));
    if (!pparsed) {
      return null;
    }
    data.operations = pparsed.operations;


    // ESV が SetGet 系なら追加の Buffer が残っているはず
    if (pparsed.remain_buf) {
      if (/^(6E|7E|5E)$/.test(esv_hex)) {
        let pparsed2 = this._parseOpcProps(pparsed.remain_buf);
        if (!pparsed2) {
          return null;
        }
        data.operations2 = pparsed2.operations;
      }
    }

    return data;
  }

  _parseOpcProps(buf) {
    let data = {
      opc: 0,
      operations: [],
      remain: null
    };

    // OPC
    let opc_buf = buf.slice(0, 1);
    let opc_value = opc_buf.readUInt8(0);
    data.opc = opc_value;

    let offset = 1;
    let fail = false;

    for (let i = 0; i < opc_value; i++) {
      // EPC
      if (buf.length < offset + 1) {
        fail = true;
        break;
      }
      let epc_buf = buf.slice(offset, offset + 1);
      let epc_hex = epc_buf.toString('hex').toUpperCase();
      offset += 1;

      // PDC
      if (buf.length < offset + 1) {
        fail = true;
        break;
      }

      let pdc_buf = buf.slice(offset, offset + 1);
      let pdc_value = pdc_buf.readUInt8(0);
      offset += 1;
      if (buf.length < offset + pdc_value) {
        fail = true;
        break;
      }

      // EDT
      let edt_buf = null;
      let edt_byte_list = [];
      if (pdc_value > 0) {
        edt_buf = buf.slice(offset, offset + pdc_value);
        for (let i = 0; i < edt_buf.length; i++) {
          let hex = edt_buf.slice(i, i + 1).toString('hex').toUpperCase();
          edt_byte_list.push('0x' + hex);
        }
        offset += pdc_value;
      }
      data.operations.push({
        epc: '0x' + epc_hex,
        edt: edt_byte_list
      });
    }

    if (fail) {
      return null;
    }

    if (buf.length > offset) {
      data.remain = buf.slice(offset);
    }

    return data;
  }

  /* ------------------------------------------------------------------
  * compose(packet)
  * - ECHONET Lite パケットを表す Buffer オブジェクトを生成
  * 
  * [引数]
  * - packet        | Object  | Required |
  *   - tid         | Integer | Required | TID
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
  * - 生成に失敗したら Exception を throw する
  * - 生成に成功したら Buffer オブジェクトを返す
  * ---------------------------------------------------------------- */
  compose(packet) {
    let buf_list = [];

    // EHD1, EHD2
    let ehd_buf = Buffer.from([0x10, 0x81]);
    buf_list.push(ehd_buf);

    // TID
    let tid = packet.tid;
    if (typeof (tid) !== 'number' || tid % 1 !== 0) {
      throw new Error('The `tid` must be an integer.');
    } else if (tid < 0 || tid > 0xffff) {
      throw new Error('The `tid` must be an integer between 0 and 0xffff.');
    }
    let tid_buf = Buffer.alloc(2);
    tid_buf.writeUInt16BE(tid, 0);
    buf_list.push(tid_buf);

    // SEOJ
    let seoj = packet.seoj;
    if (!seoj || typeof (seoj) !== 'string') {
      throw new Error('The `seoj` is invalid.');
    }
    seoj = seoj.replace(/^0x/i, '');
    if (!/^[a-fA-F0-9]{6}$/.test(seoj)) {
      throw new Error('The `seoj` is invalid.');
    }
    let seoj_buf = this._convHexToBuffer(seoj);
    buf_list.push(seoj_buf);

    // DEOJ
    let deoj = packet.deoj;
    if (!deoj || typeof (deoj) !== 'string') {
      throw new Error('The `deoj` is invalid.');
    }
    deoj = deoj.replace(/^0x/i, '');
    if (!/^[a-fA-F0-9]{6}$/.test(deoj)) {
      throw new Error('The `deoj` is invalid.');
    }
    let deoj_buf = this._convHexToBuffer(deoj);
    buf_list.push(deoj_buf);

    // ESV
    let esv_name = packet.esv;
    if (typeof (esv_name) !== 'string') {
      throw new Error('The `esv` must be a keyword representing an ESV.');
    }
    let esv = 0;
    esv_name = esv_name.replace(/^0x/i, '');
    esv_name = esv_name.toUpperCase();
    if (/^[0-9A-F]{2}$/.test(esv_name)) {
      esv = parseInt(esv_name, 16);
    } else if (/^[A-Z\_]+$/.text(esv_name)) {
      if (this._esv_name_code_map[esv_name]) {
        esv = this._esv_name_code_map[esv_name];
      } else {
        throw new Error('The `esv` is unknown.');
      }
    } else {
      throw new Error('The `esv` is invalid.');
    }
    let esv_buf = Buffer.from([esv]);
    buf_list.push(esv_buf);

    // OPC とプロパティ (ESV が SETGET_SNA の場合)
    if (esv_name === 'SETGET_SNA') {
      let opc_buf = Buffer.from([0x00, 0x00]);
      buf_list.push(opc_buf);
      let buf = Buffer.concat(buf_list);
      return buf;
    }

    // OPC とプロパティ (ESV が SETGET_SNA でない場合)
    let operations = packet.operations;
    if (!operations || !Array.isArray(operations) || operations.length === 0) {
      throw new Error('The `operations` is invalid.');
    }
    let operations_list = [operations];

    if (esv === 0x6E || esv === 0x7E) { // SETGET or SETGET_RES
      let operations2 = packet.operations2;
      if (!operations2 || !Array.isArray(operations2) || operations2.length === 0) {
        throw new Error('The `operations2` is invalid.');
      }
      operations_list.push(operations2);
    }

    operations_list.forEach((operations) => {
      let opc_buf = Buffer.from([operations.length]);
      buf_list.push(opc_buf);

      operations.forEach((operation) => {
        let epc = operation.epc;
        if (typeof (epc) !== 'string') {
          throw new Error('The `epc` is invalid.');
        }
        epc = epc.replace(/^0x/, '');
        if (!/^[0-9A-Fa-f]{2}$/.test(epc)) {
          throw new Error('The `epc` is invalid.');
        }
        let epc_buf = this._convHexToBuffer(epc);
        if (!epc_buf) {
          throw new Error('The `epc` is invalid.');
        }
        buf_list.push(epc_buf);

        let edt_buf = null;
        if (operation.edt) {
          if (Buffer.isBuffer(operation.edt)) {
            edt_buf = operation.edt;
          } else if (Array.isArray(operation.edt)) {
            let byte_list = [];
            for (let byte of operation.edt) {
              if (typeof (byte) === 'string') {
                byte = byte.replace(/^0x/i, '');
                if (!/^[0-9A-F]{2}/i.test(byte)) {
                  throw new Error('The `edt` is invalid.');
                }
                byte = parseInt(byte, 16);
                byte_list.push(byte);
              } else if (typeof (byte) === 'number' && byte % 1 === 0 && byte >= 0 && byte <= 255) {
                byte_list.push(byte);
              } else {
                throw new Error('The `edt` is invalid.');
              }
            }
            edt_buf = Buffer.from(byte_list);
          } else if (typeof (operation.edt) === 'string') {
            edt_buf = this._convHexToBuffer(operation.edt);
            if (!edt_buf) {
              throw new Error('The `edt` is invalid.');
            }
          } else {
            throw new Error('The `edt` is invalid.');
          }
        }
        if (edt_buf) {
          let pdc_buf = Buffer.from([edt_buf.length]);
          buf_list.push(pdc_buf, edt_buf);
        } else {
          let pdc_buf = Buffer.from([0x00]);
          buf_list.push(pdc_buf);
        }
      });
    });

    let buf = Buffer.concat(buf_list);
    return buf;
  }

  /* ------------------------------------------------------------------
  * _convHexToBuffer(hex)
  * - 16進数文字列を Buffer オブジェクトに変換
  * 
  * [引数]
  * - hex  | String | Required | 16進数文字列 (例 "0EF001")
  * 
  * [戻値]
  * - Buffer オブジェクト
  * - 変換に失敗したら null を返す
  * ---------------------------------------------------------------- */
  _convHexToBuffer(hex) {
    if (!hex || typeof (hex) !== 'string' || !/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) {
      return null;
    }
    let byte_num = hex.length / 2;
    let num_list = [];
    for (let i = 0; i < byte_num; i++) {
      let n = parseInt(hex.substr(i * 2, 2), 16);
      num_list.push(n);
    }
    let buf = Buffer.from(num_list);
    return buf;
  }
}

module.exports = EmulatorPacket;
