import express from "express";
import { rates } from "../state";
import { appConfig } from "../config";
import { serverStartTime, getAppBuildSignature } from "../utils/version";
import { getOrInitTelegramManager } from "../services/social.service";
import { activeClient } from "../../telegramClient";

const router = express.Router();

router.get("/version", (req: express.Request, res: express.Response) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  const buildSignature = getAppBuildSignature();

  res.json({
    version: buildSignature,
    serverTime: Date.now(),
    startTime: serverStartTime.getTime()
  });
});

router.get(["/ping"], (req: express.Request, res: express.Response) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.status(200).json({
    status: "pong",
    alive: true,
    uptime: Math.round((Date.now() - serverStartTime.getTime()) / 1000),
    timestamp: new Date().toISOString()
  });
});

router.get("/health", async (req: express.Request, res: express.Response) => {
  res.json({
    status: "online",
    role: "worker_server",
    uptime: Math.round((new Date().getTime() - serverStartTime.getTime()) / 1000),
    telegram: activeClient?.connected || false,
    timestamp: new Date().toISOString()
  });
});

router.get("/status", (req: express.Request, res: express.Response) => {
  res.json({
    status: "online",
    role: "worker_server",
    uptime: Math.round((Date.now() - serverStartTime.getTime()) / 1000),
    telegramConnected: !!(activeClient && activeClient.connected),
    timestamp: new Date().toISOString(),
    lastUpdated: rates?.lastUpdated || new Date().toISOString()
  });
});

router.get("/telegram/status", (req: express.Request, res: express.Response) => {
  const tgMgr = getOrInitTelegramManager();
  const isConnected = !!(activeClient && activeClient.connected);
  const hasBotToken = !!((tgMgr && tgMgr.botToken) || appConfig.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN);
  res.json({
    isConnected: isConnected || hasBotToken,
    isAuthRevoked: tgMgr ? tgMgr.isAuthRevoked : false,
    lastError: tgMgr ? tgMgr.lastError : "",
    hasBotToken,
    lastFetchTime: tgMgr ? tgMgr.lastFetchTime : 0
  });
});

export default router;
