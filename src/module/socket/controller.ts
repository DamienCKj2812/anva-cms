import { Server as SocketIOServer, Socket } from "socket.io";
import { AppContext } from "../../utils/helper.context";
import SocketService from "./database/services";
import { socketAuthenticate } from "../../middleware/auth";

interface ConnectedClientInfo {
  socketId: string;
  profileId?: string;
}

const registerSocketHandlers = (io: SocketIOServer, context: AppContext) => {
  const socketService = new SocketService(context);
  io.use(socketAuthenticate(context));

  io.on("connection", async (socket) => {
    try {
      await socketService.handleCredits(socket);

      // Monitor to avoid memory leaks
      // const connectedClients = getConnectedClientsSummary(io);
      // console.log("Currently connected WebSocket clients:", connectedClients);
    } catch (err) {
      console.error(`[WS] Error handling connection for ${socket.id}:`, err);
      socket.disconnect();
    }
  });

  function getConnectedClientsSummary(io: SocketIOServer): ConnectedClientInfo[] {
    const clients: ConnectedClientInfo[] = [];

    io.of("/").sockets.forEach((socket) => {
      const profileId = typeof socket.handshake.query.profileId === "string" ? socket.handshake.query.profileId : undefined;

      clients.push({
        socketId: socket.id,
        profileId,
      });
    });

    return clients;
  }
};

export default registerSocketHandlers;
