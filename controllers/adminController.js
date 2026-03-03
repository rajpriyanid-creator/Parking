const Parking = require('../models/Parking');
const Slot = require('../models/Slot');
const Booking = require('../models/Booking');

// POST /api/admin/parkings
exports.createParking = async (req, res) => {
    try {
        const { name, description, address, totalSlots, location } = req.body;
        if (!name || !location?.lat || !location?.lng)
            return res.status(400).json({ message: 'name, location.lat, location.lng are required' });
        const parking = await Parking.create({
            name, description, address, totalSlots: totalSlots || 0,
            location, adminId: req.user.userId
        });
        res.status(201).json(parking);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// GET /api/admin/parkings
exports.getMyParkings = async (req, res) => {
    try {
        const parkings = await Parking.find({ adminId: req.user.userId });
        res.json(parkings);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// POST /api/admin/parkings/:id/slots
exports.addSlot = async (req, res) => {
    try {
        const { slotNumber, slotType, entryPriority, chargingType, basePricePerHour, premiumExtraPerHour } = req.body;
        const slot = await Slot.create({
            parkingId: req.params.id,
            slotNumber, slotType, entryPriority, chargingType,
            basePricePerHour: basePricePerHour || 5,
            premiumExtraPerHour: premiumExtraPerHour || 0
        });
        // Update totalSlots count
        await Parking.findByIdAndUpdate(req.params.id, { $inc: { totalSlots: 1 } });
        res.status(201).json(slot);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// PUT /api/admin/slots/:slotId
exports.updateSlot = async (req, res) => {
    try {
        const slot = await Slot.findByIdAndUpdate(req.params.slotId, req.body, { new: true });
        if (!slot) return res.status(404).json({ message: 'Slot not found' });
        res.json(slot);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// DELETE /api/admin/slots/:slotId
exports.deleteSlot = async (req, res) => {
    try {
        const slot = await Slot.findByIdAndDelete(req.params.slotId);
        if (!slot) return res.status(404).json({ message: 'Slot not found' });
        await Parking.findByIdAndUpdate(slot.parkingId, { $inc: { totalSlots: -1 } });
        res.json({ ok: true, message: 'Slot deleted' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// POST /api/admin/slots/:slotId/release (force release)
exports.forceReleaseSlot = async (req, res) => {
    try {
        const slot = await Slot.findById(req.params.slotId);
        if (!slot) return res.status(404).json({ message: 'Slot not found' });
        if (slot.currentBookingId) {
            await Booking.findByIdAndUpdate(slot.currentBookingId, { status: 'RELEASED' });
        }
        await Slot.findByIdAndUpdate(slot._id, { status: 'AVAILABLE', currentBookingId: null });
        res.json({ ok: true, message: 'Slot force-released' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// GET /api/admin/parkings/:id/bookings
exports.getParkingBookings = async (req, res) => {
    try {
        const bookings = await Booking.find({ parkingId: req.params.id })
            .sort({ createdAt: -1 })
            .limit(50)
            .populate('userId', 'name email vehicle')
            .populate('slotId', 'slotNumber slotType');
        res.json(bookings);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// GET /api/admin/dashboard
exports.getDashboardStats = async (req, res) => {
    try {
        const parkings = await Parking.find({ adminId: req.user.userId });
        const parkingIds = parkings.map(p => p._id);

        const slots = await Slot.find({ parkingId: { $in: parkingIds } });
        const bookings = await Booking.find({ parkingId: { $in: parkingIds } });

        const totalSlots = slots.length;
        const occupiedSlots = slots.filter(s => s.status !== 'AVAILABLE').length;
        const evSlots = slots.filter(s => s.slotType === 'EV').length;
        const evOccupied = slots.filter(s => s.slotType === 'EV' && s.status !== 'AVAILABLE').length;
        const revenue = bookings.reduce((sum, b) => b.status === 'COMPLETED' ? sum + b.totalPrice : sum, 0);

        res.json({
            totalParkings: parkings.length,
            totalSlots,
            occupiedSlots,
            availableSlots: totalSlots - occupiedSlots,
            occupancyRate: totalSlots > 0 ? Math.round((occupiedSlots / totalSlots) * 100) : 0,
            evSlots,
            evOccupied,
            totalBookings: bookings.length,
            revenue: revenue.toFixed(2)
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};
