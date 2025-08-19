import express from "express";
import configs from "./src/configs";
import cors from "cors";
import cookieParser from "cookie-parser";
import path from "path";
import MongoHelper from "./src/utils/helper.mongo";
import { errorHandler } from "./src/utils/helper.errors";
import createAppContext from "./src/utils/helper.context";
import { Server as SocketIOServer } from "socket.io";
import http from "http";
import createRouter from "./src/middleware/router";
import registerSocketHandlers from "./src/module/socket/controller";
import { createDIContainer } from "./src/utils/helper.diContainer";

const app = express();
app.use(express.json());
app.use(cookieParser());
const server = http.createServer(app);

const assetsPath = path.join(__dirname, "assets");
app.use("/assets", express.static(assetsPath));

export const allowedOrigins = ["http://localhost:3000", "http://localhost:3001"]; // frontend URL
app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  })
);

app.options("*", cors()); // Enable preflight globally

const io = new SocketIOServer(server, {
  path: "/ws",
  cors: {
    origin: allowedOrigins,
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"],
    methods: ["GET", "POST"],
  },
});

(async () => {
  const db = await MongoHelper.getInstance().connect();

  const context = createAppContext(db);

  //  Initialize DI container & services
  createDIContainer(context); // build and wire services here

  app.use("/api", createRouter(context));

  registerSocketHandlers(io, context);
  app.use(errorHandler);
})();

server.listen(configs.PORT, () => {
  console.log(`Server is running on http://localhost:${configs.PORT}`);
});
