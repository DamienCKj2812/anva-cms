import { Permissions } from "../../../utils/helper.permission";
import { UserRoleEnum } from "../../profiles/database/models";

export interface JwtPayload {
  id: string;
  name: string;
  userRole: UserRoleEnum;
  permissions: Permissions[];
}

export interface AuthResponse {
  token: string;
  profile: JwtPayload;
}
