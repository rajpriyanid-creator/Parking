const haversineDistance = require('../utils/haversine');
const Parking = require('../models/Parking');
const Slot = require('../models/Slot');
const Booking = require('../models/Booking');
const WaitingQueue = require('../models/WaitingQueue');
const Payment = require('../models/Payment');
const User = require('../models/User');

const ARRIVAL_TIMEOUT_MINUTES = 15;
const ARRIVAL_RADIUS_METERS = 100;

// Pricing Calculator
function calculatePrice({ basePricePerHour, premiumExtraPerHour, entryPriority, durationHours }) {
    const premium = entryPriority === 'PREMIUM' ? (premiumExtraPerHour || 0) : 0;
    return parseFloat(((basePricePerHour + premium) * durationHours).toFixed(2));
}

// POST /api/bookings
exports.createBooking = async (req, res) => {
    const session = await require('mongoose').startSession();
    session.startTransaction();
    try {
        const { slotId, vehicleType, durationHours } = req.body;
        const userId = req.user.userId;

        if (!slotId || !vehicleType || !durationHours)
            return res.status(400).json({ message: 'slotId, vehicleType, and durationHours are required' });

        // Fetch slot with lock (within transaction)
        const slot = await Slot.findById(slotId).session(session);
        if (!slot) return res.status(404).json({ message: 'Slot not found' });
        if (slot.status !== 'AVAILABLE')
            return res.status(409).json({ message: 'Slot is not available', status: slot.status });

        // EV Priority Rule
        if (vehicleType === 'Petrol' && slot.slotType === 'EV') {
            const normalAvailable = await Slot.countDocuments({
                parkingId: slot.parkingId, slotType: 'NORMAL', status: 'AVAILABLE'
            }).session(session);
            if (normalAvailable > 0)
                return res.status(403).json({ message: 'EV slots reserved for EV vehicles. Normal slots available.' });
        }

        const totalPrice = calculatePrice({
            basePricePerHour: slot.basePricePerHour,
            premiumExtraPerHour: slot.premiumExtraPerHour,
            entryPriority: slot.entryPriority,
            durationHours
        });

        const now = new Date();
        const reservedUntil = new Date(now.getTime() + ARRIVAL_TIMEOUT_MINUTES * 60000);

        const booking = await Booking.create([{
            userId,
            slotId,
            parkingId: slot.parkingId,
            vehicleType,
            bookingStartTime: now,
            durationHours,
            totalPrice,
            status: 'RESERVED',
            reservedUntil
        }], { session });

        // Mark slot as RESERVED
        await Slot.findByIdAndUpdate(slotId, {
            status: 'RESERVED',
            currentBookingId: booking[0]._id
        }, { session });

        // Create a pending payment record
        const payment = await Payment.create([{
            bookingId: booking[0]._id,
            userId,
            amount: Math.round(totalPrice * 100), // paise / cents
            currency: 'INR',
            provider: 'razorpay',
            status: 'PENDING',
        }], { session });

        await session.commitTransaction();
        session.endSession();

        res.status(201).json({
            ok: true,
            booking: booking[0],
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

// POST /api/bookings/:id/confirm-arrival
exports.confirmArrival = async (req, res) => {
    try {
        const { lat, lng } = req.body;
        const booking = await Booking.findById(req.params.id);
        if (!booking) return res.status(404).json({ message: 'Booking not found' });
        if (booking.userId.toString() !== req.user.userId)
            return res.status(403).json({ message: 'Forbidden' });
        if (booking.status !== 'RESERVED')
            return res.status(400).json({ message: `Booking is ${booking.status}, not RESERVED` });
        if (new Date() > booking.reservedUntil)
            return res.status(410).json({ message: 'Booking has expired. Slot was released.' });

        const parking = await require('../models/Parking').findById(booking.parkingId);
        const dist = haversineDistance(lat, lng, parking.location.lat, parking.location.lng);

        if (dist > ARRIVAL_RADIUS_METERS) {
            return res.json({ ok: false, reason: 'too_far', distanceMeters: Math.round(dist), allowedRadius: ARRIVAL_RADIUS_METERS });
        }

        await Booking.findByIdAndUpdate(booking._id, { status: 'OCCUPIED', reservedUntil: null });
        await Slot.findByIdAndUpdate(booking.slotId, { status: 'OCCUPIED' });

        // Update user's last known location
        await User.findByIdAndUpdate(req.user.userId, {
            lastKnownLat: lat, lastKnownLng: lng, lastLocationAt: new Date()
        });

        res.json({ ok: true, message: 'Arrival confirmed! Slot marked Occupied.', distanceMeters: Math.round(dist) });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// GET /api/bookings/:id
exports.getBooking = async (req, res) => {
    try {
        const booking = await Booking.findById(req.params.id)
            .populate('slotId', 'slotNumber slotType entryPriority')
            .populate('parkingId', 'name address');
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
            .sort({ createdAt: -1 })
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
        if (!['RESERVED'].includes(booking.status))
            return res.status(400).json({ message: `Cannot cancel a booking with status ${booking.status}` });

        await Booking.findByIdAndUpdate(booking._id, { status: 'CANCELLED' });
        await Slot.findByIdAndUpdate(booking.slotId, { status: 'AVAILABLE', currentBookingId: null });
        // Mark payment for refund
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

// GET /api/bookings/price-preview (query: slotId, durationHours)
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
        res.json({
            basePricePerHour: slot.basePricePerHour,
            premiumExtra: slot.entryPriority === 'PREMIUM' ? slot.premiumExtraPerHour : 0,
            durationHours: parseFloat(durationHours),
            total
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};
