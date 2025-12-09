import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Chart from 'chart.js/auto';
import ChartZoom from 'chartjs-plugin-zoom';
import { pcanApi } from '../services/api';

Chart.register(ChartZoom);

const MAX_HISTORY_POINTS = 50;

function TPMSDashboard() {
  const navigate = useNavigate();
  const mainChartRef = useRef(null);
  const mainChartInstanceRef = useRef(null);
  const detailChartRef = useRef(null);
  const detailChartInstanceRef = useRef(null);

  const [config, setConfig] = useState(() => {
    try {
      const saved = sessionStorage.getItem('tpmsConfig');
      if (saved) return JSON.parse(saved);
    } catch { }
    return { totalTires: 6, axleConfig: [2, 4], configStr: '2,4' };
  });
  const [tireData, setTireData] = useState({});
  const [view, setView] = useState('top-view');
  const [selectedMetric, setSelectedMetric] = useState('pressure');
  const [selectedTire, setSelectedTire] = useState(null);
  const [detailView, setDetailView] = useState('pressure');
  const [dataHistory, setDataHistory] = useState({ pressure: {}, temperature: {}, battery: {} });
  const [isCollecting, setIsCollecting] = useState(false);

  // New state for graph filtering
  const [visibleTires, setVisibleTires] = useState([]);
  const [isTireDropdownOpen, setIsTireDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsTireDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const getTirePositionName = useCallback((tireNum, axleConfig) => {
    let currentTire = 0;
    for (let axleIndex = 0; axleIndex < axleConfig.length; axleIndex++) {
      const tiresOnAxle = axleConfig[axleIndex];
      for (let i = 0; i < tiresOnAxle; i++) {
        currentTire++;
        if (currentTire === tireNum) {
          const axleName = axleIndex === 0 ? 'Front' : axleIndex === axleConfig.length - 1 ? 'Rear' : `Axle ${axleIndex + 1}`;
          const side = i < tiresOnAxle / 2 ? 'Left' : 'Right';
          const position = tiresOnAxle > 2 ? (i % (tiresOnAxle / 2) === 0 ? ' Outer' : ' Inner') : '';
          return `${axleName} ${side}${position}`;
        }
      }
    }
    return `Tire ${tireNum}`;
  }, []);

  const calculateStatus = useCallback((tire) => {
    if (tire.pressure < 20 || tire.pressure > 120 || tire.temperature > 80 || tire.battery < 2.5) {
      return 'critical';
    } else if (tire.pressure < 30 || tire.pressure > 100 || tire.temperature > 60 || tire.battery < 3) {
      return 'warning';
    }
    return 'normal';
  }, []);

  const generateColors = useCallback((count) => {
    const colors = [];
    const hueStep = 360 / Math.max(count, 1);
    for (let i = 0; i < count; i++) {
      const hue = (i * hueStep) % 360;
      const saturation = 70 + (i % 3) * 10;
      const lightness = 45 + (i % 2) * 10;
      colors.push(`hsl(${hue}, ${saturation}%, ${lightness}%)`);
    }
    return colors;
  }, []);

  useEffect(() => {
    const parsed = config;
    const initialTires = {};
    let initialHistory = { pressure: {}, temperature: {}, battery: {} };

    const savedHistoryStr = sessionStorage.getItem('tpmsHistory');
    if (savedHistoryStr) {
      try {
        const savedHistory = JSON.parse(savedHistoryStr);
        if (savedHistory && savedHistory.pressure && savedHistory.temperature && savedHistory.battery) {
          initialHistory = savedHistory;
        }
      } catch (err) { void err; }
    }

    // Restore tire data if available
    const savedTireDataStr = sessionStorage.getItem('tpmsTireData');
    let savedTireData = null;
    if (savedTireDataStr) {
      try {
        savedTireData = JSON.parse(savedTireDataStr);
      } catch (err) { void err; }
    }

    // Reconstruct tires, merging with saved data if it matches the current config
    for (let i = 1; i <= parsed.totalTires; i++) {
      const existingInfo = savedTireData && savedTireData[i] ? savedTireData[i] : {};
      // Note: We reconstruct 'id' and 'position' to ensure they match current config,
      // but preserve sensor values (pressure etc) if they were saved.
      // We do *not* check if 'existingInfo' belongs to the same config layout strictly,
      // but 'totalTires' check above guards slightly. ideally we should version check too.

      initialTires[i] = {
        id: i,
        position: getTirePositionName(i, parsed.axleConfig),
        pressure: existingInfo.pressure || 0,
        temperature: existingInfo.temperature || 0,
        battery: existingInfo.battery || 0,
        status: existingInfo.status || 'missing',
        lastUpdate: existingInfo.lastUpdate ? new Date(existingInfo.lastUpdate) : new Date(),
      };
      initialHistory.pressure[i] = initialHistory.pressure[i] || [];
      initialHistory.temperature[i] = initialHistory.temperature[i] || [];
      initialHistory.battery[i] = initialHistory.battery[i] || [];
    }
    setTireData(initialTires);
    setDataHistory(initialHistory);

    // Initialize visible tires to all tires
    const allTireIds = [];
    for (let i = 1; i <= parsed.totalTires; i++) {
      allTireIds.push(i);
    }
    setVisibleTires(allTireIds);

    setIsCollecting(true);
  }, [getTirePositionName, config]);

  useEffect(() => {
    if (!isCollecting || !config) return;

    let intervalId;

    const fetchData = async () => {
      try {
        const res = await pcanApi.read();
        // console.log('TPMS Read:', res); // Debug log
        const msg = res?.payload?.data?.message;
        if (!msg || typeof msg === 'string') return;
        const watchId = (config?.watchId || '').trim().toUpperCase();
        if (watchId && msg.id !== watchId) return;

        const now = new Date();
        const timeLabel = now.toLocaleTimeString();
        const bytes = Array.isArray(msg.data) ? msg.data : [];
        if (bytes.length < 7) return;

        const sensorId = bytes[0] & 0xFF;
        const tireIndex = sensorId + 1;
        if (tireIndex < 1 || !config?.totalTires || tireIndex > config.totalTires) return;

        const packetType = bytes[1] & 0xFF;
        const pressure = ((bytes[2] << 8) | bytes[3]) & 0xFFFF;
        const tempRaw = ((bytes[5] << 8) | bytes[4]) & 0xFFFF;
        const temperature = (tempRaw - 8500) / 100;
        const battery = ((bytes[6] * 10) + 2000) / 1000;

        const severity = (pt => {
          if (pt === 0x01) return 'ok';
          if (pt === 0x02) return 'info';
          if (pt === 0x03) return 'missing';
          if (pt === 0x04 || pt === 0x05) return 'warning';
          if (pt >= 0x06 && pt <= 0x09) return 'reserved';
          if (pt === 0x10) return 'low';
          if (pt === 0x11) return 'critical';
          return 'ok';
        })(packetType);

        setTireData(prevTireData => {
          const updatedTireData = { ...prevTireData };
          if (updatedTireData[tireIndex]) {
            updatedTireData[tireIndex] = {
              ...updatedTireData[tireIndex],
              pressure,
              temperature,
              battery,
              lastUpdate: now,
              status: severity,
            };
          }
          try { sessionStorage.setItem('tpmsTireData', JSON.stringify(updatedTireData)); } catch (err) { void err; }
          return updatedTireData;
        });

        setDataHistory(prevHistory => {
          const newHistory = { ...prevHistory };
          ['pressure', 'temperature', 'battery'].forEach(metric => {
            const value = metric === 'pressure' ? pressure : metric === 'temperature' ? temperature : battery;
            if (!newHistory[metric][tireIndex]) newHistory[metric][tireIndex] = [];
            newHistory[metric][tireIndex] = [...newHistory[metric][tireIndex], { x: timeLabel, y: value }];
            if (newHistory[metric][tireIndex].length > MAX_HISTORY_POINTS) {
              newHistory[metric][tireIndex] = newHistory[metric][tireIndex].slice(-MAX_HISTORY_POINTS);
            }
          });
          try { sessionStorage.setItem('tpmsHistory', JSON.stringify(newHistory)); } catch (err) { void err; }
          return newHistory;
        });
      } catch (e) { void e; }
    };

    const startFetching = async () => {
      intervalId = setInterval(fetchData, 100);
    };

    startFetching();

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [isCollecting, config, calculateStatus]);

  useEffect(() => {
    if (!mainChartRef.current || !config || Object.keys(dataHistory.pressure).length === 0) return;

    const ctx = mainChartRef.current.getContext('2d');
    if (mainChartInstanceRef.current) {
      mainChartInstanceRef.current.destroy();
    }

    const colors = generateColors(config.totalTires);
    const datasets = [];
    let allLabels = new Set();

    for (let i = 1; i <= config.totalTires; i++) {
      const history = dataHistory[selectedMetric][i] || [];
      history.forEach(h => allLabels.add(h.x));
    }

    const sortedLabels = Array.from(allLabels).sort();

    for (let i = 1; i <= config.totalTires; i++) {
      // Filter based on visibility
      if (!visibleTires.includes(i)) continue;

      const history = dataHistory[selectedMetric][i] || [];
      const dataMap = new Map(history.map(h => [h.x, h.y]));
      const data = sortedLabels.map(label => dataMap.get(label) || null);

      datasets.push({
        label: `Tire ${i} (${getTirePositionName(i, config.axleConfig)})`,
        data: data,
        borderColor: colors[i - 1],
        backgroundColor: colors[i - 1] + '40',
        tension: 0.4,
        fill: false,
        pointRadius: 3,
        pointHoverRadius: 5,
        borderWidth: 2,
      });
    }

    const titles = {
      pressure: 'Pressure (PSI)',
      temperature: 'Temperature (°C)',
      battery: 'Battery Level (W)',
    };

    mainChartInstanceRef.current = new Chart(ctx, {
      type: 'line',
      data: { labels: sortedLabels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        spanGaps: true, // Connect dots even if data is missing
        plugins: {
          title: { display: true, text: `TPMS ${titles[selectedMetric]} Over Time`, font: { size: 18, weight: 'bold' }, color: '#f2f5ff' },
          legend: { display: false }, // Hide default legend as requested
          tooltip: { mode: 'index', intersect: false, backgroundColor: 'rgba(0, 0, 0, 0.8)', padding: 12, titleColor: '#f2f5ff', bodyColor: '#f2f5ff' },
          zoom: {
            wheel: { enabled: true, speed: 0.1 },
            pinch: { enabled: true },
            mode: 'x',
          },
        },
        scales: {
          x: { title: { display: true, text: 'Time', font: { size: 14, weight: 'bold' }, color: '#9ba3c7' }, grid: { color: 'rgba(31, 34, 53, 0.3)' }, ticks: { color: '#9ba3c7' } },
          y: { title: { display: true, text: titles[selectedMetric], font: { size: 14, weight: 'bold' }, color: '#9ba3c7' }, grid: { color: 'rgba(31, 34, 53, 0.3)' }, ticks: { color: '#9ba3c7' }, beginAtZero: false },
        },
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
      },
    });

    return () => {
      if (mainChartInstanceRef.current) {
        mainChartInstanceRef.current.destroy();
      }
    };
  }, [dataHistory, selectedMetric, config, generateColors, getTirePositionName, visibleTires]);

  const toggleTireVisibility = (tireId) => {
    setVisibleTires(prev => {
      if (prev.includes(tireId)) {
        return prev.filter(id => id !== tireId);
      } else {
        return [...prev, tireId].sort((a, b) => a - b);
      }
    });
  };

  const toggleAllTires = () => {
    if (!config) return;
    if (visibleTires.length === config.totalTires) {
      setVisibleTires([]);
    } else {
      const all = [];
      for (let i = 1; i <= config.totalTires; i++) all.push(i);
      setVisibleTires(all);
    }
  };

  useEffect(() => {
    if (selectedTire === null || !detailChartRef.current || !dataHistory.pressure[selectedTire]) return;

    const ctx = detailChartRef.current.getContext('2d');
    if (detailChartInstanceRef.current) {
      detailChartInstanceRef.current.destroy();
    }

    const pressureHistory = dataHistory.pressure[selectedTire] || [];
    const tempHistory = dataHistory.temperature[selectedTire] || [];
    const batteryHistory = dataHistory.battery[selectedTire] || [];

    const allLabels = new Set();
    pressureHistory.forEach(h => allLabels.add(h.x));
    tempHistory.forEach(h => allLabels.add(h.x));
    batteryHistory.forEach(h => allLabels.add(h.x));

    const sortedLabels = Array.from(allLabels).sort();

    const pressureMap = new Map(pressureHistory.map(h => [h.x, h.y]));
    const tempMap = new Map(tempHistory.map(h => [h.x, h.y]));
    const batteryMap = new Map(batteryHistory.map(h => [h.x, h.y]));

    const pressureData = sortedLabels.map(label => pressureMap.get(label) || null);
    const tempData = sortedLabels.map(label => tempMap.get(label) || null);
    const batteryData = sortedLabels.map(label => batteryMap.get(label) || null);

    const datasets = [
      { label: 'Pressure (PSI)', data: pressureData, borderColor: '#29d98c', backgroundColor: 'rgba(41, 217, 140, 0.1)', tension: 0.4, fill: true, pointRadius: 3, pointHoverRadius: 5, borderWidth: 2, hidden: detailView !== 'pressure' },
      { label: 'Temperature (°C)', data: tempData, borderColor: '#ff9800', backgroundColor: 'rgba(255, 152, 0, 0.1)', tension: 0.4, fill: true, pointRadius: 3, pointHoverRadius: 5, borderWidth: 2, hidden: detailView !== 'temperature' },
      { label: 'Battery (W)', data: batteryData, borderColor: '#5cc8ff', backgroundColor: 'rgba(92, 200, 255, 0.1)', tension: 0.4, fill: true, pointRadius: 3, pointHoverRadius: 5, borderWidth: 2, hidden: detailView !== 'battery' },
    ];

    const yAxisLabel = { pressure: 'Pressure (PSI)', temperature: 'Temperature (°C)', battery: 'Battery (W)' };

    detailChartInstanceRef.current = new Chart(ctx, {
      type: 'line',
      data: { labels: sortedLabels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          title: { display: true, text: 'Live Tire Data', font: { size: 18, weight: 'bold' }, color: '#f2f5ff' },
          legend: { display: false },
          tooltip: { mode: 'index', intersect: false, backgroundColor: 'rgba(0, 0, 0, 0.8)', padding: 12 },
          zoom: {
            wheel: { enabled: true, speed: 0.1 },
            pinch: { enabled: true },
            mode: 'x',
          },
        },
        scales: {
          x: { title: { display: true, text: 'Time', font: { size: 14, weight: 'bold' }, color: '#9ba3c7' }, grid: { color: 'rgba(31, 34, 53, 0.3)' }, ticks: { color: '#9ba3c7' } },
          y: { title: { display: true, text: yAxisLabel[detailView], font: { size: 14, weight: 'bold' }, color: '#9ba3c7' }, grid: { color: 'rgba(31, 34, 53, 0.3)' }, ticks: { color: '#9ba3c7' }, beginAtZero: false },
        },
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
      },
    });

    return () => {
      if (detailChartInstanceRef.current) {
        detailChartInstanceRef.current.destroy();
      }
    };
  }, [selectedTire, dataHistory, detailView]);

  const calculateLayout = useCallback(() => {
    if (!config) return { positions: [], truckStyle: {}, cabStyle: {}, trailerStyle: {} };

    const numAxles = config.axleConfig.length;
    const axleSpacing = 18; // Fixed spacing for consistency
    const cabWidth = 20; // Width of cab in %
    const frontOverhang = 4;
    const rearOverhang = 8;

    // Calculate total detailed width required
    const axleSpan = (numAxles - 1) * axleSpacing;
    const totalContentWidth = frontOverhang + cabWidth + axleSpan + rearOverhang;

    // Clamp width to reasonably fill screen but not overflow (max 95%)
    // If it's too wide, we scale down the spacing logic implicitly by reducing width
    const maxWidth = 95;
    const finalWidth = Math.min(maxWidth, Math.max(50, totalContentWidth));

    // Centering
    const leftPos = (100 - finalWidth) / 2;

    // Scaling factor if we had to shrink
    const scale = finalWidth / totalContentWidth;

    const positions = [];
    const effectiveAxleSpacing = axleSpacing * scale;
    const effectiveCabWidth = cabWidth * scale;
    const effectiveRearOverhang = rearOverhang * scale;

    // Truck Body Styles
    const truckStyle = {
      width: `${finalWidth}%`,
      left: '50%',
      transform: 'translateX(-50%)'
    };

    // Cab and Trailer split
    // Cab is effectiveCabWidth percent of the VIEWPORT.
    // But inside truckStyle (which is finalWidth wide), cab is (effectiveCabWidth / finalWidth) * 100 %
    const cabPercent = (effectiveCabWidth / finalWidth) * 100;

    const cabStyle = { width: `${cabPercent}%` };
    const trailerStyle = { width: `${100 - cabPercent}%` };

    // Tire dimensions for calculation (must match render loop)
    const tireHeightPx = 40; // Fixed height matching render loop
    const containerHeight = 400;
    const tireHeightPercent = (tireHeightPx / containerHeight) * 100;


    const verticalGap = 37; // Fixed gap between top and bottom tire sets
    const centerLine = 55.5; // Fixed vertical center line

    for (let i = 0; i < numAxles; i++) {
      let axleX;

      if (i === 0) {
        // Front axle: Positioned near the cab center
        axleX = leftPos + (effectiveCabWidth * 0.5);
      } else {
        // Rear axles: Positioned from the right end of the trailer
        // The last axle is at the right end minus overhang
        const rightEnd = leftPos + finalWidth - effectiveRearOverhang;
        // Calculate offset from the last axle
        const stepsFromEnd = (numAxles - 1) - i;
        axleX = rightEnd - (stepsFromEnd * effectiveAxleSpacing);
      }

      const numTiresOnAxle = config.axleConfig[i];
      const tiresPerSide = numTiresOnAxle / 2;
      const tireSpacing = 10.5; // Reduced from 11 for tighter dual tire spacing

      for (let j = 0; j < tiresPerSide; j++) {
        // j=0 is outer, j=1 is inner (closer to chassis)
        // We position relative to the gap.

        // Distance from the inner-most position
        const dist = (tiresPerSide - 1 - j) * tireSpacing;

        // Top Side: Inner edge at (center - gap/2)
        // Top position = (center - gap/2 - tireHeight) - dist
        const yTop = (centerLine - (verticalGap / 2) - tireHeightPercent) - dist;

        // Bottom Side: Inner edge at (center + gap/2)
        // Top position = (center + gap/2) + dist
        const yBottom = (centerLine + (verticalGap / 2)) + dist;

        positions.push({ x: axleX, y: yTop });
        positions.push({ x: axleX, y: yBottom });
      }
    }

    return { positions, truckStyle, cabStyle, trailerStyle };
  }, [config]);

  const handleZoom = useCallback((chartRef, direction) => {
    const chart = chartRef.current;
    if (!chart) return;
    const factor = direction === 'in' ? 1.2 : 0.8;
    chart.zoom(factor, 'none');
  }, []);

  const handleZoomReset = useCallback((chartRef) => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.resetZoom('none');
  }, []);

  const cycleDetailView = useCallback((direction) => {
    const views = ['pressure', 'temperature', 'battery'];
    const currentIndex = views.indexOf(detailView);
    const newIndex = direction === 'next'
      ? (currentIndex + 1) % views.length
      : (currentIndex - 1 + views.length) % views.length;
    setDetailView(views[newIndex]);
  }, [detailView]);



  const { positions, truckStyle, cabStyle, trailerStyle } = calculateLayout();

  return (
    <div className="tpms-page">
      <style>{globalStyles}</style>
      <div className="tpms-container">
        <header className="tpms-header">
          <h1>TPMS Dashboard</h1>
          <div className="header-controls">
            <button className="btn-secondary" onClick={() => navigate('/')}>Back to Main</button>
          </div>
        </header>

        <div className="truck-view-section">
          <div className="view-selector-header">
            <div className="view-toggle">
              <button className={`view-btn ${view === 'top-view' ? 'active' : ''}`} onClick={() => setView('top-view')}>Top View</button>
              <button className={`view-btn ${view === 'data-view' ? 'active' : ''}`} onClick={() => setView('data-view')}>Data View</button>
            </div>
          </div>

          {view === 'top-view' ? (
            <div className="truck-container-wrapper">
              <div className="truck-2d-view">
                <div className="truck-body-container" style={truckStyle}>
                  <div className="truck-body">
                    <div className="truck-cab" style={cabStyle}></div>
                    <div className="truck-trailer" style={trailerStyle}></div>
                  </div>
                </div>
                {positions.map((pos, idx) => {
                  const tireNum = idx + 1;
                  const tire = tireData[tireNum];
                  const status = tire?.status || 'normal';
                  const numAxles = config.axleConfig.length;
                  // Use consistent tire dimensions regardless of axle count
                  const tireWidth = '80px';
                  const tireHeight = '40px';
                  const fontSize = '0.9rem';

                  return (
                    <div
                      key={tireNum}
                      className={`tire ${status}`}
                      onClick={() => setSelectedTire(tireNum)}
                      style={{
                        left: `${pos.x}%`,
                        top: `${pos.y}%`,
                        width: tireWidth,
                        height: tireHeight,
                        fontSize: fontSize
                      }}
                    >
                      <div className="tire-label">T{tireNum}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="data-view-container">
              {Object.values(tireData).map((tire) => (
                <div key={tire.id} className={`data-box ${tire.status}`} onClick={() => setSelectedTire(tire.id)}>
                  <h3>Tire {tire.id} - {tire.position}</h3>
                  <div className="details">
                    <div className="detail-item"><span>Pressure:</span><span>{tire.pressure.toFixed(1)} PSI</span></div>
                    <div className="detail-item"><span>Temperature:</span><span>{tire.temperature.toFixed(1)} °C</span></div>
                    <div className="detail-item"><span>Battery:</span><span>{tire.battery.toFixed(2)} W</span></div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="graph-section">
          <div className="graph-header">
            <h2>Data Visualization</h2>
            <div className="graph-selector">
              <label htmlFor="graph-type">Select Metric:</label>
              <select id="graph-type" className="graph-dropdown" value={selectedMetric} onChange={(e) => setSelectedMetric(e.target.value)}>
                <option value="pressure">Pressure (PSI)</option>
                <option value="temperature">Temperature (°C)</option>
                <option value="battery">Battery Level (W)</option>
              </select>
            </div>

            {/* Custom Tire Selector Dropdown */}
            <div className="custom-multiselect" ref={dropdownRef}>
              <button
                className="multiselect-trigger"
                onClick={() => setIsTireDropdownOpen(!isTireDropdownOpen)}
              >
                Select Tires {visibleTires.length === config?.totalTires ? '(All)' : `(${visibleTires.length})`}
                <span className="arrow">▼</span>
              </button>

              {isTireDropdownOpen && (
                <div className="multiselect-dropdown">
                  <div className="multiselect-header">
                    <label className="checkbox-item check-all">
                      <input
                        type="checkbox"
                        checked={config && visibleTires.length === config.totalTires}
                        onChange={toggleAllTires}
                      />
                      <span>All Tires</span>
                    </label>
                  </div>
                  <div className="multiselect-list">
                    {config && Array.from({ length: config.totalTires }, (_, i) => i + 1).map(i => (
                      <label key={i} className="checkbox-item">
                        <input
                          type="checkbox"
                          checked={visibleTires.includes(i)}
                          onChange={() => toggleTireVisibility(i)}
                        />
                        <span>Tire {i}</span>
                      </label>
                    ))}
                  </div>
                  <div className="multiselect-footer">
                    <button className="done-btn" onClick={() => setIsTireDropdownOpen(false)}>Done</button>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="zoom-controls">
            <button className="zoom-btn" onClick={() => handleZoom(mainChartInstanceRef, 'in')} title="Zoom In">+</button>
            <button className="zoom-btn" onClick={() => handleZoom(mainChartInstanceRef, 'out')} title="Zoom Out">-</button>
            <button className="zoom-btn" onClick={() => handleZoomReset(mainChartInstanceRef)} title="Reset Zoom">Reset</button>

          </div>
          <div className="graph-container">
            <canvas ref={mainChartRef}></canvas>
          </div>
        </div>

        <div className="table-section">
          <h2>Tire Data Table</h2>
          <div className="table-wrapper">
            <table id="tpms-table">
              <thead>
                <tr>
                  <th>Tire #</th>
                  <th>Position</th>
                  <th>Pressure (PSI)</th>
                  <th>Temperature (°C)</th>
                  <th>Battery (W)</th>
                  <th>Last Update</th>
                </tr>
              </thead>
              <tbody>
                {Object.values(tireData).map((tire) => (
                  <tr key={tire.id}>
                    <td><strong>{tire.id}</strong></td>
                    <td><strong>{tire.position}</strong></td>
                    <td>{tire.pressure.toFixed(1)}</td>
                    <td>{tire.temperature.toFixed(1)}</td>
                    <td>{tire.battery.toFixed(2)} W</td>
                    <td>{tire.lastUpdate.toLocaleTimeString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {selectedTire !== null && (
        <div className="modal" onClick={(e) => e.target.className === 'modal' && setSelectedTire(null)}>
          <div className="modal-content tire-detail-modal-content">
            <span className="close-tire-detail" onClick={() => setSelectedTire(null)}>&times;</span>
            <h2 id="tire-detail-title">Tire {selectedTire} - {tireData[selectedTire]?.position}</h2>

            <div className="tire-detail-cards">
              <div className="data-card pressure-card">
                <div className="card-icon">📊</div>
                <div className="card-label">Pressure</div>
                <div className="card-value">{tireData[selectedTire]?.pressure?.toFixed(1) || '0.0'}</div>
                <div className="card-unit">PSI</div>
              </div>
              <div className="data-card temperature-card">
                <div className="card-icon">🌡️</div>
                <div className="card-label">Temperature</div>
                <div className="card-value">{tireData[selectedTire]?.temperature?.toFixed(1) || '0.0'}</div>
                <div className="card-unit">°C</div>
              </div>
              <div className="data-card battery-card">
                <div className="card-icon">🔋</div>
                <div className="card-label">Battery</div>
                <div className="card-value">{tireData[selectedTire]?.battery?.toFixed(2) || '0.00'}</div>
                <div className="card-unit">W</div>
              </div>
            </div>

            <div className="tire-detail-graph-section">
              <div className="graph-controls-header">
                <h3>Live Data Graph</h3>
                <div className="view-selector">
                  <button className="arrow-btn" onClick={() => cycleDetailView('prev')} title="Previous View">◀</button>
                  <select id="tire-detail-view-selector" className="view-selector-dropdown" value={detailView} onChange={(e) => setDetailView(e.target.value)}>
                    <option value="pressure">Pressure</option>
                    <option value="temperature">Temperature</option>
                    <option value="battery">Battery</option>
                  </select>
                  <button className="arrow-btn" onClick={() => cycleDetailView('next')} title="Next View">▶</button>
                </div>
              </div>
              <div className="zoom-controls">
                <button className="zoom-btn" onClick={() => handleZoom(detailChartInstanceRef, 'in')} title="Zoom In">+</button>
                <button className="zoom-btn" onClick={() => handleZoom(detailChartInstanceRef, 'out')} title="Zoom Out">-</button>
                <button className="zoom-btn" onClick={() => handleZoomReset(detailChartInstanceRef)} title="Reset Zoom">Reset</button>
                <span className="zoom-hint">Drag to pan, Scroll to zoom</span>
              </div>
              <div className="tire-detail-graph-container">
                <canvas ref={detailChartRef}></canvas>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const globalStyles = `
  :root {
    --bg: #05060a;
    --card-bg: #111423;
    --card-border: #1f2235;
    --accent: #5cc8ff;
    --accent-strong: #2cb1ff;
    --danger: #ff5c6a;
    --success: #29d98c;
    --warning: #ff9800;
    --info: #5cc8ff;
    --reserved: #9b59b6;
    --low: #ffeb3b;
    --text: #f2f5ff;
    --muted: #9ba3c7;
  }

  .tpms-page {
    font-family: 'Segoe UI', system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
    background: radial-gradient(circle at 10% 20%, rgba(92, 200, 255, 0.15), transparent 40%),
                radial-gradient(circle at 80% 0, rgba(255, 92, 106, 0.12), transparent 45%),
                var(--bg);
    min-height: 100vh;
    padding: 20px;
    color: var(--text);
  }

  .tpms-container {
    max-width: 1400px;
    margin: 0 auto;
    background: var(--card-bg);
    border-radius: 16px;
    border: 1px solid var(--card-border);
    box-shadow: 0 30px 60px rgba(0, 0, 0, 0.35);
    overflow: hidden;
  }

  .tpms-header {
    background: var(--card-bg);
    border-bottom: 1px solid var(--card-border);
    color: var(--text);
    padding: 30px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 20px;
  }

  .tpms-header h1 {
    font-size: 2.4rem;
    font-weight: bold;
    margin: 0;
    letter-spacing: 0.04em;
  }

  .btn-primary, .btn-secondary {
    padding: 12px 24px;
    border: none;
    border-radius: 12px;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.2);
  }

  .btn-primary {
    background: linear-gradient(135deg, var(--accent), var(--accent-strong));
    color: #02111c;
  }

  .btn-primary:hover { transform: translateY(-2px); box-shadow: 0 6px 12px rgba(92, 200, 255, 0.3); }

  .btn-secondary {
    background: transparent;
    border: 1px solid var(--card-border);
    color: var(--muted);
  }

  .btn-secondary:hover { transform: translateY(-2px); border-color: var(--accent); color: var(--text); }

  .truck-view-section {
    padding: 40px;
    background: var(--bg);
    border-bottom: 1px solid var(--card-border);
  }

  .view-selector-header {
    display: flex;
    justify-content: center;
    align-items: center;
    margin-bottom: 20px;
    gap: 20px;
  }

  .view-toggle {
    display: flex;
    border-radius: 12px;
    overflow: hidden;
    border: 1px solid var(--card-border);
  }

  .view-btn {
    padding: 10px 20px;
    border: none;
    background-color: var(--card-bg);
    color: var(--muted);
    cursor: pointer;
    transition: all 0.3s ease;
    font-size: 16px;
    font-weight: 600;
  }

  .view-btn.active {
    background: linear-gradient(135deg, var(--accent), var(--accent-strong));
    color: #02111c;
  }

  .view-btn:hover:not(.active) { background-color: #1a1d2e; color: var(--text); }

  .truck-container-wrapper {
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 40px;
    background: var(--card-bg);
    border-radius: 12px;
    border: 1px solid var(--card-border);
  }

  .truck-2d-view {
    position: relative;
    width: 100%;
    max-width: 900px;
    height: 400px;
    margin: 0 auto;
    background: linear-gradient(to bottom, #1a1d2e 0%, #111423 100%);
    border-radius: 12px;
    border: 2px solid var(--card-border);
    overflow: hidden;
  }

  .truck-body-container {
    position: absolute;
    top: 33%;
    left: %;
    transform: translate(-50%, -50%);
    width: 70%;
    height: 35%;
  }

  .truck-body {
    width: 100%;
    height: 100%;
    display: flex;
    border-radius: 8px;
    overflow: hidden;
    box-shadow: inset 0 2px 4px rgba(255, 255, 255, 0.05), 0 4px 8px rgba(0, 0, 0, 0.3);
  }

  .truck-cab {
    width: 28%;
    height: 100%;
    background: linear-gradient(135deg, #1a252f 0%, #2c3e50 100%);
    border-right: 3px solid #1a252f;
    position: relative;
  }

  .truck-trailer {
    flex: 1;
    height: 100%;
    background: linear-gradient(135deg, #34495e 0%, #2c3e50 100%);
    position: relative;
  }

  .tire {
    position: absolute;
    width: 120px;
    height: 60px;
    background-color: #2a2a2a;
    background-image: repeating-linear-gradient(0deg, rgba(0,0,0,0.15) 0px, rgba(0,0,0,0.15) 3px, transparent 3px, transparent 8px),
                      radial-gradient(circle at center, #6d6d6d, #2a2a2a);
    border-radius: 10%;
    border: 4px solid #1c1c1c;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.3s ease;
    box-shadow: 0 3px 10px rgba(0, 0, 0, 0.3), inset 0 2px 4px rgba(255, 255, 255, 0.2);
    z-index: 10;
    padding: 8px;
    overflow: hidden;
    transform: translate(-50%, -50%);
  }

  .tire::before {
    content: '';
    position: absolute;
    width: 30%;
    height: 60%;
    border-radius: 50%;
    border: 3px solid rgba(255, 255, 255, 0.1);
    background: radial-gradient(circle, rgba(255, 255, 255, 0.15) 0%, transparent 60%);
    box-shadow: inset 0 0 10px rgba(0,0,0,0.5);
  }

  .tire:hover { transform: translate(-50%, -50%) scale(1.1); box-shadow: 0 6px 15px rgba(0, 0, 0, 0.4); z-index: 20; }

  .tire.ok { border-color: var(--success); }
  .tire.info { border-color: var(--info); }
  .tire.missing { border-color: var(--muted); }
  
  .tire.warning {
    border-color: var(--warning);
    background-image: repeating-linear-gradient(0deg, rgba(0,0,0,0.15) 0px, rgba(0,0,0,0.15) 3px, transparent 3px, transparent 8px),
                      radial-gradient(circle at 30% 30%, #ffe0b2, #ff9800);
    box-shadow: 0 3px 10px rgba(0, 0, 0, 0.3), 0 0 15px rgba(255, 152, 0, 0.5), inset 0 2px 4px rgba(255, 255, 255, 0.3);
    animation: pulse-warning 2s infinite;
  }

  .tire.critical {
    border-color: var(--danger);
    background-image: repeating-linear-gradient(0deg, rgba(0,0,0,0.15) 0px, rgba(0,0,0,0.15) 3px, transparent 3px, transparent 8px),
                      radial-gradient(circle at 30% 30%, #ffcdd2, #f44336);
    box-shadow: 0 3px 10px rgba(0, 0, 0, 0.3), 0 0 20px rgba(244, 67, 54, 0.6), inset 0 2px 4px rgba(255, 255, 255, 0.3);
    animation: pulse-critical 1s infinite;
  }

  .tire.reserved { border-color: var(--reserved); }
  .tire.low { border-color: var(--low); }

  @keyframes pulse-warning { 0%, 100% { transform: translate(-50%, -50%) scale(1); } 50% { transform: translate(-50%, -50%) scale(1.05); } }
  @keyframes pulse-critical { 0%, 100% { transform: translate(-50%, -50%) scale(1); } 50% { transform: translate(-50%, -50%) scale(1.1); } }

  .tire-label {
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    font-weight: bold;
    font-size: 14px;
    color: #ffffff;
    text-shadow: 1px 1px 3px rgba(0, 0, 0, 0.7);
    z-index: 2;
    position: relative;
    // background: rgba(0, 0, 0, 0.4);
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    letter-spacing: 0.5px;
    margin-bottom: 0px;
  }

  .tire-value {
    font-size: 11px;
    color: #f0f0f0;
    font-weight: 600;
    line-height: 1.4;
    text-align: center;
    z-index: 2;
    position: relative;
    padding: 2px 4px;
    border-radius: 3px;
  }

  .data-view-container {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 20px;
    padding: 20px;
    background: var(--bg);
    border-radius: 12px;
  }

  .data-box {
    background: var(--card-bg);
    border-radius: 12px;
    padding: 20px;
    border: 1px solid var(--card-border);
    border-left: 5px solid;
    transition: all 0.3s ease;
    cursor: pointer;
  }

  .data-box:hover { transform: translateY(-3px); box-shadow: 0 8px 20px rgba(0, 0, 0, 0.3); }

  .data-box.ok { border-left-color: var(--success); }
  .data-box.info { border-left-color: var(--info); }
  .data-box.missing { border-left-color: var(--muted); }
  .data-box.warning { border-left-color: var(--warning); }
  .data-box.reserved { border-left-color: var(--reserved); }
  .data-box.low { border-left-color: var(--low); }
  .data-box.critical { border-left-color: var(--danger); }

  .data-box h3 { margin-bottom: 15px; font-size: 1.2em; color: var(--text); }

  .data-box .details { display: flex; flex-direction: column; gap: 10px; }

  .data-box .detail-item { display: flex; justify-content: space-between; font-size: 1em; color: var(--muted); }
  .data-box .detail-item span:last-child { color: var(--text); font-weight: 600; }

  .graph-section {
    padding: 40px;
    background: var(--card-bg);
    border-bottom: 1px solid var(--card-border);
  }

  .graph-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 25px;
    flex-wrap: wrap;
    gap: 20px;
  }

  .graph-header h2 { font-size: 1.8em; color: var(--text); margin: 0; }

  .graph-selector { display: flex; align-items: center; gap: 15px; }
  .graph-selector label { font-weight: bold; color: var(--muted); font-size: 16px; }

  .graph-dropdown {
    padding: 12px 20px;
    border: 1px solid var(--card-border);
    border-radius: 10px;
    font-size: 16px;
    background: #080b16;
    color: var(--text);
    cursor: pointer;
    transition: all 0.3s ease;
    min-width: 250px;
  }

  .graph-dropdown:hover { border-color: var(--accent); }
  .graph-dropdown:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px rgba(92, 200, 255, 0.2); }

  .zoom-controls { display: flex; align-items: center; gap: 10px; margin-bottom: 15px; flex-wrap: wrap; }

  .zoom-btn {
    background: var(--card-bg);
    color: var(--accent);
    border: 1px solid var(--card-border);
    border-radius: 8px;
    padding: 8px 16px;
    font-size: 14px;
    font-weight: bold;
    cursor: pointer;
    transition: all 0.3s ease;
  }

  .zoom-btn:hover { background: var(--accent); color: #02111c; border-color: var(--accent); transform: translateY(-2px); }

  .zoom-hint { margin-left: auto; font-size: 12px; color: var(--muted); font-style: italic; }

  .graph-container {
    position: relative;
    height: 400px;
    background: #080b16;
    border-radius: 12px;
    padding: 20px;
    border: 1px solid var(--card-border);
  }

  .table-section { padding: 40px; background: var(--bg); }

  .table-section h2 { text-align: center; margin-bottom: 30px; font-size: 1.8em; color: var(--text); }

  .table-wrapper {
    overflow-x: auto;
    background: var(--card-bg);
    border-radius: 12px;
    border: 1px solid var(--card-border);
    padding: 0;
  }

  #tpms-table { width: 100%; border-collapse: collapse; font-size: 14px; font-family: 'Fira Code', Consolas, monospace; }

  #tpms-table thead {
    background: linear-gradient(135deg, var(--accent), var(--accent-strong));
    color: #02111c;
  }

  #tpms-table th {
    padding: 15px;
    text-align: left;
    font-weight: bold;
    font-size: 14px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  #tpms-table tbody tr { border-bottom: 1px solid var(--card-border); transition: all 0.2s ease; }
  #tpms-table tbody tr:hover { background-color: rgba(92, 200, 255, 0.05); }
  #tpms-table tbody tr:nth-child(even) { background-color: rgba(0, 0, 0, 0.2); }
  #tpms-table tbody tr:nth-child(even):hover { background-color: rgba(92, 200, 255, 0.08); }

  #tpms-table td { padding: 15px; color: var(--text); }

  .modal {
    display: flex;
    position: fixed;
    z-index: 1000;
    left: 0;
    top: 0;
    width: 100%;
    height: 100%;
    background-color: rgba(0, 0, 0, 0.8);
    backdrop-filter: blur(5px);
    animation: fadeIn 0.3s ease;
    align-items: center;
    justify-content: center;
  }

  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

  .modal-content {
    background: var(--card-bg);
    padding: 40px;
    border-radius: 16px;
    border: 1px solid var(--card-border);
    width: 90%;
    max-width: 500px;
    box-shadow: 0 30px 60px rgba(0, 0, 0, 0.4);
    animation: slideDown 0.3s ease;
    position: relative;
    color: var(--text);
  }

  @keyframes slideDown {
    from { transform: translateY(-50px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }

  .tire-detail-modal-content {
    max-width: 1000px !important;
    max-height: 95vh;
    overflow-y: auto;
    padding: 30px 40px !important;
    width: 95% !important;
  }

  .close-tire-detail {
    position: absolute;
    right: 20px;
    top: 20px;
    font-size: 32px;
    font-weight: bold;
    color: var(--muted);
    cursor: pointer;
    transition: all 0.3s ease;
    z-index: 10;
  }

  .close-tire-detail:hover { color: var(--text); transform: scale(1.1); }

  .tire-detail-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin: 25px 0; }

  .data-card {
    background: #080b16;
    border-radius: 12px;
    padding: 25px;
    text-align: center;
    color: var(--text);
    border: 2px solid var(--card-border);
    transition: all 0.3s ease;
  }

  .data-card:hover { transform: translateY(-3px); box-shadow: 0 8px 20px rgba(0, 0, 0, 0.3); }

  .pressure-card { border-color: var(--success); background: linear-gradient(135deg, rgba(41, 217, 140, 0.1) 0%, #080b16 100%); }
  .temperature-card { border-color: var(--warning); background: linear-gradient(135deg, rgba(255, 152, 0, 0.1) 0%, #080b16 100%); }
  .battery-card { border-color: var(--accent); background: linear-gradient(135deg, rgba(92, 200, 255, 0.1) 0%, #080b16 100%); }

  .card-icon { font-size: 40px; margin-bottom: 10px; }
  .card-label { font-size: 14px; color: var(--muted); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 1px; }
  .card-value { font-size: 36px; font-weight: bold; margin-bottom: 5px; color: var(--text); }
  .card-unit { font-size: 14px; color: var(--muted); }

  .tire-detail-graph-section { margin-top: 30px; padding-top: 30px; border-top: 2px solid var(--card-border); }

  .graph-controls-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 15px;
    flex-wrap: wrap;
    gap: 15px;
  }

  .tire-detail-graph-section h3 { margin: 0; color: var(--text); font-size: 1.5em; }

  .view-selector { display: flex; align-items: center; gap: 10px; }

  .arrow-btn {
    background: var(--card-bg);
    color: var(--accent);
    border: 1px solid var(--card-border);
    border-radius: 8px;
    width: 40px;
    height: 40px;
    font-size: 18px;
    cursor: pointer;
    transition: all 0.3s ease;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .arrow-btn:hover { background: var(--accent); color: #02111c; border-color: var(--accent); transform: scale(1.05); }

  .view-selector-dropdown {
    padding: 10px 15px;
    border: 1px solid var(--card-border);
    border-radius: 8px;
    font-size: 14px;
    background: #080b16;
    color: var(--text);
    cursor: pointer;
    transition: all 0.3s ease;
    min-width: 180px;
  }

  .view-selector-dropdown:hover { border-color: var(--accent); }
  .view-selector-dropdown:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px rgba(92, 200, 255, 0.2); }

  .tire-detail-graph-container {
    position: relative;
    height: 450px;
    background: #080b16;
    border-radius: 12px;
    padding: 20px;
    border: 1px solid var(--card-border);
    margin-bottom: 15px;
  }

  @media (max-width: 768px) {
    .tpms-header { flex-direction: column; text-align: center; }
    .tpms-header h1 { font-size: 1.8em; }
    .truck-2d-view { height: 300px; }
    .truck-container-wrapper { padding: 20px; }
    .tire { width: 80px; height: 50px; }
    .tire-label { font-size: 12px; padding: 5px 6px; }
    .tire-value { font-size: 9px; }
    .tire-detail-cards { grid-template-columns: 1fr; }
    .graph-header { flex-direction: column; align-items: flex-start; }
    .graph-selector { width: 100%; }
    .graph-dropdown { width: 100%; }
    .table-section, .graph-section, .truck-view-section { padding: 20px; }
  }

  @media (max-width: 480px) {
    .tire { width: 60px; height: 40px; }
    .tire-label { font-size: 10px; padding: 4px 5px; }
    .tire-value { font-size: 8px; }
    .tire-detail-modal-content { padding: 20px !important; }
    .graph-controls-header { flex-direction: column; align-items: flex-start; }
  }
    .tire-detail-modal-content { padding: 20px !important; }
    .graph-controls-header { flex-direction: column; align-items: flex-start; }
  }

  /* Custom Multi-select Styles */
  .custom-multiselect {
    position: relative;
    display: inline-block;
  }

  .multiselect-trigger {
    padding: 12px 20px;
    border: 1px solid var(--card-border);
    border-radius: 10px;
    font-size: 16px;
    background: #080b16;
    color: var(--text);
    cursor: pointer;
    transition: all 0.3s ease;
    min-width: 200px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .multiselect-trigger:hover { border-color: var(--accent); }
  
  .multiselect-dropdown {
    position: absolute;
    top: 100%;
    right: 0; /* Align right to avoid overflow if on edge */
    margin-top: 8px;
    background: #0d101b;
    border: 1px solid var(--card-border);
    border-radius: 10px;
    width: 250px;
    z-index: 100;
    box-shadow: 0 10px 30px rgba(0,0,0,0.5);
    overflow: hidden;
    animation: fadeIn 0.2s ease;
  }

  .multiselect-header {
    padding: 12px 15px;
    border-bottom: 1px solid var(--card-border);
    background: rgba(0,0,0,0.2);
  }

  .multiselect-list {
    max-height: 200px;
    overflow-y: auto;
    padding: 10px 0;
  }
  
  /* Scrollbar for dropdown */
  .multiselect-list::-webkit-scrollbar { width: 6px; }
  .multiselect-list::-webkit-scrollbar-track { background: transparent; }
  .multiselect-list::-webkit-scrollbar-thumb { background: var(--card-border); border-radius: 3px; }
  .multiselect-list::-webkit-scrollbar-thumb:hover { background: var(--muted); }

  .checkbox-item {
    display: flex;
    align-items: center;
    padding: 8px 15px;
    cursor: pointer;
    transition: background 0.2s;
    user-select: none;
  }

  .checkbox-item:hover { background: rgba(92, 200, 255, 0.1); }

  .checkbox-item input[type="checkbox"] {
    margin-right: 12px;
    width: 16px;
    height: 16px;
    accent-color: var(--accent);
    cursor: pointer;
  }
  
  .checkbox-item span { color: var(--text); font-size: 14px; }

  .multiselect-footer {
    padding: 10px;
    border-top: 1px solid var(--card-border);
    display: flex;
    justify-content: flex-end;
    background: rgba(0,0,0,0.2);
  }

  .done-btn {
    background: var(--accent);
    color: #02111c;
    border: none;
    padding: 6px 16px;
    border-radius: 6px;
    font-weight: bold;
    cursor: pointer;
    font-size: 13px;
  }
  
  .done-btn:hover { background: var(--accent-strong); }
`;

export default TPMSDashboard;
