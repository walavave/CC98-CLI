import { createCipheriv } from "node:crypto";

const WEBVPN_BASE = "https://webvpn.zju.edu.cn";
const MIRROR_URL = "https://mirrors.zju.edu.cn/api/is_campus_network";
const URL_KEY = "wrdvpnisthebest!";
const PWD_KEY = "wrdvpnisawesome!";

export interface WebVpnLoginResult {
  success: boolean;
  message?: string;
  needCaptcha?: boolean;
  needConfirm?: boolean;
  captchaId?: string;
}

export interface WebVpnStatus {
  enabled: boolean;
  loggedIn: boolean;
  inCampusNetwork?: boolean;
}

export class WebVpnService {
  private cookies: Map<string, string> = new Map();
  private loggedIn = false;
  private webVpnEnabled = false;

  constructor(cookies?: Record<string, string>) {
    if (cookies) {
      this.loadCookies(cookies);
    }
  }

  get isLoggedIn(): boolean {
    return this.loggedIn;
  }

  get isEnabled(): boolean {
    return this.webVpnEnabled;
  }

  set enabled(value: boolean) {
    this.webVpnEnabled = value;
  }

  loadCookies(cookies: Record<string, string>): void {
    this.cookies.clear();
    for (const [name, value] of Object.entries(cookies)) {
      if (name && value) {
        this.cookies.set(name, value);
      }
    }
    this.loggedIn = this.cookies.size > 0;
  }

  getCookies(): Record<string, string> {
    return Object.fromEntries(this.cookies.entries());
  }

  async checkNetwork(): Promise<boolean> {
    try {
      const response = await fetch(MIRROR_URL, {
        headers: {
          "User-Agent": this.userAgent
        }
      });
      const text = await response.text();
      return text === "1" || text === "2";
    } catch {
      return false;
    }
  }

