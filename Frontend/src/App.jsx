import { useState, useCallback } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import CANConsole from './pages/CANConsole';
import TPMSDashboard from './pages/TPMSDashboard';
import BLETestControl from './pages/BLETestControl';
import './index.css';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<CANConsole />} />
        <Route path="/tpms" element={<TPMSDashboard />} />
        <Route path="/ble-test" element={<BLETestControl />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
