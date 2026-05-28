export interface AuthToken {
  access_token?: string;
  refresh_token?: string;
  error?: string;
  error_description?: string;
}

export interface WebVpnOptions {
  mode?: "auto" | "vpn" | "direct";
  cookies?: Record<string, string>;
  credentials?: {
    username: string;
    password: string;
  };
}

export interface ClientOptions {
  tokenStore: {
    getAccessToken(): Promise<string | undefined>;
    getRefreshToken(): Promise<string | undefined>;
    getCurrentAccount?(): Promise<{ account: string; refreshToken?: string } | undefined>;
    save(tokens: { accessToken: string; refreshToken?: string }): Promise<void>;
    saveAccount?(account: string, tokens: { accessToken: string; refreshToken?: string }): Promise<unknown>;
  };
  webVpn?: WebVpnOptions;
}

export type JsonObject = Record<string, unknown>;
