export interface Timestamp {
  seconds: number;
  nanoseconds?: number;
}

export interface User {
  uid: string;
  email: string;
  displayName?: string;
  photoURL?: string;
  createdAt: string | Timestamp;
}

export interface Device {
  id: string;
  name: string;
  type: 'mobile' | 'desktop';
  ownerId: string;
  lastSeen: string | Timestamp;
  isOnline: boolean;
  pairingCode?: string;
}

export interface FileInfo {
  name: string;
  size: number;
  type: string;
}

export interface Transfer {
  id: string;
  senderId: string;
  receiverId: string;
  fileInfo: FileInfo;
  status: 'pending' | 'transferring' | 'completed' | 'failed';
  progress: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface SignalingMessage {
  type: 'offer' | 'answer' | 'candidate';
  payload: any;
  senderId: string;
  receiverId: string;
  transferId: string;
}
