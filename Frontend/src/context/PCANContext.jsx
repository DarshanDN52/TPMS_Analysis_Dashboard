import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { pcanApi } from '../services/api';

const PCANContext = createContext(null);

export function PCANProvider({ children }) {
    const [isConnected, setIsConnected] = useState(false);
    const [messages, setMessages] = useState([]); // Recent messages for Console
    const [latestTireData, setLatestTireData] = useState({}); // Latest state for Dashboard
    // Global History for Graphs (Persists across navigation)
    const [globalHistory, setGlobalHistory] = useState({ pressure: {}, temperature: {}, battery: {} });
    // Packet Statistics: { [tireIndex]: { total: 0, types: { [type]: count } } }
    const [packetStats, setPacketStats] = useState({});

    // Session Start Time
    const [startTime, setStartTime] = useState(new Date());

    // Filtering Configuration
    const [baseId, setBaseId] = useState(1280); // Default 0x500 (1280 dec)

    // The master buffer for "Save Data" functionality.
    // We use a Ref because this can grow large and we don't want to trigger re-renders 
    // every time a message is added just for the "save" button's sake.
    const rawMessageBufferRef = useRef([]);

    const pollTimerRef = useRef(null);

    // Helper to process packet for TPMS (Ported from TPMSDashboard logic)
    const processTPMSPacket = (msg) => {
        // 1. Basic Validation
        if (!msg || typeof msg === 'string') return;

        // 2. Parse Data
        let bytes;
        if (Array.isArray(msg.data)) {
            bytes = msg.data;
        } else if (typeof msg.data === 'string') {
            // Fallback for space-separated hex string if ever needed
            bytes = msg.data.split(' ').map(h => parseInt(h, 16));
        }

        if (!bytes || bytes.length < 7) return;

        // 3. Extract Fields
        const sensorId = bytes[0] & 0xFF; // 0-based sensor ID
        const tireIndex = sensorId + 1;   // 1-based tire index
        const packetType = bytes[1] & 0xFF;

        // 4. Decode Values
        let pressure, temperature, battery;

        // If packet contains data (Type 1, 16, 17)
        if (packetType === 0x01 || packetType === 0x10 || packetType === 0x11) {
            pressure = ((bytes[2] << 8) | bytes[3]) & 0xFFFF;
            const tempRaw = ((bytes[5] << 8) | bytes[4]) & 0xFFFF;
            temperature = (tempRaw - 8500) / 100;
            battery = ((bytes[6] * 10) + 2000) / 1000;
        } else {
            // Non-data packet (keep existing or return)
            // For the Context "Latest State", we only mistakenly update if we have new data.
            // If it's a "warning" packet without data, we might updates status but keep old values.
            // For simplicity in this centralized version, we only update if we have data or if we want to update status.
            // Let's return only if we have data to update "latestTireData"
            // But wait, the dashboard logic used "existing" values.
            // Here we can't easily access "previous" state inside this loop without complexity.
            // Strategy: We will just emit the partial update, and let the state setter merge it.
            return {
                tireIndex,
                packetType,
                timestamp: msg.timestamp
            };
        }

        // 5. Determine Status/Severity
        const severity = (pt => {
            if (pt === 0x01) return 'ok';
            if (pt === 0x02) return 'info';
            if (pt === 0x03) return 'missing'; // This is usually a 'no signal' type
            if (pt === 0x04 || pt === 0x05) return 'warning';
            if (pt >= 0x06 && pt <= 0x09) return 'reserved';
            if (pt === 0x10) return 'low';
            if (pt === 0x11) return 'critical';
            return 'ok';
        })(packetType);

        return {
            tireIndex,
            pressure,
            temperature,
            battery,
            status: severity,
            lastUpdate: new Date() // Use current time or msg time
        };
    };

    const fetchData = async () => {
        try {
            // 1. Check Connection Status (cheap call? No, usually we assume connected if we started polling)
            // Actually `read()` fails if not initialized.

            const res = await pcanApi.read();

            // Handle Batch
            let specificMessages = [];
            const batch = res?.payload?.data?.messages || [];
            const single = res?.payload?.data?.message;

            if (batch.length > 0) {
                specificMessages = batch;
            } else if (single && typeof single !== 'string') {
                specificMessages = [single];
            }

            if (specificMessages.length > 0) {
                // A. Buffer for Saving
                rawMessageBufferRef.current.push(...specificMessages);

                // B. Update Console State (Keep last 200)
                setMessages(prev => {
                    // Creating new objects for console display format
                    const formatted = specificMessages.map(m => {
                        const dataStr = Array.isArray(m.data)
                            ? m.data.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ')
                            : '';
                        return {
                            id: m.id,
                            len: m.len,
                            data: dataStr,
                            msg_type: m.msg_type,
                            timestamp: new Date().toISOString()
                        };
                    });
                    const combined = [...formatted, ...prev];
                    return combined.slice(0, 200);
                });

                // C. Update TPMS State
                setLatestTireData(prev => {
                    const next = { ...prev };
                    specificMessages.forEach(msg => {
                        // FILTER: Only process IDs matching BaseID + 0x02
                        // IDs are hex strings in 'msg.id'. baseId is decimal number.
                        const msgIdDec = parseInt(msg.id, 16);
                        if (msgIdDec !== baseId + 0x02) return;

                        const update = processTPMSPacket(msg);
                        if (update && update.tireIndex) {
                            const idx = update.tireIndex;
                            const existing = next[idx] || {};

                            // Merge logic
                            next[idx] = {
                                ...existing,
                                id: idx, // Ensure ID is set
                                ...update,
                                // If update didn't have pressure (e.g. warning packet), keep existing
                                pressure: update.pressure !== undefined ? update.pressure : existing.pressure || 0,
                                temperature: update.temperature !== undefined ? update.temperature : existing.temperature || 0,
                                battery: update.battery !== undefined ? update.battery : existing.battery || 0,
                            };
                        }
                    });
                    return next;
                });
                // D. Update Global History
                setGlobalHistory(prevHist => {
                    const nextHist = { ...prevHist };
                    const MAX_HISTORY = 50;

                    specificMessages.forEach(msg => {
                        // FILTER: Only process IDs matching BaseID + 0x02
                        const msgIdDec = parseInt(msg.id, 16);
                        if (msgIdDec !== baseId + 0x02) return;

                        const update = processTPMSPacket(msg);
                        if (update && update.tireIndex && update.pressure !== undefined) {
                            // Only push if we have valid sensor data (Type 1, 16, 17)
                            // processTPMSPacket returns pressure/temp/batt for these types.
                            // For warning packets, it might return undefined for values.

                            const idx = update.tireIndex;
                            const timeLabel = new Date(update.lastUpdate).toLocaleTimeString();

                            ['pressure', 'temperature', 'battery'].forEach(metric => {
                                if (update[metric] !== undefined) {
                                    if (!nextHist[metric][idx]) nextHist[metric][idx] = [];
                                    nextHist[metric][idx] = [...nextHist[metric][idx], { x: timeLabel, y: update[metric] }].slice(-MAX_HISTORY);
                                }
                            });
                        }
                    });
                    return nextHist;
                });
                // E. Update Packet Stats
                setPacketStats(prev => {
                    const next = { ...prev };
                    specificMessages.forEach(msg => {
                        // FILTER: Only process IDs matching BaseID + 0x02
                        const msgIdDec = parseInt(msg.id, 16);
                        if (msgIdDec !== baseId + 0x02) return;

                        // We need bytes to get sensor ID / tire index
                        let bytes;
                        if (Array.isArray(msg.data)) bytes = msg.data;
                        else if (typeof msg.data === 'string') bytes = msg.data.split(' ').map(h => parseInt(h, 16));

                        if (!bytes || bytes.length < 2) return;

                        const sensorId = bytes[0] & 0xFF;
                        const tireIndex = sensorId + 1;
                        const packetType = bytes[1] & 0xFF; // Keep as number (0x01, 0x02 etc)

                        // Deep copy: Create new object for this tire if we modify it
                        if (next[tireIndex]) {
                            next[tireIndex] = { ...next[tireIndex], types: { ...next[tireIndex].types } };
                        } else {
                            next[tireIndex] = { total: 0, types: {} };
                        }

                        next[tireIndex].total = (next[tireIndex].total || 0) + 1;
                        next[tireIndex].types[packetType] = (next[tireIndex].types[packetType] || 0) + 1;
                    });
                    return next;
                });
            }

        } catch (e) {
            // If error (e.g. PCAN not init), maybe stop polling?
            // For now, retry is fine.
        }
    };

    // Start polling when connected
    useEffect(() => {
        if (isConnected) {
            pollTimerRef.current = setInterval(fetchData, 100);
        } else {
            if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        }
        return () => {
            if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        };
    }, [isConnected]);

    // Initial check (optional, or let pages handle "Connect" button)
    useEffect(() => {
        // Check if already connected on mount (page refresh)
        pcanApi.getStatus().then(res => {
            if (res.status_code === '00000h') {
                setIsConnected(true);
            }
        }).catch(() => { });
    }, []);

    // Auto-Save Statistics
    const triggerAutoSaveStats = useCallback(async () => {
        // Only save if we have stats
        if (Object.keys(packetStats).length === 0) return;

        const payload = {
            startTime: startTime.toISOString(),
            endTime: new Date().toISOString(),
            stats: packetStats
        };

        await pcanApi.saveIdentifierStats(payload);
    }, [packetStats, startTime]);





    // Track last saved index for each filename to support independent saving
    const saveCursorsRef = useRef({});

    const clearData = () => {
        // Save before clearing

        setMessages([]);
        rawMessageBufferRef.current = [];
        saveCursorsRef.current = {}; // Reset cursors
        setLatestTireData({});
        setGlobalHistory({ pressure: {}, temperature: {}, battery: {} });
        setPacketStats({});
        setStartTime(new Date());
    };

    const saveBuffer = async (targetFilename = 'data.json', options = {}) => {
        const fullBuffer = rawMessageBufferRef.current;
        const totalLength = fullBuffer.length;

        // Determine start index for this specific file
        const startIdx = saveCursorsRef.current[targetFilename] || 0;

        if (startIdx >= totalLength) {
            throw new Error("No new data to save");
        }

        // Get only new messages
        let newMessages = fullBuffer.slice(startIdx);

        // Filter if required
        if (options.requiredId) {
            newMessages = newMessages.filter(msg => {
                const msgId = parseInt(msg.id, 16);
                return msgId === options.requiredId;
            });
        }

        let res;
        if (newMessages.length > 0) {
            res = await pcanApi.saveData(newMessages, targetFilename);
        } else {
            // Fake success if filtering removed all messages
            res = { payload: { result: { status: 'ok', message: 'No matching data to save' } } };
        }

        // Update cursor on success
        if (res?.payload?.result?.status === 'ok') {
            saveCursorsRef.current[targetFilename] = totalLength;
        }
        return res;
    };

    const value = {
        isConnected,
        setIsConnected,
        messages,
        latestTireData,
        globalHistory,
        packetStats,
        startTime,
        baseId,
        setBaseId,
        rawMessageBufferRef,
        clearData,
        saveBuffer
    };

    return (
        <PCANContext.Provider value={value}>
            {children}
        </PCANContext.Provider>
    );
}

export function usePCAN() {
    return useContext(PCANContext);
}
