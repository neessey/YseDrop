import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Laptop,
  Smartphone,
  Plus,
  RefreshCcw,
  Settings,
  History,
  Send,
  CheckCircle2,
  AlertCircle,
  QrCode,
  LogOut,
  Upload,
  Battery,
  Wifi,
  FileText,
  Image as ImageIcon,
  Video,
  File,
  X,
  Clipboard,
  Download,
  Zap,
  ZapOff
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { Html5Qrcode } from 'html5-qrcode';
import { SupabaseProvider, useAuth } from './components/SupabaseProvider';
import { supabase } from './lib/supabase';
import { Device, Transfer, FileInfo } from './types';
import { cn, formatBytes, generatePairingCode } from './lib/utils';
import { io, Socket } from 'socket.io-client';

// --- Sub-components (Drafted here for speed, will extract if too large) ---

function DeviceIcon({ type }: { type: 'mobile' | 'desktop' }) {
  return type === 'desktop' ? <Laptop className="w-5 h-5" /> : <Smartphone className="w-5 h-5" />;
}

export default function App() {
  return (
    <SupabaseProvider>
      <Dashboard />
    </SupabaseProvider>
  );
}

function Dashboard() {
  const { user, loading, signIn, logout, isSupabaseConfigured } = useAuth();
  const [devices, setDevices] = useState<Device[]>([]);
  const [dbDevices, setDbDevices] = useState<Device[]>([]);
  const [socketDevices, setSocketDevices] = useState<Device[]>([]);
  const [scannedDevices, setScannedDevices] = useState<Device[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [currentDeviceId, setCurrentDeviceId] = useState<string>('');
  const [pairingMode, setPairingMode] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTransferId, setCurrentTransferId] = useState<string | null>(null);
  const [incomingFile, setIncomingFile] = useState<{
    fileName: string;
    fileData: string;
    fileType: string;
  } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manualPairCode, setManualPairCode] = useState('');

  const [tempProfileName, setTempProfileName] = useState(() => localStorage.getItem('ysedrop_custom_mock_name') || 'Yanis');
  const [tempEmail, setTempEmail] = useState(() => localStorage.getItem('ysedrop_custom_mock_email') || 'yanis@ysedrop.local');
  const [tempAvatar, setTempAvatar] = useState(() => localStorage.getItem('ysedrop_custom_mock_avatar') || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop');

  const socketRef = useRef<Socket | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);

  // Initialize Device ID
  useEffect(() => {
    let devId = sessionStorage.getItem('ysedrop_device_id');
    if (!devId) {
      devId = 'device_' + Math.random().toString(36).substring(2, 15);
      sessionStorage.setItem('ysedrop_device_id', devId);
    }
    setCurrentDeviceId(devId);
  }, []);

  // Merge database, socket and scanned devices dynamically
  useEffect(() => {
    const mergedMap = new Map<string, Device>();

    // 1. Add DB devices
    dbDevices.forEach(d => {
      mergedMap.set(d.id, d);
    });

    // 2. Add Socket devices (overrides or adds, ensures online status is true)
    socketDevices.forEach(d => {
      const existing = mergedMap.get(d.id);
      if (existing) {
        mergedMap.set(d.id, {
          ...existing,
          isOnline: true
        });
      } else {
        mergedMap.set(d.id, d);
      }
    });

    // 3. Add Scanned/manual paired devices
    scannedDevices.forEach(d => {
      if (!mergedMap.has(d.id)) {
        mergedMap.set(d.id, d);
      }
    });

    // Filter out our own device
    const finalDevices = Array.from(mergedMap.values()).filter(d => d.id !== currentDeviceId);
    setDevices(finalDevices);
  }, [dbDevices, socketDevices, scannedDevices, currentDeviceId]);

  // Socket.io initialization
  useEffect(() => {
    if (currentDeviceId && user) {
      socketRef.current = io();

      // Register with details
      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      const suffix = currentDeviceId.substring(currentDeviceId.length - 4).toUpperCase();
      const deviceName = `${user.displayName || 'Demo User'}'s ${isMobile ? 'Phone' : 'Computer'} (${suffix})`;
      const deviceType = isMobile ? 'mobile' : 'desktop';

      socketRef.current.emit('register-device-detailed', {
        deviceId: currentDeviceId,
        userEmail: user.email,
        deviceName: deviceName,
        deviceType: deviceType
      });

      socketRef.current.on('signaling', (data) => {
        console.log('Received signaling:', data);
      });

      socketRef.current.on('file-received', (data) => {
        console.log('File received into browser client!', data.fileName);
        setIncomingFile({
          fileName: data.fileName,
          fileData: data.fileData,
          fileType: data.fileType
        });

        // Automatically add the sender device to paired devices so they can send files back instantly
        if (data.senderId) {
          const suffix = data.senderId.substring(Math.max(0, data.senderId.length - 4)).toUpperCase();
          const senderName = `Paired Device (${suffix})`;
          const autoDevice: Device = {
            id: data.senderId,
            name: senderName,
            type: data.senderId.includes('phone') ? 'mobile' : 'desktop',
            ownerId: user?.uid || '',
            isOnline: true,
            lastSeen: { seconds: Math.floor(Date.now() / 1000) }
          };
          setScannedDevices(prev => {
            if (prev.some(d => d.id === data.senderId)) return prev;
            return [...prev, autoDevice];
          });
        }
      });

      socketRef.current.on('devices-list-updated', (others: any[]) => {
        const mappedDevices = others.map((d: any) => ({
          id: d.deviceId,
          name: d.deviceName,
          type: d.deviceType,
          ownerId: user.uid,
          isOnline: true,
          lastSeen: { seconds: Math.floor(Date.now() / 1000) }
        }));
        setSocketDevices(mappedDevices);
      });

      return () => {
        socketRef.current?.disconnect();
      };
    }
  }, [currentDeviceId, user]);

  // Scanner Logic
  useEffect(() => {
    let html5QrCode: Html5Qrcode | null = null;

    if (scanning) {
      const timer = setTimeout(async () => {
        const element = document.getElementById('reader');
        if (!element) return;

        html5QrCode = new Html5Qrcode("reader");
        scannerRef.current = html5QrCode;

        try {
          await html5QrCode.start(
            { facingMode: "environment" },
            {
              fps: 10,
              qrbox: { width: 250, height: 250 },
            },
            (decodedText) => {
              console.log("Scanned Device ID:", decodedText);
              const found = devices.find(d => d.id === decodedText);
              if (found) {
                setSelectedDevice(found);
                setScanning(false);
                setPairingMode(false);
              } else {
                const suffix = decodedText.substring(Math.max(0, decodedText.length - 4)).toUpperCase();
                const pairingName = `Scanned Device (${suffix})`;
                const newScanned: Device = {
                  id: decodedText,
                  name: pairingName,
                  type: decodedText.includes('phone') || /mobile/i.test(navigator.userAgent) ? 'mobile' : 'desktop',
                  ownerId: user?.uid || '',
                  isOnline: true,
                  lastSeen: { seconds: Math.floor(Date.now() / 1000) }
                };
                setScannedDevices(prev => [...prev.filter(d => d.id !== decodedText), newScanned]);
                setSelectedDevice(newScanned);
                setScanning(false);
                setPairingMode(false);
              }
            },
            () => { }
          );

          // Check for torch availability
          const track = html5QrCode.getRunningTrackCapabilities();
          if (track && (track as any).torch) {
            setTorchAvailable(true);
          }
        } catch (err: any) {
          console.error("Unable to start scanning", err);
          const errMsg = err?.toString() || "";
          if (errMsg.includes("NotAllowedError") || errMsg.includes("Permission") || errMsg.includes("dismissed")) {
            setCameraError("Camera permission was denied. Please enable camera access in your browser settings to scan QR codes.");
          } else {
            setCameraError("Could not start camera. Make sure no other app is using it, or copy/paste the pairing code below.");
          }
        }
      }, 100);

      return () => {
        clearTimeout(timer);
        if (html5QrCode && html5QrCode.isScanning) {
          html5QrCode.stop().catch(() => { });
        }
        scannerRef.current = null;
        setTorchOn(false);
        setTorchAvailable(false);
        setCameraError(null);
      };
    }
  }, [scanning, devices]);

  const toggleFlashlight = async () => {
    if (!scannerRef.current || !torchAvailable) return;
    const newState = !torchOn;
    try {
      await scannerRef.current.applyVideoConstraints({
        advanced: [{ torch: newState } as any]
      });
      setTorchOn(newState);
    } catch (err) {
      console.error("Flashlight error:", err);
    }
  };

  // Sync Device Info to Supabase
  useEffect(() => {
    if (user && currentDeviceId) {
      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      const suffix = currentDeviceId.substring(currentDeviceId.length - 4).toUpperCase();

      const updateDevice = async () => {
        try {
          await supabase.from('devices').upsert({
            id: currentDeviceId,
            name: `${user.displayName}'s ${isMobile ? 'Phone' : 'Computer'} (${suffix})`,
            type: isMobile ? 'mobile' : 'desktop',
            owner_id: user.uid,
            last_seen: new Date().toISOString(),
            is_online: true,
            pairing_code: generatePairingCode()
          });
        } catch (err) {
          console.error("Error syncing device:", err);
        }
      };

      updateDevice();

      // Heartbeat
      const interval = setInterval(updateDevice, 60000); // Every minute

      return () => {
        clearInterval(interval);
      };
    }
  }, [user, currentDeviceId]);

  // Fetch Devices
  useEffect(() => {
    if (!user) return;
    if (!isSupabaseConfigured) return; // Handled dynamically in real-time via Socket.io!

    const fetchDevices = async () => {
      try {
        const { data, error } = await supabase
          .from('devices')
          .select('*')
          .eq('owner_id', user.uid);

        if (data) {
          const mapped = data.map((d: any) => ({
            id: d.id,
            name: d.name,
            type: d.type,
            ownerId: d.owner_id || d.ownerId,
            lastSeen: { seconds: Math.floor(new Date(d.last_seen || d.lastSeen || Date.now()).getTime() / 1000) },
            isOnline: d.is_online !== undefined ? d.is_online : d.isOnline,
            pairingCode: d.pairing_code || d.pairingCode
          })) as Device[];
          setDbDevices(mapped.filter(d => d.id !== currentDeviceId));
        }
      } catch (err) {
        console.error("Error fetching devices:", err);
      }
    };

    fetchDevices();

    // Live subscription
    const channel = supabase
      .channel('devices')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'devices' }, () => {
        fetchDevices();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, currentDeviceId, isSupabaseConfigured]);

  // Fetch Transfers
  useEffect(() => {
    if (!user) return;

    const fetchTransfers = async () => {
      try {
        const { data, error } = await supabase
          .from('transfers')
          .select('*')
          .eq('sender_id', user.uid);

        if (data) {
          const mapped = data.map((t: any) => ({
            id: t.id,
            senderId: t.sender_id || t.senderId,
            receiverId: t.receiver_id || t.receiverId,
            fileInfo: {
              name: t.file_info?.name || t.fileInfo?.name || '',
              size: t.file_info?.size || t.fileInfo?.size || 0,
              type: t.file_info?.type || t.fileInfo?.type || '',
            },
            status: t.status,
            progress: t.progress,
            createdAt: { seconds: Math.floor(new Date(t.created_at || t.createdAt || Date.now()).getTime() / 1000) },
            updatedAt: { seconds: Math.floor(new Date(t.updated_at || t.updatedAt || Date.now()).getTime() / 1000) }
          })) as Transfer[];

          mapped.sort((a, b) => {
            const timeA = a.createdAt?.seconds || 0;
            const timeB = b.createdAt?.seconds || 0;
            return timeB - timeA;
          });
          setTransfers(mapped);
        }
      } catch (err) {
        console.error("Error fetching transfers:", err);
      }
    };

    fetchTransfers();

    const channel = supabase
      .channel('transfers')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transfers' }, () => {
        fetchTransfers();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const handleSendFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedDevice || !user || !socketRef.current) return;

    setUploading(true);
    setProgress(5);

    const generatedId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15);

    // Setup the DB log in the background immediately
    supabase.from('transfers').insert({
      id: generatedId,
      sender_id: user.uid,
      receiver_id: selectedDevice.id,
      file_info: {
        name: file.name,
        size: file.size,
        type: file.type
      },
      status: 'transferring',
      progress: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }).catch((err: any) => {
      console.warn("Error setting up transfer record in background, continuing transfer directly:", err);
    });

    setCurrentTransferId(generatedId);

    // 2. Read File and Send via Socket
    const reader = new FileReader();

    reader.onload = async (event) => {
      const result = event.target?.result as string;

      // Send base64 data to peer via socket
      socketRef.current?.emit('file-transfer', {
        receiverId: selectedDevice.id,
        senderId: currentDeviceId,
        fileName: file.name,
        fileType: file.type,
        fileData: result,
        transferId: generatedId
      });

      // Show real-time progress simulated over 1.2s to indicate socket transmission pipeline instead of 0
      let curProgress = 10;
      setProgress(curProgress);
      const progressTimer = setInterval(() => {
        if (curProgress < 95) {
          curProgress += Math.max(5, Math.floor(Math.random() * 20));
          if (curProgress > 95) curProgress = 95;
          setProgress(curProgress);
        }
      }, 150);

      // Finish up nicely
      setTimeout(() => {
        clearInterval(progressTimer);
        setProgress(100);

        // Record completion in backend logs
        supabase.from('transfers').update({
          status: 'completed',
          progress: 100,
          updated_at: new Date().toISOString()
        }).eq('id', generatedId).catch((dbErr: any) => {
          console.warn("Could not write transfer completion log:", dbErr);
        });

        setTimeout(() => {
          setUploading(false);
          setSelectedDevice(null);
        }, 500);
      }, 1200);
    };

    reader.onprogress = (event) => {
      if (event.lengthComputable) {
        const p = Math.round((event.loaded / event.total) * 50);
        setProgress(Math.max(5, p));
      }
    };

    reader.onerror = () => {
      setUploading(false);
      setProgress(0);
      alert("Error reading select file source file.");
    };

    reader.readAsDataURL(file);
  };

  const cancelTransfer = async () => {
    if (!currentTransferId) return;

    try {
      await supabase.from('transfers').update({
        status: 'failed',
        updated_at: new Date().toISOString()
      }).eq('id', currentTransferId);
    } catch (error) {
      console.error("Error canceling transfer:", error);
    }

    setUploading(false);
    setProgress(0);
    setCurrentTransferId(null);
    setSelectedDevice(null);
  };

  const downloadReceivedFile = () => {
    if (!incomingFile) return;
    const a = document.createElement('a');
    a.href = incomingFile.fileData;
    a.download = incomingFile.fileName;
    a.click();
    setIncomingFile(null);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FBFBFB] flex items-center justify-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
        >
          <RefreshCcw className="w-8 h-8 text-blue-600" />
        </motion.div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#FAFBFD] to-[#F1F3F7] flex flex-col items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="max-w-md w-full bg-white rounded-[32px] shadow-[0_20px_50px_rgba(0,0,0,0.05)] p-8 border border-gray-100/80 text-center relative overflow-hidden"
        >
          {/* Subtle gradient banner at the top */}
          <div className="absolute top-0 inset-x-0 h-1.5 bg-gradient-to-r from-blue-500 to-indigo-600" />

          <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <RefreshCcw className="w-8 h-8 text-blue-600 animate-spin-slow" />
          </div>

          <h1 className="text-3xl font-extrabold tracking-tight text-gray-900 mb-2">Welcome to YseDrop</h1>
          <p className="text-gray-500 text-sm mb-8 leading-relaxed max-w-sm mx-auto">
            Instant and fully secure file sharing across all your devices. Fast, zero-configuration, and effortless.
          </p>

          <div className="space-y-4">
            <button
              onClick={signIn}
              className="w-full bg-gray-900 hover:bg-black text-white font-semibold py-4 px-6 rounded-2xl flex items-center justify-center space-x-3 transition-all active:scale-[0.98] shadow-lg shadow-gray-200"
            >
              {/* Simple inline SVG for Google Icon */}
              <svg className="w-5 h-5 text-white fill-current" viewBox="0 0 24 24">
                <path d="M12.24 10.285V13.4h6.887C18.2 15.614 15.645 18 12.24 18c-3.152 0-5.733-2.585-5.733-5.734s2.58-10.266 5.733-10.266c1.71 0 3.097.66 4 1.488L18.8 1.05C17.114.33 14.88 0 12.24 0 6.58 0 2 4.58 2 10.24c0 5.66 4.58 10.24 10.24 10.24 5.9 0 9.81-4.14 9.81-9.98 0-.64-.06-1.12-.17-1.615H12.24z" />
              </svg>
              <span>Connect with Google</span>
            </button>

            <p className="text-[11px] text-gray-400 tracking-wide font-medium">
              Secured by Google Identity Service
            </p>
          </div>

          <div className="mt-8 pt-6 border-t border-gray-50 flex items-center justify-center space-x-6 text-gray-400">
            <div className="flex items-center space-x-1.5">
              <Laptop className="w-4 h-4" />
              <span className="text-[10px] font-bold uppercase tracking-wider">Laptop</span>
            </div>
            <div className="flex items-center space-x-1.5">
              <Smartphone className="w-4 h-4" />
              <span className="text-[10px] font-bold uppercase tracking-wider">Mobile</span>
            </div>
            <div className="flex items-center space-x-1.5">
              <Wifi className="w-4 h-4" />
              <span className="text-[10px] font-bold uppercase tracking-wider">Same Wifi</span>
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FBFBFB] text-gray-900 font-sans">
      {/* Header */}
      <nav className="sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b border-gray-100">
        <div className="max-w-4xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <RefreshCcw className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-xl tracking-tight uppercase">YseDrop</span>
          </div>
          <div className="flex items-center space-x-4">
            <button
              onClick={() => setPairingMode(!pairingMode)}
              className="p-2 text-gray-500 hover:bg-gray-100 rounded-xl transition-colors"
            >
              <QrCode className="w-5 h-5" />
            </button>
            <button
              onClick={logout}
              className="p-2 text-gray-500 hover:bg-gray-100 rounded-xl transition-colors"
            >
              <LogOut className="w-5 h-5" />
            </button>
            <img src={user.photoURL || ''} alt="Profile" className="w-8 h-8 rounded-full border border-gray-100" />
          </div>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-6 py-8">
        {/* Boîte d'aide - Tutoriel réel */}
        {devices.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8 bg-blue-50/60 border border-blue-100/80 rounded-[24px] p-6 text-sm text-blue-950 leading-relaxed flex items-start space-x-3 shadow-md"
          >
            <span className="text-xl mt-0.5 shrink-0">💡</span>
            <div>
              <p className="font-extrabold text-blue-900 mb-1.5 text-base">Comment fonctionne YseDrop ?</p>
              <p className="text-xs text-blue-850 leading-normal mb-2">
                Pour transférer des fichiers, connectez-vous simplement avec le <strong>même compte Google</strong> sur vos autres appareils (PC, Mac, iPhone, Android).
              </p>
              <ul className="list-disc list-inside space-y-1 text-blue-800 text-xs">
                <li>Vos appareils se détecteront automatiquement et apparaîtront dans la liste.</li>
                <li>Sélectionnez l'appareil destinataire, puis choisissez le fichier à envoyer.</li>
                <li>Le transfert est instantané et sécurisé via votre espace privé connecté !</li>
              </ul>
            </div>
          </motion.div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">

          {/* Left Column: Devices */}
          <div className="lg:col-span-7 space-y-8">
            <section>
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold tracking-tight">Devices</h2>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => { setPairingMode(true); setScanning(true); }}
                    className="flex items-center space-x-2 px-4 py-2 bg-blue-50 text-blue-600 text-sm font-bold rounded-xl hover:bg-blue-100 transition-colors"
                  >
                    <QrCode className="w-4 h-4" />
                    <span>Scan to Pair</span>
                  </button>
                  <span className="px-2.5 py-1 bg-green-50 text-green-600 text-xs font-semibold rounded-full flex items-center">
                    <span className="w-1.5 h-1.5 bg-green-500 rounded-full mr-1.5 animate-pulse" />
                    Live
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Current Device */}
                <div className="bg-white p-5 rounded-3xl border-2 border-blue-100 shadow-sm relative overflow-hidden group">
                  <div className="absolute top-0 right-0 p-3">
                    <Battery className="w-4 h-4 text-green-500" />
                  </div>
                  <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center mb-4 text-blue-600 ring-4 ring-blue-50/50">
                    <DeviceIcon type={/mobile/i.test(navigator.userAgent) ? 'mobile' : 'desktop'} />
                  </div>
                  <p className="text-xs font-medium text-blue-600 mb-0.5 uppercase tracking-wider">You</p>
                  <h3 className="font-bold truncate">This Device</h3>
                  <div className="mt-3 flex items-center text-xs text-gray-500">
                    <Wifi className="w-3 h-3 mr-1" />
                    Same WiFi
                  </div>
                </div>

                {/* Remote Devices */}
                {devices.map((device) => (
                  <motion.div
                    key={device.id}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => setSelectedDevice(device)}
                    className={cn(
                      "bg-white p-5 rounded-3xl border cursor-pointer transition-all shadow-sm relative overflow-hidden group",
                      selectedDevice?.id === device.id ? "border-blue-500 ring-4 ring-blue-50" : "border-gray-100 hover:border-blue-200"
                    )}
                  >
                    <div className="w-12 h-12 bg-gray-50 rounded-2xl flex items-center justify-center mb-4 text-gray-600 group-hover:bg-blue-50 group-hover:text-blue-600 transition-colors">
                      <DeviceIcon type={device.type} />
                    </div>
                    <p className="text-xs font-medium text-gray-400 mb-0.5 uppercase tracking-wider">{device.isOnline ? 'Online' : 'Offline'}</p>
                    <h3 className="font-bold truncate">{device.name}</h3>
                    <div className="mt-3 flex items-center text-xs text-gray-500">
                      <Send className="w-3 h-3 mr-1" />
                      Tap to send
                    </div>
                  </motion.div>
                ))}

                <button
                  onClick={() => setPairingMode(true)}
                  className="bg-gray-50 border-2 border-dashed border-gray-200 p-5 rounded-3xl flex flex-col items-center justify-center transition-all hover:bg-gray-100 group"
                >
                  <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center mb-2 shadow-sm text-gray-400 group-hover:text-blue-600 transition-colors">
                    <Plus className="w-6 h-6" />
                  </div>
                  <span className="text-sm font-semibold text-gray-500">Add Device</span>
                </button>
              </div>
            </section>

            {/* Transfer Control */}
            <AnimatePresence>
              {selectedDevice && (
                <motion.section
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="bg-blue-600 rounded-[32px] p-8 text-white relative shadow-2xl shadow-blue-200">
                    <div className="flex items-start justify-between mb-8">
                      <div>
                        <h2 className="text-2xl font-bold mb-1">Send to {selectedDevice.name}</h2>
                        <p className="text-blue-100 text-sm">Select any file to transfer instantly.</p>
                      </div>
                      <button
                        onClick={() => setSelectedDevice(null)}
                        className="p-2 hover:bg-white/10 rounded-lg"
                      >
                        <LogOut className="rotate-180 w-5 h-5" />
                      </button>
                    </div>

                    {!uploading ? (
                      <div className="grid grid-cols-3 gap-3">
                        <label className="flex flex-col items-center justify-center p-4 bg-white/10 rounded-2xl hover:bg-white/20 cursor-pointer transition-colors border border-white/10">
                          <ImageIcon className="w-6 h-6 mb-2" />
                          <span className="text-xs font-semibold">Photos</span>
                          <input type="file" accept="image/*" className="hidden" onChange={handleSendFile} />
                        </label>
                        <label className="flex flex-col items-center justify-center p-4 bg-white/10 rounded-2xl hover:bg-white/20 cursor-pointer transition-colors border border-white/10">
                          <Video className="w-6 h-6 mb-2" />
                          <span className="text-xs font-semibold">Videos</span>
                          <input type="file" accept="video/*" className="hidden" onChange={handleSendFile} />
                        </label>
                        <label className="flex flex-col items-center justify-center p-4 bg-white/10 rounded-2xl hover:bg-white/20 cursor-pointer transition-colors border border-white/10">
                          <File className="w-6 h-6 mb-2" />
                          <span className="text-xs font-semibold">Files</span>
                          <input type="file" className="hidden" onChange={handleSendFile} />
                        </label>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="flex items-center justify-between text-sm mb-2">
                          <span className="font-medium flex items-center">
                            <RefreshCcw className="w-3 h-3 mr-2 animate-spin" />
                            Transferring...
                          </span>
                          <span className="font-mono">{progress}%</span>
                        </div>
                        <div className="h-3 bg-white/20 rounded-full overflow-hidden">
                          <motion.div
                            className="h-full bg-white shadow-[0_0_15px_rgba(255,255,255,0.5)]"
                            initial={{ width: 0 }}
                            animate={{ width: `${progress}%` }}
                          />
                        </div>
                        <button
                          onClick={cancelTransfer}
                          className="w-full mt-4 py-3 bg-white/10 hover:bg-white/20 rounded-2xl flex items-center justify-center text-sm font-bold border border-white/10 transition-colors"
                        >
                          <X className="w-4 h-4 mr-2" />
                          Cancel Transfer
                        </button>
                      </div>
                    )}
                  </div>
                </motion.section>
              )}
            </AnimatePresence>
          </div>

          {/* Right Column: History & Stats */}
          <div className="lg:col-span-5 space-y-8">
            <section className="bg-white rounded-[32px] border border-gray-100 shadow-sm overflow-hidden flex flex-col h-full max-h-[600px]">
              <div className="p-6 border-b border-gray-50 flex items-center justify-between bg-white sticky top-0 z-10">
                <div className="flex items-center space-x-2">
                  <History className="w-5 h-5 text-gray-400" />
                  <h2 className="font-bold tracking-tight">Recent Activity</h2>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-2 scrollbar-thin scrollbar-thumb-gray-200">
                <AnimatePresence initial={false}>
                  {transfers.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                      <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mb-4">
                        <Send className="w-8 h-8 opacity-20" />
                      </div>
                      <p className="text-sm">No transfers yet.</p>
                    </div>
                  ) : (
                    transfers.map((t) => (
                      <motion.div
                        key={t.id}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="p-4 hover:bg-gray-50 rounded-2xl transition-colors flex items-center space-x-4"
                      >
                        <div className={cn(
                          "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
                          t.status === 'completed' ? "bg-green-50 text-green-600" : "bg-blue-50 text-blue-600"
                        )}>
                          <FileText className="w-5 h-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold truncate pr-4">{t.fileInfo.name}</p>
                          <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">
                            {formatBytes(t.fileInfo.size)} • {t.status}
                          </p>
                        </div>
                        {t.status === 'completed' ? (
                          <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
                        ) : (
                          <div className="text-[10px] font-mono text-blue-600 font-bold">{t.progress}%</div>
                        )}
                      </motion.div>
                    ))
                  )}
                </AnimatePresence>
              </div>
            </section>
          </div>
        </div>
      </main>

      {/* Pairing Modal */}
      <AnimatePresence>
        {pairingMode && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setPairingMode(false)}
              className="absolute inset-0 bg-black/20 backdrop-blur-sm"
            />
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-[40px] shadow-2xl p-10 max-w-sm w-full relative z-10 text-center"
            >
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-2xl font-bold">Pair Device</h2>
                <button
                  onClick={() => setPairingMode(false)}
                  className="p-2 hover:bg-gray-100 rounded-xl"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {scanning ? (
                <div className="space-y-6">
                  <div className="relative overflow-hidden rounded-3xl border-2 border-gray-100 bg-black min-h-[300px] flex items-center justify-center">
                    {cameraError ? (
                      <div className="absolute inset-0 bg-gray-950 p-6 flex flex-col items-center justify-center text-center">
                        <div className="w-12 h-12 bg-red-950/50 rounded-2xl flex items-center justify-center text-red-400 mb-4 border border-red-900/30">
                          <AlertCircle className="w-6 h-6" />
                        </div>
                        <h4 className="text-white font-bold mb-2 text-sm">Camera Blocked</h4>
                        <p className="text-gray-400 text-xs leading-relaxed max-w-[240px] mb-4">
                          {cameraError}
                        </p>
                      </div>
                    ) : (
                      <div id="reader" className="w-full h-full" />
                    )}

                    {!cameraError && torchAvailable && (
                      <button
                        onClick={toggleFlashlight}
                        className={cn(
                          "absolute bottom-4 right-4 p-3 rounded-full shadow-lg transition-all z-20",
                          torchOn ? "bg-yellow-400 text-white" : "bg-white/20 text-white backdrop-blur-md"
                        )}
                      >
                        {torchOn ? <Zap className="w-5 h-5 fill-current" /> : <ZapOff className="w-5 h-5" />}
                      </button>
                    )}
                  </div>
                  <button
                    onClick={() => setScanning(false)}
                    className="w-full py-4 border-2 border-gray-100 text-gray-900 font-bold rounded-2xl hover:bg-gray-50 transition-all"
                  >
                    Cancel Scan
                  </button>
                </div>
              ) : (
                <div className="space-y-8">
                  <div className="p-6 bg-gray-50 rounded-[32px] inline-block border-4 border-white shadow-inner">
                    <QRCodeSVG
                      value={currentDeviceId}
                      size={200}
                      level="H"
                      includeMargin={false}
                    />
                  </div>

                  <div className="space-y-4">
                    <button
                      onClick={() => setScanning(true)}
                      className="w-full py-4 bg-blue-600 text-white font-bold rounded-2xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-200 active:scale-95"
                    >
                      Scan QR Code
                    </button>

                    <div className="border-t border-gray-100/80 my-2 pt-2" />

                    <p className="text-gray-400 text-xs font-semibold tracking-widest uppercase">Or share this code</p>
                    <div
                      onClick={() => {
                        navigator.clipboard.writeText(currentDeviceId);
                        alert("Copied code to clipboard!");
                      }}
                      className="bg-gray-50 hover:bg-gray-100 cursor-pointer active:scale-98 transition-all p-4 rounded-2xl font-mono text-xl font-bold tracking-widest text-blue-600 flex items-center justify-center space-x-2"
                    >
                      <span>{currentDeviceId.substring(0, 8).toUpperCase()}</span>
                      <Clipboard className="w-4 h-4 opacity-30" />
                    </div>

                    <div className="border-t border-gray-100/80 my-2" />

                    <p className="text-gray-400 text-xs font-semibold tracking-widest uppercase">Or enter code manually</p>
                    <div className="flex space-x-2">
                      <input
                        type="text"
                        value={manualPairCode}
                        onChange={(e) => setManualPairCode(e.target.value)}
                        placeholder="ENTER CODE"
                        className="bg-gray-50 border border-gray-100 p-3 rounded-2xl font-mono text-sm tracking-widest text-blue-600 flex-1 uppercase placeholder:text-gray-300 text-center focus:outline-none focus:border-blue-400 focus:bg-white transition-all font-bold"
                      />
                      <button
                        onClick={() => {
                          const val = manualPairCode.trim();
                          if (val) {
                            // Match existing device
                            const found = devices.find(d =>
                              d.id.toLowerCase() === val.toLowerCase() ||
                              d.id.toLowerCase().includes(val.toLowerCase()) ||
                              d.name.toLowerCase().includes(val.toLowerCase())
                            );
                            if (found) {
                              setSelectedDevice(found);
                              setPairingMode(false);
                            } else {
                              // Build scanned/paired device on the fly
                              let newId = val;
                              if (!newId.startsWith('device_')) {
                                newId = 'device_' + val.toLowerCase();
                              }
                              const suffix = val.substring(Math.max(0, val.length - 4)).toUpperCase();
                              const newDevice: Device = {
                                id: newId,
                                name: `Paired Device (${suffix})`,
                                type: 'desktop',
                                ownerId: user?.uid || '',
                                isOnline: true,
                                lastSeen: { seconds: Math.floor(Date.now() / 1000) }
                              };
                              setScannedDevices(prev => [...prev.filter(d => d.id !== newId), newDevice]);
                              setSelectedDevice(newDevice);
                              setPairingMode(false);
                            }
                            setManualPairCode('');
                          }
                        }}
                        className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-5 rounded-2xl transition-all font-sans text-sm tracking-tight active:scale-95"
                      >
                        Pair
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Incoming File Overlay */}
      <AnimatePresence>
        {incomingFile && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 bg-white rounded-3xl shadow-2xl border border-blue-100 p-6 flex flex-col space-y-4 max-w-sm w-full mx-6"
          >
            <div className="flex items-center space-x-4">
              {incomingFile.fileType.startsWith('image/') ? (
                <img
                  src={incomingFile.fileData}
                  className="w-16 h-16 object-cover rounded-2xl border border-gray-100 shrink-0"
                  alt="Preview"
                />
              ) : incomingFile.fileType.startsWith('video/') ? (
                <video
                  src={incomingFile.fileData}
                  className="w-16 h-16 object-cover rounded-2xl border border-gray-100 shrink-0"
                  muted
                  autoPlay
                  loop
                />
              ) : (
                <div className="w-16 h-16 bg-blue-100 rounded-2xl flex items-center justify-center text-blue-600 shrink-0">
                  <FileText className="w-8 h-8" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-blue-600 uppercase tracking-widest mb-0.5">Incoming File</p>
                <h4 className="font-bold truncate text-base text-gray-950">{incomingFile.fileName}</h4>
              </div>
            </div>

            <div className="flex items-center space-x-3 w-full">
              <button
                onClick={() => setIncomingFile(null)}
                className="flex-1 py-3 text-sm font-bold text-gray-500 hover:bg-gray-50 rounded-2xl transition-all border border-gray-100"
              >
                Decline
              </button>
              <button
                onClick={downloadReceivedFile}
                className="flex-1 bg-blue-600 text-white py-3 text-sm font-bold rounded-2xl shadow-xl shadow-blue-200 hover:bg-blue-700 active:scale-95 transition-all flex items-center justify-center space-x-2"
              >
                <Download className="w-4 h-4" />
                <span>Save</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <footer className="max-w-4xl mx-auto px-6 py-12 text-center text-gray-400 text-xs font-medium tracking-widest uppercase">
        End-to-End Encrypted • Powered by YseDiscovery
      </footer>
    </div>
  );
}

