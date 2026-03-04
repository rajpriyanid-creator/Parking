const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    slotId: { type: mongoose.Schema.Types.ObjectId, ref: 'Slot', required: true },
    parkingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Parking', required: true },
    vehicleType: { type: String, enum: ['EV', 'Petrol', 'Bike'], required: true },

    // Scheduled time (user-chosen, can be future)
    scheduledStartTime: { type: Date, required: true },
    scheduledEndTime: { type: Date, required: true },  // computed: start + durationHours

    // Actual arrival time (set when OCCUPIED)
    bookingStartTime: { type: Date },
    durationHours: { type: Number, required: true },
    totalPrice: { type: Number, required: true },

    status: {
        type: String,
        enum: ['SCHEDULED', 'RESERVED', 'OCCUPIED', 'RELEASED', 'COMPLETED', 'CANCELLED'],
        default: 'SCHEDULED'
    },
    reservedUntil: { type: Date }, // set when SCHEDULED -> RESERVED (15-min arrival window)
    notificationSentAt: { type: Date, default: null }, // tracks 15-min reminder send
    earlyEndedAt: { type: Date, default: null },
    refundAmount: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
});

// Index for fast overlap queries
bookingSchema.index({ slotId: 1, scheduledStartTime: 1, scheduledEndTime: 1 });

module.exports = mongoose.model('Booking', bookingSchema);
