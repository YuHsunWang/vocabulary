import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css'; // 確保你有這個檔案，或是移除這行

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);