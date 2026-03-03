const Booking = require('../models/Booking');
const Slot = require('../models/Slot');
const WaitingQueue = require('../models/WaitingQueue');

// This function is called every minute by the cron job
async function releaseExpiredReservations() {
    try {
        const expired = await Booking.find({
            status: 'RESERVED',
            reservedUntil: { $lte: new Date() }
        });

        for (const b of expired) {
            // Release the slot
            await Slot.findByIdAndUpdate(b.slotId, {
                status: 'AVAILABLE',
                currentBookingId: null
            });
            await Booking.findByIdAndUpdate(b._id, { status: 'RELEASED' });
            console.log(`[CRON] Released booking ${b._id} — slot ${b.slotId} now AVAILABLE`);

            // Check waiting queue
            await assignNextFromQueue(b.slotId, b.parkingId);
        }

        if (expired.length > 0)
            console.log(`[CRON] Released ${expired.length} expired reservations`);
    } catch (err) {
        console.error('[CRON] Error releasing reservations:', err.message);
    }
}

async function assignNextFromQueue(slotId, parkingId) {
    const next = await WaitingQueue.findOne({ slotId }).sort({ requestedAt: 1 });
    if (!next) return;

    const slot = await Slot.findById(slotId);
    if (!slot || slot.status !== 'AVAILABLE') return;

    // EV priority check
    if (next.vehicleType === 'Petrol' && slot.slotType === 'EV') {
        const normalAvail = await Slot.countDocuments({ parkingId, slotType: 'NORMAL', status: 'AVAILABLE' });
        if (normalAvail > 0) {
            // Skip this petrol user for this EV slot
            await WaitingQueue.findByIdAndDelete(next._id);
            return;
        }
    }

    // Auto-assign
    const now = new Date();
    const reservedUntil = new Date(now.getTime() + 15 * 60000);
    const { totalPrice } = calculatePrice(slot, next.durationHours || 2);

    const booking = await Booking.create({
        userId: next.userId,
        slotId,
        parkingId,
        vehicleType: next.vehicleType,
        bookingStartTime: now,
        durationHours: next.durationHours || 2,
        totalPrice,
        status: 'RESERVED',
        reservedUntil
    });

    await Slot.findByIdAndUpdate(slotId, { status: 'RESERVED', currentBookingId: booking._id });
    await WaitingQueue.findByIdAndDelete(next._id);
    console.log(`[CRON] Auto-assigned slot ${slotId} to user ${next.userId} from waiting queue`);
}

function calculatePrice(slot, durationHours) {
    const premium = slot.entryPriority === 'PREMIUM' ? (slot.premiumExtraPerHour || 0) : 0;
    const totalPrice = (slot.basePricePerHour + premium) * durationHours;
    return { totalPrice: parseFloat(totalPrice.toFixed(2)) };
}

module.exports = { releaseExpiredReservations };
