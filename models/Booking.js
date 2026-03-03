const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    slotId: { type: mongoose.Schema.Types.ObjectId, ref: 'Slot', required: true },
    parkingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Parking', required: true },
    vehicleType: { type: String, enum: ['EV', 'Petrol'], required: true },
    bookingStartTime: { type: Date, default: Date.now },
    durationHours: { type: Number, required: true },
    totalPrice: { type: Number, required: true },
    status: { type: String, enum: ['RESERVED', 'OCCUPIED', 'RELEASED', 'COMPLETED', 'CANCELLED'], default: 'RESERVED' },
    reservedUntil: { type: Date }, // bookingStartTime + 15min timeout
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Booking', bookingSchema);
