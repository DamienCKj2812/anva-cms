import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { AuthResponse, JwtPayload } from "./models";
import configs from "../../../configs";
import { ValidationError } from "../../../utils/helper.errors";
import { BaseService } from "../../core/base-service";
import { UserRoleEnum } from "../../user/database/models";
import UserService from "../../user/database/services";

class AuthService extends BaseService {
  private userService: UserService;
  private jwtSecret: string;

  constructor(context: any) {
    super(context);
    this.jwtSecret = configs.JWT_SECRET;
  }

  async init() {
    this.userService = this.getService("UserService");
  }

  async login(name: string, password: string): Promise<AuthResponse> {
    if (!name || !password) {
      throw new ValidationError("You must enter an name and password");
    }

    const user = await this.userService.findOne({ name });

    if (!user?.password || !user?._id) {
      throw new Error("Invalid credentials");
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new Error("Invalid credentials");
    }

    const userId = user._id.toString();
    const payload: JwtPayload = {
      id: userId,
      name: user.name,
      userRole: user.userRole as UserRoleEnum,
    };

    const token = jwt.sign(payload, this.jwtSecret, { expiresIn: "1d" });

    return {
      token,
      user: {
        id: payload.id,
        name: payload.name,
        userRole: payload.userRole,
      },
    };
  }

  async verifyToken(token: string): Promise<JwtPayload> {
    return jwt.verify(token, this.jwtSecret) as JwtPayload;
  }
}

export default AuthService;
