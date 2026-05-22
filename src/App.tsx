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

  // Socket.io initialization
  useEffect(() => {
    if (currentDeviceId) {
      socketRef.current = io();
      socketRef.current.emit('register-device', currentDeviceId);

      socketRef.current.on('signaling', (data) => {
        console.log('Received signaling:', data);
      });

      socketRef.current.on('file-received', (data) => {
        console.log('File received!', data.fileName);
        setIncomingFile({
          fileName: data.fileName,
          fileData: data.fileData,
          fileType: data.fileType
        });
        
        // Auto-download for this demo, or show button
      });

      return () => {
        socketRef.current?.disconnect();
      };
    }
  }, [currentDeviceId]);

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
                alert("Device detected! Connecting...");
                setScanning(false);
                setPairingMode(false);
              }
            },
            () => {}
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
          html5QrCode.stop().catch(() => {});
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
          setDevices(mapped.filter(d => d.id !== currentDeviceId));
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
  }, [user, currentDeviceId]);

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
    setProgress(0);

    const generatedId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15);

    try {
      await supabase.from('transfers').insert({
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
      });
    } catch (err) {
      console.error("Error setting up transfer record:", err);
    }

    setCurrentTransferId(generatedId);

    // 2. Read File and Send via Socket
    const reader = new FileReader();
    reader.onload = async (event) => {
      const result = event.target?.result as string;
      
      // Send base64 data
      socketRef.current?.emit('file-transfer', {
        receiverId: selectedDevice.id,
        senderId: currentDeviceId,
        fileName: file.name,
        fileType: file.type,
        fileData: result,
        transferId: generatedId
      });

      // Update UI
      setProgress(100);
      setTimeout(async () => {
        try {
          await supabase.from('transfers').update({ 
            status: 'completed', 
            progress: 100,
            updated_at: new Date().toISOString()
          }).eq('id', generatedId);
        } catch (err) {
          console.error("Error updating transfer status:", err);
        }
        setUploading(false);
        setSelectedDevice(null);
      }, 500);
    };

    reader.onprogress = (event) => {
      if (event.lengthComputable) {
        const p = Math.round((event.loaded / event.total) * 100);
        setProgress(p);
      }
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
    const handleMockProfileSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      localStorage.setItem('ysedrop_custom_mock_name', tempProfileName.trim() || 'Yanis');
      localStorage.setItem('ysedrop_custom_mock_email', tempEmail.trim() || 'yanis@ysedrop.local');
      localStorage.setItem('ysedrop_custom_mock_avatar', tempAvatar);
      
      const hashedEmailId = 'mock-user-' + btoa(tempEmail.trim() || 'yanis@ysedrop.local').replace(/=/g, '').substring(0, 10);
      localStorage.setItem('ysedrop_mock_user_id', hashedEmailId);
      
      await signIn();
    };

    return (
      <div className="min-h-screen bg-[#F4F6F9] flex flex-col items-center justify-center p-6">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-white rounded-[32px] shadow-2xl p-8 border border-gray-100 text-center relative overflow-hidden"
        >
          {/* Accent decoration */}
          <div className="absolute top-0 inset-x-0 h-2 bg-gradient-to-r from-blue-500 to-indigo-600" />
          
          <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <RefreshCcw className="w-8 h-8 text-blue-600" />
          </div>
          
          <h1 className="text-2xl font-black tracking-tight text-gray-900 mb-2">Welcome to YseDrop</h1>
          <p className="text-gray-500 text-sm mb-6 leading-relaxed">Instant file sharing across all your devices. Fast, secure, and effortless.</p>
          
          {!isSupabaseConfigured ? (
            <form onSubmit={handleMockProfileSubmit} className="text-left space-y-4 bg-gray-50 p-5 rounded-2xl border border-gray-100">
              <div className="flex items-center space-x-2 text-xs font-bold text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-full w-fit mb-2">
                <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-pulse" />
                <span>DEMO MODE ACTIVE (MOCK DB)</span>
              </div>
              
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider block">Nickname / Display Name</label>
                <input 
                  type="text" 
                  value={tempProfileName}
                  onChange={(e) => setTempProfileName(e.target.value)}
                  placeholder="e.g. Yanis Computer"
                  className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider block">Mock Email (Account Linker)</label>
                <input 
                  type="email" 
                  value={tempEmail}
                  onChange={(e) => setTempEmail(e.target.value)}
                  placeholder="e.g. yanis@ysedrop.local"
                  className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-xs"
                  required
                />
                <p className="text-[10px] text-gray-400 leading-normal">
                  💡 <strong>Tip:</strong> Keep the same email on different tabs to see each other automatically, or change email to test QR-scanning manual pairing!
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider block">Select Avatar</label>
                <div className="flex items-center justify-between gap-2 pt-1">
                  {[
                    'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop',
                    'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop',
                    'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100&h=100&fit=crop',
                    'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&h=100&fit=crop'
                  ].map((url, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setTempAvatar(url)}
                      className={`w-10 h-10 rounded-full border-2 overflow-hidden transition-all ${tempAvatar === url ? 'border-blue-600 scale-110 shadow-md' : 'border-transparent opacity-60 hover:opacity-100'}`}
                    >
                      <img src={url} alt="avatar" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              </div>

              <button 
                type="submit"
                className="w-full mt-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold py-3.5 rounded-xl transition-all shadow-lg shadow-blue-100 uppercase tracking-wider text-xs"
              >
                Enter App
              </button>
            </form>
          ) : (
            <button 
              onClick={signIn}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-4 rounded-2xl transition-all shadow-lg shadow-blue-200 active:scale-95"
            >
              Sign in with Google
            </button>
          )}

          <div className="mt-6 flex items-center justify-center space-x-6 text-gray-400">
            <div className="flex items-center space-x-1">
              <Laptop className="w-5 h-5" />
              <span className="text-[10px] font-bold uppercase tracking-wider">Laptop</span>
            </div>
            <div className="flex items-center space-x-1">
              <Smartphone className="w-5 h-5" />
              <span className="text-[10px] font-bold uppercase tracking-wider">Phone</span>
            </div>
            <div className="flex items-center space-x-1">
              <Wifi className="w-5 h-5" />
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
        {/* Boîte d'aide pour tester le transfert local */}
        {!isSupabaseConfigured && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8 bg-blue-50/60 border border-blue-100 rounded-[24px] p-6 text-sm text-blue-950 leading-relaxed flex items-start space-x-3 shadow-sm"
          >
            <span className="text-2xl mt-0.5 shrink-0">💡</span>
            <div>
              <p className="font-extrabold text-blue-900 mb-1.5 text-base">Comment tester le transfert de fichiers de part et d'autre ?</p>
              <ul className="list-decimal list-inside space-y-1.5 text-blue-850 text-xs">
                <li>Ouvrez ce <strong>même lien d'application</strong> (URL de développement) dans : un <strong>onglet de navigation privée</strong>, un autre navigateur (Firefox, Safari, Edge), ou chargez-le sur votre <strong>smartphone</strong>.</li>
                <li>Connectez-vous en utilisant le <strong>même Mock Email</strong> (ex: <code className="bg-blue-100/80 text-blue-800 px-1.5 py-0.5 rounded font-mono font-bold">yanis@ysedrop.local</code>) mais attribuez un <strong>nom différent</strong> à l'appareil (ex: <i>"Mon Téléphone"</i> ou <i>"PC Portable"</i>).</li>
                <li>Les deux appareils se détecteront instantanément ! Cliquez sur le destinataire dans la liste, déposez un fichier, et il sera immédiatement **téléchargeable** (bouton <strong>Enregistrer</strong>) sur l'autre appareil !</li>
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
                  
                  <div className="space-y-3">
                    <button 
                      onClick={() => setScanning(true)}
                      className="w-full py-4 bg-blue-600 text-white font-bold rounded-2xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-200 active:scale-95"
                    >
                      Scan QR Code
                    </button>
                    <p className="text-gray-400 text-xs font-medium tracking-widest uppercase">Or share this code</p>
                    <div className="bg-gray-50 p-4 rounded-2xl font-mono text-xl font-bold tracking-widest text-blue-600 flex items-center justify-center space-x-2">
                      <span>{currentDeviceId.substring(0, 8).toUpperCase()}</span>
                      <Clipboard className="w-4 h-4 opacity-30" />
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

