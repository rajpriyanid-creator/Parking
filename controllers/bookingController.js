const haversineDistance = require('../utils/haversine');
const Parking = require('../models/Parking');
const Slot = require('../models/Slot');
const Booking = require('../models/Booking');
const WaitingQueue = require('../models/WaitingQueue');
const Payment = require('../models/Payment');
const User = require('../models/User');

const ARRIVAL_TIMEOUT_MINUTES = 15;
const ARRIVAL_RADIUS_METERS = 100;

function calculatePrice({ basePricePerHour, premiumExtraPerHour, entryPriority, durationHours }) {
    const premium = entryPriority === 'PREMIUM' ? (premiumExtraPerHour || 0) : 0;
    return parseFloat(((basePricePerHour + premium) * durationHours).toFixed(2));
}

// Check for overlapping bookings on a slot (with mandatory 10-min gap between bookings)
const SLOT_GAP_MINUTES = 10;
async function hasOverlap(slotId, startTime, endTime, excludeBookingId = null) {
    // Expand the end time by GAP to enforce a buffer between consecutive bookings
    const bufferedEnd = new Date(endTime.getTime() + SLOT_GAP_MINUTES * 60000);
    // Similarly, the new booking must not start within GAP of an existing booking's end
    const bufferedStart = new Date(startTime.getTime() - SLOT_GAP_MINUTES * 60000);
    const query = {
        slotId,
        status: { $in: ['SCHEDULED', 'RESERVED', 'OCCUPIED'] },
        scheduledStartTime: { $lt: bufferedEnd },
        scheduledEndTime: { $gt: bufferedStart }
    };
    if (excludeBookingId) query._id = { $ne: excludeBookingId };
    const count = await Booking.countDocuments(query);
    return count > 0;
}

// POST /api/bookings
exports.createBooking = async (req, res) => {
    const session = await require('mongoose').startSession();
    session.startTransaction();
    try {
        const { slotId, vehicleType, durationHours, scheduledStartTime } = req.body;
        const userId = req.user.userId;

        if (!slotId || !vehicleType || !durationHours)
            return res.status(400).json({ message: 'slotId, vehicleType, and durationHours are required' });

        const slot = await Slot.findById(slotId).session(session);
        if (!slot) return res.status(404).json({ message: 'Slot not found' });

        // Determine start and end time
        const now = new Date();
        const startTime = scheduledStartTime ? new Date(scheduledStartTime) : now;
        const endTime = new Date(startTime.getTime() + durationHours * 3600000);
        const isPreBooking = startTime > now;

        if (startTime < now - 60000) // Allow 1-min tolerance for "now" bookings
            return res.status(400).json({ message: 'Cannot book for a time in the past' });

        // EV Priority Rule (only for immediate bookings)
        if (!isPreBooking && vehicleType === 'Petrol' && slot.slotType === 'EV') {
            const normalAvailable = await Slot.countDocuments({
                parkingId: slot.parkingId, slotType: 'NORMAL', status: 'AVAILABLE'
            }).session(session);
            if (normalAvailable > 0)
                return res.status(403).json({ message: 'EV slots reserved for EV vehicles. Normal slots are available.' });
        }

        // Check for overlapping bookings on this slot
        const overlap = await hasOverlap(slotId, startTime, endTime);
        if (overlap)
            return res.status(409).json({ message: 'This slot is already booked for that time period. Choose another time.' });

        const totalPrice = calculatePrice({
            basePricePerHour: slot.basePricePerHour,
            premiumExtraPerHour: slot.premiumExtraPerHour,
            entryPriority: slot.entryPriority,
            durationHours
        });

        // For immediate bookings that are "now", the arrival window starts immediately
        const reservedUntil = isPreBooking ? null : new Date(now.getTime() + ARRIVAL_TIMEOUT_MINUTES * 60000);
        const status = isPreBooking ? 'SCHEDULED' : 'RESERVED';

        const booking = await Booking.create([{
            userId, slotId,
            parkingId: slot.parkingId,
            vehicleType,
            scheduledStartTime: startTime,
            scheduledEndTime: endTime,
            durationHours,
            totalPrice,
            status,
            reservedUntil
        }], { session });

        // Only mark slot as RESERVED immediately for now-bookings
        if (!isPreBooking) {
            await Slot.findByIdAndUpdate(slotId, {
                status: 'RESERVED',
                currentBookingId: booking[0]._id
            }, { session });
        }

        const payment = await Payment.create([{
            bookingId: booking[0]._id,
            userId,
            amount: Math.round(totalPrice * 100),
            currency: 'INR',
            provider: 'razorpay',
            status: 'PENDING',
        }], { session });

        await session.commitTransaction();
        session.endSession();

        res.status(201).json({
            ok: true,
            booking: booking[0],
            isPreBooking,
            scheduledFor: startTime,
            scheduledUntil: endTime,
            paymentIntent: {
                provider: 'razorpay',
                amount: payment[0].amount,
                currency: 'INR',
                paymentId: payment[0]._id,
            },
            priceBreakdown: {
                basePrice: slot.basePricePerHour,
                premiumExtra: slot.entryPriority === 'PREMIUM' ? slot.premiumExtraPerHour : 0,
                durationHours,
                total: totalPrice
            }
        });
    } catch (err) {
        await session.abortTransaction();
        session.endSession();
        res.status(500).json({ message: err.message });
    }
};

