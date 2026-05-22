import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { createServer } from "http";
import { Server } from "socket.io";

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    maxHttpBufferSize: 1e9, // Support up to 1GB files
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  const PORT = 3000;

  // Socket.io for WebRTC signaling
  const activeDevices = new Map<string, {
    socketId: string;
    deviceId: string;
    userEmail: string;
    deviceName: string;
    deviceType: 'mobile' | 'desktop';
    lastSeen: string;
  }>();

  function broadcastDevicesForEmail(email: string) {
    if (!email) return;
    const cleanEmail = email.toLowerCase().trim();
    const devicesList = Array.from(activeDevices.values())
      .filter(d => d.userEmail === cleanEmail);

    devicesList.forEach(dev => {
      const others = devicesList.filter(o => o.deviceId !== dev.deviceId);
      io.to(dev.deviceId).emit("devices-list-updated", others);
    });
  }

  io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);

    // Join a device-specific room
    socket.on("register-device", (deviceId: string) => {
      socket.join(deviceId);
      console.log(`Device registered: ${deviceId}`);
    });

    socket.on("register-device-detailed", (data: {
      deviceId: string;
      userEmail: string;
      deviceName: string;
      deviceType: 'mobile' | 'desktop';
    }) => {
      if (!data || !data.deviceId) return;
      socket.join(data.deviceId);

      const cleanEmail = (data.userEmail || 'demo@ysedrop.local').toLowerCase().trim();

      // Store socket metadata
      (socket as any).deviceId = data.deviceId;
      (socket as any).userEmail = cleanEmail;

      activeDevices.set(data.deviceId, {
        socketId: socket.id,
        deviceId: data.deviceId,
        userEmail: cleanEmail,
        deviceName: data.deviceName || 'Unnamed Device',
        deviceType: data.deviceType || 'desktop',
        lastSeen: new Date().toISOString()
      });

      console.log(`Detailed device registered: ${data.deviceId} for email: ${cleanEmail}`);

      // Broadcast update to everyone with the same email
      broadcastDevicesForEmail(cleanEmail);
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
      fileData: string,
      transferId: string
    }) => {
      console.log(`Sending file ${data.fileName} from ${data.senderId} to ${data.receiverId}`);
      io.to(data.receiverId).emit("file-received", data);
    });

    socket.on("disconnect", () => {
      console.log("Client disconnected:", socket.id);
      const deviceId = (socket as any).deviceId;
      const userEmail = (socket as any).userEmail;

      if (deviceId) {
        activeDevices.delete(deviceId);
      }
      if (userEmail) {
        broadcastDevicesForEmail(userEmail);
      }
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
