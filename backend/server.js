require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fetch = require('node-fetch');
const mockData = require('./mockdata');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: '*' } });

const API_BASE = 'http://125.16.1.204:8080/vtpis/appQuery.do';
const USE_MOCK = process.env.USE_MOCK === 'true';

const trackedStops = new Set();
const alerts = {}; 

async function pollETAs() {
  for (const stopId of trackedStops) {
    let buses = [];
    try {
      if (USE_MOCK) {
        buses = mockData[stopId] || [];
      } else {
        const res = await fetch(`${API_BASE}?query=${stopId},0,67&flag=6`);
        const text = await res.text();
        buses = text ? text.split(';').filter(Boolean).map(busStr => {
          const [vehicle, type, route, eta] = busStr.split(',');
          return { vehicle, type, route, eta };
        }) : [];
      }
      io.emit('etaUpdate', { stopId, buses });
      checkAlerts(stopId, buses);
    } catch (err) {
      console.error(`ETA error for ${stopId}:`, err);
    }
  }
}

setInterval(pollETAs, 30000); 

function checkAlerts(stopId, buses) {
  if (alerts[stopId]) {
    const { threshold, users } = alerts[stopId];
    const now = new Date();
    buses.forEach(bus => {
      const etaTime = new Date(`${now.toDateString()} ${bus.eta}`);
      const minutesAway = (etaTime - now) / (60 * 1000);
      if (minutesAway <= threshold && minutesAway > 0) {
        const msg = `Bus ${bus.route} (${bus.vehicle}) arriving at ${stopId} in ~${Math.round(minutesAway)} min!`;
        users.forEach(userId => io.to(userId).emit('alert', msg));
      }
    });
  }
}

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  socket.on('trackStop', (stopId) => {
    trackedStops.add(stopId);
    pollETAs(); 
  });
  socket.on('untrackStop', (stopId) => {
    trackedStops.delete(stopId);
  });
  socket.on('setAlert', ({ stopId, threshold }) => {
    if (!alerts[stopId]) alerts[stopId] = { threshold, users: [] };
    alerts[stopId].threshold = threshold;
    alerts[stopId].users.push(socket.id);
  });
  socket.on('disconnect', () => console.log('Client disconnected'));
});

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
