import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useSIPContext = create(
  persist(
    (set) => ({
      settings: {
        uri: '',
        username: '',
        domain: '',
        password: '',
        display_name: '',
        ws_servers_host: '',
        ws_servers_port: '8089',
        transport: 'udp',
        local_sip_port: '5061',
        rtp_port_start: '4000',
        rtp_port_end: '4999',
        stun_server: '',
        register: true,
        session_timers: false,
        use_preloaded_route: false,
        audio_input_device_id: 'default',
        audio_output_device_id: 'default',
        audio_input_volume: 100,
        audio_output_volume: 100,
        show_debug_tab: false,
      },
      connectionStatus: 'Disconnected',
      registrationStatus: 'Unregistered',
      sipUri: null,
      session: null,
      incomingCallData: null,
      calls: [],
      callHistory: [],
      muted: false,
      onHold: false,
      
      setSettings: (newSettings) =>
        set((state) => ({ settings: { ...state.settings, ...newSettings } })),
      setConnectionStatus: (status) => set({ connectionStatus: status }),
      setRegistrationStatus: (status) => set({ registrationStatus: status }),
      setSipUri: (uri) => set({ sipUri: uri }),
      setSession: (session) => set({ session: session }),
      setIncomingCallData: (data) => set({ incomingCallData: data }),
      addCall: (call) => set((state) => ({ calls: [...state.calls, call] })),
      updateCall: (callId, updates) =>
        set((state) => ({
          calls: state.calls.map((call) =>
            call.id === callId ? { ...call, ...updates } : call
          ),
        })),
      addToHistory: (call) => set((state) => ({ callHistory: [...state.callHistory, call] })),
      setMuted: (muted) => set({ muted: muted }),
      setOnHold: (onHold) => set({ onHold: onHold }),
    })
  ,
  {
    name: 'microsip-storage',
    version: 2,
    partialize: (state) => ({
      settings: state.settings,
      callHistory: state.callHistory,
    }),
    migrate: (persistedState) => ({
      ...persistedState,
      settings: {
        ...persistedState?.settings,
        show_debug_tab: Boolean(persistedState?.settings?.show_debug_tab),
      },
      session: null,
      incomingCallData: null,
      calls: [],
      muted: false,
      onHold: false,
      connectionStatus: 'Disconnected',
      registrationStatus: 'Unregistered',
    }),
  })
);
