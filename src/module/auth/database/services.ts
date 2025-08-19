import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { AuthResponse, JwtPayload } from "./models";
import configs from "../../../configs";
import { ValidationError } from "../../../utils/helper.errors";
import ProfileService from "../../profiles/database/services";
import { BaseService } from "../../core/base-service";
import { UserRoleEnum } from "../../profiles/database/models";
import { Permissions } from "../../../utils/helper.permission";

class AuthService extends BaseService {
  private profileService: ProfileService;
  private jwtSecret: string;

  constructor(context: any) {
    super(context);
    this.jwtSecret = configs.JWT_SECRET;
  }

  async init() {
    this.profileService = this.getService("ProfileService");
  }

  async login(name: string, password: string): Promise<AuthResponse> {
    if (!this.profileService) {
      throw new Error("ProfileService is not initialized");
    }

    if (!name || !password) {
      throw new ValidationError("You must enter an name and password");
    }

    const profile = await this.profileService.findOne({ name });

    if (!profile?.password || !profile?._id) {
      throw new Error("Invalid credentials");
    }

    const isPasswordValid = await bcrypt.compare(password, profile.password);
    if (!isPasswordValid) {
      throw new Error("Invalid credentials");
    }

    const profileId = profile._id.toString();
    const payload: JwtPayload = {
      id: profileId,
      name: profile.name,
      userRole: profile.userRole as UserRoleEnum,
      permissions: [
        Permissions.PROFILE_READ,
        Permissions.PROFILE_UPDATE,
        Permissions.CHATBOT_SETTING_READ,
        Permissions.FLOW_SETTING_READ,
        Permissions.CHATBOT_SETTING_READ,
        Permissions.SECTION_CONTENT_READ,
        Permissions.SECTION_ROOM_SETTING_READ,
        Permissions.SECTION_CONTENT_READ,
        Permissions.SECTION_CONTENT_UPDATE,
      ],
    };

    const token = jwt.sign(payload, this.jwtSecret, { expiresIn: "1d" });

    return {
      token,
      profile: {
        id: payload.id,
        name: payload.name,
        userRole: payload.userRole,
        permissions: payload.permissions,
      },
    };
  }

  async verifyToken(token: string): Promise<JwtPayload> {
    return jwt.verify(token, this.jwtSecret) as JwtPayload;
  }
}

export default AuthService;
