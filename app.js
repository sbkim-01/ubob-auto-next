'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const APP_DIR = __dirname;
const CONFIG_PATH = path.join(APP_DIR, 'config.json');
const STATE_PATH = path.join(APP_DIR, 'state.json');
const PROFILE_DIR = path.join(APP_DIR, 'chrome-profile');
const LOG_DIR = path.join(APP_DIR, 'logs');

const DEFAULT_CONFIG = {
  startUrl: 'https://catholic-edu.ubob.com/',
  allowedHost: 'catholic-edu.ubob.com',
  scanIntervalMs: 700,
  clickDelayMs: 350,
  clickCooldownMs: 3000,
};

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

const config = { ...DEFAULT_CONFIG, ...readJson(CONFIG_PATH, {}) };
let state = {
  lastSeriesUrl: null,
  clickCount: 0,
  lastClickAt: null,
  ...readJson(STATE_PATH, {}),
};

fs.mkdirSync(LOG_DIR, { recursive: true });
fs.mkdirSync(PROFILE_DIR, { recursive: true });

function pad(n) {
  return String(n).padStart(2, '0');
}

function localDateStamp(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function localTimeStamp(date = new Date()) {
  return `${localDateStamp(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function log(message) {
  const line = `[${localTimeStamp()}] ${message}`;
  console.log(line);
  try {
    fs.appendFileSync(path.join(LOG_DIR, `${localDateStamp()}.log`), `${line}\r\n`, 'utf8');
  } catch (_) {
    // Logging must never stop the automation.
  }
}

function saveState() {
  try {
    const tmp = `${STATE_PATH}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tmp, STATE_PATH);
  } catch (err) {
    log(`상태 저장 실패: ${err.message}`);
  }
}

function isAllowedUrl(rawUrl) {
  try {
    return new URL(rawUrl).hostname === config.allowedHost;
  } catch (_) {
    return false;
  }
}

function isSeriesUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    return u.hostname === config.allowedHost && /^\/Series\/SeriesDetail\//i.test(u.pathname);
  } catch (_) {
    return false;
  }
}

function rememberSeriesUrl(rawUrl) {
  if (!isSeriesUrl(rawUrl)) return;
  if (state.lastSeriesUrl === rawUrl) return;
  state.lastSeriesUrl = rawUrl;
  saveState();
  log(`학습 페이지 기억: ${rawUrl}`);
}

