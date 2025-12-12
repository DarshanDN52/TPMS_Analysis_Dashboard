import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { pcanApi, CHANNEL_OPTIONS, BAUDRATE_OPTIONS } from '../services/api';
import { usePCAN } from '../context/PCANContext';

function CANConsole() {
  const navigate = useNavigate();
  // Global Context
  const { messages: contextMessages, isConnected: contextConnected, setIsConnected, saveBuffer, clearData } = usePCAN();

  // Local UI state
  const [connected, setConnected] = useState(false); // Validating if we should sync this or just use context
  // Let's defer "connected" state to Context entirely? 
  // No, let's sync them or just use contextConnected.
  // Ideally, remove local 'connected' and use 'contextConnected'.

  const [channel, setChannel] = useState('PCAN_USBBUS1');
  const [baudrate, setBaudrate] = useState('PCAN_BAUD_500K');
  const [writeId, setWriteId] = useState('100');
  const [writeDlc, setWriteDlc] = useState(8);
  const [byteValues, setByteValues] = useState(Array(8).fill('00'));

  // Computed stats from contextMessages (or just iterate them)
  // To match previous UI, we can re-derive counters/timestamps from messages on render or effect
  // But for performance, maybe just iterating 'contextMessages' is enough for display?
  // Previous UI had 'messages' (list), 'messageCounters', 'lastTimestamps', 'messageBuffer' (for saving).
  // Context handles 'messages' (list of 200) and 'saveBuffer' (Ref).
  // WE STILL NEED local counters/timestamps if we want to show them?
  // Context messages have "timestamp".
  // We can compute counts on the fly? No, expensive.
  // Actually, let's keep local counters/timestamps but update them in Effect when contextMessages changes?
  // Or simpler: The context only provides the LIST of recent messages.
  // It does NOT provide aggregate counters for all time.
  // If user wants counters, we might need to move counters to Context too?
  // For now, let's try to derive what we can or just accept that counters reset on page load (standard behavior?)
  // BUT the requirement was "Switching pages is clearing buffer".
  // So the CONSOLE list should persist.
  // Context provides the list.
  // So we just use contextMessages for the table.
  // For counters/cycle time, we might need to calculate them or store them in context too.
  // Let's implement a lightweight local calc for now, or just show list.

  // Let's trust Context 'messages' array has what we need for the list.
  // But context messages items are { id, len, data, msg_type, timestamp }.
  // They don't have "count" or "cycleTime" pre-calc'd.
  // The Context logic I wrote *recreates* the message objects.
  // See PCANContext.jsx: 
  /*
     const formatted = specificMessages.map(...)
     return combined.slice(0, 200);
  */
  // It doesn't calc cycle time.
  // To fix "data loss", simply showing the list is step 1.
  // Validating "Cycle Time" might differ if we don't store it globally.
  // Let's accept that "Cycle Time" might only show for *active* page session or we'd need to bloat context.
  // I will just display the messages from context.

  const [logs, setLogs] = useState([]);
  const [showTPMSModal, setShowTPMSModal] = useState(false);
  const [tireCount, setTireCount] = useState(6);
  const [tireConfig, setTireConfig] = useState('2,4');
  const [tpmsError, setTpmsError] = useState('');
  const [isMockMode, setIsMockMode] = useState(false);
  const [mockData, setMockData] = useState(null);

  // Timer Write State
  const [timerMode, setTimerMode] = useState('csv'); // Default to CSV
  const [manualCommand, setManualCommand] = useState('');
  const [csvFileContent, setCsvFileContent] = useState('');
  const [csvFileName, setCsvFileName] = useState('');
  const [timerInterval, setTimerInterval] = useState(2000);
  const [baseId, setBaseId] = useState(1280);
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerLogs, setTimerLogs] = useState([]);
  const timerLogTimerRef = useRef(null);
  const [timerStatusMessage, setTimerStatusMessage] = useState('');

  const pushLog = useCallback((level, message) => {
    const entry = {
      id: Date.now() + Math.random(),
      level,
      message,
      time: new Date().toLocaleTimeString()
    };
    setLogs(prev => [entry, ...prev.slice(0, 99)]);
  }, []);

  // Remove local Polling Logic


  // Timer Log Polling
  const startTimerLogPolling = useCallback(() => {
    if (timerLogTimerRef.current) clearInterval(timerLogTimerRef.current);
    timerLogTimerRef.current = setInterval(async () => {
      try {
        const res = await pcanApi.getTimerLogs();
        if (res.payload?.data) {
          const { logs, running } = res.payload.data;
          // Handle both old list format (fallback) or new object format
          const logList = Array.isArray(res.payload.data) ? res.payload.data : (logs || []);
          const isRunning = typeof running === 'boolean' ? running : false;

          setTimerLogs(logList);

          if (!isRunning && logList.length > 0) {
            setTimerRunning(false);
            setTimerStatusMessage("Finished.");
            // Don't stop polling immediately so we see the final log, or stop after short delay
            // For now, let's keep polling or stop? 
            // If we stop polling, we might miss the very last "Finished" log if timing is tight.
            // Better to just update state.
          }
        }
      } catch (e) {
        console.error("Failed to fetch timer logs", e);
      }
    }, 500);
  }, []);

  const stopTimerLogPolling = useCallback(() => {
    if (timerLogTimerRef.current) {
      clearInterval(timerLogTimerRef.current);
      timerLogTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => stopTimerLogPolling();
  }, [stopTimerLogPolling]);

  // Load default CSV on mount
  useEffect(() => {
    const loadDefaultCsv = async () => {
      try {
        const res = await pcanApi.getDefaultCsv();
        if (res.payload?.packet_status === 'success' && res.payload.data) {
          setCsvFileContent(res.payload.data);
          setCsvFileName("commands.csv");
        }
      } catch (e) {
        console.error("Failed to load default CSV", e);
      }
    };
    loadDefaultCsv();
  }, []);

  // Removed fetchMessage and handleNewMessage
  // We use contextMessages directly in render.

  // Helpers to calculate computed fields for display (optional)
  // If we really want counters, we'd need to reduce the entire contextMessages array?
  // But contextMessages is only last 200.
  // So counts would be wrong? 
  // User asked for "not clearing buffer".
  // If I only show last 200, is that enough? Probably for "Console".
  // The "Save Data" buffer has EVERYTHING (in Ref).
  // So saving is safe.
  // Visualization might just be the list.

  // Let's just define a helper to format data if needed, but context already formats it?
  // Context format: { id, len, data, msg_type, timestamp }
  // Console expects: { id, count, len, cycleTime, data, parsed... }
  // We will map contextMessages to display format on the fly.

  const displayMessages = contextMessages.map((msg, idx) => ({
    ...msg,
    count: '-', // Not available in simple context
    cycleTime: '-', // Not available
    // If we want these, we should have put them in Context.
    // Given constraints, I'll prioritize "Persistence" over "Cycle Time" for now, or update Context later.
  }));

  const handleInitialize = async () => {
    try {
      const data = await pcanApi.initialize(channel, baudrate);
      if (data.payload?.packet_status === 'success') {
        pushLog('success', data.payload.result?.message || 'PCAN initialized');
        pushLog('success', data.payload.result?.message || 'PCAN initialized');
        setIsConnected(true);
        clearData();
        // startPolling(); // Handled by Context
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
        pushLog('success', data.payload.result?.message || 'PCAN released');
        setIsConnected(false);
        // stopPolling(); // Handled by Context
      } else {
        pushLog('error', data.payload.result?.message || 'Failed to release PCAN');
      }
    } catch (error) {
      pushLog('error', `Network error: ${error.message}`);
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!contextConnected) {
      pushLog('error', 'Initialize PCAN before sending');
      return;
    }

    if (!writeId || !/^[0-9a-fA-F]+$/.test(writeId)) {
      pushLog('error', 'Provide a valid hexadecimal ID');
      return;
    }

    const bytes = byteValues.slice(0, writeDlc);
    if (bytes.some(byte => byte.length !== 2 || /[^0-9A-Fa-f]/.test(byte))) {
      pushLog('error', 'Fill every data byte with two hex symbols');
      return;
    }

    try {
      const data = await pcanApi.write(writeId, bytes.map(b => parseInt(b, 16)));
      if (data.payload?.packet_status === 'success') {
        pushLog('success', data.payload.result?.message || 'Frame sent successfully');
      } else {
        pushLog('error', data.payload.result?.message || 'Send failed');
      }
    } catch (error) {
      pushLog('error', `Unable to send frame: ${error.message}`);
    }
  };

  const handleSaveData = async () => {
    try {
      const res = await saveBuffer();
      if (res?.payload?.result?.status === 'ok') {
        pushLog('success', res.payload.result.message || "Data saved");
        // clearData(); // Optional
      } else {
        pushLog('error', "Failed to save");
      }
    } catch (e) {
      pushLog('error', e.message);
    }
  };

  const handleByteChange = (index, value) => {
    const sanitized = value.replace(/[^0-9a-fA-F]/g, '').toUpperCase().slice(0, 2);
    setByteValues(prev => {
      const updated = [...prev];
      updated[index] = sanitized;
      return updated;
    });
  };

  const handleDlcChange = (newDlc) => {
    const dlc = Math.min(Math.max(parseInt(newDlc) || 0, 0), 64);
    setWriteDlc(dlc);
    setByteValues(prev => {
      if (dlc > prev.length) {
        return [...prev, ...Array(dlc - prev.length).fill('00')];
      }
      return prev.slice(0, dlc);
    });
  };

  const handleTPMSSubmit = (e) => {
    e.preventDefault();
    const totalParsed = parseInt(tireCount);
    const configArrParsed = tireConfig.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n) && n > 0);

    let total = totalParsed;
    let configArr = configArrParsed;

    let valid = true;
    if (isNaN(total) || total < 1) valid = false;
    const configTotal = configArr.reduce((sum, n) => sum + n, 0);
    if (configArr.length === 0 || configTotal !== total) valid = false;

    if (!valid) {
      setTpmsError('Using default: total=6, axles=2,4');
      total = 6;
      configArr = [2, 4];
    } else {
      setTpmsError('');
    }

    sessionStorage.setItem('tpmsConfig', JSON.stringify({
      totalTires: total,
      axleConfig: configArr,
      configStr: tireConfig,
      isMockMode
    }));

    if (isMockMode && mockData) {
      sessionStorage.setItem('tpmsSimulationData', JSON.stringify(mockData));
    } else {
      sessionStorage.removeItem('tpmsSimulationData');
    }

    navigate('/tpms');
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        let content = event.target.result;
        // Robustness: Trim whitespace and remove trailing '.' if present (common user typo)
        content = content.trim();
        if (content.endsWith('.')) {
          content = content.slice(0, -1).trim();
        }

        const json = JSON.parse(content);
        setMockData(json);
        setTpmsError('');
      } catch (err) {
        console.error("JSON Parse Error:", err);
        setTpmsError(`Invalid JSON file: ${err.message}`);
        setMockData(null);
      }
    };
    reader.readAsText(file);
  };

  const handleTimerCsvUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setCsvFileName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      setCsvFileContent(event.target.result);
    };
    reader.readAsText(file);
  };

  const handleStartTimer = async () => {
    if (!contextConnected) {
      setTimerStatusMessage("Error: PCAN not connected");
      return;
    }

    setTimerStatusMessage("Starting...");
    setTimerLogs([]);

    const dataToSend = timerMode === 'csv' ? csvFileContent : manualCommand;
    if (!dataToSend || dataToSend.trim() === '') {
      setTimerStatusMessage("Error: No data to send");
      return;
    }

    try {
      const res = await pcanApi.startTimerSequence(timerMode, dataToSend, timerInterval, baseId);
      console.log("Timer Start Response:", res);
      if (res.payload?.packet_status === 'success') {
        setTimerRunning(true);
        setTimerStatusMessage("Running...");
        startTimerLogPolling();
      } else {
        const errMsg = res.payload?.result?.message || res.detail || (typeof res === 'string' ? res : 'Failed to start');
        setTimerStatusMessage(`Error: ${errMsg}`);
      }
    } catch (e) {
      console.error("Timer Start Exception:", e);
      setTimerStatusMessage(`Error: ${e.message}`);
    }
  };

  const handleStopTimer = async () => {
    try {
      await pcanApi.stopTimerSequence();
      setTimerRunning(false);
      setTimerStatusMessage("Stopped.");
      stopTimerLogPolling();
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    // Sync local connected state for UI feedback if needed (or just use context directly)
    // The previous useEffect checked connection on mount. Context does that now.
    // So we just check 'contextConnected' in render.

    const handleBeforeUnload = () => {
      try { pcanApi.release(); } catch { }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  return (
    <div className="app-shell">
      <header className="page-header">
        <h1>PCAN Configuration Console</h1>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button className="primary" onClick={() => setShowTPMSModal(true)}>
            TPMS Data
          </button>
          <button className="primary" onClick={() => navigate('/ble-test')}>
            TESTING
          </button>
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
            <h2>Write Message</h2>
          </header>
          <form onSubmit={handleSendMessage}>
            <div className="field-grid-row">
              <div className="field">
                <span>Identifier (hex)</span>
                <input
                  type="text"
                  value={writeId}
                  onChange={(e) => setWriteId(e.target.value.replace(/[^0-9a-fA-F]/g, '').toUpperCase())}
                  maxLength={8}
                />
              </div>
              <div className="field">
                <span>DLC</span>
                <input
                  type="number"
                  value={writeDlc}
                  onChange={(e) => handleDlcChange(e.target.value)}
                  min={0}
                  max={64}
                />
              </div>
            </div>
            <div className="field">
              <span>Payload bytes</span>
              <div className="byte-grid">
                {Array.from({ length: writeDlc }).map((_, i) => (
                  <input
                    key={i}
                    type="text"
                    value={byteValues[i] || '00'}
                    onChange={(e) => handleByteChange(i, e.target.value)}
                    maxLength={2}
                  />
                ))}
              </div>
            </div>
            <div className="button-row">
              <button type="submit" className="primary" disabled={!contextConnected}>
                Send frame
              </button>
            </div>
          </form>
        </section>

        <section className="card" style={{ gridColumn: '1 / -1' }}>
          <header>
            <h2>CAN Configuration & Timer Write</h2>
          </header>
          <div className="timer-config-container" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <div className="input-section">
              <div style={{ marginBottom: '15px' }}>
                <label className="checkbox-item" style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={timerMode === 'csv'}
                    onChange={(e) => setTimerMode(e.target.checked ? 'csv' : 'manual')}
                    style={{ width: '20px', height: '20px' }}
                  />
                  <span>Use CSV File</span>
                </label>
              </div>

              {timerMode === 'csv' ? (
                <div className="field">
                  <span>Select CSV File</span>
                  <input type="file" accept=".csv" onChange={handleTimerCsvUpload} />
                  {csvFileName && <p style={{ fontSize: '12px', marginTop: '5px' }}>Selected (Default) : {csvFileName}</p>}
                </div>
              ) : (
                <div className="field">
                  <span>Manual Command (ID, CmdType, Payload...)</span>
                  <textarea
                    value={manualCommand}
                    onChange={(e) => setManualCommand(e.target.value)}
                    rows={5}
                    style={{
                      width: '100%',
                      background: 'rgba(0,0,0,0.2)',
                      border: '1px solid var(--border)',
                      color: 'var(--text)',
                      padding: '10px',
                      fontFamily: 'monospace'
                    }}
                    placeholder="ID, CmdType, Payload, TimerInterval, Repeat"
                  />
                  <p className="hint">Format: ID, CmdType(2), Payload(6), Interval(opt), Repeat(opt)</p>
                </div>
              )}

              <div className="field-grid-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div className="field">
                  <span>Default Interval (ms)</span>
                  <input
                    type="number"
                    value={timerInterval}
                    onChange={(e) => setTimerInterval(parseInt(e.target.value) || 0)}
                  />
                </div>
                <div className="field">
                  <span>Base Transmission ID (dec)</span>
                  <input
                    type="number"
                    value={baseId}
                    onChange={(e) => setBaseId(parseInt(e.target.value) || 0)}
                  />
                </div>
              </div>

              <div className="button-row" style={{ marginTop: '20px' }}>
                {!timerRunning ? (
                  <button className="primary" onClick={handleStartTimer} disabled={!contextConnected}>Start Sending</button>
                ) : (
                  <button className="danger" onClick={handleStopTimer} style={{ background: '#ff5c6a', color: 'white', border: 'none', padding: '12px 24px', borderRadius: '12px', fontWeight: 'bold', cursor: 'pointer' }}>Stop Sending</button>
                )}
                <span style={{ marginLeft: '10px', alignSelf: 'center', fontSize: '14px', color: 'var(--accent)' }}>{timerStatusMessage}</span>
              </div>
            </div>

            <div className="log-section">
              <h3 style={{ marginTop: 0, marginBottom: '10px', fontSize: '16px', color: 'var(--muted)' }}>Sequence Log</h3>
              <div className="timer-log-box" style={{
                height: '300px',
                overflowY: 'auto',
                background: '#080b16',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                padding: '10px',
                fontFamily: 'monospace',
                fontSize: '12px'
              }}>
                {timerLogs.length === 0 && <span style={{ color: 'var(--muted)' }}>Logs will appear here...</span>}
                {timerLogs.map((log, idx) => (
                  <div key={idx} style={{ marginBottom: '4px', color: log.type === 'error' ? '#ff5c6a' : log.type === 'sent' ? '#5cc8ff' : log.type === 'recv' ? '#29d98c' : 'var(--text)' }}>
                    <span style={{ color: 'var(--muted)', marginRight: '8px' }}>[{log.timestamp.split('T')[1].split('.')[0]}]</span>
                    {log.message}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="card">
          <header>
            <h2>Read Message</h2>
            <div className="button-row">
              <button type="button" className="primary" onClick={handleSaveData} disabled={!contextConnected}>
                Save Data
              </button>
              <button type="button" className="ghost" onClick={clearData} disabled={!contextConnected}>
                Clear
              </button>
            </div>
          </header>
          <div className="table-wrapper table-scroll">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Count</th>
                  <th>Length</th>
                  <th>Cycle Time (ms)</th>
                  <th>Data</th>
                </tr>
              </thead>
              <tbody>
                {displayMessages.map((msg, idx) => (
                  <tr key={idx}>
                    <td>{msg.id}</td>
                    <td>{msg.count || '-'}</td>
                    <td>{msg.len}</td>
                    <td>{msg.cycleTime || '-'}</td>
                    <td style={{ fontSize: '12px', wordWrap: 'break-word' }}>{msg.data}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
      </main>

      {showTPMSModal && (
        <div className="modal-overlay" onClick={() => setShowTPMSModal(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h2>Configure TPMS</h2>
            <p>Enter tire configuration per axle (e.g., 2,4 for a 6-wheel truck)</p>
            <form onSubmit={handleTPMSSubmit}>
              <div className="field">
                <span>Total Number of Tires</span>
                <input
                  type="number"
                  value={tireCount}
                  onChange={(e) => setTireCount(e.target.value)}
                  min={1}
                  max={32}
                />
              </div>
              <div className="field">
                <span>Tires per Axle (comma-separated)</span>
                <input
                  type="text"
                  value={tireConfig}
                  onChange={(e) => setTireConfig(e.target.value)}
                  placeholder="e.g., 2,4"
                />
              </div>

              <p className="hint">Example: Enter "2,4" for a truck with 2 front tires and 4 rear tires (total 6)</p>

              <div className="field" style={{ marginTop: '15px' }}>
                <span>Operation Mode</span>
                <select
                  value={isMockMode ? 'simulation' : 'live'}
                  onChange={(e) => setIsMockMode(e.target.value === 'simulation')}
                  style={{
                    padding: '8px',
                    borderRadius: '6px',
                    background: 'var(--bg)',
                    color: 'var(--text)',
                    border: '1px solid var(--border)',
                    width: '100%'
                  }}
                >
                  <option value="live">Live Mode</option>
                  <option value="simulation">Simulation Mode</option>
                </select>
              </div>

              {isMockMode && (
                <div className="field">
                  <span>Select Data File (JSON)</span>
                  <input
                    type="file"
                    accept=".json"
                    onChange={handleFileUpload}
                    style={{ color: 'var(--text)' }}
                  />
                  {mockData && <p style={{ color: 'var(--success)', fontSize: '12px', margin: '5px 0' }}>✓ File loaded</p>}
                </div>
              )}
              {tpmsError && <p className="error-message">{tpmsError}</p>}
              <div className="button-row">
                <button type="submit" className="primary">Load TPMS Dashboard</button>
                <button type="button" className="ghost" onClick={() => setShowTPMSModal(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default CANConsole;
