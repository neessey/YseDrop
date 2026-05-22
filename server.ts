import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { createServer } from "http";
import { Server } from "socket.io";

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  const PORT = 3000;

  // Socket.io for WebRTC signaling
  io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);

    // Join a device-specific room
    socket.on("register-device", (deviceId: string) => {
      socket.join(deviceId);
      console.log(`Device registered: ${deviceId}`);
    });

    // Handle signaling messages
    socket.on("signaling", (data: { receiverId: string, payload: any, senderId: string, type: string, transferId: string }) => {
      console.log(`Signaling ${data.type} from ${data.senderId} to ${data.receiverId}`);
      io.to(data.receiverId).emit("signaling", data);
    });

    // Handle real file data proxying (Real transfer)
    socket.on("file-transfer", (data: { 
      receiverId: string, 
      senderId: string, 
      fileName: string, 
      fileType: string, 
      fileData: ArrayBuffer,
      transferId: string 
    }) => {
      console.log(`Sending file ${data.fileName} from ${data.senderId} to ${data.receiverId}`);
      io.to(data.receiverId).emit("file-received", data);
    });

    socket.on("disconnect", () => {
      console.log("Client disconnected:", socket.id);
    });
  });

  // API routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
