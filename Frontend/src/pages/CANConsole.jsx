import { useState, useEffect, useCallback } from 'react';
import { pcanApi, CHANNEL_OPTIONS, BAUDRATE_OPTIONS } from '../services/api';
import { usePCAN } from '../context/PCANContext';

function CANConsole() {
  // Global Context
  const {
    messages: contextMessages,
    isConnected: contextConnected,
    setIsConnected,
    clearData,
  } = usePCAN();

  const [channel, setChannel] = useState('PCAN_USBBUS1');
  const [baudrate, setBaudrate] = useState('PCAN_BAUD_500K');
  const [logs, setLogs] = useState([]);

  const pushLog = useCallback((level, message) => {
    const entry = {
      id: Date.now() + Math.random(),
      level,
      message,
      time: new Date().toLocaleTimeString()
    };
    setLogs(prev => [entry, ...prev.slice(0, 99)]);
  }, []);

  const displayMessages = contextMessages;

  const handleInitialize = async () => {
    try {
      const data = await pcanApi.initialize(channel, baudrate);
      if (data.payload?.packet_status === 'success') {
        pushLog('success', data.payload.result?.message || 'PCAN initialized');
        setIsConnected(true);
        clearData();
      } else {
        pushLog('error', data.payload.result?.message || 'Failed to initialize PCAN');
      }
    } catch (error) {
      pushLog('error', `Network error: ${error.message}`);
    }
  };

  const handleRelease = async () => {
    try {
      const data = await pcanApi.release();
      if (data.payload?.packet_status === 'success') {
        pushLog('success', data.payload.result?.message || 'PCAN released');
        setIsConnected(false);
      } else {
        pushLog('error', data.payload.result?.message || 'Failed to release PCAN');
      }
    } catch (error) {
      pushLog('error', `Network error: ${error.message}`);
    }
  };

  return (
    <div className="app-shell">
      <header className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <svg 
            width="40" 
            height="40" 
            viewBox="0 0 24 24" 
            fill="none" 
            stroke="var(--accent)" 
            strokeWidth="2" 
            strokeLinecap="round" 
            strokeLinejoin="round"
          >
            <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" />
            <path d="M15 18H9" />
            <path d="M19 18h2a1 1 0 0 0 1-1v-5h-7v5a1 1 0 0 0 1 1h2" />
            <path d="M15 10h5l2 2" />
            <circle cx="7" cy="18" r="2" />
            <circle cx="17" cy="18" r="2" />
          </svg>
          <h1>Multifeet Configuration Console</h1>
        </div>
      </header>

      <main className="grid">
        <section className="card">
          <header>
            <h2>Connection</h2>
            <span className={`pill ${contextConnected ? 'pill--success' : 'pill--danger'}`}>
              {contextConnected ? 'Connected' : 'Disconnected'}
            </span>
          </header>
          <form onSubmit={(e) => e.preventDefault()}>
            <div className="field">
              <span>Hardware channel</span>
              <select value={channel} onChange={(e) => setChannel(e.target.value)}>
                {CHANNEL_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <span>Baudrate preset</span>
              <select value={baudrate} onChange={(e) => setBaudrate(e.target.value)}>
                {BAUDRATE_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div className="button-row">
              <button type="button" className="primary" onClick={handleInitialize} disabled={contextConnected}>
                Initialize
              </button>
              <button type="button" className="ghost" onClick={handleRelease} disabled={!contextConnected}>
                Release
              </button>
            </div>
          </form>
        </section>

        <section className="card">
          <header>
            <h2>Connection log</h2>
            <button type="button" className="ghost" onClick={() => setLogs([])}>
              Clear log
            </button>
          </header>
          <ul className="log-list">
            {logs.map(log => (
              <li key={log.id} className={`log-entry ${log.level}`}>
                [{log.time}] {log.message}
              </li>
            ))}
          </ul>
        </section>

        <section className="card" style={{ gridColumn: '1 / -1' }}>
          <header>
            <h2>Read Message</h2>
            <div className="button-row">
              <button type="button" className="ghost" onClick={clearData} disabled={!contextConnected}>
                Clear
              </button>
            </div>
          </header>
          <div className="table-wrapper table-scroll" style={{ maxHeight: '500px' }}>
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Length</th>
                  <th>Data</th>
                </tr>
              </thead>
              <tbody>
                {displayMessages.map((msg, idx) => (
                  <tr key={idx}>
                    <td>{msg.id}</td>
                    <td>{msg.len}</td>
                    <td style={{ fontSize: '12px', wordWrap: 'break-word' }}>{msg.data}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}

export default CANConsole;
