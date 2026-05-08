import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import CANConsole from './pages/CANConsole';
import { PCANProvider } from './context/PCANContext';
import './index.css';

function App() {
  return (
    <BrowserRouter>
      <PCANProvider>
        <Routes>
          <Route path="/" element={<CANConsole />} />
        </Routes>
      </PCANProvider>
    </BrowserRouter>
  );
}

export default App;
