export interface JwtPayload {
  id: string;
  username: string;
}

export interface AuthResponse {
  token: string;
  user: JwtPayload;
}
