export interface LoginHtmlOptions {
  isLocked?: boolean;
  remainingSeconds?: number;
  attemptsLeft?: number;
  clientIp?: string;
  error?: string;
}

export function renderLoginHtml(options: LoginHtmlOptions = {}): string {
  const isLocked = Boolean(options.isLocked);
  const remainingSeconds = Number(options.remainingSeconds || 0);
  const attemptsLeft = options.attemptsLeft ?? 5;
  const clientIp = options.clientIp || '';

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>بوابة الوصول المشفرة | LYD Shield v3.0</title>
  <style>
    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      -webkit-tap-highlight-color: transparent;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans Arabic", "Cairo", sans-serif;
      background: radial-gradient(circle at 50% 20%, #0f172a 0%, #060913 100%);
      color: #f8fafc;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      overflow-x: hidden;
    }
    .shield-card {
      width: 100%;
      max-width: 440px;
      background: rgba(15, 23, 42, 0.85);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid rgba(56, 189, 248, 0.2);
      border-radius: 18px;
      padding: 28px 24px;
      box-shadow: 0 20px 40px -15px rgba(0, 0, 0, 0.7), 0 0 30px rgba(56, 189, 248, 0.1);
      position: relative;
    }
    .shield-card::before {
      content: '';
      position: absolute;
      top: -1px;
      left: 20%;
      right: 20%;
      height: 2px;
      background: linear-gradient(90deg, transparent, #38bdf8, transparent);
    }
    .icon-wrapper {
      width: 64px;
      height: 64px;
      margin: 0 auto 16px;
      background: radial-gradient(circle, rgba(56, 189, 248, 0.15) 0%, rgba(15, 23, 42, 0.4) 100%);
      border: 1px solid rgba(56, 189, 248, 0.4);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 28px;
      box-shadow: 0 0 20px rgba(56, 189, 248, 0.25);
    }
    .title {
      text-align: center;
      font-size: 19px;
      font-weight: 800;
      color: #ffffff;
      margin-bottom: 6px;
      letter-spacing: -0.3px;
    }
    .subtitle {
      text-align: center;
      font-size: 12px;
      color: #94a3b8;
      margin-bottom: 22px;
      line-height: 1.5;
    }
    .badge-bar {
      display: flex;
      justify-content: center;
      gap: 6px;
      margin-bottom: 20px;
      flex-wrap: wrap;
    }
    .sec-badge {
      font-size: 10px;
      font-weight: 600;
      padding: 3px 8px;
      border-radius: 999px;
      background: rgba(30, 41, 59, 0.8);
      border: 1px solid #334155;
      color: #cbd5e1;
    }
    .form-group {
      margin-bottom: 16px;
    }
    .form-label {
      display: block;
      font-size: 12px;
      font-weight: 700;
      color: #e2e8f0;
      margin-bottom: 8px;
    }
    .input-wrap {
      position: relative;
      display: flex;
      align-items: center;
    }
    .input-field {
      width: 100%;
      background: #090e17;
      border: 1px solid #334155;
      border-radius: 10px;
      padding: 12px 42px 12px 14px;
      color: #ffffff;
      font-size: 14px;
      outline: none;
      transition: all 0.2s ease;
      letter-spacing: 1px;
    }
    .input-field:focus {
      border-color: #38bdf8;
      box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.2);
    }
    .toggle-pass {
      position: absolute;
      left: 10px;
      background: none;
      border: none;
      color: #94a3b8;
      cursor: pointer;
      font-size: 16px;
      padding: 4px;
    }
    .btn-login {
      width: 100%;
      background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%);
      border: 1px solid #38bdf8;
      border-radius: 10px;
      padding: 12px 16px;
      color: #ffffff;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      transition: all 0.2s ease;
      box-shadow: 0 4px 15px rgba(2, 132, 199, 0.35);
    }
    .btn-login:hover:not(:disabled) {
      background: linear-gradient(135deg, #0369a1 0%, #075985 100%);
      transform: translateY(-1px);
    }
    .btn-login:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
    }
    .alert-box {
      border-radius: 10px;
      padding: 12px 14px;
      margin-bottom: 16px;
      font-size: 12px;
      line-height: 1.5;
      display: flex;
      align-items: flex-start;
      gap: 8px;
    }
    .alert-danger {
      background: rgba(239, 68, 68, 0.15);
      border: 1px solid rgba(239, 68, 68, 0.3);
      color: #fca5a5;
    }
    .alert-warning {
      background: rgba(245, 158, 11, 0.15);
      border: 1px solid rgba(245, 158, 11, 0.3);
      color: #fcd34d;
    }
    .footer-note {
      text-align: center;
      font-size: 10px;
      color: #64748b;
      margin-top: 20px;
      line-height: 1.6;
    }
    .hidden { display: none !important; }
  </style>
</head>
<body>
  <div class="shield-card">
    <div class="icon-wrapper">🛡️</div>
    <h1 class="title">بوابة الوصول المشفرة</h1>
    <p class="subtitle">منطقة إدارية مقيدة ومحمية بجدار ناري مشفر ضد الاختراق والتخمين</p>

    <div class="badge-bar">
      <span class="sec-badge">🔒 تشفير SHA-256</span>
      <span class="sec-badge">🛑 حظر تلقائي للـ IP</span>
      <span class="sec-badge">🔐 جلسات HMAC</span>
    </div>

    <div id="lockout-banner" class="alert-box alert-danger ${isLocked ? '' : 'hidden'}">
      <span>🛑</span>
      <div>
        <strong>تم حظر عنوان IP مؤقتاً</strong>
        <div style="margin-top: 4px;">تجاوزت الحد الأقصى للمحاولات الخاطئة. يرجى الانتظار <span id="lock-countdown" style="font-weight: bold; font-family: monospace;">${remainingSeconds}</span> ثانية.</div>
      </div>
    </div>

    <div id="error-banner" class="alert-box alert-warning hidden">
      <span>⚠️</span>
      <span id="error-text">كلمة المرور غير صحيحة.</span>
    </div>

    <form id="login-form" onsubmit="handleLogin(event)">
      <div class="form-group">
        <label class="form-label" for="password">كلمة مرور الإدارة الرئيسية (Master Password)</label>
        <div class="input-wrap">
          <input 
            type="password" 
            id="password" 
            class="input-field" 
            placeholder="أدخل كلمة المرور المشفرة..." 
            autocomplete="current-password"
            required
            ${isLocked ? 'disabled' : ''}
            autofocus
          />
          <button type="button" class="toggle-pass" onclick="togglePassVisibility()" tabindex="-1" title="إظهار/إخفاء">👁️</button>
        </div>
      </div>

      <button type="submit" id="btn-submit" class="btn-login" ${isLocked ? 'disabled' : ''}>
        <span>🔐</span>
        <span id="btn-text">دخول آمن للنظام</span>
      </button>
    </form>

    <div class="footer-note">
      يتم تسجيل عنوان الـ IP والبيانات الأمنية لكل طلب لضمان سلامة قاعدة البيانات والخدمة.
      ${clientIp ? `<div style="margin-top: 4px; font-family: monospace; color: #475569;">IP: ${clientIp}</div>` : ''}
    </div>
  </div>

  <script>
    let remainingLockTime = ${remainingSeconds};
    let lockTimer = null;

    if (remainingLockTime > 0) {
      startLockCountdown();
    }

    function togglePassVisibility() {
      const passInput = document.getElementById('password');
      if (passInput.type === 'password') {
        passInput.type = 'text';
      } else {
        passInput.type = 'password';
      }
    }

    function startLockCountdown() {
      const banner = document.getElementById('lockout-banner');
      const counter = document.getElementById('lock-countdown');
      const btn = document.getElementById('btn-submit');
      const passInput = document.getElementById('password');

      banner.classList.remove('hidden');
      btn.disabled = true;
      passInput.disabled = true;

      if (lockTimer) clearInterval(lockTimer);

      lockTimer = setInterval(() => {
        remainingLockTime--;
        if (counter) counter.textContent = remainingLockTime;

        if (remainingLockTime <= 0) {
          clearInterval(lockTimer);
          banner.classList.add('hidden');
          btn.disabled = false;
          passInput.disabled = false;
          passInput.focus();
        }
      }, 1000);
    }

    async function handleLogin(e) {
      e.preventDefault();
      const passInput = document.getElementById('password');
      const password = passInput.value.trim();
      const btn = document.getElementById('btn-submit');
      const btnText = document.getElementById('btn-text');
      const errBanner = document.getElementById('error-banner');
      const errText = document.getElementById('error-text');

      if (!password) return;

      btn.disabled = true;
      btnText.textContent = 'جارٍ التحقق المشفر...';
      errBanner.classList.add('hidden');

      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password })
        });

        const data = await res.json();

        if (res.ok && data.success) {
          btnText.textContent = '✅ تم التحقق، جارٍ الدخول...';
          if (data.token) {
            localStorage.setItem('lyd_admin_token', data.token);
            // Set cookie fallback
            document.cookie = 'lyd_admin_token=' + encodeURIComponent(data.token) + '; path=/; max-age=43200; SameSite=Lax';
          }
          setTimeout(() => {
            window.location.reload();
          }, 300);
          return;
        }

        // Handle lock or failure
        if (data.isLocked) {
          remainingLockTime = data.remainingSeconds || 1800;
          startLockCountdown();
        } else {
          errBanner.classList.remove('hidden');
          const left = data.attemptsLeft !== undefined ? (' (المحاولات المتبقية: ' + data.attemptsLeft + ')') : '';
          errText.textContent = (data.error || 'كلمة المرور غير صحيحة') + left;
          passInput.value = '';
          passInput.focus();
        }
      } catch (err) {
        errBanner.classList.remove('hidden');
        errText.textContent = 'تعذّر الاتصال بخادم الحماية، يرجى المحاولة لاحقاً.';
      } finally {
        if (!remainingLockTime || remainingLockTime <= 0) {
          btn.disabled = false;
          btnText.textContent = 'دخول آمن للنظام';
        }
      }
    }
  </script>
