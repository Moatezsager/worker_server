import { AppConfig } from './types';
import { TelegramManager } from '../telegramClient';
import { db, supabase, supabaseKey } from './db';
import fs from 'fs';
import path from 'path';

export let appConfig: AppConfig = {
  channels: ["dollarr_ly", "musheermarket", "lydollar", "suqalmushir"],
  telegramPostChannel: "lydollar",
  telegramAutoPost: false,
  telegramTemplateStyle: "classic",
  enableHttpScraper: true,
  enableUserTracking: true,
  minBroadcastIntervalMinutes: 20,
  minPriceChangeThreshold: 0.015,
  aggregationWindowSeconds: 45,
  smartConsolidatedPost: true,
  hourlyPostLimit: 4,
  quietHoursEnabled: false,
  quietHoursStart: "01:00",
  quietHoursEnd: "08:30",
  apiConfig: {
    enabled: true,
    rateLimitWindowMs: 60000,
    rateLimitMaxRequests: 20,
    banDurationMinutes: 5,
  },
  terms: [
    { id: "USD", name: "دولار أمريكي", regex: "(?:USD|usd|الدولار|دولار|الخضراء|خضراء|كاش|💵|🇺🇸)(?![^\\d\\n]*?(?:صك|شيك|بصك|حوال|دبي|تركي|صين|فضة))[^0-9\\n]{0,35}(\\d{1,2}(?:[\\.,]\\d{1,4})?)(?:\\s+(?:بيع|شراء)?[^0-9\\n]{0,15}(\\d{1,2}(?:[\\.,]\\d{1,4})?))?", min: 5.0, max: 25.0, isInverse: false, flag: "us" },
    { id: "EUR", name: "يورو", regex: "(?:EUR|eur|يورو|اليورو|💶|🇪🇺)(?![^\\d\\n]*?(?:صك|شيك|بصك|حوال|دبي|تركي|صين))[^0-9\\n]{0,35}(\\d{1,2}(?:[\\.,]\\d{1,4})?)(?:\\s+(?:بيع|شراء)?[^0-9\\n]{0,15}(\\d{1,2}(?:[\\.,]\\d{1,4})?))?", min: 5.0, max: 25.0, isInverse: false, flag: "eu" },
    { id: "GBP", name: "جنيه إسترليني", regex: "(?:GBP|gbp|باوند|استرليني|الباوند|💷|🇬🇧)(?![^\\d\\n]*?(?:صك|شيك|بصك|حوال))[^0-9\\n]{0,35}(\\d{1,2}(?:[\\.,]\\d{1,4})?)(?:\\s+(?:بيع|شراء)?[^0-9\\n]{0,15}(\\d{1,2}(?:[\\.,]\\d{1,4})?))?", min: 5.0, max: 25.0, isInverse: false, flag: "gb" },
    { id: "TND", name: "دينار تونسي", regex: "(?:TND|tnd|تونسي|تونس(?![ا-ي])|🇹🇳)[^\\d\\n]{0,35}?(?:100|1)?\\s*(?:=|ب|\\-)?\\s*(?<!\\d)((?!(?:100|1)\\s*(?:=|ب|دينار|ليبي|\\-))\\d{1,3}(?:[\\.,]\\d{1,4})?)(?:\\s+(?:بيع|شراء)?[^0-9\\n]{0,30}(?<!\\d)((?!(?:100|1)\\s*(?:=|ب|دينار|ليبي|\\-))\\d{1,3}(?:[\\.,]\\d{1,4})?))?", min: 2.5, max: 3.8, isInverse: false, flag: "tn" },
    { id: "EGP", name: "جنيه مصري", regex: "(?:EGP|egp|مصري|مصر(?![ا-ي])|🇪🇬)[^\\d\\n]{0,35}?(?:100|1)?\\s*(?:=|ب|\\-)?\\s*(?<!\\d)((?!(?:100|1)\\s*(?:=|ب|دينار|ليبي|\\-))\\d{1,3}(?:[\\.,]\\d{1,4})?)(?:\\s+(?:بيع|شراء)?[^0-9\\n]{0,30}(?<!\\d)((?!(?:100|1)\\s*(?:=|ب|دينار|ليبي|\\-))\\d{1,3}(?:[\\.,]\\d{1,4})?))?", min: 0.13, max: 0.28, isInverse: false, flag: "eg" },
    { id: "TRY", name: "ليرة تركية", regex: "(?:TRY|try|ليرة\\s*تركي[اة]|الليرة\\s*التركي[اة]|(?<!حوال[اة]\\s*)(?<!حوالات\\s*)(?<!دولار\\s*)(?<!يورو\\s*)100\\s*ليرة|(?<!حوال[اة]\\s*)(?<!حوالات\\s*)(?<!دولار\\s*)(?<!يورو\\s*)ليرة(?!\\s*ذهب)(?!\\s*مسبوك)(?![^\\d\\n]*?(?:حوال[اة]|حوالات|دولار|يورو|ذهب|فضة)))[^0-9\\n]{0,35}?(?:100|1)?\\s*(?:=|ب|\\-)?\\s*(?<!\\d)((?!(?:100|1)\\s*(?:=|ب|دينار|ليبي|\\-))\\d{1,3}(?:[\\.,]\\d{1,4})?)(?:\\s+(?:بيع|شراء)?[^0-9\\n]{0,30}(?<!\\d)((?!(?:100|1)\\s*(?:=|ب|دينار|ليبي|\\-))\\d{1,3}(?:[\\.,]\\d{1,4})?))?", min: 0.01, max: 5.0, isInverse: false, flag: "tr" },
    { id: "JOD", name: "دينار أردني", regex: "(?:JOD|jod|أردني|🇯🇴)[^0-9\\n]{0,35}(\\d{1,2}(?:[\\.,]\\d{1,4})?)(?:\\s+(?:بيع|شراء)?[^0-9\\n]{0,15}(\\d{1,2}(?:[\\.,]\\d{1,4})?))?", min: 5.0, max: 30.0, isInverse: false, flag: "jo" },
    { id: "BHD", name: "دينار بحريني", regex: "(?:BHD|bhd|بحريني|🇧🇭)[^0-9\\n]{0,35}(\\d{1,2}(?:[\\.,]\\d{1,4})?)(?:\\s+(?:بيع|شراء)?[^0-9\\n]{0,15}(\\d{1,2}(?:[\\.,]\\d{1,4})?))?", min: 10.0, max: 50.0, isInverse: false, flag: "bh" },
    { id: "KWD", name: "دينار كويتي", regex: "(?:KWD|kwd|كويتي|🇰🇼)[^0-9\\n]{0,35}(\\d{1,2}(?:[\\.,]\\d{1,4})?)(?:\\s+(?:بيع|شراء)?[^0-9\\n]{0,15}(\\d{1,2}(?:[\\.,]\\d{1,4})?))?", min: 10.0, max: 60.0, isInverse: false, flag: "kw" },
    { id: "AED", name: "درهم إماراتي", regex: "(?:AED|aed|درهم\\s*إماراتي|درهم\\s*اماراتي|الدرهم\\s*الإماراتي|الدرهم\\s*الاماراتي|(?<!\\S)درهم(?![^\\d\\n]*?(?:حوال[اة]|دبي))|🇦🇪(?![^\\d\\n]*?(?:حوال[اة]|دبي)))[^0-9\\n]{0,35}(\\d{0,2}(?:[\\.,]\\d{1,4})?)(?:\\s+(?:بيع|شراء)?[^0-9\\n]{0,15}(\\d{0,2}(?:[\\.,]\\d{1,4})?))?", min: 0.5, max: 10.0, isInverse: false, flag: "ae" },
    { id: "SAR", name: "ريال سعودي", regex: "(?:SAR|sar|سعودي|ريال|🇸🇦)[^0-9\\n]{0,35}(\\d{0,2}(?:[\\.,]\\d{1,4})?)(?:\\s+(?:بيع|شراء)?[^0-9\\n]{0,15}(\\d{0,2}(?:[\\.,]\\d{1,4})?))?", min: 0.5, max: 10.0, isInverse: false, flag: "sa" },
    { id: "QAR", name: "ريال قطري", regex: "(?:QAR|qar|قطري|🇶🇦)[^0-9\\n]{0,35}(\\d{0,2}(?:[\\.,]\\d{1,4})?)(?:\\s+(?:بيع|شراء)?[^0-9\\n]{0,15}(\\d{0,2}(?:[\\.,]\\d{1,4})?))?", min: 0.5, max: 10.0, isInverse: false, flag: "qa" },
    { id: "USD_CHECKS", name: "دولار أمريكي (صكوك)", regex: "(?:(?:صكوك|شيكات|شيك|بصك|صك|🏦)(?![^\\d\\n]*?(?:ال)?(?:جمهورية|تجاري|تجارة|أمان|امان|وحدة))[^0-9\\n]{0,35}(\\d{1,2}(?:[\\.,]\\d{1,4})?)(?:\\s+(?:بيع|شراء)?[^0-9\\n]{0,15}(\\d{1,2}(?:[\\.,]\\d{1,4})?))?)|(?:(\\d{1,2}(?:[\\.,]\\d{1,4})?)[^0-9\\n]{0,25}(?:صكوك|شيكات|شيك|بصك|صك)(?![^\\d\\n]*?(?:ال)?(?:جمهورية|تجاري|تجارة|أمان|امان|وحدة)))", min: 5.0, max: 25.0, isInverse: false, flag: "us" },
    { id: "USD_JBANK", name: "صكوك الجمهورية", regex: "(?:jbank|(?:صكوك\\s+|بصك\\s+)?(?:ال)?جمهورية)[^0-9\\n]{0,35}(\\d{1,2}(?:[\\.,]\\d{1,4})?)(?:\\s+(?:بيع|شراء)?[^0-9\\n]{0,15}(\\d{1,2}(?:[\\.,]\\d{1,4})?))?", min: 5.0, max: 25.0, isInverse: false, flag: "us" },
    { id: "USD_BCD", name: "صكوك التجارة", regex: "(?:bcd|(?:صكوك\\s+|بصك\\s+)?(?:التجارة والتنمية|(?:ال)?تجارة))[^0-9\\n]{0,35}(\\d{1,2}(?:[\\.,]\\d{1,4})?)(?:\\s+(?:بيع|شراء)?[^0-9\\n]{0,15}(\\d{1,2}(?:[\\.,]\\d{1,4})?))?", min: 5.0, max: 25.0, isInverse: false, flag: "us" },
    { id: "USD_NCB", name: "صكوك التجاري", regex: "(?:NCB|التجاري الوطني|(?:صكوك\\s+|بصك\\s+)?(?:ال)?تجاري)[^0-9\\n]{0,35}(\\d{1,2}(?:[\\.,]\\d{1,4})?)(?:\\s+(?:بيع|شراء)?[^0-9\\n]{0,15}(\\d{1,2}(?:[\\.,]\\d{1,4})?))?", min: 5.0, max: 25.0, isInverse: false, flag: "us" },
    { id: "USD_AB", name: "صكوك الأمان", regex: "(?:AB|(?:صكوك\\s+|بصك\\s+)?(?:الأمان|الامان|أمان|امان))[^0-9\\n]{0,35}(\\d{1,2}(?:[\\.,]\\d{1,4})?)(?:\\s+(?:بيع|شراء)?[^0-9\\n]{0,15}(\\d{1,2}(?:[\\.,]\\d{1,4})?))?", min: 5.0, max: 25.0, isInverse: false, flag: "us" },
    { id: "USD_WB", name: "صكوك الوحدة", regex: "(?:WB|(?:صكوك\\s+|بصك\\s+)?(?:ال)?وحدة)[^0-9\\n]{0,35}(\\d{1,2}(?:[\\.,]\\d{1,4})?)(?:\\s+(?:بيع|شراء)?[^0-9\\n]{0,15}(\\d{1,2}(?:[\\.,]\\d{1,4})?))?", min: 5.0, max: 25.0, isInverse: false, flag: "us" },
    { id: "USD_AE", name: "حوالات دبي", regex: "(?:USD_AE|usd_ae|(?:دولار\\s*(?:حوال[اة]|حوالات)?\\s*(?:دبي|الإمارات|الامارات)|حوال[اة]\\s*(?:دبي|الإمارات|الامارات)|حوالات\\s*(?:دبي|الإمارات|الامارات)))(?![^\\d\\n]*?(?:درهم|يورو|ذهب|فضة))[^0-9\\n]{0,35}(\\d{1,2}(?:[\\.,]\\d{1,4})?)(?:\\s+(?:بيع|شراء)?[^0-9\\n]{0,15}(\\d{1,2}(?:[\\.,]\\d{1,4})?))?", min: 5.0, max: 25.0, isInverse: false, flag: "ae" },
    { id: "USD_TR", name: "حوالات تركيا", regex: "(?:USD_TR|usd_tr|(?:دولار\\s*(?:حوال[اة]|حوالات)?\\s*تركي[اة]|حوال[اة]\\s*تركي[اة]|حوالات\\s*تركي[اة]|حوال[اة]\\s*اسطنبول|حوالات\\s*اسطنبول|حوالة\\s*تركي|حوالات\\s*تركي|دولار\\s*تركي[اة]))(?![^\\d\\n]*?(?:يورو|ليرة|فضة))[^0-9\\n]{0,35}(\\d{1,2}(?:[\\.,]\\d{1,4})?)(?:\\s+(?:بيع|شراء)?[^0-9\\n]{0,15}(\\d{1,2}(?:[\\.,]\\d{1,4})?))?", min: 5.0, max: 25.0, isInverse: false, flag: "tr" },
    { id: "USD_CN", name: "حوالات الصين", regex: "(?:USD_CN|usd_cn|(?:دولار\\s*(?:حوال[اة]|حوالات)?\\s*(?:الصين|صينية|صين)|حوال[اة]\\s*(?:الصين|صينية|صين)|حوالات\\s*(?:الصين|صينية|صين)))(?![^\\d\\n]*?(?:يوان|ذهب|فضة))[^0-9\\n]{0,35}(\\d{1,2}(?:[\\.,]\\d{1,4})?)(?:\\s+(?:بيع|شراء)?[^0-9\\n]{0,15}(\\d{1,2}(?:[\\.,]\\d{1,4})?))?", min: 5.0, max: 25.0, isInverse: false, flag: "cn" },
    { id: "CNY", name: "يوان صيني", regex: "(?:CNY|cny|يوان\\s*صيني|اليوان\\s*الصيني|(?<!\\S)يوان(?![^\\d\\n]*?(?:حوال[اة]|دولار))|🇨🇳(?![^\\d\\n]*?(?:حوال[اة]|دولار)))[^0-9\\n]{0,35}(\\d{1,2}(?:[\\.,]\\d{1,4})?)(?:\\s+(?:بيع|شراء)?[^0-9\\n]{0,15}(\\d{1,2}(?:[\\.,]\\d{1,4})?))?", min: 0.5, max: 5.0, isInverse: false, flag: "cn" },
    { id: "GOLD_EXT_18", name: "ذهب خارجي 18", regex: "(?:ذهب\\s*خارجي\\s*18|خارجي\\s*18|عيار\\s*18\\s*خارجي|18\\s*خارجي)[^\\d\\n]{0,30}(\\d{1,5}(?:[\\.,]\\d+)?)(?:[^\\d\\n]{1,15}(\\d{1,5}(?:[\\.,]\\d+)?))?", min: 1, max: 10000, isInverse: false, flag: "gold" },
    { id: "GOLD_EXT_21", name: "ذهب خارجي 21", regex: "(?:ذهب\\s*خارجي\\s*21|خارجي\\s*21|عيار\\s*21\\s*خارجي|21\\s*خارجي)[^\\d\\n]{0,30}(\\d{1,5}(?:[\\.,]\\d+)?)(?:[^\\d\\n]{1,15}(\\d{1,5}(?:[\\.,]\\d+)?))?", min: 1, max: 10000, isInverse: false, flag: "gold" },
    { id: "GOLD_SCRAP_18", name: "ذهب كسر 18", regex: "(?:ذهب\\s*كسر\\s*18|كسر\\s*18|عيار\\s*18\\s*كسر|18\\s*كسر|كسر\\s*الذهب\\s*عيار\\s*18|كسر\\s*ذهب\\s*عيار\\s*18)[^\\d\\n]{0,30}(\\d{1,5}(?:[\\.,]\\d+)?)(?:[^\\d\\n]{1,15}(\\d{1,5}(?:[\\.,]\\d+)?))?", min: 1, max: 10000, isInverse: false, flag: "gold" },
    { id: "GOLD_SCRAP_21", name: "ذهب كسر 21", regex: "(?:ذهب\\s*كسر\\s*21|كسر\\s*21|عيار\\s*21\\s*كسر|21\\s*كسر|كسر\\s*الذهب\\s*عيار\\s*21|كسر\\s*ذهب\\s*عيار\\s*21)[^\\d\\n]{0,30}(\\d{1,5}(?:[\\.,]\\d+)?)(?:[^\\d\\n]{1,15}(\\d{1,5}(?:[\\.,]\\d+)?))?", min: 1, max: 10000, isInverse: false, flag: "gold" },
    { id: "GOLD_CAST_18", name: "ذهب مسبوك 18", regex: "(?:ذهب\\s*مسبوك\\s*18|مسبوك\\s*18|عيار\\s*18\\s*مسبوك|18\\s*مسبوك)[^\\d\\n]{0,30}(\\d{1,5}(?:[\\.,]\\d+)?)(?:[^\\d\\n]{1,15}(\\d{1,5}(?:[\\.,]\\d+)?))?", min: 1, max: 10000, isInverse: false, flag: "gold" },
    { id: "GOLD_CAST_24", name: "ذهب مسبوك 24", regex: "(?:ذهب\\s*مسبوك\\s*24|مسبوك\\s*24|عيار\\s*24\\s*مسبوك|24\\s*مسبوك)[^\\d\\n]{0,30}(\\d{1,5}(?:[\\.,]\\d+)?)(?:[^\\d\\n]{1,15}(\\d{1,5}(?:[\\.,]\\d+)?))?", min: 1, max: 10000, isInverse: false, flag: "gold" },
    { id: "GOLD_LIRA_8G", name: "ليرة ذهب 8 جرام", regex: "(?:ليرة\\s*(?:ذهب\\s*)?8(?:\\s*جرام|ج)?|ليرة\\s*8(?:\\s*جرام|ج)?)[^\\d\\n]{0,30}(\\d{1,5}(?:[\\.,]\\d+)?)(?:[^\\d\\n]{1,15}(\\d{1,5}(?:[\\.,]\\d+)?))?", min: 1, max: 30000, isInverse: false, flag: "gold" },
    { id: "GOLD_LIRA_14G", name: "ليرة ذهب 14 جرام", regex: "(?:ليرة\\s*(?:ذهب\\s*)?14(?:\\s*جرام|ج)?|ليرة\\s*14(?:\\s*جرام|ج)?)[^\\d\\n]{0,30}(\\d{1,5}(?:[\\.,]\\d+)?)(?:[^\\d\\n]{1,15}(\\d{1,5}(?:[\\.,]\\d+)?))?", min: 1, max: 40000, isInverse: false, flag: "gold" },
    { id: "GOLD_MUJARA_14G", name: "مجارة ذهب 14", regex: "(?:مجارة\\s*(?:ذهب\\s*)?14(?:\\s*جرام|ج)?|مجارة\\s*14(?:\\s*جرام|ج)?)[^\\d\\n]{0,30}(\\d{1,5}(?:[\\.,]\\d+)?)(?:[^\\d\\n]{1,15}(\\d{1,5}(?:[\\.,]\\d+)?))?", min: 1, max: 40000, isInverse: false, flag: "gold" },
    { id: "SILVER_CAST_1000", name: "مسبوك فضة", regex: "(?:مسبوك\\s*فضة(?:\\s*عيار\\s*1000|\\s*1000)?|فضة\\s*مسبوك)[^\\d\\n]{0,30}(\\d{1,5}(?:[\\.,]\\d+)?)(?:[^\\d\\n]{1,15}(\\d{1,5}(?:[\\.,]\\d+)?))?", min: 1, max: 1000, isInverse: false, flag: "silver" }
  ]
};

