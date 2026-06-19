import useInstallPWA from '../pwa/useinstallpwa';

export default function PWAInstallPopup() {
  const { canInstall, install } = useInstallPWA();

  if (!canInstall) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: 20,
      left: 20,
      right: 20,
      background: '#111',
      color: '#fff',
      padding: 16,
      borderRadius: 12,
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      zIndex: 9999
    }}>
      <div>
        📱 Installer YSE Drop
      </div>

      <button
        onClick={install}
        style={{
          background: '#4f46e5',
          padding: '8px 12px',
          borderRadius: 8,
          color: 'white'
        }}
      >
        Installer
      </button>
    </div>
  );
}