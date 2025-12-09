import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { pcanApi, CHANNEL_OPTIONS, BAUDRATE_OPTIONS } from '../services/api';

function CANConsole() {
  const navigate = useNavigate();
  const [connected, setConnected] = useState(false);
  const [channel, setChannel] = useState('PCAN_USBBUS1');
  const [baudrate, setBaudrate] = useState('PCAN_BAUD_500K');
  const [writeId, setWriteId] = useState('100');
  const [writeDlc, setWriteDlc] = useState(8);
  const [byteValues, setByteValues] = useState(Array(8).fill('00'));
  const [messages, setMessages] = useState([]);
  const [messageCounters, setMessageCounters] = useState({});
  const [lastTimestamps, setLastTimestamps] = useState({});
  const [messageBuffer, setMessageBuffer] = useState([]);
  const [logs, setLogs] = useState([]);
  const [showTPMSModal, setShowTPMSModal] = useState(false);
  const [tireCount, setTireCount] = useState(6);
  const [tireConfig, setTireConfig] = useState('2,4');
  const [tpmsError, setTpmsError] = useState('');

  const pollTimerRef = useRef(null);
  const MAX_BUFFER_SIZE = 1000;

  const pushLog = useCallback((level, message) => {
    const entry = {
      id: Date.now(),
      level,
      message,
      time: new Date().toLocaleTimeString()
    };
    setLogs(prev => [entry, ...prev.slice(0, 99)]);
  }, []);

  const startPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
    }
    fetchMessage();
    pollTimerRef.current = setInterval(fetchMessage, 50);
  }, []);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const fetchMessage = async () => {
    try {
      const data = await pcanApi.read();
      if (data.payload?.data?.message && typeof data.payload.data.message !== 'string') {
        const message = data.payload.data.message;
        handleNewMessage(message);
      }
    } catch (error) {
      console.error('Read error:', error);
    }
  };

  const handleNewMessage = (message) => {
    const key = `${message.msg_type}-${message.id}`;
    const currentTimestamp = Date.now();

    setMessageCounters(prev => ({
      ...prev,
      [key]: (prev[key] || 0) + 1
    }));

    const prevTimestamp = lastTimestamps[message.id];
    const cycleTime = prevTimestamp ? (currentTimestamp - prevTimestamp).toFixed(0) : '-';

    setLastTimestamps(prev => ({
      ...prev,
      [message.id]: currentTimestamp
    }));

    let dataDisplay = '';
    let parsedInfo = null;

    if (message.parsed) {
      const p = message.parsed;
      dataDisplay = `Sensor ${p.sensor_id} | Pressure: ${p.pressure} | Temp: ${p.temperature}C | Battery: ${p.battery_watts} W`;
      parsedInfo = p;
    } else {
      dataDisplay = Array.isArray(message.data)
        ? message.data.map(byte => byte.toString(16).padStart(2, '0').toUpperCase()).join(' ')
        : '';
    }

    const newEntry = {
      id: message.id,
      count: (messageCounters[key] || 0) + 1,
      len: message.len,
      cycleTime,
      data: dataDisplay,
      parsed: parsedInfo,
      timestamp: new Date().toISOString()
    };

    setMessageBuffer(prev => {
      const updated = [...prev, newEntry];
      return updated.length > MAX_BUFFER_SIZE ? updated.slice(1) : updated;
    });

    setMessages(prev => [newEntry, ...prev.slice(0, 199)]);
  };

  const handleInitialize = async () => {
    try {
      const data = await pcanApi.initialize(channel, baudrate);
      if (data.payload?.packet_status === 'success') {
        pushLog('success', data.payload.data || 'PCAN initialized');
        setConnected(true);
        setMessages([]);
        setMessageCounters({});
        setLastTimestamps({});
        startPolling();
      } else {
        pushLog('error', data.payload?.data || 'Failed to initialize PCAN');
      }
    } catch (error) {
      pushLog('error', `Network error: ${error.message}`);
    }
  };

  const handleRelease = async () => {
    try {
      const data = await pcanApi.release();
      if (data.payload?.packet_status === 'success') {
        pushLog('success', data.payload.data || 'PCAN released');
        setConnected(false);
        stopPolling();
      } else {
        pushLog('error', data.payload?.data || 'Failed to release PCAN');
      }
    } catch (error) {
      pushLog('error', `Network error: ${error.message}`);
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!connected) {
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
        pushLog('success', data.payload.data || 'Frame sent successfully');
      } else {
        pushLog('error', data.payload?.data || 'Send failed');
      }
    } catch (error) {
      pushLog('error', `Unable to send frame: ${error.message}`);
    }
  };

  const handleSaveData = async () => {
    if (messageBuffer.length === 0) {
      pushLog('error', 'No data to save. Buffer is empty.');
      return;
    }

    try {
      const data = await pcanApi.saveData(messageBuffer);
      if (data.payload?.packet_status === 'success') {
        pushLog('success', data.payload.data || 'Data saved successfully');
        setMessageBuffer([]);
        setMessages([]);
        setMessageCounters({});
        setLastTimestamps({});
      } else {
        pushLog('error', data.payload?.data || 'Failed to save data');
      }
    } catch (error) {
      pushLog('error', `Error saving data: ${error.message}`);
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
      configStr: tireConfig
    }));

    navigate('/tpms');
  };

  useEffect(() => {
    // Check initial connection status
    pcanApi.getStatus().then(res => {
      if (res.status_code === '00000h') {
        setConnected(true);
        startPolling();
      }
    }).catch(() => { });

    const handleBeforeUnload = () => {
      try { pcanApi.release(); } catch { }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      // Removed pcanApi.release() to keep connection alive during navigation
      stopPolling();
    };
  }, [stopPolling]);

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
            <span className={`pill ${connected ? 'pill--success' : 'pill--danger'}`}>
              {connected ? 'Connected' : 'Disconnected'}
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
              <button type="button" className="primary" onClick={handleInitialize} disabled={connected}>
                Initialize
              </button>
              <button type="button" className="ghost" onClick={handleRelease} disabled={!connected}>
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
              <button type="submit" className="primary" disabled={!connected}>
                Send frame
              </button>
            </div>
          </form>
        </section>

        <section className="card">
          <header>
            <h2>Read Message</h2>
            <div className="button-row">
              <button type="button" className="primary" onClick={handleSaveData} disabled={!connected}>
                Save Data
              </button>
              <button type="button" className="ghost" onClick={() => { setMessages([]); setMessageCounters({}); setLastTimestamps({}); setMessageBuffer([]); }} disabled={!connected}>
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
                {messages.map((msg, idx) => (
                  <tr key={idx}>
                    <td>{msg.id}</td>
                    <td>{msg.count}</td>
                    <td>{msg.len}</td>
                    <td>{msg.cycleTime}</td>
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
