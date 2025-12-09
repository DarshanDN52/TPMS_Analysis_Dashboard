import React, { useState, useEffect, useRef } from 'react';

const BLETestControl = () => {
    const [devices, setDevices] = useState([]);
    const [selectedDevice, setSelectedDevice] = useState('');
    const [config, setConfig] = useState({
        write_uuid: '01ff0101-ba5e-f4ee-5ca1-eb1e5e4b1ce0',
        notify_uuid: '01ff0101-ba5e-f4ee-5ca1-eb1e5e4b1ce0',
        chunk_length: 30,
        max_retries: 3,
        ble_timeout: 10,
        use_collection: true,
    });
    const [manualCommands, setManualCommands] = useState('');
    const [logs, setLogs] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isScanning, setIsScanning] = useState(false);
    const [testStatus, setTestStatus] = useState('idle'); // idle, running, completed
    const wsRef = useRef(null);

    const baseUrl = window.location.origin;

    useEffect(() => {
        connectWebSocket();
        return () => {
            if (wsRef.current) {
                wsRef.current.onclose = null;
                wsRef.current.close();
            }
            const url = `${baseUrl}/stop-test`;
            navigator.sendBeacon(url);
        };
    }, []);

    const connectWebSocket = () => {
        const wsProtocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
        const wsUrl = `${wsProtocol}${window.location.host}/ws`;

        if (wsRef.current) {
            wsRef.current.onclose = null;
            wsRef.current.close();
        }
        wsRef.current = new WebSocket(wsUrl);

        wsRef.current.onopen = () => addLog("WS", "Connected to real-time log stream.");
        wsRef.current.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'log') {
                    addLog("DEVICE_LOG", msg.data);
                } else if (msg.type === 'test_complete') {
                    const result = msg.result;
                    const status = result.success ? "SUCCESS" : "FAILURE";
                    const summary = `Test complete! Status: ${status}. Stats: Total=${result.stats.total}, Success=${result.stats.success}, Failed=${result.stats.failed}, Unknown=${result.stats.unknown}`;
                    addLog("TEST_RESULT_SUMMARY", summary);
                    addLog("TEST_RESULT_DETAILS", JSON.stringify(result, null, 2));
                    setTestStatus('completed');
                }
            } catch (e) {
                addLog("WS_ERROR", "Failed to parse incoming message: " + event.data);
            }
        };
        wsRef.current.onclose = () => {
            addLog("WS", "Disconnected from log stream. Attempting reconnect in 5s...");
            setTimeout(connectWebSocket, 5000);
        };
        wsRef.current.onerror = (err) => {
            addLog("WS_ERROR", "WebSocket error occurred.");
            console.error("WebSocket error:", err);
        };
    };

    const addLog = (type, message) => {
        const timestamp = new Date().toLocaleTimeString();
        const logLine = `[${timestamp}][${type}] ${message}`;
        setLogs(prev => [logLine, ...prev]);
    };

    const handleScan = async () => {
        setIsScanning(true);
        try {
            const res = await fetch(`${baseUrl}/devices`);
            if (!res.ok) throw new Error(`HTTP error! Status: ${res.status}`);

            const data = await res.json();
            if (data.devices && data.devices.length > 0) {
                setDevices(data.devices);
                addLog("INFO", `Scan complete. Found ${data.devices.length} devices.`);
            } else {
                setDevices([]);
                addLog("INFO", `Scan complete, but no devices found. ${data.error || ''}`);
            }
        } catch (error) {
            addLog("ERROR", 'Scan failed: ' + error.message);
        } finally {
            setIsScanning(false);
        }
    };

    const handleStartTest = async () => {
        if (!selectedDevice) {
            addLog("WARNING", "Please select a device first.");
            return;
        }

        if (!config.use_collection && !manualCommands.trim()) {
            addLog("WARNING", "Manual commands input cannot be empty when 'Use Command Collection' is unchecked.");
            return;
        }

        setTestStatus('running');
        setLogs([]); // Clear logs on new run
        addLog("INFO", `Starting BLE test on ${selectedDevice}... Mode: ${config.use_collection ? 'Collection' : 'Manual'}`);

        const payload = {
            device_mac: selectedDevice,
            write_uuid: config.write_uuid,
            notify_uuid: config.notify_uuid,
            chunk_length: Number(config.chunk_length),
            max_retries: Number(config.max_retries),
            ble_timeout_interval: Number(config.ble_timeout),
            test_by_collection: config.use_collection,
            manual_commands_input: manualCommands
        };

        try {
            const res = await fetch(`${baseUrl}/start-test`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            if (!res.ok) {
                const errorText = await res.text();
                throw new Error(`HTTP error! Status: ${res.status}. Response: ${errorText}`);
            }

            // const data = await res.json(); // Unused
            addLog("HTTP_RESPONSE", "Test initiated successfully on the server.");
        } catch (error) {
            console.error('Test error:', error);
            addLog("FATAL_ERROR", `Test execution failed: ${error.message}`);
            setTestStatus('idle');
        }
    };

    const handleBack = async () => {
        try {
            await fetch(`${baseUrl}/stop-test`, { method: "POST" });
        } catch (e) {
            console.error("Failed to stop test:", e);
        }
        if (wsRef.current) {
            wsRef.current.onclose = null;
            wsRef.current.close();
        }
        window.location.href = '/';
    };

    return (
        <div className="app-shell">
            <header className="page-header">
                <h1>BLE Test Automation</h1>
                <button className="ghost" onClick={handleBack} style={{
                    padding: '8px 16px',
                }}>
                    ⬅ Back To Main
                </button>
            </header>

            <main className="grid">
                {/* Device Selection Card */}
                <section className="card">
                    <header>
                        <h2>Device Connection</h2>
                        <span className={`pill ${selectedDevice ? 'pill--success' : 'pill--warning'}`}>
                            {selectedDevice ? 'Selected' : 'No Device selected'}
                        </span>
                    </header>
                    <div className="field">
                        <span>Target Device</span>
                        <select
                            value={selectedDevice}
                            onChange={(e) => setSelectedDevice(e.target.value)}
                            disabled={testStatus === 'running'}
                        >
                            <option value="">-- Select device --</option>
                            {devices.map(dev => (
                                <option key={dev.address} value={dev.address}>
                                    {dev.name || 'Unknown'} ({dev.address})
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="button-row">
                        <button
                            className="primary"
                            onClick={handleScan}
                            disabled={isScanning || testStatus === 'running'}
                        >
                            {isScanning ? 'Scanning...' : 'Scan Devices'}
                        </button>
                    </div>
                </section>

                {/* Configuration Card */}
                <section className="card">
                    <header>
                        <h2>Test Configuration</h2>
                    </header>
                    <div className="field-grid-row">
                        <div className="field">
                            <span>Write UUID</span>
                            <input
                                type="text"
                                value={config.write_uuid}
                                onChange={(e) => setConfig({ ...config, write_uuid: e.target.value })}
                            />
                        </div>
                        <div className="field">
                            <span>Notify UUID</span>
                            <input
                                type="text"
                                value={config.notify_uuid}
                                onChange={(e) => setConfig({ ...config, notify_uuid: e.target.value })}
                            />
                        </div>
                    </div>
                    <div className="field-grid-row">
                        <div className="field">
                            <span>Chunk Length</span>
                            <input
                                type="number"
                                value={config.chunk_length}
                                onChange={(e) => setConfig({ ...config, chunk_length: e.target.value })}
                                min="1"
                            />
                        </div>
                        <div className="field">
                            <span>Retries</span>
                            <input
                                type="number"
                                value={config.max_retries}
                                onChange={(e) => setConfig({ ...config, max_retries: e.target.value })}
                                min="1"
                            />
                        </div>
                    </div>
                    <div className="field">
                        <span>Timeout (s)</span>
                        <input
                            type="number"
                            value={config.ble_timeout}
                            onChange={(e) => setConfig({ ...config, ble_timeout: e.target.value })}
                            min="1"
                        />
                    </div>
                    <div className="field">
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: 'var(--text)' }}>
                            <input
                                type="checkbox"
                                checked={config.use_collection}
                                onChange={(e) => setConfig({ ...config, use_collection: e.target.checked })}
                                style={{ width: 'auto' }}
                            />
                            Use Command Collection (Generate combinations)
                        </label>
                    </div>
                </section>

                {/* Command Input Card (Conditional) */}
                {!config.use_collection && (
                    <section className="card" style={{ gridColumn: '1 / -1' }}>
                        <header>
                            <h2>Manual Commands</h2>
                        </header>
                        <div className="field">
                            <span>Enter Commands (One per line)</span>
                            <textarea
                                rows="6"
                                value={manualCommands}
                                onChange={(e) => setManualCommands(e.target.value)}
                                placeholder="GET,STATUS&#10;SET,BRIGHTNESS,100"
                                style={{ fontFamily: 'var(--mono)' }}
                            ></textarea>
                        </div>
                    </section>
                )}

                {/* Actions & Logs */}
                <section className="card" style={{ gridColumn: '1 / -1' }}>
                    <header>
                        <h2>Execution Control</h2>
                    </header>
                    <div className="button-row">
                        <button
                            className="primary"
                            onClick={handleStartTest}
                            disabled={testStatus === 'running' || !selectedDevice}
                            style={{ width: '100%', padding: '16px', fontSize: '1.2rem' }}
                        >
                            {testStatus === 'running' ? 'Running Test...' : '🚀 Start Test'}
                        </button>
                    </div>
                </section>

                <section className="card" style={{ gridColumn: '1 / -1' }}>
                    <header>
                        <h2>Real-Time Log</h2>
                        <button type="button" className="ghost" onClick={() => setLogs([])}>
                            Clear Log
                        </button>
                    </header>
                    <ul className="log-list" style={{ maxHeight: '400px' }}>
                        {logs.map((log, index) => (
                            <li key={index} className="log-entry" style={{ fontFamily: 'var(--mono)', fontSize: '0.8rem' }}>
                                {log}
                            </li>
                        ))}
                    </ul>
                </section>
            </main>
        </div>
    );
};

export default BLETestControl;
