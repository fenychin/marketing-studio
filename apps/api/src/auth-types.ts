export interface TenantCtx {
  id: string;
  name: string;
}

export interface JwtClaims {
  sub: string; // user id
  tid: string; // tenant id
  email: string;
  org: string;
  exp: number;
}