function findChromeExecutable() {
  const candidates = [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  throw new Error('Google Chrome을 찾을 수 없습니다. Chrome이 설치되어 있는지 확인해 주세요.');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function candidateMatchesPopup(button) {
  try {
    if (!(await button.isVisible())) return false;

    const buttonText = ((await button.textContent()) || '').replace(/\s+/g, ' ').trim();
    if (buttonText !== '확인') return false;

    return await button.evaluate((el) => {
      const normalize = (text) => (text || '').replace(/\s+/g, ' ').trim();
      let current = el;

      for (let depth = 0; depth < 18 && current; depth += 1) {
        const text = normalize(current.innerText || current.textContent || '');
        const matched =
          text.includes('콘텐츠 학습') &&
          text.includes('콘텐츠 학습이 완료되었습니다.') &&
          text.includes('다음 콘텐츠 학습을 진행하시겠습니까?');

        if (matched) return true;
        current = current.parentElement;
      }

      return false;
    });
  } catch (_) {
    return false;
  }
}

let lastClickEpoch = 0;
let scanRunning = false;

async function scanFrame(frame, pageUrl) {
  let count = 0;
  try {
    count = await frame.locator('button.btn.close-btn-active').count();
  } catch (_) {
    return false;
  }

  // The popup should only contain a handful of matching elements.
  // Limiting the loop prevents pathological pages from causing heavy scans.
  count = Math.min(count, 20);

  for (let i = 0; i < count; i += 1) {
    const button = frame.locator('button.btn.close-btn-active').nth(i);
    if (!(await candidateMatchesPopup(button))) continue;

    const now = Date.now();
    if (now - lastClickEpoch < Math.max(500, Number(config.clickCooldownMs) || 3000)) {
      return true;
    }

    lastClickEpoch = now;
    const delayMs = Math.max(0, Number(config.clickDelayMs) || 0);
    if (delayMs) await sleep(delayMs);

    // Re-check immediately before the click in case the DOM changed during the delay.
    if (!(await candidateMatchesPopup(button))) return true;

    try {
      await button.click({ timeout: 3000 });
      state.clickCount = Number(state.clickCount || 0) + 1;
      state.lastClickAt = new Date().toISOString();
      saveState();
      log(`콘텐츠 완료 팝업 확인 자동 클릭 (누적 ${state.clickCount}회) | ${pageUrl}`);
      return true;
    } catch (err) {
      log(`확인 버튼 클릭 실패: ${err.message}`);
      return true;
    }
  }

  return false;
}

async function scanContext(context) {
  if (scanRunning) return;
  scanRunning = true;

  try {
    const pages = context.pages();

    for (const page of pages) {
      if (page.isClosed()) continue;
      const pageUrl = page.url();

      if (isSeriesUrl(pageUrl)) rememberSeriesUrl(pageUrl);
      if (!isAllowedUrl(pageUrl)) continue;

      for (const frame of page.frames()) {
        const handled = await scanFrame(frame, pageUrl);
        if (handled) return;
      }
    }
  } finally {
    scanRunning = false;
  }
}

function attachPage(page) {
  page.on('framenavigated', frame => {
    if (frame === page.mainFrame()) {
      const url = frame.url();
      if (isSeriesUrl(url)) rememberSeriesUrl(url);
    }
  });

  page.on('crash', () => log('Chrome 페이지가 비정상 종료되었습니다.'));
}

async function main() {
  const chromePath = findChromeExecutable();
  log('uBobs Auto Next 시작');
  log(`Chrome: ${chromePath}`);
  log(`전용 로그인 프로필: ${PROFILE_DIR}`);
  log(`기존 자동 클릭 누적: ${Number(state.clickCount || 0)}회`);

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    executablePath: chromePath,
    headless: false,
    viewport: null,
    args: ['--start-maximized'],
  });

  for (const page of context.pages()) attachPage(page);
  context.on('page', page => attachPage(page));

  const pages = context.pages();
  const page = pages[0] || await context.newPage();

  const targetUrl = isSeriesUrl(state.lastSeriesUrl)
    ? state.lastSeriesUrl
    : (isAllowedUrl(config.startUrl) ? config.startUrl : `https://${config.allowedHost}/`);

  if (!isAllowedUrl(page.url()) || page.url() === 'about:blank') {
    try {
      log(`페이지 열기: ${targetUrl}`);
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    } catch (err) {
      log(`초기 페이지 열기 실패: ${err.message}`);
      log('Chrome 창에서 직접 사이트로 이동해도 자동 감시는 계속됩니다.');
    }
  }

  log('자동 감시 시작');
  log('대상: "콘텐츠 학습이 완료되었습니다." 팝업의 "확인" 버튼만 클릭합니다.');
  log('첫 실행에서 로그인이 필요하면 열린 Chrome 창에서 1회 로그인해 주세요. 이후 로그인 상태는 이 폴더의 전용 프로필에 유지됩니다.');

  const intervalMs = Math.max(250, Number(config.scanIntervalMs) || 700);
  const timer = setInterval(async () => {
    try {
      if (context.pages().length === 0) {
        clearInterval(timer);
        await context.close().catch(() => {});
        return;
      }
      await scanContext(context);
    } catch (err) {
      log(`감시 중 오류: ${err.message}`);
    }
  }, intervalMs);

  await scanContext(context);

  await new Promise(resolve => context.once('close', resolve));
  clearInterval(timer);
  log('Chrome 종료 - 자동화 종료');
}

main().catch(err => {
  log(`치명적 오류: ${err.stack || err.message}`);
  process.exitCode = 1;
});