export function updateAppConfig(newConfig: Partial<AppConfig>) {
  const preservedTelegram = appConfig.telegramSessionString;
  const preservedTelegramApiId = appConfig.telegramApiId;
  const preservedTelegramApiHash = appConfig.telegramApiHash;
  const preservedTelegramBotToken = appConfig.telegramBotToken;
  const preservedFbToken = appConfig.facebookAccessToken;
  const preservedWhatsappAuth = appConfig.whatsappAuth;

  for (const key of Object.keys(appConfig)) {
    delete (appConfig as any)[key];
  }
  Object.assign(appConfig, newConfig);

  // Preserve critical authentication credentials
  if (!appConfig.telegramSessionString && preservedTelegram) appConfig.telegramSessionString = preservedTelegram;
  if (!appConfig.telegramApiId && preservedTelegramApiId) appConfig.telegramApiId = preservedTelegramApiId;
  if (!appConfig.telegramApiHash && preservedTelegramApiHash) appConfig.telegramApiHash = preservedTelegramApiHash;
  if (!appConfig.telegramBotToken && preservedTelegramBotToken) appConfig.telegramBotToken = preservedTelegramBotToken;
  if (!appConfig.facebookAccessToken && preservedFbToken) appConfig.facebookAccessToken = preservedFbToken;
  if (!appConfig.whatsappAuth && preservedWhatsappAuth) appConfig.whatsappAuth = preservedWhatsappAuth;

  // Sync to process.env if not set by environment
  if (appConfig.telegramSessionString && !process.env.TELEGRAM_SESSION) {
    process.env.TELEGRAM_SESSION = appConfig.telegramSessionString;
  }
  if (appConfig.telegramApiId && !process.env.TELEGRAM_API_ID) {
    process.env.TELEGRAM_API_ID = String(appConfig.telegramApiId);
  }
  if (appConfig.telegramApiHash && !process.env.TELEGRAM_API_HASH) {
    process.env.TELEGRAM_API_HASH = appConfig.telegramApiHash;
  }
  if (appConfig.telegramBotToken && !process.env.TELEGRAM_BOT_TOKEN) {
    process.env.TELEGRAM_BOT_TOKEN = appConfig.telegramBotToken;
  }
}

