const mongoose = require('mongoose');

const parkingSchema = new mongoose.Schema({
    name: { type: String, required: true },
    description: { type: String },
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    location: {
        lat: { type: Number, required: true },
        lng: { type: Number, required: true }
    },
    address: { type: String },
    totalSlots: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Parking', parkingSchema);
