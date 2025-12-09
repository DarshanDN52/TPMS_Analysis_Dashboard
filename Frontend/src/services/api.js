const API_BASE = '/api';

export const CHANNEL_OPTIONS = [
  { value: 'PCAN_USBBUS1', label: 'PCAN_USB Channel 1 (51h)' },
  { value: 'PCAN_USBBUS2', label: 'PCAN_USB Channel 2 (52h)' },
  { value: 'PCAN_USBBUS3', label: 'PCAN_USB Channel 3 (53h)' },
  { value: 'PCAN_USBBUS4', label: 'PCAN_USB Channel 4 (54h)' },
  { value: 'PCAN_USBBUS5', label: 'PCAN_USB Channel 5 (55h)' }
];

export const BAUDRATE_OPTIONS = [
  { value: 'PCAN_BAUD_1M', label: '1 MBit/s' },
  { value: 'PCAN_BAUD_800K', label: '800 kBit/s' },
  { value: 'PCAN_BAUD_500K', label: '500 kBit/s' },
  { value: 'PCAN_BAUD_250K', label: '250 kBit/s' },
  { value: 'PCAN_BAUD_125K', label: '125 kBit/s' },
  { value: 'PCAN_BAUD_100K', label: '100 kBit/s' },
  { value: 'PCAN_BAUD_50K', label: '50 kBit/s' },
  { value: 'PCAN_BAUD_20K', label: '20 kBit/s' },
  { value: 'PCAN_BAUD_10K', label: '10 kBit/s' }
];

export const pcanApi = {
  async initialize(channel, baudrate) {
    const response = await fetch(`${API_BASE}/pcan/initialize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command: 'INIT_PCAN',
        payload: {
          id: channel,
          bit_rate: baudrate,
          data: ''
        }
      })
    });
    return response.json();
  },

  async release() {
    const response = await fetch(`${API_BASE}/pcan/release`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command: 'UNINIT_PCAN',
        payload: { id: '', bit_rate: '', data: '' }
      })
    });
    return response.json();
  },

  async read() {
    const response = await fetch(`${API_BASE}/pcan/read`);
    return response.json();
  },

  async write(id, data) {
    const response = await fetch(`${API_BASE}/pcan/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command: 'SEND_DATA',
        payload: {
          id: id.toUpperCase(),
          bit_rate: '',
          data: data
        }
      })
    });
    return response.json();
  },

  async getStatus() {
    const response = await fetch(`${API_BASE}/pcan/status`);
    return response.json();
  },

  async saveData(messages) {
    const response = await fetch(`${API_BASE}/save-data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command: 'LOAD_DATA',
        payload: {
          id: '',
          bit_rate: '',
          data: messages
        }
      })
    });
    return response.json();
  }
};

export const tpmsApi = {
  async start(tireCount, axleConfig) {
    const response = await fetch(`${API_BASE}/tpms/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tire_count: tireCount, axle_config: axleConfig })
    });
    return response.json();
  },

  async stop() {
    const response = await fetch(`${API_BASE}/tpms/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    return response.json();
  },

  async getStatus() {
    const response = await fetch(`${API_BASE}/tpms/status`);
    return response.json();
  }
};