export let telegramManager: TelegramManager | null = null;

export function setTelegramManager(manager: TelegramManager | null) {
  telegramManager = manager;
}

export function applyLoadedConfig(loadedConfig: AppConfig, source: string) {
  const existingIds = new Set<string>();
  const mergedTerms = loadedConfig.terms.map(dbTerm => {
    existingIds.add(dbTerm.id);
    const defaultTerm = appConfig.terms.find(t => t.id === dbTerm.id);
    const isMetal = (defaultTerm && (defaultTerm.flag === "gold" || defaultTerm.flag === "silver")) ||
      dbTerm.id.startsWith("GOLD_") || dbTerm.id.startsWith("SILVER_");
    const isOutdatedOrNarrow = !dbTerm.regex || isMetal || 
      ["USD", "EUR", "GBP", "USD_CHECKS", "USD_JBANK", "USD_BCD", "USD_NCB", "USD_AB", "USD_WB", "TRY", "USD_TR", "USD_AE", "AED", "USD_CN", "CNY", "SAR", "JOD", "BHD", "KWD", "QAR"].includes(dbTerm.id) ||
      (dbTerm.id === "TND" && (dbTerm.max > 3.8 || dbTerm.min < 2.5)) ||
      (dbTerm.id === "EGP" && (dbTerm.max > 0.28 || dbTerm.min < 0.13));

    return {
      id: dbTerm.id,
      name: (isMetal && defaultTerm) ? defaultTerm.name : (dbTerm.name || defaultTerm?.name || dbTerm.id),
      regex: (isOutdatedOrNarrow && defaultTerm?.regex) ? defaultTerm.regex : (dbTerm.regex || defaultTerm?.regex || ""),
      min: (isOutdatedOrNarrow && defaultTerm) ? defaultTerm.min : ((typeof dbTerm.min === 'number' && !isNaN(dbTerm.min) && (!defaultTerm || dbTerm.min <= defaultTerm.min)) ? dbTerm.min : (defaultTerm?.min ?? 0)),
      max: (isOutdatedOrNarrow && defaultTerm) ? defaultTerm.max : ((typeof dbTerm.max === 'number' && !isNaN(dbTerm.max) && (!defaultTerm || dbTerm.max >= defaultTerm.max)) ? dbTerm.max : (defaultTerm?.max ?? 10000)),
      isInverse: typeof dbTerm.isInverse === 'boolean' ? dbTerm.isInverse : (defaultTerm?.isInverse ?? false),
      flag: (dbTerm.flag && dbTerm.flag !== "undefined" && dbTerm.flag !== "null") ? dbTerm.flag : (defaultTerm?.flag || "ly")
    };
  });

  for (const defaultTerm of appConfig.terms) {
    if (!existingIds.has(defaultTerm.id)) {
      mergedTerms.push(defaultTerm);
      console.log(`[Migration] Added new missing currency term: ${defaultTerm.id}`);
    }
  }
  // Filter out any obsolete gold/silver categories and ensure OFFICIAL_USD is permanently removed
  loadedConfig.terms = mergedTerms.filter(t => t.id !== "GOLD" && t.id !== "GOLD_CAST_21" && t.id !== "SILVER_SCRAP" && t.id !== "OFFICIAL_USD");

  if (!Array.isArray(loadedConfig.channels) || loadedConfig.channels.length === 0) {
    loadedConfig.channels = ["dollarr_ly", "musheermarket", "lydollar", "suqalmushir"];
  }

  if (loadedConfig.enableHttpScraper === undefined) {
    loadedConfig.enableHttpScraper = true;
  }
  if (loadedConfig.enableUserTracking === undefined) {
    loadedConfig.enableUserTracking = true;
  }
  if (!loadedConfig.telegramTemplateStyle) {
    loadedConfig.telegramTemplateStyle = "classic";
  }
  if (loadedConfig.minBroadcastIntervalMinutes === undefined || isNaN(loadedConfig.minBroadcastIntervalMinutes)) {
    loadedConfig.minBroadcastIntervalMinutes = 20;
  }
  if (loadedConfig.minPriceChangeThreshold === undefined || isNaN(loadedConfig.minPriceChangeThreshold)) {
    loadedConfig.minPriceChangeThreshold = 0.015;
  }
  if (loadedConfig.aggregationWindowSeconds === undefined || isNaN(loadedConfig.aggregationWindowSeconds)) {
    loadedConfig.aggregationWindowSeconds = 45;
  }
  if (loadedConfig.smartConsolidatedPost === undefined) {
    loadedConfig.smartConsolidatedPost = true;
  }
  if (loadedConfig.hourlyPostLimit === undefined || isNaN(loadedConfig.hourlyPostLimit)) {
    loadedConfig.hourlyPostLimit = 4;
  }
  if (!loadedConfig.apiConfig) {
    loadedConfig.apiConfig = {
      enabled: true,
      rateLimitWindowMs: 60000,
      rateLimitMaxRequests: 20,
      banDurationMinutes: 5,
    };
  }

  updateAppConfig(loadedConfig);
  console.log(`[Config] Config loaded & applied successfully from ${source}`);
}

