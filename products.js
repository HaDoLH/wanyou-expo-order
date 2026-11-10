/* =========================================================
   商品資料與活動設定
   ---------------------------------------------------------
   👉 換展覽、改價格時，只要改這個檔案就好，其他檔案不用動。
   價格都是「每公斤」的單價（跟紙本目錄一樣）。
   ========================================================= */

/* ---------- 展覽資訊（會印在訂單上） ---------- */
const EXPO = {
  title: '萬友咖啡 2026 台北咖啡展 訂購單',
  shortName: '2026 台北咖啡展',
};

/* ---------- 展期（訂單日期只能選這幾天） ----------
   展期當天打開會自動選今天；不在展期內就預設第一天 */
const EXPO_DATES = ['2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16'];

/* ---------- 運費規則 ---------- */
const SHIPPING = {
  freeKg: 20,   // 滿 20KG 免運
  fee: 120,     // 未滿收 120 元
};

/* ---------- 滿額贈（金額由小到大排，只送達到的最高一檔） ---------- */
const GIFT_TIERS = [
  { min: 8800,  name: '迷你收納包 ×1' },
  { min: 15000, name: '杜邦紙購物袋 ×1' },
  { min: 30000, name: '$1,000 現金抵用券（$500×2）' },
  { min: 50000, name: '$3,000 現金抵用券（$500×6）' },
];

/* ---------- 訂購詳閱（印在訂單最下面） ---------- */
const TERMS = [
  '滿 20KG 免運；未達加收運費 NT$120',
  '報價含稅，貨款於現場結清；發票／單據將於展後出貨時隨貨附上',
  '商品於展後 7 個工作天內出貨（不含例假日）',
  '滿額贈品已於2026南港咖啡展現場贈送',
];

/* ---------- 付款方式選項 ----------
   最後一個「其他」＝內部代表匯款（不想讓客人在畫面上看到「匯款」兩個字）；
   點了會出現輸入框，可以自己寫付款資訊（選填） */
const PAYMENT_METHODS = ['現金', '刷卡', 'LINE Pay', '其他'];

/* ---------- 經手人員（下拉選單，會記住上次選的人） ----------
   選單最後會自動多一個「其他（自行輸入）」，名單上沒有的人可以自己打名字 */
const STAFF = ['敬捷', '右萱', '小哈', '燿華', '家旻', '工讀生'];

/* ---------- 雲端上傳設定（第 4 步部署 Apps Script 後填入） ---------- */
const UPLOAD = {
  url: '',   // Apps Script 網頁應用程式網址，留空 = 先不上傳
  key: 'wy-h4rq0vzj831k',   // 通關碼，要跟 Code.gs 裡的一樣
};

/* =========================================================
   商品清單
   ---------------------------------------------------------
   id      品號（8 碼，跟結帳系統對應用，畫面不顯示）
   code    生豆代碼（ET037…，畫面與訂單顯示這個；沒填就顯示品號）
   group   下拉選單裡的分組
   name    品名
   p5      5KG 單價（每公斤）
   pBag    整袋/箱單價（每公斤）
           數字   = 有整袋價
           null   = 沒有整袋價，全部用 5KG 單價
           'quote'= 業務報價，整袋單價要工作人員手動填
   bagKg   一整袋/箱是幾公斤
   bagUnit 袋 或 箱
   packs   高單價小包裝：不用公斤數，改選包裝＋數量（價格是「每包／每盒」）
           例 { label:'500公克', kg:0.5, price:525, unit:'包' }，kg 用來算總重與免運
   ========================================================= */
