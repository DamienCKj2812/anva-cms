
export interface JwtPayload {
  id: string;
  name: string;
}

export interface AuthResponse {
  token: string;
  user: JwtPayload;
}
