import express from "express";
import configs from "./src/configs";
import cors from "cors";
import cookieParser from "cookie-parser";
import path from "path";
import MongoHelper from "./src/utils/helper.mongo";
import { errorHandler } from "./src/utils/helper.errors";
import createAppContext from "./src/utils/helper.context";
import http from "http";
import { createDIContainer } from "./src/utils/helper.diContainer";
import createAdminRouter from "./src/middleware/admin.routes";
import createPublicRouter from "./src/middleware/public.routes";

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
  }),
);

app.options("*", cors()); // Enable preflight globally

(async () => {
  const db = await MongoHelper.getInstance().connect();

  const context = createAppContext(db);

  //  Initialize DI container & services
  await createDIContainer(context); // build and wire services here

  app.use("/api/admin", createAdminRouter(context));
  app.use("/api/public", createPublicRouter(context));

  app.use(errorHandler);
})();

server.listen(configs.PORT, () => {
  console.log(`Server is running on http://localhost:${configs.PORT}`);
});
