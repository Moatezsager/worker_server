export function renderDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>لوحة تحكم خادم العمليات | LYD Worker Hub</title>
  <style>
    /* ─── RESET & BASE CSS (100% Standalone - Zero Dependencies) ─── */
    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      -webkit-tap-highlight-color: transparent;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans Arabic", "Cairo", sans-serif;
      background-color: #0f172a;
      color: #f1f5f9;
      font-size: 14px;
      line-height: 1.5;
      padding-bottom: 30px;
    }

    .font-num {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      font-variant-numeric: tabular-nums;
      direction: ltr;
      display: inline-block;
    }

    .container {
      max-width: 900px;
      margin: 0 auto;
      padding: 12px 14px;
    }

    /* ─── HEADER BAR ─── */
    .header {
      background: #1e293b;
      border-bottom: 1px solid #334155;
      padding: 12px 14px;
      position: sticky;
      top: 0;
      z-index: 100;
      box-shadow: 0 4px 6px -1px rgba(0,0,0,0.3);
    }
    .header-content {
      max-width: 900px;
      margin: 0 auto;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
    }
    .brand-title {
      font-size: 16px;
      font-weight: 700;
      color: #ffffff;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .status-badge {
      font-size: 11px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 9999px;
      background: rgba(16, 185, 129, 0.15);
      color: #10b981;
      border: 1px solid rgba(16, 185, 129, 0.3);
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .header-actions {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    /* ─── BUTTONS ─── */
    button, .btn {
      font-family: inherit;
      font-size: 13px;
      font-weight: 600;
      padding: 8px 12px;
      border-radius: 8px;
      border: 1px solid transparent;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      transition: all 0.15s ease;
      touch-action: manipulation;
    }
    button:active, .btn:active {
      transform: scale(0.97);
    }
    .btn-primary {
      background: #10b981;
      color: #ffffff;
      border-color: #059669;
    }
    .btn-primary:hover {
      background: #059669;
    }
    .btn-secondary {
      background: #334155;
      color: #f8fafc;
      border-color: #475569;
    }
    .btn-secondary:hover {
      background: #475569;
    }
    .btn-action {
      background: #1e293b;
      color: #e2e8f0;
      border: 1px solid #334155;
      padding: 10px 12px;
      font-size: 13px;
      width: 100%;
      text-align: center;
    }
    .btn-action:hover {
      background: #334155;
      border-color: #475569;
    }
    .btn-sm {
      padding: 4px 8px;
      font-size: 11px;
    }

    /* ─── QUICK STATUS CARDS ─── */
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 8px;
      margin-bottom: 14px;
    }
    @media (min-width: 640px) {
      .kpi-grid {
        grid-template-columns: repeat(4, 1fr);
      }
    }
    .kpi-card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 10px;
      padding: 10px 12px;
    }
    .kpi-title {
      font-size: 11px;
      color: #94a3b8;
      margin-bottom: 4px;
    }
    .kpi-val {
      font-size: 16px;
      font-weight: 700;
      color: #ffffff;
    }
    .kpi-sub {
      font-size: 11px;
      color: #64748b;
      margin-top: 2px;
    }

    /* ─── ACTION BUTTONS GRID ─── */
    .actions-box {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 12px;
      margin-bottom: 14px;
    }
    .box-title {
      font-size: 13px;
      font-weight: 700;
      color: #38bdf8;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .actions-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 8px;
    }
    @media (min-width: 640px) {
      .actions-grid {
        grid-template-columns: repeat(3, 1fr);
      }
    }

    /* ─── TABS ─── */
    .tabs-nav {
      display: flex;
      overflow-x: auto;
      gap: 6px;
      padding-bottom: 6px;
      margin-bottom: 12px;
      border-bottom: 1px solid #334155;
    }
    .tab-item {
      padding: 8px 12px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 600;
      color: #94a3b8;
      background: #1e293b;
      border: 1px solid #334155;
      white-space: nowrap;
      cursor: pointer;
    }
    .tab-item.active {
      background: #10b981;
      color: #ffffff;
      border-color: #059669;
    }

    /* ─── RATES CARDS & LIST ─── */
    .rates-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 8px;
      margin-bottom: 14px;
    }
    @media (min-width: 640px) {
      .rates-grid {
        grid-template-columns: repeat(3, 1fr);
      }
    }
    .rate-card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 10px;
      padding: 10px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 6px;
      position: relative;
    }
    .rate-card:active {
      border-color: #10b981;
    }
    .rate-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .rate-name {
      font-size: 12px;
      font-weight: 700;
      color: #f8fafc;
    }
    .rate-code {
      font-size: 10px;
      color: #94a3b8;
      font-family: monospace;
      text-transform: uppercase;
    }
    .rate-price {
      font-size: 18px;
      font-weight: 800;
      color: #10b981;
    }
    .rate-card.gold .rate-price {
      color: #fbbf24;
    }
    .rate-btn-edit {
      font-size: 11px;
      padding: 4px;
      background: #334155;
      color: #cbd5e1;
      border-radius: 6px;
      border: none;
      width: 100%;
      text-align: center;
      margin-top: 4px;
    }

    /* ─── JOBS LIST ─── */
    .job-card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 10px;
      padding: 10px 12px;
      margin-bottom: 8px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
    }
    .job-info {
      flex: 1;
    }
    .job-name {
      font-size: 12px;
      font-weight: 700;
      color: #f1f5f9;
      margin-bottom: 2px;
    }
    .job-meta {
      font-size: 11px;
      color: #94a3b8;
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    /* ─── BROADCAST BOX ─── */
    .broadcast-card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 12px;
      margin-bottom: 14px;
    }
    textarea {
      width: 100%;
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 8px;
      color: #f8fafc;
      padding: 10px;
      font-size: 13px;
      font-family: inherit;
      resize: vertical;
      min-height: 80px;
      margin-bottom: 8px;
    }
    textarea:focus {
      outline: none;
      border-color: #10b981;
    }

    /* ─── LOGS BOX ─── */
    .logs-container {
      background: #020617;
      border: 1px solid #334155;
      border-radius: 10px;
      padding: 10px;
      font-family: monospace;
      font-size: 11px;
      height: 380px;
      overflow-y: auto;
      color: #cbd5e1;
    }
    .log-row {
      padding: 3px 0;
      border-bottom: 1px solid rgba(51, 65, 85, 0.4);
      display: flex;
      gap: 6px;
      word-break: break-all;
    }
    .log-error { color: #f87171; font-weight: bold; }
    .log-warn { color: #fbbf24; font-weight: bold; }
    .log-success { color: #34d399; font-weight: bold; }
    .log-info { color: #38bdf8; }

    /* ─── MODAL ─── */
    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.75);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      z-index: 999;
    }
    .modal-box {
      background: #1e293b;
      border: 1px solid #475569;
      border-radius: 12px;
      max-width: 360px;
      width: 100%;
      padding: 16px;
      box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5);
    }
    .modal-input {
      width: 100%;
      background: #0f172a;
      border: 1px solid #475569;
      border-radius: 8px;
      color: #10b981;
      font-size: 20px;
      font-weight: 700;
      padding: 8px 12px;
      font-family: monospace;
      margin: 8px 0 14px 0;
    }

    /* ─── TOAST ─── */
    .toast-box {
      position: fixed;
      bottom: 16px;
      left: 16px;
      right: 16px;
      max-width: 360px;
      margin: 0 auto;
      background: #1e293b;
      border: 1px solid #10b981;
      color: #ffffff;
      padding: 10px 14px;
      border-radius: 10px;
      box-shadow: 0 10px 15px -3px rgba(0,0,0,0.5);
      font-size: 12px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 8px;
      z-index: 1000;
      transition: all 0.3s ease;
    }

    .hidden { display: none !important; }
  </style>
</head>
<body>

  <!-- HEADER -->
  <header class="header">
    <div class="header-content">
      <div class="brand-title">
        <span>⚡ لوحة خادم العمليات</span>
        <span class="status-badge" id="badge-server-status">● متصل</span>
      </div>

      <div class="header-actions">
        <button class="btn btn-secondary btn-sm" onclick="fetchDashboardData(true)" id="btn-refresh">
          🔄 تحديث
        </button>
        <button class="btn btn-primary btn-sm" onclick="triggerJob('refresh', 'تحديث شامل للأسعار')">
          ⚡ جلب الآن
        </button>
      </div>
    </div>
  </header>

  <!-- MAIN CONTAINER -->
  <div class="container">

    <!-- KPI STATUS STRIP -->
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-title">💵 الدولار الموازي</div>
        <div class="kpi-val font-num" id="kpi-usd">-- د.ل</div>
        <div class="kpi-sub">المركزي: <span class="font-num" id="kpi-cbl">4.85</span></div>
      </div>

      <div class="kpi-card">
        <div class="kpi-title">⏱️ وقت التشغيل (Uptime)</div>
        <div class="kpi-val font-num" id="kpi-uptime">00:00:00</div>
        <div class="kpi-sub" id="kpi-date">اليوم</div>
      </div>

      <div class="kpi-card">
        <div class="kpi-title">📱 اتصال تيليجرام</div>
        <div class="kpi-val" id="kpi-tg">جاري الفحص..</div>
        <div class="kpi-sub">مراقبة القنوات</div>
      </div>

      <div class="kpi-card">
        <div class="kpi-title">🧠 استهلاك الذاكرة</div>
        <div class="kpi-val font-num" id="kpi-mem">-- MB</div>
        <div class="kpi-sub">Heap Memory</div>
      </div>
    </div>

    <!-- QUICK ACTIONS TOOLBAR -->
    <div class="actions-box">
      <div class="box-title">⚡ إجراءات وأدوات التحكم الفوري</div>
      <div class="actions-grid">
        <button class="btn btn-action" onclick="triggerJob('cbl', 'جلب مصرف ليبيا المركزي')">
          🏦 جلب أسعار CBL
        </button>
        <button class="btn btn-action" onclick="triggerJob('telegram', 'جلب أسعار تيليجرام')">
          📱 جلب تيليجرام الموازي
        </button>
        <button class="btn btn-action" onclick="triggerJob('ai', 'تحليل الأسعار بالذكاء الاصطناعي')">
          🤖 تحليل بالذكاء الاصطناعي
        </button>
        <button class="btn btn-action" onclick="triggerJob('broadcast_test', 'إرسال نشرة تجريبية للقنوات')">
          📢 نشرة تجريبية للقنوات
        </button>
        <button class="btn btn-action" onclick="triggerJob('maintenance', 'تنظيف وضغط السجلات')">
          🧹 تنظيف وصيانة السجلات
        </button>
        <button class="btn btn-action" onclick="triggerJob('telegram_reconnect', 'إعادة اتصال تيليجرام')">
          🔄 إعادة اتصال تيليجرام
        </button>
      </div>
    </div>

    <!-- TABS BAR -->
    <div class="tabs-nav">
      <button class="tab-item active" onclick="switchTab('rates')" id="tab-btn-rates">📊 الأسعار وسوق الصرف</button>
      <button class="tab-item" onclick="switchTab('jobs')" id="tab-btn-jobs">⚙️ المهام والمجدول (8)</button>
      <button class="tab-item" onclick="switchTab('broadcast')" id="tab-btn-broadcast">📢 النشر في القنوات</button>
      <button class="tab-item" onclick="switchTab('logs')" id="tab-btn-logs">📜 السجلات الحية (Logs)</button>
    </div>

    <!-- TAB 1: RATES & MARKET -->
    <div id="tab-content-rates">
      
      <!-- Parallel Currencies -->
      <div style="margin-bottom: 12px;">
        <div style="font-size: 13px; font-weight: 700; color: #38bdf8; margin-bottom: 6px;">
          💵 أسعار السوق الموازي (الكاش)
        </div>
        <div class="rates-grid" id="grid-currencies">
          <div style="color: #94a3b8; font-size: 12px;">جاري تحميل الأسعار...</div>
        </div>
      </div>

      <!-- Gold & Metals -->
      <div style="margin-bottom: 12px;">
        <div style="font-size: 13px; font-weight: 700; color: #fbbf24; margin-bottom: 6px;">
          🪙 أسعار الذهب والفضة
        </div>
        <div class="rates-grid" id="grid-metals">
          <div style="color: #94a3b8; font-size: 12px;">جاري تحميل أسعار الذهب...</div>
        </div>
      </div>

      <!-- Official CBL -->
      <div style="margin-bottom: 12px;">
        <div style="font-size: 13px; font-weight: 700; color: #34d399; margin-bottom: 6px;">
          🏦 أسعار مصرف ليبيا المركزي الرسمية (CBL)
        </div>
        <div class="rates-grid" id="grid-cbl">
          <div style="color: #94a3b8; font-size: 12px;">جاري تحميل أسعار المصرف...</div>
        </div>
      </div>

    </div>

    <!-- TAB 2: SCHEDULED BACKGROUND JOBS -->
    <div id="tab-content-jobs" class="hidden">
      <div style="font-size: 13px; font-weight: 700; color: #38bdf8; margin-bottom: 8px;">
        ⚙️ جميع مهام الخادم التلقائية
      </div>
      <div id="jobs-list-container">
        <!-- Rendered by JS -->
      </div>
    </div>

    <!-- TAB 3: BROADCAST STUDIO -->
    <div id="tab-content-broadcast" class="hidden">
      <div class="broadcast-card">
        <div style="font-size: 13px; font-weight: 700; color: #38bdf8; margin-bottom: 8px;">
          📢 إرسال ونشر رسالة في القنوات
        </div>
        
        <div style="display: flex; gap: 6px; margin-bottom: 8px;">
          <button class="btn btn-secondary btn-sm" onclick="setBroadcastText('rates')">قالب أسعار الصرف</button>
          <button class="btn btn-secondary btn-sm" onclick="setBroadcastText('gold')">قالب أسعار الذهب</button>
        </div>

        <textarea id="broadcast-input" placeholder="اكتب نص الرسالة هنا..."></textarea>

        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
          <label style="font-size: 12px; display: flex; align-items: center; gap: 4px; cursor: pointer; color: #f59e0b;">
            <input type="checkbox" id="broadcast-test-check" checked>
            <span>وضع تجريبي (Test Mode)</span>
          </label>

          <button class="btn btn-primary" onclick="submitBroadcast()">
            📢 إرسال للمجموعات الآن
          </button>
        </div>
      </div>
    </div>

    <!-- TAB 4: LIVE LOGS -->
    <div id="tab-content-logs" class="hidden">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
        <div style="font-size: 13px; font-weight: 700; color: #38bdf8;">
          📜 سجل الأحداث والعمليات (Live Logs)
        </div>
        <button class="btn btn-secondary btn-sm" onclick="clearLiveLogs()">
          مسح السجلات
        </button>
      </div>
      <div class="logs-container" id="logs-feed">
        <div style="color: #64748b;">جاري تحميل السجلات...</div>
      </div>
    </div>

  </div>

  <!-- RATE OVERRIDE MODAL -->
  <div id="rate-modal" class="modal-overlay hidden">
    <div class="modal-box">
      <div style="font-size: 14px; font-weight: 700; color: #ffffff; margin-bottom: 6px;">
        ✏️ تعديل السعر يدوياً
      </div>
      <div style="font-size: 12px; color: #94a3b8;" id="modal-title">--</div>
      <input type="hidden" id="modal-code">

      <input type="number" step="0.01" id="modal-input" class="modal-input">

      <div style="display: flex; justify-content: flex-end; gap: 8px;">
        <button class="btn btn-secondary" onclick="closeRateModal()">إلغاء</button>
        <button class="btn btn-primary" onclick="saveRateModal()">حفظ ومزامنة</button>
      </div>
    </div>
  </div>

  <!-- TOAST NOTIFICATION -->
  <div id="toast" class="toast-box hidden"></div>

  <!-- SCRIPT -->
  <script>
    let pollInterval = 5000;
    let pollTimer = null;
    let currentRates = null;

    const NAMES = {
      usd: 'الدولار الأمريكي',
      eur: 'اليورو الأوروبي',
      gbp: 'الجنيه الإسترليني',
      egp: 'الجنيه المصري',
      tnd: 'الدينار التونسي',
      try: 'الليرة التركية',
      gold: 'ذهب كسر عيار 18',
      gold_scrap_18: 'ذهب كسر 18',
      gold_scrap_21: 'ذهب كسر 21',
      gold_cast_24: 'سبائك عيار 24',
      gold_lira_8g: 'ليرة ذهب (8غ)',
      gold_lira_14g: 'ليرة ذهب (14غ)',
      silver_cast_1000: 'فضة سبائك',
      silver_scrap: 'فضة كسر'
    };

    function switchTab(tabId) {
      document.querySelectorAll('[id^="tab-content-"]').forEach(el => el.classList.add('hidden'));
      document.querySelectorAll('.tab-item').forEach(el => el.classList.remove('active'));

      const activeSec = document.getElementById('tab-content-' + tabId);
      const activeBtn = document.getElementById('tab-btn-' + tabId);
      if (activeSec) activeSec.classList.remove('hidden');
      if (activeBtn) activeBtn.classList.add('active');
    }

    function showToast(msg, isError = false) {
      const toast = document.getElementById('toast');
      toast.textContent = (isError ? '❌ ' : '✅ ') + msg;
      toast.style.borderColor = isError ? '#ef4444' : '#10b981';
      toast.classList.remove('hidden');
      setTimeout(() => toast.classList.add('hidden'), 3500);
    }

    async function fetchDashboardData(isManual = false) {
      try {
        const res = await fetch('/api/dashboard/stats', { headers: { 'Accept': 'application/json' } });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        currentRates = data.rates;
        renderUI(data);
        if (isManual) showToast('تم تحديث البيانات بنجاح');
      } catch (err) {
        if (isManual) showToast('تعذر التحديث: ' + err.message, true);
      }
    }

    function renderUI(data) {
      // 1. KPIs
      if (data.rates?.parallel) {
        const usd = data.rates.parallel.USD || data.rates.parallel.usd || 0;
        document.getElementById('kpi-usd').textContent = Number(usd).toFixed(2) + ' د.ل';
      }
      if (data.rates?.official?.USD) {
        const cbl = data.rates.official.USD.buy || data.rates.official.USD.rate || 4.85;
        document.getElementById('kpi-cbl').textContent = Number(cbl).toFixed(2);
      }
      if (typeof data.uptimeSeconds === 'number') {
        const h = Math.floor(data.uptimeSeconds / 3600);
        const m = Math.floor((data.uptimeSeconds % 3600) / 60);
        const s = data.uptimeSeconds % 60;
        document.getElementById('kpi-uptime').textContent = 
          String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
      }
      if (data.memory) {
        document.getElementById('kpi-mem').textContent = data.memory.heapUsedMb + ' MB';
      }
      if (typeof data.telegramConnected === 'boolean') {
        document.getElementById('kpi-tg').textContent = data.telegramConnected ? '🟢 متصل' : '⚠️ غير متصل';
      }

      // 2. Currencies Grid & Metals Grid
      if (data.rates?.parallel) {
        const cGrid = document.getElementById('grid-currencies');
        const mGrid = document.getElementById('grid-metals');
        let cHtml = '';
        let mHtml = '';

        const METAL_KEYS = ['GOLD', 'GOLD_EXT_18', 'GOLD_EXT_21', 'GOLD_SCRAP_18', 'GOLD_SCRAP_21', 'GOLD_CAST_18', 'GOLD_CAST_21', 'GOLD_CAST_24', 'GOLD_LIRA_8G', 'GOLD_LIRA_14G', 'GOLD_MUJARA_14G', 'SILVER_CAST_1000', 'SILVER_SCRAP'];

        for (const [code, val] of Object.entries(data.rates.parallel)) {
          const num = Number(val) || 0;
          if (num <= 0) continue;
          const isMetal = METAL_KEYS.includes(code) || code.toLowerCase().startsWith('gold') || code.toLowerCase().startsWith('silver');
          const name = NAMES[code.toLowerCase()] || NAMES[code] || code;

          const card = \`
            <div class="rate-card \${isMetal ? 'gold' : ''}">
              <div class="rate-header">
                <span class="rate-name">\${name}</span>
                <span class="rate-code">\${code}</span>
              </div>
              <div class="rate-price font-num">\${num.toFixed(isMetal ? 2 : 3)} <span style="font-size: 11px; font-weight: normal; color: #94a3b8;">د.ل</span></div>
              <button class="rate-btn-edit" onclick="openRateModal('\${code}', '\${name}', \${num})">✏️ تعديل السعر</button>
            </div>
          \`;

          if (isMetal) mHtml += card;
          else cHtml += card;
        }

        cGrid.innerHTML = cHtml || '<div style="color: #64748b;">لا توجد أسعار</div>';
        mGrid.innerHTML = mHtml || '<div style="color: #64748b;">لا توجد أسعار معادن</div>';
      }

      // 3. Official CBL Grid
      if (data.rates?.official) {
        const cblGrid = document.getElementById('grid-cbl');
        let cblHtml = '';
        for (const [code, item] of Object.entries(data.rates.official)) {
          const buy = Number(item.buy || item.rate || 0);
          const sell = Number(item.sell || item.rate || 0);
          if (buy <= 0 && sell <= 0) continue;
          const name = NAMES[code.toLowerCase()] || code;

          cblHtml += \`
            <div class="rate-card">
              <div class="rate-header">
                <span class="rate-name">\${name} (رسمي)</span>
                <span class="rate-code">\${code}</span>
              </div>
              <div class="rate-price font-num" style="color: #38bdf8;">\${buy.toFixed(4)} <span style="font-size: 11px; font-weight: normal; color: #94a3b8;">د.ل</span></div>
              <div style="font-size: 10px; color: #94a3b8; display: flex; justify-content: space-between;">
                <span>شراء: \${buy.toFixed(2)}</span>
                <span>بيع: \${sell.toFixed(2)}</span>
              </div>
            </div>
          \`;
        }
        cblGrid.innerHTML = cblHtml;
      }

      // 4. Jobs List
      if (data.activeJobs && Array.isArray(data.activeJobs)) {
        const jContainer = document.getElementById('jobs-list-container');
        let jHtml = '';
        for (const job of data.activeJobs) {
          const badge = job.isRunning ? '⏳ قيد التشغيل' :
            job.status === 'success' ? '✅ ناجحة' :
            job.status === 'failed' ? '❌ فشلت' : 'خامل';
          
          jHtml += \`
            <div class="job-card">
              <div class="job-info">
                <div class="job-name">\${job.name}</div>
                <div class="job-meta">
                  <span>الحالة: <strong>\${badge}</strong></span>
                  <span>المدة: \${job.lastRunDurationMs ? job.lastRunDurationMs + 'ms' : '--'}</span>
                  <span>مرات التشغيل: #\${job.runCount || 0}</span>
                </div>
              </div>
              <button class="btn btn-secondary btn-sm" onclick="triggerJobById('\${job.id}', '\${job.name}')">تشغيل</button>
            </div>
          \`;
        }
        jContainer.innerHTML = jHtml;
      }

      // 5. Live Logs
      if (data.recentLogs && Array.isArray(data.recentLogs)) {
        const lFeed = document.getElementById('logs-feed');
        let lHtml = '';
        for (const log of data.recentLogs) {
          const time = new Date(log.timestamp).toLocaleTimeString('ar-LY');
          const cls = log.level === 'error' ? 'log-error' :
            log.level === 'warn' ? 'log-warn' :
            log.level === 'success' ? 'log-success' : 'log-info';

          lHtml += \`
            <div class="log-row">
              <span style="color: #64748b;">\${time}</span>
              <span class="\${cls}">[\${log.category}]:</span>
              <span>\${log.message}</span>
            </div>
          \`;
        }
        lFeed.innerHTML = lHtml || '<div style="color: #64748b;">لا توجد سجلات</div>';
      }
    }

    async function triggerJob(jobAction, label) {
      showToast('بدء: ' + label + '...');
      try {
        const res = await fetch('/api/dashboard/trigger', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: jobAction })
        });
        const data = await res.json();
        if (data.success) {
          showToast('اكتمل: ' + label);
          fetchDashboardData();
        } else {
          showToast('فشل: ' + (data.error || 'خطأ'), true);
        }
      } catch (err) {
        showToast('خطأ بالاتصال: ' + err.message, true);
      }
    }

    function triggerJobById(jobId, jobName) {
      const map = {
        'official_rates_scraper': 'cbl',
        'parallel_rates_scraper': 'telegram',
        'database_cleanup': 'maintenance',
        'periodic_supabase_sync': 'refresh',
        'memory_cleanup_watchdog': 'gc',
        'social_tokens_validity': 'telegram_reconnect',
        'ai_rates_extraction': 'ai',
        'periodic_auto_broadcast': 'broadcast_test'
      };
      triggerJob(map[jobId] || 'refresh', jobName);
    }

    function openRateModal(code, name, rate) {
      document.getElementById('modal-code').value = code;
      document.getElementById('modal-title').textContent = name + ' (' + code + ')';
      document.getElementById('modal-input').value = rate;
      document.getElementById('rate-modal').classList.remove('hidden');
    }

    function closeRateModal() {
      document.getElementById('rate-modal').classList.add('hidden');
    }

    async function saveRateModal() {
      const code = document.getElementById('modal-code').value;
      const rate = parseFloat(document.getElementById('modal-input').value);

      if (!code || isNaN(rate) || rate <= 0) {
        showToast('يرجى كتابة سعر صحيح', true);
        return;
      }

      showToast('جاري حفظ السعر...');
      try {
        const res = await fetch('/api/dashboard/update-rate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, rate })
        });
        const data = await res.json();
        if (data.success) {
          showToast('تم حفظ السعر وتحديثه بنجاح');
          closeRateModal();
          fetchDashboardData();
        } else {
          showToast('فشل الحفظ: ' + data.error, true);
        }
      } catch (err) {
        showToast('خطأ: ' + err.message, true);
      }
    }

    function setBroadcastText(type) {
      const input = document.getElementById('broadcast-input');
      const usd = currentRates?.parallel?.USD || currentRates?.parallel?.usd || 7.15;
      const eur = currentRates?.parallel?.EUR || currentRates?.parallel?.eur || 7.65;
      const gold = currentRates?.parallel?.GOLD || currentRates?.parallel?.GOLD_SCRAP_18 || 385;
      const time = new Date().toLocaleTimeString('ar-LY', { hour: '2-digit', minute: '2-digit' });

      if (type === 'rates') {
        input.value = \`📢 نشرة أسعار الصرف في طرابلس:\n💵 الدولار: \${Number(usd).toFixed(2)} د.ل\n💶 اليورو: \${Number(eur).toFixed(2)} د.ل\n🕒 التوقيت: \${time}\`;
      } else if (type === 'gold') {
        input.value = \`🪙 أسعار الذهب:\n🥇 كسر 18: \${Number(gold).toFixed(2)} د.ل\n🕒 التوقيت: \${time}\`;
      }
    }

    async function submitBroadcast() {
      const message = document.getElementById('broadcast-input').value.trim();
      const isTest = document.getElementById('broadcast-test-check').checked;

      if (!message) {
        showToast('اكتب نص الرسالة أولاً', true);
        return;
      }

      showToast('جاري الإرسال...');
      try {
        const res = await fetch('/api/dashboard/broadcast-custom', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, isTest, target: 'all' })
        });
        const data = await res.json();
        if (data.success) {
          showToast('تم إرسال المنشور بنجاح');
        } else {
          showToast('فشل الإرسال: ' + data.error, true);
        }
      } catch (err) {
        showToast('خطأ: ' + err.message, true);
      }
    }

    async function clearLiveLogs() {
      try {
        await fetch('/api/dashboard/clear-logs', { method: 'POST' });
        document.getElementById('logs-feed').innerHTML = '<div style="color: #64748b;">تم مسح السجلات</div>';
        showToast('تم مسح السجلات');
      } catch (e) {}
    }

    // Initialize
    fetchDashboardData();
    pollTimer = setInterval(fetchDashboardData, pollInterval);
  </script>
</body>
</html>`;
}
