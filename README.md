# 藝述互評

一套適合電腦及 iPad 的課堂作品互評系統：老師啟動限時上載，學生遞交圖片後，系統以伺服器時間截止並隨機分配另一位同學的作品。學生按「融合手法、剪裁比例、視覺焦點、設計圖的傳意」四個角度留下意見，可點選建議字詞並補充自己的觀察；原作者會獲得 Gemini 直接觀察原作後生成的四部分評價，並可手動生成以原作及所有文字意見為基礎的改善效果圖。老師可下載全班作品、評語來源及完整 AI 紀錄。

## 功能

- 老師建立班別、設定 1–120 分鐘上載時限（預設 15 分鐘）
- 學生以「班別代碼＋學生編號＋姓名」進入，無需電郵註冊
- 圖片預覽、iPad 相機／相片圖庫／檔案選取、大型圖片自動壓縮
- 資料庫原子化隨機分配，每人一份、不會分到自己的作品
- 四部分必填意見，各最多 2000 字；建議字詞可加入／移除，也可自由填寫
- 學生三步流程均為單欄主畫面，沒有右側欄；上載成功後，原作直接顯示在打勾符號下方
- 學生必須先遞交自己負責的四部分互評，才可解鎖收到的意見；`get_student_state` 及兩個 AI 準備函式均在伺服器端執行此限制，舊快取也會先清除未解鎖內容
- Gemini 直接分析原作圖片，按圖中證據生成四部分短點列，不是整理同學評語；黑色「有效」點列表示已有效及理想的呈現，紅色「改善」點列表示具體建議。結果保存在雲端，失敗可重試
- 原作者看完文字意見後，可確認用量並手動生成 AI 改善效果圖；圖片綜合原作、同學及 AI 四部分意見。每輪每份作品只限一張成功生成的改善圖，保存後會永久鎖定本輪生成入口；必須在下一輪重新上載、完成互評並收到新同學評價及新 AI 原作評價，才可生成下一張。只有失敗且沒有圖片保存時才可重試
- 老師即時查看加入、上載及互評進度，可提前截止或結束活動
- 學生完成所有階段後，可下載個人 ZIP：原作、改善圖、匿名同學及 AI 四部分文字、HTML 報告和 CSV；重複下載不會重新生成或增加 AI 用量
- 老師下載時當刻選擇「目前一輪」或「全部輪次」，ZIP 包含原作、已生成改善圖、HTML 報告及 CSV；保留原作者、互評來源、模型和生成時間
- 已遞交作品、階段、意見保存在 Supabase；未遞交意見草稿保存在目前瀏覽器
- 重新進入自動恢復；支援同一裝置及以相同班別／學生資料跨裝置恢復
- 響應式介面、PWA 外殼快取；離線時可讀快取頁面，但雲端同步需要網絡
- 未設定 Supabase 時提供清楚標示的本機示範，內置示例作品

## 為甚麼需要 Supabase？

GitHub Pages 只提供靜態 HTML／CSS／JavaScript，不能自己儲存全班共用的圖片和意見。本專案把網頁放在 GitHub Pages，把資料庫、計時／分配邏輯及圖片儲存放在 Supabase。前端不需要建置步驟。

## 第一次設定（約 10 分鐘）

### 1. 建立 Supabase 專案

