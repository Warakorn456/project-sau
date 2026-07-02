// ============================================================
//  state.js — Shared mutable state across modules
// ============================================================

const state = {
    sensorData: {
        temperature: 0,
        humidity:    0,
        light:       0,
        ph:          7.0,
        ph2:         7.0,
        voltage:     0,
        current:     0,
        power:       0,
        waterLevel:  [0, 0, 0, 0, 0, 0],
        connected:   false,
        timestamp:   null
    },
    relayStates:   new Array(10).fill(false),
    lastESP32Ping: 0
};

module.exports = state;
