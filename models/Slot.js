const mongoose = require('mongoose');

const slotSchema = new mongoose.Schema({
    parkingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Parking', required: true },
    slotNumber: { type: String, required: true },
    slotType: { type: String, enum: ['NORMAL', 'EV', 'BIKE'], default: 'NORMAL' },
    entryPriority: { type: String, enum: ['PREMIUM', 'STANDARD'], default: 'STANDARD' },
    chargingType: { type: String, enum: ['FAST', 'NORMAL', 'NONE'], default: 'NONE' },
    basePricePerHour: { type: Number, required: true, default: 5 },
    premiumExtraPerHour: { type: Number, default: 0 },
    status: { type: String, enum: ['AVAILABLE', 'RESERVED', 'OCCUPIED'], default: 'AVAILABLE' },
    currentBookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', default: null }
});

module.exports = mongoose.model('Slot', slotSchema);