export function syncTermsToDatabase(terms: AppConfig['terms']) {
  try {
    const cleanTerms = terms.filter(t => t && t.id !== 'OFFICIAL_USD');
    try {
      db.prepare("DELETE FROM currency_terms WHERE id = 'OFFICIAL_USD'").run();
    } catch (e) {}

    const stmt = db.prepare(`
      INSERT INTO currency_terms (id, name, regex, min, max, is_inverse, flag, is_active, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        regex = excluded.regex,
        min = excluded.min,
        max = excluded.max,
        is_inverse = excluded.is_inverse,
        flag = excluded.flag,
        is_active = excluded.is_active,
        updated_at = CURRENT_TIMESTAMP
    `);
    const tx = db.transaction((items: AppConfig['terms']) => {
      for (const t of items) {
        if (t.id === 'OFFICIAL_USD') continue;
        stmt.run(t.id, t.name, t.regex, t.min, t.max, t.isInverse ? 1 : 0, t.flag || 'ly');
      }
    });
    tx(cleanTerms);
  } catch (err) {
    console.error("[Storage] Failed to sync terms to SQLite currency_terms table:", err);
  }
}

export function loadConfigFromStorage() {
  try {
    try {
      db.prepare("DELETE FROM currency_terms WHERE id = 'OFFICIAL_USD'").run();
    } catch (e) {}

    const stored = db.prepare('SELECT value FROM server_config WHERE key = ?').get('app_config') as any;
    if (stored && stored.value) {
      const parsedConfig = JSON.parse(stored.value) as AppConfig;
      if (parsedConfig && Array.isArray(parsedConfig.terms) && Array.isArray(parsedConfig.channels)) {
        parsedConfig.terms = parsedConfig.terms.filter(t => t && t.id !== 'OFFICIAL_USD');
        applyLoadedConfig(parsedConfig, "SQLite");
      }
    }

    // Check if currency_terms table has records and seed or load
    const countRow = db.prepare('SELECT count(*) as count FROM currency_terms').get() as any;
    if (!countRow || countRow.count === 0) {
      syncTermsToDatabase(appConfig.terms);
    } else {
      const rows = db.prepare('SELECT * FROM currency_terms WHERE is_active = 1').all() as any[];
      if (rows && rows.length > 0) {
        for (const row of rows) {
          if (row.id === 'OFFICIAL_USD') continue;
          const idx = appConfig.terms.findIndex(t => t.id === row.id);
          const termItem = {
            id: row.id,
            name: row.name,
            regex: row.regex,
            min: Number(row.min),
            max: Number(row.max),
            isInverse: Boolean(row.is_inverse),
            flag: row.flag || 'ly'
          };
          if (idx >= 0) {
            appConfig.terms[idx] = termItem;
          } else {
            appConfig.terms.push(termItem);
          }
        }
      }
    }
    appConfig.terms = appConfig.terms.filter(t => t && t.id !== 'OFFICIAL_USD');
    syncTermsToDatabase(appConfig.terms);
  } catch (e) {
    console.error("[Storage] Failed to read config from SQLite:", e);
  }
}

