import { Socket, Server as SocketIOServer } from "socket.io";
import { AppContext } from "../../../utils/helper.context";
import globalEventBus, { logAllListeners } from "../../../utils/helper.eventBus";
import { BaseService } from "../../core/base-service";

class SocketService extends BaseService {
  constructor(context: AppContext) {
    super(context);
  }

  async handleCredits(socket: Socket) {
    const { profileId } = socket.handshake.query;

    if (!profileId || typeof profileId !== "string") {
      console.warn(`[WS] Rejected: No profileId`);
      socket.disconnect();
      return;
    }

    console.log(`[WS] Connected: credits stream for profile ${profileId}`);

    const listener = (payload: any) => {
      if (payload.profileId.toString() === profileId) {
        socket.emit("profile:creditsUpdated", payload);
      }
    };

    globalEventBus.on("profile:creditsUpdated", listener);

    socket.on("disconnect", () => {
      console.log(`[WS] Disconnected: profile ${profileId}`);
      globalEventBus.removeListener("profile:creditsUpdated", listener);
      // console.log(logAllListeners());
    });
  }
}

export default SocketService;