1. 登入 [Supabase](https://supabase.com/)，建立新專案。
2. 等待專案準備完成，開啟 **SQL Editor → New query**。
3. 把本專案 `supabase-schema.sql` 整份貼上並執行。它會建立資料表、安全函式、隨機分配邏輯及 `artworks` 圖片儲存桶。
4. 到 **Connect** 或 **Project Settings → API Keys**，複製：
   - Project URL
   - `publishable` key（舊版介面的 legacy `anon` `public` key 亦可；不是 `secret` 或 `service_role` key）

### 2. 填入網頁設定

編輯 `config.js`：

```js
window.APP_CONFIG = {
  SUPABASE_URL: "https://你的專案.supabase.co",
  SUPABASE_ANON_KEY: "你的 publishable key 或 legacy anon public key",
  POLL_INTERVAL: 10000,
  MAX_IMAGE_MB: 10
};
```

`publishable key`／legacy `anon public key` 本来就是供瀏覽器使用的公開金鑰；資料表已停用直接存取，所有操作必須經過 SQL 內的權限及階段檢查。絕對不要把 `service_role` key 放進前端。

### 3. 本機測試

直接開啟 `index.html` 可體驗本機示範。若要測試雲端模式，建議在資料夾啟動靜態伺服器：

```bash
python3 -m http.server 8080
```

然後開啟 `http://localhost:8080`。

本機示範資料：

- 學生：班別代碼 `DEMO15`，學生編號及姓名可自訂
- 老師：班別代碼 `DEMO15`，PIN `1234`
- 學生上載後可按「示範：立即截止並分配」體驗完整流程

示範資料只存在目前瀏覽器，不會傳給其他學生。

### 4. 發佈到 GitHub Pages

1. 在 GitHub 建立新 repository。
2. 把本資料夾所有檔案上載到 repository 根目錄，包括 `index.html`、`app.js`、`styles.css`、`config.js` 等。
3. 開啟 **Settings → Pages**。
4. 在 **Build and deployment** 選擇 **Deploy from a branch**，分支選 `main`／根目錄 `/ (root)`，按 Save。
5. 等待 GitHub 產生網址，再把網址給老師及學生使用。

修改 `config.js` 後需要重新 commit；Supabase 設定完成前，網站會停留在本機示範模式。


### 5. 設定 Google Cloud Vertex AI 原作評價及改善圖

四題互評只需上述 Supabase SQL 即可運作；真正的 AI 原作評價及改善效果圖還需要以下後端設定。本專案使用 **Google Cloud Vertex AI**，費用由已連結的 Cloud Billing 帳戶按用量計算，不使用 AI Studio Prepay credits。文字及圖像是兩次獨立呼叫，圖像生成有額外用量，因此只會在原作者按鈕並再次確認後執行。

1. 在 Google Cloud Console 選擇要用於本網站的專案，啟用 **Vertex AI API**（`aiplatform.googleapis.com`），並確認專案已連結帳單帳戶。
2. 到 **IAM 與管理 → 服務帳戶**，建立只供本網站使用的服務帳戶，例如 `art-dialogue-gemini`。
3. 只授予該服務帳戶 **Vertex AI User**（`roles/aiplatform.user`）角色；不要授予擁有者或編輯者。
4. 為該服務帳戶建立並下載 JSON 金鑰。金鑰屬於帳戶秘密，不要貼進 `config.js`、GitHub 或對話。
5. 在 Supabase 專案的 **Edge Functions → Secrets** 加入：
   - `GOOGLE_CLOUD_PROJECT`：Google Cloud 的專案 ID（不是專案名稱或編號）
   - `GOOGLE_CLOUD_LOCATION`：`global`
   - `GOOGLE_SERVICE_ACCOUNT_JSON`：服務帳戶 JSON 金鑰的完整內容
   - `GEMINI_MODEL`：`gemini-3.5-flash-lite`（可按 Cloud 專案可用的文字模型更換）
   - `GEMINI_IMAGE_MODEL`：`gemini-3.1-flash-lite-image`（必須先確認 Cloud 專案及所選地區支援此圖像模型）
6. 以 Supabase CLI 登入後，在專案根目錄部署兩個函式：

```bash
supabase functions deploy generate-feedback --project-ref 你的專案-ref
supabase functions deploy generate-improvement-image --project-ref 你的專案-ref
```

舊版使用的 `GEMINI_API_KEY` 不再需要，可從 Supabase Secrets 刪除。若曾把舊金鑰用於其他地方，亦可在確認不再使用後到 Google Cloud Console 停用或刪除。

`supabase/config.toml` 已把 `generate-feedback` 及 `generate-improvement-image` 設為 `verify_jwt = false`，因為學生沒有 Supabase Auth 帳戶。函式會以學生 token 呼叫受限制的 SQL RPC 驗證身份，並限制允許的網站來源；若更改 GitHub Pages 網址，也要修改兩個函式頂部的 `ALLOWED_ORIGINS`。

**絕不要把服務帳戶 JSON、Supabase secret key 或 service_role key 放進前端。** 服務帳戶只會在 Supabase 後端換取短期 Google OAuth token；學生不會取得私鑰或 Google 存取權杖。AI 結果只需生成一次，之後由資料庫讀回，不會因重新整理而重複收費或佔用配額。

## 建議課堂流程

1. 老師建立班別，把班別代碼展示給學生。
2. 學生先以固定學生編號及姓名加入；老師在控制台核對名單。
3. 老師按「開始第一輪」，系統開始 15 分鐘倒數。
4. 學生上載作品。倒數完結後，任何一位學生或老師更新頁面都會觸發伺服器自動分配。
5. 學生必須完成並遞交自己負責的四部分互評，才可解鎖第三步。即使另一位同學較早評價了他的作品，系統也不會提前返回或顯示收件內容。
6. 解鎖後，待負責的同學遞交評價，原作者的單欄主畫面會顯示同學四部分意見及 AI 原作短點列：黑色為有效及理想呈現，紅色為改善建議。
7. 原作者閱讀兩組文字意見後，按「生成改善效果圖」並確認額外用量；完成後可與原作對照及下載圖片。
8. 學生完成自己負責的互評並生成改善圖後，可按「下載我的評語及改善圖」取得個人 ZIP；同學來源仍保持匿名。
9. 所有人完成後本輪自動完結；老師亦可提前結束，之後再開始新一輪。
10. 老師在學生進度上方按「下載作品及評語」，當刻選擇目前一輪或全部輪次。下載期間保持頁面開啟；若任何已記錄圖片下載失敗，系統會停止而不交付不完整 ZIP。

**至少需要兩份已上載作品才能互評。** 截止時不足兩份，本輪會直接完結，不會把自己的作品分給自己。

## 保存及私隱說明

- 已上載作品、分配結果及已遞交意見保存在 Supabase，不依賴某一部 iPad 的瀏覽器。
- 意見輸入中的草稿保存在目前瀏覽器 `localStorage`；跨裝置只能恢復已遞交內容，不能恢復另一部裝置上的未遞交草稿。
- 班別代碼＋學生編號是為簡便課堂而設的輕量身份方式，並非高安全性帳戶。請使用固定學生編號，避免學生互相代為登入。
- 作品圖片使用隨機路徑的公開讀取連結，適合一般課堂作品，不應上載敏感資料、住址或其他私隱內容。如需嚴格私密存取，應改用完整登入及簽名圖片網址。
- 老師 PIN 會保存在登入裝置以恢復控制台；請勿在公用裝置共用高權限 PIN，完成後按「離開」。
- AI 原作評價會把**作品名稱及原作圖片**傳到老師設定的 Google Cloud 專案；改善效果圖則會傳送原作圖片、作品名稱、同學四部分意見及 AI 四部分評價。兩者都不會傳送學生姓名或學生編號。AI 內容只供教學參考，老師宜提醒學生自行判斷，並避免上載含敏感個人資料的圖片。
- Gemini 暫時不可用時，同學意見仍會正常保存及顯示；原作者可稍後重試原作評價或改善圖。已生成內容會保存，重新整理不會自動重複生成。
- 正式使用前，建議老師先用兩個學生編號及兩部裝置完整測試一次。

## 檔案結構

```text
index.html              頁面入口
styles.css              響應式介面
app.js                  學生、老師、示範及雲端流程
config.js               Supabase 公開設定
supabase-schema.sql     資料表、四題互評、AI 權限及隨機分配
supabase/functions/     Gemini 原作評價及改善圖後端（不公開金鑰）
supabase/config.toml    Edge Function 設定
vendor/fflate.min.js    老師 ZIP 匯出元件（本地載入）
sw.js                   PWA 頁面外殼快取
manifest.webmanifest    加到主畫面設定
icon.svg / icon-*.png   網站圖示
```