export async function loadConfigFromSupabase() {
  loadConfigFromStorage();

  if (!supabase || !supabaseKey || supabaseKey.includes('dummy')) return;
  try {
    const { data, error } = await supabase
      .from('app_config')
      .select('config')
      .eq('id', 1)
      .single();
      
    if (error) {
      if (error.code === 'PGRST116') {
        await supabase.from('app_config').insert([{ id: 1, config: appConfig }]);
      } else if (!error.message.includes('relation "app_config" does not exist')) {
        console.error("Error loading config from Supabase:", error);
      }
    } else if (data && data.config) {
      applyLoadedConfig(data.config as AppConfig, "Supabase");

      // Auto-unpack WhatsApp credentials from Supabase cloud into local directory
      if (data.config.whatsappAuth && Object.keys(data.config.whatsappAuth).length > 0) {
        try {
          const authDir = path.resolve(process.cwd(), 'whatsapp_auth');
          if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });
          for (const [filename, content] of Object.entries(data.config.whatsappAuth)) {
            if (typeof content === 'string') {
              fs.writeFileSync(path.join(authDir, filename), content, 'utf8');
            }
          }
          console.log(`[Config] Restored ${Object.keys(data.config.whatsappAuth).length} WhatsApp session files from Supabase app_config!`);
        } catch (waErr) {
          console.error("[Config] Error unpacking WhatsApp auth from Supabase:", waErr);
        }
      }
      
      try {
        db.prepare(`
          INSERT INTO server_config (key, value) VALUES ('app_config', ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `).run(JSON.stringify(appConfig));
      } catch (e) {
        console.error("[Storage] Failed to sync Supabase config to SQLite:", e);
      }
    }

    // أولاً: محاولة تحميل من app_config (المصدر الرئيسي الذي يكتب فيه Web Server)
    if (supabase) {
      try {
        const { data: appConfigData } = await supabase
          .from('app_config')
          .select('config')
          .eq('id', 1)
          .single();

        if (appConfigData?.config?.terms && Array.isArray(appConfigData.config.terms)
            && appConfigData.config.terms.length > 0) {
          console.log(`[Config] تحميل ${appConfigData.config.terms.length} term من app_config (Web Server)`);

          // دمج مع القيم الافتراضية للحفاظ على أي terms جديدة
          const mergedTerms = appConfig.terms.map(defaultTerm => {
            const dbTerm = appConfigData.config.terms.find((t: any) => t.id === defaultTerm.id);
            return dbTerm ? { ...defaultTerm, ...dbTerm } : defaultTerm;
          });

          appConfig.terms = mergedTerms;

          // تحديث channels وإعدادات النشر أيضاً
          if (Array.isArray(appConfigData.config.channels)) {
            appConfig.channels = appConfigData.config.channels;
          }
          if (appConfigData.config.telegramAutoPost !== undefined) {
            appConfig.telegramAutoPost = appConfigData.config.telegramAutoPost;
          }
          if (appConfigData.config.facebookAutoPost !== undefined) {
            appConfig.facebookAutoPost = appConfigData.config.facebookAutoPost;
          }

          console.log('[Config] ✅ تم تحميل الإعدادات من app_config بنجاح');
          return; // ← نجح التحميل، لا حاجة للجداول الأخرى
        }
      } catch (appConfigErr) {
        console.warn('[Config] تعذّر التحميل من app_config، سيتم المحاولة من currency_terms:', appConfigErr);
      }
    }

    // Try loading directly from currency_terms table in Supabase if exists
    try {
      try {
        await supabase.from('currency_terms').delete().eq('id', 'OFFICIAL_USD');
      } catch (e) {}

      const { data: dbTerms } = await supabase.from('currency_terms').select('*');
      if (dbTerms && Array.isArray(dbTerms) && dbTerms.length > 0) {
        console.log(`[Config] Syncing ${dbTerms.length} currency terms from Supabase currency_terms table...`);
        for (const row of dbTerms) {
          if (row.id === 'OFFICIAL_USD') continue;
          const idx = appConfig.terms.findIndex(t => t.id === row.id);
          const termObj = {
            id: row.id,
            name: row.name,
            regex: row.regex,
            min: Number(row.min),
            max: Number(row.max),
            isInverse: Boolean(row.is_inverse || row.isInverse),
            flag: row.flag || 'ly'
          };
          if (idx >= 0) {
            appConfig.terms[idx] = termObj;
          } else {
            appConfig.terms.push(termObj);
          }
        }
        appConfig.terms = appConfig.terms.filter(t => t && t.id !== 'OFFICIAL_USD');
        syncTermsToDatabase(appConfig.terms);
      }
    } catch (termsErr) {
      // Supabase currency_terms table might not exist yet
    }
  } catch (err) {
    console.error("Failed to load/repair config from Supabase", err);
  }
}

