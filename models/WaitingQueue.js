const mongoose = require('mongoose');

const waitingQueueSchema = new mongoose.Schema({
    parkingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Parking', required: true },
    slotId: { type: mongoose.Schema.Types.ObjectId, ref: 'Slot', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    vehicleType: { type: String, enum: ['EV', 'Petrol'] },
    requestedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('WaitingQueue', waitingQueueSchema);
