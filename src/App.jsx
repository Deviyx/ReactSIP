import React, { useEffect, useState } from 'react';
import toast, { Toaster } from 'react-hot-toast';
import { Phone, Settings as SettingsIcon, Clock, Bug } from 'lucide-react';
import { useSIPContext } from './context/SIPContext';
import { useAudio } from './hooks/useAudio';
import Dialpad from './components/Dialpad';
import ActiveCall from './components/ActiveCall';
import IncomingCall from './components/IncomingCall';
import Settings from './components/Settings';
import CallHistory from './components/CallHistory';
import StatusBar from './components/StatusBar';
import Debug from './components/Debug';
import './App.css';

function App() {
  const [activeTab, setActiveTab] = useState('dialpad');
  const [theme, setTheme] = useState(() => localStorage.getItem('microsip-theme') || 'light');
  const { calls, settings } = useSIPContext();
  const { micPermission } = useAudio({ autoRequest: false });
  const showDebugTab = Boolean(settings?.show_debug_tab);

  const showActiveCall = Array.isArray(calls) && calls.some((call) => call && !['ended', 'failed'].includes(call.status));

  useEffect(() => {
    if (micPermission === false) {
      console.warn('Microphone permission not granted');
    }
  }, [micPermission]);

  useEffect(() => {
    document.body.setAttribute('data-theme', theme);
    localStorage.setItem('microsip-theme', theme);
  }, [theme]);

  useEffect(() => {
    if (!showDebugTab && activeTab === 'debug') {
      setActiveTab('dialpad');
    }
  }, [activeTab, showDebugTab]);

  useEffect(() => {
    if (!window.electronAPI?.onUpdateStatus) return undefined;

    window.electronAPI.onUpdateStatus((status) => {
      if (!status?.state) return;

      if (status.state === 'available') {
        toast.success(status.message || 'Atualizacao encontrada');
      } else if (status.state === 'downloading') {
        const percent = Math.max(0, Math.min(100, Math.round(status.percent || 0)));
        toast(`Atualizando... ${percent}%`, { id: 'update-progress', duration: 1200 });
      } else if (status.state === 'downloaded') {
        toast.dismiss('update-progress');
        toast.success('Atualizacao pronta. Reinicie o app para instalar.', { duration: 4500 });
      } else if (status.state === 'error') {
        toast.dismiss('update-progress');
        toast.error(status.message || 'Falha ao atualizar');
      } else if (status.state === 'not-available') {
        toast.dismiss('update-progress');
      }
    });

    return undefined;
  }, []);

  const tabs = [
    { id: 'dialpad', icon: Phone, label: 'Ligar' },
    { id: 'history', icon: Clock, label: 'Histórico' },
    { id: 'settings', icon: SettingsIcon, label: 'Config' },
    ...(showDebugTab ? [{ id: 'debug', icon: Bug, label: 'Debug' }] : []),
  ];

  return (
    <div className="app-root">
      <div className="bg-orb orb-a" />
      <div className="bg-orb orb-b" />
      <div className="bg-orb orb-c" />

      <Toaster
        position="top-center"
        reverseOrder={false}
        containerStyle={{ top: 12, left: 8, right: 8 }}
        gutter={8}
        toastOptions={{
          duration: 2200,
          style: {
            background: theme === 'light' ? 'rgba(255,255,255,0.97)' : 'rgba(18,26,47,0.92)',
            color: theme === 'light' ? '#17233f' : '#e8efff',
            border: theme === 'light' ? '1px solid #cfdcf7' : '1px solid #30446f',
            borderRadius: '14px',
            boxShadow: theme === 'light' ? '0 14px 28px rgba(24,42,84,0.2)' : '0 14px 34px rgba(2,6,18,0.6)',
          },
        }}
      />

      <IncomingCall />

      <div className="phone-chassis">
        <div className="phone-notch" />
        <div className="phone-screen">
          <StatusBar
            theme={theme}
            onToggleTheme={() => setTheme((prev) => (prev === 'light' ? 'dark' : 'light'))}
          />

          <div className="phone-content">
            {showActiveCall ? (
              <ActiveCall />
            ) : (
              <>
                <div className="tab-row">
                  {tabs.map(({ id, icon: Icon, label }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setActiveTab(id)}
                      className={`tab-pill ${activeTab === id ? 'tab-pill-active' : ''}`}
                    >
                      <Icon size={16} className="tab-icon" />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>

                <div key={activeTab} className="tab-content-pop">
                  {activeTab === 'dialpad' && <Dialpad />}
                  {activeTab === 'history' && <CallHistory />}
                  {activeTab === 'settings' && <Settings />}
                  {activeTab === 'debug' && <Debug />}
                </div>
              </>
            )}
          </div>

          {micPermission === false && !showActiveCall && (
            <div className="mic-warning">
              <span className="warning-dot" />
              Microfone necessário para chamadas
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