const PRODUCTS = [
  // ---- 中美洲 ----
  { id: '21015962', code: 'CR001', group: '中美洲', name: '哥斯大黎加 塔拉珠 聖母 水洗', p5: 390, pBag: 380, bagKg: 30, bagUnit: '袋' },
  { id: '21070943', code: 'PM025', group: '中美洲', name: '巴拿馬 CCD計畫 Los Pozos 小農藝妓 日曬 Lot2', p5: 1580, pBag: 1550, bagKg: 25, bagUnit: '箱' },
  { id: '21040851', code: 'PM022', group: '中美洲', name: '巴拿馬 微光秘密系列 愛德華 小農藝妓 水洗 SHB EP', p5: 860, pBag: 850, bagKg: 30, bagUnit: '箱' },
  { id: '21080436', code: 'NR003', group: '中美洲', name: '尼加拉瓜 新塞哥維亞 守望者 Maragoype 象豆 水洗 SHG', p5: 500, pBag: 430, bagKg: 30, bagUnit: '袋' },

  // ---- 南美洲 ----
  { id: '21090153', code: 'BV001', group: '南美洲', name: '玻利維亞 伊莎貝爾莊園 羅沙里歐 藝妓 水洗', p5: 1900, pBag: 1870, bagKg: 20, bagUnit: '箱' },
  { id: '21040880', code: 'CB005', group: '南美洲', name: '哥倫比亞 小飛象 水洗', p5: 390, pBag: 350, bagKg: 35, bagUnit: '袋' },
  { id: '21040879', code: 'CB018', group: '南美洲', name: '哥倫比亞 黑武士 厭氧日曬', p5: 510, pBag: 470, bagKg: 35, bagUnit: '袋' },
  { id: '21040860', code: 'CB019', group: '南美洲', name: '哥倫比亞 綠翡翠 薇拉產區 Supremo 水洗', p5: 380, pBag: 340, bagKg: 35, bagUnit: '袋' },

  // ---- 非洲 ----
  { id: '21080445', code: 'ET041', group: '非洲', name: '衣索比亞 神燈系列 谷吉 香妃 水洗 G1', p5: 470, pBag: 460, bagKg: 30, bagUnit: '袋' },
  { id: '21080461', code: 'ET052', group: '非洲', name: '衣索比亞 谷吉 姬格薩處理廠 水洗 G1', p5: 470, pBag: 460, bagKg: 30, bagUnit: '袋' },
  { id: '21080462', code: 'ET053', group: '非洲', name: '衣索比亞 西達馬 班莎 聖塔維 水洗 G1', p5: 470, pBag: 460, bagKg: 30, bagUnit: '袋' },
  { id: '21080483', code: 'ET037', group: '非洲', name: '衣索比亞 谷吉 烏拉嘎 風信子 水洗 G1', p5: 500, pBag: 460, bagKg: 30, bagUnit: '袋' },
  { id: '21080481', code: 'ET020', group: '非洲', name: '衣索比亞 西達馬 班莎 龐貝 日曬 G1', p5: 490, pBag: 480, bagKg: 30, bagUnit: '袋' },
  { id: '21080485', code: 'ET054', group: '非洲', name: '衣索比亞 谷吉 烏拉嘎 風信子 日曬 G1', p5: 520, pBag: 480, bagKg: 30, bagUnit: '袋' },
  { id: '21080447', code: 'ET050', group: '非洲', name: '衣索比亞 卡法 艾玫夏梅塔處理廠 水洗 TOP G2', p5: 420, pBag: 410, bagKg: 30, bagUnit: '袋' },
  { id: '21040869', code: 'KY022', group: '非洲', name: '肯亞 麒麟雅加 加古悠處理廠 AA TOP 水洗', p5: 480, pBag: 470, bagKg: 30, bagUnit: '箱' },
  { id: '21040870', code: 'KY023', group: '非洲', name: '肯亞 涅里 迪麥處理廠 AA TOP 水洗', p5: 480, pBag: 470, bagKg: 30, bagUnit: '箱' },
  { id: '21040871', code: 'KY024', group: '非洲', name: '肯亞 麒麟雅加 奇里處理廠 AA TOP 水洗', p5: 480, pBag: 470, bagKg: 30, bagUnit: '箱' },
  { id: '21040875', code: 'KY025', group: '非洲', name: '肯亞 涅里 加查薩處理廠 AA TOP 水洗', p5: 470, pBag: 460, bagKg: 30, bagUnit: '箱' },
  { id: '21040863', code: 'KY026', group: '非洲', name: '肯亞 穆拉加 恩迪亞處理廠 PB TOP 水洗', p5: 460, pBag: 450, bagKg: 30, bagUnit: '箱' },
  { id: '21040872', code: 'KY027', group: '非洲', name: '肯亞 麒麟雅加 奇異處理廠 PB TOP 水洗', p5: 460, pBag: 450, bagKg: 30, bagUnit: '箱' },
  { id: '21040876', code: 'KY006', group: '非洲', name: '肯亞 AA FAQ 水洗', p5: 390, pBag: 350, bagKg: 30, bagUnit: '袋' },
  { id: '21040877', code: 'KY028', group: '非洲', name: '肯亞 精選C 水洗', p5: 360, pBag: 320, bagKg: 30, bagUnit: '袋' },
  { id: '21050149', code: 'UG001', group: '非洲', name: '烏干達 卡坦達 月亮山 AB 水洗', p5: 380, pBag: 340, bagKg: 30, bagUnit: '袋' },

  // ---- 海島・其他 ----
  { id: '21080472', code: 'IS001', group: '海島・其他', name: '印尼 曼特寧 G1 TP', p5: 420, pBag: 'quote', bagKg: 30, bagUnit: '袋' },
  { id: '21050141', code: 'IS003', group: '海島・其他', name: '印尼 瓦哈娜莊園 拉蘇娜 日曬', p5: 530, pBag: 520, bagKg: 30, bagUnit: '箱' },
  { id: '21080473', code: 'IS002', group: '海島・其他', name: '印尼 蘇門達臘 林東 托巴湖 藍眼 曼特寧 G1 TP', p5: 420, pBag: 410, bagKg: 30, bagUnit: '袋' },

  // ---- 高單價（小包裝） ----
  { id: '21080475', code: 'ET057', group: '高單價（小包裝）', name: '衣索比亞 迷霧山谷系列 晨曦 日曬 Premium 微批次', packs: [{ label: '1KG真空', kg: 1, price: 900, unit: '包' }, { label: '500公克', kg: 0.5, price: 525, unit: '包' }] },
  { id: '21080476', code: 'ET058', group: '高單價（小包裝）', name: '衣索比亞 迷霧山谷系列 瑰色 黑蜜 Premium 微批次', packs: [{ label: '1KG真空', kg: 1, price: 1450, unit: '包' }, { label: '500公克', kg: 0.5, price: 800, unit: '包' }] },
  { id: '21080477', code: 'ET059', group: '高單價（小包裝）', name: '衣索比亞 迷霧山谷系列 雲境 黃蜜 Premium 微批次', packs: [{ label: '1KG真空', kg: 1, price: 1150, unit: '包' }, { label: '500公克', kg: 0.5, price: 650, unit: '包' }] },
  { id: '21080478', code: 'ET060', group: '高單價（小包裝）', name: '衣索比亞 迷霧山谷系列 斑斕 日曬 Premium 微批次', packs: [{ label: '1KG真空', kg: 1, price: 1900, unit: '包' }, { label: '500公克', kg: 0.5, price: 1000, unit: '包' }] },
  { id: '21080479', code: 'ET061', group: '高單價（小包裝）', name: '衣索比亞 迷霧山谷系列 日花 厭氧日曬 Premium 微批次', packs: [{ label: '1KG真空', kg: 1, price: 1250, unit: '包' }, { label: '500公克', kg: 0.5, price: 700, unit: '包' }] },
  { id: '21080480', code: 'ET062', group: '高單價（小包裝）', name: '衣索比亞 迷霧山谷系列 澄霞 厭氧日曬 Premium 微批次', packs: [{ label: '1KG真空', kg: 1, price: 1150, unit: '包' }, { label: '500公克', kg: 0.5, price: 650, unit: '包' }] },
  { id: '21090147', code: 'BV004', group: '高單價（小包裝）', name: '玻利維亞 伊莎貝爾莊園 競標批次 藝妓 水洗 #Tunki ISA03', packs: [{ label: '250公克', kg: 0.25, price: 3100, unit: '盒' }] },
  { id: '21090157', code: 'UK001', group: '高單價（小包裝）', name: '英國 聖海倫娜 樹籬竹木莊園 水洗', packs: [{ label: '500公克', kg: 0.5, price: 2660, unit: '盒' }] },

  // ---- 水果特調 ----
  { id: '21015970', code: 'CB042', group: '水果特調', name: '哥倫比亞 水果特調系列 蜜瓜莫西托 Melon Mojito', p5: 480, pBag: 470, bagKg: 30, bagUnit: '箱' },
  { id: '21015971', code: 'CB043', group: '水果特調', name: '哥倫比亞 水果特調系列 百香果莫西托 Passionfruit Mojito', p5: 480, pBag: 470, bagKg: 30, bagUnit: '箱' },
  { id: '21015972', code: 'CB044', group: '水果特調', name: '哥倫比亞 水果特調系列 草莓莫西托 Strawberry Mojito', p5: 480, pBag: 470, bagKg: 30, bagUnit: '箱' },
  { id: '21015973', code: 'CB045', group: '水果特調', name: '哥倫比亞 水果特調系列 櫻桃莫西托 Cherry Mojito', p5: 480, pBag: 470, bagKg: 30, bagUnit: '箱' },
  { id: '21015974', code: 'CB046', group: '水果特調', name: '哥倫比亞 水果特調系列 藍莓莫西托 Blueberry Mojito', p5: 480, pBag: 470, bagKg: 30, bagUnit: '箱' },
];
