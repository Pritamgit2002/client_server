const net = require('net');
const fs = require('fs');

const HOST = 'localhost';
const PORT = 3000;

const PACKET_CONTENTS = [
  { name: 'symbol', type: 'ascii', size: 4 },
  { name: 'buysellindicator', type: 'ascii', size: 1 },
  { name: 'quantity', type: 'int32', size: 4 },
  { name: 'price', type: 'int32', size: 4 },
  { name: 'packetSequence', type: 'int32', size: 4 }
];

const PACKET_SIZE = PACKET_CONTENTS.reduce((sum, field) => sum + field.size, 0);

const client = new net.Socket();
let receivedPackets = [];
let highestSequence = 0;
const EXPECTED_PACKET_COUNT = 14; 
const MAX_RUNTIME = 30000;

function parsePacket(buffer) {
  let offset = 0;
  const packet = {};

  PACKET_CONTENTS.forEach(field => {
    if (field.type === 'ascii') {
      packet[field.name] = buffer.slice(offset, offset + field.size).toString('ascii').replace(/\0+$/, '');
    } else if (field.type === 'int32') {
      packet[field.name] = buffer.readInt32BE(offset);
    }
    offset += field.size;
  });

  return packet;
}

function requestMissingPackets() {
  for (let i = 1; i <= highestSequence; i++) {
    if (!receivedPackets.find(p => p.packetSequence === i)) {
      const buffer = Buffer.alloc(2);
      buffer.writeInt8(2, 0);
      buffer.writeInt8(i, 1);
      client.write(buffer);
    }
  }
}

function saveToJsonAndExit() {
  const sortedPackets = receivedPackets.sort((a, b) => a.packetSequence - b.packetSequence);
  fs.writeFileSync('stock_data.json', JSON.stringify(sortedPackets, null, 2));
  console.log('Data saved to stock_data.json');
  client.destroy();
  process.exit(0);
}

client.connect(PORT, HOST, () => {
  console.log('Connected to server');
  
  // Requesting initial data
  const buffer = Buffer.alloc(2);
  buffer.writeInt8(1, 0);
  buffer.writeInt8(0, 1);
  client.write(buffer);
});

client.on('data', (data) => {
  for (let i = 0; i < data.length; i += PACKET_SIZE) {
    const packetBuffer = data.slice(i, i + PACKET_SIZE);
    const packet = parsePacket(packetBuffer);
    
    if (!receivedPackets.find(p => p.packetSequence === packet.packetSequence)) {
      receivedPackets.push(packet);
      highestSequence = Math.max(highestSequence, packet.packetSequence);
    }
  }

  if (receivedPackets.length === EXPECTED_PACKET_COUNT) {
    console.log('All expected packets received.');
    saveToJsonAndExit();
  }
});

client.on('close', () => {
  console.log('Connection closed');
  saveToJsonAndExit();
});

client.on('error', (err) => {
  console.error('Error:', err);
  saveToJsonAndExit();
});

// Seting up a maximum runtime
setTimeout(() => {
  console.log('Maximum runtime reached.');
  saveToJsonAndExit();
}, MAX_RUNTIME);

// Checking for missing packets every second
const intervalId = setInterval(() => {
  requestMissingPackets();
  
  if (receivedPackets.length === EXPECTED_PACKET_COUNT) {
    clearInterval(intervalId);
    saveToJsonAndExit();
  }
}, 1000);