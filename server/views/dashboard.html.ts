export function renderDashboardHtml(initialState?: any): string {
  const NAMES: Record<string, string> = {
    usd: 'الدولار الأمريكي (كاش)',
    eur: 'اليورو الأوروبي',
    gbp: 'الجنيه الإسترليني',
    egp: 'الجنيه المصري',
    tnd: 'الدينار التونسي',
    try: 'الليرة التركية',
    usd_checks: 'دولار الصكوك (طرابلس)',
    usd_tr: 'دولار حوالات تركيا',
    usd_ae: 'دولار حوالات دبي',
    gold: 'ذهب كسر عيار 18',
    gold_scrap_18: 'ذهب كسر 18',
    gold_scrap_21: 'ذهب كسر 21',
    gold_ext_18: 'ذهب خارجي 18',
    gold_ext_21: 'ذهب خارجي 21',
    gold_cast_18: 'سبائك عيار 18',
    gold_cast_21: 'سبائك عيار 21',
    gold_cast_24: 'سبائك عيار 24',
    gold_lira_8g: 'ليرة ذهب (8 جرام)',
    gold_lira_14g: 'ليرة ذهب (14 جرام)',
    gold_mujara_14g: 'مجرية ذهب (14 جرام)',
    silver_cast_1000: 'فضة سبائك 1000',
    silver_scrap: 'فضة كسر (جرام)'
  };

  const METAL_KEYS = ['GOLD', 'GOLD_EXT_18', 'GOLD_EXT_21', 'GOLD_SCRAP_18', 'GOLD_SCRAP_21', 'GOLD_CAST_18', 'GOLD_CAST_21', 'GOLD_CAST_24', 'GOLD_LIRA_8G', 'GOLD_LIRA_14G', 'GOLD_MUJARA_14G', 'SILVER_CAST_1000', 'SILVER_SCRAP'];

  // Calculate pre-rendered values
  const usdParallel = Number(initialState?.rates?.parallel?.USD || initialState?.rates?.parallel?.usd || 10.8);
  const usdCbl = Number(initialState?.rates?.official?.USD?.buy || initialState?.rates?.official?.USD?.rate || initialState?.rates?.official?.USD || 4.85);
  const uptimeSec = Number(initialState?.uptimeSeconds || 0);
  const hrs = Math.floor(uptimeSec / 3600);
  const mins = Math.floor((uptimeSec % 3600) / 60);
  const secs = uptimeSec % 60;
  const formattedUptime = `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  const heapMb = Number(initialState?.memory?.heapUsedMb || 55);
  const tgConnected = Boolean(initialState?.telegramConnected);

  // Pre-render Currencies & Metals cards
  let preCurrenciesHtml = '';
  let preMetalsHtml = '';
  if (initialState?.rates?.parallel) {
    for (const [code, val] of Object.entries(initialState.rates.parallel)) {
      const num = Number(val) || 0;
      if (num <= 0) continue;
      const isMetal = METAL_KEYS.includes(code) || code.toLowerCase().startsWith('gold') || code.toLowerCase().startsWith('silver');
      const name = NAMES[code.toLowerCase()] || NAMES[code] || code;

      const card = `
        <div class="rate-card ${isMetal ? 'gold' : ''}">
          <div class="rate-header">
            <span class="rate-name">${name}</span>
            <span class="rate-code">${code}</span>
          </div>
          <div class="rate-price font-num">${num.toFixed(isMetal ? 2 : 3)} <span style="font-size: 11px; font-weight: normal; color: #94a3b8;">د.ل</span></div>
          <button class="rate-btn-edit" onclick="openRateModal('${code}', '${name}', ${num})">✏️ تعديل السعر</button>
        </div>
      `;

      if (isMetal) preMetalsHtml += card;
      else preCurrenciesHtml += card;
    }
  }

  // Pre-render CBL cards
  let preCblHtml = '';
  if (initialState?.rates?.official) {
    for (const [code, item] of Object.entries(initialState.rates.official)) {
      const buy = typeof item === 'object' ? Number((item as any).buy || (item as any).rate || 0) : Number(item || 0);
      const sell = typeof item === 'object' ? Number((item as any).sell || (item as any).rate || 0) : Number(item || 0);
      if (buy <= 0 && sell <= 0) continue;
      const name = NAMES[code.toLowerCase()] || code;

      preCblHtml += `
        <div class="rate-card">
          <div class="rate-header">
            <span class="rate-name">${name} (رسمي)</span>
            <span class="rate-code">${code}</span>
          </div>
          <div class="rate-price font-num" style="color: #38bdf8;">${buy.toFixed(4)} <span style="font-size: 11px; font-weight: normal; color: #94a3b8;">د.ل</span></div>
          <div style="font-size: 10px; color: #94a3b8; display: flex; justify-content: space-between;">
            <span>شراء: ${buy.toFixed(2)}</span>
            <span>بيع: ${sell > 0 ? sell.toFixed(2) : buy.toFixed(2)}</span>
          </div>
        </div>
      `;
    }
  }

  // Pre-render Jobs
  let preJobsHtml = '';
  if (initialState?.activeJobs && Array.isArray(initialState.activeJobs)) {
    for (const job of initialState.activeJobs) {
      const badge = job.isRunning ? '⏳ قيد التشغيل' :
        job.status === 'success' ? '✅ ناجحة' :
        job.status === 'failed' ? '❌ فشلت' : 'خامل';
      preJobsHtml += `
        <div class="job-card">
          <div class="job-info">
            <div class="job-name">${job.name}</div>
            <div class="job-meta">
              <span>الحالة: <strong>${badge}</strong></span>
              <span>المدة: ${job.lastRunDurationMs ? job.lastRunDurationMs + 'ms' : '--'}</span>
              <span>مرات التشغيل: #${job.runCount || 0}</span>
            </div>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="triggerJobById('${job.id}', '${job.name}')">تشغيل</button>
        </div>
      `;
    }
  }

  // Pre-render Logs
  let preLogsHtml = '';
  if (initialState?.recentLogs && Array.isArray(initialState.recentLogs)) {
    for (const log of initialState.recentLogs) {
      const time = new Date(log.timestamp).toLocaleTimeString('ar-LY');
      const cls = log.level === 'error' ? 'log-error' :
        log.level === 'warn' ? 'log-warn' :
        log.level === 'success' ? 'log-success' : 'log-info';
      preLogsHtml += `
        <div class="log-row">
          <span style="color: #64748b;">${time}</span>
          <span class="${cls}">[${log.category}]:</span>
          <span>${log.message}</span>
        </div>
      `;
    }
  }

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
      background-color: #0b1120;
      color: #f1f5f9;
      font-size: 14px;
      line-height: 1.5;
      padding-bottom: 40px;
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
      border-radius: 8px;
    }
    .btn-action:hover {
      background: #334155;
      border-color: #475569;
    }
    .btn-sm {
      padding: 5px 10px;
      font-size: 12px;
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
      font-size: 17px;
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
      -webkit-overflow-scrolling: touch;
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
      padding: 5px;
      background: #334155;
      color: #cbd5e1;
      border-radius: 6px;
      border: none;
      width: 100%;
      text-align: center;
      margin-top: 4px;
      cursor: pointer;
    }
    .rate-btn-edit:hover {
      background: #475569;
      color: #ffffff;
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

  <!-- EMBEDDED INITIAL STATE FOR INSTANT RENDERING -->
  <script id="initial-dashboard-state" type="application/json">
    ${JSON.stringify(initialState || {})}
  </script>

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

    <!-- KPI STATUS STRIP (PRE-RENDERED WITH INITIAL VALUES) -->
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-title">💵 الدولار الموازي</div>
        <div class="kpi-val font-num" id="kpi-usd">${usdParallel.toFixed(2)} د.ل</div>
        <div class="kpi-sub">المركزي: <span class="font-num" id="kpi-cbl">${usdCbl.toFixed(2)}</span></div>
      </div>

      <div class="kpi-card">
        <div class="kpi-title">⏱️ وقت التشغيل (Uptime)</div>
        <div class="kpi-val font-num" id="kpi-uptime">${formattedUptime}</div>
        <div class="kpi-sub" id="kpi-date">نشط</div>
      </div>

      <div class="kpi-card">
        <div class="kpi-title">📱 اتصال تيليجرام</div>
        <div class="kpi-val" id="kpi-tg">${tgConnected ? '🟢 متصل' : '⚠️ غير متصل'}</div>
        <div class="kpi-sub">مراقبة القنوات</div>
      </div>

      <div class="kpi-card">
        <div class="kpi-title">🧠 استهلاك الذاكرة</div>
        <div class="kpi-val font-num" id="kpi-mem">${heapMb} MB</div>
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
          ${preCurrenciesHtml || '<div style="color: #94a3b8; font-size: 12px;">جاري تحميل الأسعار...</div>'}
        </div>
      </div>

      <!-- Gold & Metals -->
      <div style="margin-bottom: 12px;">
        <div style="font-size: 13px; font-weight: 700; color: #fbbf24; margin-bottom: 6px;">
          🪙 أسعار الذهب والفضة
        </div>
        <div class="rates-grid" id="grid-metals">
          ${preMetalsHtml || '<div style="color: #94a3b8; font-size: 12px;">جاري تحميل أسعار الذهب...</div>'}
        </div>
      </div>

      <!-- Official CBL -->
      <div style="margin-bottom: 12px;">
        <div style="font-size: 13px; font-weight: 700; color: #34d399; margin-bottom: 6px;">
          🏦 أسعار مصرف ليبيا المركزي الرسمية (CBL)
        </div>
        <div class="rates-grid" id="grid-cbl">
          ${preCblHtml || '<div style="color: #94a3b8; font-size: 12px;">جاري تحميل أسعار المصرف...</div>'}
        </div>
      </div>

    </div>

    <!-- TAB 2: SCHEDULED BACKGROUND JOBS -->
    <div id="tab-content-jobs" class="hidden">
      <div style="font-size: 13px; font-weight: 700; color: #38bdf8; margin-bottom: 8px;">
        ⚙️ جميع مهام الخادم التلقائية
      </div>
      <div id="jobs-list-container">
        ${preJobsHtml || '<div style="color: #94a3b8; font-size: 12px;">جاري تحميل المهام...</div>'}
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
        ${preLogsHtml || '<div style="color: #64748b;">جاري تحميل السجلات...</div>'}
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

  <!-- CLIENT SCRIPTS -->
  <script>
    let pollInterval = 5000;
    let pollTimer = null;
    let currentRates = null;

    const NAMES = {
      usd: 'الدولار الأمريكي (كاش)',
      eur: 'اليورو الأوروبي',
      gbp: 'الجنيه الإسترليني',
      egp: 'الجنيه المصري',
      tnd: 'الدينار التونسي',
      try: 'الليرة التركية',
      usd_checks: 'دولار الصكوك (طرابلس)',
      usd_tr: 'دولار حوالات تركيا',
      usd_ae: 'دولار حوالات دبي',
      gold: 'ذهب كسر عيار 18',
      gold_scrap_18: 'ذهب كسر 18',
      gold_scrap_21: 'ذهب كسر 21',
      gold_ext_18: 'ذهب خارجي 18',
      gold_ext_21: 'ذهب خارجي 21',
      gold_cast_18: 'سبائك عيار 18',
      gold_cast_21: 'سبائك عيار 21',
      gold_cast_24: 'سبائك عيار 24',
      gold_lira_8g: 'ليرة ذهب (8غ)',
      gold_lira_14g: 'ليرة ذهب (14غ)',
      gold_mujara_14g: 'مجرية ذهب (14غ)',
      silver_cast_1000: 'فضة سبائك 1000',
      silver_scrap: 'فضة كسر (جرام)'
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
      if (!toast) return;
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
      if (!data) return;

      // 1. KPIs
      if (data.rates && data.rates.parallel) {
        const usd = data.rates.parallel.USD || data.rates.parallel.usd || 0;
        const usdEl = document.getElementById('kpi-usd');
        if (usdEl && Number(usd) > 0) usdEl.textContent = Number(usd).toFixed(2) + ' د.ل';
      }
      if (data.rates && data.rates.official) {
        const cblItem = data.rates.official.USD;
        const cbl = typeof cblItem === 'object' ? (cblItem.buy || cblItem.rate || 4.85) : (cblItem || 4.85);
        const cblEl = document.getElementById('kpi-cbl');
        if (cblEl) cblEl.textContent = Number(cbl).toFixed(2);
      }
      if (typeof data.uptimeSeconds === 'number') {
        const h = Math.floor(data.uptimeSeconds / 3600);
        const m = Math.floor((data.uptimeSeconds % 3600) / 60);
        const s = data.uptimeSeconds % 60;
        const upEl = document.getElementById('kpi-uptime');
        if (upEl) {
          upEl.textContent = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
        }
      }
      if (data.memory) {
        const memEl = document.getElementById('kpi-mem');
        if (memEl) memEl.textContent = data.memory.heapUsedMb + ' MB';
      }
      if (typeof data.telegramConnected === 'boolean') {
        const tgEl = document.getElementById('kpi-tg');
        if (tgEl) tgEl.textContent = data.telegramConnected ? '🟢 متصل' : '⚠️ غير متصل';
      }

      // 2. Currencies Grid & Metals Grid
      if (data.rates && data.rates.parallel) {
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

        if (cGrid && cHtml) cGrid.innerHTML = cHtml;
        if (mGrid && mHtml) mGrid.innerHTML = mHtml;
      }

      // 3. Official CBL Grid
      if (data.rates && data.rates.official) {
        const cblGrid = document.getElementById('grid-cbl');
        let cblHtml = '';
        for (const [code, item] of Object.entries(data.rates.official)) {
          const buy = typeof item === 'object' ? Number(item.buy || item.rate || 0) : Number(item || 0);
          const sell = typeof item === 'object' ? Number(item.sell || item.rate || 0) : Number(item || 0);
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
                <span>بيع: \${sell > 0 ? sell.toFixed(2) : buy.toFixed(2)}</span>
              </div>
            </div>
          \`;
        }
        if (cblGrid && cblHtml) cblGrid.innerHTML = cblHtml;
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
        if (jContainer && jHtml) jContainer.innerHTML = jHtml;
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
        if (lFeed && lHtml) lFeed.innerHTML = lHtml;
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
          showToast('اكتمل بنجاح: ' + label);
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
      const modal = document.getElementById('rate-modal');
      const input = document.getElementById('modal-input');
      const codeInput = document.getElementById('modal-code');
      const title = document.getElementById('modal-title');
      if (codeInput) codeInput.value = code;
      if (title) title.textContent = name + ' (' + code + ')';
      if (input) input.value = rate;
      if (modal) modal.classList.remove('hidden');
    }

    function closeRateModal() {
      const modal = document.getElementById('rate-modal');
      if (modal) modal.classList.add('hidden');
    }

    async function saveRateModal() {
      const code = document.getElementById('modal-code')?.value;
      const rate = parseFloat(document.getElementById('modal-input')?.value || '0');

      if (!code || isNaN(rate) || rate <= 0) {
        showToast('يرجى كتابة سعر صحيح وموجب', true);
        return;
      }

      showToast('جاري حفظ السعر ومزامنته...');
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
      if (!input) return;
      const usd = currentRates?.parallel?.USD || currentRates?.parallel?.usd || 10.8;
      const eur = currentRates?.parallel?.EUR || currentRates?.parallel?.eur || 12.17;
      const gold = currentRates?.parallel?.GOLD || currentRates?.parallel?.GOLD_SCRAP_18 || 485;
      const time = new Date().toLocaleTimeString('ar-LY', { hour: '2-digit', minute: '2-digit' });

      if (type === 'rates') {
        input.value = '📢 نشرة أسعار الصرف في طرابلس:\\n💵 الدولار: ' + Number(usd).toFixed(2) + ' د.ل\\n💶 اليورو: ' + Number(eur).toFixed(2) + ' د.ل\\n🕒 التوقيت: ' + time;
      } else if (type === 'gold') {
        input.value = '🪙 أسعار الذهب:\\n🥇 كسر 18: ' + Number(gold).toFixed(2) + ' د.ل\\n🕒 التوقيت: ' + time;
      }
    }

    async function submitBroadcast() {
      const input = document.getElementById('broadcast-input');
      const message = input ? input.value.trim() : '';
      const check = document.getElementById('broadcast-test-check');
      const isTest = check ? check.checked : false;

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
        const feed = document.getElementById('logs-feed');
        if (feed) feed.innerHTML = '<div style="color: #64748b;">تم مسح السجلات</div>';
        showToast('تم مسح السجلات');
      } catch (e) {}
    }

    // Load initial state if present
    try {
      const stateEl = document.getElementById('initial-dashboard-state');
      if (stateEl && stateEl.textContent) {
        const parsed = JSON.parse(stateEl.textContent.trim());
        if (parsed && parsed.rates) {
          currentRates = parsed.rates;
          renderUI(parsed);
        }
      }
    } catch (e) {
      console.warn('Initial state parse error:', e);
    }

    // Background fetch & polling
    fetchDashboardData();
    pollTimer = setInterval(fetchDashboardData, pollInterval);
  </script>
</body>
</html>`;
}
