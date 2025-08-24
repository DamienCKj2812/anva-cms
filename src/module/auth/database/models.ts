import { UserRoleEnum } from "../../user/database/models";

export interface JwtPayload {
  id: string;
  name: string;
  userRole: UserRoleEnum;
}

export interface AuthResponse {
  token: string;
  user: JwtPayload;
}