// Call loadConfigFromStorage immediately so config and credentials are ready on startup
loadConfigFromStorage();

export async function saveConfigToSupabase(newConfig: AppConfig) {
  try {
    db.prepare(`
      INSERT INTO server_config (key, value) VALUES ('app_config', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(JSON.stringify(newConfig));
    syncTermsToDatabase(newConfig.terms);
  } catch (e) {
    console.error("[Storage] Failed to save config to SQLite:", e);
  }

  if (!supabase || !supabaseKey || supabaseKey.includes('dummy')) return true;
  try {
    const { error } = await supabase
      .from('app_config')
      .upsert({ id: 1, config: newConfig });
      
    if (error) {
      console.error("Error saving config to Supabase:", error);
    }

    // Also upsert into currency_terms table in Supabase if it exists
    try {
      await supabase.from('currency_terms').upsert(
        newConfig.terms.map(t => ({
          id: t.id,
          name: t.name,
          regex: t.regex,
          min: t.min,
          max: t.max,
          is_inverse: t.isInverse ? 1 : 0,
          flag: t.flag
        }))
      );
    } catch (e) {
      // Ignored if table schema is slightly different or table does not exist
    }

    return !error;
  } catch (err) {
    console.error("Failed to save config to Supabase", err);
    return false;
  }
}
