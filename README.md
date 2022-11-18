# kws-hems-emulator
 実証システム - HEMS エミュレータ

本資料は、ECHONET Lite 実機試験環境の HEMS エミュレーターのセットアップ方法を解説します。

## 目次

- [動作環境構築](#env)
- [設定](#conf)
- [起動方法](#start)


## <a id="env">動作環境構築</a>

Windows 11 および Raspberry OS での動作を確認しています。

- [node.js](https://nodejs.org/ja/) v16 以上
- Node モジュール
  - [websocket](https://www.npmjs.com/package/websocket)

HEMSエミュレーター本体のディレクトリ `hems-emulator` をお好きなディレクトリ内にコピーしてください。以下、`/home/pi/` 直下に `hems-emulator` ディレクトリを設置した前提で説明します。

`hems-emulator` に `cd` してください。そして、次のコマンドで必要な node モジュールをまとめてインストールしてください。

```
$ npm install
```

もし個別に node モジュールをインストールする場合は、次のコマンドを実行してください。

```
$ npm install websocket
```

## <a id="conf">設定</a>

### `config.js`

以下のように `config.default.js` を `config.js` としてコピーしてください。

```
$ cd /home/pi/hems-emulator/etc
$ cp ./config.default.js ./config.js
```

`config.js` をテキストエディタで開いてください。以下のアクセストークンの項目は必ず設定してください。

```
  /* --------------------------------------------------------------
  * アクセストークン
  * ------------------------------------------------------------ */
  "token": "5uN0QqRzns_czlx_Dn/q324LMM0/lXIHzrOleatK/Oiulg0f0hqC9+U-STNLMZsQBY.M.qwsh-nSNkD9PklA59G",
```

HEMS エミュレーターのアクセストークンは、[WebAPI サーバーの管理メニュー](https://www.smarthouse-center.org/admin/login)にて発行してください。

また、必要に応じて、アクセスコードを設定することもできます。

```
  /* --------------------------------------------------------------
  * アクセスコード
  * ------------------------------------------------------------ */
  "access_code": "1234",
```

アクセスコードとは、HEMS エミュレーターがクラウドを介してクラウド Gateway に送信する 4 桁の数値です。クラウド Gateway は自身にアクセスコードが設定されていれば、HEMS エミュレーターから送信されたアクセスコードと一致するかをチェックします。もし一致しなければ、クラウド Gateway は、その HEMS エミュレーターからのアクセスを無視します。

### `device_id.txt`

本エミュレーターが HEMS センターのどの実機をエミュレートするのかを `device_id.txt` に記述します。行末に改行を入れないでください。以下は記述例です。

```
FE00000860F189BF5F4B00000000000000
```

HEMS センター内の実機のデバイス ID は、次の curl コマンドでリストアップすることができます。(下記コマンド記述例は Raspberry Pi などの Linux を想定しています。)

```
$ curl -sSv -X GET \
  -H 'Authorization: Bearer 5uN0QqRzns_czlx_Dn/q324LMM0/lXIHzrOleatK/Oiulg0f0hqC9+U-STNLMZsQBY...' \
  https://www.smarthouse-center.org/api/v1/devicesForEmulator | jq
```

`Authorization` ヘッダーには `Bearer` の後ろにリモートサイトのアクセストークンを指定する必要があります。リモートサイトのアクセストークンは、[WebAPI サーバーの管理メニュー](https://www.smarthouse-center.org/admin/login)にて発行もしくは確認してください。

上記リクエストの応答は次のようになります。

```
{
  "devices": [
    {
      "address": "192.168.11.12",
      "id": "FE00000860F189BF5F4B00000000000000",
      "instances": [
        {
          "eoj": "0x0EF001",
          "version": "1.12",
          "manufacturer_code": "0x000008",
          "product_code": "",
          "production_number": "",
          "inf_property_map": ["0x80", "0xD5"],
          "set_property_map": ["0xBF"],
          "get_property_map": ["0x80", "0x82", "0x83", "0x89", "0x8A", "0x9D", ..., "0xD7"]
        },
        {
          "eoj": "0x013001",
          "version": "J",
          "manufacturer_code": "0x000008",
          "product_code": "",
          "production_number": "",
          "inf_property_map": ["0x80", "0x81", "0x88", "0x8F", "0xA0", "0xB0"],
          "set_property_map": ["0x80", "0x81", "0x8F", "0x93", "0xA0", "0xA3", ..., "0xC4"],
          "get_property_map": ["0x80", "0x81", "0x82", "0x83", "0x84", "0x85", ..., "0xC4"]
        }
      ]
    },
    ...
  ]
}
```

応答の内容は、上記の通り、HEMS センター内で発見されたデバイス情報のリストとなります。デバイス ID は、各デバイス情報のうち `id` の値が該当します。

## <a id="start">起動方法</a>

HEMS エミュレーターは次のように起動してください。

```
$ cd /home/pi/hems-emulator
$ node start.js --enable-debug
```

スイッチオプション `--enable-debug` を付けると、コンソールに処理内容をリアルタイムに出力します。付けなければ、コンソールには何も出力されません。

HEMS エミュレーターは次のように npm コマンドでも起動することができます。

```
$ npm start
```

これは `node start.js --enable-debug` で起動するのと同等です。


起動が完了すると、本エミュレーターはあたかも HEMS センター内の実機がそこにあるかのように振る舞います。

以上