</body>
</html>`;
}

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
  const tgConnected = Boolean(initialState?.accounts?.telegram?.connected || initialState?.telegramConnected);
  const waStatus = initialState?.accounts?.whatsapp?.status || initialState?.whatsappStatus || 'disconnected';

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

  // Pre-render Ingested Messages
  let preMessagesHtml = '';
  if (initialState?.ingestedMessages && Array.isArray(initialState.ingestedMessages)) {
    for (const msg of initialState.ingestedMessages) {
      const time = new Date(msg.timestamp).toLocaleTimeString('ar-LY');
      const isExtracted = msg.status === 'extracted';
      const badge = isExtracted 
        ? '<span class="status-badge" style="color:#10b981; background:rgba(16,185,129,0.15);">✅ تم استخراج أسعار</span>'
        : '<span class="status-badge" style="color:#f43f5e; background:rgba(244,63,94,0.15);">⚠️ تم التجاهل</span>';

      let ratesHtml = '';
      if (isExtracted && msg.extractedRates && msg.extractedRates.length > 0) {
        ratesHtml = '<div style="margin-top:6px; display:flex; flex-wrap:wrap; gap:4px;">' + 
          msg.extractedRates.map((r: any) => `<span class="extracted-pill font-num">💵 ${r.code}: ${Number(r.value).toFixed(2)}</span>`).join('') + 
          '</div>';
      } else if (msg.ignoreReason) {
        ratesHtml = `<div style="margin-top:4px; font-size:11px; color:#f43f5e;">سبب التجاهل: ${msg.ignoreReason}</div>`;
      }

      preMessagesHtml += `
        <div class="feed-item">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
            <span style="font-weight:700; color:#38bdf8; font-size:12px;">${msg.source}</span>
            <div style="display:flex; align-items:center; gap:6px;">
              ${badge}
              <span style="color:#64748b; font-size:11px;" class="font-num">${time}</span>
            </div>
          </div>
          <div style="font-size:12px; color:#cbd5e1; background:#0f172a; padding:8px; border-radius:6px; white-space:pre-wrap; word-break:break-all;">${msg.rawText}</div>
          ${ratesHtml}
        </div>
      `;
    }
  }

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>مؤشر الدينار | تحديث أسعار العملات والذهب في ليبيا</title>
  
  <!-- OpenGraph & Social Link Preview Cards -->
  <meta property="og:site_name" content="مؤشر الدينار">
  <meta property="og:title" content="📊 مؤشر الدينار | أسعار العملات والذهب في ليبيا">
  <meta property="og:description" content="تحديث حي ومباشر لأسعار الدولار واليورو والذهب والعملات في السوق الموازي والبنك المركزي طرابلس لحظة بلحظة.">
  <meta property="og:image" content="https://worker-server-89vz.onrender.com/banner.jpg">
  <meta property="og:image:secure_url" content="https://worker-server-89vz.onrender.com/banner.jpg">
  <meta property="og:image:type" content="image/jpeg">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:type" content="website">
  
  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="📊 مؤشر الدينار | أسعار العملات والذهب في ليبيا">
  <meta name="twitter:description" content="تحديث حي ومباشر لأسعار الدولار واليورو والذهب والعملات في السوق الموازي طرابلس.">
  <meta name="twitter:image" content="https://worker-server-89vz.onrender.com/banner.jpg">
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
    .btn-danger {
      background: #e11d48;
      color: #ffffff;
      border-color: #be123c;
    }
    .btn-danger:hover {
      background: #be123c;
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

    /* ─── TABS ─── */
    .tabs-nav {
      display: flex;
      overflow-x: auto;
      gap: 6px;
      padding-bottom: 6px;
      margin-bottom: 14px;
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

    /* ─── DEDICATED MANUAL EDITABLE TABLE ─── */
    .manual-table-wrapper {
      width: 100%;
      overflow-x: auto;
      border: 1px solid #334155;
      border-radius: 10px;
      background: #0f172a;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
    }
    .manual-table {
      width: 100%;
      border-collapse: collapse;
      text-align: right;
      font-size: 13px;
    }
    .manual-table th {
      background: #1e293b;
      color: #94a3b8;
      font-weight: 700;
      font-size: 12px;
      padding: 12px 14px;
      border-bottom: 1px solid #334155;
      white-space: nowrap;
    }
    .manual-table td {
      padding: 10px 14px;
      border-bottom: 1px solid #1e293b;
      vertical-align: middle;
    }
    .manual-table tr:hover {
      background: rgba(30, 41, 59, 0.45);
    }
    .manual-table tr.manual-row-selected {
      background: rgba(16, 185, 129, 0.05);
    }
    .manual-table-input {
      background: #020617;
      border: 1px solid #38bdf8;
      border-radius: 6px;
      color: #ffffff;
      font-weight: 700;
      font-size: 15px;
      padding: 7px 12px;
      width: 140px;
      text-align: center;
      transition: all 0.15s ease;
    }
    .manual-table-input:focus {
      outline: none;
      border-color: #10b981;
      box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.25);
      background: #0f172a;
    }

    /* ─── RATES CARDS ─── */
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

    /* ─── ACCOUNTS & TOGGLES CARDS ─── */
    .section-card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 14px;
      margin-bottom: 12px;
    }
    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
    }
    .section-title {
      font-size: 14px;
      font-weight: 700;
      color: #ffffff;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .form-group {
      margin-bottom: 10px;
    }
    .form-label {
      display: block;
      font-size: 11px;
      color: #94a3b8;
      margin-bottom: 4px;
    }
    .form-input {
      width: 100%;
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 8px;
      color: #f1f5f9;
      padding: 8px 10px;
      font-size: 13px;
      font-family: inherit;
    }
    .form-input:focus {
      outline: none;
      border-color: #10b981;
    }

    /* Toggle Switch */
    .toggle-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 0;
      border-bottom: 1px solid rgba(51, 65, 85, 0.4);
    }
    .toggle-row:last-child {
      border-bottom: none;
    }
    .toggle-title {
      font-size: 13px;
      font-weight: 600;
      color: #f1f5f9;
    }
    .toggle-desc {
      font-size: 11px;
      color: #64748b;
    }
    .switch {
      position: relative;
      display: inline-block;
      width: 44px;
      height: 24px;
    }
    .switch input {
      opacity: 0;
      width: 0;
      height: 0;
    }
    .slider {
      position: absolute;
      cursor: pointer;
      inset: 0;
      background-color: #334155;
      transition: .2s;
      border-radius: 24px;
    }
    .slider:before {
      position: absolute;
      content: "";
      height: 18px;
      width: 18px;
      left: 3px;
      bottom: 3px;
      background-color: white;
      transition: .2s;
      border-radius: 50%;
    }
    input:checked + .slider {
      background-color: #10b981;
    }
    input:checked + .slider:before {
      transform: translateX(20px);
    }

    /* ─── INGESTED FEED ITEMS ─── */
    .feed-item {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 10px;
      padding: 10px 12px;
      margin-bottom: 8px;
    }
    .extracted-pill {
      font-size: 11px;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: 6px;
      background: rgba(16, 185, 129, 0.2);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.4);
    }

    /* ─── MODAL & TOAST ─── */
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
    }

    /* ─── TERMS & CURRENCY SETTINGS ─── */
    .terms-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 10px;
      margin-bottom: 16px;
    }
    @media (min-width: 640px) {
      .terms-grid {
        grid-template-columns: repeat(2, 1fr);
      }
    }
    @media (min-width: 1024px) {
      .terms-grid {
        grid-template-columns: repeat(3, 1fr);
      }
    }
    .term-card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 12px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 10px;
      transition: border-color 0.2s;
    }
    .term-card:hover {
      border-color: #38bdf8;
    }
    .term-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .term-title {
      font-size: 13px;
      font-weight: 700;
      color: #f8fafc;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .term-badge {
      font-size: 10px;
      font-family: monospace;
      padding: 2px 6px;
      border-radius: 4px;
      background: #0f172a;
      color: #38bdf8;
      border: 1px solid #334155;
    }
    .term-range-badge {
      background: rgba(16, 185, 129, 0.12);
      border: 1px solid rgba(16, 185, 129, 0.3);
      color: #34d399;
      font-size: 11px;
      font-weight: 700;
      padding: 4px 8px;
      border-radius: 6px;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .term-regex-box {
      font-family: monospace;
      font-size: 10px;
      color: #94a3b8;
      background: #0f172a;
      padding: 6px 8px;
      border-radius: 6px;
      border: 1px solid #334155;
      max-height: 48px;
      overflow-y: auto;
      word-break: break-all;
      direction: ltr;
      text-align: left;
    }
    .modal-box-large {
      max-width: 520px !important;
    }

    .hidden { display: none !important; }
  </style>
</head>
<body>

  <!-- EMBEDDED INITIAL STATE -->
  <script id="initial-dashboard-state" type="application/json">
    ${JSON.stringify(initialState || {})}
  </script>

  <!-- HEADER -->
  <header class="header">
    <div class="header-content">
      <div class="brand-title">
        <span>⚡ لوحة العمليات والحسابات</span>
        <span class="status-badge" id="badge-server-status">● متصل</span>
      </div>

      <div class="header-actions">
        <span class="status-badge" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; border-color: rgba(56, 189, 248, 0.3); font-size: 11px;">🛡️ جلسة آمنة</span>
        <button class="btn btn-secondary btn-sm" onclick="fetchDashboardData(true)" id="btn-refresh">
          🔄 تحديث
        </button>
        <button class="btn btn-primary btn-sm" onclick="triggerJob('refresh', 'تحديث شامل للأسعار')">
          ⚡ جلب الآن
        </button>
        <button class="btn btn-secondary btn-sm" onclick="logoutAdmin()" style="border-color: rgba(239, 68, 68, 0.4); color: #fca5a5;" title="تسجيل الخروج وإنهاء الجلسة">
          🚪 خروج
        </button>
      </div>
    </div>
  </header>

  <!-- MAIN CONTAINER -->
  <div class="container">

    <!-- KPI STRIP -->
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-title">💵 الدولار الموازي</div>
        <div class="kpi-val font-num" id="kpi-usd">${usdParallel.toFixed(2)} د.ل</div>
        <div class="kpi-sub">المركزي: <span class="font-num" id="kpi-cbl">${usdCbl.toFixed(2)}</span></div>
      </div>

      <div class="kpi-card">
        <div class="kpi-title">⏱️ وقت التشغيل</div>
        <div class="kpi-val font-num" id="kpi-uptime">${formattedUptime}</div>
        <div class="kpi-sub" id="kpi-date">نشط</div>
      </div>

      <div class="kpi-card">
        <div class="kpi-title">📱 اتصال تيليجرام</div>
        <div class="kpi-val" id="kpi-tg">${tgConnected ? '🟢 متصل' : '⚠️ غير متصل'}</div>
        <div class="kpi-sub">قنوات الصرف</div>
      </div>

      <div class="kpi-card">
        <div class="kpi-title">💬 اتصال واتساب</div>
        <div class="kpi-val" id="kpi-wa">${waStatus === 'connected' ? '🟢 متصل' : waStatus === 'scan_qr' ? '📱 امسح الرمز' : '⚠️ غير متصل'}</div>
        <div class="kpi-sub">مجموعات الصرف</div>
      </div>
    </div>

    <!-- TABS BAR (EXPANDED TO INCLUDE SETTINGS, ACCOUNTS AND INGESTION) -->
    <div class="tabs-nav">
      <button class="tab-item active" onclick="switchTab('rates')" id="tab-btn-rates">📊 الأسعار</button>
      <button class="tab-item" onclick="switchTab('manual')" id="tab-btn-manual" style="background:#0284c7; color:#fff; border-color:#38bdf8;">✏️ التحديث اليدوي والنشر</button>
      <button class="tab-item" onclick="switchTab('settings')" id="tab-btn-settings">⚙️ إعدادات العملات والشروط</button>
      <button class="tab-item" onclick="switchTab('sources')" id="tab-btn-sources">📡 مصادر القنوات والواتساب</button>
      <button class="tab-item" onclick="switchTab('accounts')" id="tab-btn-accounts">🔗 الحسابات والربط</button>
      <button class="tab-item" onclick="switchTab('ingested')" id="tab-btn-ingested">📥 الرسائل الملتقطة</button>
      <button class="tab-item" onclick="switchTab('jobs')" id="tab-btn-jobs">⚡ المهام (8)</button>
      <button class="tab-item" onclick="switchTab('broadcast')" id="tab-btn-broadcast">📢 البث والنشر</button>
      <button class="tab-item" onclick="switchTab('logs')" id="tab-btn-logs">📜 السجلات</button>
    </div>

    <!-- TAB 1: RATES & MARKET -->
    <div id="tab-content-rates">
      
      <!-- Quick Action Buttons -->
      <div style="display:grid; grid-template-columns:repeat(2, 1fr); gap:8px; margin-bottom:8px;">
        <button class="btn btn-action" onclick="triggerJob('cbl', 'جلب مصرف ليبيا المركزي')">
          🏦 جلب أسعار CBL
        </button>
        <button class="btn btn-action" onclick="triggerJob('telegram', 'جلب أسعار تيليجرام')">
          📱 جلب تيليجرام الموازي
        </button>
      </div>

      <!-- Manual Price Entry & Intelligent Auto-Broadcast Buttons -->
      <div style="display:grid; grid-template-columns:repeat(2, 1fr); gap:8px; margin-bottom:14px;">
        <button class="btn btn-primary" onclick="switchTab('manual'); selectManualCategory('currencies');" style="background: linear-gradient(135deg, #0284c7, #0369a1); border-color: #38bdf8; font-size: 13px; font-weight: 700; padding: 10px 12px; box-shadow: 0 4px 12px rgba(2,132,199,0.25);">
          💵 جدول تعديل ونشر العملات
        </button>
        <button class="btn btn-primary" onclick="switchTab('manual'); selectManualCategory('metals');" style="background: linear-gradient(135deg, #d97706, #b45309); border-color: #fbbf24; font-size: 13px; font-weight: 700; padding: 10px 12px; box-shadow: 0 4px 12px rgba(217,119,6,0.25);">
          🪙 جدول تعديل ونشر المعادن
        </button>
      </div>

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

    <!-- DEDICATED INDEPENDENT TAB: MANUAL PRICE ENTRY & SMART BROADCAST -->
    <div id="tab-content-manual" class="hidden">

      <!-- Section Header Card -->
      <div class="section-card" style="margin-bottom: 14px;">
        <div class="section-header" style="flex-wrap: wrap; gap: 8px;">
          <div>
            <div class="section-title" style="display:flex; align-items:center; gap:8px;">
              <span>✏️ قسم التدخل والتحديث اليدوي للأسعار والنشر الذكي</span>
            </div>
            <div style="font-size: 11px; color: #94a3b8; margin-top: 4px; max-width: 720px; line-height: 1.6;">
              قسم مستقل للتحكم وتحديث أسعار العملات أو المعادن بشكل جماعي أو فردي. اختر جدول العملات أو جدول المعادن لتحرير الأسعار بسهولة، حدد الأصناف المراد نشرها، أدخل الأسعار الجديدة، واحفظها فوراً في قاعدة البيانات مع النشر التلقائي الذكي بتسلسل دقيق على القنوات.
            </div>
          </div>
        </div>

        <!-- The Two Main Category Buttons (Currencies vs Metals) -->
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-top: 14px;">
          <button id="manual-cat-btn-currencies" class="btn" onclick="selectManualCategory('currencies')" style="background: linear-gradient(135deg, #0284c7, #0369a1); border: 2px solid #38bdf8; color: #ffffff; font-size: 14px; font-weight: 700; padding: 12px 14px; border-radius: 10px; display: flex; align-items: center; justify-content: center; gap: 8px; box-shadow: 0 4px 14px rgba(2,132,199,0.3);">
            <span style="font-size: 20px;">💵</span>
            <span>جدول أسعار العملات في السوق الموازي</span>
          </button>
          <button id="manual-cat-btn-metals" class="btn" onclick="selectManualCategory('metals')" style="background: #1e293b; border: 1px solid #334155; color: #cbd5e1; font-size: 14px; font-weight: 700; padding: 12px 14px; border-radius: 10px; display: flex; align-items: center; justify-content: center; gap: 8px; transition: all 0.2s ease;">
            <span style="font-size: 20px;">🪙</span>
            <span>جدول أسعار الذهب والمعادن الثمينة</span>
          </button>
        </div>
      </div>

      <!-- Table Toolbar Card: Search, Select/Deselect All, Broadcast Settings -->
      <div class="section-card" style="margin-bottom: 14px;">
        <div style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 10px; padding-bottom: 12px; border-bottom: 1px solid #334155;">
          
          <!-- Select All / Deselect All / Reset -->
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <button class="btn btn-secondary btn-sm" onclick="toggleAllManualRows(true)">
              ☑️ تحديد الكل
            </button>
            <button class="btn btn-secondary btn-sm" onclick="toggleAllManualRows(false)">
              ◻️ إلغاء تحديد الكل
            </button>
            <button class="btn btn-secondary btn-sm" onclick="resetManualTableToCurrentPrices()">
              🔄 استعادة الأسعار الأصلية
            </button>
            <div style="font-size: 12px; color: #cbd5e1; margin-right: 6px;">
              المحدد: <strong id="manual-table-selected-badge" class="font-num" style="color: #10b981; font-size: 14px;">0</strong> من <span id="manual-table-total-badge" class="font-num">0</span> صنف
            </div>
          </div>

          <!-- Quick Filter Input -->
          <div style="display: flex; align-items: center; gap: 6px;">
            <input type="text" id="manual-table-search-input" class="form-input" placeholder="🔍 تصفية الجدول بالاسم أو الكود..." style="width: 220px; font-size: 12px; padding: 6px 10px;" oninput="filterManualTableRows()">
          </div>
        </div>

        <!-- Publishing Controls & Big Save Button -->
        <div style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 10px; margin-top: 12px;">
          <div style="display: flex; align-items: center; gap: 16px; flex-wrap: wrap;">
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 13px; color: #f8fafc; font-weight: 700;">
              <input type="checkbox" id="manual-table-auto-broadcast" checked style="accent-color: #10b981; width: 18px; height: 18px; cursor: pointer;">
              <span>📢 نشر تلقائي فوري بعد الحفظ بتسلسل احترافي</span>
            </label>

            <div style="display: flex; align-items: center; gap: 6px;">
              <span style="font-size: 12px; color: #94a3b8;">منصة النشر:</span>
              <select id="manual-table-broadcast-target" class="form-input" style="font-size: 12px; padding: 5px 8px; width: auto;">
                <option value="all">📱 تيليجرام + فيسبوك (الكل)</option>
                <option value="telegram">✈️ تيليجرام فقط</option>
                <option value="facebook">📘 فيسبوك فقط</option>
              </select>
            </div>
          </div>

          <!-- Primary Save & Publish Button -->
          <button class="btn btn-primary" onclick="submitManualTableRates()" id="btn-manual-table-submit" style="font-size: 13px; font-weight: 700; padding: 10px 18px; box-shadow: 0 4px 14px rgba(16,185,129,0.3);">
            💾 حفظ التعديلات ونشر النشرة الآن
          </button>
        </div>
      </div>

      <!-- Editable Table Container -->
      <div class="manual-table-wrapper" style="margin-bottom: 20px;">
        <table class="manual-table">
          <thead>
            <tr>
              <th style="width: 45px; text-align: center;">
                <input type="checkbox" id="manual-th-select-all" checked onchange="toggleAllManualRows(this.checked)" style="accent-color: #10b981; width: 17px; height: 17px; cursor: pointer;" title="تحديد / إلغاء تحديد الكل">
              </th>
              <th style="min-width: 170px;">الصنف / العملة</th>
              <th style="min-width: 110px; text-align: center;">السعر الحالي المسجل</th>
              <th style="min-width: 160px; text-align: center;">السعر الجديد (مربع التحرير)</th>
              <th style="min-width: 120px; text-align: center;">مؤشر التغير اللحظي</th>
              <th style="min-width: 100px; text-align: center;">حالة التضمين</th>
            </tr>
          </thead>
          <tbody id="manual-table-tbody">
            <!-- Rendered dynamically -->
          </tbody>
        </table>
      </div>

    </div>

    <!-- TAB: CURRENCY EXTRACTION SETTINGS & RULES -->
    <div id="tab-content-settings" class="hidden">
      
      <!-- Action & Intro Bar -->
      <div class="section-card" style="margin-bottom:12px;">
        <div class="section-header" style="flex-wrap:wrap; gap:8px;">
          <div>
            <div class="section-title">
              <span>⚙️ إعدادات وشروط استخراج العملات (من تيليجرام وواتساب)</span>
            </div>
            <div style="font-size:11px; color:#94a3b8; margin-top:3px; max-width:650px; line-height:1.5;">
              تحكم في كروت جميع العملات المطلوب جلبها، وحدد شروط الحد الأدنى والأقصى للاستخراج (مثال: دولار من 9 إلى 12)، وحرر الكلمات الدلالية وأنماط المطابقة. تُحفظ التغييرات تلقائياً في قاعدة البيانات وتُطبق فوراً على الرسائل القادمة.
            </div>
          </div>
          <div style="display:flex; gap:6px; flex-wrap:wrap;">
            <button class="btn btn-primary btn-sm" onclick="openTermModal()">
              ➕ إضافة عملة جديدة
            </button>
            <button class="btn btn-secondary btn-sm" onclick="syncTermsFromDB()">
              🔄 مزامنة من قاعدة البيانات
            </button>
          </div>
        </div>

        <!-- Search and count bar -->
        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-top:12px; flex-wrap:wrap;">
          <input type="text" id="terms-search-input" class="form-input" placeholder="🔍 بحث بالاسم أو الكود (USD, يورو, ذهب...)" style="max-width:280px;" oninput="filterTermsCards()">
          <div style="font-size:12px; color:#94a3b8;">
            إجمالي العملات المعتمدة: <strong id="terms-count-badge" class="font-num" style="color:#38bdf8;">0</strong> عملة
          </div>
        </div>
      </div>

      <!-- Currency Cards Grid -->
      <div class="terms-grid" id="terms-cards-container">
        <!-- Rendered dynamically -->
      </div>
    </div>

    <!-- TAB: SOURCES & CHANNELS MANAGEMENT -->
    <div id="tab-content-sources" class="hidden">
      <!-- Section Intro Header -->
      <div class="section-card" style="margin-bottom:12px;">
        <div class="section-header">
          <div>
            <div class="section-title">📡 إدارة مصادر الأسعار والقنوات (تيليجرام وواتساب)</div>
            <div style="font-size:11px; color:#94a3b8; margin-top:3px; max-width:700px; line-height:1.5;">
              إدارة القنوات والمجموعات المراقبة لاستخراج أسعار الصرف. يمكنك إضافة قنوات تيليجرام جديدة أو تعديلها وحذفها، بالإضافة لمزامنة كافة مجموعات وقنوات واتساب المنضم إليها حسابك مع إمكانية التفعيل أو التعطيل لكل مصدر.
            </div>
          </div>
          <button class="btn btn-primary btn-sm" onclick="loadSourcesData()">
            🔄 تحديث قائمة المصادر
          </button>
        </div>
      </div>

      <!-- Grid for Telegram Channels & WhatsApp Sources -->
      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap:12px;">
        
        <!-- CARD 1: TELEGRAM CHANNELS -->
        <div class="card" style="background:#0f172a; border:1px solid #1e293b; border-radius:10px; padding:14px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; border-bottom:1px solid #1e293b; padding-bottom:8px;">
            <div style="font-size:13px; font-weight:700; color:#38bdf8; display:flex; align-items:center; gap:6px;">
              <span>✈️ قنوات تيليجرام المراقبة</span>
              <span id="tg-channels-count" class="badge" style="background:rgba(56,189,248,0.2); color:#38bdf8; font-size:10px;">0</span>
            </div>
          </div>

          <!-- Add Tg Channel Inline Bar -->
          <div style="display:flex; gap:6px; margin-bottom:12px;">
            <input type="text" id="add-tg-input" class="form-input" placeholder="اسم القناة (مثال: dollar_ly أو @dollarr_ly)" style="font-size:11px; padding:6px 10px;">
            <button class="btn btn-primary btn-sm" onclick="addTgChannel()" style="white-space:nowrap;">إضافة</button>
          </div>

          <!-- List Container -->
          <div id="tg-channels-list-container" style="display:flex; flex-direction:column; gap:6px; max-height:400px; overflow-y:auto;">
            <div style="color:#64748b; font-size:11px; text-align:center; padding:15px;">جاري تحميل قنوات تيليجرام...</div>
          </div>
        </div>

        <!-- CARD 2: WHATSAPP SOURCES & JOINED GROUPS -->
        <div class="card" style="background:#0f172a; border:1px solid #1e293b; border-radius:10px; padding:14px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; border-bottom:1px solid #1e293b; padding-bottom:8px;">
            <div style="font-size:13px; font-weight:700; color:#22c55e; display:flex; align-items:center; gap:6px;">
              <span>💬 مجموعات وقنوات واتساب المنضم إليها</span>
              <span id="wa-sources-count" class="badge" style="background:rgba(34,197,94,0.2); color:#22c55e; font-size:10px;">0</span>
            </div>
            <button class="btn btn-secondary btn-sm" onclick="refreshWhatsAppChats()" style="font-size:11px; padding:4px 8px;">
              🔄 مزامنة المجموعات
            </button>
          </div>

          <!-- Add Manual WhatsApp Source Inline Bar -->
          <div style="display:flex; gap:6px; margin-bottom:12px;">
            <input type="text" id="add-wa-name-input" class="form-input" placeholder="اسم المصدر/المجموعة" style="font-size:11px; padding:6px 8px; flex:1;">
            <input type="text" id="add-wa-jid-input" class="form-input" placeholder="معرف JID (اختياري)" style="font-size:11px; padding:6px 8px; flex:1;">
            <button class="btn btn-primary btn-sm" onclick="addWhatsAppSourceManual()" style="white-space:nowrap;">إضافة</button>
          </div>

          <!-- WhatsApp Sources List -->
          <div id="wa-sources-list-container" style="display:flex; flex-direction:column; gap:6px; max-height:400px; overflow-y:auto;">
            <div style="color:#64748b; font-size:11px; text-align:center; padding:15px;">جاري تحميل مصادر واتساب...</div>
          </div>
        </div>

      </div>
    </div>

    <!-- TAB 2: ACCOUNTS & INTEGRATIONS (NEW) -->
    <div id="tab-content-accounts" class="hidden">
      
      <!-- 1. TELEGRAM ACCOUNT -->
      <div class="section-card">
        <div class="section-header">
          <div class="section-title">
            <span>📱 تسجيل دخول وربط حساب تيليجرام (Telegram Client)</span>
          </div>
          <span class="status-badge" id="acc-tg-badge">
            ${tgConnected ? '🟢 متصل' : '⚠️ غير متصل'}
          </span>
        </div>

        <div style="font-size:12px; color:#94a3b8; margin-bottom:12px;">
          قم بربط حسابك عبر رقم الهاتف وتأكيد الرمز وكلمة المرور الثنائية (2FA) لتوليد الجلسة وحفظها تلقائياً.
        </div>

        <!-- Configuration Inputs (Can be set via Render Environment Variables: TELEGRAM_API_ID and TELEGRAM_API_HASH) -->
        <div style="display:grid; grid-template-columns: repeat(2, 1fr); gap:8px; margin-bottom:8px;">
          <div class="form-group" style="margin-bottom:4px;">
            <label class="form-label">App api_id (TELEGRAM_API_ID):</label>
            <input type="text" id="tg-api-id" class="form-input font-num" value="${initialState?.accounts?.telegram?.apiId || ''}" placeholder="معرف التطبيق api_id">
          </div>
          <div class="form-group" style="margin-bottom:4px;">
            <label class="form-label">App api_hash (TELEGRAM_API_HASH):</label>
            <input type="password" id="tg-api-hash" class="form-input font-num" placeholder="${initialState?.accounts?.telegram?.hasApiHash ? 'موجود في البيئة (يمكن تركه فارغاً)' : 'رمز api_hash'}">
          </div>
        </div>

        <!-- STEP 1: Phone Number -->
        <div id="tg-login-step-1" style="background:#0f172a; padding:10px; border-radius:8px; border:1px solid #334155; margin-bottom:10px;">
          <div style="font-size:12px; font-weight:700; color:#38bdf8; margin-bottom:6px;">الخطوة 1: أدخل رقم الهاتف</div>
          <div class="form-group">
            <label class="form-label">رقم الهاتف الدولي (مع رمز الدولة، مثال: 21891XXXXXXX+):</label>
            <input type="tel" id="tg-phone-input" class="form-input font-num" placeholder="+21891XXXXXXX أو +21892XXXXXXX">
          </div>
          <button class="btn btn-primary btn-sm" onclick="sendTelegramCode()" id="btn-send-code" style="width:100%;">
            📩 إرسال كود التحقق (Send Code)
          </button>
        </div>

        <!-- STEP 2: Code Verification (Initially Hidden) -->
        <div id="tg-login-step-2" class="hidden" style="background:#0f172a; padding:10px; border-radius:8px; border:1px solid #38bdf8; margin-bottom:10px;">
          <div style="font-size:12px; font-weight:700; color:#38bdf8; margin-bottom:6px;">الخطوة 2: كود التحقق المستلم (OTP)</div>
          <div style="font-size:11px; color:#cbd5e1; margin-bottom:6px;">تم إرسال الكود إلى تطبيق تيليجرام الخاص بك. أدخله هنا:</div>
          <div class="form-group">
            <input type="text" id="tg-otp-input" class="form-input font-num" placeholder="12345" style="letter-spacing:4px; font-size:16px; text-align:center;">
          </div>
          <button class="btn btn-primary btn-sm" onclick="verifyTelegramCode()" id="btn-verify-code" style="width:100%;">
            ✅ تأكيد الكود
          </button>
        </div>

        <!-- STEP 3: 2FA Password (Initially Hidden) -->
        <div id="tg-login-step-3" class="hidden" style="background:#0f172a; padding:10px; border-radius:8px; border:1px solid #f59e0b; margin-bottom:10px;">
          <div style="font-size:12px; font-weight:700; color:#f59e0b; margin-bottom:4px;">الخطوة 3: كلمة المرور الثنائية (2FA Password)</div>
          <div style="font-size:11px; color:#cbd5e1; margin-bottom:6px;">حسابك محمي بالتحقق بخطوتين. أدخل كلمة المرور لإتمام الربط وحفظ الجلسة:</div>
          <div class="form-group">
            <input type="password" id="tg-2fa-input" class="form-input" placeholder="كلمة المرور الثنائية الخاصة بحسابك...">
          </div>
          <button class="btn btn-primary btn-sm" onclick="verifyTelegram2FA()" id="btn-verify-2fa" style="width:100%; background:#f59e0b; border-color:#d97706;">
            🔓 تأكيد كلمة المرور وحفظ الجلسة الدائمة
          </button>
        </div>

        <!-- Advanced or Direct Session String -->
        <details style="margin-top:10px; font-size:12px; color:#94a3b8; background:#0f172a; border-radius:8px; padding:8px; border:1px solid #334155;">
          <summary style="cursor:pointer; font-weight:600; color:#cbd5e1;">خيارات متقدمة (قناة النشر / كود جلسة جاهز / Bot Token)</summary>
          <div style="margin-top:8px;">
            <div class="form-group">
              <label class="form-label">قناة النشر التلقائي (@channel):</label>
              <input type="text" id="tg-post-channel-input" class="form-input" value="${initialState?.accounts?.telegram?.channel || 'lydollar'}">
            </div>
            <div class="form-group">
              <label class="form-label">جلسة جاهزة (Session String):</label>
              <input type="password" id="tg-session-input" class="form-input" placeholder="ألصق كود الجلسة المشفرة مباشرة هنا إذا كان متوفراً لديك...">
            </div>
            <div class="form-group">
              <label class="form-label">أو توكن بوت تيليجرام (Bot Token):</label>
              <input type="password" id="tg-bot-token-input" class="form-input font-num" placeholder="123456789:ABCdef...">
            </div>
            <button class="btn btn-secondary btn-sm" onclick="saveTelegramSettings()" style="width:100%;">
              💾 حفظ الإعدادات المتقدمة
            </button>
          </div>
        </details>

        <!-- Quick Action Buttons -->
        <div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:10px;">
          <button class="btn btn-secondary btn-sm" onclick="reconnectTelegram()">
            🔄 فحص وإعادة الاتصال
          </button>
          <button class="btn btn-danger btn-sm" onclick="disconnectTelegram()">
            ❌ قطع الاتصال
          </button>
        </div>
      </div>

      <!-- 2. WHATSAPP ACCOUNT -->
      <div class="section-card">
        <div class="section-header">
          <div class="section-title">
            <span>💬 حساب واتساب (WhatsApp Web / Baileys)</span>
          </div>
          <span class="status-badge" id="acc-wa-badge">
            ${waStatus === 'connected' ? '🟢 متصل' : waStatus === 'scan_qr' ? '📱 امسح الرمز' : '⚠️ غير متصل'}
          </span>
        </div>

        <div id="wa-details-box" style="font-size:12px; color:#cbd5e1; margin-bottom:10px;">
          <div>الحالة: <strong id="wa-status-text">${waStatus === 'connected' ? 'متصل وجاهز للاستقبال والإرسال' : 'غير متصل'}</strong></div>
          <div id="wa-phone-text">${initialState?.accounts?.whatsapp?.phoneNumber ? 'الرقم: ' + initialState.accounts.whatsapp.phoneNumber : ''}</div>
        </div>

        <!-- QR Code Container -->
        <div id="wa-qr-container" class="${initialState?.accounts?.whatsapp?.qrCodeUrl ? '' : 'hidden'}" style="text-align:center; padding:10px; background:#0f172a; border-radius:8px; margin-bottom:10px;">
          <div style="font-size:12px; color:#38bdf8; font-weight:700; margin-bottom:6px;">امسح رمز QR بكاميرا واتساب:</div>
          <img id="wa-qr-image" src="${initialState?.accounts?.whatsapp?.qrCodeUrl || ''}" alt="WhatsApp QR Code" style="max-width:200px; margin:0 auto; border-radius:8px; background:white; padding:6px;">
        </div>

        <div style="display:flex; gap:6px; flex-wrap:wrap;">
          <button class="btn btn-primary btn-sm" onclick="initWhatsApp()">
            📱 تشغيل والربط (QR)
          </button>
          <button class="btn btn-secondary btn-sm" onclick="initWhatsApp()">
            🔄 إعادة الاتصال
          </button>
          <button class="btn btn-danger btn-sm" onclick="disconnectWhatsApp()">
            ❌ تسجيل الخروج
          </button>
        </div>
      </div>

      <!-- 3. FACEBOOK ACCOUNT -->
      <div class="section-card">
        <div class="section-header">
          <div class="section-title">
            <span>🌐 صفحة فيسبوك (Facebook Page)</span>
          </div>
          <span class="status-badge" id="acc-fb-badge">
            ${initialState?.accounts?.facebook?.hasToken ? '🟢 التوكن مهيأ' : '⚠️ غير مكتمل'}
          </span>
        </div>

        <div class="form-group">
          <label class="form-label">معرف الصفحة (Page ID):</label>
          <input type="text" id="fb-page-id-input" class="form-input" value="${initialState?.accounts?.facebook?.pageId || ''}" placeholder="مثال: 1029384756...">
        </div>

        <div class="form-group">
          <label class="form-label">رمز الوصول الممتد (Page Access Token):</label>
          <input type="password" id="fb-token-input" class="form-input" placeholder="ألصق Access Token لصفحة فيسبوك...">
        </div>

        <div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:8px;">
          <button class="btn btn-primary btn-sm" onclick="saveFacebookSettings()">
            💾 حفظ الإعدادات
          </button>
          <button class="btn btn-secondary btn-sm" onclick="testFacebookPost()">
            📢 تجربة نشر الآن
          </button>
        </div>
      </div>

      <!-- 4. AUTOMATION & SOURCE TOGGLES -->
      <div class="section-card">
        <div class="section-title" style="margin-bottom:12px;">
          <span>⚙️ التحكم في مصادر الجلب والنشر التلقائي</span>
        </div>

        <div class="toggle-row">
          <div>
            <div class="toggle-title">🏦 جلب أسعار المصرف المركزي (CBL)</div>
            <div class="toggle-desc">تشغيل الكاشط التلقائي لموقع المصرف</div>
          </div>
          <label class="switch">
            <input type="checkbox" id="toggle-cbl" onchange="updateToggles()" ${initialState?.toggles?.cblFetchEnabled !== false ? 'checked' : ''}>
            <span class="slider"></span>
          </label>
        </div>

        <div class="toggle-row">
          <div>
            <div class="toggle-title">📱 جلب قنوات تيليجرام الموازي</div>
            <div class="toggle-desc">التقاط وتحليل رسائل قنوات الصرف اللحظية</div>
          </div>
          <label class="switch">
            <input type="checkbox" id="toggle-telegram" onchange="updateToggles()" ${initialState?.toggles?.telegramFetchEnabled !== false ? 'checked' : ''}>
            <span class="slider"></span>
          </label>
        </div>

        <div class="toggle-row">
          <div>
            <div class="toggle-title">💬 جلب مجموعات وقنوات واتساب</div>
            <div class="toggle-desc">معالجة الرسائل الواردة من تجار الصرف</div>
          </div>
          <label class="switch">
            <input type="checkbox" id="toggle-whatsapp" onchange="updateToggles()" ${initialState?.toggles?.whatsappFetchEnabled !== false ? 'checked' : ''}>
            <span class="slider"></span>
          </label>
        </div>

        <div class="toggle-row">
          <div>
            <div class="toggle-title">📢 النشر التلقائي في تيليجرام</div>
            <div class="toggle-desc">بث الأسعار الجديدة فور اعتمادها في القناة</div>
          </div>
          <label class="switch">
            <input type="checkbox" id="toggle-tg-auto" onchange="updateToggles()" ${initialState?.toggles?.telegramAutoPost ? 'checked' : ''}>
            <span class="slider"></span>
          </label>
        </div>

        <div class="toggle-row">
          <div>
            <div class="toggle-title">📢 النشر التلقائي في فيسبوك</div>
            <div class="toggle-desc">نشر التحديثات الدورية على صفحة فيسبوك</div>
          </div>
          <label class="switch">
            <input type="checkbox" id="toggle-fb-auto" onchange="updateToggles()" ${initialState?.toggles?.facebookAutoPost ? 'checked' : ''}>
            <span class="slider"></span>
          </label>
        </div>

      </div>

    </div>

    <!-- TAB 3: INGESTED MESSAGES (NEW) -->
    <div id="tab-content-ingested" class="hidden">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
        <div>
          <div style="font-size:13px; font-weight:700; color:#38bdf8;">📥 الرسائل الملتقطة من المصادر</div>
          <div style="font-size:11px; color:#64748b;">عرض الرسائل وتحليل الأسعار المستخرجة منها أو أسباب تجاهلها</div>
        </div>
        <button class="btn btn-secondary btn-sm" onclick="fetchIngestedMessages(true)">
          🔄 تحديث الرسائل
        </button>
      </div>

      <div id="ingested-feed-container">
        ${preMessagesHtml || '<div style="color: #64748b; font-size: 12px; padding: 12px;">لا توجد رسائل ملتقطة حالياً</div>'}
      </div>
    </div>

    <!-- TAB 4: JOBS (8) -->
    <div id="tab-content-jobs" class="hidden">
      <div style="font-size: 13px; font-weight: 700; color: #38bdf8; margin-bottom: 8px;">
        ⚙️ جميع مهام الخادم التلقائية
      </div>
      <div id="jobs-list-container">
        <div style="color: #64748b;">جاري تحميل المهام...</div>
      </div>
    </div>

    <!-- TAB 5: BROADCAST STUDIO & SMART QUEUE -->
    <div id="tab-content-broadcast" class="hidden">
      
      <!-- SMART QUEUE & ANTI-SPAM CONTROL CARD -->
      <div class="section-card" style="margin-bottom:12px; background:#1e293b; border:1px solid #334155;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; flex-wrap:wrap; gap:6px;">
          <div>
            <div style="font-size:14px; font-weight:700; color:#38bdf8;">📥 طابور التحديثات المجمعة وشروط منع الإزعاج</div>
            <div style="font-size:11px; color:#94a3b8;">تجميع التحديثات السريعة ودمجها في منشور موحد لمنع تكرار الإشعارات المزعجة للمتابعين</div>
          </div>
          <div style="display:flex; gap:6px; align-items:center;">
            <span id="queue-status-badge" class="status-badge" style="background:rgba(56,189,248,0.15); color:#38bdf8; font-size:11px; font-weight:700;">
              جاري الفحص...
            </span>
            <button class="btn btn-secondary btn-sm" onclick="openBroadcastPreviewModal()" title="معاينة شكل المنشور المنسق كما سيصل للمتابعين">👁️ معاينة</button>
            <button class="btn btn-primary btn-sm" onclick="flushBroadcastQueue()">🚀 نشر الطابور فوراً</button>
            <button class="btn btn-secondary btn-sm" onclick="clearBroadcastQueueClient()" title="مسح الطابور وتصفير الوقت للبدء من جديد">🗑️ مسح</button>
          </div>
        </div>

        <!-- LIVE COUNTDOWN TIMER BAR -->
        <div id="queue-countdown-box" style="background:linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.9)); border:1px solid #334155; border-radius:8px; padding:10px 14px; margin-bottom:12px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px;">
          <div style="display:flex; align-items:center; gap:12px;">
            <div id="queue-countdown-icon-wrap" style="width:40px; height:40px; border-radius:8px; background:rgba(56,189,248,0.12); border:1px solid rgba(56,189,248,0.25); display:flex; align-items:center; justify-content:center; font-size:20px; flex-shrink:0;">
              ⏳
            </div>
            <div>
              <div style="font-size:11px; color:#94a3b8; font-weight:600;">الوقت المتبقي حتى موعد النشر التلقائي القادم:</div>
              <div style="display:flex; align-items:baseline; gap:8px; margin-top:2px;">
                <span id="queue-countdown-clock" class="font-num" style="font-size:22px; font-weight:800; color:#38bdf8; letter-spacing:1px; font-family:monospace; line-height:1;">00:00</span>
                <span id="queue-countdown-status-text" style="font-size:11px; color:#94a3b8;">(جاهز للنشر)</span>
              </div>
            </div>
          </div>
          <div style="display:flex; gap:6px; align-items:center;">
            <button type="button" class="btn btn-secondary btn-sm" onclick="resetBroadcastCooldownOnly()" title="تصفير وإعادة تشغيل عداد الوقت للبدء من جديد" style="font-size:11px; padding:5px 10px;">
              🔄 إعادة تشغيل العداد
            </button>
            <button type="button" class="btn btn-secondary btn-sm" onclick="bypassBroadcastCooldown()" title="تجاوز فترة الانتظار وإتاحة النشر فوراً دون انتظار العداد" style="font-size:11px; padding:5px 10px; color:#34d399; border-color:rgba(52,211,153,0.3);">
              ⚡ إتاحة النشر فوراً
            </button>
          </div>
        </div>

        <!-- QUEUE ITEMS DISPLAY -->
        <div id="queue-items-container" style="background:#0f172a; border:1px solid #334155; border-radius:8px; padding:10px; margin-bottom:12px; min-height:50px;">
          <div style="color:#64748b; font-size:12px; text-align:center;">طابور التحديثات فارغ حالياً (لا توجد عملات بانتظار النشر)</div>
        </div>

        <!-- SETTINGS FORM -->
        <div style="border-top:1px solid #334155; padding-top:10px; margin-top:10px;">
          <div style="font-size:12px; font-weight:700; color:#cbd5e1; margin-bottom:8px;">⚙️ إعدادات شروط وفواصل النشر التلقائي:</div>
          
          <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap:10px; margin-bottom:10px;">
            <div class="form-group" style="margin-bottom:0;">
              <label class="form-label" style="font-size:11px;">الفاصل الزمني الأدنى بين المنشورات (بالدقائق):</label>
              <input type="number" id="setting-broadcast-interval" class="form-input font-num" min="1" max="180" placeholder="20">
              <div style="font-size:10px; color:#64748b; margin-top:2px;">الحد الأدنى للانتظار بين منشورين متتاليين للقناة</div>
            </div>

            <div class="form-group" style="margin-bottom:0;">
              <label class="form-label" style="font-size:11px;">فارق التغير الأدنى للعملات (د.ل):</label>
              <input type="number" id="setting-price-threshold" class="form-input font-num" step="0.005" min="0.001" placeholder="0.015">
              <div style="font-size:10px; color:#64748b; margin-top:2px;">استبعاد تغيرات القرش الهامشية لحين تراكم الفارق</div>
            </div>

            <div class="form-group" style="margin-bottom:0;">
              <label class="form-label" style="font-size:11px;">نافذة تجميع التحديثات في الطابور (بالثواني):</label>
              <input type="number" id="setting-agg-window" class="form-input font-num" min="10" max="300" placeholder="45">
              <div style="font-size:10px; color:#64748b; margin-top:2px;">زمن انتظار وصول باقي العملات قبل دمجها</div>
            </div>

            <div class="form-group" style="margin-bottom:0;">
              <label class="form-label" style="font-size:11px;">الحد الأقصى للمنشورات في الساعة:</label>
              <input type="number" id="setting-hourly-cap" class="form-input font-num" min="1" max="20" placeholder="4">
              <div style="font-size:10px; color:#64748b; margin-top:2px;">سقف المنشورات التلقائية لكل ساعة حماية للقناة</div>
            </div>
          </div>

          <!-- QUIET HOURS CONFIGURATION -->
          <div style="margin-top:12px; margin-bottom:12px; padding:10px 12px; background:rgba(15,23,42,0.6); border:1px solid #334155; border-radius:8px;">
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:8px;">
              <label style="font-size:12px; color:#fbbf24; font-weight:700; display:flex; align-items:center; gap:6px; cursor:pointer;">
                <input type="checkbox" id="setting-quiet-hours-enabled">
                <span>🌙 تفعيل ساعات الصمت الليلي (كتم النشر التلقائي أثناء نوم المتابعين)</span>
              </label>
              <span style="font-size:10px; color:#94a3b8;">توقيت ليبيا (UTC+2)</span>
            </div>

            <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap:10px;">
              <div class="form-group" style="margin-bottom:0;">
                <label class="form-label" style="font-size:11px;">بداية الصمت الليلي:</label>
                <input type="time" id="setting-quiet-hours-start" class="form-input font-num" value="01:00">
                <div style="font-size:10px; color:#64748b; margin-top:2px;">بدء حظر إرسال الإشعارات التلقائية للمتابعين</div>
              </div>
              <div class="form-group" style="margin-bottom:0;">
                <label class="form-label" style="font-size:11px;">انتهاء الصمت الليلي (استئناف النشر):</label>
                <input type="time" id="setting-quiet-hours-end" class="form-input font-num" value="08:30">
                <div style="font-size:10px; color:#64748b; margin-top:2px;">موعد استئناف النشر وإرسال النشرة الصباحية المجمعة</div>
              </div>
            </div>
            <div style="font-size:10px; color:#64748b; margin-top:6px;">💡 يتم الاحتفاظ بالتحديثات في الطابور ونشرها صباحاً دون إزعاج. النشر اليدوي عبر "نشر الطابور فوراً" متاح في أي وقت.</div>
          </div>

          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
            <label style="font-size:12px; color:#38bdf8; display:flex; align-items:center; gap:6px; cursor:pointer;">
              <input type="checkbox" id="setting-smart-consolidated" checked>
              <span>تفعيل الدمج التلقائي الذكي في منشور موحد وأنيق</span>
            </label>

            <button class="btn btn-primary btn-sm" onclick="saveBroadcastSettings()">💾 حفظ شروط وإعدادات النشر</button>
          </div>
        </div>
      </div>

      <div class="section-card">
        <div style="font-size: 13px; font-weight: 700; color: #38bdf8; margin-bottom: 8px;">
          📢 إرسال ونشر رسالة مخصصة
        </div>
        
        <div style="display: flex; gap: 6px; margin-bottom: 8px;">
          <button class="btn btn-secondary btn-sm" onclick="setBroadcastText('rates')">قالب أسعار الصرف</button>
          <button class="btn btn-secondary btn-sm" onclick="setBroadcastText('gold')">قالب أسعار الذهب</button>
        </div>

        <textarea id="broadcast-input" style="width:100%; min-height:90px; background:#0f172a; border:1px solid #334155; border-radius:8px; color:#fff; padding:10px; font-size:13px;" placeholder="اكتب نص الرسالة هنا..."></textarea>

        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; margin-top:8px;">
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

    <!-- TAB 6: LIVE LOGS -->
    <div id="tab-content-logs" class="hidden">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
        <div style="font-size: 13px; font-weight: 700; color: #38bdf8;">
          📜 سجل الأحداث والعمليات (Live Logs)
        </div>
        <button class="btn btn-secondary btn-sm" onclick="clearLiveLogs()">
          مسح السجلات
        </button>
      </div>
      <div class="logs-container" id="logs-feed" style="background:#020617; border:1px solid #334155; border-radius:10px; padding:10px; font-family:monospace; font-size:11px; height:380px; overflow-y:auto; color:#cbd5e1;">
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

  <!-- BROADCAST QUEUE LIVE PREVIEW MODAL -->
  <div id="queue-preview-modal" class="modal-overlay hidden">
    <div class="modal-box modal-box-large" style="max-width:580px; max-height:92vh; display:flex; flex-direction:column; padding:0; overflow:hidden;">
      <div style="padding:14px 18px; background:#0f172a; border-bottom:1px solid #334155; display:flex; justify-content:space-between; align-items:center;">
        <div>
          <div style="font-size:15px; font-weight:800; color:#ffffff; display:flex; align-items:center; gap:8px;">
            <span>👁️ معاينة شكل المنشور الموحد</span>
          </div>
          <div style="font-size:11px; color:#94a3b8; margin-top:2px;">
            هذا هو الشكل النهائي للرسالة الموحدة المدمجة كما ستظهر تماماً للمتابعين على تيليجرام وفيسبوك
          </div>
        </div>
        <button class="btn btn-secondary btn-sm" onclick="closeBroadcastPreviewModal()" style="padding:2px 8px;">✕</button>
      </div>

      <div style="padding:8px 18px; background:#1e293b; border-bottom:1px solid #334155; display:flex; justify-content:space-between; align-items:center; font-size:11px; color:#94a3b8; flex-wrap:wrap; gap:6px;">
        <span id="preview-stat-count">📦 العملات: 0</span>
        <span id="preview-stat-chars">📝 الأحرف: 0</span>
        <span id="preview-stat-lines">📏 الأسطر: 0</span>
        <span id="preview-stat-target" style="color:#38bdf8;">🌐 الوجهة: تيليجرام / فيسبوك</span>
      </div>

      <div style="padding:16px; background:#0b1120; overflow-y:auto; flex:1;">
        <div id="preview-message-body" style="background:#1e293b; border:1px solid #334155; border-radius:10px; padding:16px; color:#f1f5f9; font-size:13px; line-height:1.8; white-space:pre-wrap; font-family:system-ui, -apple-system, sans-serif; box-shadow:inset 0 2px 4px rgba(0,0,0,0.3);">
          جاري تجهيز المعاينة الحية...
        </div>
      </div>

      <div style="padding:12px 18px; background:#0f172a; border-top:1px solid #334155; display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
        <button class="btn btn-secondary btn-sm" onclick="copyPreviewMessageText()">📋 نسخ نص المنشور</button>
        <div style="display:flex; gap:8px;">
          <button class="btn btn-secondary btn-sm" onclick="closeBroadcastPreviewModal()">إغلاق</button>
          <button class="btn btn-primary btn-sm" onclick="flushQueueFromPreview()">🚀 نشر الطابور فوراً</button>
        </div>
      </div>
    </div>
  </div>

  <!-- MANUAL BATCH RATES & AUTO-BROADCAST MODAL -->
  <div id="manual-batch-modal" class="modal-overlay hidden">
    <div class="modal-box modal-box-large" style="max-width:760px; max-height:92vh; display:flex; flex-direction:column; padding:0; overflow:hidden;">
      
      <!-- Modal Header -->
      <div style="padding:14px 18px; background:#0f172a; border-bottom:1px solid #334155; display:flex; justify-content:space-between; align-items:center;">
        <div>
          <div style="font-size:16px; font-weight:800; color:#ffffff; display:flex; align-items:center; gap:8px;" id="batch-modal-title">
            <span>💵 تحديث ونشر أسعار العملات يدوياً</span>
          </div>
          <div style="font-size:11px; color:#94a3b8; margin-top:2px;" id="batch-modal-subtitle">
            حدد الأصناف المراد تحديثها، أدخل القيم الجديدة، ثم احفظها في قاعدة البيانات وانشرها بتسلسل احترافي.
          </div>
        </div>
        <button class="btn btn-secondary btn-sm" onclick="closeManualBatchModal()" style="padding:3px 8px; font-size:14px;">✕</button>
      </div>

      <!-- Modal Toolbar: Select/Deselect, Search, Counters -->
      <div style="padding:10px 18px; background:#1e293b; border-bottom:1px solid #334155; display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:8px;">
        <div style="display:flex; gap:6px; align-items:center;">
          <button class="btn btn-secondary btn-sm" onclick="selectAllBatchItems(true)" style="font-size:11px; padding:4px 8px;">
            ☑️ تحديد الكل
          </button>
          <button class="btn btn-secondary btn-sm" onclick="selectAllBatchItems(false)" style="font-size:11px; padding:4px 8px;">
            ◻️ إلغاء تحديد الكل
          </button>
          <span style="font-size:12px; color:#cbd5e1; margin-right:4px;">
            المحدد: <strong id="batch-selected-count" class="font-num" style="color:#10b981;">0</strong> / <span id="batch-total-count" class="font-num">0</span>
          </span>
        </div>

        <div style="display:flex; gap:6px; align-items:center;">
          <input type="text" id="batch-search-input" class="form-input" placeholder="🔍 تصفية بالاسم أو الكود..." style="font-size:11px; padding:4px 10px; width:160px;" oninput="filterBatchModalItems()">
        </div>
      </div>

      <!-- Broadcast Options Bar -->
      <div style="padding:8px 18px; background:#0f172a; border-bottom:1px solid #334155; display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:8px;">
        <label style="display:flex; align-items:center; gap:6px; cursor:pointer; font-size:12px; color:#f1f5f9; font-weight:600;">
          <input type="checkbox" id="batch-auto-broadcast" checked style="accent-color:#10b981; width:17px; height:17px;">
          <span>📢 نشر تلقائي فوري بعد الحفظ على القنوات</span>
        </label>

        <div style="display:flex; align-items:center; gap:6px;">
          <label style="font-size:11px; color:#94a3b8;">منصة النشر:</label>
          <select id="batch-broadcast-target" class="form-input" style="font-size:11px; padding:4px 8px; width:auto;">
            <option value="all">📱 تيليجرام + فيسبوك (الكل)</option>
            <option value="telegram">✈️ تيليجرام فقط</option>
            <option value="facebook">📘 فيسبوك فقط</option>
          </select>
        </div>
      </div>

      <!-- Items List Container (Scrollable) -->
      <div id="batch-items-container" style="flex:1; overflow-y:auto; padding:12px 18px; display:flex; flex-direction:column; gap:8px; max-height:480px;">
        <!-- Rendered dynamically -->
      </div>

      <!-- Modal Footer -->
      <div style="padding:12px 18px; background:#0f172a; border-top:1px solid #334155; display:flex; justify-content:space-between; align-items:center;">
        <div style="font-size:11px; color:#64748b;" id="batch-footer-hint">
          * يتم تحديث قاعدة البيانات ومزامنة موقع الويب وإرسال إشعار فوري للمشتركين.
        </div>
        <div style="display:flex; gap:8px;">
          <button class="btn btn-secondary" onclick="closeManualBatchModal()">إلغاء</button>
          <button class="btn btn-primary" onclick="submitManualBatchRates()" id="btn-submit-batch">
            💾 حفظ ونشر الآن
          </button>
        </div>
      </div>

    </div>
  </div>

  <!-- CURRENCY TERM ADD/EDIT MODAL -->
  <div id="term-modal" class="modal-overlay hidden">
    <div class="modal-box modal-box-large">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
        <div style="font-size:15px; font-weight:700; color:#ffffff;" id="term-modal-title">
          ⚙️ إضافة عملة جديدة
        </div>
        <button class="btn btn-secondary btn-sm" onclick="closeTermModal()" style="padding:2px 8px;">✕</button>
      </div>

      <input type="hidden" id="term-modal-is-edit" value="0">

      <div style="display:grid; grid-template-columns: repeat(2, 1fr); gap:8px; margin-bottom:8px;">
        <div class="form-group" style="margin-bottom:0;">
          <label class="form-label">كود العملة (ID الفريد):</label>
          <input type="text" id="term-modal-id" class="form-input font-num" placeholder="مثال: USD, CAD, CHF" style="text-transform:uppercase;">
          <div style="font-size:10px; color:#64748b; margin-top:2px;">أحرف إنجليزية كبيرة وأرقام فقط</div>
        </div>

        <div class="form-group" style="margin-bottom:0;">
          <label class="form-label">اسم العملة بالعربية:</label>
          <input type="text" id="term-modal-name" class="form-input" placeholder="مثال: دولار أمريكي، دولار كندي">
        </div>
      </div>

      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px; margin-bottom:8px;">
        <div class="form-group" style="margin-bottom:0;">
          <label class="form-label">أيقونة الدولة / العلم:</label>
          <select id="term-modal-flag" class="form-input">
            <option value="us">🇺🇸 أمريكا (us)</option>
            <option value="eu">🇪🇺 أوروبا (eu)</option>
            <option value="gb">🇬🇧 بريطانيا (gb)</option>
            <option value="tr">🇹🇷 تركيا (tr)</option>
            <option value="tn">🇹🇳 تونس (tn)</option>
            <option value="eg">🇪🇬 مصر (eg)</option>
            <option value="ae">🇦🇪 الإمارات (ae)</option>
            <option value="sa">🇸🇦 السعودية (sa)</option>
            <option value="qa">🇶🇦 قطر (qa)</option>
            <option value="kw">🇰🇼 الكويت (kw)</option>
            <option value="jo">🇯🇴 الأردن (jo)</option>
            <option value="bh">🇧🇭 البحرين (bh)</option>
            <option value="cn">🇨🇳 الصين (cn)</option>
            <option value="ca">🇨🇦 كندا (ca)</option>
            <option value="ch">🇨🇭 سويسرا (ch)</option>
            <option value="gold">🪙 ذهب (gold)</option>
            <option value="silver">🥈 فضة (silver)</option>
            <option value="ly">🇱🇾 ليبيا (ly)</option>
          </select>
        </div>

        <div class="form-group" style="margin-bottom:0; display:flex; flex-direction:column; justify-content:center;">
          <label class="form-label">معادلة عكسية:</label>
          <label style="display:flex; align-items:center; gap:6px; cursor:pointer; font-size:12px; color:#cbd5e1; margin-top:6px;">
            <input type="checkbox" id="term-modal-inverse" style="accent-color:#10b981; width:16px; height:16px;">
            <span>حساب عكسي (1/x)</span>
          </label>
        </div>
      </div>

      <!-- EXTRACTION CONDITIONS: MIN & MAX (HIGHLIGHTED) -->
      <div style="background:#0f172a; padding:10px; border-radius:8px; border:1px solid #10b981; margin-bottom:10px;">
        <div style="font-size:12px; font-weight:700; color:#34d399; margin-bottom:4px;">
          🎯 شروط نطاق الاستخراج (Range Validation)
        </div>
        <div style="font-size:11px; color:#94a3b8; margin-bottom:8px;">
          لن يتم قبول أو مطابقة أي سعر يتم التقاطه من الرسائل إلا إذا كان يقع بين الحدين الأدنى والأعلى (مثال: من 9 إلى 12):
        </div>
        <div style="display:grid; grid-template-columns: repeat(2, 1fr); gap:8px;">
          <div>
            <label class="form-label" style="color:#cbd5e1;">الحد الأدنى المقبول (Min):</label>
            <input type="number" step="0.01" id="term-modal-min" class="form-input font-num" placeholder="مثال: 9.00" style="color:#34d399; font-weight:bold; font-size:15px;">
          </div>
          <div>
            <label class="form-label" style="color:#cbd5e1;">الحد الأقصى المقبول (Max):</label>
            <input type="number" step="0.01" id="term-modal-max" class="form-input font-num" placeholder="مثال: 12.00" style="color:#34d399; font-weight:bold; font-size:15px;">
          </div>
        </div>
      </div>

      <!-- KEYWORDS & REGEX BUILDER -->
      <div class="form-group" style="margin-bottom:8px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
          <label class="form-label" style="margin-bottom:0;">الكلمات الدلالية للتعرف على العملة:</label>
          <button type="button" class="btn btn-secondary btn-sm" onclick="autoGenerateRegexFromKeywords()" style="font-size:10px; padding:2px 6px;">
            ⚡ توليد Regex من الكلمات
          </button>
        </div>
        <input type="text" id="term-modal-keywords" class="form-input" placeholder="اكتب كلمات مفصولة بفاصلة، مثال: دولار, الدولار, الخضراء, كاش, USD">
        <div style="font-size:10px; color:#64748b; margin-top:2px;">الكلمات التي يبحث عنها النظام في رسائل تيليجرام وواتساب للتعرف على هذه العملة</div>
      </div>

      <div class="form-group" style="margin-bottom:12px;">
        <label class="form-label">نمط المطابقة المتقدم (Regex Pattern):</label>
        <textarea id="term-modal-regex" class="form-input font-num" rows="3" style="direction:ltr; text-align:left; font-size:11px; line-height:1.4;" placeholder="(?:USD|usd|دولار)[^\\d]{0,40}(\\d{1,2}(?:[\\.,]\\d{1,4})?)"></textarea>
      </div>

      <div style="display:flex; justify-content:flex-end; gap:8px;">
        <button class="btn btn-secondary" onclick="closeTermModal()">إلغاء</button>
        <button class="btn btn-primary" onclick="saveTermModal()">💾 حفظ في قاعدة البيانات</button>
      </div>
    </div>
  </div>

  <!-- TEST TERM MODAL -->
  <div id="test-term-modal" class="modal-overlay hidden">
    <div class="modal-box modal-box-large">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <div style="font-size:14px; font-weight:700; color:#ffffff;">
          🧪 اختبار استخراج العملة والشروط
        </div>
        <button class="btn btn-secondary btn-sm" onclick="closeTestTermModal()" style="padding:2px 8px;">✕</button>
      </div>

      <div style="font-size:12px; color:#94a3b8; margin-bottom:8px;" id="test-term-info">--</div>

      <div class="form-group">
        <label class="form-label">ألصق نص رسالة تجريبية من تيليجرام أو واتساب:</label>
        <textarea id="test-term-text" class="form-input" rows="4" placeholder="مثال: أسعار اليوم كاش طرابلس: دولار أمريكي 9.50 بيع 9.52 شراء"></textarea>
      </div>

      <button class="btn btn-primary btn-sm" onclick="executeTermTest()" style="width:100%; margin-bottom:10px;">
        🔍 فحص المطابقة واستخراج السعر
      </button>

      <div id="test-term-result" class="hidden" style="padding:10px; border-radius:8px; font-size:12px; line-height:1.5;"></div>
    </div>
  </div>

  <!-- TOAST NOTIFICATION -->
  <div id="toast" class="toast-box hidden"></div>

  <!-- CLIENT SCRIPTS -->
  <script>
    // ─── AUTHENTICATED FETCH & SESSION INTERCEPTOR ───
    const originalFetch = window.fetch;
    window.fetch = async function(url, options = {}) {
      options.headers = options.headers || {};
      const token = localStorage.getItem('lyd_admin_token');
      if (token) {
        if (options.headers instanceof Headers) {
          if (!options.headers.has('Authorization')) options.headers.set('Authorization', 'Bearer ' + token);
          if (!options.headers.has('x-admin-token')) options.headers.set('x-admin-token', token);
        } else if (Array.isArray(options.headers)) {
          options.headers.push(['Authorization', 'Bearer ' + token]);
          options.headers.push(['x-admin-token', token]);
        } else {
          if (!options.headers['Authorization']) options.headers['Authorization'] = 'Bearer ' + token;
          if (!options.headers['x-admin-token']) options.headers['x-admin-token'] = token;
        }
      }

      const res = await originalFetch(url, options);

      // Handle session timeout / unauthorized
      if (res.status === 401 && String(url).includes('/api/dashboard/')) {
        if (pollTimer) clearInterval(pollTimer);
        localStorage.removeItem('lyd_admin_token');
        document.cookie = 'lyd_admin_token=; path=/; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT';
        showToast('انتهت صلاحية الجلسة، جارٍ التحويل لشاشة الدخول...', true);
        setTimeout(() => {
          window.location.reload();
        }, 1200);
      }

      return res;
    };

    async function logoutAdmin() {
      if (!confirm('هل أنت متأكد من رغبتك في تسجيل الخروج وإنهاء الجلسة الآمنة؟')) return;
      try {
        await originalFetch('/api/auth/logout', { method: 'POST' });
      } catch (e) {}
      localStorage.removeItem('lyd_admin_token');
      document.cookie = 'lyd_admin_token=; path=/; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT';
      window.location.reload();
    }

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

      if (tabId === 'manual') {
        renderManualTable();
      }
      if (tabId === 'ingested') {
        fetchIngestedMessages();
      }
      if (tabId === 'settings') {
        renderTermsCards(currentTerms);
      }
      if (tabId === 'sources') {
        loadSourcesData();
      }
    }

    async function loadSourcesData() {
      try {
        const res = await fetch('/api/dashboard/sources');
        const data = await res.json();
        if (data.success) {
          renderTgChannels(data.telegramChannels || []);
          renderWaSources(data.whatsappSources || [], data.whatsappReachableChats || []);
        } else {
          showToast(data.error || 'فشل جلب المصادر', true);
        }
      } catch (e) {
        console.error('loadSourcesData error:', e);
      }
    }

    function renderTgChannels(channels) {
      const list = document.getElementById('tg-channels-list-container');
      const countBadge = document.getElementById('tg-channels-count');
      if (countBadge) countBadge.textContent = channels.length;
      if (!list) return;

      if (!channels || channels.length === 0) {
        list.innerHTML = '<div style="color: #64748b; font-size: 11px; text-align: center; padding: 15px;">لا توجد قنوات تيليجرام مضافة حالياً</div>';
        return;
      }

      list.innerHTML = channels.map(function(ch) {
        return '<div style="display:flex; justify-content:space-between; align-items:center; background:#1e293b; border:1px solid #334155; border-radius:6px; padding:8px 12px;">' +
          '<div style="display:flex; align-items:center; gap:8px;">' +
            '<span style="font-size:14px;">✈️</span>' +
            '<div>' +
              '<div style="font-size:12px; font-weight:700; color:#e2e8f0;">@' + ch + '</div>' +
              '<div style="font-size:10px; color:#94a3b8;">قناة تيليجرام جلب تلقائي</div>' +
            '</div>' +
          '</div>' +
          '<div style="display:flex; gap:4px;">' +
            '<button class="btn btn-secondary btn-sm" onclick="editTgChannel(&quot;' + ch + '&quot;)" style="padding:2px 8px; font-size:10px;">✏️ تعديل</button>' +
            '<button class="btn btn-danger btn-sm" onclick="deleteTgChannel(&quot;' + ch + '&quot;)" style="padding:2px 8px; font-size:10px;">🗑️ حذف</button>' +
          '</div>' +
        '</div>';
      }).join('');
    }

    async function addTgChannel() {
      const input = document.getElementById('add-tg-input');
      if (!input || !input.value.trim()) {
        showToast('يرجى أدخال اسم القناة أولاً', true);
        return;
      }
      try {
        const res = await fetch('/api/dashboard/sources/telegram/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ channel: input.value.trim() })
        });
        const data = await res.json();
        if (data.success) {
          showToast(data.message);
          input.value = '';
          renderTgChannels(data.channels);
        } else {
          showToast(data.error || 'فشل إضافة القناة', true);
        }
      } catch (e) {
        showToast('خطأ بالاتصال أثناء إضافة القناة', true);
      }
    }

    async function editTgChannel(oldChannel) {
      const newChannel = prompt('تعديل معرف القناة (@' + oldChannel + '):', oldChannel);
      if (!newChannel || !newChannel.trim() || newChannel.trim() === oldChannel) return;

      try {
        const res = await fetch('/api/dashboard/sources/telegram/edit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ oldChannel, newChannel: newChannel.trim() })
        });
        const data = await res.json();
        if (data.success) {
          showToast(data.message);
          renderTgChannels(data.channels);
        } else {
          showToast(data.error || 'فشل تعديل القناة', true);
        }
      } catch (e) {
        showToast('خطأ بالاتصال أثناء تعديل القناة', true);
      }
    }

    async function deleteTgChannel(channel) {
      if (!confirm('هل تريد حذف القناة @' + channel + ' من قائمة المراقبة؟')) return;

      try {
        const res = await fetch('/api/dashboard/sources/telegram/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ channel })
        });
        const data = await res.json();
        if (data.success) {
          showToast(data.message);
          renderTgChannels(data.channels);
        } else {
          showToast(data.error || 'فشل حذف القناة', true);
        }
      } catch (e) {
        showToast('خطأ بالاتصال أثناء حذف القناة', true);
      }
    }

    function renderWaSources(sources, reachableChats) {
      const list = document.getElementById('wa-sources-list-container');
      const countBadge = document.getElementById('wa-sources-count');
      
      const mergedMap = new Map();
      (sources || []).forEach(s => mergedMap.set(s.jid, s));
      (reachableChats || []).forEach(c => {
        if (!mergedMap.has(c.id)) {
          mergedMap.set(c.id, { jid: c.id, name: c.name, enabled: true, type: c.type });
        }
      });

      const allItems = Array.from(mergedMap.values());
      if (countBadge) countBadge.textContent = allItems.length;
      if (!list) return;

      if (allItems.length === 0) {
        list.innerHTML = '<div style="color: #64748b; font-size: 11px; text-align: center; padding: 15px;">لا توجد مجموعات أو مصادر واتساب. اضغط على "مزامنة المجموعات" للبحث عن المجموعات المنضم إليها الحساب.</div>';
        return;
      }

      list.innerHTML = allItems.map(function(item) {
        var isEnabled = item.enabled !== false;
        var icon = item.type === 'channel' ? '📢' : item.type === 'group' ? '👥' : '💬';
        return '<div style="display:flex; justify-content:space-between; align-items:center; background:#1e293b; border:1px solid #334155; border-radius:6px; padding:8px 12px; gap:8px;">' +
          '<div style="display:flex; align-items:center; gap:8px; flex:1; min-width:0;">' +
            '<span style="font-size:16px;">' + icon + '</span>' +
            '<div style="min-width:0; flex:1;">' +
              '<div style="font-size:12px; font-weight:700; color:#e2e8f0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + (item.name || item.jid) + '</div>' +
              '<div style="font-size:10px; color:#94a3b8; font-family:monospace;">' + item.jid + '</div>' +
            '</div>' +
          '</div>' +
          '<div style="display:flex; align-items:center; gap:8px;">' +
            '<label class="switch" style="transform:scale(0.85);" title="' + (isEnabled ? 'تعطيل الاستخراج' : 'تفعيل الاستخراج') + '">' +
              '<input type="checkbox" onchange="toggleWhatsAppSource(&quot;' + item.jid + '&quot;, this.checked)" ' + (isEnabled ? 'checked' : '') + '>' +
              '<span class="slider"></span>' +
            '</label>' +
            '<button class="btn btn-danger btn-sm" onclick="deleteWhatsAppSource(&quot;' + item.jid + '&quot;)" style="padding:2px 6px; font-size:10px;" title="حذف المصدر">🗑️</button>' +
          '</div>' +
        '</div>';
      }).join('');
    }

    async function refreshWhatsAppChats() {
      showToast('جاري مزامنة كافة المجموعات والقنوات من حساب واتساب...');
      try {
        const res = await fetch('/api/dashboard/sources/whatsapp/refresh', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          showToast(data.message);
          renderWaSources(data.whatsappSources, data.chats);
        } else {
          showToast(data.error || 'فشل المزامنة. تأكد من إتصال حساب واتساب أولاً', true);
        }
      } catch (e) {
        showToast('خطأ بالاتصال أثناء المزامنة', true);
      }
    }

    async function toggleWhatsAppSource(jid, enabled) {
      try {
        const res = await fetch('/api/dashboard/sources/whatsapp/toggle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jid, enabled })
        });
        const data = await res.json();
        if (data.success) {
          showToast(enabled ? 'تم تفعيل مصدر الواتساب' : 'تم تعطيل مصدر الواتساب');
        } else {
          showToast(data.error || 'فشل تفعيل/تعطيل المصدر', true);
        }
      } catch (e) {
        showToast('خطأ بالاتصال أثناء التعديل', true);
      }
    }

    async function addWhatsAppSourceManual() {
      const nameInput = document.getElementById('add-wa-name-input');
      const jidInput = document.getElementById('add-wa-jid-input');
      if (!nameInput || !nameInput.value.trim()) {
        showToast('يرجى كتابة اسم المصدر/المجموعة', true);
        return;
      }
      const name = nameInput.value.trim();
      const jid = (jidInput && jidInput.value && jidInput.value.trim()) ? jidInput.value.trim() : ('manual_' + Date.now() + '@g.us');

      try {
        const res = await fetch('/api/dashboard/sources/whatsapp/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jid, name })
        });
        const data = await res.json();
        if (data.success) {
          showToast(data.message);
          nameInput.value = '';
          if (jidInput) jidInput.value = '';
          renderWaSources(data.whatsappSources, []);
        } else {
          showToast(data.error || 'فشل إضافة المصدر', true);
        }
      } catch (e) {
        showToast('خطأ بالاتصال أثناء إضافة المصدر', true);
      }
    }

    async function deleteWhatsAppSource(jid) {
      if (!confirm('هل تريد حذف هذا المصدر من القائمة؟')) return;
      try {
        const res = await fetch('/api/dashboard/sources/whatsapp/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jid })
        });
        const data = await res.json();
        if (data.success) {
          showToast(data.message);
          renderWaSources(data.whatsappSources, []);
        } else {
          showToast(data.error || 'فشل حذف المصدر', true);
        }
      } catch (e) {
        showToast('خطأ بالاتصال أثناء حذف المصدر', true);
      }
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
      
      // Telegram / WhatsApp KPIs
      const tgConn = Boolean(data.accounts?.telegram?.connected || data.telegramConnected);
      const tgEl = document.getElementById('kpi-tg');
      if (tgEl) tgEl.textContent = tgConn ? '🟢 متصل' : '⚠️ غير متصل';

      const waStatus = data.accounts?.whatsapp?.status || data.whatsappStatus || 'disconnected';
      const waEl = document.getElementById('kpi-wa');
      if (waEl) {
        waEl.textContent = waStatus === 'connected' ? '🟢 متصل' : waStatus === 'scan_qr' ? '📱 امسح الرمز' : '⚠️ غير متصل';
      }

      // Accounts tab badges
      const accTgBadge = document.getElementById('acc-tg-badge');
      if (accTgBadge) {
        accTgBadge.textContent = tgConn ? '🟢 متصل' : '⚠️ غير متصل';
      }

      const accWaBadge = document.getElementById('acc-wa-badge');
      if (accWaBadge) {
        accWaBadge.textContent = waStatus === 'connected' ? '🟢 متصل' : waStatus === 'scan_qr' ? '📱 امسح الرمز' : '⚠️ غير متصل';
      }

      // WhatsApp QR Code display
      const waData = data.accounts?.whatsapp;
      const waQrContainer = document.getElementById('wa-qr-container');
      const waQrImg = document.getElementById('wa-qr-image');
      const waStatusText = document.getElementById('wa-status-text');
      const waPhoneText = document.getElementById('wa-phone-text');

      if (waStatusText) {
        waStatusText.textContent = waStatus === 'connected' ? 'متصل وجاهز للاستقبال والإرسال' : 
          waStatus === 'scan_qr' ? 'بانتظار مسح رمز QR من هاتفك' : 'غير متصل';
      }
      if (waPhoneText && waData?.phoneNumber) {
        waPhoneText.textContent = 'الرقم: ' + waData.phoneNumber;
      }
      if (waQrContainer && waQrImg) {
        if (waData?.qrCodeUrl && waStatus === 'scan_qr') {
          waQrImg.src = waData.qrCodeUrl;
          waQrContainer.classList.remove('hidden');
        } else {
          waQrContainer.classList.add('hidden');
        }
      }

      // 2. Jobs List
      if (data.activeJobs && Array.isArray(data.activeJobs)) {
        const jContainer = document.getElementById('jobs-list-container');
        let jHtml = '';
        for (const job of data.activeJobs) {
          const badge = job.isRunning ? '⏳ قيد التشغيل' :
            job.status === 'success' ? '✅ ناجحة' :
            job.status === 'failed' ? '❌ فشلت' : 'خامل';
          
          jHtml += '<div style="background:#1e293b; border:1px solid #334155; border-radius:10px; padding:10px 12px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center;">' +
            '<div>' +
              '<div style="font-size:12px; font-weight:700; color:#f1f5f9; margin-bottom:2px;">' + job.name + '</div>' +
              '<div style="font-size:11px; color:#94a3b8; display:flex; gap:8px; flex-wrap:wrap;">' +
                '<span>الحالة: <strong>' + badge + '</strong></span>' +
                '<span>المدة: ' + (job.lastRunDurationMs ? job.lastRunDurationMs + 'ms' : '--') + '</span>' +
                '<span>مرات التشغيل: #' + (job.runCount || 0) + '</span>' +
              '</div>' +
            '</div>' +
            '<button class="btn btn-secondary btn-sm" onclick="triggerJobById(&quot;' + job.id + '&quot;, &quot;' + job.name + '&quot;)">تشغيل</button>' +
          '</div>';
        }
        if (jContainer && jHtml) jContainer.innerHTML = jHtml;
      }

      // 3. Live Logs
      if (data.recentLogs && Array.isArray(data.recentLogs)) {
        const lFeed = document.getElementById('logs-feed');
        let lHtml = '';
        for (const log of data.recentLogs) {
          const time = new Date(log.timestamp).toLocaleTimeString('ar-LY');
          const color = log.level === 'error' ? '#f87171' :
            log.level === 'warn' ? '#fbbf24' :
            log.level === 'success' ? '#34d399' : '#38bdf8';

          lHtml += '<div style="padding:3px 0; border-bottom:1px solid rgba(51,65,85,0.4); display:flex; gap:6px; word-break:break-all;">' +
            '<span style="color:#64748b;">' + time + '</span>' +
            '<span style="color:' + color + '; font-weight:bold;">[' + log.category + ']:</span>' +
            '<span>' + log.message + '</span>' +
          '</div>';
        }
        if (lFeed && lHtml) lFeed.innerHTML = lHtml;
      }

      // Populate Broadcast Queue and Settings
      if (data.broadcastConfig) {
        const intervalEl = document.getElementById('setting-broadcast-interval');
        const threshEl = document.getElementById('setting-price-threshold');
        const aggEl = document.getElementById('setting-agg-window');
        const capEl = document.getElementById('setting-hourly-cap');
        const checkEl = document.getElementById('setting-smart-consolidated');
        const quietEnabledEl = document.getElementById('setting-quiet-hours-enabled');
        const quietStartEl = document.getElementById('setting-quiet-hours-start');
        const quietEndEl = document.getElementById('setting-quiet-hours-end');

        if (intervalEl) intervalEl.value = data.broadcastConfig.minBroadcastIntervalMinutes || 20;
        if (threshEl) threshEl.value = data.broadcastConfig.minPriceChangeThreshold || 0.015;
        if (aggEl) aggEl.value = data.broadcastConfig.aggregationWindowSeconds || 45;
        if (capEl) capEl.value = data.broadcastConfig.hourlyPostLimit || 4;
        if (checkEl) checkEl.checked = Boolean(data.broadcastConfig.smartConsolidatedPost !== false);
        if (quietEnabledEl) quietEnabledEl.checked = Boolean(data.broadcastConfig.quietHoursEnabled);
        if (quietStartEl && data.broadcastConfig.quietHoursStart) quietStartEl.value = data.broadcastConfig.quietHoursStart;
        if (quietEndEl && data.broadcastConfig.quietHoursEnd) quietEndEl.value = data.broadcastConfig.quietHoursEnd;
      }

      if (data.broadcastQueue) {
        renderQueueUI(data.broadcastQueue);
      }
    }

    // Interactive Telegram Authentication
    async function sendTelegramCode() {
      const phone = document.getElementById('tg-phone-input')?.value.trim();
      const apiId = document.getElementById('tg-api-id')?.value.trim();
      const apiHash = document.getElementById('tg-api-hash')?.value.trim();

      if (!phone) {
        showToast('يرجى إدخال رقم الهاتف مع رمز الدولة (مثال: +21891XXXXXXX)', true);
        return;
      }

      const btn = document.getElementById('btn-send-code');
      if (btn) btn.disabled = true;
      showToast('جاري إرسال كود التحقق من سيرفرات تيليجرام...');

      try {
        const res = await fetch('/api/dashboard/accounts/telegram/send-code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phoneNumber: phone, apiId, apiHash })
        });
        const data = await res.json();
        if (data.success) {
          showToast(data.message);
          document.getElementById('tg-login-step-2')?.classList.remove('hidden');
          document.getElementById('tg-otp-input')?.focus();
        } else {
          showToast('فشل إرسال الكود: ' + data.error, true);
        }
      } catch (err) {
        showToast('خطأ بالاتصال: ' + err.message, true);
      } finally {
        if (btn) btn.disabled = false;
      }
    }

    async function verifyTelegramCode() {
      const code = document.getElementById('tg-otp-input')?.value.trim();
      if (!code) {
        showToast('أدخل كود التحقق أولاً', true);
        return;
      }

      const btn = document.getElementById('btn-verify-code');
      if (btn) btn.disabled = true;
      showToast('جاري التحقق من الكود وتوليد الجلسة...');

      try {
        const res = await fetch('/api/dashboard/accounts/telegram/verify-code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phoneCode: code })
        });
        const data = await res.json();
        if (data.success) {
          if (data.requires2FA) {
            showToast(data.message, false);
            document.getElementById('tg-login-step-3')?.classList.remove('hidden');
            document.getElementById('tg-2fa-input')?.focus();
          } else {
            showToast(data.message);
            document.getElementById('tg-login-step-2')?.classList.add('hidden');
            document.getElementById('tg-login-step-3')?.classList.add('hidden');
            fetchDashboardData();
          }
        } else {
          showToast('فشل التحقق: ' + data.error, true);
        }
      } catch (err) {
        showToast('خطأ: ' + err.message, true);
      } finally {
        if (btn) btn.disabled = false;
      }
    }

    async function verifyTelegram2FA() {
      const password = document.getElementById('tg-2fa-input')?.value.trim();
      if (!password) {
        showToast('يرجى إدخال كلمة المرور الثنائية (2FA)', true);
        return;
      }

      const btn = document.getElementById('btn-verify-2fa');
      if (btn) btn.disabled = true;
      showToast('جاري التحقق من كلمة المرور الثنائية وحفظ الجلسة...');

      try {
        const res = await fetch('/api/dashboard/accounts/telegram/verify-2fa', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password })
        });
        const data = await res.json();
        if (data.success) {
          showToast(data.message);
          document.getElementById('tg-login-step-2')?.classList.add('hidden');
          document.getElementById('tg-login-step-3')?.classList.add('hidden');
          fetchDashboardData();
        } else {
          showToast('خطأ: ' + data.error, true);
        }
      } catch (err) {
        showToast('خطأ: ' + err.message, true);
      } finally {
        if (btn) btn.disabled = false;
      }
    }

    // Accounts operations
    async function saveTelegramSettings() {
      const channel = document.getElementById('tg-post-channel-input')?.value.trim();
      const session = document.getElementById('tg-session-input')?.value.trim();

      showToast('جاري حفظ إعدادات تيليجرام والاتصال...');
      try {
        const res = await fetch('/api/dashboard/accounts/telegram/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ postChannel: channel, sessionString: session || undefined })
        });
        const data = await res.json();
        if (data.success) {
          showToast(data.message);
          fetchDashboardData();
        } else {
          showToast('فشل: ' + data.error, true);
        }
      } catch (err) {
        showToast('خطأ: ' + err.message, true);
      }
    }

    async function reconnectTelegram() {
      showToast('جاري إعادة الاتصال بتيليجرام...');
      try {
        const res = await fetch('/api/dashboard/accounts/telegram/reconnect', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          showToast(data.message);
          fetchDashboardData();
        } else {
          showToast('فشل: ' + data.error, true);
        }
      } catch (err) {
        showToast('خطأ: ' + err.message, true);
      }
    }

    async function disconnectTelegram() {
      if (!confirm('هل تريد بالتأكيد قطع اتصال تيليجرام؟')) return;
      try {
        const res = await fetch('/api/dashboard/accounts/telegram/disconnect', { method: 'POST' });
        const data = await res.json();
        showToast(data.message);
        fetchDashboardData();
      } catch (err) {
        showToast('خطأ: ' + err.message, true);
      }
    }

    async function initWhatsApp() {
      showToast('جاري تشغيل واتساب وتوليد رمز QR...');
      try {
        const res = await fetch('/api/dashboard/accounts/whatsapp/init', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          showToast('تم إطلاق عميل واتساب. بانتظار مسح الرمز...');
          fetchDashboardData();
        } else {
          showToast('فشل: ' + data.error, true);
        }
      } catch (err) {
        showToast('خطأ: ' + err.message, true);
      }
    }

    async function disconnectWhatsApp() {
      if (!confirm('هل تريد تسجيل الخروج وحذف جلسة واتساب نهائياً؟')) return;
      try {
        const res = await fetch('/api/dashboard/accounts/whatsapp/disconnect', { method: 'POST' });
        const data = await res.json();
        showToast(data.message);
        fetchDashboardData();
      } catch (err) {
        showToast('خطأ: ' + err.message, true);
      }
    }

    async function saveFacebookSettings() {
      const pageId = document.getElementById('fb-page-id-input')?.value.trim();
      const accessToken = document.getElementById('fb-token-input')?.value.trim();

      showToast('جاري حفظ إعدادات فيسبوك...');
      try {
        const res = await fetch('/api/dashboard/accounts/facebook/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pageId, accessToken: accessToken || undefined })
        });
        const data = await res.json();
        if (data.success) {
          showToast(data.message);
        } else {
          showToast('فشل: ' + data.error, true);
        }
      } catch (err) {
        showToast('خطأ: ' + err.message, true);
      }
    }

    async function testFacebookPost() {
      showToast('جاري إرسال منشور تجريبي إلى صفحة فيسبوك...');
      try {
        const res = await fetch('/api/dashboard/accounts/facebook/test', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          showToast('تم نشر المنشور التجريبي على فيسبوك بنجاح!');
        } else {
          showToast('فشل: ' + (data.error || 'خطأ'), true);
        }
      } catch (err) {
        showToast('خطأ: ' + err.message, true);
      }
    }

    async function updateToggles() {
      const cbl = document.getElementById('toggle-cbl')?.checked;
      const tg = document.getElementById('toggle-telegram')?.checked;
      const wa = document.getElementById('toggle-whatsapp')?.checked;
      const tgPost = document.getElementById('toggle-tg-auto')?.checked;
      const fbPost = document.getElementById('toggle-fb-auto')?.checked;

      try {
        const res = await fetch('/api/dashboard/toggles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cblFetchEnabled: cbl,
            telegramFetchEnabled: tg,
            whatsappFetchEnabled: wa,
            telegramAutoPost: tgPost,
            facebookAutoPost: fbPost
          })
        });
        const data = await res.json();
        if (data.success) {
          showToast('تم حفظ إعدادات التشغيل التلقائي');
        }
      } catch (err) {}
    }

    // Ingested messages fetch
    async function fetchIngestedMessages(isManual = false) {
      try {
        const res = await fetch('/api/dashboard/ingested-messages');
        const data = await res.json();
        if (data.success && Array.isArray(data.messages)) {
          const container = document.getElementById('ingested-feed-container');
          if (!container) return;

          let html = '';
          for (const msg of data.messages) {
            const dateObj = new Date(msg.timestamp);
            const dateStr = dateObj.toLocaleDateString('ar-LY', { month: 'numeric', day: 'numeric' });
            const timeStr = dateObj.toLocaleTimeString('ar-LY', { hour: '2-digit', minute: '2-digit' });
            const time = dateStr + ' ' + timeStr;
            const isExtracted = msg.status === 'extracted';
            const badge = isExtracted 
              ? '<span class="status-badge" style="color:#10b981; background:rgba(16,185,129,0.15);">✅ تم استخراج أسعار</span>'
              : '<span class="status-badge" style="color:#f43f5e; background:rgba(244,63,94,0.15);">⚠️ تم التجاهل</span>';

            let ratesHtml = '';
            if (isExtracted && msg.extractedRates && msg.extractedRates.length > 0) {
              ratesHtml = '<div style="margin-top:6px; display:flex; flex-wrap:wrap; gap:4px;">' + 
                msg.extractedRates.map(r => '<span class="extracted-pill font-num">💵 ' + r.code + ': ' + Number(r.value).toFixed(2) + '</span>').join('') + 
                '</div>';
            } else if (msg.ignoreReason) {
              ratesHtml = '<div style="margin-top:4px; font-size:11px; color:#f43f5e;">سبب التجاهل: ' + msg.ignoreReason + '</div>';
            }

            html += '<div class="feed-item">' +
              '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">' +
                '<span style="font-weight:700; color:#38bdf8; font-size:12px;">' + msg.source + '</span>' +
                '<div style="display:flex; align-items:center; gap:6px;">' +
                  badge +
                  '<span style="color:#64748b; font-size:11px;" class="font-num">' + time + '</span>' +
                '</div>' +
              '</div>' +
              '<div style="font-size:12px; color:#cbd5e1; background:#0f172a; padding:8px; border-radius:6px; white-space:pre-wrap; word-break:break-all;">' + msg.rawText + '</div>' +
              ratesHtml +
            '</div>';
          }
          container.innerHTML = html || '<div style="color:#64748b; font-size:12px; padding:12px;">لا توجد رسائل ملتقطة حالياً</div>';
          if (isManual) showToast('تم تحديث الرسائل الملتقطة');
        }
      } catch (err) {}
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
          fetchIngestedMessages();
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

    // ─── Manual Batch Rates Entry & Intelligent Auto-Broadcast ───
    let activeBatchCategory = 'currencies'; // 'currencies' | 'metals'
    let batchItemsState = [];

    const CURRENCY_DEFINITIONS = [
      { code: 'USD', name: 'دولار أمريكي (كاش)', flag: 'us', decimals: 3 },
      { code: 'USD_CHECKS', name: 'دولار أمريكي (صكوك)', flag: 'us', decimals: 3 },
      { code: 'EUR', name: 'يورو أوروبي', flag: 'eu', decimals: 3 },
      { code: 'GBP', name: 'جنيه إسترليني', flag: 'gb', decimals: 3 },
      { code: 'TND', name: 'دينار تونسي', flag: 'tn', decimals: 3 },
      { code: 'EGP', name: 'جنيه مصري', flag: 'eg', decimals: 3 },
      { code: 'TRY', name: 'ليرة تركية', flag: 'tr', decimals: 3 },
      { code: 'JOD', name: 'دينار أردني', flag: 'jo', decimals: 3 },
      { code: 'AED', name: 'درهم إماراتي', flag: 'ae', decimals: 3 },
      { code: 'SAR', name: 'ريال سعودي', flag: 'sa', decimals: 3 },
      { code: 'QAR', name: 'ريال قطري', flag: 'qa', decimals: 3 },
      { code: 'KWD', name: 'دينار كويتي', flag: 'kw', decimals: 3 },
      { code: 'BHD', name: 'دينار بحريني', flag: 'bh', decimals: 3 },
      { code: 'USD_TR', name: 'حوالات تركيا', flag: 'tr', decimals: 3 },
      { code: 'USD_AE', name: 'حوالات دبي', flag: 'ae', decimals: 3 },
      { code: 'USD_CN', name: 'حوالات الصين', flag: 'cn', decimals: 3 },
      { code: 'CNY', name: 'يوان صيني', flag: 'cn', decimals: 3 }
    ];

    const METAL_DEFINITIONS = [
      { code: 'GOLD_SCRAP_18', name: 'ذهب كسر 18', flag: 'gold', decimals: 2 },
      { code: 'GOLD_SCRAP_21', name: 'ذهب كسر 21', flag: 'gold', decimals: 2 },
      { code: 'GOLD_CAST_18', name: 'ذهب مسبوك 18 (سبائك)', flag: 'gold', decimals: 2 },
      { code: 'GOLD_CAST_21', name: 'ذهب مسبوك 21 (سبائك)', flag: 'gold', decimals: 2 },
      { code: 'GOLD_CAST_24', name: 'ذهب مسبوك 24 (سبائك)', flag: 'gold', decimals: 2 },
      { code: 'GOLD_EXT_18', name: 'ذهب خارجي 18', flag: 'gold', decimals: 2 },
      { code: 'GOLD_EXT_21', name: 'ذهب خارجي 21', flag: 'gold', decimals: 2 },
      { code: 'GOLD_LIRA_8G', name: 'ليرة ذهب (8 جرام)', flag: 'gold', decimals: 2 },
      { code: 'GOLD_LIRA_14G', name: 'ليرة ذهب (14 جرام)', flag: 'gold', decimals: 2 },
      { code: 'GOLD_MUJARA_14G', name: 'مجارة ذهب (14 جرام)', flag: 'gold', decimals: 2 },
      { code: 'SILVER_CAST_1000', name: 'مسبوك فضة 1000', flag: 'silver', decimals: 2 },
      { code: 'SILVER_SCRAP', name: 'فضة كسر (جرام)', flag: 'silver', decimals: 2 }
    ];

    function openManualBatchModal(category) {
      activeBatchCategory = category || 'currencies';
      const isMetals = activeBatchCategory === 'metals';

      const titleEl = document.getElementById('batch-modal-title');
      const subtitleEl = document.getElementById('batch-modal-subtitle');
      const searchInput = document.getElementById('batch-search-input');
      const modal = document.getElementById('manual-batch-modal');

      if (titleEl) {
        titleEl.innerHTML = isMetals 
          ? '<span style="font-size:20px;">🪙</span><span>تحديث ونشر أسعار المعادن والذهب يدوياً</span>'
          : '<span style="font-size:20px;">💵</span><span>تحديث ونشر أسعار العملات يدوياً</span>';
      }
      if (subtitleEl) {
        subtitleEl.textContent = isMetals
          ? 'حدد أصناف الذهب والفضة، أدخل الأسعار الجديدة، وسيتم حفظها في قاعدة البيانات ونشر نشرة احترافية مخصصة للمعادن.'
          : 'حدد العملات المراد تحديثها، أدخل الأسعار الجديدة، وسيتم حفظها في قاعدة البيانات ونشر نشرة السوق الموازي بتسلسل دقيق.';
      }
      if (searchInput) searchInput.value = '';

      const defs = isMetals ? METAL_DEFINITIONS : CURRENCY_DEFINITIONS;
      const seenCodes = new Set();
      batchItemsState = [];

      const currentParallel = (currentRates && currentRates.parallel) ? currentRates.parallel : {};

      for (const def of defs) {
        seenCodes.add(def.code.toUpperCase());
        const curVal = Number(currentParallel[def.code] || currentParallel[def.code.toLowerCase()] || 0);
        batchItemsState.push({
          code: def.code,
          name: def.name,
          flag: def.flag,
          decimals: def.decimals,
          oldRate: curVal,
          newRate: curVal,
          selected: curVal > 0
        });
      }

      // Check any terms from currentTerms that fit this category but weren't in default definitions
      if (Array.isArray(currentTerms)) {
        for (const t of currentTerms) {
          const tId = t.id.toUpperCase();
          if (seenCodes.has(tId)) continue;
          if (tId === 'OFFICIAL_USD') continue;

          const isMetalTerm = (t.flag === 'gold' || t.flag === 'silver' || tId.startsWith('GOLD_') || tId.startsWith('SILVER_'));
          if ((isMetals && isMetalTerm) || (!isMetals && !isMetalTerm)) {
            seenCodes.add(tId);
            const curVal = Number(currentParallel[t.id] || currentParallel[t.id.toLowerCase()] || 0);
            batchItemsState.push({
              code: t.id,
              name: t.name,
              flag: t.flag || (isMetals ? 'gold' : 'us'),
              decimals: isMetals ? 2 : 3,
              oldRate: curVal,
              newRate: curVal,
              selected: curVal > 0
            });
          }
        }
      }

      renderBatchModalItems();
      if (modal) modal.classList.remove('hidden');
    }

    function closeManualBatchModal() {
      const modal = document.getElementById('manual-batch-modal');
      if (modal) modal.classList.add('hidden');
    }

    function selectAllBatchItems(selectAll) {
      for (const item of batchItemsState) {
        item.selected = Boolean(selectAll);
      }
      renderBatchModalItems();
    }

    function filterBatchModalItems() {
      renderBatchModalItems();
    }

    function onBatchItemPriceChange(code, val) {
      const item = batchItemsState.find(i => i.code === code);
      if (!item) return;
      const num = parseFloat(val);
      item.newRate = isNaN(num) ? 0 : num;
      if (item.newRate > 0) {
        item.selected = true;
        const chk = document.getElementById('batch-chk-' + code);
        if (chk) chk.checked = true;
      }
      updateBatchItemRowDiff(item);
      updateBatchCounts();
    }

    function toggleBatchItemSelection(code, forceVal) {
      const item = batchItemsState.find(i => i.code === code);
      if (!item) return;
      if (typeof forceVal === 'boolean') {
        item.selected = forceVal;
      } else {
        item.selected = !item.selected;
      }
      updateBatchCounts();
    }

    function updateBatchCounts() {
      const selectedCount = batchItemsState.filter(i => i.selected).length;
      const totalCount = batchItemsState.length;
      const selBadge = document.getElementById('batch-selected-count');
      const totBadge = document.getElementById('batch-total-count');
      if (selBadge) selBadge.textContent = String(selectedCount);
      if (totBadge) totBadge.textContent = String(totalCount);
    }

    function updateBatchItemRowDiff(item) {
      const diffBadge = document.getElementById('batch-diff-' + item.code);
      if (!diffBadge) return;

      const oldR = Number(item.oldRate) || 0;
      const newR = Number(item.newRate) || 0;

      if (newR <= 0) {
        diffBadge.innerHTML = '<span style="color:#64748b; font-size:11px;">--</span>';
        return;
      }

      const diff = newR - oldR;
      const absDiff = Math.abs(diff);
      const dec = item.decimals || 3;

      if (oldR > 0 && Math.abs(diff) >= 0.0001) {
        if (diff > 0) {
          diffBadge.innerHTML = '<span style="color:#34d399; font-weight:700; font-size:11px; background:rgba(16,185,129,0.15); padding:2px 6px; border-radius:4px;">🔺 +' + absDiff.toFixed(dec) + '</span>';
        } else {
          diffBadge.innerHTML = '<span style="color:#f87171; font-weight:700; font-size:11px; background:rgba(244,63,94,0.15); padding:2px 6px; border-radius:4px;">🔻 -' + absDiff.toFixed(dec) + '</span>';
        }
      } else {
        diffBadge.innerHTML = '<span style="color:#94a3b8; font-size:11px; background:rgba(148,163,184,0.1); padding:2px 6px; border-radius:4px;">🟢 استقرار</span>';
      }
    }

    function renderBatchModalItems() {
      const container = document.getElementById('batch-items-container');
      if (!container) return;

      const q = (document.getElementById('batch-search-input')?.value || '').trim().toLowerCase();
      const filtered = q
        ? batchItemsState.filter(i => i.name.toLowerCase().includes(q) || i.code.toLowerCase().includes(q))
        : batchItemsState;

      updateBatchCounts();

      if (filtered.length === 0) {
        container.innerHTML = '<div style="color:#94a3b8; font-size:12px; text-align:center; padding:25px;">لا توجد عناصر مطابقة لبحثك</div>';
        return;
      }

      let html = '';
      for (const item of filtered) {
        const flagIcon = getFlagEmoji(item.flag);
        const dec = item.decimals || (activeBatchCategory === 'metals' ? 2 : 3);
        const oldR = Number(item.oldRate) || 0;
        const newR = Number(item.newRate) || oldR;

        const isUp = oldR > 0 && newR > oldR;
        const isDown = oldR > 0 && newR < oldR;
        const diff = Math.abs(newR - oldR);

        let diffHtml = '<span style="color:#94a3b8; font-size:11px; background:rgba(148,163,184,0.1); padding:2px 6px; border-radius:4px;">🟢 استقرار</span>';
        if (oldR > 0 && Math.abs(newR - oldR) >= 0.0001) {
          if (isUp) {
            diffHtml = '<span style="color:#34d399; font-weight:700; font-size:11px; background:rgba(16,185,129,0.15); padding:2px 6px; border-radius:4px;">🔺 +' + diff.toFixed(dec) + '</span>';
          } else if (isDown) {
            diffHtml = '<span style="color:#f87171; font-weight:700; font-size:11px; background:rgba(244,63,94,0.15); padding:2px 6px; border-radius:4px;">🔻 -' + diff.toFixed(dec) + '</span>';
          }
        }

        html += '<div style="display:flex; align-items:center; justify-content:space-between; gap:10px; background:#1e293b; border:1px solid #334155; border-radius:8px; padding:10px 12px; transition:border 0.15s;" id="batch-row-' + item.code + '">' +
          '<div style="display:flex; align-items:center; gap:10px; flex:1; min-width:0;">' +
            '<input type="checkbox" id="batch-chk-' + item.code + '" ' + (item.selected ? 'checked' : '') + ' onchange="toggleBatchItemSelection(&quot;' + item.code + '&quot;, this.checked)" style="accent-color:#10b981; width:18px; height:18px; cursor:pointer;">' +
            '<span style="font-size:18px;">' + flagIcon + '</span>' +
            '<div style="min-width:0; flex:1;">' +
              '<div style="display:flex; align-items:center; gap:6px;">' +
                '<span style="font-size:13px; font-weight:700; color:#f8fafc;">' + item.name + '</span>' +
                '<span style="font-size:10px; background:#0f172a; color:#94a3b8; border:1px solid #334155; border-radius:4px; padding:1px 5px; font-family:monospace;">' + item.code + '</span>' +
              '</div>' +
              '<div style="font-size:11px; color:#94a3b8; margin-top:2px;">' +
                'السعر المسجل: <span class="font-num" style="color:#cbd5e1; font-weight:600;">' + (oldR > 0 ? oldR.toFixed(dec) : 'غير محدد') + ' د.ل</span>' +
              '</div>' +
            '</div>' +
          '</div>' +

          '<div style="display:flex; align-items:center; gap:8px;">' +
            '<div id="batch-diff-' + item.code + '" style="min-width:70px; text-align:center;">' + diffHtml + '</div>' +
            '<div style="display:flex; align-items:center; gap:4px;">' +
              '<input type="number" step="any" id="batch-input-' + item.code + '" value="' + (newR > 0 ? newR : '') + '" placeholder="' + (oldR > 0 ? oldR.toFixed(dec) : '0.00') + '" class="form-input font-num" style="width:115px; font-size:14px; font-weight:700; text-align:center; padding:6px 8px; border-color:#38bdf8;" oninput="onBatchItemPriceChange(&quot;' + item.code + '&quot;, this.value)">' +
              '<span style="font-size:11px; color:#94a3b8;">د.ل</span>' +
            '</div>' +
          '</div>' +
        '</div>';
      }

      container.innerHTML = html;
    }

    async function submitManualBatchRates() {
      const selectedItems = batchItemsState.filter(i => i.selected && i.newRate > 0);
      if (selectedItems.length === 0) {
        showToast('يرجى تحديد عنصر واحد على الأقل وإدخال سعر صحيح أكبر من الصفر', true);
        return;
      }

      const autoBroadcast = Boolean(document.getElementById('batch-auto-broadcast')?.checked);
      const broadcastTarget = document.getElementById('batch-broadcast-target')?.value || 'all';
      const submitBtn = document.getElementById('btn-submit-batch');

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = '⏳ جاري الحفظ والنشر...';
      }

      showToast('جاري حفظ الأسعار ومزامنة قاعدة البيانات والنشر...');

      try {
        const res = await fetch('/api/dashboard/manual-rates-batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            category: activeBatchCategory,
            items: selectedItems,
            autoBroadcast,
            broadcastTarget
          })
        });

        const data = await res.json();
        if (data.success) {
          showToast(data.message || 'تم حفظ ونشر الأسعار بنجاح!');
          closeManualBatchModal();
          fetchDashboardData();
        } else {
          showToast(data.error || 'فشل تحديث الأسعار', true);
        }
      } catch (err) {
        showToast('خطأ أثناء إرسال البيانات: ' + err.message, true);
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = '💾 حفظ ونشر الآن';
        }
      }
    }

    // ─── DEDICATED MANUAL RATES SECTION & EDITABLE TABLE ───
    let manualCategory = 'currencies'; // 'currencies' | 'metals'
    let manualTableRows = [];

    function selectManualCategory(cat) {
      manualCategory = cat || 'currencies';
      const isMetals = manualCategory === 'metals';

      const btnCur = document.getElementById('manual-cat-btn-currencies');
      const btnMet = document.getElementById('manual-cat-btn-metals');

      if (btnCur && btnMet) {
        if (isMetals) {
          btnCur.style.background = '#1e293b';
          btnCur.style.border = '1px solid #334155';
          btnCur.style.color = '#cbd5e1';
          btnCur.style.boxShadow = 'none';

          btnMet.style.background = 'linear-gradient(135deg, #d97706, #b45309)';
          btnMet.style.border = '2px solid #fbbf24';
          btnMet.style.color = '#ffffff';
          btnMet.style.boxShadow = '0 4px 14px rgba(217,119,6,0.35)';
        } else {
          btnMet.style.background = '#1e293b';
          btnMet.style.border = '1px solid #334155';
          btnMet.style.color = '#cbd5e1';
          btnMet.style.boxShadow = 'none';

          btnCur.style.background = 'linear-gradient(135deg, #0284c7, #0369a1)';
          btnCur.style.border = '2px solid #38bdf8';
          btnCur.style.color = '#ffffff';
          btnCur.style.boxShadow = '0 4px 14px rgba(2,132,199,0.35)';
        }
      }

      loadManualTableData();
    }

    function loadManualTableData() {
      const isMetals = manualCategory === 'metals';
      const defs = isMetals ? METAL_DEFINITIONS : CURRENCY_DEFINITIONS;
      const seenCodes = new Set();
      manualTableRows = [];

      const currentParallel = (currentRates && currentRates.parallel) ? currentRates.parallel : {};

      for (const def of defs) {
        seenCodes.add(def.code.toUpperCase());
        const curVal = Number(currentParallel[def.code] || currentParallel[def.code.toLowerCase()] || 0);
        manualTableRows.push({
          code: def.code,
          name: def.name,
          flag: def.flag,
          decimals: def.decimals,
          oldRate: curVal,
          newRate: curVal,
          selected: curVal > 0
        });
      }

      if (Array.isArray(currentTerms)) {
        for (const t of currentTerms) {
          const tId = t.id.toUpperCase();
          if (seenCodes.has(tId)) continue;
          if (tId === 'OFFICIAL_USD') continue;

          const isMetalTerm = (t.flag === 'gold' || t.flag === 'silver' || tId.startsWith('GOLD_') || tId.startsWith('SILVER_'));
          if ((isMetals && isMetalTerm) || (!isMetals && !isMetalTerm)) {
            seenCodes.add(tId);
            const curVal = Number(currentParallel[t.id] || currentParallel[t.id.toLowerCase()] || 0);
            manualTableRows.push({
              code: t.id,
              name: t.name,
              flag: t.flag || (isMetals ? 'gold' : 'us'),
              decimals: isMetals ? 2 : 3,
              oldRate: curVal,
              newRate: curVal,
              selected: curVal > 0
            });
          }
        }
      }

      renderManualTable();
    }

    function toggleAllManualRows(selectAll) {
      for (const row of manualTableRows) {
        row.selected = Boolean(selectAll);
      }
      const masterChk = document.getElementById('manual-th-select-all');
      if (masterChk) masterChk.checked = Boolean(selectAll);
      renderManualTable();
    }

    function toggleManualRow(code, forceVal) {
      const row = manualTableRows.find(r => r.code === code);
      if (!row) return;
      row.selected = (typeof forceVal === 'boolean') ? forceVal : !row.selected;
      updateManualRowVisual(row);
      updateManualTableBadges();
    }

    function onManualTablePriceChange(code, val) {
      const row = manualTableRows.find(r => r.code === code);
      if (!row) return;
      const num = parseFloat(val);
      row.newRate = isNaN(num) ? 0 : num;
      if (row.newRate > 0) {
        row.selected = true;
        const chk = document.getElementById('manual-row-chk-' + code);
        if (chk) chk.checked = true;
      }
      updateManualRowVisual(row);
      updateManualTableBadges();
    }

    function resetManualTableToCurrentPrices() {
      const currentParallel = (currentRates && currentRates.parallel) ? currentRates.parallel : {};
      for (const row of manualTableRows) {
        const curVal = Number(currentParallel[row.code] || currentParallel[row.code.toLowerCase()] || 0);
        row.oldRate = curVal;
        row.newRate = curVal;
      }
      renderManualTable();
      showToast('تم استعادة الأسعار الحالية المسجلة');
    }

    function filterManualTableRows() {
      renderManualTable();
    }

    function updateManualTableBadges() {
      const selectedCount = manualTableRows.filter(r => r.selected).length;
      const totalCount = manualTableRows.length;
      const selBadge = document.getElementById('manual-table-selected-badge');
      const totBadge = document.getElementById('manual-table-total-badge');
      const masterChk = document.getElementById('manual-th-select-all');
      if (selBadge) selBadge.textContent = String(selectedCount);
      if (totBadge) totBadge.textContent = String(totalCount);
      if (masterChk) masterChk.checked = (selectedCount > 0 && selectedCount === totalCount);
    }

    function updateManualRowVisual(row) {
      const tr = document.getElementById('manual-tr-' + row.code);
      const diffBadge = document.getElementById('manual-diff-' + row.code);
      const statusBadge = document.getElementById('manual-status-' + row.code);

      if (tr) {
        if (row.selected) tr.classList.add('manual-row-selected');
        else tr.classList.remove('manual-row-selected');
      }

      if (statusBadge) {
        if (row.selected) {
          statusBadge.innerHTML = '<span style="color:#10b981; font-weight:700; font-size:11px; background:rgba(16,185,129,0.15); padding:3px 8px; border-radius:9999px;">✓ محدد</span>';
        } else {
          statusBadge.innerHTML = '<span style="color:#64748b; font-size:11px; background:rgba(100,116,139,0.15); padding:3px 8px; border-radius:9999px;">✕ مستبعد</span>';
        }
      }

      if (diffBadge) {
        const oldR = Number(row.oldRate) || 0;
        const newR = Number(row.newRate) || 0;
        const dec = row.decimals || (manualCategory === 'metals' ? 2 : 3);

        if (newR <= 0) {
          diffBadge.innerHTML = '<span style="color:#64748b; font-size:11px;">--</span>';
          return;
        }

        const diff = newR - oldR;
        const absDiff = Math.abs(diff);

        if (oldR > 0 && Math.abs(diff) >= 0.0001) {
          if (diff > 0) {
            diffBadge.innerHTML = '<span style="color:#34d399; font-weight:700; font-size:12px; background:rgba(16,185,129,0.15); padding:3px 8px; border-radius:6px;">🔺 +' + absDiff.toFixed(dec) + '</span>';
          } else {
            diffBadge.innerHTML = '<span style="color:#f87171; font-weight:700; font-size:12px; background:rgba(244,63,94,0.15); padding:3px 8px; border-radius:6px;">🔻 -' + absDiff.toFixed(dec) + '</span>';
          }
        } else {
          diffBadge.innerHTML = '<span style="color:#94a3b8; font-size:12px; background:rgba(148,163,184,0.1); padding:3px 8px; border-radius:6px;">🟢 استقرار</span>';
        }
      }
    }

    function renderManualTable() {
      const tbody = document.getElementById('manual-table-tbody');
      if (!tbody) return;

      if (!manualTableRows || manualTableRows.length === 0) {
        loadManualTableData();
        return;
      }

      const q = (document.getElementById('manual-table-search-input')?.value || '').trim().toLowerCase();
      const filtered = q
        ? manualTableRows.filter(r => r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q))
        : manualTableRows;

      updateManualTableBadges();

      if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:30px; color:#94a3b8;">لا توجد أصناف مطابقة لبحثك في جدول ' + (manualCategory === 'metals' ? 'المعادن' : 'العملات') + '</td></tr>';
        return;
      }

      let html = '';
      for (const row of filtered) {
        const flagIcon = getFlagEmoji(row.flag);
        const dec = row.decimals || (manualCategory === 'metals' ? 2 : 3);
        const oldR = Number(row.oldRate) || 0;
        const newR = Number(row.newRate) || oldR;

        const isUp = oldR > 0 && newR > oldR;
        const isDown = oldR > 0 && newR < oldR;
        const diff = Math.abs(newR - oldR);

        let diffHtml = '<span style="color:#94a3b8; font-size:12px; background:rgba(148,163,184,0.1); padding:3px 8px; border-radius:6px;">🟢 استقرار</span>';
        if (oldR > 0 && Math.abs(newR - oldR) >= 0.0001) {
          if (isUp) {
            diffHtml = '<span style="color:#34d399; font-weight:700; font-size:12px; background:rgba(16,185,129,0.15); padding:3px 8px; border-radius:6px;">🔺 +' + diff.toFixed(dec) + '</span>';
          } else if (isDown) {
            diffHtml = '<span style="color:#f87171; font-weight:700; font-size:12px; background:rgba(244,63,94,0.15); padding:3px 8px; border-radius:6px;">🔻 -' + diff.toFixed(dec) + '</span>';
          }
        }

        const statusHtml = row.selected 
          ? '<span style="color:#10b981; font-weight:700; font-size:11px; background:rgba(16,185,129,0.15); padding:3px 8px; border-radius:9999px;">✓ محدد</span>'
          : '<span style="color:#64748b; font-size:11px; background:rgba(100,116,139,0.15); padding:3px 8px; border-radius:9999px;">✕ مستبعد</span>';

        html += '<tr id="manual-tr-' + row.code + '" class="' + (row.selected ? 'manual-row-selected' : '') + '">' +
          '<td style="text-align:center;">' +
            '<input type="checkbox" id="manual-row-chk-' + row.code + '" ' + (row.selected ? 'checked' : '') + ' onchange="toggleManualRow(&quot;' + row.code + '&quot;, this.checked)" style="accent-color:#10b981; width:18px; height:18px; cursor:pointer;">' +
          '</td>' +
          '<td>' +
            '<div style="display:flex; align-items:center; gap:8px;">' +
              '<span style="font-size:20px;">' + flagIcon + '</span>' +
              '<div>' +
                '<div style="font-size:13px; font-weight:700; color:#f8fafc;">' + row.name + '</div>' +
                '<div style="font-size:10px; color:#94a3b8; font-family:monospace;">' + row.code + '</div>' +
              '</div>' +
            '</div>' +
          '</td>' +
          '<td style="text-align:center;">' +
            '<span class="font-num" style="font-size:14px; font-weight:600; color:#cbd5e1;">' + (oldR > 0 ? oldR.toFixed(dec) : 'غير مسجل') + '</span> ' +
            '<span style="font-size:10px; color:#64748b;">د.ل</span>' +
          '</td>' +
          '<td style="text-align:center;">' +
            '<div style="display:inline-flex; align-items:center; gap:6px;">' +
              '<input type="number" step="any" id="manual-input-' + row.code + '" value="' + (newR > 0 ? newR : '') + '" placeholder="' + (oldR > 0 ? oldR.toFixed(dec) : '0.00') + '" class="manual-table-input font-num" oninput="onManualTablePriceChange(&quot;' + row.code + '&quot;, this.value)">' +
              '<span style="font-size:11px; color:#94a3b8;">د.ل</span>' +
            '</div>' +
          '</td>' +
          '<td style="text-align:center;" id="manual-diff-' + row.code + '">' +
            diffHtml +
          '</td>' +
          '<td style="text-align:center;" id="manual-status-' + row.code + '">' +
            statusHtml +
          '</td>' +
        '</tr>';
      }

      tbody.innerHTML = html;
    }

    async function submitManualTableRates() {
      const selectedItems = manualTableRows.filter(r => r.selected && r.newRate > 0);
      if (selectedItems.length === 0) {
        showToast('يرجى تحديد عنصر واحد على الأقل وإدخال سعر صحيح أكبر من الصفر في الجدول', true);
        return;
      }

      const autoBroadcast = Boolean(document.getElementById('manual-table-auto-broadcast')?.checked);
      const broadcastTarget = document.getElementById('manual-table-broadcast-target')?.value || 'all';
      const submitBtn = document.getElementById('btn-manual-table-submit');

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = '⏳ جاري الحفظ والنشر...';
      }

      showToast('جاري حفظ الأسعار ومزامنة قاعدة البيانات والنشر...');

      try {
        const res = await fetch('/api/dashboard/manual-rates-batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            category: manualCategory,
            items: selectedItems,
            autoBroadcast,
            broadcastTarget
          })
        });

        const data = await res.json();
        if (data.success) {
          showToast(data.message || 'تم حفظ ونشر الأسعار بنجاح!');
          fetchDashboardData();
          loadManualTableData();
        } else {
          showToast(data.error || 'فشل تحديث الأسعار', true);
        }
      } catch (err) {
        showToast('خطأ أثناء إرسال البيانات: ' + err.message, true);
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = '💾 حفظ التعديلات ونشر النشرة الآن';
        }
      }
    }

    let queueCountdownTimer = null;
    let localRemainingSeconds = 0;
    let isCooldownActiveState = false;
    let isAggregatingState = false;
    let isQuietHoursActiveState = false;
    let quietHoursEndStr = '08:30';
    let queueItemsCount = 0;
    let currentPreviewText = '';

    function formatTimeSeconds(totalSec) {
      if (totalSec <= 0) return '00:00';
      const m = Math.floor(totalSec / 60);
      const s = totalSec % 60;
      return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    }

    function updateQueueTickerDisplay() {
      const clock = document.getElementById('queue-countdown-clock');
      const statusText = document.getElementById('queue-countdown-status-text');
      const badge = document.getElementById('queue-status-badge');
      const iconWrap = document.getElementById('queue-countdown-icon-wrap');

      // 🌙 إذا كانت ساعات الصمت الليلي نشطة
      if (isQuietHoursActiveState) {
        if (clock) {
          clock.textContent = quietHoursEndStr || '08:30';
          clock.style.color = '#fbbf24';
        }
        if (iconWrap) {
          iconWrap.innerHTML = '🌙';
          iconWrap.style.borderColor = 'rgba(251, 191, 36, 0.4)';
        }
        if (statusText) statusText.textContent = '(وضع الصمت الليلي نشط حتى ' + (quietHoursEndStr || '08:30') + ' - النشر التلقائي محجوز للصباح لمنع الإزعاج)';
        if (badge) {
          badge.style.background = 'rgba(251, 191, 36, 0.15)';
          badge.style.color = '#fbbf24';
          badge.textContent = '🌙 صمت ليلي (حتى ' + (quietHoursEndStr || '08:30') + ')';
        }
        return;
      }

      const timeFormatted = formatTimeSeconds(localRemainingSeconds);

      if (clock) {
        clock.textContent = timeFormatted;
        if (localRemainingSeconds > 0) {
          clock.style.color = '#38bdf8';
        } else {
          clock.style.color = '#34d399';
        }
      }

      if (localRemainingSeconds > 0) {
        if (iconWrap) {
          iconWrap.innerHTML = '⏳';
          iconWrap.style.borderColor = 'rgba(56, 189, 248, 0.4)';
        }
        if (isCooldownActiveState) {
          if (statusText) statusText.textContent = '(فترة التهدئة نشطة لمنع الإزعاج - النشر التلقائي بعد ' + timeFormatted + ')';
          if (badge) {
            badge.style.background = 'rgba(245, 158, 11, 0.15)';
            badge.style.color = '#fbbf24';
            badge.textContent = '⏳ متبقي ' + timeFormatted + ' للنشر';
          }
        } else if (isAggregatingState) {
          if (statusText) statusText.textContent = '(جاري تجميع التحديثات في الطابور - النشر خلال ' + timeFormatted + ')';
          if (badge) {
            badge.style.background = 'rgba(56, 189, 248, 0.15)';
            badge.style.color = '#38bdf8';
            badge.textContent = '🔄 تجميع (' + timeFormatted + ')';
          }
        } else {
          if (statusText) statusText.textContent = '(موعد النشر بعد ' + timeFormatted + ')';
          if (badge) {
            badge.style.background = 'rgba(245, 158, 11, 0.15)';
            badge.style.color = '#fbbf24';
            badge.textContent = '⏳ متبقي ' + timeFormatted;
          }
        }
      } else {
        if (iconWrap) {
          iconWrap.innerHTML = '🟢';
          iconWrap.style.borderColor = 'rgba(52, 211, 153, 0.4)';
        }
        if (queueItemsCount > 0) {
          if (statusText) statusText.textContent = '(فترة الانتظار انتهت - جاهز للنشر الفوري لـ ' + queueItemsCount + ' عملة)';
          if (badge) {
            badge.style.background = 'rgba(16, 185, 129, 0.15)';
            badge.style.color = '#34d399';
            badge.textContent = '🟢 جاهز للنشر (' + queueItemsCount + ' عملة بالانتظار)';
          }
        } else {
          if (statusText) statusText.textContent = '(فترة الانتظار غير نشطة - جاهز للنشر فور ورود أي أسعار جديدة)';
          if (badge) {
            badge.style.background = 'rgba(56, 189, 248, 0.15)';
            badge.style.color = '#38bdf8';
            badge.textContent = '🟢 جاهز للنشر (0 بالانتظار)';
          }
        }
      }
    }

    function startQueueCountdownLoop() {
      if (queueCountdownTimer) return;
      queueCountdownTimer = setInterval(() => {
        if (localRemainingSeconds > 0 && !isQuietHoursActiveState) {
          localRemainingSeconds--;
          updateQueueTickerDisplay();
          if (localRemainingSeconds === 0) {
            fetchBroadcastQueue();
          }
        }
      }, 1000);
    }

    function renderQueueUI(q) {
      const container = document.getElementById('queue-items-container');

      isCooldownActiveState = Boolean(q.isCooldownActive);
      isAggregatingState = Boolean(q.isAggregating);
      isQuietHoursActiveState = Boolean(q.quietHours?.isActive);
      quietHoursEndStr = q.quietHours?.quietEnd || '08:30';
      queueItemsCount = Number(q.queueSize || 0);

      if (q.nextBroadcastWaitSeconds !== undefined) {
        localRemainingSeconds = Number(q.nextBroadcastWaitSeconds);
      } else if (q.isCooldownActive && q.cooldownRemainingSeconds !== undefined) {
        localRemainingSeconds = Number(q.cooldownRemainingSeconds);
      } else if (q.isAggregating && q.aggregationRemainingSeconds !== undefined) {
        localRemainingSeconds = Number(q.aggregationRemainingSeconds);
      } else if (q.isCooldownActive && q.cooldownRemainingMinutes) {
        localRemainingSeconds = Number(q.cooldownRemainingMinutes) * 60;
      } else {
        localRemainingSeconds = 0;
      }

      updateQueueTickerDisplay();
      startQueueCountdownLoop();

      if (container) {
        if (!q.items || q.items.length === 0) {
          container.innerHTML = '<div style="color:#64748b; font-size:12px; text-align:center;">طابور التحديثات فارغ حالياً (لا توجد عملات بانتظار النشر)</div>';
        } else {
          let html = '<div style="display:flex; flex-wrap:wrap; gap:8px;">';
          for (const item of q.items) {
            const isUp = item.diff > 0;
            const isDown = item.diff < 0;
            const color = isUp ? '#34d399' : isDown ? '#f87171' : '#cbd5e1';
            const sign = isUp ? '+' : '';
            const itemIdStr = item.id || item.name;
            html += '<div style="background:#1e293b; border:1px solid #334155; border-radius:6px; padding:6px 10px; font-size:11px; display:flex; align-items:center; gap:6px;">' +
              '<button type="button" onclick="removeSingleQueueItem(\'' + itemIdStr + '\', event)" style="background:rgba(239,68,68,0.2); border:1px solid rgba(239,68,68,0.3); color:#fca5a5; border-radius:4px; width:18px; height:18px; display:inline-flex; align-items:center; justify-content:center; font-size:10px; cursor:pointer; padding:0; line-height:1; margin-left:2px;" title="استبعاد هذه العملة من الطابور">✕</button>' +
              '<span style="font-weight:700; color:#f1f5f9;">' + item.name + '</span>' +
              '<span class="font-num" style="color:#cbd5e1;">' + Number(item.newVal).toFixed(2) + '</span>' +
              '<span class="font-num" style="color:' + color + '; font-weight:700;">(' + sign + item.diff + ')</span>' +
              '<span style="color:#64748b; font-size:10px;">(' + item.ageSeconds + 'ث)</span>' +
            '</div>';
          }
          html += '</div>';
          container.innerHTML = html;
        }
      }
    }

    async function removeSingleQueueItem(id, event) {
      if (event) {
        event.stopPropagation();
        event.preventDefault();
      }
      if (!confirm('هل تريد استبعاد هذه العملة من الطابور؟')) return;
      showToast('جاري استبعاد العملة من الطابور...');
      try {
        const res = await fetch('/api/dashboard/broadcast/queue/remove-item', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id })
        });
        const data = await res.json();
        if (data.success) {
          showToast(data.message || 'تم استبعاد العملة من الطابور');
          fetchBroadcastQueue();
        } else {
          showToast('فشل الاستبعاد: ' + (data.error || 'خطأ'), true);
        }
      } catch (err) {
        showToast('خطأ بالاتصال: ' + err.message, true);
      }
    }

    async function openBroadcastPreviewModal() {
      const modal = document.getElementById('queue-preview-modal');
      const body = document.getElementById('preview-message-body');
      const countEl = document.getElementById('preview-stat-count');
      const charsEl = document.getElementById('preview-stat-chars');
      const linesEl = document.getElementById('preview-stat-lines');

      if (body) body.textContent = '⏳ جاري توليد المعاينة الحية للمنشور الموحد...';
      if (modal) modal.classList.remove('hidden');

      try {
        const res = await fetch('/api/dashboard/broadcast/queue/preview');
        const data = await res.json();
        if (data.success) {
          currentPreviewText = data.message || '';
          if (body) body.textContent = currentPreviewText;
          if (countEl) countEl.textContent = '📦 العملات: ' + (data.itemCount || 0);
          if (charsEl) charsEl.textContent = '📝 الأحرف: ' + (data.charactersCount || currentPreviewText.length);
          if (linesEl) linesEl.textContent = '📏 الأسطر: ' + (data.linesCount || currentPreviewText.split('\n').length);
        } else {
          if (body) body.textContent = '❌ تعذر توليد المعاينة: ' + (data.error || 'خطأ غير معروف');
        }
      } catch (err) {
        if (body) body.textContent = '❌ خطأ بالاتصال: ' + err.message;
      }
    }

    function closeBroadcastPreviewModal() {
      const modal = document.getElementById('queue-preview-modal');
      if (modal) modal.classList.add('hidden');
    }

    async function copyPreviewMessageText() {
      if (!currentPreviewText) {
        showToast('لا يوجد نص لنسخه', true);
        return;
      }
      try {
        await navigator.clipboard.writeText(currentPreviewText);
        showToast('تم نسخ نص المنشور بنجاح إلى الحافظة 📋');
      } catch (e) {
        const ta = document.createElement('textarea');
        ta.value = currentPreviewText;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showToast('تم نسخ نص المنشور بنجاح 📋');
      }
    }

    async function flushQueueFromPreview() {
      closeBroadcastPreviewModal();
      await flushBroadcastQueue();
    }

    async function fetchBroadcastQueue() {
      try {
        const res = await fetch('/api/dashboard/broadcast/queue');
        const data = await res.json();
        if (data.success && data.queue) {
          renderQueueUI(data.queue);
        }
      } catch (err) {}
    }

    async function flushBroadcastQueue() {
      showToast('جاري تفريغ الطابور والنشر الموحد في القنوات...');
      try {
        const res = await fetch('/api/dashboard/broadcast/queue/flush', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          showToast(data.message || 'تم نشر الطابور بنجاح');
          fetchDashboardData();
        } else {
          showToast('فشل النشر: ' + (data.error || 'خطأ'), true);
        }
      } catch (err) {
        showToast('خطأ بالاتصال: ' + err.message, true);
      }
    }

    async function clearBroadcastQueueClient() {
      if (!confirm('هل أنت متأكد من مسح جميع العملات المنتظرة في الطابور وتصفير عداد الوقت للبدء من جديد؟')) return;
      showToast('جاري مسح الطابور وتصفير الوقت للبدء من جديد...');
      try {
        const res = await fetch('/api/dashboard/broadcast/queue/clear', { 
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ resetTimer: true })
        });
        const data = await res.json();
        if (data.success) {
          queueItemsCount = 0;
          isCooldownActiveState = true;
          if (data.cooldownRemainingSeconds !== undefined) {
            localRemainingSeconds = Number(data.cooldownRemainingSeconds);
          } else {
            const intervalMins = parseInt(document.getElementById('setting-broadcast-interval')?.value || '20');
            localRemainingSeconds = intervalMins * 60;
          }
          updateQueueTickerDisplay();
          const container = document.getElementById('queue-items-container');
          if (container) {
            container.innerHTML = '<div style="color:#64748b; font-size:12px; text-align:center;">طابور التحديثات فارغ حالياً (تم مسح الطابور وتصفير الوقت)</div>';
          }
          showToast(data.message || 'تم مسح الطابور وتصفير عداد الوقت للبدء من جديد');
          fetchDashboardData();
        } else {
          showToast('فشل المسح: ' + (data.error || 'خطأ'), true);
        }
      } catch (err) {
        showToast('خطأ بالاتصال: ' + err.message, true);
      }
    }

    async function resetBroadcastCooldownOnly() {
      showToast('جاري تصفير وإعادة تشغيل عداد الوقت للبدء من جديد...');
      try {
        const res = await fetch('/api/dashboard/broadcast/cooldown/reset', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ toZero: false })
        });
        const data = await res.json();
        if (data.success) {
          isCooldownActiveState = true;
          localRemainingSeconds = Number(data.cooldownRemainingSeconds || 1200);
          updateQueueTickerDisplay();
          showToast(data.message || 'تمت إعادة تشغيل عداد فترة الانتظار');
          fetchBroadcastQueue();
        } else {
          showToast('فشل إعادة تشغيل العداد', true);
        }
      } catch (err) {
        showToast('خطأ بالاتصال: ' + err.message, true);
      }
    }

    async function bypassBroadcastCooldown() {
      if (!confirm('هل تريد تجاوز فترة الانتظار وإتاحة النشر التلقائي فوراً دون انتظار؟')) return;
      showToast('جاري إلغاء فترة الانتظار وإتاحة النشر...');
      try {
        const res = await fetch('/api/dashboard/broadcast/cooldown/reset', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ toZero: true })
        });
        const data = await res.json();
        if (data.success) {
          isCooldownActiveState = false;
          localRemainingSeconds = 0;
          updateQueueTickerDisplay();
          showToast('تم إلغاء فترة الانتظار وأصبح النشر متاحاً فوراً');
          fetchBroadcastQueue();
        } else {
          showToast('فشل إلغاء فترة الانتظار', true);
        }
      } catch (err) {
        showToast('خطأ بالاتصال: ' + err.message, true);
      }
    }

    async function saveBroadcastSettings() {
      const minBroadcastIntervalMinutes = parseInt(document.getElementById('setting-broadcast-interval')?.value || '20');
      const minPriceChangeThreshold = parseFloat(document.getElementById('setting-price-threshold')?.value || '0.015');
      const aggregationWindowSeconds = parseInt(document.getElementById('setting-agg-window')?.value || '45');
      const hourlyPostLimit = parseInt(document.getElementById('setting-hourly-cap')?.value || '4');
      const smartConsolidatedPost = Boolean(document.getElementById('setting-smart-consolidated')?.checked);
      const quietHoursEnabled = Boolean(document.getElementById('setting-quiet-hours-enabled')?.checked);
      const quietHoursStart = document.getElementById('setting-quiet-hours-start')?.value || '01:00';
      const quietHoursEnd = document.getElementById('setting-quiet-hours-end')?.value || '08:30';

      showToast('جاري حفظ شروط وإعدادات النشر التلقائي...');
      try {
        const res = await fetch('/api/dashboard/broadcast/settings/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            minBroadcastIntervalMinutes,
            minPriceChangeThreshold,
            aggregationWindowSeconds,
            hourlyPostLimit,
            smartConsolidatedPost,
            quietHoursEnabled,
            quietHoursStart,
            quietHoursEnd
          })
        });
        const data = await res.json();
        if (data.success) {
          showToast(data.message || 'تم حفظ الإعدادات بنجاح');
          fetchDashboardData();
        } else {
          showToast('فشل الحفظ: ' + data.error, true);
        }
      } catch (err) {
        showToast('خطأ بالاتصال: ' + err.message, true);
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

    // ─── Currency Terms & Extraction Settings ───
    let currentTerms = (function() {
      try {
        const el = document.getElementById('initial-dashboard-state');
        if (el) {
          const state = JSON.parse(el.textContent || '{}');
          if (Array.isArray(state.terms)) return state.terms;
        }
      } catch (e) {}
      return [];
    })();
    let activeTestTerm = null;

    const FLAG_EMOJIS = {
      us: '🇺🇸', eu: '🇪🇺', gb: '🇬🇧', tr: '🇹🇷', tn: '🇹🇳', eg: '🇪🇬',
      ae: '🇦🇪', sa: '🇸🇦', qa: '🇶🇦', kw: '🇰🇼', jo: '🇯🇴', bh: '🇧🇭',
      cn: '🇨🇳', ca: '🇨🇦', ch: '🇨🇭', gold: '🪙', silver: '🥈', ly: '🇱🇾'
    };

    function getFlagEmoji(code) {
      if (!code) return '💵';
      return FLAG_EMOJIS[code.toLowerCase()] || '💵';
    }

    function renderTermsCards(termsToRender) {
      const container = document.getElementById('terms-cards-container');
      const badgeCount = document.getElementById('terms-count-badge');
      if (!container) return;

      const terms = termsToRender || currentTerms || [];
      if (badgeCount) badgeCount.textContent = String(terms.length);

      if (!terms || terms.length === 0) {
        container.innerHTML = '<div style="grid-column: 1/-1; text-align:center; padding:30px 16px; background:#1e293b; border-radius:12px; border:1px dashed #334155; color:#94a3b8;">' +
          '<div style="font-size:24px; margin-bottom:8px;">🪙</div>' +
          '<div style="font-size:14px; font-weight:700; color:#f1f5f9; margin-bottom:4px;">لا توجد شروط عملات مضافة</div>' +
          '<div style="font-size:12px; margin-bottom:12px;">أضف عملة جديدة أو قم بالمزامنة من قاعدة البيانات</div>' +
          '<button class="btn btn-primary btn-sm" onclick="openTermModal()">➕ إضافة عملة جديدة</button>' +
        '</div>';
        return;
      }

      let html = '';
      for (const t of terms) {
        const flagEmoji = getFlagEmoji(t.flag);
        const minVal = Number(t.min).toFixed(2);
        const maxVal = Number(t.max).toFixed(2);
        const safeRegex = String(t.regex || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        html += '<div class="term-card" id="term-card-' + t.id + '">' +
          '<div>' +
            '<div class="term-header">' +
              '<div class="term-title">' +
                '<span style="font-size:18px;">' + flagEmoji + '</span>' +
                '<span>' + t.name + '</span>' +
              '</div>' +
              '<span class="term-badge">' + t.id + '</span>' +
            '</div>' +
            '<div style="margin: 8px 0 6px 0;">' +
              '<div style="font-size:10px; color:#94a3b8; margin-bottom:2px;">شرط قبول السعر (نطاق المطابقة):</div>' +
              '<div class="term-range-badge">' +
                '<span>من </span>' +
                '<span class="font-num" style="color:#ffffff;">' + minVal + '</span>' +
                '<span> إلى </span>' +
                '<span class="font-num" style="color:#ffffff;">' + maxVal + ' د.ل</span>' +
                (t.isInverse ? '<span style="color:#f59e0b; font-size:10px; margin-right:4px;">(معكوس 1/x)</span>' : '') +
              '</div>' +
            '</div>' +
            '<div>' +
              '<div style="font-size:10px; color:#64748b; margin-bottom:2px;">نمط المطابقة (Regex):</div>' +
              '<div class="term-regex-box">' + safeRegex + '</div>' +
            '</div>' +
          '</div>' +
          '<div style="display:flex; gap:4px; margin-top:4px; border-top:1px solid #334155; padding-top:8px;">' +
            '<button class="btn btn-secondary btn-sm" style="flex:1; font-size:11px;" onclick="openTermModal(&quot;' + t.id + '&quot;)">✏️ تعديل</button>' +
            '<button class="btn btn-secondary btn-sm" style="flex:1; font-size:11px;" onclick="openTestTermModal(&quot;' + t.id + '&quot;)">🧪 تجربة</button>' +
            '<button class="btn btn-danger btn-sm" style="padding:4px 8px; font-size:11px;" onclick="deleteTerm(&quot;' + t.id + '&quot;)" title="حذف العملة">🗑️</button>' +
          '</div>' +
        '</div>';
      }
      container.innerHTML = html;
    }

    function filterTermsCards() {
      const q = (document.getElementById('terms-search-input')?.value || '').trim().toLowerCase();
      if (!q) {
        renderTermsCards(currentTerms);
        return;
      }
      const filtered = currentTerms.filter(t => 
        t.name.toLowerCase().includes(q) || 
        t.id.toLowerCase().includes(q) ||
        (t.regex && t.regex.toLowerCase().includes(q))
      );
      renderTermsCards(filtered);
    }

    function openTermModal(termId) {
      const modal = document.getElementById('term-modal');
      const isEditInput = document.getElementById('term-modal-is-edit');
      const idInput = document.getElementById('term-modal-id');
      const nameInput = document.getElementById('term-modal-name');
      const flagInput = document.getElementById('term-modal-flag');
      const minInput = document.getElementById('term-modal-min');
      const maxInput = document.getElementById('term-modal-max');
      const keywordsInput = document.getElementById('term-modal-keywords');
      const regexInput = document.getElementById('term-modal-regex');
      const inverseInput = document.getElementById('term-modal-inverse');
      const titleEl = document.getElementById('term-modal-title');

      if (!modal) return;

      if (termId) {
        const term = currentTerms.find(t => t.id === termId);
        if (!term) return;
        if (titleEl) titleEl.textContent = '⚙️ تعديل شروط: ' + term.name + ' (' + term.id + ')';
        if (isEditInput) isEditInput.value = '1';
        if (idInput) {
          idInput.value = term.id;
          idInput.disabled = true;
        }
        if (nameInput) nameInput.value = term.name;
        if (flagInput) flagInput.value = term.flag || 'ly';
        if (minInput) minInput.value = term.min;
        if (maxInput) maxInput.value = term.max;
        if (regexInput) regexInput.value = term.regex;
        if (inverseInput) inverseInput.checked = Boolean(term.isInverse);
        if (keywordsInput) {
          const matchWords = term.regex.match(/\(\?:([^\)]+)\)/);
          if (matchWords && matchWords[1]) {
            keywordsInput.value = matchWords[1].split('|').slice(0, 5).join(', ');
          } else {
            keywordsInput.value = '';
          }
        }
      } else {
        if (titleEl) titleEl.textContent = '➕ إضافة عملة جديدة وشروط الاستخراج';
        if (isEditInput) isEditInput.value = '0';
        if (idInput) {
          idInput.value = '';
          idInput.disabled = false;
        }
        if (nameInput) nameInput.value = '';
        if (flagInput) flagInput.value = 'us';
        if (minInput) minInput.value = '9.00';
        if (maxInput) maxInput.value = '12.00';
        if (keywordsInput) keywordsInput.value = '';
        if (regexInput) regexInput.value = '(?:كود_العملة|الاسم)[^\\d]{0,40}(\\d{1,3}(?:[\\.,]\\d{1,4})?)(?:\\s+(?:بيع|شراء)?[^\\d]{0,15}(\\d{1,3}(?:[\\.,]\\d{1,4})?))?';
        if (inverseInput) inverseInput.checked = false;
      }

      modal.classList.remove('hidden');
    }

    function closeTermModal() {
      const modal = document.getElementById('term-modal');
      if (modal) modal.classList.add('hidden');
    }

    function autoGenerateRegexFromKeywords() {
      const keywordsRaw = document.getElementById('term-modal-keywords')?.value.trim();
      const code = document.getElementById('term-modal-id')?.value.trim();
      const name = document.getElementById('term-modal-name')?.value.trim();

      const wordsSet = new Set();
      if (code) wordsSet.add(code);
      if (name) wordsSet.add(name);

      if (keywordsRaw) {
        keywordsRaw.split(/[,،]+/).map(w => w.trim()).filter(Boolean).forEach(w => wordsSet.add(w));
      }

      if (wordsSet.size === 0) {
        showToast('اكتب بعض الكلمات الدلالية أولاً', true);
        return;
      }

      const specialChars = ['.', '*', '+', '?', '^', '$', '{', '}', '(', ')', '|', '[', ']', String.fromCharCode(92), '/'];
      const escapedWords = Array.from(wordsSet).map(w => {
        let res = '';
        for (let i = 0; i < w.length; i++) {
          const ch = w[i];
          if (specialChars.indexOf(ch) !== -1) res += String.fromCharCode(92) + ch;
          else res += ch;
        }
        return res;
      });
      const pattern = '(?:' + escapedWords.join('|') + ')[^0-9]{0,40}([0-9]+(?:[.,][0-9]+)?)(?:\\s+(?:بيع|شراء)?[^0-9]{0,15}([0-9]+(?:[.,][0-9]+)?))?';
      
      const regexInput = document.getElementById('term-modal-regex');
      if (regexInput) regexInput.value = pattern;
      showToast('تم توليد نمط Regex بنجاح');
    }

    async function saveTermModal() {
      const id = document.getElementById('term-modal-id')?.value.trim().toUpperCase();
      const name = document.getElementById('term-modal-name')?.value.trim();
      const flag = document.getElementById('term-modal-flag')?.value.trim() || 'ly';
      const min = parseFloat(document.getElementById('term-modal-min')?.value);
      const max = parseFloat(document.getElementById('term-modal-max')?.value);
      const regex = document.getElementById('term-modal-regex')?.value.trim();
      const isInverse = Boolean(document.getElementById('term-modal-inverse')?.checked);

      if (!id) {
        showToast('يرجى إدخال كود العملة الفريد (ID)', true);
        return;
      }
      if (!name) {
        showToast('يرجى إدخال اسم العملة', true);
        return;
      }
      if (isNaN(min) || isNaN(max)) {
        showToast('الحد الأدنى والأقصى يجب أن يكونا أرقاماً صحيحة', true);
        return;
      }
      if (min > max) {
        showToast('الحد الأدنى لا يمكن أن يتجاوز الحد الأقصى', true);
        return;
      }
      if (!regex) {
        showToast('يرجى كتابة أو توليد نمط المطابقة (Regex)', true);
        return;
      }

      showToast('جاري حفظ العملة في قاعدة البيانات...');
      try {
        const res = await fetch('/api/dashboard/settings/terms/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, name, flag, min, max, regex, isInverse })
        });
        const data = await res.json();
        if (data.success) {
          showToast(data.message);
          currentTerms = data.terms;
          renderTermsCards(currentTerms);
          closeTermModal();
        } else {
          showToast('فشل الحفظ: ' + data.error, true);
        }
      } catch (err) {
        showToast('خطأ: ' + err.message, true);
      }
    }

    async function deleteTerm(termId) {
      const term = currentTerms.find(t => t.id === termId);
      const label = term ? term.name + ' (' + term.id + ')' : termId;
      if (!confirm('هل أنت متأكد من حذف العملة [' + label + '] من شروط الاستخراج؟')) {
        return;
      }

      showToast('جاري حذف العملة ' + termId + '...');
      try {
        const res = await fetch('/api/dashboard/settings/terms/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: termId })
        });
        const data = await res.json();
        if (data.success) {
          showToast(data.message);
          currentTerms = data.terms;
          renderTermsCards(currentTerms);
        } else {
          showToast('فشل الحذف: ' + data.error, true);
        }
      } catch (err) {
        showToast('خطأ: ' + err.message, true);
      }
    }

    async function syncTermsFromDB() {
      showToast('جاري مزامنة شروط العملات من جدول قاعدة البيانات...');
      try {
        const res = await fetch('/api/dashboard/settings/terms/sync-db', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          currentTerms = data.terms;
          renderTermsCards(currentTerms);
          showToast('تمت مزامنة ' + currentTerms.length + ' عملة من قاعدة البيانات بنجاح');
        } else {
          showToast('فشل المزامنة: ' + data.error, true);
        }
      } catch (err) {
        showToast('خطأ بالاتصال: ' + err.message, true);
      }
    }

    function openTestTermModal(termId) {
      activeTestTerm = currentTerms.find(t => t.id === termId);
      if (!activeTestTerm) return;

      const modal = document.getElementById('test-term-modal');
      const infoEl = document.getElementById('test-term-info');
      const textInput = document.getElementById('test-term-text');
      const resultBox = document.getElementById('test-term-result');

      if (infoEl) {
        infoEl.innerHTML = 'اختبار عملة: <strong>' + activeTestTerm.name + ' (' + activeTestTerm.id + ')</strong> | ' +
          'النطاق المشروط: <strong style="color:#34d399;">[' + activeTestTerm.min + ' - ' + activeTestTerm.max + '] د.ل</strong>';
      }
      if (textInput) {
        textInput.value = 'سعر ' + activeTestTerm.name + ' كاش اليوم 9.60 بيع و 9.58 شراء في طرابلس';
      }
      if (resultBox) {
        resultBox.classList.add('hidden');
        resultBox.textContent = '';
      }
      if (modal) modal.classList.remove('hidden');
    }

    function closeTestTermModal() {
      const modal = document.getElementById('test-term-modal');
      if (modal) modal.classList.add('hidden');
      activeTestTerm = null;
    }

    async function executeTermTest() {
      if (!activeTestTerm) return;
      const text = document.getElementById('test-term-text')?.value.trim();
      const resultBox = document.getElementById('test-term-result');

      if (!text) {
        showToast('ألصق نصاً للاختبار أولاً', true);
        return;
      }

      if (resultBox) {
        resultBox.classList.remove('hidden');
        resultBox.style.background = '#0f172a';
        resultBox.style.border = '1px solid #334155';
        resultBox.innerHTML = '<span style="color:#38bdf8;">⏳ جاري فحص النص وتطبيق شروط الاستخراج...</span>';
      }

      try {
        const res = await fetch('/api/dashboard/settings/terms/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            regex: activeTestTerm.regex,
            min: activeTestTerm.min,
            max: activeTestTerm.max,
            isInverse: activeTestTerm.isInverse,
            text: text
          })
        });
        const data = await res.json();
        if (data.success && resultBox) {
          if (data.matched) {
            resultBox.style.background = data.withinRange ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)';
            resultBox.style.border = data.withinRange ? '1px solid #10b981' : '1px solid #ef4444';
            resultBox.innerHTML = '<div style="font-weight:700; margin-bottom:4px; color:' + (data.withinRange ? '#34d399' : '#f87171') + '">' + data.message + '</div>' +
              '<div style="font-size:11px; color:#cbd5e1;">النص المطابق: <code>' + (data.fullMatch || '') + '</code></div>' +
              '<div style="font-size:11px; color:#cbd5e1;">السعر المستخرج: <strong>' + data.capturedValue + '</strong> د.ل</div>' +
              '<div style="font-size:11px; color:#94a3b8;">شروط النطاق: [' + activeTestTerm.min + ' - ' + activeTestTerm.max + ']</div>';
          } else {
            resultBox.style.background = 'rgba(245, 158, 11, 0.15)';
            resultBox.style.border = '1px solid #f59e0b';
            resultBox.innerHTML = '<div style="color:#fbbf24; font-weight:700;">⚠️ لم يتم التعرف على هذه العملة في النص المدخل</div>' +
              '<div style="font-size:11px; color:#94a3b8; margin-top:2px;">تأكد من أن النص يحتوي على إحدى الكلمات الدلالية المحددة في النمط.</div>';
          }
        }
      } catch (err) {
        if (resultBox) {
          resultBox.innerHTML = '<span style="color:#ef4444;">خطأ: ' + err.message + '</span>';
        }
      }
    }

    // Load initial state
    try {
      const stateEl = document.getElementById('initial-dashboard-state');
      if (stateEl && stateEl.textContent) {
        const parsed = JSON.parse(stateEl.textContent.trim());
        if (parsed && parsed.rates) {
          currentRates = parsed.rates;
          renderUI(parsed);
        }
      }
    } catch (e) {}

    // Background fetch & polling
    fetchDashboardData();
    renderTermsCards(currentTerms);
    pollTimer = setInterval(fetchDashboardData, pollInterval);
  </script>
</body>
</html>`;
}