  async login(username: string, password: string): Promise<WebVpnLoginResult> {
    try {
      const loginPage = await this.get(`${WEBVPN_BASE}/login`);
      const html = await loginPage.text();
      const { csrf, captchaId } = this.parseLoginPage(html);

      if (!csrf) {
        return { success: false, message: "获取 CSRF token 失败" };
      }

      const encryptedPassword = this.buildPassword(PWD_KEY, password);
      const formData = new URLSearchParams({
        _csrf: csrf,
        auth_type: "local",
        sms_code: "",
        captcha: "",
        needCaptcha: "false",
        captcha_id: captchaId || "",
        username,
        password: encryptedPassword
      });

      const loginResponse = await this.post(`${WEBVPN_BASE}/do-login`, formData.toString(), {
        "Content-Type": "application/x-www-form-urlencoded"
      });
      const result = await loginResponse.json() as Record<string, unknown>;

      if (result.success) {
        this.loggedIn = true;
        return { success: true };
      }

      if (result.error === "NEED_CONFIRM") {
        return { success: false, needConfirm: true, message: "需要确认登录" };
      }

      if (result.error === "CAPTCHA_FAILED") {
        return {
          success: false,
          needCaptcha: true,
          captchaId: String(result.description || ""),
          message: "需要验证码"
        };
      }

      return { success: false, message: String(result.message || result.error || "登录失败") };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : "登录出错" };
    }
  }

  async confirmLogin(): Promise<WebVpnLoginResult> {
    try {
      const response = await this.post(`${WEBVPN_BASE}/do-confirm-login`, "");
      const result = await response.json() as Record<string, unknown>;

      if (result.success) {
        this.loggedIn = true;
        return { success: true };
      }

      return { success: false, message: String(result.error || "确认失败") };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : "确认出错" };
    }
  }

  async logout(): Promise<void> {
    try {
      await this.get(`${WEBVPN_BASE}/logout`);
      this.loggedIn = false;
      this.cookies.clear();
    } catch {
      // Ignore logout failures.
    }
  }

  convertUrl(url: string): string {
    const uri = new URL(url);
    if (uri.origin === WEBVPN_BASE) {
      return url;
    }

    const scheme = uri.protocol.slice(0, -1);
    const host = uri.hostname;
    const port = uri.port ? parseInt(uri.port, 10) : 0;
    const isSpecialPort = port > 0 &&
      !(scheme === "http" && port === 80) &&
      !(scheme === "https" && port === 443);
    const property = isSpecialPort ? `${scheme}-${port}` : scheme;
    const encryptedHost = this.buildPassword(URL_KEY, host);
    const path = [property, encryptedHost].map((segment) => encodeURIComponent(segment)).join("/");

    return `${WEBVPN_BASE}/${path}${uri.pathname}${uri.search}`;
  }

  async fetch(url: string, options: RequestInit = {}): Promise<Response> {
    return this.fetchWithRedirects(url, options, 0);
  }

  getStatus(): WebVpnStatus {
    return {
      enabled: this.enabled,
      loggedIn: this.loggedIn
    };
  }

  private async fetchWithRedirects(url: string, options: RequestInit, redirectCount: number): Promise<Response> {
    if (redirectCount > 10) {
      throw new Error("too many WebVPN redirects");
    }

    const targetUrl = this.webVpnEnabled ? this.convertUrl(url) : url;
    const headers = new Headers(this.getHeaders());
    for (const [name, value] of new Headers(options.headers).entries()) {
      headers.set(name, value);
    }

    const response = await fetch(targetUrl, {
      ...options,
      headers,
      redirect: "manual"
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (location) {
        this.updateCookies(response);
        const nextUrl = new URL(location, response.url || targetUrl).toString();
        // 仅当非登录页请求被重定向到登录页时，才判定会话过期；
        // 主动请求 /login（如 vpn login 获取 CSRF）不算。
        if (!isLoginPageUrl(url) && isLoginPageUrl(nextUrl)) {
          throw new Error("WebVPN 会话已过期，请运行 \"cc98 vpn login\" 重新登录");
        }
        return this.fetchWithRedirects(nextUrl, redirectOptions(options, response.status), redirectCount + 1);
      }
    }

    this.updateCookies(response);
    if (!isLoginPageUrl(url) && isLoginPageUrl(response.url || targetUrl) && isHtmlResponse(response)) {
      throw new Error("WebVPN 会话已过期，请运行 \"cc98 vpn login\" 重新登录");
    }
    return response;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "User-Agent": this.userAgent,
      Referer: WEBVPN_BASE
    };

    if (this.cookies.size > 0) {
      headers.Cookie = Array.from(this.cookies.entries())
        .map(([key, value]) => `${key}=${value}`)
        .join("; ");
    }

    return headers;
  }

  private updateCookies(response: Response): void {
    const headers = response.headers as Headers & { getSetCookie?: () => string[] };
    const setCookies = headers.getSetCookie?.() || splitSetCookieHeader(headers.get("set-cookie"));
    for (const cookie of setCookies) {
      const [nameValue] = cookie.split(";");
      if (!nameValue) {
        continue;
      }
      const separator = nameValue.indexOf("=");
      if (separator < 1) {
        continue;
      }
      const name = nameValue.slice(0, separator).trim();
      const value = nameValue.slice(separator + 1).trim();
      if (name && value) {
        this.cookies.set(name, value);
      }
    }
  }

  private get userAgent(): string {
    return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
  }

  private get(url: string): Promise<Response> {
    return this.fetch(url, { method: "GET" });
  }

  private post(url: string, body: string, headers?: Record<string, string>): Promise<Response> {
    return this.fetch(url, {
      method: "POST",
      body,
      headers: headers || {}
    });
  }

  private parseLoginPage(html: string): { csrf: string; captchaId: string } {
    const csrfMatch = html.match(/name="_csrf"[^>]*value="([^"]+)"/);
    const captchaMatch = html.match(/name="captcha_id"[^>]*value="([^"]+)"/);
    return {
      csrf: csrfMatch?.[1] || "",
      captchaId: captchaMatch?.[1] || ""
    };
  }

  private aesEncrypt(plaintext: string, key: string, iv: string): string {
    const keyBuffer = Buffer.from(key.padEnd(16, " ").slice(0, 16));
    const ivBuffer = Buffer.from(iv.padEnd(16, " ").slice(0, 16));
    const plainBytes = Buffer.from(plaintext, "utf8");
    const padLen = 16 - (plainBytes.length % 16);
    const padded = padLen === 16 ? plainBytes : Buffer.concat([plainBytes, Buffer.alloc(padLen)]);

    const cipher = createCipheriv("aes-128-cfb", keyBuffer, ivBuffer);
    cipher.setAutoPadding(false);

    const encrypted = Buffer.concat([cipher.update(padded), cipher.final()]);
    return encrypted.toString("hex").toLowerCase();
  }

  private buildPassword(prefix: string, plaintext: string): string {
    const prefixHex = Buffer.from(prefix, "ascii").toString("hex");
    const fullEncrypted = this.aesEncrypt(plaintext, prefix, prefix);
    const sliceLength = 2 * plaintext.length;
    return prefixHex + fullEncrypted.slice(0, Math.min(fullEncrypted.length, sliceLength));
  }
}

function isLoginPageUrl(url: string): boolean {
  try {
    const path = new URL(url).pathname;
    return /\/login(\/|$)/.test(path) || /\/auth\/login/.test(path);
  } catch {
    return false;
  }
}

function isHtmlResponse(response: Response): boolean {
  return (response.headers.get("content-type") ?? "").includes("text/html");
}

function splitSetCookieHeader(value: string | null): string[] {
  if (!value) {
    return [];
  }
  return value.split(/,(?=\s*[^;,=\s]+=[^;,]*)/);
}

function redirectOptions(options: RequestInit, status: number): RequestInit {
  const method = options.method?.toUpperCase();
  if ((status === 301 || status === 302 || status === 303) && method && method !== "GET" && method !== "HEAD") {
    const headers = new Headers(options.headers);
    headers.delete("content-type");
    headers.delete("content-length");
    return {
      ...options,
      method: "GET",
      body: undefined,
      headers
    };
  }
  return options;
}
