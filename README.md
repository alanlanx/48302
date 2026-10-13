# 48302

建中第 48 屆高三 2 班的同學會問答派對。朋友打開同一條連結，取個名字，就能一起答題。不用下載、不用註冊。

A classmates’ trivia party for Taipei Municipal Chien Kuo High School, class 48302 (48th graduating class, senior class 2, roughly 1994–1996). One shareable link, no accounts.

玩家畫面全部是繁體中文。題庫有三類：

- **要運動歐**：從同學會 LINE 群整理的綽號、梗、聚會與誰做過什麼。原始聊天記錄不會進這個專案。
- **建中回憶**：校史與校園文化，依學校公開資料核對。
- **九零年代台北**：1994–1996 的城市、新聞與流行。

## 本地執行

需要 Node.js 22 以上。

```bash
npm install
npm run dev
```

打開 [http://localhost:3000](http://localhost:3000)。

1. 輸入名字，按 **開新房間**。
2. 把畫面上的連結貼給另一個瀏覽器（或同一台的無痕視窗）。
3. 第二個人輸入名字加入。
4. 房主按 **開始遊戲**。十二題、每題 20 秒，答對 1000 分，越快最多再加 500。
5. 打完可 **再來一局**，房間代碼不變。

本月排行榜在 [http://localhost:3000/leaderboard](http://localhost:3000/leaderboard)。分數依顯示名稱累計，月份用 **Asia/Taipei**（台灣沒有日光節約時間，固定 UTC+8）。每個月 1 日 00:00 自動換榜，上月前五名仍看得到。重新整理房間頁可以回到同一局。

其他指令：

```bash
npm test
npm run build
npm start
```

`npm start` 要先建置。正式環境一樣是一個 Node 行程，同時負責網頁與即時連線。

## 公開連結：你要做的事

這個遊戲用一條長連線把所有人同步，所以要部署在 **會一直開著的 Node 伺服器**，不能丟上只跑 serverless 函式的主機（例如只放靜態檔的 Vercel 專案）。不需要資料庫帳號，也不需要 API 金鑰。

請維持 **一個實例**。開兩台的話，房間記憶不會互通。

### Render（建議，用滑鼠點完）

1. 到 [render.com](https://render.com) 用 GitHub 登入。
2. **New +** → **Web Service**，選這個 repo `alanlanx/48302`，分支用已經合併的 `main`。
3. 設定：
   - Runtime：**Node**
   - Build Command：`npm install && npm run build`
   - Start Command：`npm start`
   - Instance：一台就好（不要自動擴成多台）
4. **Environment**：
   - `NODE_ENV` = `production`（Render 通常會自己設）
   - `DATA_DIR` = `/var/data`
5. **Disks**：Add disk，掛載路徑 `/var/data`，1 GB 就夠。沒有這塊碟，容器一重開，本月排行榜會歸零；房間本來就只活在記憶體裡，重開本來就會清掉。
6. 按 **Deploy**。完成後打開 `https://<你的服務>.onrender.com`。
7. 開一間房間，複製連結，丟進「要運動歐」。

健康檢查路徑是 `/healthz`。

### Railway

1. [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub** → 選這個 repo。
2. Settings 確認 build 會跑 `npm run build`、start 是 `npm start`（看得到 `package.json` 的話通常會自動對上）。
3. Variables 加 `DATA_DIR=/data`。
4. 加一個 Volume，掛在 `/data`。
5. Settings → Networking → **Generate Domain**。
6. 一樣只留一個 replica。

### Docker

```bash
docker build -t 48302 .
docker run --rm -p 3000:3000 -e DATA_DIR=/data -v 48302-data:/data 48302
```

## 環境變數

| 變數 | 預設 | 用途 |
| --- | --- | --- |
| `PORT` | `3000` | 連接埠。Render / Railway 會自己帶。 |
| `DATA_DIR` | `./data` | 排行榜 JSON 的目錄。正式環境請指到持久磁碟。 |
| `NODE_ENV` | `development`（`npm run dev`） | 正式環境用 `production`。 |
| `QUESTION_MS` | `20000` | 每題毫秒數。只在自己試玩時要縮短才改。 |
| `REVEAL_MS` | `8000` | 揭曉停留時間。 |
| `QUESTIONS_PER_GAME` | `12` | 每一局題數，8 題「要運動歐」、2 題建中、2 題九零年代，不夠就從題庫補。 |

沒有第三方金鑰。

## 題目從哪來

LINE 題是從群組「要運動歐」的對話裡挑出的綽號、聚會、分數梗與誰做過什麼，寫成四選一，並附一句短解析。沒有放電話、地址、金額、健康資料，也沒有把原始聊天記錄提交進 repo。

建中題依學校沿革（創校 1898、南海路 56 號、校訓勤樸誠勇、校慶 12 月 6 日、紅樓、校歌、黑衫軍等）。九零年代題涵蓋木柵線、1994 市長直選、1996 總統直選、PTT、超級星期天、伍佰與當時的街頭。

重新整理頁面或用同一個代碼進來，會用瀏覽器裡記住的名字回到同一個人。排行榜則把同一個顯示名稱（忽略英文大小寫與多餘空白）在該月加總。