// GET /api/slots/:slotId/schedule?days=7
exports.getSlotSchedule = async (req, res) => {
    try {
        const { slotId } = req.params;
        const days = parseInt(req.query.days) || 7;
        const now = new Date();
        const until = new Date(now.getTime() + days * 86400000);

        const slot = await Slot.findById(slotId);
        if (!slot) return res.status(404).json({ message: 'Slot not found' });

        const bookings = await Booking.find({
            slotId,
            status: { $in: ['SCHEDULED', 'RESERVED', 'OCCUPIED'] },
            scheduledStartTime: { $lt: until },
            scheduledEndTime: { $gt: now }
        }).sort({ scheduledStartTime: 1 })
            .populate('userId', 'name');

        res.json({
            slot,
            bookings: bookings.map(b => ({
                _id: b._id,
                status: b.status,
                scheduledStartTime: b.scheduledStartTime,
                scheduledEndTime: b.scheduledEndTime,
                durationHours: b.durationHours,
                userName: b.userId?.name || 'Guest'
            })),
            nowTime: now,
            untilTime: until
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// POST /api/bookings/:id/confirm-arrival
exports.confirmArrival = async (req, res) => {
    try {
        const { lat, lng } = req.body;
        const booking = await Booking.findById(req.params.id);
        if (!booking) return res.status(404).json({ message: 'Booking not found' });
        if (booking.userId.toString() !== req.user.userId)
            return res.status(403).json({ message: 'Forbidden' });
        if (!['RESERVED', 'SCHEDULED'].includes(booking.status))
            return res.status(400).json({ message: `Booking is ${booking.status}, cannot confirm arrival` });

        // For SCHEDULED bookings - check if the scheduled time has arrived
        if (booking.status === 'SCHEDULED') {
            const now = new Date();
            const minsUntilStart = (booking.scheduledStartTime - now) / 60000;
            if (minsUntilStart > ARRIVAL_TIMEOUT_MINUTES)
                return res.status(400).json({ message: `Your slot starts at ${booking.scheduledStartTime.toLocaleTimeString()}. Come back closer to that time!` });
        }

        if (booking.reservedUntil && new Date() > booking.reservedUntil)
            return res.status(410).json({ message: 'Booking has expired. Slot was released.' });

        const parking = await Parking.findById(booking.parkingId);
        const dist = haversineDistance(lat, lng, parking.location.lat, parking.location.lng);

        if (dist > ARRIVAL_RADIUS_METERS)
            return res.json({ ok: false, reason: 'too_far', distanceMeters: Math.round(dist), allowedRadius: ARRIVAL_RADIUS_METERS });

        await Booking.findByIdAndUpdate(booking._id, { status: 'OCCUPIED', bookingStartTime: new Date(), reservedUntil: null });
        await Slot.findByIdAndUpdate(booking.slotId, { status: 'OCCUPIED', currentBookingId: booking._id });
        await User.findByIdAndUpdate(req.user.userId, { lastKnownLat: lat, lastKnownLng: lng, lastLocationAt: new Date() });

        res.json({ ok: true, message: 'Arrival confirmed! Slot marked Occupied.', distanceMeters: Math.round(dist) });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// GET /api/bookings/:id
exports.getBooking = async (req, res) => {
    try {
        const booking = await Booking.findById(req.params.id)
            .populate('slotId', 'slotNumber slotType entryPriority basePricePerHour')
            .populate('parkingId', 'name address location');
        if (!booking) return res.status(404).json({ message: 'Booking not found' });
        res.json(booking);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// GET /api/bookings/my
exports.getMyBookings = async (req, res) => {
    try {
        const bookings = await Booking.find({ userId: req.user.userId })
            .sort({ scheduledStartTime: -1 })
            .populate('slotId', 'slotNumber slotType entryPriority basePricePerHour')
            .populate('parkingId', 'name address');
        res.json(bookings);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// POST /api/bookings/:id/cancel
exports.cancelBooking = async (req, res) => {
    try {
        const booking = await Booking.findById(req.params.id);
        if (!booking) return res.status(404).json({ message: 'Booking not found' });
        if (!['RESERVED', 'SCHEDULED'].includes(booking.status))
            return res.status(400).json({ message: `Cannot cancel a ${booking.status} booking` });

        await Booking.findByIdAndUpdate(booking._id, { status: 'CANCELLED' });
        await Slot.findByIdAndUpdate(booking.slotId, { status: 'AVAILABLE', currentBookingId: null });
        await Payment.findOneAndUpdate({ bookingId: booking._id }, { status: 'REFUNDED' });

        res.json({ ok: true, message: 'Booking cancelled and slot released.' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// POST /api/bookings/:id/complete
exports.completeBooking = async (req, res) => {
    try {
        const booking = await Booking.findById(req.params.id);
        if (!booking) return res.status(404).json({ message: 'Booking not found' });
        if (booking.status !== 'OCCUPIED')
            return res.status(400).json({ message: 'Can only complete an OCCUPIED booking' });

        await Booking.findByIdAndUpdate(booking._id, { status: 'COMPLETED' });
        await Slot.findByIdAndUpdate(booking.slotId, { status: 'AVAILABLE', currentBookingId: null });
        await Payment.findOneAndUpdate({ bookingId: booking._id, status: 'PENDING' }, { status: 'PAID' });

        res.json({ ok: true, message: 'Booking completed. Slot is now free.' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// GET /api/bookings/price-preview
exports.pricePreview = async (req, res) => {
    try {
        const { slotId, durationHours } = req.query;
        const slot = await Slot.findById(slotId);
        if (!slot) return res.status(404).json({ message: 'Slot not found' });
        const total = calculatePrice({
            basePricePerHour: slot.basePricePerHour,
            premiumExtraPerHour: slot.premiumExtraPerHour,
            entryPriority: slot.entryPriority,
            durationHours: parseFloat(durationHours)
        });
        res.json({ basePricePerHour: slot.basePricePerHour, premiumExtra: slot.entryPriority === 'PREMIUM' ? slot.premiumExtraPerHour : 0, durationHours: parseFloat(durationHours), total });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// POST /api/bookings/:id/early-end
// Driver ends booking early. If they are >500m away, grant 50% refund of unused time.
exports.earlyEnd = async (req, res) => {
    try {
        const { lat, lng } = req.body; // optional GPS
        const booking = await Booking.findById(req.params.id);
        if (!booking) return res.status(404).json({ message: 'Booking not found' });
        if (booking.userId.toString() !== req.user.userId)
            return res.status(403).json({ message: 'Forbidden' });
        if (booking.status !== 'OCCUPIED')
            return res.status(400).json({ message: 'Can only end an OCCUPIED booking early' });

        const now = new Date();
        const scheduledEnd = new Date(booking.scheduledEndTime);

        // Calculate remaining time and its price value
        const remainingMs = Math.max(0, scheduledEnd - now);
        const remainingHours = remainingMs / 3600000;
        const slot = await Slot.findById(booking.slotId);
        const pricePerHour = slot
            ? slot.basePricePerHour + (slot.entryPriority === 'PREMIUM' ? (slot.premiumExtraPerHour || 0) : 0)
            : 0;
        const remainingValue = parseFloat((remainingHours * pricePerHour).toFixed(2));

        let refundGranted = false;
        let refundAmount = 0;

        // GPS check: if driver provided location and is >500m away, refund 50% of remaining
        if (lat != null && lng != null && slot) {
            const parking = await Parking.findById(booking.parkingId);
            if (parking) {
                const dist = haversineDistance(lat, lng, parking.location.lat, parking.location.lng);
                if (dist > 500 && remainingValue > 0) {
                    refundAmount = parseFloat((remainingValue * 0.5).toFixed(2));
                    refundGranted = true;
                }
            }
        }

        // Mark booking complete
        await Booking.findByIdAndUpdate(booking._id, {
            status: 'COMPLETED',
            earlyEndedAt: now,
            refundAmount
        });
        // Free the slot
        await Slot.findByIdAndUpdate(booking.slotId, { status: 'AVAILABLE', currentBookingId: null });
        // Update payment
        await Payment.findOneAndUpdate({ bookingId: booking._id, status: 'PENDING' }, { status: 'PAID' });

        res.json({
            ok: true,
            refundGranted,
            refundAmount,
            remainingHours: parseFloat(remainingHours.toFixed(2)),
            message: refundGranted
                ? `Slot freed early! ₹${refundAmount} refund issued for unused time.`
                : 'Slot freed. Thanks for using Smart Parking!'
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

